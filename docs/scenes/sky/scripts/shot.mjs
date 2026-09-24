// Sky: loads the scene and takes three screenshots (early / later / latest)
// at fixed wait intervals, logging every console message and page
// exception — a basic load/render check.
// Rescued from a working session on 2026-09-23.
// usage: node shot.mjs [port] [outPrefix] [waitMs]
// May need adjusting to current code.
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = process.argv[2] || "5183";
const outPrefix = process.argv[3] || join(tmpdir(), "sky-v2");
const waitMs = Number(process.argv[4] || 15000);

const browser = await chromium.launch({
  args: [
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--enable-unsafe-swiftshader",
  ],
});
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.on("console", (msg) => {
  console.log(`CONSOLE[${msg.type()}]:`, msg.text());
});
page.on("pageerror", (err) => console.log("PAGE EXCEPTION:", err.message, err.stack));

await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=120#/v/sky`, { waitUntil: "load" });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outPrefix}-early.png` });
await page.waitForTimeout(waitMs);
await page.screenshot({ path: `${outPrefix}-later.png` });
await page.waitForTimeout(waitMs);
await page.screenshot({ path: `${outPrefix}-latest.png` });

await browser.close();
console.log("done");
