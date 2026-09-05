#!/usr/bin/env node
// Replays a ref bundle's audio (see tools/ref-scan.py) into one of our
// scenes and shoots the same beats the scan grabbed, then tiles ours beside
// the reference frames — a side-by-side at the moments that matter, not at
// arbitrary seconds.
//
//   node tools/ref-shoot.mjs tools/.cache/refs/<name> --scene <sceneId> [--port 5173]
//        [--quality high] [--settings '{"key":v}'] [--min-rank 4] [--max-beats 12]
//        [--from 1.5] [--lead 40] [--out DIR]
//
// How the two sides line up: Chromium's --use-file-for-fake-audio-capture
// plays the wav as the microphone from the moment the capture starts, so
// an init script wraps getUserMedia and records performance.now() when the
// audio stream resolves — that instant is the bundle's t=0. Every shot then
// waits in-page (rAF loop) until the beat's time minus --lead ms and calls
// page.screenshot(); the lead absorbs the screenshot's own latency, and each
// shot's actual lag from its target is logged and written to ours.json, so
// a late frame is a known late frame. Expect ±1 frame at 60 fps; good enough
// to compare what happens *on* a bar, not enough to compare sub-frame attack.
//
// The scene hears the track through the real analyser (src/audio/features.ts),
// so ours.json also records the probe's bpm/energy at each shot — the first
// thing to check when our scene doesn't move on the beats the reference
// does is whether our beat clock locked to the tempo the scan found.
//
// Output (default <bundle>/ours-<sceneId>/): b<idx>_r<rank>_<offset>.png per
// shot, ours.json, compare.html and compare.png (one row per beat: label,
// reference frames, our frames — same offsets, same order).
//
// --from skips beats before that many seconds: the analyser's adaptive
// floor/peak and the beat clock need a moment to settle, and the first
// second of a shot has nothing to compare anyway.
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const bundleDir = args.find((a) => !a.startsWith("--"));
if (!bundleDir) {
  console.error("usage: node tools/ref-shoot.mjs <bundleDir> --scene <sceneId> [options]");
  process.exit(2);
}
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const scene = opt("--scene", null);
if (!scene) {
  console.error("ref-shoot: --scene <sceneId> is required");
  process.exit(2);
}
const port = opt("--port", "5173");
const quality = opt("--quality", "high");
const settings = opt("--settings", null);
const minRank = +opt("--min-rank", "4");
const maxBeats = +opt("--max-beats", "12");
const fromSec = +opt("--from", "1.5");
const leadMs = +opt("--lead", "40");
const bundle = resolve(bundleDir);
const outDir = resolve(opt("--out", join(bundle, `ours-${scene}`)));
mkdirSync(outDir, { recursive: true });

const meta = JSON.parse(readFileSync(join(bundle, "audio.json"), "utf8"));
const wav = join(bundle, "audio.wav");
if (!existsSync(wav)) {
  console.error(`ref-shoot: ${wav} missing — the bundle has no audio, nothing to replay`);
  process.exit(1);
}
const offsets = meta.offsetsMs;
const targets = meta.beats.filter((b) => b.rank >= minRank && b.t >= fromSec && Object.keys(b.frames ?? {}).length).slice(0, maxBeats);
if (!targets.length) {
  console.error(`ref-shoot: no beats of rank >= ${minRank} after ${fromSec}s with frames in the bundle`);
  process.exit(1);
}
console.log(`${basename(bundle)} → ${scene}: ${targets.length} beats × ${offsets.length} offsets, tempo ${meta.tempo.toFixed(1)}`);

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
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 960, height: 540 }, permissions: ["microphone"] });
await ctx.addInitScript(() => {
  const md = navigator.mediaDevices;
  const orig = md.getUserMedia.bind(md);
  md.getUserMedia = async (c) => {
    const s = await orig(c);
    if (c && c.audio && !window.__micT0) window.__micT0 = performance.now();
    return s;
  };
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 500)));
page.on("console", (m) => {
  if (m.type() === "error" && !/8787|ERR_CONNECTION_REFUSED|403/.test(m.text())) console.log("CONSOLE", m.text().slice(0, 300));
});
await page.goto(`https://localhost:${port}/?quality=${quality}#/v/${scene}`, { waitUntil: "load" });
await page.waitForTimeout(800);
await page.mouse.click(480, 270); // the gesture that starts the mic
await page.waitForFunction(() => window.__micT0 > 0, null, { timeout: 8000 });
const hash = await page.evaluate(() => location.hash);
if (!hash.includes(scene)) console.log(`WARNING: page is at ${hash}, not the requested scene`);
// Only the canvas from here on — the HUD and buttons would sit on every frame.
await page.addStyleTag({ content: "body > :not(canvas) { visibility: hidden !important; }" });
if (settings) await page.evaluate((s) => window.__viz?.setParams({ autoPin: true, settings: JSON.parse(s) }), settings);
else await page.evaluate(() => window.__viz?.setParams({ autoPin: false, settings: {} }));

