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
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
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

// The Affinity block is its own card (WidgetCtx.mountCard, 2026-09-28) right
// after the Scene card, not a heading inside it — .vc-widget-card is the
// generic class mountCard adds so a script (or a second widget card) can
// find it without matching on title text, same reasoning as scrollToScene's
// own ".vc-card-head" match.
async function scrollToPairs() {
  await page.evaluate(() => {
    document.querySelector(".vc-widget-card")?.scrollIntoView({ block: "start" });
  });
  await page.waitForTimeout(250);
}

// The card (four rows, a six-pad grid with real air between them) is taller
// than the 1000px/844px viewports this script otherwise drives at — an
// element screenshot taller than the current viewport makes Playwright
// resize the viewport and re-lay-out before capturing, which drags this
// page's own position:fixed chrome (the fullscreen/close buttons, the
// footer dock) into the crop at whatever the resized viewport now puts them.
// Bumping the viewport height to fit the card first (then restoring it)
// avoids that reflow entirely, so the shot is exactly the card.
// Whichever ancestor actually clips the card differs by layout: the wide
// layout scrolls .vc-controls-col (its own `calc(100vh - 74px)` max-height,
// controlsTheme.ts), the stacked/narrow layout scrolls the page root instead
// (that same rule turns into `max-height: none` there). Rather than special-
// case either, this checks the one thing that actually matters — is the
// card's own last bit of content really PAINTED on screen — and grows the
// viewport until it is, so it self-corrects for whichever ancestor (or
// margin) is doing the clipping.
async function cardFullyPainted(locator) {
  return locator.evaluate((el) => {
    const last = el.querySelector(".vc-exp-hyp") || el.lastElementChild;
    if (!last) return true;
    const r = last.getBoundingClientRect();
    if (r.height === 0 || r.bottom > window.innerHeight || r.top < 0) return false;
    const x = Math.min(window.innerWidth - 1, Math.max(0, r.left + 2));
    const y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return !!hit && (hit === last || last.contains(hit) || el.contains(hit));
  });
}

async function screenshotWholeCard(locator, path, onReady) {
  const original = page.viewportSize();
  let height = original.height;
  for (let attempt = 0; attempt < 6; attempt++) {
    if (await cardFullyPainted(locator)) break;
    const box = await locator.boundingBox();
    height = Math.max(height + 200, box ? Math.ceil(box.height) + 150 : height + 200);
    await page.setViewportSize({ width: original.width, height });
    await scrollToPairs();
  }
  // The resize+rescroll above can carry a row out from under a mouse left
  // parked over it earlier (screen position moves; the cursor doesn't) —
  // onReady re-establishes anything hover-dependent right before the shot.
  if (onReady) await onReady();
  await locator.screenshot({ path }).catch(() => {});
  if (height !== original.height) {
    await page.setViewportSize(original);
    await scrollToPairs();
  }
}

