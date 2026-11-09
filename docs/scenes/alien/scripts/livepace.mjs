// node docs/scenes/alien/scripts/livepace.mjs --port P [--loops 0,1,10]
// The live scene's pace: with one loop pinned (?loop=<n>, synthetic audio),
// reads window.__alien's playhead and Move speed for 4 s and prints how long
// one loop takes at speed 1 and the moves (pace.ts) the dance makes per second
// on screen at speed 1. Run it against two dev servers to compare builds.
import { readFileSync } from "node:fs";
const root = (p) => new URL(`../../../../${p}`, import.meta.url).pathname;
const { chromium } = await import(root("node_modules/playwright/index.mjs"));
const { CLIP_LIBRARY_URL, decodeClipLibrary } = await import(root("src/render/scenes/dancers/clipFormat.ts"));
const { danceMoves } = await import(root("src/render/scenes/alien/pace.ts"));
const { LOOPS, clipSeconds } = await import(root("src/render/scenes/alien/reel.ts"));

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const port = opt("--port", "5173");
const loops = opt("--loops", "0,1,10,12,14,29,32,33").split(",").map(Number);
const bin = readFileSync(root(`public${CLIP_LIBRARY_URL}`));
const lib = decodeClipLibrary(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));

const browser = await chromium.launch({
  channel: "chromium",
  args: ["--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 960, height: 540 } });
console.log("dance          Move speed  loop at speed 1  captured loop  moves/s on screen at speed 1");
for (const n of loops) {
  const page = await ctx.newPage();
  await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=128&loop=${n}#/v/alien`);
  await page.waitForFunction(() => window.__alien && window.__alien.last.rate > 0.05, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  const samples = await page.evaluate(async (i) => {
    const out = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 4000) {
      out.push([performance.now(), window.__alien.phase[i], window.__alien.last.rate]);
      await new Promise((r) => setTimeout(r, 50));
    }
    return out;
  }, n);
  await page.close();
  let turns = 0;
  let rate = 0;
  for (let k = 1; k < samples.length; k++) {
    const d = samples[k][1] - samples[k - 1][1];
    turns += d < -0.5 ? d + 1 : d;
    rate += samples[k][2] / (samples.length - 1);
  }
  const loopAt1 = (((samples.at(-1)[0] - samples[0][0]) / 1000) * rate) / turns;
  const clip = lib.byName.get(LOOPS[n].clip);
  console.log(
    `${LOOPS[n].dance.padEnd(14)} ${rate.toFixed(2).padStart(6)}      ${loopAt1.toFixed(2).padStart(6)} s       ${clipSeconds(clip).toFixed(2).padStart(6)} s       ${(danceMoves(clip) / loopAt1).toFixed(2)}`,
  );
}
await browser.close();