const shots = [];
for (const b of targets) {
  for (const off of offsets) {
    const targetMs = (b.t + off / 1000) * 1000;
    const waited = await page.evaluate(
      ({ targetMs, leadMs }) =>
        new Promise((r) => {
          const tick = () => {
            const now = performance.now() - window.__micT0;
            if (now >= targetMs - leadMs) r(now);
            else requestAnimationFrame(tick);
          };
          tick();
        }),
      { targetMs, leadMs },
    );
    const name = `b${String(b.i).padStart(3, "0")}_r${String(b.rank).padStart(2, "0")}_${off >= 0 ? "+" : "-"}${String(Math.abs(off)).padStart(3, "0")}.png`;
    await page.screenshot({ path: join(outDir, name) });
    const after = await page.evaluate(() => {
      const p = window.__viz?.probe?.();
      // Field names per src/tuning/probe.ts's ProbeSnapshot.
      return { now: performance.now() - window.__micT0, bpm: p?.beat?.bpm ?? null, phase: p?.beat?.phase ?? null, energy: p?.bands?.energy ?? null, scene: p?.scene ?? null };
    });
    const lag = Math.round((waited + after.now) / 2 - targetMs);
    shots.push({ beat: b.i, rank: b.rank, t: b.t, offsetMs: off, file: name, lagMs: lag, probe: { bpm: after.bpm, phase: after.phase, energy: after.energy, scene: after.scene } });
    if (waited > targetMs + 50) console.log(`  late: beat #${b.i} ${off >= 0 ? "+" : ""}${off} ms reached ${Math.round(waited - targetMs)} ms after target`);
  }
  console.log(`beat #${b.i} r${b.rank} t=${b.t.toFixed(2)}s shot (probe bpm ${shots.at(-1).probe.bpm ?? "?"})`);
}
writeFileSync(join(outDir, "ours.json"), JSON.stringify({ scene, bundle: basename(bundle), settings: settings ? JSON.parse(settings) : null, offsets, shots }, null, 1));

// Side-by-side: an HTML page of <img> rows, screenshotted whole.
const thumbH = 180;
const rows = targets.map((b) => {
  const cell = (src) => `<img src="${src}" style="height:${thumbH}px;margin-right:2px">`;
  const ref = offsets.map((o) => (b.frames[String(o)] ? cell(pathToFileURL(join(bundle, b.frames[String(o)])).href) : "")).join("");
  const ours = offsets.map((o) => {
    const s = shots.find((x) => x.beat === b.i && x.offsetMs === o);
    return s ? cell(pathToFileURL(join(outDir, s.file)).href) : "";
  }).join("");
  return `<div style="display:flex;align-items:flex-start;margin-bottom:4px">
    <div style="width:130px;flex:none;font:12px/1.4 monospace;color:#ddd;padding:4px">#${b.i} r${b.rank}<br>t ${b.t.toFixed(2)}s<br>onset ${b.onsetZ >= 0 ? "+" : ""}${b.onsetZ}<br>low ${b.lowZ >= 0 ? "+" : ""}${b.lowZ}${b.section ? "<br>SECTION" : ""}</div>
    <div style="flex:none">${ref}</div><div style="width:12px;flex:none"></div><div style="flex:none">${ours}</div></div>`;
});
const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#121216;padding:6px">
<div style="font:12px monospace;color:#aaa;margin:0 0 6px 130px">reference (${offsets.map((o) => `${o >= 0 ? "+" : ""}${o}`).join(" / ")} ms) &nbsp;&nbsp;|&nbsp;&nbsp; ours: ${scene}${settings ? " " + settings : ""}</div>
${rows.join("\n")}</body>`;
writeFileSync(join(outDir, "compare.html"), html);
const cmp = await ctx.newPage();
await cmp.goto(pathToFileURL(join(outDir, "compare.html")).href);
await cmp.waitForTimeout(500);
await cmp.screenshot({ path: join(outDir, "compare.png"), fullPage: true });
await browser.close();
const lags = shots.map((s) => s.lagMs);
console.log(`wrote ${join(outDir, "compare.png")} (${shots.length} shots, lag ${Math.min(...lags)}..${Math.max(...lags)} ms)`);
console.log("REF_SHOOT_OK");