async function openPanel() {
  // #menuBtn only exists once app.ts has finished booting — waited for
  // explicitly (rather than a fixed timeout) since gotoScene's re-entry
  // (after the "Escape unpins" check backs the app out to the gallery) can
  // land here before the button exists. Idempotent (checks .vc-open first)
  // rather than an unconditional click: `#/v/physarum2` is a same-document
  // hash navigation, not a real reload — the panel's own `isOpen` (and
  // everything else in JS memory) survives the gallery round trip, so a
  // blind click here would toggle an already-open panel *closed* instead.
  await page.waitForSelector("#menuBtn", { state: "visible", timeout: 15000 });
  const isOpen = await page.evaluate(() => document.querySelector(".vc-root")?.classList.contains("vc-open"));
  if (!isOpen) {
    await page.evaluate(() => document.getElementById("menuBtn")?.click());
    await page.waitForTimeout(500);
  }
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

// A bare Escape, live-tested below (the "Escape unpins" check), is also
// app.ts's own global "back out to the gallery" shortcut — a real key event
// reaches every keydown listener on document, not just deviceMenu's own, and
// neither ever calls stopPropagation. That's true of Escape on ANY pinned
// row, not something this card's own pin work introduced (verified against a
// plain Scene-card row too) — so every check after "Escape unpins" below
// re-enters the scene through this same URL rather than assuming the panel
// is still open on it.
const SCENE_URL = `https://localhost:${port}/?audio=synthetic&bpm=120#/v/physarum2`;
async function gotoScene() {
  await page.goto(SCENE_URL);
  await page.waitForTimeout(1500);
  await openPanel();
  await scrollToPairs();
}

await page.evaluate(() => {
  try {
    localStorage.clear();
  } catch {}
});
await gotoScene();
// Let the pads' cultures step for a bit before the first screenshot/pixel
// check, same reasoning as solocheck.mjs's own warm-up wait.
await page.waitForTimeout(3000);

const pads = page.locator(".vc-pads .vc-pad");
const padSquares = page.locator(".vc-pads .vc-pad-sq");
const padCount = await pads.count();
report("six-pads", padCount === 6, `count=${padCount}`);

// The Affinity card itself (title + body), for the "whole card" screenshots
// and the fold/pin/solo checks below — its four rows, in document order.
const affinityCard = page.locator(".vc-widget-card").first();
const affinityRows = affinityCard.locator(".vc-row");
const layerRowLoc = affinityRows.nth(0);
const mixRowLoc = affinityRows.nth(3);

// --- 1. Screenshots of the Affinity block, Smell layer, at 1440 and 390. ---
const affinityBlock = affinityCard;
await screenshotWholeCard(affinityBlock, `${outDir}/pairs-smell-1440.png`);
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

// --- 2b. The card wakes on hover/focus and pins on press, like every other
// row in the panel (2026-09-28 card work). The drag above already released
// its mouse-up over the same pad it went down on, which fires a real click —
// so the Pairs row (the pad's ancestor .vc-row) should already read pinned. ---
const pairsRowLoc = affinityRows.nth(2);
const pinnedAfterPadPress = await pairsRowLoc.evaluate((el) => el.classList.contains("vc-drive-pinned"));
report("pad-press-pins-pairs-row", pinnedAfterPadPress, `pinned=${pinnedAfterPadPress}`);

const mixBoxShadowIdle = await mixRowLoc.evaluate((el) => getComputedStyle(el).boxShadow);
await mixRowLoc.hover();
await page.waitForTimeout(200);
const mixBoxShadowHover = await mixRowLoc.evaluate((el) => getComputedStyle(el).boxShadow);
report("hover-wakes-row", mixBoxShadowHover !== mixBoxShadowIdle, `idle=${mixBoxShadowIdle} hover=${mixBoxShadowHover}`);

// One row pinned (Pairs, from the drag above) and a different row hovered
// (Mix) in the same shot.
await screenshotWholeCard(affinityBlock, `${outDir}/pairs-hover-pin-1440.png`, () => mixRowLoc.hover());
console.log("shot", `${outDir}/pairs-hover-pin-1440.png`);

await page.mouse.move(0, 0); // stop hovering the mix row before Escape
await page.keyboard.press("Escape");
await page.waitForTimeout(150);
const pinnedAfterEscape = await pairsRowLoc.evaluate((el) => el.classList.contains("vc-drive-pinned"));
report("escape-unpins-row", !pinnedAfterEscape, `pinned=${pinnedAfterEscape}`);
// That same Escape also backed the app out to the gallery (SCENE_URL's own
// comment) — re-enter before anything below assumes the render loop (and so
// the pads' own live cultures) is still running. `#/v/physarum2` is a
// same-document hash navigation, not a reload, so every earlier drag/setting
// and the device menu's own open/pinned state all survive the round trip
// untouched — openPanel() below is idempotent for exactly this reason.
await gotoScene();

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
  await screenshotWholeCard(affinityBlock, `${outDir}/pairs-touch-1440.png`);
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

// --- 4. Tag a pad canvas, click a strain box, confirm the node survives a
// selection change (the box selection no longer touches this widget at all,
// 2026-09-28 follow-up — see pairPads.ts's own header — so there's nothing
// left to check about pad classes here, only that nothing gets rebuilt). ---
await page.evaluate(() => {
  document.querySelectorAll(".vc-pad-canvas")[0]?.setAttribute("data-tag", "pad0-canvas-marker");
});
const boxes = page.locator(".vc-item-box");
await boxes.nth(0).click(); // solo PP-A1
await page.waitForTimeout(300);
const tagSurvived = await page.evaluate(() => document.querySelectorAll(".vc-pad-canvas")[0]?.getAttribute("data-tag"));
report("pad-canvas-survives-selection", tagSurvived === "pad0-canvas-marker", `tag=${tagSurvived}`);
const noSelectionStyling = await pads.evaluateAll((els) => els.every((el) => !el.classList.contains("vc-pad-sel") && !el.classList.contains("vc-pad-dim")));
report("no-selection-styling-on-pads", noSelectionStyling, `noSelectionStyling=${noSelectionStyling}`);

// --- Phase 3: Random / Nudge / Keep own trails / Back, wired against the
// real settings store — the padPads.ts mix row (physarum2-pairs-touch.md's
// Phase 3, §3.4). ---
async function readAllTables() {
  const smell = {};
  const touch = {};
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      smell[`att${i}${j}`] = await readSetting(`att${i}${j}`);
      if (i !== j) touch[`touch${i}${j}`] = await readSetting(`touch${i}${j}`);
    }
  }
  return { smell, touch };
}
function tablesClose(a, b, eps) {
  return Object.keys(a).every((k) => Math.abs((a[k] ?? 0) - (b[k] ?? 0)) < eps);
}
async function clickPreset(name) {
  await page.locator(".vc-exp-pill", { hasText: name }).first().click();
  await page.waitForTimeout(200);
}
async function clickMixButton(label) {
  await page.locator(".vc-pair .vc-mix-row button", { hasText: label }).first().click();
  await page.waitForTimeout(200);
}

