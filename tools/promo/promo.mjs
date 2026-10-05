#!/usr/bin/env node
// The one runner for the promo videos: the release video, the hook video and the explainer all go
// through these steps, and the playbooks (what to ask the user, how to judge each step) are the skills in
// .claude/commands/ (video-release, video-hook-stable, video-explainer) with docs/video-house-style.md.
//
//   node tools/promo/promo.mjs <step> [--video release|hook|explainer] [--work DIR] [--fmt v|h]
//        [--version 0.3.0] [--song file|link] [--look link] [--dest DIR] [--drop-beat N] [--bpm N]
//        [--base url] [--recorder new|legacy] [--print-plan] [take|clip name ...]
//
// The pipeline:  song -> plan -> record -> cards -> render -> check -> deliver   (`all` runs them)
//
//   step     what it does                                     file that runs it            writes (in <work>)
//   notes    the Stable release's page, for drafting lines    gh                           release-notes.md
//   song     beat grid + first drop (or the mix.json mix)     song.py, mix.py              song.json, song.wav
//   plan     the cut list, then the approval table            shapes/<video>.py, cuts.py   cuts.json
//   record   the footage (needs the Metal Mac and live        capture.mjs --take (frames   record.json, mic.wav,
//            Stable); `record <take>...` redoes only those    videos), capture.mjs clips   takes/, clips/
//                                                             (explainer; entries in takes.json)
//   cards    the text cards                                   cards.mjs -> cards/<video>.mjs   cards/ or caps/
//   compose  frames from takes + cards (frames videos)        compose.py                   frames/
//   encode   frames + the song's drop-aligned stretch         ffmpeg                       out/<video>-v.mp4
//   render   compose + encode, or edit.py per format          (above), showcase/edit.py    out/<video>-<fmt>.mp4
//   check    sync, repeats, loudness, length, safe band       check.py                     prints only
//   deliver  master, share, silent, preview, CUES.md          deliver.mjs                  ~/Movies/sine-visuals-lab-<video>-<tag>/
//
// <video> is --video, else the video in <work>/cuts.json, else hook. <work> is --work, else
// tools/.cache/promo/<video>/<tag> (git-ignored), the tag being v<Stable's version> for release and hook
// (--version overrides what Stable serves) and today's date for the explainer. song.wav, look.txt and
// mix.json carry over from the same video's earlier tags, then the other videos', then the older
// tools/.cache/promo/v* folders (remembered()).
//
// The data files and who reads them (each file's own header has the format):
//   lines.json     written by hand per video (release: demos and groups; hook: opening and proofs); read by
//                  shapes/release.py or shapes/hook.py and by cards/release.mjs or cards/hook.mjs
//   plan.json      optional, same readers: the opening/look/end/hold choices a Shape defaults
//   showcase.json  the explainer's input; read by shapes/explainer.py, cards/explainer.mjs and the prep scripts
//   song.json      song.py or mix.py; read by the Shapes, motion.py, check.py and the record step here
//   cuts.json      the resolved cut list the Shapes write (cuts.py header); read by cards.mjs, compose.py,
//                  edit.py, check.py, deliver.mjs and the steps here
//   record.json    written by `record` here; read by capture.mjs --take (its header) and the shots
//   takes.json     tools/promo/takes.json is the take table, <work>/takes.json overrides entries by name and
//                  holds the explainer's clip entries (capture.mjs header)
//   style.json     the tokens more than one file reads (safe band, per-video fps and length, delivery)
//
// --recorder legacy runs the old record.mjs (hook only, env-driven) until the new recorder has been
// checked on real footage. --print-plan on record lists the captures it would make and launches nothing.
// Needs macOS (the recorder runs on the Metal GPU, software rendering stutters), uv, Playwright's
// Chromium, and records the DEPLOYED site (--base, default Stable), so run it after the release is live.
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ffmpegPath } from "./ffmpeg.mjs";

