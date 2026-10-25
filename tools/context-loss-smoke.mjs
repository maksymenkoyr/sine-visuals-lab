// Headless check that a GPU context loss is survived in place (#345): for each
// scene it takes the context away with WEBGL_lose_context, gives it back, and
// checks that the page did not reload, the same scene draws again, capture and
// audio kept running, and WebGL logged nothing about the rebuild.
//
//   node tools/context-loss-smoke.mjs [--port 5173]
//     [--scenes spectrum,caustics,chaikin,fractalgrid,fluid,physarum2|all]
//     [--audio mic|synthetic] [--cycles 2] [--settle 3000] [--output]
//
// The dev server must already run (npm run dev). Exits 1 when any row fails.
// --output also loses the pop-out output window's context; it needs no Play,
// since the main window answers the output's hello with its preview. The TV
// page is not covered: it needs a paired room.
//
// Why it reads pixels as it does: the dev build keeps the main canvas's
// drawing buffer (preserveDrawingBuffer), so drawImage(#gl) sees the picture
// and the HUD, which sits over the canvas, stays out of it. The output page
// does not keep it, so its canvas is read from a screenshot.
import { chromium } from "playwright";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i === -1 ? dflt : args[i + 1];
};
const port = Number(opt("--port", 5173));
const audio = opt("--audio", "mic");
const cycles = Number(opt("--cycles", 2));
const settle = Number(opt("--settle", 3000));
const withOutput = args.includes("--output");
const sceneArg = opt("--scenes", "spectrum,caustics,chaikin,fractalgrid,fluid,physarum2");
const base = `https://localhost:${port}`;
const LOSS_TIMEOUT_MS = 15000;
/** Luma spread (0-255) below which a picture counts as blank. */
const BLANK_SPREAD = 8;

const IGNORED = [/CONTEXT_LOST_WEBGL/, /GPU stall/, /swiftshader/i, /ERR_CONNECTION_REFUSED/];
const PROBLEM_WARNING = /WebGL|INVALID_|Compositor:|pictureReadback:|glass/i;

const browser = await chromium.launch({
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--enable-unsafe-swiftshader",
  ],
});
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1280, height: 800 },
  permissions: ["microphone"],
});

await context.addInitScript(() => {
  const smoke = { gum: 0, gdm: 0, contexts: [], stacks: [] };
  window.__lossSmoke = smoke;
  const md = navigator.mediaDevices;
  if (md) {
    for (const [name, key] of [
      ["getUserMedia", "gum"],
      ["getDisplayMedia", "gdm"],
    ]) {
      const orig = md[name]?.bind(md);
      if (orig)
        md[name] = (...a) => {
          smoke[key]++;
          smoke.stacks.push(`${name} #${smoke[key]}: ${new Error().stack}`);
          return orig(...a);
        };
    }
  }
  for (const key of ["AudioContext", "webkitAudioContext"]) {
    const Orig = window[key];
    if (!Orig) continue;
    window[key] = class extends Orig {
      constructor(...a) {
        super(...a);
        smoke.contexts.push(this);
      }
    };
  }
});

/** Per-page bookkeeping: load events and console problems, tagged by phase. */
function watch(page, label) {
  const rec = { label, loads: 0, phase: "before", scene: "-", problems: [], ignored: new Map() };
  page.on("load", () => rec.loads++);
  const note = (kind, text) => {
    if (IGNORED.some((re) => re.test(text))) {
      const key = text.slice(0, 90);
      rec.ignored.set(key, (rec.ignored.get(key) ?? 0) + 1);
      return;
    }
    rec.problems.push({ phase: rec.phase, scene: rec.scene, kind, text: text.slice(0, 300) });
  };
  page.on("console", (m) => {
    const t = m.type();
    const url = m.location()?.url ?? "";
    if (url.includes(":8787")) return;
    if (t === "error") note("error", m.text());
    else if (t === "warning" && PROBLEM_WARNING.test(m.text())) note("warning", m.text());
  });
  page.on("pageerror", (e) => note("pageerror", e.message));
  return rec;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Takes the context away and gives it back inside the page. */
async function loseAndRestore(page, hashWhileDown) {
  return page.evaluate(
    async ({ hashWhileDown, timeoutMs }) => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const once = (c, name) =>
        new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error(`no ${name} within ${timeoutMs} ms`)), timeoutMs);
          c.addEventListener(
            name,
            () => {
              clearTimeout(t);
              res();
            },
            { once: true },
          );
        });
      const c = document.getElementById("gl");
      const gl = c.getContext("webgl2");
      const lose = gl.getExtension("WEBGL_lose_context");
      if (!lose) throw new Error("WEBGL_lose_context unavailable");
      const lost = once(c, "webglcontextlost");
      lose.loseContext();
      await lost;
      await wait(500);
      const wasLost = gl.isContextLost();
      if (hashWhileDown) {
        location.hash = hashWhileDown;
        await wait(300);
      }
      const restored = once(c, "webglcontextrestored");
      lose.restoreContext();
      await restored;
      return wasLost;
    },
    { hashWhileDown, timeoutMs: LOSS_TIMEOUT_MS },
  );
}