const ATTRACT_ROWS = [
  [1.0, -0.85, -1.1, -0.7],
  [-1.2, 1.1, -0.6, -0.95],
  [-0.75, -1.05, 0.9, -1.25],
  [-1.0, -0.65, -1.15, 1.05],
];

// War: all 12 touch keys land at -0.9, att matches ATTRACT_ROWS exactly
// (Rivals' own smell table), and the War pill reads pressed.
const preWar = await readAllTables();
await clickPreset("War");
const postWar = await readAllTables();
const warTouchOk = Object.values(postWar.touch).every((v) => Math.abs(v - -0.9) < 0.02);
report("war-touch-all-minus-0.9", warTouchOk, JSON.stringify(postWar.touch));
let attOk = true;
for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (Math.abs(postWar.smell[`att${i}${j}`] - ATTRACT_ROWS[i][j]) > 0.02) attOk = false;
report("war-att-equals-attract-rows", attOk, JSON.stringify(postWar.smell));
const warPillPressed = await page.locator(".vc-exp-pill", { hasText: "War" }).first().getAttribute("aria-pressed");
report("war-pill-pressed", warPillPressed === "true", `aria-pressed=${warPillPressed}`);

// Back: the pre-War values return exactly (within a slider round-trip's own
// tolerance — the same eps tablesMatch itself uses).
await clickMixButton("Back");
const postBack = await readAllTables();
report("back-restores-pre-war-smell", tablesClose(preWar.smell, postBack.smell, 0.011), JSON.stringify({ pre: preWar.smell, post: postBack.smell }));
report("back-restores-pre-war-touch", tablesClose(preWar.touch, postBack.touch, 0.011), JSON.stringify({ pre: preWar.touch, post: postBack.touch }));

