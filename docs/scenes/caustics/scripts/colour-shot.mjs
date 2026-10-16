// Shoots Caustics under each palette at each Colour option (colourStyle),
// all from one page so the frames sit seconds apart, for a contact sheet
// made with colour-sheet.py. Used for the 2026-10-15 colour work.
// usage: node colour-shot.mjs <outDir> [--port P] --palettes a,b [--options 0,1,2] [--settings JSON]
// Writes <outDir>/<palette>-<option>.png. Needs a dev server on P and
// __viz.setPalette (app.ts, dev builds only).
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));
import { mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const OUT = args[0];
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const PORT = opt("port", "5173");
const OPTIONS = opt("options", "0,1,2").split(",").map(Number);
const extra = JSON.parse(opt("settings", "{}"));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  channel: "chromium",
  args: [
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--enable-gpu",
    "--use-angle=metal",
    "--enable-gpu-rasterization",
    "--ignore-gpu-blocklist",
  ],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 960, height: 540 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror", String(e)));
await page.goto(`https://localhost:${PORT}/?audio=synthetic&bpm=120#/v/caustics`);
await page.waitForTimeout(5000);
const ids = opt("palettes", "neon").split(",");
for (const id of ids) {
  await page.evaluate((p) => window.__viz.setPalette(p), id);
  for (const o of OPTIONS) {
    await page.evaluate((s) => window.__viz.setParams({ scene: "caustics", autoPin: true, settings: s }), { ...extra, colourStyle: o });
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${OUT}/${id}-${o}.png` });
  }
}
await browser.close();