const LUMA_JS = `(canvasOrImg) => {
  const w = 64, h = 40;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  g.drawImage(canvasOrImg, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  let min = 255, max = 0, sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    if (y < min) min = y; if (y > max) max = y; sum += y;
  }
  return { min, max, mean: sum / (w * h) };
}`;

/** Several frames over about a second, widest spread kept: a scene that
 *  blinks or strobes is dark between flashes (Long Play's glitch layer). */
async function mainStats(page) {
  return page.evaluate(async () => {
    const luma = window.__lumaOf;
    let out = null;
    for (let i = 0; i < 5; i++) {
      const s = luma(document.getElementById("gl"));
      if (!out || s.max - s.min > out.max - out.min) out = s;
      await new Promise((r) => setTimeout(r, 200));
    }
    return out;
  });
}

async function shotStats(page) {
  const png = await page.locator("#gl").screenshot();
  return page.evaluate(
    async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      return window.__lumaOf(img);
    },
    png.toString("base64"),
  );
}

/** Samples audio-side readings over about two seconds. */
async function sampleAudio(page) {
  return page.evaluate(async () => {
    const times = [];
    const energy = [];
    for (let i = 0; i < 8; i++) {
      times.push(window.__viz.audioProbe().time);
      energy.push(window.__viz.probe().bands.energy);
      await new Promise((r) => setTimeout(r, 250));
    }
    return { times, energy };
  });
}

const rising = (xs) => xs.every((x, i) => i === 0 || x > xs[i - 1]);
const varies = (xs) => Math.max(...xs) - Math.min(...xs) > 1e-6;
const spread = (s) => s.max - s.min;

const smokeState = (page) =>
  page.evaluate(() => ({
    gum: window.__lossSmoke.gum,
    gdm: window.__lossSmoke.gdm,
    contexts: window.__lossSmoke.contexts.length,
    states: window.__lossSmoke.contexts.map((c) => c.state),
    stacks: window.__lossSmoke.stacks,
  }));

// ---- Main page ----
const page = await context.newPage();
const main = watch(page, "main");
const qs = `?quality=low${audio === "synthetic" ? "&audio=synthetic&bpm=120" : ""}`;
const sceneList = await (async () => {
  await page.goto(`${base}/${qs}#/v/spectrum`, { waitUntil: "load", timeout: 60000 });
  try {
    await page.mouse.click(640, 400);
  } catch {}
  await page.waitForFunction(() => typeof window.__viz?.scenes === "function", { timeout: 20000 });
  const known = await page.evaluate(() => window.__viz.scenes().map((s) => s.id));
  const wanted = sceneArg === "all" ? known : sceneArg.split(",").filter(Boolean);
  return { known, wanted };
})();
await page.evaluate(`window.__lumaOf = ${LUMA_JS}`);

const rows = [];
let reloaded = false;
const firstScene = sceneList.wanted.find((id) => sceneList.known.includes(id)) ?? "spectrum";
await page.evaluate(() => {
  window.__viz.pictureForce(true);
  window.__lossMarker = crypto.randomUUID();
});
const marker = await page.evaluate(() => window.__lossMarker);
await sleep(settle);

