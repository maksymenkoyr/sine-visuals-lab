// Sky: screenshots the scene repeatedly at a fixed interval, for watching
// how the look evolves over a longer stretch (drift, floater spawn, etc).
// Rescued from a working session on 2026-09-23.
// usage: node shot_series.mjs [port] [outPrefix] [count] [gapMs]
// May need adjusting to current code.
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = process.argv[2] || "5222";
const outPrefix = process.argv[3] || join(tmpdir(), "sky-series");
const count = Number(process.argv[4] || 8);
const gapMs = Number(process.argv[5] || 3000);

const browser = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.on("pageerror", (err) => console.log("PAGE EXCEPTION:", err.message));
page.on("console", (msg) => {
  if (msg.type() === "error" && !msg.text().includes("Failed to load")) console.log("CONSOLE ERROR:", msg.text());
});
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=120#/v/sky`, { waitUntil: "load" });
const t0 = Date.now();
for (let i = 0; i < count; i++) {
  await page.waitForTimeout(gapMs);
  const path = `${outPrefix}-${i}.png`;
  await page.screenshot({ path });
  console.log(`${path} at ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
await browser.close();