const here = new URL(".", import.meta.url).pathname;
const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    video: { type: "string" }, work: { type: "string" }, recorder: { type: "string" }, fmt: { type: "string" }, dest: { type: "string" },
    "print-plan": { type: "boolean" },
    version: { type: "string" }, song: { type: "string" }, look: { type: "string" }, out: { type: "string" },
    "drop-beat": { type: "string" }, bpm: { type: "string" }, base: { type: "string" },
  },
});
const STEPS = ["notes", "song", "plan", "record", "cards", "compose", "encode", "render", "check", "deliver", "all"];
const step = positionals[0];
if (!STEPS.includes(step)) { console.error(`usage: node tools/promo/promo.mjs <${STEPS.join("|")}> [--video release|hook|explainer] [--work DIR] [flags]`); process.exit(2); }

// Every uv call takes its packages from here. pillow and imageio-ffmpeg are the versions that made the
// approved masters (regress.py pins the same), so a re-render reproduces them.
const UV_DEPS = {
  pillow: "pillow==12.3.0", ffmpeg: "imageio-ffmpeg==0.6.0", numpy: "numpy", soundfile: "soundfile",
  pyloudnorm: "pyloudnorm", librosa: "librosa",
};
const uvArgs = (deps, script, args) => ["run", "-q", ...deps.flatMap((d) => ["--with", UV_DEPS[d]]), "python", script, ...args];
const STABLE = "https://www.sinevisualslab.com";

const cache = resolve(here, "../.cache/promo");
const VIDEOS = ["release", "hook", "explainer"];
const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));
let video = o.video;
if (!video && o.work && existsSync(join(resolve(o.work), "cuts.json"))) video = readJson(join(resolve(o.work), "cuts.json")).video;
video ||= "hook";
if (!VIDEOS.includes(video)) { console.error(`unknown video "${video}" (release, hook or explainer)`); process.exit(2); }
const frames = video !== "explainer";

// Stable's version, fetched only when a release or hook step needs it and --version did not say.
async function version() {
  if (!o.version) {
    o.version = (await (await fetch(`${STABLE}/version.json`)).json()).version;
    console.log(`version ${o.version} (what Stable serves now)`);
  }
  return o.version;
}
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const work = o.work ? resolve(o.work)
  : join(cache, video, frames ? `v${await version()}` : today());
mkdirSync(work, { recursive: true });

// <work>/<file>, else the same video's other tags, then the other videos', then the older v* folders:
// the song, the look and the mix carry over between runs.
function remembered(file) {
  if (existsSync(join(work, file))) return join(work, file);
  const dirsOf = (root, keep) => existsSync(root)
    ? readdirSync(root).filter(keep).map((d) => join(root, d)).filter((d) => statSync(d).isDirectory() && resolve(d) !== work) : [];
  const newest = (dirs) => dirs.filter((d) => existsSync(join(d, file))).map((d) => join(d, file)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  const groups = [dirsOf(join(cache, video), () => true), ...VIDEOS.filter((v) => v !== video).map((v) => dirsOf(join(cache, v), () => true)), dirsOf(cache, (d) => /^v\d/.test(d))];
  for (const g of groups) {
    const hit = newest(g)[0];
    if (hit) { copyFileSync(hit, join(work, file)); console.log(`${file}: reusing ${hit}`); return join(work, file); }
  }
  return null;
}
if (o.look) writeFileSync(join(work, "look.txt"), o.look.trim() + "\n");
const lookFile = frames && ["record", "all"].includes(step) ? remembered("look.txt") : null;
const look = o.look || (lookFile && readFileSync(lookFile, "utf8").trim());
const base = o.base || STABLE;
const env = { ...process.env, PROMO_WORK: work, ...(look ? { PROMO_LOOK: look } : {}), ...(o.base ? { BASE: o.base } : {}) };
const run = (cmd, args, extra = {}) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", env: { ...env, ...extra } });
  if (r.status !== 0) { console.error(`\n${cmd} ${args[0] ?? ""} failed (${r.status})`); process.exit(r.status || 1); }
};
const need = (f, why) => { if (!existsSync(f)) { console.error(`missing ${f} — ${why}`); process.exit(2); } };
const cutsFile = join(work, "cuts.json");
const loadCuts = () => { need(cutsFile, "run the plan step first"); return readJson(cutsFile); };
const fmts = () => (o.fmt ? o.fmt.split(",") : loadCuts().formats);