for (let si = 0; si < sceneList.wanted.length; si++) {
  const id = sceneList.wanted[si];
  const row = { page: "main", scene: id, fails: [], notes: [] };
  rows.push(row);
  if (!sceneList.known.includes(id)) {
    row.status = "unavailable";
    row.notes.push("not in __viz.scenes()");
    continue;
  }
  main.scene = id;
  await page.evaluate((h) => {
    location.hash = h;
  }, `#/v/${id}`);
  await sleep(settle);
  if ((await page.evaluate(() => window.__viz.probe().scene)) !== id) {
    row.status = "unavailable";
    row.notes.push("scene did not mount (probe().scene differs)");
    continue;
  }
  const beforeStats = await mainStats(page);
  const beforeAudio = await sampleAudio(page);
  const beforeSmoke = await smokeState(page);
  // The last scene ends on the first scene (the hash change while down), so
  // its "before" picture is not the one to compare with.
  const endsElsewhere = si === sceneList.wanted.length - 1 && firstScene !== id;
  const blankBefore = !endsElsewhere && spread(beforeStats) <= BLANK_SPREAD;
  let expected = id;
  main.phase = "after";
  try {
    for (let c = 0; c < cycles; c++) {
      const lastOfLast = si === sceneList.wanted.length - 1 && c === cycles - 1;
      const down = await loseAndRestore(page, lastOfLast ? `#/v/${firstScene}` : null);
      if (lastOfLast) expected = firstScene;
      if (!down) row.fails.push("isContextLost() false while down");
      await page.evaluate(() => window.__viz.pictureReset());
      await sleep(settle);
    }
  } catch (err) {
    row.fails.push(`loss cycle: ${err.message}`);
    await sleep(settle);
  }
  if (main.loads !== 1) {
    // A reloaded page lost the marker and the state under test; nothing after
    // this is comparable.
    row.fails.push(`reload happened (loads ${main.loads})`);
    row.status = "FAIL";
    reloaded = true;
    break;
  }
  const afterStats = await mainStats(page);
  const afterAudio = await sampleAudio(page);
  const afterSmoke = await smokeState(page);
  const picture = await page.evaluate(() => {
    const p = window.__viz.picture();
    return { samples: p.samples, latest: p.latest !== null };
  });
  const scene = await page.evaluate(() => window.__viz.probe().scene);
  const markerNow = await page.evaluate(() => window.__lossMarker);

  if (markerNow !== marker || main.loads !== 1) row.fails.push(`reload happened (marker ${markerNow === marker ? "same" : "changed"}, loads ${main.loads})`);
  if (blankBefore) row.notes.push("blank before");
  else if (spread(afterStats) <= BLANK_SPREAD) row.fails.push(`blank after (spread ${spread(afterStats).toFixed(1)})`);
  if (!rising(afterAudio.times)) row.fails.push("audio time not rising");
  if (!varies(afterAudio.energy)) row.fails.push("energy constant");
  if (!varies(beforeAudio.energy)) row.notes.push("energy constant before");
  if (afterSmoke.gum !== beforeSmoke.gum) row.fails.push(`getUserMedia called again (${beforeSmoke.gum} -> ${afterSmoke.gum})`);
  if (afterSmoke.gum !== beforeSmoke.gum) row.fails.push(afterSmoke.stacks.slice(beforeSmoke.gum).join("\n"));
  if (afterSmoke.gdm !== 0) row.fails.push(`getDisplayMedia called (${afterSmoke.gdm})`);
  if (afterSmoke.contexts !== beforeSmoke.contexts) row.fails.push(`AudioContext count ${beforeSmoke.contexts} -> ${afterSmoke.contexts}`);
  if (afterSmoke.states.some((s) => s !== "running")) row.fails.push(`AudioContext state ${afterSmoke.states.join(",")}`);
  if (!(picture.samples > 0) || !picture.latest) row.fails.push(`picture readback (samples ${picture.samples}, latest ${picture.latest})`);
  if (scene !== expected) row.fails.push(`scene is ${scene}, expected ${expected}`);
  const bad = main.problems.filter((p) => p.phase === "after" && p.scene === id);
  if (bad.length) row.fails.push(`${bad.length} console problem(s): ${bad[0].kind}: ${bad[0].text}`);
  row.status = row.fails.length ? "FAIL" : row.notes.includes("blank before") ? "ok (blank before)" : "ok";
  row.detail = `luma spread ${spread(beforeStats).toFixed(0)} -> ${spread(afterStats).toFixed(0)}, picture samples ${picture.samples}`;
  main.scene = "-";
}
const strayMain = main.problems.filter((p) => p.phase === "after" && p.scene === "-");
if (strayMain.length) {
  rows.push({ page: "main", scene: "(between scenes)", status: "FAIL", fails: [`${strayMain.length} console problem(s): ${strayMain[0].text}`], notes: [] });
}

