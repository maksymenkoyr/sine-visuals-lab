#!/usr/bin/env node
// How late the picture reacts to the sound in a capture.mjs clip made from
// make-test-wav.mjs's track: that track is silent until a lone click at
// SYNC_SEC, so the first frame whose mean brightness jumps after it is the
// scene's reaction. Prints the per-frame luma around the click and the lag;
// pass the lag to capture.mjs --lag-ms to pull picture onto sound. Pick a
// scene that flashes on a hit (caustics does) — a scene that only drifts
// gives no clean edge.
//
//   node tools/promo/measure-sync.mjs clip.mp4 [--sync 1] [--from 0]
// (--from: the clip's --from, if it didn't start at the track's start)
import { ffmpeg } from "./ffmpeg.mjs";

const args = process.argv.slice(2);
const clip = args[0];
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? +args[i + 1] : d;
};
const sync = opt("--sync", 1) - opt("--from", 0);
const txt = ffmpeg(["-i", clip, "-t", String(sync + 1.5), "-vf", "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-", "-f", "null", "-"]);
const ys = [...txt.matchAll(/pts_time:([\d.]+)[\s\S]*?YAVG=([\d.]+)/g)].map((m) => ({ t: +m[1], y: +m[2] }));
// Noise floor of the frame-to-frame change before the click.
const pre = ys.filter((f) => f.t > sync - 0.6 && f.t < sync);
const d = (i) => ys[i].y - ys[i - 1].y;
const preD = pre.map((f) => Math.abs(d(ys.indexOf(f))));
const floor = Math.max(...preD, 0.05);
let hit = null;
for (let i = 1; i < ys.length; i++) {
  if (ys[i].t < sync - 0.05) continue;
  const s = ys[i].t >= sync - 0.05 && ys[i].t <= sync + 0.25 ? `${ys[i].t.toFixed(3)}  Y ${ys[i].y.toFixed(2)}  Δ ${d(i) >= 0 ? "+" : ""}${d(i).toFixed(2)}` : null;
  if (s) console.log(s);
  if (!hit && Math.abs(d(i)) > 3 * floor) hit = ys[i].t;
}
if (hit == null) {
  console.log(`no reaction above 3× the pre-click change (${floor.toFixed(2)})`);
  process.exit(1);
}
console.log(`pre-click change floor ${floor.toFixed(2)}; first reacting frame at ${hit.toFixed(3)} s → lag ${Math.round((hit - sync) * 1000)} ms`);
