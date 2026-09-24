// Kaleidoscope: opens the panel, clicks the Prism style chip, and reports
// whether the sibling rows re-rendered onto Prism's profile (Symmetry 6,
// Tiling 0.85); then drags Tiling, switches back to Mandala and to Prism
// again to confirm the profile is kept. Screenshots the panel each time.
// Written to check the scene's `variant` settings architecture (a style
// enum that gives every other setting a per-option profile).
// Rescued from a working session on 2026-09-05.
// usage: node panelvariant.mjs <outPrefix> [--port P]
// May need adjusting to current code — row/setting labels may have changed.
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));
const args = process.argv.slice(2);
const out = args[0];
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const port = opt("--port", "5197");
const browser = await chromium.launch({
  channel: "chromium",
  args: ["--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 500)));
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=124#/v/kaleidoscope`, { waitForLoad: "load" });
await page.waitForTimeout(2000);
await page.evaluate(() => document.querySelector("#menuBtn")?.click());
await page.waitForTimeout(600);

const rows = () => page.evaluate(() => {
  const read = (label) => {
    const el = [...document.querySelectorAll(".vc-label")].find((n) => n.textContent?.trim() === label);
    return el ? el.closest(".vc-row")?.textContent?.replace(/\s+/g, " ").slice(0, 60) : "(missing)";
  };
  return { style: read("Style"), symmetry: read("Symmetry"), tiling: read("Tiling"), zoom: read("Zoom"), ink: read("Ink") };
});
const clickStyle = (name) => page.evaluate((n) => {
  const strip = document.querySelector('.vc-picker[aria-label="Style"]');
  const chip = [...(strip?.children ?? [])].find((c) => c.textContent === n);
  chip?.click();
  return chip ? `clicked ${n}` : "no chip";
}, name);

console.log("mandala:", await rows());
console.log(await clickStyle("Prism"));
await page.waitForTimeout(500);
console.log("prism:", await rows());
await page.screenshot({ path: `${out}-prism.png` });
// Nudge Tiling on Prism via its slider element.
const nudged = await page.evaluate(() => {
  const el = [...document.querySelectorAll(".vc-label")].find((n) => n.textContent?.trim() === "Tiling");
  const input = el?.closest(".vc-row")?.querySelector('input[type="range"]');
  if (!input) return "no slider";
  input.value = "0.4";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return "tiling -> 0.4";
});
console.log(nudged);
await page.waitForTimeout(300);
console.log("prism after nudge:", await rows());
console.log(await clickStyle("Mandala"));
await page.waitForTimeout(400);
console.log("mandala again:", await rows());
console.log(await clickStyle("Prism"));
await page.waitForTimeout(400);
console.log("prism again:", await rows());
await page.screenshot({ path: `${out}-prism2.png` });
await browser.close();
console.log("PANELVARIANT_OK");
