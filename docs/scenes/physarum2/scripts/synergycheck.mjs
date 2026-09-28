// Checks the Strain Console's stain Synergy headless: at 0 the shown stains
// are what was set; at 1 they sit exactly on a harmony; a stain set by hand
// stays put while the others move; 0.5 lands halfway. Screenshots both
// layouts' Synergy rows.
//   node synergycheck.mjs <out-prefix>
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));

const prefix = process.argv[2] ?? "synergy";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(new URL("../artifacts/strain-console.html", import.meta.url).href);
await page.waitForFunction(() => window.strainConsole);
const state = () => page.evaluate(() => {
  const c = window.strainConsole, deg = (h) => Math.round(h * 360);
  const shown = c.V.stain.map(deg), raw = c.rawStain.map(deg);
  const sorted = [...c.V.stain].sort((a, b) => a - b);
  const gaps = sorted.map((h, i) => Math.round(((sorted[(i + 1) % 4] - h + 1) % 1) * 360));
  return `shown ${shown.join("/")}  set ${raw.join("/")}  gaps ${gaps.join("/")}  ${c.harmony().name}`;
});
console.log("synergy 0        ", await state());
await page.evaluate(() => window.strainConsole.setSynergy(1));
console.log("synergy 1        ", await state());
await page.evaluate(() => window.strainConsole.setStain(0, 0.5));
console.log("1, A1 set to 180 ", await state());
await page.evaluate(() => window.strainConsole.setStain(2, 0.3));
console.log("1, C3 set to 108 ", await state());
await page.evaluate(() => window.strainConsole.setSynergy(0.5));
console.log("synergy 0.5      ", await state());
await page.evaluate(() => window.strainConsole.setSynergy(0.8));
await page.waitForTimeout(300);
const lanesSyn = page.locator("#laneRows .row").last();
await lanesSyn.scrollIntoViewIfNeeded();
await lanesSyn.hover();
await page.waitForTimeout(400);
const stainRow = page.locator("#laneRows .row").nth(-2);
const a = await stainRow.boundingBox(), b = await lanesSyn.boundingBox();
await page.screenshot({ path: `${prefix}-lanes.png`, clip: { x: a.x - 14, y: a.y - 8, width: a.width + 28, height: b.y + b.height - a.y + 16 } });
await page.click("#tab-knobs");
// Grab B2's stain knob (not the anchor, so Synergy has moved it) and drag
// 7 px right: it should move ~18° from where it was shown, not jump first.
const b2 = page.locator(".knob").nth(7 * 4 + 1);
const kb = await b2.boundingBox();
const before = await page.evaluate(() => window.strainConsole.V.stain[1] * 360);
await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2);
await page.mouse.down();
await page.mouse.move(kb.x + kb.width / 2 + 7, kb.y + kb.height / 2, { steps: 4 });
await page.mouse.up();
const after = await page.evaluate(() => window.strainConsole.V.stain[1] * 360);
console.log(`B2 knob drag 7px: shown ${before.toFixed(1)}° -> ${after.toFixed(1)}° (expect +18°)`);
await page.locator("#knobsCard").screenshot({ path: `${prefix}-knobs.png` });
console.log(errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
await browser.close();
