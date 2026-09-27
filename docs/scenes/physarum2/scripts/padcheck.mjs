// Headless verification for the Pairs pads widget (src/ui/widgets/pairPads.ts,
// Phase 2 of the affinity-ui plan). Real mouse down -> move -> up drags
// throughout, per the project's own headless-driving lesson (see
// solocheck.mjs, the pattern this script follows).
//   node padcheck.mjs --port 5342 --out /path/to/tmp
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt("--port", "5342");
const outDir = opt("--out", ".");

const results = {};
function report(name, ok, detail) {
  results[name] = { ok, detail };
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
}

const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: [
    "--enable-gpu",
    "--use-angle=metal",
    "--enable-gpu-rasterization",
    "--ignore-gpu-blocklist",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
// Console text for a failed resource load never carries the URL, so a
// generic "403" text filter can't tell the known @fontsource-through-the-
// symlink 403 (environment gotcha; harmless, panel falls back to system
// fonts) apart from a real one — checked separately via `response`, which
// does carry the URL.
page.on("console", (m) => {
  if (m.type() === "error" && !/Failed to load resource.*403/.test(m.text())) errors.push(m.text().slice(0, 300));
});
page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
page.on("response", (res) => {
  if (res.status() >= 400 && !/woff2?|ttf|otf|fontsource|8787/.test(res.url())) {
    errors.push(`HTTP ${res.status()} ${res.url()}`.slice(0, 300));
  }
});

async function scrollToScene() {
  await page.evaluate(() => {
    document.querySelectorAll(".vc-card-head").forEach((h) => {
      if (h.textContent?.includes("Scene")) h.scrollIntoView({ block: "start" });
    });
  });
  await page.waitForTimeout(250);
}

async function scrollToPairs() {
  await page.evaluate(() => {
    const els = [...document.querySelectorAll("h4, .vc-group-heading, div")];
    const heading = els.find((e) => e.textContent?.trim() === "Affinity" && e.children.length === 0);
    heading?.scrollIntoView({ block: "start" });
  });
  await page.waitForTimeout(250);
}

async function openPanel() {
  await page.evaluate(() => document.getElementById("menuBtn")?.click());
  await page.waitForTimeout(500);
  await scrollToScene();
}

async function readSetting(key) {
  return page.evaluate((k) => {
    try {
      const store = JSON.parse(localStorage.getItem("vibe.sceneSettings") || "{}");
      return store.physarum2?.[k];
    } catch {
      return undefined;
    }
  }, key);
}

// A real pointer drag from one fractional point of `loc`'s box to another,
// with a few intermediate moves so a pointermove-driven drag (not just
// down+up) actually sees the motion.
async function dragPad(loc, fromFx, fromFy, toFx, toFy) {
  const box = await loc.boundingBox();
  if (!box) throw new Error("dragPad(): no bounding box");
  const x0 = box.x + box.width * fromFx;
  const y0 = box.y + box.height * fromFy;
  const x1 = box.x + box.width * toFx;
  const y1 = box.y + box.height * toFy;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.move(x1, y1, { steps: 8 });
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(200);
}

await page.evaluate(() => {
  try {
    localStorage.clear();
  } catch {}
});
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=120#/v/physarum2`);
await page.waitForTimeout(1500);
await openPanel();
await scrollToPairs();
// Let the pads' cultures step for a bit before the first screenshot/pixel
// check, same reasoning as solocheck.mjs's own warm-up wait.
await page.waitForTimeout(3000);

const pads = page.locator(".vc-pads .vc-pad");
const padSquares = page.locator(".vc-pads .vc-pad-sq");
const padCount = await pads.count();
report("six-pads", padCount === 6, `count=${padCount}`);

// --- 1. Screenshots of the Affinity block, Smell layer, at 1440 and 390. ---
const affinityBlock = page.locator(".vc-pair").first();
await affinityBlock.screenshot({ path: `${outDir}/pairs-smell-1440.png` }).catch(() => {});
console.log("shot", `${outDir}/pairs-smell-1440.png`);

// --- 2. Drag the A1<->B2 pad (pairsOf(4)'s first pair) from centre toward
// (85%, 15%): x -> high (A1's att toward B2 rises), y -> high (85% up from
// the bottom, since the pad's own y is flipped screen-space) — expect both
// att01 and att10 to read solidly positive afterward. ---
const firstSq = padSquares.nth(0);
await dragPad(firstSq, 0.5, 0.5, 0.85, 0.15);
const att01 = await readSetting("att01");
const att10 = await readSetting("att10");
report("drag-smell-att01", att01 > 0.3, `att01=${att01}`);
report("drag-smell-att10", att10 > 0.3, `att10=${att10}`);
const markerTransform = await pads.nth(0).locator(".vc-pad-marker").getAttribute("transform");
report("marker-moved", !!markerTransform && !/translate\(50 50\)/.test(markerTransform), `transform=${markerTransform}`);

// --- 3. Switch to Touch: diamonds + blue/orange tints, own-strip hidden. ---
const touchBtn = page.locator(".vc-pair-layer-touch");
const hasTouchLayer = (await touchBtn.count()) > 0;
report("has-touch-layer", hasTouchLayer, `count=${await touchBtn.count()}`);
if (hasTouchLayer) {
  await touchBtn.click();
  await page.waitForTimeout(300);
  const ownStripHidden = await page.evaluate(() => getComputedStyle(document.querySelector(".vc-own-strip")).display === "none");
  report("own-strip-hidden-on-touch", ownStripHidden, `hidden=${ownStripHidden}`);
  const markerShape = await pads.nth(0).locator(".vc-pad-marker path").count();
  report("touch-marker-is-diamond", markerShape >= 2, `path-count=${markerShape}`);
  await affinityBlock.screenshot({ path: `${outDir}/pairs-touch-1440.png` }).catch(() => {});
  console.log("shot", `${outDir}/pairs-touch-1440.png`);

  // Drag to bottom-left: both touch01 and touch10 negative (eating).
  await dragPad(firstSq, 0.5, 0.5, 0.15, 0.85);
  const touch01 = await readSetting("touch01");
  const touch10 = await readSetting("touch10");
  report("drag-touch-01-negative", touch01 < 0, `touch01=${touch01}`);
  report("drag-touch-10-negative", touch10 < 0, `touch10=${touch10}`);

  // Back to Smell for the remaining checks.
  await page.locator(".vc-pair-layer-smell").click();
  await page.waitForTimeout(300);
}

// --- 4. Tag a pad canvas, click a strain box, confirm the node survives and
// selection classes land on the right pads. ---
await page.evaluate(() => {
  document.querySelectorAll(".vc-pad-canvas")[0]?.setAttribute("data-tag", "pad0-canvas-marker");
});
const boxes = page.locator(".vc-item-box");
await boxes.nth(0).click(); // solo PP-A1
await page.waitForTimeout(300);
const tagSurvived = await page.evaluate(() => document.querySelectorAll(".vc-pad-canvas")[0]?.getAttribute("data-tag"));
report("pad-canvas-survives-selection", tagSurvived === "pad0-canvas-marker", `tag=${tagSurvived}`);
const padClasses = await pads.evaluateAll((els) => els.map((el) => ({ sel: el.classList.contains("vc-pad-sel"), dim: el.classList.contains("vc-pad-dim") })));
// pairsOf(4) = [[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]] — with PP-A1 (0) solo,
// pads 0/1/2 touch strain 0 and should be lit; pads 3/4/5 (strains 1,2,3
// only) should dim.
const expectSel = [true, true, true, false, false, false];
const selMatches = padClasses.every((c, i) => c.sel === expectSel[i] && c.dim === !expectSel[i]);
report("selection-dims-unrelated-pads", selMatches, JSON.stringify(padClasses));

// --- 5. Close and reopen the panel (a full rebuild) — pad canvases must be
// non-blank on the very first draw (the culture wasn't restarted). ---
await page.evaluate(() => document.getElementById("menuBtn")?.click()); // close
await page.waitForTimeout(300);
await openPanel();
await scrollToPairs();
await page.waitForTimeout(200); // one or two ticks, no extra warm-up
const pixelSum = await page.evaluate(() => {
  const canvas = document.querySelectorAll(".vc-pad-canvas")[0];
  if (!canvas || !canvas.width || !canvas.height) return -1;
  const c2 = canvas.getContext("2d");
  const data = c2.getImageData(0, 0, canvas.width, canvas.height).data;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
  return sum;
});
report("pad-culture-not-restarted", pixelSum > 0, `pixelSum=${pixelSum}`);

// --- 6. No console errors (ignore font 403s / the dev-only :8787 refusal). ---
const relevant = errors.filter((e) => !/ERR_CONNECTION_REFUSED/.test(e));
report("no-console-errors", relevant.length === 0, JSON.stringify(relevant));

// --- Phone-width screenshot, Smell layer — reload, not just resize: the
// stacked layout is a media-query breakpoint the app applies at load/reflow
// time (solocheck.mjs's own phone-screenshot section does the same). ---
await page.setViewportSize({ width: 390, height: 844 });
await page.reload();
await page.waitForTimeout(1500);
await openPanel();
await scrollToPairs();
await page.waitForTimeout(1500); // let the pads' cultures draw at least once
await affinityBlock.screenshot({ path: `${outDir}/pairs-smell-390.png` }).catch(() => {});
console.log("shot", `${outDir}/pairs-smell-390.png`);
const touchBtn390 = page.locator(".vc-pair-layer-touch");
if ((await touchBtn390.count()) > 0) {
  await touchBtn390.click();
  await page.waitForTimeout(300);
  await scrollToPairs();
  await affinityBlock.screenshot({ path: `${outDir}/pairs-touch-390.png` }).catch(() => {});
  console.log("shot", `${outDir}/pairs-touch-390.png`);
}

await browser.close();

const failed = Object.entries(results).filter(([, r]) => !r.ok);
console.log("\n=== SUMMARY ===");
console.log(`${Object.keys(results).length - failed.length}/${Object.keys(results).length} checks passed`);
if (failed.length) {
  console.log("FAILED:", failed.map(([name]) => name).join(", "));
  process.exit(1);
}
