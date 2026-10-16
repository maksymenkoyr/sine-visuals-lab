// node probe.mjs [--port 5190] [--bpm 128] [--secs 25]
// Samples __viz.probe().beat once a second on the synthetic feed: does the
// metronome (the Beat wave's source) ever lock?
import { chromium } from "playwright";

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf("--" + k);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt("port", "5190");
const bpm = opt("bpm", "128");
const secs = +opt("secs", "25");
const browser = await chromium.launch({
  headless: true,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--enable-unsafe-swiftshader"],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 960, height: 540 } });
const page = await ctx.newPage();
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=${bpm}#/v/swarm`);
for (let t = 1; t <= secs; t++) {
  await page.waitForTimeout(1000);
  const b = await page.evaluate(() => window.__viz?.probe?.()?.beat);
  console.log(t, JSON.stringify(b));
}
await browser.close();
