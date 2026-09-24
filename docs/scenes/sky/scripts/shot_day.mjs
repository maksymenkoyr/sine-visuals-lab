// Sky: screenshots the scene at a series of Time of day values with Day
// drift held at 0, via window.__viz.setParams.
// Rescued from a working session on 2026-09-24.
// usage: node shot_day.mjs [port] [outPrefix] [times csv]
// May need adjusting to current code — setting names (timeOfDay, dayDrift).
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = process.argv[2] || "5222";
const outPrefix = process.argv[3] || join(tmpdir(), "sky-day");
const times = (process.argv[4] || "0.02,0.2,0.26,0.35,0.5,0.62,0.71,0.76,0.8,0.9").split(",").map(Number);

const browser = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader"],
});
const page = await (await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } })).newPage();
page.on("pageerror", (err) => console.log("PAGE EXCEPTION:", err.message));
page.on("console", (msg) => {
  if (msg.type() === "error" && !msg.text().includes("Failed to load")) console.log("CONSOLE ERROR:", msg.text());
});
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=120#/v/sky`, { waitUntil: "load" });
await page.waitForTimeout(3000);
for (const t of times) {
  await page.evaluate((tod) => window.__viz.setParams({ scene: "sky", settings: { timeOfDay: tod, dayDrift: 0 } }), t);
  await page.waitForTimeout(1800);
  const path = `${outPrefix}-${t.toFixed(2)}.png`;
  await page.screenshot({ path });
  console.log(path);
}
await browser.close();