// The Strains card's one Random (itemBoxes.ts, 2026-10-03): Smell and Touch
// both move, every rolled Touch value is quantised, and the 12-cell Touch
// roll landed at least one zero and one non-zero (the exact ~35% zero share
// is the unit test's job, physarum2Affinity.test.ts). The Pairs card's Back
// then undoes just its half.
const preRandom = await readAllTables();
await page.locator(".vc-roll").click();
await page.waitForTimeout(200);
const postRandom = await readAllTables();
report("random-moves-smell", !tablesClose(preRandom.smell, postRandom.smell, 1e-6), "");
const touchVals = Object.values(postRandom.touch);
const onGrid = touchVals.every((v) => Math.abs(v / 0.05 - Math.round(v / 0.05)) < 1e-6);
report("random-touch-on-0.05-grid", onGrid, JSON.stringify(touchVals));
report("random-touch-has-zero-and-nonzero", touchVals.some((v) => v === 0) && touchVals.some((v) => v !== 0), JSON.stringify(touchVals));
await clickMixButton("Back");
const postRandomBack = await readAllTables();
report("back-undoes-random-smell", tablesClose(preRandom.smell, postRandomBack.smell, 0.011), "");

// Nudge with Keep own trails on Smell: every diagonal (own-trail) cell is
// unchanged; at least one off-diagonal cell moved (Nudge actually ran).
// Read the diagonal from the own-trail faders' own live display (.vc-own-val,
// `tick()`'s own `fmtSigned(getVal(...))` text), not raw localStorage: a
// diagonal cell at exactly its default never gets a stored key at all
// (`sceneSettings.ts` only persists a value once it's actually set), so an
// untouched-by-War-or-Random-or-Back diagonal reads back as `undefined` from
// storage even though the live resolved value is well-defined.
async function readOwnTrailValues() {
  const strs = await page.locator(".vc-own-val").allTextContents();
  return strs.map((s) => (s.trim().startsWith("−") ? -1 : 1) * parseFloat(s.trim().slice(1)));
}
await page.locator(".vc-pair-layer-smell").click();
await page.waitForTimeout(200);
const keepOwnBtn = page.locator(".vc-pair .vc-mix-row button", { hasText: "Keep own trails" });
if ((await keepOwnBtn.getAttribute("aria-pressed")) !== "true") await keepOwnBtn.click();
await page.waitForTimeout(150);
const preNudgeDiag = await readOwnTrailValues();
const preNudge = await readAllTables();
await clickMixButton("Nudge");
await page.waitForTimeout(150); // let a tick refresh .vc-own-val from the new stored values
const postNudgeDiag = await readOwnTrailValues();
const postNudge = await readAllTables();
const diagUnchanged = preNudgeDiag.every((v, i) => Math.abs(v - postNudgeDiag[i]) < 0.02);
report("nudge-keepown-diagonal-unchanged", diagUnchanged, JSON.stringify({ pre: preNudgeDiag, post: postNudgeDiag }));
const offDiagChanged = [];
for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (i !== j && Math.abs(preNudge.smell[`att${i}${j}`] - postNudge.smell[`att${i}${j}`]) > 1e-9) offDiagChanged.push(`att${i}${j}`);
report("nudge-changed-some-off-diagonal", offDiagChanged.length > 0, JSON.stringify(offDiagChanged));

// --- Main-scene screenshots, 8s after pressing War / Hunt / Gardens through
// the real panel UI (not URL overrides) — physarum2-pairs-touch.md's Phase 4
// asks for these alongside the panel shots below. ---
async function screenshotSceneAfterPreset(name, fileSuffix) {
  await clickPreset(name);
  await page.evaluate(() => document.getElementById("menuBtn")?.click()); // close, an unobstructed shot
  await page.waitForTimeout(300);
  await page.waitForTimeout(8000);
  const file = `${outDir}/scene-${fileSuffix}.png`;
  await page.screenshot({ path: file }).catch(() => {});
  console.log("shot", file);
  await openPanel();
  await scrollToPairs();
  await page.waitForTimeout(200);
}
await screenshotSceneAfterPreset("War", "war");
await screenshotSceneAfterPreset("Hunt", "hunt");
await screenshotSceneAfterPreset("Gardens", "gardens");

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

