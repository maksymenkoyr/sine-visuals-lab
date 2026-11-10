// Records Mandelbox Flight with a song as the mic, at a steady pace (Push 0), through the app's own Record
// button, so `tools/ref-scan.py` can measure the clip's whole-frame zoom the way it measured the reference's.
// usage: node docs/scenes/mandelbox/scripts/record-clip.mjs <port> <song.wav> <out.webm> [--seconds 60] [--settings JSON]
import { launchWithMic, openScene } from "../../../../tools/ref-browser.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const [port, wav, out] = args;
const seconds = Number(opt("--seconds", "60"));
const settings = { push: 0, ...JSON.parse(opt("--settings", "{}")) };

const { browser, ctx } = await launchWithMic(wav, { width: 1280, height: 720 });
try {
  const page = await openScene(ctx, { port, scene: "mandelbox" });
  // Sent sooner, the dev tuning bus's startup fetch of tuning/params.json clears it.
  await page.waitForTimeout(1500);
  await page.evaluate((s) => window.__viz.setParams({ scene: "mandelbox", autoPin: false, settings: s }), settings);
  await page.waitForTimeout(1000);
  const saved = page.waitForEvent("download", { timeout: (seconds + 60) * 1000 });
  // A click through the page: openScene hid the chrome, so the button can't be clicked as a user would.
  await page.evaluate(() => document.getElementById("recBtn").click());
  const startedSec = await page.evaluate(() => (performance.now() - window.__micT0) / 1000);
  await page.waitForTimeout(seconds * 1000);
  await page.evaluate(() => document.getElementById("recBtn").click());
  await (await saved).saveAs(out);
  console.log(`${out}: ${seconds} s from ${startedSec.toFixed(1)} s into the song, settings ${JSON.stringify(settings)}`);
} finally {
  await browser.close();
}
