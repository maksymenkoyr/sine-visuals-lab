// Headcount check for Physarum 2's Switching: with the default Switching the split
// between strains moves and settles (read off the population bar, panel open);
// at Switching 0 it freezes. Also applies Trail life / Sensor angle overrides and
// reports any shader/console error. Screenshots go to <out>-a.png / <out>-b.png.
//   node headcountcheck.mjs [port] [outPrefix]     (dev server up; ?audio=synthetic)
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));
const port = process.argv[2] || "5290";
const out = process.argv[3] || "headcount";
const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error" || /shader|compile|GLSL/i.test(t)) errors.push(t.slice(0, 800));
});
page.on("pageerror", (e) => errors.push(String(e).slice(0, 400)));
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=120&quality=low#/v/physarum2`);
await page.waitForTimeout(1500);
await page.evaluate(() => document.getElementById("menuBtn")?.click());
await page.waitForTimeout(800);
const pops = () =>
  page.evaluate(() => [...document.querySelectorAll(".vc-popbar > *")].map((e) => e.style.width || e.textContent));
const sample = async (label, secs) => {
  for (let i = 0; i < secs; i++) {
    await page.waitForTimeout(1000);
    if (i % 3 === 2 || i === secs - 1) console.log(label, i + 1, "s", JSON.stringify(await pops()));
  }
};
await sample("switching default(0.4)", 15);
await page.screenshot({ path: `${out}-a.png` });
await page.evaluate(() => window.__viz.setParams({ scene: "physarum2", autoPin: true, settings: { switching: 0, life0: 1, angle1: 100 } }));
await sample("switching 0 + life0=1 angle1=100", 6);
await page.screenshot({ path: `${out}-b.png` });
console.log("errors", JSON.stringify(errors.filter((e) => !/8787|ERR_CONNECTION_REFUSED|@fs.*40[13]/.test(e))));
await browser.close();