// --- 7. Solo: pin the Layer row via a plain background press (away from its
// switch buttons — isCardPress's own "press anywhere on the row" rule), turn
// Solo on (O), confirm a top-level sibling column (Power/Bands+meters) is
// hidden while the Affinity card itself (on the path to the pinned row)
// isn't, then turn Solo back off and unpin. Run after every check that reads
// a pill/button inside this card (Solo hides every row but the pinned one). ---
await scrollToPairs();
await layerRowLoc.click({ position: { x: 6, y: 6 } });
await page.waitForTimeout(150);
const layerPinned = await layerRowLoc.evaluate((el) => el.classList.contains("vc-drive-pinned"));
report("layer-row-pins-on-background-press", layerPinned, `pinned=${layerPinned}`);
await page.keyboard.press("o");
await page.waitForTimeout(300);
// applySolo() marks the whole .vc-cols-wrap (Power + Bands/meters) hidden as
// one unit rather than recursing into it — .vc-power-col itself never gets
// the class (it doesn't need to; an ancestor already carries it), so that's
// the element to check, not .vc-power-col directly.
const colsWrapHiddenUnderSolo = await page.evaluate(() => !!document.querySelector(".vc-cols-wrap.vc-solo-hidden"));
const affinityCardHiddenUnderSolo = await affinityCard.evaluate((el) => el.classList.contains("vc-solo-hidden"));
report(
  "solo-hides-rest-of-panel-not-pinned-card",
  colsWrapHiddenUnderSolo && !affinityCardHiddenUnderSolo,
  `colsWrapHidden=${colsWrapHiddenUnderSolo} cardHidden=${affinityCardHiddenUnderSolo}`,
);
await page.keyboard.press("o"); // solo off
await page.waitForTimeout(200);
// Left pinned on purpose — Escape (as proven above) also backs the app out
// to the gallery, which the Fold check below doesn't need to deal with; the
// fold chevron isn't inside a .vc-row, so pin state doesn't affect it.

// --- 8. Fold persistence: folding the Affinity card, closing the panel and
// reopening it (a full renderSceneSettings rebuild) must leave it folded —
// panelFolds.ts's own localStorage-backed persistence, the same mechanism
// every other card's fold already relies on. ---
await affinityCard.locator(".vc-fold").click();
await page.waitForTimeout(150);
const foldedBeforeReopen = await affinityCard.evaluate((el) => el.classList.contains("vc-folded"));
report("affinity-card-folds", foldedBeforeReopen, `folded=${foldedBeforeReopen}`);
await page.evaluate(() => document.getElementById("menuBtn")?.click()); // close
await page.waitForTimeout(300);
await openPanel();
await scrollToPairs();
const foldedAfterReopen = await page.locator(".vc-widget-card").first().evaluate((el) => el.classList.contains("vc-folded"));
report("affinity-card-fold-persists-across-reopen", foldedAfterReopen, `folded=${foldedAfterReopen}`);
// Unfold again — the phone-width section below expects the card open.
await page.locator(".vc-widget-card .vc-fold").first().click();
await page.waitForTimeout(150);

// --- Phone-width screenshot, Smell layer — reload, not just resize: the
// stacked layout is a media-query breakpoint the app applies at load/reflow
// time (solocheck.mjs's own phone-screenshot section does the same). ---
await page.setViewportSize({ width: 390, height: 844 });
await page.reload();
await page.waitForTimeout(1500);
await openPanel();
await scrollToPairs();
await page.waitForTimeout(1500); // let the pads' cultures draw at least once
await screenshotWholeCard(affinityBlock, `${outDir}/pairs-smell-390.png`);
console.log("shot", `${outDir}/pairs-smell-390.png`);
const touchBtn390 = page.locator(".vc-pair-layer-touch");
if ((await touchBtn390.count()) > 0) {
  await touchBtn390.click();
  await page.waitForTimeout(300);
  await scrollToPairs();
  await screenshotWholeCard(affinityBlock, `${outDir}/pairs-touch-390.png`);
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
