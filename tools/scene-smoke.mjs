// Opens every free, non-draft scene in headless Chromium against the built
// dist/ and fails on a console error, a page error, a "Shader compile error"
// or a blank frame, so a GLSL typo or a scene that throws on its first frame
// stops a deploy. .github/workflows/deploy.yml runs it after the build and
// before every deploy.
//
//   node tools/scene-smoke.mjs [--dist dist] [--only id,id] [--drafts] [--list]
//                              [--software] [--port N] [--ms N]
//
// It drives dist/, not the dev server: only the production build runs the GLSL
// strip plugin and the es2017 target, and that is what ships. The cost is that
// `window.__viz` (dev only, src/tuning/debug.ts) and `preserveDrawingBuffer`
// are both absent there, so a scene is "running" when the hash still names it
// and #sceneTag shows its name (a failed start navigates back to #/), and
// "not blank" is read from a screenshot of the canvas, since an in-page
// canvas read returns black in this build. The screenshot hides every other
// element first: UI text over a black canvas would otherwise pass.
//
// The scene list comes from the registry through Vite's SSR loader, so paid
// scenes (PAID_SCENE_IDS, from a private/ checkout) are never listed, even
// if that checkout makes them part of a local dist/. --software forces
// SwiftShader so a Mac behaves like a GitHub runner, which has no GPU.
//
// Console allowlist (ALLOWED_CONSOLE): the browser's own "Failed to load
// resource" line for the pairing Worker, which is not running here and which
// the app tolerates. Nothing else is allowed.
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer, preview } from "vite";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Tangle needs most of 20 s to reach a few dozen frames on software WebGL.
const DEFAULT_CAP_MS = 45_000;
const POLL_MS = 250;
const BLANK_CHECK_MS = 750;
const SETTLE_MS = 2_000;
const SETTLE_FRAMES = 10;
const MAX_BLANK_SPREAD = 2;
const MAX_TEXT = 600;
const VIEWPORT = { width: 640, height: 360 };

// Matched on the message's own source URL and text, never on the text alone.
const ALLOWED_CONSOLE = [
  { urlPrefix: "https://localhost:8787/api/room", text: /Failed to load resource/ },
];

