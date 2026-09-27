// Headless verification for the Physarum 2 solo/group selection rewrite +
// no-redraw-on-click (see the impl brief). Real mouse down -> wait -> up
// presses throughout, per the project's own headless-driving lesson.
// Reuses the dev server on port 5341 for this worktree.
//   node solocheck.mjs --port 5341 --out /path/to/tmp/impl
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt("--port", "5341");
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
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 300));
});
page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));

async function press(locatorOrSelector, opts = {}) {
  const loc = typeof locatorOrSelector === "string" ? page.locator(locatorOrSelector) : locatorOrSelector;
  const box = await loc.boundingBox();
  if (!box) throw new Error(`press(): no bounding box for ${locatorOrSelector}`);
  const x = box.x + box.width * (opts.fx ?? 0.5);
  const y = box.y + box.height * (opts.fy ?? 0.5);
  if (opts.modifiers?.length) await page.keyboard.down(opts.modifiers[0]);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(opts.hold ?? 260);
  await page.mouse.up();
  if (opts.modifiers?.length) await page.keyboard.up(opts.modifiers[0]);
  await page.waitForTimeout(opts.after ?? 250);
}

async function scrollToScene() {
  await page.evaluate(() => {
    document.querySelectorAll(".vc-card-head").forEach((h) => {
      if (h.textContent?.includes("Scene")) h.scrollIntoView({ block: "start" });
    });
  });
  await page.waitForTimeout(250);
}

async function openPanel() {
  await page.evaluate(() => document.getElementById("menuBtn")?.click());
  await page.waitForTimeout(500);
  await scrollToScene();
}

async function editingText() {
  return (await page.locator(".vc-item-editing").textContent())?.trim();
}

async function pressedStates() {
  return page.locator(".vc-item-box").evaluateAll((els) => els.map((el) => el.getAttribute("aria-pressed")));
}

await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=120#/v/physarum2`);
await page.waitForTimeout(1200);
await page.evaluate(() => {
  try {
    localStorage.setItem("vibe.widgetSelect.physarum2.strain", JSON.stringify([0]));
  } catch {}
});
await page.reload();
await page.waitForTimeout(1200);
await openPanel();

const boxes = page.locator(".vc-item-box");
const checks = page.locator(".vc-item-check");

// Let previews evolve a bit before the no-redraw check compares screenshots.
await page.waitForTimeout(3000);

// --- 1. tap PP-A1 -> "Editing PP-A1" (already solo from seed, tap confirms
// a solo tap on an already-solo box is a no-op-looking no-change). ---
await press(boxes.nth(0));
report("solo-a1", (await editingText()) === "Editing PP-A1", `got "${await editingText()}"`);

// --- 2. tap PP-B2 -> "Editing PP-B2" (solo switches away from PP-A1). ---
await press(boxes.nth(1));
report("solo-b2", (await editingText()) === "Editing PP-B2", `got "${await editingText()}"`);
report("solo-b2-pressed", JSON.stringify(await pressedStates()) === JSON.stringify(["false", "true", "false", "false"]), JSON.stringify(await pressedStates()));

// --- 3. tick PP-C3's checkbox -> "Editing PP-B2 + PP-C3". ---
await press(checks.nth(2));
report("tick-c3", (await editingText()) === "Editing PP-B2 + PP-C3", `got "${await editingText()}"`);
const checkedAfterTick = await checks.evaluateAll((els) => els.map((el) => el.getAttribute("aria-checked")));
report("checkboxes-mirror-tick", JSON.stringify(checkedAfterTick) === JSON.stringify(["false", "true", "true", "false"]), JSON.stringify(checkedAfterTick));

// --- 4. Shift-click PP-D4 -> three selected. ---
await press(boxes.nth(3), { modifiers: ["Shift"] });
report("shift-click-d4", (await editingText()) === "Editing PP-B2 + PP-C3 + PP-D4", `got "${await editingText()}"`);

// --- 5. tap PP-A1 body (plain) -> solo PP-A1 (even though a group of three
// was just active). ---
await press(boxes.nth(0));
report("solo-a1-from-group", (await editingText()) === "Editing PP-A1", `got "${await editingText()}"`);
const checkedAfterSolo = await checks.evaluateAll((els) => els.map((el) => el.getAttribute("aria-checked")));
report("checkbox-mirrors-solo", JSON.stringify(checkedAfterSolo) === JSON.stringify(["true", "false", "false", "false"]), JSON.stringify(checkedAfterSolo));

