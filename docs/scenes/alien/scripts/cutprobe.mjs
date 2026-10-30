// Plays a wav as the mic into Alien and logs every dance and camera cut
// (window.__alien, DEV), then opens the panel and shoots the Dance and View
// rows before and after the next camera cut, reading which chip is outlined.
//   node docs/scenes/alien/scripts/cutprobe.mjs <wav> <outPrefix> --port P [--seconds S] [--drives JSON]
import { chromium } from "../../../../node_modules/playwright/index.mjs";

const args = process.argv.slice(2);
const [wav, outPrefix] = args;
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const port = Number(opt("port", 5311));
const seconds = Number(opt("seconds", 40));
const drives = opt("drives", null);

const browser = await chromium.launch({
  channel: "chromium",
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    `--use-file-for-fake-audio-capture=${wav}%noloop`,
    "--autoplay-policy=no-user-gesture-required",
    "--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist",
  ],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1600, height: 1000 }, permissions: ["microphone"] });
await ctx.addInitScript((drives) => {
  if (drives) localStorage.setItem("vibe.drives", drives);
  const md = navigator.mediaDevices;
  const orig = md.getUserMedia.bind(md);
  md.getUserMedia = async (c) => {
    const s = await orig(c);
    if (c && c.audio && !window.__micT0) window.__micT0 = performance.now();
    return s;
  };
}, drives);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 300)));
await page.goto(`https://localhost:${port}/?quality=high#/v/alien`, { waitUntil: "load" });
await page.waitForTimeout(800);
await page.mouse.click(800, 500);
await page.waitForFunction(() => window.__micT0 > 0, null, { timeout: 8000 });
await page.waitForFunction(() => !!window.__alien, null, { timeout: 8000 });

const log = await page.evaluate(
  (sec) =>
    new Promise((resolve) => {
      const a = window.__alien;
      const out = [];
      let cuts = a.reel.cuts;
      let cams = a.reel.cameraCuts;
      const tick = () => {
        const t = (performance.now() - window.__micT0) / 1000;
        if (a.reel.cuts !== cuts) {
          cuts = a.reel.cuts;
          out.push({ t, kind: "dance", loop: a.reel.loop, view: a.reel.view });
        }
        if (a.reel.cameraCuts !== cams) {
          cams = a.reel.cameraCuts;
          out.push({ t, kind: "camera", loop: a.reel.loop, view: a.reel.view });
        }
        if (t >= sec) resolve(out);
        else requestAnimationFrame(tick);
      };
      tick();
    }),
  seconds,
);
for (const c of log) console.log(`${c.t.toFixed(2)}s  ${c.kind.padEnd(6)} loop ${c.loop} view ${c.view}`);
const gaps = (kind) => {
  const ts = log.filter((c) => c.kind === kind).map((c) => c.t);
  return ts.slice(1).map((t, i) => t - ts[i]);
};
for (const kind of ["dance", "camera"]) {
  const g = gaps(kind);
  console.log(`${kind}: ${log.filter((c) => c.kind === kind).length} cuts in ${seconds} s; gaps ${g.length ? `${Math.min(...g).toFixed(2)}–${Math.max(...g).toFixed(2)} s` : "-"}`);
}

// The panel: open it, find the two chip rows, and read the outlined chip.
await page.evaluate(() => document.querySelector("#menuBtn")?.click());
await page.waitForTimeout(1500);
const readRows = () =>
  page.evaluate(() => {
    const a = window.__alien;
    const row = (label) => {
      const strip = document.querySelector(`.vc-picker[aria-label="${label}"]`);
      if (!strip) return null;
      const outlined = strip.querySelector('[aria-current="true"]');
      const chosen = strip.querySelector('[aria-checked="true"]');
      const head = strip.parentElement;
      return { outlined: outlined?.textContent ?? null, chosen: chosen?.textContent ?? null, head: head?.firstElementChild?.textContent ?? "" };
    };
    return { dance: row("Dance"), view: row("View"), reel: { loop: a.reel.loop, view: a.reel.view } };
  });
const shoot = async (label, file) => {
  const row = page.locator(`.vc-picker[aria-label="${label}"]`).locator("xpath=..");
  await row.scrollIntoViewIfNeeded();
  await row.screenshot({ path: file });
};
console.log("before:", JSON.stringify(await readRows()));
await shoot("Dance", `${outPrefix}-dance.png`);
await shoot("View", `${outPrefix}-view-1.png`);
const cams = await page.evaluate(() => window.__alien.reel.cameraCuts);
await page.waitForFunction((n) => window.__alien.reel.cameraCuts > n, cams, { timeout: 30000 }).catch(() => console.log("no camera cut within 30 s"));
await page.waitForTimeout(400);
console.log("after a camera cut:", JSON.stringify(await readRows()));
await shoot("View", `${outPrefix}-view-2.png`);
await page.screenshot({ path: `${outPrefix}-full.png` });
await browser.close();