const argv = process.argv.slice(2);
const has = (name) => argv.includes(name);
const val = (name, dflt) => {
  const i = argv.indexOf(name);
  return i === -1 ? dflt : argv[i + 1];
};
const distDir = resolve(ROOT, val("--dist", "dist"));
const only = val("--only", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const capMs = Number(val("--ms", DEFAULT_CAP_MS));
const port = Number(val("--port", 0)) || undefined;

const clip = (s) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}...` : s);

async function freeScenes({ drafts }) {
  const server = await createServer({
    configFile: false,
    root: ROOT,
    logLevel: "error",
    appType: "custom",
    server: { middlewareMode: true, watch: null, hmr: false },
    resolve: { preserveSymlinks: true },
  });
  try {
    const { PAID_SCENE_IDS, sceneStage } = await server.ssrLoadModule("/src/render/scenes/index.ts");
    const { listScenes } = await server.ssrLoadModule("/src/render/scene.ts");
    return listScenes()
      .filter((s) => !PAID_SCENE_IDS.has(s.id))
      .filter((s) => drafts || sceneStage(s.id) !== "draft")
      .map((s) => ({ id: s.id, name: s.name }));
  } finally {
    await server.close();
  }
}

async function startPreview() {
  if (!existsSync(resolve(distDir, "index.html"))) {
    throw new Error(`${distDir}/index.html is missing: build first (node node_modules/vite/bin/vite.js build)`);
  }
  // 127.0.0.1 counts as local, so the page does not report usage.
  const server = await preview({
    configFile: false,
    root: ROOT,
    logLevel: "error",
    build: { outDir: distDir },
    preview: { host: "127.0.0.1", port, strictPort: false },
  });
  const url = server.resolvedUrls?.local?.[0];
  if (!url) throw new Error("preview server reported no local URL");
  return { server, origin: url.replace(/\/$/, "") };
}

function isAllowed(msg) {
  const url = msg.location().url ?? "";
  return ALLOWED_CONSOLE.some((a) => url.startsWith(a.urlPrefix) && a.text.test(msg.text()));
}

async function smokeScene(browser, helper, origin, scene) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  try {
    await context.addInitScript(() => {
      window.__smokeFrames = 0;
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) =>
        raf((t) => {
          window.__smokeFrames++;
          cb(t);
        });
    });
    const page = await context.newPage();
    const problems = [];
    page.on("console", (msg) => {
      if ((msg.type() === "error" || /Shader compile error/.test(msg.text())) && !isAllowed(msg)) {
        problems.push(`console ${msg.type()}: ${clip(msg.text())}`);
      }
    });
    page.on("pageerror", (err) => problems.push(`page error: ${clip(err.message)}`));
    page.on("crash", () => problems.push("page crashed"));

    const frameIsBlank = async () => {
      const png = await page.screenshot({ animations: "disabled", timeout: capMs });
      return helper.evaluate(async (b64) => {
        const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
        const bmp = await createImageBitmap(blob);
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = c.getContext("2d");
        ctx.drawImage(bmp, 0, 0);
        const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
        const min = [255, 255, 255];
        const max = [0, 0, 0];
        for (let i = 0; i < d.length; i += 4) {
          for (let k = 0; k < 3; k++) {
            if (d[i + k] < min[k]) min[k] = d[i + k];
            if (d[i + k] > max[k]) max[k] = d[i + k];
          }
        }
        return [0, 1, 2].map((k) => max[k] - min[k]);
      }, png.toString("base64")).then((spread) => spread.every((s) => s <= MAX_BLANK_SPREAD));
    };

    const started = Date.now();
    await page.goto(`${origin}/?audio=synthetic&bpm=120#/v/${scene.id}`, { waitUntil: "load" });
    await page.addStyleTag({
      content:
        "html,body{background:#000!important} body *{visibility:hidden!important} #gl{visibility:visible!important}",
    });

    let seenAt = 0;
    let seenFrames = 0;
    let lastBlankCheck = 0;
    let state = { hash: "", tag: "", frames: 0 };
    let blankChecks = 0;
    while (Date.now() - started < capMs) {
      state = await page.evaluate(() => ({
        hash: location.hash,
        tag: document.getElementById("sceneTag")?.textContent ?? "",
        frames: window.__smokeFrames,
      }));
      if (problems.length) return { ok: false, reason: problems[0], retry: false };
      if (state.hash !== `#/v/${scene.id}`) {
        return { ok: false, reason: `left the scene (hash is ${state.hash || "empty"})`, retry: false };
      }
      const now = Date.now();
      if (!seenAt && state.tag === scene.name && now - lastBlankCheck >= BLANK_CHECK_MS) {
        lastBlankCheck = now;
        blankChecks++;
        if (!(await frameIsBlank())) {
          seenAt = Date.now();
          seenFrames = state.frames;
        }
      }
      if (seenAt && Date.now() - seenAt >= SETTLE_MS && state.frames - seenFrames >= SETTLE_FRAMES) {
        if (problems.length) return { ok: false, reason: problems[0], retry: false };
        return { ok: true, seconds: (Date.now() - started) / 1000, frames: state.frames };
      }
      await page.waitForTimeout(POLL_MS);
    }
    if (problems.length) return { ok: false, reason: problems[0], retry: false };
    const cause = !seenAt
      ? state.tag === scene.name
        ? `blank frame (uniform, ${blankChecks} checks), frames=${state.frames}`
        : `timed out after ${capMs} ms before the scene started (tag "${state.tag}", frames=${state.frames})`
      : `timed out after ${capMs} ms waiting for ${SETTLE_FRAMES} frames (frames=${state.frames - seenFrames})`;
    return { ok: false, reason: cause, retry: true };
  } catch (err) {
    const text = clip(String(err?.message ?? err));
    // A frame so slow that Playwright's screenshot times out.
    return { ok: false, reason: `harness error: ${text}`, retry: /Timeout/.test(text) };
  } finally {
    await context.close();
  }
}

async function main() {
  let scenes = await freeScenes({ drafts: has("--drafts") });
  if (only.length) scenes = scenes.filter((s) => only.includes(s.id));
  if (has("--list")) {
    for (const s of scenes) console.log(s.id);
    return 0;
  }
  if (scenes.length === 0) {
    console.error("no scenes to test");
    return 1;
  }

  const t0 = Date.now();
  const { server, origin } = await startPreview();
  let browser;
  try {
    console.log(`serving ${distDir} at ${origin}`);
    browser = await chromium.launch({
      args: [
        "--enable-unsafe-swiftshader",
        "--ignore-gpu-blocklist",
        "--autoplay-policy=no-user-gesture-required",
        ...(has("--software") ? ["--use-gl=angle", "--use-angle=swiftshader"] : []),
      ],
    });
    const helper = await browser.newPage();
    await helper.goto("about:blank");

    let failed = 0;
    for (const scene of scenes) {
      let r = await smokeScene(browser, helper, origin, scene);
      if (!r.ok && r.retry) r = await smokeScene(browser, helper, origin, scene);
      if (r.ok) console.log(`ok   ${scene.id} ${r.seconds.toFixed(1)}s frames=${r.frames}`);
      else {
        failed++;
        console.log(`FAIL ${scene.id}: ${r.reason}`);
      }
    }
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`${scenes.length - failed}/${scenes.length} scenes passed in ${elapsed}s`);
    return failed ? 1 : 0;
  } finally {
    await browser?.close();
    await server.close();
  }
}

process.exit(await main().catch((err) => {
  console.error(err.message ?? err);
  return 1;
}));
