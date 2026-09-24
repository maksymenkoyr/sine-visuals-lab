// Feeds a WAV file as the fake microphone (Chromium's fake-audio-capture
// flag), so the app's real analyser runs on real music instead of the
// synthetic click track. Screenshots every --every seconds and logs the
// probe's low/section/drop/beat readings alongside. Scene-agnostic
// (--scene flag); used while tuning Powder against real tracks.
// Rescued from a working session on 2026-09-04.
// usage: node realmusic.mjs <outPrefix> [--port P] [--scene S] [--wav /path.wav] [--seconds N] [--every S]
// May need adjusting to current code.
import { tmpdir } from "node:os";
import { join } from "node:path";
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));
const args = process.argv.slice(2);
const out = args[0];
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const port = opt("--port", "5210");
const scene = opt("--scene", "powder");
const wav = opt("--wav", join(tmpdir(), "track.wav"));
const seconds = +opt("--seconds", "56");
const every = +opt("--every", "2");
const browser = await chromium.launch({
  channel: "chromium",
  args: [
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${wav}`,
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist",
  ],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 }, permissions: ["microphone"] });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 2000)));
page.on("console", (m) => { if (m.type() === "error" && !/8787|ERR_CONNECTION_REFUSED|403/.test(m.text())) console.log("CONSOLE", m.text().slice(0, 600)); });
await page.goto(`https://localhost:${port}/#/v/${scene}`, { waitUntil: "load" });
await page.waitForTimeout(1000);
await page.mouse.click(640, 360);
await page.waitForTimeout(1500);
await page.evaluate(() => window.__viz?.setParams({ autoPin: false, settings: {} }));
const t0 = Date.now();
let n = 0;
for (let t = every; t <= seconds; t += every) {
  await page.waitForTimeout(Math.max(0, t * 1000 - (Date.now() - t0)));
  const p = await page.evaluate(() => { const p = window.__viz?.probe(); return p ? { src: p.source ?? p.audio?.source, low: p.bands?.low, energy: p.bands?.energy, section: p.section, drop: p.drop, bpm: p.beat?.bpm, fps: p.fps } : null; });
  await page.screenshot({ path: `${out}-${String(n).padStart(2, "0")}.png` });
  console.log(`t=${t}s`, JSON.stringify(p));
  n++;
}
console.log(await page.evaluate(() => window.__viz?.probeText?.().split("\n").slice(0, 3).join(" | ")));
await browser.close();
console.log("REALMUSIC_OK");
