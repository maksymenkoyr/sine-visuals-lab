// Minimal single-page screenshotter: loads a URL, waits, takes one shot, and
// logs any console errors/warnings and page exceptions. Fully scene- and
// project-agnostic. Written while working on the Neon Gates scene.
// Rescued from a working session on 2026-09-05.
// usage: node shot2.mjs <url> <outPath>
// May need adjusting to current code.
import { chromium } from "playwright";

const url = process.argv[2];
const out = process.argv[3];

const browser = await chromium.launch({
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--ignore-certificate-errors",
  ],
});
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 960, height: 540 },
  permissions: ["microphone"],
});
const page = await ctx.newPage();
page.on("console", (m) => {
  if (m.type() === "error") console.log("PAGE ERROR:", m.text());
});
page.on("pageerror", (e) => console.log("PAGE EXCEPTION:", e.message));
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(2500);
await page.screenshot({ path: out });
await browser.close();
