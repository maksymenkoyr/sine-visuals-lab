// Drives the Strain Console's Knobs tab headless: drags one knob right, up,
// diagonally, with Shift and with Alt, and prints the values it lands on;
// screenshots mid-drag so the active highlight and default ticks show.
//   node knobcheck.mjs <out.png>
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));

const out = process.argv[2] ?? "knobs.png";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(new URL("../artifacts/strain-console.html", import.meta.url).href);
await page.waitForFunction(() => window.strainConsole);
await page.click("#tab-knobs");
const V = () => page.evaluate(() => window.strainConsole.V.nutrient.map((v) => v.toFixed(3)).join(" "));
const knob = page.locator(".knob").first(); // Nutrient, A1
const box = await knob.boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
async function drag(dx, dy, mods = [], shot = false) {
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 10 });
  if (shot) await page.locator("#knobsCard").screenshot({ path: out });
  await page.mouse.up();
  for (const m of mods) await page.keyboard.up(m);
}
const reset = () => page.evaluate(() => { window.strainConsole.V.nutrient.splice(0, 4, 0.5, 0.5, 0.5, 0.5); });
await reset(); await drag(28, 0); console.log("right 28px   ", await V());
await reset(); await drag(0, -28); console.log("up 28px      ", await V());
await reset(); await drag(-28, 0); console.log("left 28px    ", await V());
await reset(); await drag(14, -14); console.log("up-right 14+14", await V());
await reset(); await drag(28, 0, ["Shift"]); console.log("right 28 Shift", await V());
await reset(); await drag(28, 0, ["Alt"], true); console.log("right 28 Alt  ", await V());
console.log(errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
await browser.close();
