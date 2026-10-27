// Stills of Caustics on a real song 50 ms after each Mid hit, Contour at 1 then 0. Needs `npm run dev -- --port 5287`.
// node docs/scenes/caustics/scripts/contour-mid-shots.mjs <song.wav> <outPrefix>
import { launchWithMic, openScene } from "../../../../tools/ref-browser.mjs";

const [wav, out] = process.argv.slice(2);
const { browser, ctx } = await launchWithMic(wav, { width: 1280, height: 720 });
const page = await openScene(ctx, { port: 5287, scene: "caustics" });
await page.waitForTimeout(6000);

async function afterMidHit() {
  await page.evaluate(() => new Promise((resolve) => {
    let was = true;
    const tick = () => {
      const on = !!window.__viz?.probe()?.beat?.lanes?.mid;
      if (on && !was) setTimeout(resolve, 50);
      else { was = on; requestAnimationFrame(tick); }
    };
    tick();
  }));
}
for (const contour of [1, 0]) {
  await page.evaluate((c) => window.__viz.setParams({ scene: "caustics", autoPin: false, settings: { contour: c } }), contour);
  for (let i = 0; i < 4; i++) {
    await afterMidHit();
    await page.screenshot({ path: `${out}-c${contour}-${i}.png` });
    await page.waitForTimeout(700);
  }
}
await browser.close();