// ---- Output window ----
if (withOutput && !reloaded) {
  const row = { page: "output", scene: firstScene, fails: [], notes: [] };
  rows.push(row);
  await page.evaluate((h) => {
    location.hash = h;
  }, `#/v/${firstScene}`);
  await sleep(settle);
  const out = await context.newPage();
  const rec = watch(out, "output");
  rec.scene = firstScene;
  await out.goto(`${base}/output.html?quality=low`, { waitUntil: "load", timeout: 60000 });
  await out.addStyleTag({ content: "#hint{display:none}" });
  await out.evaluate(`window.__lumaOf = ${LUMA_JS}; window.__lossMarker = crypto.randomUUID();`);
  const outMarker = await out.evaluate(() => window.__lossMarker);
  let before = null;
  for (let t = 0; t < 20; t++) {
    before = await shotStats(out);
    if (spread(before) > BLANK_SPREAD) break;
    await sleep(500);
  }
  // Opening the output makes the main window open its desk, whose input
  // previews call getUserMedia on their own; the baseline is taken after that.
  await sleep(settle);
  const gumBefore = (await smokeState(page)).gum;
  if (spread(before) <= BLANK_SPREAD) row.fails.push("output never drew (blank before)");
  else {
    rec.phase = "after";
    try {
      for (let c = 0; c < cycles; c++) {
        const down = await loseAndRestore(out, null);
        if (!down) row.fails.push("isContextLost() false while down");
        await sleep(settle);
      }
    } catch (err) {
      row.fails.push(`loss cycle: ${err.message}`);
      await sleep(settle);
    }
    const after = await shotStats(out);
    if (spread(after) <= BLANK_SPREAD) row.fails.push(`blank after (spread ${spread(after).toFixed(1)})`);
    row.detail = `luma spread ${spread(before).toFixed(0)} -> ${spread(after).toFixed(0)}`;
  }
  if ((await out.evaluate(() => window.__lossMarker)) !== outMarker || rec.loads !== 1) row.fails.push(`reload happened (loads ${rec.loads})`);
  const bad = rec.problems.filter((p) => p.phase === "after");
  if (bad.length) row.fails.push(`${bad.length} console problem(s): ${bad[0].kind}: ${bad[0].text}`);
  const gumAfter = (await smokeState(page)).gum;
  if (gumAfter !== gumBefore) row.fails.push(`main window's getUserMedia called again (${gumBefore} -> ${gumAfter})`);
  if (gumAfter !== gumBefore) row.fails.push((await smokeState(page)).stacks.slice(gumBefore).join("\n"));
  row.status = row.fails.length ? "FAIL" : "ok";
  for (const [k, n] of rec.ignored) console.log(`[output ignored x${n}] ${k}`);
}

for (const [k, n] of main.ignored) console.log(`[main ignored x${n}] ${k}`);
console.log(`\naudio=${audio} cycles=${cycles} settle=${settle}ms${withOutput ? " +output" : ""}`);
console.log("page    scene            status             detail");
for (const r of rows) {
  console.log(`${r.page.padEnd(7)} ${r.scene.padEnd(16)} ${String(r.status).padEnd(18)} ${r.detail ?? ""}${r.notes?.length ? `  [${r.notes.join("; ")}]` : ""}`);
  for (const f of r.fails) console.log(`          - ${f}`);
}
const failed = rows.some((r) => r.status === "FAIL");
await browser.close();
process.exit(failed ? 1 : 0);
