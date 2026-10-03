// Screenshots the Strain Console card with the
// panel open, or --scene-card for the Strains card above it (boxes, headcount, Switching).
//   node consoleshot.mjs <out-prefix> [--port 5290] [--scene-card] [--width 1440] [--height 1300]
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--"));
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt("--port", "5290");
const width = +opt("--width", "1440");
const height = +opt("--height", "1300");
const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 500));
});
page.on("pageerror", (e) => errors.push("PAGEERROR " + String(e).slice(0, 500)));
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=120&quality=low#/v/physarum2`);
await page.waitForTimeout(1500);
await page.evaluate(() => document.getElementById("menuBtn")?.click());
await page.waitForTimeout(1200);
const info = await page.evaluate(() => ({
  cards: [...document.querySelectorAll(".vc-widget-card")].map((c) => c.querySelector(".vc-card-head, .vc-card-title")?.textContent?.trim().slice(0, 30)),
  lanes: document.querySelectorAll(".vc-sc-lane").length,
}));
console.log(JSON.stringify(info));
const sel = args.includes("--scene-card") ? ".vc-item-boxes" : ".vc-sc-tabs";
await page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: "start" }), sel);
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}.png` });
console.log("errors", JSON.stringify(errors.filter((e) => !/8787|ERR_CONNECTION_REFUSED|@fs.*40[13]/.test(e))));
await browser.close();