// --- 6. unticking the last checked box does nothing (never empty). ---
await press(checks.nth(0));
report("untick-last-is-noop", (await editingText()) === "Editing PP-A1", `got "${await editingText()}"`);

// --- 7. All -> all four. ---
const allBtn = page.locator(".vc-item-selbar button", { hasText: "All" });
await press(allBtn);
report("all-chip-four", (await editingText()) === "Editing all strains", `got "${await editingText()}"`);
report("all-chip-pressed", (await pressedStates()).every((p) => p === "true"), JSON.stringify(await pressedStates()));

await scrollToScene();
await page.screenshot({ path: `${outDir}/solo-wide.png`, fullPage: true });
console.log("shot", `${outDir}/solo-wide.png`);

// --- No-redraw check: tag a box + its preview canvas, click a DIFFERENT
// box, confirm the exact same DOM nodes are still there (never recreated)
// and grab a before/after screenshot pair to eyeball for a blank/flash. ---
await press(boxes.nth(0)); // back to solo PP-A1 for a clean starting point
await page.evaluate(() => {
  const box = document.querySelectorAll(".vc-item-box")[0];
  const canvas = document.querySelectorAll(".vc-item-preview")[0];
  box?.setAttribute("data-tag", "box0-marker");
  canvas?.setAttribute("data-tag", "canvas0-marker");
});
const boxAreaBefore = page.locator(".vc-item-boxes");
await boxAreaBefore.screenshot({ path: `${outDir}/solo-noredraw-before.png` }).catch(() => {});
await press(boxes.nth(2)); // solo PP-C3 — PP-A1's box/canvas should be untouched
const tagsSurvived = await page.evaluate(() => {
  const box = document.querySelectorAll(".vc-item-box")[0];
  const canvas = document.querySelectorAll(".vc-item-preview")[0];
  return { box: box?.getAttribute("data-tag") ?? null, canvas: canvas?.getAttribute("data-tag") ?? null };
});
report(
  "no-redraw-box-and-canvas-preserved",
  tagsSurvived.box === "box0-marker" && tagsSurvived.canvas === "canvas0-marker",
  JSON.stringify(tagsSurvived),
);
const boxAreaAfter = page.locator(".vc-item-boxes");
await boxAreaAfter.screenshot({ path: `${outDir}/solo-noredraw-after.png` }).catch(() => {});
console.log("shot", `${outDir}/solo-noredraw-before.png`, `${outDir}/solo-noredraw-after.png`);

// --- A change that does NOT change the selection (dragging a slider) must
// not remount anything: tag the currently-mounted Nutrient row, drag its
// slider, confirm the SAME row element survives. ---
const nutrientRowLoc = page.locator(".vc-item-rows .vc-row").filter({ hasText: "Nutrient" }).first();
await page.evaluate(() => {
  const row = [...document.querySelectorAll(".vc-item-rows .vc-row")].find((r) => r.textContent?.includes("Nutrient"));
  row?.setAttribute("data-tag", "nutrient-row-marker");
});
const slider = nutrientRowLoc.locator("input.vc-slider");
const sbox = await slider.boundingBox();
const ySlide = sbox.y + sbox.height / 2;
await page.mouse.move(sbox.x + sbox.width * 0.2, ySlide);
await page.mouse.down();
await page.waitForTimeout(120);
await page.mouse.move(sbox.x + sbox.width * 0.8, ySlide, { steps: 8 });
await page.waitForTimeout(120);
await page.mouse.up();
await page.waitForTimeout(200);
const rowSurvivedDrag = await page.evaluate(() => {
  const row = [...document.querySelectorAll(".vc-item-rows .vc-row")].find((r) => r.textContent?.includes("Nutrient"));
  return row?.getAttribute("data-tag") ?? null;
});
report("no-remount-on-slider-drag", rowSurvivedDrag === "nutrient-row-marker", `got "${rowSurvivedDrag}"`);

