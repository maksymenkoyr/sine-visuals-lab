// Neon Gates: opens the gallery root, clicks to reveal drafts, finds the
// "Neon Gates" tile by text, scrolls it into view, and screenshots.
// Rescued from a working session on 2026-09-23.
// usage: node gates-gallery-scroll.mjs [outPath] [port]
// May need adjusting to current code — the (832,683) click coordinate for
// the drafts fold and the "Neon Gates" tile text are hardcoded.
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = process.argv[2] || join(tmpdir(), "gates-gallery-draft.png");
const port = process.argv[3] || "5190";
const browser = await chromium.launch({
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--ignore-certificate-errors"],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 960, height: 800 }, permissions: ["microphone"] });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("PAGE ERROR:", m.text()); });
page.on("pageerror", (e) => console.log("PAGE EXCEPTION:", e.message));
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=126#/`, { waitUntil: "load" });
await page.waitForTimeout(1500);
await page.mouse.click(832, 683);
await page.waitForTimeout(1000);
const found = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll("*"));
  const el = els.find((e) => e.textContent?.trim() === "Neon Gates" && e.children.length === 0);
  if (!el) return false;
  el.scrollIntoView({ block: "center" });
  return true;
});
console.log("found Neon Gates tile:", found);
await page.waitForTimeout(2000);
await page.screenshot({ path: out });
console.log("wrote", out);
await browser.close();
