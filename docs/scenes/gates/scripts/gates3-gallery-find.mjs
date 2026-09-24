// Neon Gates: opens the gallery root, clicks the "SHOW N DRAFTS" toggle,
// finds the "Neon Gates" tile by text, scrolls it into view, and
// screenshots.
// Rescued from a working session on 2026-09-23.
// usage: node gates3-gallery-find.mjs [outPath] [port]
// May need adjusting to current code.
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = process.argv[2] || join(tmpdir(), "gates3-gallery-draft.png");
const port = process.argv[3] || "5195";
const browser = await chromium.launch({
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--ignore-certificate-errors"],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 960, height: 800 }, permissions: ["microphone"] });
const page = await ctx.newPage();
let sawError = false;
page.on("console", (m) => { if (m.type() === "error") { sawError = true; console.log("PAGE ERROR:", m.text()); } });
page.on("pageerror", (e) => { sawError = true; console.log("PAGE EXCEPTION:", e.message); });
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=126#/`, { waitUntil: "load" });
await page.waitForTimeout(2000);
await page.locator("text=/SHOW \\d+ DRAFTS?/i").first().click();
await page.waitForTimeout(1000);
const found = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll("*"));
  const el = els.find((e) => e.textContent?.trim() === "Neon Gates" && e.children.length === 0);
  if (!el) return false;
  el.scrollIntoView({ block: "center" });
  return true;
});
console.log("found Neon Gates tile:", found);
await page.waitForTimeout(2500);
await page.screenshot({ path: out });
console.log("wrote", out);
console.log("sawError:", sawError);
await browser.close();
