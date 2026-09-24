// Neon Gates: settled-default stills, a Beat flash on/off contact-sheet
// burst across beat phases, a Build-up glow max/min comparison (with
// sectionIntensity probed before/after a few seconds), and a gallery shot.
// Rescued from a working session on 2026-09-23.
// usage: node gates3-shot.mjs <outPrefix> [--port P]
// May need adjusting to current code — setting names (cutRate, beatFlash,
// buildGlow) may have changed.
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));

const args = process.argv.slice(2);
const outPrefix = args[0];
const port = Number(args.includes("--port") ? args[args.indexOf("--port") + 1] : 5195);

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

// 1. Settled stills at defaults.
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=126#/v/gates`, { waitUntil: "load" });
await page.waitForTimeout(3000);
await page.screenshot({ path: `${outPrefix}-defaults-a.png` });
console.log("wrote", `${outPrefix}-defaults-a.png`);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outPrefix}-defaults-b.png` });
console.log("wrote", `${outPrefix}-defaults-b.png`);

// 2. Pin Beat flash to max and hold a look so the punch is unambiguous, then
// burst ~8 frames ~110ms apart across a couple of beats at 126bpm (a beat is
// ~476ms, so 110ms steps land at different beat phases across ~1s).
await page.evaluate(() =>
  window.__viz?.setParams?.({ scene: "gates", autoPin: true, settings: { cutRate: 0, beatFlash: 1, buildGlow: 0 } }),
);
await page.waitForTimeout(1000);
for (let i = 0; i < 8; i++) {
  await page.screenshot({ path: `${outPrefix}-beat-${String(i).padStart(2, "0")}.png` });
  console.log("wrote", `${outPrefix}-beat-${String(i).padStart(2, "0")}.png`);
  await page.waitForTimeout(110);
}

// 3. Beat flash at 0 for comparison (same look, same moment class) — proves
// the punch is coming from the setting, not something else moving.
await page.evaluate(() =>
  window.__viz?.setParams?.({ scene: "gates", autoPin: true, settings: { cutRate: 0, beatFlash: 0, buildGlow: 0 } }),
);
await page.waitForTimeout(1000);
for (let i = 0; i < 4; i++) {
  await page.screenshot({ path: `${outPrefix}-noflash-${String(i).padStart(2, "0")}.png` });
  console.log("wrote", `${outPrefix}-noflash-${String(i).padStart(2, "0")}.png`);
  await page.waitForTimeout(110);
}

// 4. Build-up glow: pin it to max vs. min at the same moment class, and also
// let the default synthetic run for a while to see if sectionIntensity swings
// on its own.
await page.evaluate(() =>
  window.__viz?.setParams?.({ scene: "gates", autoPin: true, settings: { cutRate: 0, beatFlash: 0, buildGlow: 1 } }),
);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outPrefix}-buildglow-max.png` });
console.log("wrote", `${outPrefix}-buildglow-max.png`);

await page.evaluate(() =>
  window.__viz?.setParams?.({ scene: "gates", autoPin: true, settings: { cutRate: 0, beatFlash: 0, buildGlow: 0 } }),
);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outPrefix}-buildglow-min.png` });
console.log("wrote", `${outPrefix}-buildglow-min.png`);

// Probe sectionIntensity directly to check whether the short synthetic run
// swings it enough to matter, and log it alongside the shots.
const probe1 = await page.evaluate(() => window.__viz?.probe?.()?.section ?? null);
console.log("sectionIntensity now:", probe1);
await page.waitForTimeout(4000);
const probe2 = await page.evaluate(() => window.__viz?.probe?.()?.section ?? null);
console.log("sectionIntensity after 4s:", probe2);
await page.screenshot({ path: `${outPrefix}-buildglow-later.png` });
console.log("wrote", `${outPrefix}-buildglow-later.png`);

// 5. Gallery, once, at the end — reset settings first.
await page.evaluate(() => window.__viz?.setParams?.({ scene: "gates", autoPin: false, settings: {} }));
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=126#/`, { waitUntil: "load" });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${outPrefix}-gallery.png` });
console.log("wrote", `${outPrefix}-gallery.png`);

console.log("sawError:", sawError);
await browser.close();
