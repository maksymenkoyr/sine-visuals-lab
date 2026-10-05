#!/usr/bin/env node
// Puts a finished promo video where the user picks it up, in the forms they need.
//
//   node tools/promo/deliver.mjs --work DIR [--dest DIR]      (promo.mjs deliver runs this)
//
// Reads <work>/cuts.json (the video and its formats) and the masters the renderer wrote,
// <work>/out/<video>-<fmt>.mp4. Writes, per format, into the destination folder (default
// ~/Movies/sine-visuals-lab-<video>-<work folder name>/):
//   <video>-<fmt>.mp4          the master, copied as is
//   <video>-<fmt>-share.mp4    re-encoded smaller for posting (style.json delivery.shareCrf, the master's colour flags)
//   <video>-<fmt>-silent.mp4   the master's picture with no sound, for putting your own music under it
//   preview-<fmt>-<short side>.mp4
//                              small enough to send in a chat (delivery.preview, its crf raised until under
//                              delivery.sendLimitMB)
// plus CUES.md (cuts.py cues: what plays when, with the song and its time). Files already in the folder
// move into the next free vN/ first, so an earlier set is never overwritten. It prints each file with its
// size and length and posts nothing.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { ffmpeg, ffmpegPath } from "./ffmpeg.mjs";

const here = new URL(".", import.meta.url).pathname;
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const workArg = arg("--work") || process.env.PROMO_WORK;
if (!workArg) { console.error("usage: node tools/promo/deliver.mjs --work DIR [--dest DIR]"); process.exit(2); }
const work = resolve(workArg);
const cuts = JSON.parse(readFileSync(join(work, "cuts.json"), "utf8"));
const style = JSON.parse(readFileSync(join(here, "style.json"), "utf8")).delivery;
const dest = resolve(arg("--dest") || join(homedir(), "Movies", `sine-visuals-lab-${cuts.video}-${basename(work)}`));
mkdirSync(dest, { recursive: true });

// an earlier set moves into the next free vN/
const old = readdirSync(dest).filter((f) => statSync(join(dest, f)).isFile());
if (old.length) {
  let n = 1;
  while (existsSync(join(dest, `v${n}`))) n++;
  mkdirSync(join(dest, `v${n}`));
  for (const f of old) renameSync(join(dest, f), join(dest, `v${n}`, f));
  console.log(`earlier files moved to ${join(dest, `v${n}`)}`);
}

const mb = (f) => statSync(f).size / (1024 * 1024);
function seconds(f) {
  const r = spawnSync(ffmpegPath(), ["-hide_banner", "-i", f], { encoding: "utf8" });
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr || "");
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : NaN;
}
const report = (f) => console.log(`${f}  ${mb(f).toFixed(1)} MB  ${seconds(f).toFixed(1)} s`);

for (const fmt of cuts.formats) {
  const src = join(work, "out", `${cuts.video}-${fmt}.mp4`);
  if (!existsSync(src)) { console.error(`missing ${src} (render first)`); process.exit(2); }
  const base = join(dest, `${cuts.video}-${fmt}`);
  copyFileSync(src, `${base}.mp4`);
  ffmpeg(["-i", src, "-c:v", "libx264", "-preset", "slow", "-crf", String(style.shareCrf), "-pix_fmt", "yuv420p", "-profile:v", "high",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", "-c:a", "copy", "-movflags", "+faststart", `${base}-share.mp4`]);
  ffmpeg(["-i", src, "-c:v", "copy", "-an", "-movflags", "+faststart", `${base}-silent.mp4`]);
  // the short side (the width in 9:16, the height in 16:9) becomes preview.shortSide, the other side even
  const scale = fmt === "h" ? `scale=-2:${style.preview.shortSide}` : `scale=${style.preview.shortSide}:-2`;
  const prev = join(dest, `preview-${fmt}-${style.preview.shortSide}.mp4`);
  let crf = style.preview.crf;
  for (let tries = 0; ; tries++) {
    ffmpeg(["-i", src, "-vf", scale, "-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-pix_fmt", "yuv420p",
      "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
      "-c:a", "aac", "-b:a", `${style.preview.audioKbps}k`, "-movflags", "+faststart", prev]);
    if (mb(prev) <= style.sendLimitMB || tries >= 2) break;
    crf += 3;
  }
  if (mb(prev) > style.sendLimitMB) console.log(`WARN ${prev} is still over ${style.sendLimitMB} MB`);
  for (const f of [`${base}.mp4`, `${base}-share.mp4`, `${base}-silent.mp4`, prev]) report(f);
}

const r = spawnSync("python3", [join(here, "cuts.py"), "cues", "--work", work], { stdio: "inherit" });
if (r.status !== 0) process.exit(r.status || 1);
copyFileSync(join(work, "CUES.md"), join(dest, "CUES.md"));
console.log(join(dest, "CUES.md"));
console.log(`\ndelivered to ${dest}`);
