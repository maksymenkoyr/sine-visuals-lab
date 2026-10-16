// Shoot several settings variants of one scene in one browser session,
// a few frames each, synthetic audio.
//   node variants.mjs <scene> <port> <outPrefix> <variantsJson> [shotsPerVariant] [everyMs]
import { chromium } from "../../../../node_modules/playwright/index.mjs";

const [scene, port, prefix, variantsJson, nArg, everyArg] = process.argv.slice(2);
const variants = JSON.parse(variantsJson);
const n = +(nArg ?? 2);
const every = +(everyArg ?? 1500);
const browser = await chromium.launch({
  channel: "chromium",
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--enable-gpu",
    "--use-angle=metal",
    "--enable-gpu-rasterization",
    "--ignore-gpu-blocklist",
  ],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 540, height: 540 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message.slice(0, 800)}`));
page.on("console", (m) => {
  if (m.type() === "error" && /failed to start|Shader/.test(m.text())) console.log(m.text().slice(0, 800));
});
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=112#/v/${scene}`);
await page.waitForTimeout(2000);
// hide the chrome so it isn't in the shots
await page.addStyleTag({ content: "body > *:not(canvas) { visibility: hidden !important; } canvas { visibility: visible !important; }" });
for (let v = 0; v < variants.length; v++) {
  await page.evaluate(([s, set]) => window.__viz.setParams({ scene: s, autoPin: true, settings: set }), [scene, variants[v]]);
  await page.waitForTimeout(2500);
  for (let i = 0; i < n; i++) {
    await page.screenshot({ path: `${prefix}-v${v}-${i}.png` });
    await page.waitForTimeout(every);
  }
}
const probe = await page.evaluate(() => window.__viz.probe());
console.log("probe scene:", probe?.scene);
await browser.close();
