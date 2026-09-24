// Burst-screenshots Caustics with Beat flash following hits (flashLevel 0)
// vs level (flashLevel 1) and prints each frame's mean luminance, so the
// difference over a beat is a number, not an impression.
// Rescued from a working session on 2026-09-21.
// usage: node flash-shot.mjs [port] [outDir]
// May need adjusting to current code — setting names (flash, flashLevel,
// drift, ripple, sparkle, dropReactivity) may have changed.
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = process.argv[2] ?? "5173";
const OUT = process.argv[3] ?? join(tmpdir(), "shots-flash-level");
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
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`https://localhost:${PORT}/?audio=synthetic&bpm=120#/v/caustics`);
await page.waitForTimeout(4000);

async function lum(buf) {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = 96;
    c.height = 54;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return s / (d.length / 4) / 255;
  }, buf.toString("base64"));
}

const base = { flash: 1, drift: 0, ripple: 0, sparkle: 0, dropReactivity: 0 };
for (const [name, flashLevel] of [["before-hits", 0], ["after-level", 1]]) {
  await page.evaluate((settings) => window.__viz.setParams({ scene: "caustics", autoPin: true, settings }), { ...base, flashLevel });
  await page.waitForTimeout(1500);
  const lums = [];
  for (let i = 0; i < 14; i++) {
    const buf = await page.screenshot({ path: i === 0 || i === 7 ? `${OUT}/${name}-${i}.png` : undefined });
    lums.push(await lum(buf));
    await page.waitForTimeout(45);
  }
  const min = Math.min(...lums), max = Math.max(...lums);
  console.log(name, "lum", lums.map((v) => v.toFixed(3)).join(" "), "| min", min.toFixed(3), "max", max.toFixed(3), "swing", (max - min).toFixed(3));
}
console.log("page errors:", errors.length ? errors : "none");
await browser.close();
