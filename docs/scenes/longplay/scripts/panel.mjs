// node panel.mjs <out.png> <baseUrl> — opens Long Play, opens the panel, clicks the
// Bloom chip, screenshots the page, and prints the View row's chip states.
import { chromium } from "../../../../node_modules/playwright/index.mjs";
const [out, base] = process.argv.slice(2);
const browser = await chromium.launch({
  channel: "chromium",
  args: ["--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--enable-gpu", "--use-angle=metal", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
await page.goto(`${base}/?audio=synthetic&bpm=129#/v/longplay`);
await page.waitForTimeout(3000);
await page.evaluate(() => document.querySelector("#menuBtn")?.click());
await page.waitForTimeout(1500);
const before = await page.evaluate(() => {
  const strip = [...document.querySelectorAll('.vc-picker[aria-label="View"]')][0];
  if (!strip) return "no View row";
  strip.scrollIntoView({ block: "center" });
  return [...strip.querySelectorAll("button")].map((b) => `${b.textContent}|checked=${b.getAttribute("aria-checked")}|disabled=${b.getAttribute("aria-disabled")}`).join("  ");
});
console.log("before:", before);
await page.evaluate(() => {
  const strip = document.querySelector('.vc-picker[aria-label="View"]');
  [...(strip?.querySelectorAll("button") ?? [])].find((b) => b.textContent.startsWith("Bloom"))?.click();
});
await page.waitForTimeout(800);
const after = await page.evaluate(() => {
  const strip = document.querySelector('.vc-picker[aria-label="View"]');
  return [...(strip?.querySelectorAll("button") ?? [])].map((b) => `${b.textContent}|checked=${b.getAttribute("aria-checked")}`).join("  ");
});
console.log("after clicking Bloom:", after);
await page.screenshot({ path: out });
await browser.close();
