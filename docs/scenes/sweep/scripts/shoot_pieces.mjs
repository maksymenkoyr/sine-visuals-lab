// node docs/scenes/sweep/scripts/shoot_pieces.mjs docs/scenes/sweep/scripts/pieces.json <outDir> --port P [--wait MS] [--size WxH] [--only Name,Name]
// (with `npm run dev` running on P; pair the shots with the reel with pair_pieces.py)
// Applies each piece's knob set (over the scene's defaults) with its own path
// seed, waits, and screenshots ours as <outDir>/<i>-<name>.png.
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const pieces = JSON.parse(readFileSync(args[0], "utf8"));
const out = args[1];
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt("--port", "5241");
const wait = +opt("--wait", "4000");
const [w, h] = opt("--size", "720x720").split("x").map(Number);
const only = opt("--only", null);

const browser = await chromium.launch({
  channel: "chromium",
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: w, height: h } });
const page = await ctx.newPage();
const errs = [];
page.on("console", (m) => {
  if (/shader|compile|ERROR:/i.test(m.text())) errs.push(m.text().slice(0, 500));
});
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=120#/v/sweep`);
await page.waitForTimeout(2500);
const defaults = await page.evaluate(() => {
  const p = window.__viz.probe();
  return Object.fromEntries(Object.entries(p.settings).map(([k, v]) => [k, v.base]));
});
for (const [i, piece] of pieces.entries()) {
  if (only && !only.split(",").includes(piece.name)) continue;
  const settings = { ...defaults, ...piece.s, newPath: 0, path: 100 + i };
  await page.evaluate((s) => window.__viz.setParams({ scene: "sweep", autoPin: true, settings: s }), settings);
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${out}/${i}-${piece.name}.png` });
}
const scene = await page.evaluate(() => window.__viz.probe().scene);
console.log("scene", scene, errs.length ? errs.join("\n") : "no shader errors");
await browser.close();
