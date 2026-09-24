// Neon Gates: captures settled stills on a couple of looks, a morph-in-
// progress contact sheet (Change rate pinned high, frames ~250ms apart
// across roughly one bar), and a gallery screenshot.
// Rescued from a working session on 2026-09-23.
// usage: node gates-morph-shot.mjs <outPrefix> [--port P]
// May need adjusting to current code — setting names (cutRate) may have
// changed.
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));

const args = process.argv.slice(2);
const outPrefix = args[0];
const port = Number(args.includes("--port") ? args[args.indexOf("--port") + 1] : 5190);

const browser = await chromium.launch({
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--ignore-certificate-errors",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 960, height: 540 },
  permissions: ["microphone"],
});
const page = await ctx.newPage();
let sawError = false;
page.on("console", (m) => {
  if (m.type() === "error") {
    sawError = true;
    console.log("PAGE ERROR:", m.text());
  }
});
page.on("pageerror", (e) => {
  sawError = true;
  console.log("PAGE EXCEPTION:", e.message);
});

async function shot(url, out, waitMs = 2500) {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(waitMs);
  await page.screenshot({ path: out });
  console.log("wrote", out);
}

// 1. Settled stills on a couple of looks — force via setParams once loaded.
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=126#/v/gates`, { waitUntil: "load" });
await page.waitForTimeout(2000);
await page.evaluate(() => window.__viz?.setParams?.({ scene: "gates", autoPin: true, settings: { cutRate: 0 } }));
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outPrefix}-settled-a.png` });
console.log("wrote", `${outPrefix}-settled-a.png`);

// Force a specific look via internal state isn't exposed; instead push
// Change rate up briefly to cycle to another look, then back down to hold.
await page.evaluate(() => window.__viz?.setParams?.({ scene: "gates", autoPin: true, settings: { cutRate: 1 } }));
await page.waitForTimeout(6000); // let it morph through a few looks
await page.evaluate(() => window.__viz?.setParams?.({ scene: "gates", autoPin: true, settings: { cutRate: 0 } }));
await page.waitForTimeout(2500); // let any in-flight morph settle
await page.screenshot({ path: `${outPrefix}-settled-b.png` });
console.log("wrote", `${outPrefix}-settled-b.png`);

// 2. Morph-in-progress contact sheet: push Change rate to 1 and grab frames
// ~200-300ms apart across about one bar (bpm=126 => a bar is ~1.9s at 4
// beats/bar).
await page.evaluate(() => window.__viz?.setParams?.({ scene: "gates", autoPin: true, settings: { cutRate: 1 } }));
await page.waitForTimeout(300); // let a morph actually be in flight
for (let i = 0; i < 8; i++) {
  await page.screenshot({ path: `${outPrefix}-morph-${String(i).padStart(2, "0")}.png` });
  console.log("wrote", `${outPrefix}-morph-${String(i).padStart(2, "0")}.png`);
  await page.waitForTimeout(250);
}

// 3. Gallery, once, at the end.
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=126#/`, { waitUntil: "load" });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${outPrefix}-gallery.png` });
console.log("wrote", `${outPrefix}-gallery.png`);

console.log("sawError:", sawError);
await browser.close();