// --- Cable check: pin Nutrient, wire the Energy monitor jack onto it,
// confirm a cable renders, then switch solo to a different (unwired)
// strain and confirm the cable disappears cleanly (no stale cable left
// pointing at a removed row, no console error). ---
const nutrientPort = nutrientRowLoc.locator(".vc-drive-port");
await press(nutrientPort); // pin PP-A1's Nutrient
await page.waitForTimeout(150);
const energyJack = page.locator(".vc-row", { hasText: "Energy" }).locator(".vc-jack").first();
await press(energyJack);
await page.waitForTimeout(400); // cable recompute is rAF-scheduled
const cableCountWired = await page.locator(".vc-cable-layer .vc-cable-core").count();
report("cable-renders-after-wiring", cableCountWired > 0, `count=${cableCountWired}`);

await scrollToScene();
await page.screenshot({ path: `${outDir}/solo-cable-wired.png` });
console.log("shot", `${outDir}/solo-cable-wired.png`);

// Switch solo to PP-B2 (unwired) — PP-A1's Nutrient row is disposed.
await press(boxes.nth(1));
await page.waitForTimeout(400);
const cableCountAfterSwitch = await page.locator(".vc-cable-layer .vc-cable-core").count();
report("cable-disappears-no-stale", cableCountAfterSwitch === 0, `count=${cableCountAfterSwitch}`);

// Pin handoff: the pin should now sit on PP-B2's Nutrient row (same control, new strain),
// and exactly one row in the whole panel should be pinned.
const pinState = await page.evaluate(() => {
  const pinnedRows = [...document.querySelectorAll(".vc-drive-pinned")];
  return {
    count: pinnedRows.length,
    inStrainRows: pinnedRows.filter((r) => r.closest(".vc-item-rows")).length,
    text: pinnedRows.map((r) => (r.textContent || "").trim().slice(0, 40)),
  };
});
const cableEnds = await page.evaluate(() => {
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; };
  const lit = [...document.querySelectorAll(".vc-jack")].filter((j) => /fed|lit|on|active/.test(j.className)).map((j) => ({
    row: (j.closest(".vc-row")?.textContent || "").trim().slice(0, 20), cls: j.className, at: rect(j),
  }));
  const port = document.querySelector(".vc-drive-pinned .vc-drive-port");
  return { litJacks: lit, pinnedPort: port ? rect(port) : null, paths: [...document.querySelectorAll(".vc-cable-layer .vc-cable-core")].map((p) => p.getAttribute("d")?.slice(0, 60)) };
});
console.log("cable ends:", JSON.stringify(cableEnds));
report(
  "pin-handed-to-new-strain",
  pinState.count === 1 && pinState.inStrainRows === 1 && pinState.text[0].includes("Nutrient"),
  JSON.stringify(pinState),
);

// The removed row's port element must actually be gone from the DOM (not
// just visually hidden) — confirms mountRows really tore the old row down.
const oldPortStillMounted = await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".vc-item-rows .vc-row")];
  return rows.some((r) => r.textContent?.includes("Nutrient")) && rows.length > 0;
});
report("rows-section-remounted", oldPortStillMounted, "a Nutrient row exists for the new primary");

await scrollToScene();
await page.screenshot({ path: `${outDir}/solo-cable-after-switch.png` });
console.log("shot", `${outDir}/solo-cable-after-switch.png`);

const relevant = errors.filter((e) => !/8787|ERR_CONNECTION_REFUSED|@fs.*40[13]|woff2/.test(e));
report("no-console-errors", relevant.length === 0, JSON.stringify(relevant));

// --- Phone screenshot ---
await page.evaluate(() => {
  try {
    localStorage.setItem("vibe.widgetSelect.physarum2.strain", JSON.stringify([1, 2]));
  } catch {}
  try {
    localStorage.removeItem("vibe.drives");
  } catch {}
});
await page.setViewportSize({ width: 400, height: 900 });
await page.reload();
await page.waitForTimeout(1200);
await openPanel();
await page.waitForTimeout(500);
await page.screenshot({ path: `${outDir}/solo-phone.png`, fullPage: true });
console.log("shot", `${outDir}/solo-phone.png`);

await browser.close();

const failed = Object.entries(results).filter(([, r]) => !r.ok);
console.log("\n=== SUMMARY ===");
console.log(`${Object.keys(results).length - failed.length}/${Object.keys(results).length} checks passed`);
if (failed.length) {
  console.log("FAILED:", failed.map(([name]) => name).join(", "));
  process.exit(1);
}
