#!/usr/bin/env node
// Builds a release's promo video — a vertical 1080x1920 montage of what changed, cut to a song.
// The playbook (what to ask the user, how to judge each step) is .claude/commands/promo.md; this file
// only runs the steps, one at a time or all together.
//
//   node tools/promo/promo.mjs <step> --version 0.3.0 [--song file] [--look link] [--out dir]
//        [--drop-beat N] [--bpm N] [--base url]
//
// steps (in order):
//   notes    writes <work>/release-notes.md, the Stable release's page, for drafting lines.json
//   song     beat grid + first drop of --song → song.json (song.py)
//   record   headless Chromium on the live site, one take per shot, cut on the song's beats (record.mjs)
//   cards    the text cards from <work>/lines.json (cards.mjs)
//   compose  frames: footage + cards + camera (compose.py)
//   encode   frames + the song, starting so the drop lands on --drop-beat (default: the first demo,
//            which compose writes as dropBeat) → <out>/…-promo.mp4
//   all      song, record, cards, compose, encode
// <work> is tools/.cache/promo/v<version> (git-ignored); lines.json is the one file written by hand.
//
// Needs macOS (the recorder runs on the Metal GPU — software rendering stutters), uv, Playwright's
// Chromium, and a working ffmpeg (else imageio-ffmpeg through uv is used). It records the DEPLOYED site
// (--base, default Stable), so run it after the release is live, not before.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const here = new URL(".", import.meta.url).pathname;
const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    version: { type: "string" }, song: { type: "string" }, look: { type: "string" }, out: { type: "string" },
    "drop-beat": { type: "string" }, bpm: { type: "string" }, base: { type: "string" },
  },
});
const step = positionals[0];
if (!step || !o.version) { console.error("usage: node tools/promo/promo.mjs <notes|song|record|cards|compose|encode|all> --version X.Y.Z [flags]"); process.exit(2); }

const work = resolve(here, "../.cache/promo", `v${o.version}`);
mkdirSync(work, { recursive: true });
const out = resolve(o.out || join(homedir(), "Movies", `sine-visuals-lab-v${o.version}-promo`));
const env = { ...process.env, PROMO_WORK: work, ...(o.look ? { PROMO_LOOK: o.look } : {}), ...(o.base ? { BASE: o.base } : {}) };
const run = (cmd, args, extra = {}) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", env: { ...env, ...extra } });
  if (r.status !== 0) { console.error(`\n${cmd} ${args[0] ?? ""} failed (${r.status})`); process.exit(r.status || 1); }
};
const need = (f, why) => { if (!existsSync(f)) { console.error(`missing ${f} — ${why}`); process.exit(2); } };

function ffmpeg() {
  try { execFileSync("ffmpeg", ["-hide_banner", "-version"], { stdio: "ignore" }); return "ffmpeg"; } catch {}
  return execFileSync("uv", ["run", "-q", "--with", "imageio-ffmpeg", "python", "-c", "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"], { encoding: "utf8" }).trim();
}

const steps = {
  notes() {
    const body = execFileSync("gh", ["release", "view", `v${o.version}`, "--json", "body", "-q", ".body"], { encoding: "utf8" });
    writeFileSync(join(work, "release-notes.md"), body);
    console.log(`wrote ${join(work, "release-notes.md")}`);
  },
  song() {
    if (!o.song) { console.error("--song <audio file> is required"); process.exit(2); }
    run("uv", ["run", "-q", "--with", "librosa", "--with", "numpy", "--with", "soundfile", "python", join(here, "song.py"), resolve(o.song), join(work, "song.json"),
      ...(o.bpm ? ["--bpm", o.bpm] : [])]);
  },
  record() {
    const s = join(work, "song.json"); need(s, "run the song step first");
    run("node", [join(here, "record.mjs"), "intro", "all"], { BPM: String(JSON.parse(readFileSync(s, "utf8")).bpm) });
  },
  cards() { need(join(work, "lines.json"), "write lines.json (see .claude/commands/promo.md)"); run("node", [join(here, "cards.mjs")]); },
  compose() {
    need(join(work, "song.json"), "run the song step first");
    need(join(work, "cards", "meta.json"), "run the cards step first");
    run("uv", ["run", "-q", "--with", "pillow", "python", join(here, "compose.py")]);
  },
  encode() {
    const song = JSON.parse(readFileSync(join(work, "song.json"), "utf8"));
    const meta = JSON.parse(readFileSync(join(work, "frames", "meta.json"), "utf8"));
    if (song.dropTime == null) { console.error("song.json has no dropTime; pass a different --song or place the start by hand"); process.exit(2); }
    const dropBeat = Number(o["drop-beat"] ?? meta.dropBeat);
    const ss = song.dropTime - dropBeat * song.period;
    if (ss < 0) { console.error(`the drop is only ${song.dropTime}s into the song, too early for drop beat ${dropBeat}; pass a lower --drop-beat`); process.exit(2); }
    mkdirSync(out, { recursive: true });
    const file = join(out, `sine-visuals-lab-v${o.version}-promo.mp4`);
    run(ffmpeg(), ["-y", "-loglevel", "error", "-framerate", String(meta.fps), "-i", join(work, "frames", "%05d.jpg"),
      "-ss", ss.toFixed(4), "-t", meta.total.toFixed(3), "-i", resolve(song.file),
      "-af", `afade=t=in:st=0:d=0.5,afade=t=out:st=${(meta.total - 1.6).toFixed(3)}:d=1.6,aresample=48000`,
      "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
      "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-maxrate", "15M", "-bufsize", "30M", "-profile:v", "high",
      "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
      "-r", String(meta.fps), "-g", "60", "-movflags", "+faststart", "-c:a", "aac", "-b:a", "224k", "-shortest", file]);
    console.log(`\n${file}  (${meta.total.toFixed(1)} s)`);
  },
  all() { for (const s of ["song", "record", "cards", "compose", "encode"]) steps[s](); },
};
if (!steps[step]) { console.error(`unknown step "${step}"`); process.exit(2); }
steps[step]();
