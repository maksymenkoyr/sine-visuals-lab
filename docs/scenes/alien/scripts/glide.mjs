// node glide.mjs <wav> --port P [--move 0.2] [--from S] [--seconds S]
// A real song as the fake mic, loop 0 pinned, Move forced low; logs the
// alien's place in his clip on every rendered frame and reports how it
// advances: stalls while the speed is above 0, and what the old 120 fps
// videos would have done at the same speeds.
import { launchWithMic } from "../../../../tools/ref-browser.mjs";

const args = process.argv.slice(2);
const wav = args[0];
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt("port", "5361");
const move = Number(opt("move", "0.2"));
const from = Number(opt("from", "6"));
const seconds = Number(opt("seconds", "15"));
/** Loop 0's clip (expressive) lasts this long as captured. */
const CLIP_SEC = 4;
const BAKED_FPS = 120;

const { browser, ctx } = await launchWithMic(wav, { width: 960, height: 540 });
const page = await ctx.newPage();
await page.route("**/__tuning/params", (route) =>
  route.fulfill({ contentType: "application/json", body: JSON.stringify({ scene: "alien", autoPin: true, settings: { move } }) }),
);
await page.goto(`https://localhost:${port}/?quality=high&loop=0#/v/alien`, { waitUntil: "load" });
await page.waitForTimeout(800);
await page.mouse.click(480, 270);
await page.waitForFunction(() => window.__micT0 > 0, null, { timeout: 8000 });
await page.waitForTimeout(from * 1000);
const log = await page.evaluate(
  (ms) =>
    new Promise((resolve) => {
      const out = [];
      const t0 = performance.now();
      let prevSpeed = NaN;
      // The app may render below the rAF rate: a sample counts only when a render
      // moved the eased speed (it changes every render while the music moves it).
      const tick = () => {
        const a = window.__alien;
        if (a.last.speed !== prevSpeed) out.push([performance.now(), a.phase[0], a.last.rate, a.last.target]);
        prevSpeed = a.last.speed;
        if (performance.now() - t0 < ms) requestAnimationFrame(tick);
        else resolve(out);
      };
      requestAnimationFrame(tick);
    }),
  seconds * 1000,
);
await browser.close();

const adv = [];
let stalls = 0, moving = 0;
const rates = [];
for (let i = 1; i < log.length; i++) {
  const [, p0] = log[i - 1];
  const [, p1, rate] = log[i];
  let d = p1 - p0;
  if (d < -0.5) d += 1;
  rates.push(rate);
  if (rate > 0) {
    moving++;
    if (d <= 0) stalls++;
    adv.push(d * CLIP_SEC * BAKED_FPS);
  }
}
const q = (a, f) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : NaN;
};
const dur = (log.at(-1)[0] - log[0][0]) / 1000;
console.log(
  JSON.stringify({
    move,
    frames: log.length,
    fps: +(log.length / dur).toFixed(1),
    rate: { min: +q(rates, 0).toFixed(3), med: +q(rates, 0.5).toFixed(3), max: +q(rates, 1).toFixed(3) },
    movingFrames: moving,
    stalledWhileMoving: stalls,
    // In frames of the old 120 fps bake: under 1 per screen frame, the video showed the same frame again.
    bakedFramesPerScreenFrame: { min: +q(adv, 0).toFixed(3), med: +q(adv, 0.5).toFixed(3), max: +q(adv, 1).toFixed(3) },
    oldVideoRepeatShare: +(adv.filter((x) => x < 1).length / Math.max(1, adv.length)).toFixed(2),
    // The old player paused below its MIN_RATE.
    oldPausedShare: +(rates.filter((r) => r > 0 && r < 0.07).length / Math.max(1, moving)).toFixed(2),
  }),
);
