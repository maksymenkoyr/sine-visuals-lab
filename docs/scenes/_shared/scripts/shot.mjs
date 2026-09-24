// Screenshot burst of a scene with synthetic audio, logging shader-compile
// or console errors and a probe snapshot alongside each frame.
// Scene-agnostic (--scene flag, defaults to "gates"); used while tuning the
// Neon Gates scene.
// Rescued from a working session on 2026-09-05.
//   node shot.mjs <outPrefix> [--port 5199] [--scene gates] [--bpm 126] [--quality high]
//                 [--frames 4] [--every 1500] [--settings JSON] [--warm 4000]
// May need adjusting to current code.
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));

const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--"));
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt("--port", "5199");
const scene = opt("--scene", "gates");
const bpm = opt("--bpm", "126");
const quality = opt("--quality", "high");
const frames = +opt("--frames", "4");
const every = +opt("--every", "1500");
const warm = +opt("--warm", "4000");
const settings = opt("--settings", null);

const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: [
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--enable-gpu",
    "--use-angle=metal",
    "--enable-gpu-rasterization",
    "--ignore-gpu-blocklist",
  ],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
page.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error" || /shader|compile|GLSL|ERROR/i.test(t)) console.log("[console]", t.slice(0, 1200));
});
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 600)));

await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=${bpm}&quality=${quality}#/v/${scene}`);
await page.waitForTimeout(1500);
if (settings) {
  await page.evaluate((s) => window.__viz.setParams({ autoPin: true, settings: JSON.parse(s) }), settings);
}
await page.waitForTimeout(warm);
for (let i = 0; i < frames; i++) {
  const probe = await page.evaluate(() => {
    const p = window.__viz.probe();
    return { scene: p.scene, bpm: p.bpm, hash: location.hash, keys: Object.keys(p).slice(0, 12) };
  });
  const file = `${out}-${String(i).padStart(2, "0")}.png`;
  await page.screenshot({ path: file });
  console.log("shot", file, JSON.stringify(probe));
  await page.waitForTimeout(every);
}
await browser.close();
