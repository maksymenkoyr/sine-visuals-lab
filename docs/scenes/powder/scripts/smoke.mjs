// Powder: smoke-test — loads the scene, waits, screenshots at 3s and 8s, and
// logs console errors/warnings and page exceptions.
// Rescued from a working session on 2026-09-04.
// usage: node smoke.mjs [outDir]  (outDir defaults to the OS temp dir)
// May need adjusting to current code — port/URL are hardcoded below.
import { tmpdir } from "node:os";
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));

const OUT = process.argv[2] || tmpdir();
const URL_ = "https://localhost:5210/?audio=synthetic&bpm=124#/v/powder";

const browser = await chromium.launch({
  channel: "chromium",
  args: [
    "--enable-gpu",
    "--use-angle=metal",
    "--enable-gpu-rasterization",
    "--ignore-gpu-blocklist",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
const page = await context.newPage();

const consoleErrors = [];
const pageErrors = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") consoleErrors.push(`[${m.type()}] ${m.text()}`);
});
page.on("pageerror", (e) => pageErrors.push(String(e && e.stack ? e.stack : e)));

await page.goto(URL_, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/powder-smoke-3s.png` });
await page.waitForTimeout(5000);
await page.screenshot({ path: `${OUT}/powder-smoke-8s.png` });

const hash = await page.evaluate(() => location.hash);
console.log("hash:", hash);
console.log("--- console errors/warnings ---");
console.log(consoleErrors.join("\n") || "(none)");
console.log("--- page errors ---");
console.log(pageErrors.join("\n") || "(none)");

await browser.close();