// Scene takes hear the song from MIC_PRE beats before the video starts, for at least MIC_SPAN beats (more when
// the cut is longer), after up to MIC_LEAD beats of the song before that so the app's analyser has settled.
const MIC_PRE = 3, MIC_LEAD = 32, MIC_SPAN = 120;
// The legacy recorder's drop beat: the plan's `look` (the opening's length), unless --drop-beat says otherwise.
function legacyProofsStart() {
  const f = join(work, "plan.json"), plan = existsSync(f) ? readJson(f) : {};
  return plan.look ?? 4;
}
const legacyDropBeat = () => (o["drop-beat"] ? Number(o["drop-beat"]) : legacyProofsStart());

// The soundtrack stretch the scene takes hear, cut from the song so the drop sits at `drop` beats of the video.
function micPlan(drop, spanBeats) {
  const song = readJson(join(work, "song.json"));
  const P = song.period;
  const start = song.dropTime - (drop + MIC_PRE) * P;          // song time of the scene takes' beat 0
  const lead = Math.min(MIC_LEAD, Math.floor(start / P));
  if (lead < 8) { console.error(`the drop is only ${song.dropTime}s into the song — too early to give the scene takes a lead-in`); process.exit(2); }
  return { song, P, wavT0: start - lead * P, lead, span: Math.max(MIC_SPAN, spanBeats) };
}
function cutMic(m, srcFile) {
  const wav = join(work, "mic.wav");
  rmSync(wav, { force: true });   // a clone's wav may be a hard link to the original; never write through it
  run(ffmpegPath(), ["-y", "-loglevel", "error", "-ss", m.wavT0.toFixed(4), "-t", ((m.lead + m.span) * m.P + 2).toFixed(3), "-i", resolve(srcFile),
    "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", wav]);   // the format Chromium's fake mic reads
  return wav;
}
// Runs capture.mjs once per take, one at a time, and summarises; exits non-zero when a take FAILED.
function captureTakes(names) {
  const failed = [];
  for (const n of names) {
    const r = spawnSync("node", [join(here, "capture.mjs"), "--take", n, "--work", work, ...(o["print-plan"] ? ["--print-plan"] : [])], { stdio: "inherit", env });
    if (r.status !== 0) failed.push(`${n} (${r.status})`);
  }
  console.log(`\n${names.length - failed.length}/${names.length} takes ${o["print-plan"] ? "planned" : "recorded"}`);
  if (failed.length) { console.error(`FAILED: ${failed.join(", ")}`); process.exit(1); }
}

