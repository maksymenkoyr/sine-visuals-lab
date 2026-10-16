// node docs/scenes/alien/scripts/playcheck.mjs --port P --engine chromium|webkit [--refuse]
// --refuse: play() rejects with NotAllowedError until the first click (iOS without a gesture).
import { chromium, webkit } from "../../../../node_modules/playwright/index.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const port = opt("port", "5331");
const engine = opt("engine", "chromium");
const refuse = args.includes("--refuse");

const browser =
  engine === "webkit"
    ? await webkit.launch()
    : await chromium.launch({ channel: "chromium", args: ["--enable-gpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1200, height: 800 } });
const page = await ctx.newPage();
if (refuse) {
  await page.addInitScript(() => {
    const real = HTMLMediaElement.prototype.play;
    let blessed = false;
    window.addEventListener("click", () => (blessed = true), true);
    HTMLMediaElement.prototype.play = function () {
      if (!blessed) return Promise.reject(new DOMException("refused", "NotAllowedError"));
      return real.call(this);
    };
  });
}
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=128&loop=0#/v/alien`);
await page.waitForTimeout(5000);
const read = () =>
  page.evaluate(() => {
    const a = window.__alien;
    const v = a.videos[a.reel.loop];
    return {
      t: +v.currentTime.toFixed(3),
      paused: v.paused,
      rate: +a.last.rate.toFixed(2),
      refused: a.playRefused.slice(),
      inPage: v.isConnected,
    };
  });
const a = await read();
await page.waitForTimeout(1000);
const b = await read();
console.log(engine, refuse ? "refuse" : "normal", "before click", JSON.stringify(a), "->", JSON.stringify(b));
if (refuse) {
  await page.mouse.click(600, 400);
  await page.waitForTimeout(1500);
  const c = await read();
  await page.waitForTimeout(1000);
  const d = await read();
  console.log(engine, "after click", JSON.stringify(c), "->", JSON.stringify(d));
}
if (errors.length) console.log("errors:", errors.join("\n"));
await browser.close();
