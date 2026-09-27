// Loads the built prototype, waits for it to settle, prints page errors, and
// takes full-page screenshots at 1440 wide (desktop) and 400 wide (phone).
// Run with: node look.mjs [--click]
// --click also clicks the first strain box and opens the first stimulus
// chip before the wide shot, so the Stimulus mix patch shows in the screenshot.
import { chromium } from "/Users/yaro/projects/audio-visualization/node_modules/playwright/index.mjs";

const dir = new URL(".", import.meta.url);
const url = "file://" + new URL("physarum2-controls.html", dir).pathname;
const clickExtras = process.argv.includes("--click");

const browser = await chromium.launch({ channel: "chromium", headless: true, args: ["--enable-gpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });

async function shoot(width, height, path, withClicks) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await page.goto(url);
  await page.waitForTimeout(7000);
  if (withClicks) {
    await page.evaluate(() => document.querySelector("#specimens .specimen")?.click());
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector("#rows .chip")?.click());
    await page.waitForTimeout(1200);
  }
  await page.screenshot({ path, fullPage: true });
  console.log(path, "errors:", errs);
  await page.close();
}

await shoot(1440, 1100, new URL("look-wide.png", dir).pathname, clickExtras);
await shoot(400, 1400, new URL("look-phone.png", dir).pathname, false);
await browser.close();