const steps = {
  async notes() {
    const body = execFileSync("gh", ["release", "view", `v${await version()}`, "--json", "body", "-q", ".body"], { encoding: "utf8" });
    writeFileSync(join(work, "release-notes.md"), body);
    console.log(`wrote ${join(work, "release-notes.md")}`);
  },
  song() {
    if (!frames) { console.log("the explainer's songs are listed in showcase.json; no song step"); return; }
    const wav = join(work, "song.wav");
    if (!o.song && (existsSync(join(work, "mix.json")) || (!existsSync(wav) && remembered("mix.json")))) {   // several songs cut into one soundtrack (mix.py)
      run("uv", uvArgs(["numpy", "soundfile"], join(here, "mix.py"), []), { FFMPEG: ffmpegPath() });
      return;
    }
    if (o.song) {
      let src = o.song;
      if (/^https?:/.test(src)) {   // a link: yt-dlp fetches the audio as is (it can't convert without a system ffmpeg)
        for (const f of readdirSync(work).filter((f) => f.startsWith("song.src."))) rmSync(join(work, f));
        run("uvx", ["yt-dlp", "--no-playlist", "-q", "-f", "ba", "-o", join(work, "song.src.%(ext)s"), src]);
        src = join(work, readdirSync(work).find((f) => f.startsWith("song.src.")));
      }
      run(ffmpegPath(), ["-y", "-loglevel", "error", "-i", resolve(src), "-ac", "2", "-ar", "44100", wav]);
    } else if (!remembered("song.wav")) { console.error("--song <file or link> is required (no earlier run's song to reuse)"); process.exit(2); }
    run("uv", uvArgs(["librosa", "numpy", "soundfile"], join(here, "song.py"), [wav, join(work, "song.json"), ...(o.bpm ? ["--bpm", o.bpm] : [])]));
  },
  plan() {
    need(join(work, frames ? "lines.json" : "showcase.json"), frames ? "write lines.json (see the video's skill)" : "write showcase.json (see showcase.example.json)");
    if (frames) need(join(work, "song.json"), "run the song step first");
    run("python3", [join(here, "shapes", `${video}.py`), "--work", work, ...(o["drop-beat"] ? ["--drop-beat", o["drop-beat"]] : [])]);
    run("python3", [join(here, "cuts.py"), "table", "--work", work]);
  },
  record() {
    const names = positionals.slice(1);
    if (!frames) {   // explainer: every clip entry in <work>/takes.json, in each of its sizes
      const f = join(work, "takes.json");
      need(f, "list the clip entries (mode 'clip') in <work>/takes.json");
      const showcase = existsSync(join(work, "showcase.json")) ? readJson(join(work, "showcase.json")) : {};
      mkdirSync(join(work, "clips"), { recursive: true });
      const entries = Object.entries(readJson(f).takes || {}).filter(([n, e]) => e.mode === "clip" && (!names.length || names.includes(n)));
      let count = 0;
      for (const [n, e] of entries) {
        const song = (showcase.songs || {})[e.song] || e.song;
        for (const [fmt, size] of Object.entries(e.sizes || {})) {
          const args = [join(here, "capture.mjs"), resolve(work, song), "--scene", e.scene, "--size", size, "--out", join(work, "clips", `${n}-${fmt}.mp4`),
            "--base", base, ...(e.look?.code ? ["--look", e.look.code] : []), ...(e.flags || []), ...(o["print-plan"] ? ["--print-plan"] : [])];
          console.log(`clip ${n}-${fmt}`);
          run("node", args, e.env || {});
          count++;
        }
      }
      console.log(`\n${count} clips ${o["print-plan"] ? "planned" : "recorded"}`);
      return;
    }
    need(join(work, "song.json"), "run the song step first");
    if (o.recorder === "legacy") {   // the old env-driven record.mjs, hook only
      if (video !== "hook") { console.error("--recorder legacy records the hook video only"); process.exit(2); }
      const drop = legacyDropBeat();
      const m = micPlan(drop, MIC_SPAN);
      const src = existsSync(m.song.file) ? m.song.file : (console.log(`song.json file ${m.song.file} is gone; using ${join(work, "song.wav")}`), join(work, "song.wav"));
      const wav = cutMic(m, src);
      run("node", [join(here, "record.mjs"), ...(names.length ? names : ["all"])], {
        BPM: String(m.song.bpm), DROP_BEAT: String(drop), PROOFS_START: String(legacyProofsStart()),
        MIC_WAV: wav, MIC_SONG_T0: String(m.wavT0), MIC_LEAD: String(m.lead), MIC_PRE: String(MIC_PRE), MIC_SPAN: String(m.span),
      });
      return;
    }
    const cuts = loadCuts();
    const drop = cuts.dropBeat;
    const m = micPlan(drop, cuts.frames.totalBeats + 8);
    console.log(`mic: drop beat ${drop}, wavT0 ${m.wavT0}, lead ${m.lead}, pre ${MIC_PRE}, span ${m.span}`);
    const wav = o["print-plan"] ? join(work, "mic.wav") : cutMic(m, cuts.song.file);
    const slots = {};
    for (const sg of cuts.frames.segments) if (!(sg.take in slots)) slots[sg.take] = sg.start;
    writeFileSync(join(work, "record.json"), JSON.stringify({
      bpm: m.song.bpm, P: 60000 / m.song.bpm, base, look: look || null,
      mic: { wav, songT0: m.wavT0, lead: m.lead, pre: MIC_PRE, span: m.span, drop },
      slots,
    }, null, 1));
    captureTakes(names.length ? names : Object.keys(slots));
  },
  cards() {
    need(join(work, frames ? "lines.json" : "showcase.json"), "write the video's input file first");
    run("node", [join(here, "cards.mjs"), "--work", work, "--video", video]);
  },
  compose() {
    if (!frames) { console.error("the explainer has no compose/encode step; use render"); process.exit(2); }
    need(join(work, "song.json"), "run the song step first");
    need(join(work, "cards", "meta.json"), "run the cards step first");
    loadCuts();
    run("uv", uvArgs(["pillow"], join(here, "compose.py"), ["--work", work]));
  },
  encode() {
    if (!frames) { console.error("the explainer has no compose/encode step; use render"); process.exit(2); }
    const cuts = loadCuts(), meta = readJson(join(work, "frames", "meta.json"));
    const song = readJson(join(work, "song.json")), ss = song.dropTime - cuts.dropBeat * song.period;   // as the legacy encode, from song.json's own period
    if (song.dropTime == null || ss < 0) { console.error(`the drop is too early in the song for drop beat ${cuts.dropBeat}; pass a lower --drop-beat to plan`); process.exit(2); }
    if (meta.dropBeat !== cuts.dropBeat) { console.error(`the frames were composed for a drop on beat ${meta.dropBeat}, not ${cuts.dropBeat}; re-run compose`); process.exit(2); }
    mkdirSync(join(work, "out"), { recursive: true });
    const file = join(work, "out", `${video}-v.mp4`);
    rmSync(file, { force: true });
    run(ffmpegPath(), ["-y", "-loglevel", "error", "-framerate", String(meta.fps), "-i", join(work, "frames", "%05d.jpg"),
      "-ss", ss.toFixed(4), "-t", meta.total.toFixed(3), "-i", resolve(cuts.song.file),
      // no fade-out (the user's call): the song stops on the bar line compose ends on; 40 ms only de-clicks it
      "-af", `afade=t=in:st=0:d=0.5,afade=t=out:st=${(meta.total - 0.04).toFixed(3)}:d=0.04,aresample=48000`,
      "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
      "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-maxrate", "15M", "-bufsize", "30M", "-profile:v", "high",
      "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
      "-r", String(meta.fps), "-g", "60", "-movflags", "+faststart", "-c:a", "aac", "-b:a", "224k", "-shortest", file]);
    console.log(`\n${file}  (${meta.total.toFixed(1)} s)`);
  },
  render() {
    if (frames) { steps.compose(); steps.encode(); return; }
    mkdirSync(join(work, "out"), { recursive: true });
    for (const f of fmts()) run("uv", uvArgs(["ffmpeg", "pyloudnorm", "soundfile", "numpy"], join(here, "showcase", "edit.py"), ["--work", work, f]));
  },
  check() {
    const cuts = loadCuts();
    const cmds = ["loud", "length", "safe", "repeats", "sync"];
    const r = spawnSync("uv", uvArgs(["ffmpeg", "numpy", "pillow"], join(here, "check.py"), ["--work", work, ...cmds, ...(o.fmt ? o.fmt.split(",") : cuts.formats)]), { stdio: "inherit", env });
    if (r.status !== 0) console.error(`check exited ${r.status}`);
  },
  deliver() {
    run("node", [join(here, "deliver.mjs"), "--work", work, ...((o.dest || o.out) ? ["--dest", o.dest || o.out] : [])]);
  },
  async all() {
    if (frames && !existsSync(join(work, "song.json"))) steps.song();
    for (const s of ["plan", "record", "cards", "render", "check", "deliver"]) await steps[s]();
  },
};
await steps[step]();
