// Runs the same tools/mic-gap.mjs takes through two detectors and scores both
// with one scorer, so their numbers can be read side by side:
//   app          tests/tempoEval/run.ts evaluate() with the default Auto on
//                (auto + gate + analyzer), the way app.ts runs solo.
//   synesthesia  the Synesthesia engine from the synesthesia-audio library.
//
// synesthesia-audio is a LOCAL-ONLY, OPTIONAL dependency. It is not bundled,
// not in package.json, not in THIRD-PARTY-NOTICES.md, and none of its code is
// copied here: it is loaded at run time from a sibling checkout (or
// SYNESTHESIA_AUDIO_DIR). The library derives from a commercial app's
// binaries, so keep it out of this AGPL repo. The tool exits with a message
// when that directory is missing.
//
//   node tools/mic-gap-compare.ts <session dir> [--noise-from <dir>] [--out <file>]
//
// Prints one table per song (tab/mic x app/synesthesia) plus the noise rows,
// and writes the full numbers as JSON (default <session dir>/compare.json).
// A session recorded from the synthetic calibration track (a `calibration-`
// song) also gets each take scored per section against that track's exact
// truth file, see scoreCalibrationLeg().
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { evaluate } from "../tests/tempoEval/run.ts";
import { readWav } from "../tests/tempoEval/recordings.ts";
import { SR, type Track } from "../tests/tempoEval/synth.ts";
import type { CalibrationTruth, Hit, Section } from "./mic-gap-synth.ts";

interface SongSignal {
  name: string;
  bpm: number;
  period: number;
  phi: number;
  songTimeAtTab0: number;
  lagMs: number;
}

interface SynEngine {
  processAudio(chunk: Float32Array): void;
  update(dt: number): void;
  uniforms: Record<string, number>;
}
type SynCtor = new (opts: { sampleRate: number }) => SynEngine;

/** One detector's output on one take, one entry per rendered frame (times in seconds). */
interface Trace {
  times: number[];
  onsets: number[];
  bpm: number[];
  level: number[];
  /** Synesthesia only: extra per-frame uniforms, kept for the JSON. */
  extra?: Record<string, number[]>;
}

const FPS = 60;
// The library's default analysis chunk.
const HOP = 512;
// Takes start with the player seeking; nothing before this is scored.
const SKIP_SEC = 1;
// An onset counts as on a beat within this, after the mic's delay is removed.
const MATCH_SEC = 0.05;
const TEMPO_SETTLE_SEC = 6;
const TEMPO_TOL_BPM = 2;
const TEMPO_LOCK_HOLD_SEC = 3;
// Tempo may also be right at a 2x or 0.5x multiple, within this share of it.
const OCTAVE_RATIOS = [1, 2, 0.5];
const OCTAVE_TOL = 0.02;
const CALIBRATION_PREFIX = "calibration-";
// The calibration truth lives in the main checkout's cache, as mic-gap-synth.ts writes it.
const TRUTH_PATH = "tools/.cache/mic-gap/synth/calibration.truth.json";
// Per-section tempo is scored over the tail of a section, past this share of its length.
const TEMPO_WINDOW_START_FRAC = 0.4;

type Pipeline = "app" | "synesthesia";
const PIPELINES: Pipeline[] = ["app", "synesthesia"];
type Group = "kick" | "snareClap" | "hats" | "bass";
const GROUPS: Record<Group, readonly Hit["instrument"][]> = {
  kick: ["kick"],
  snareClap: ["snare", "clap"],
  hats: ["hat", "openHat"],
  bass: ["bass"],
};
const GROUP_NAMES = Object.keys(GROUPS) as Group[];

export interface LegScore {
  beatRecall: number;
  onsetPrecision: number;
  onsetsPerBeat: number;
  onsetOffsetMs: number;
  tempoOk: number;
  tempoOkAnyOctave: number;
  timeToLockSec: number;
  endBpm: number;
  levelMedian: number;
}

export interface NoiseScore {
  onsetsPerMin: number;
  levelP10: number;
  levelMedian: number;
  levelP90: number;
}

/** One calibration section scored on one detector's take. NaN where the section has nothing to score. */
export interface SectionScore {
  section: string;
  recall: Record<Group, number>;
  precision: number;
  falsePerMin: number;
  tempoOk: number;
  tempoOkAnyOctave: number;
  levelMedian: number;
}

/** A truth hit moved onto a take's timeline. */
interface LegHit {
  t: number;
  instrument: Hit["instrument"];
  section: string;
}

function percentile(values: number[], p: number): number {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return NaN;
  return s[Math.floor(p * (s.length - 1))]!;
}

/** The sorted element nearest `t`, minus `t` (NaN for an empty list). */
function nearestDelta(sorted: number[], t: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < t) lo = mid + 1;
    else hi = mid;
  }
  let best = NaN;
  for (const i of [lo - 1, lo]) {
    if (i < 0 || i >= sorted.length) continue;
    const d = sorted[i]! - t;
    if (!(Math.abs(d) >= Math.abs(best))) best = d;
  }
  return best;
}

const isTempoOk = (b: number, trueBpm: number): boolean => Math.abs(b - trueBpm) <= TEMPO_TOL_BPM;
const isTempoOctaveOk = (b: number, trueBpm: number): boolean =>
  OCTAVE_RATIOS.some((m) => Math.abs(b - m * trueBpm) <= OCTAVE_TOL * m * trueBpm);
const share = (count: number, total: number): number => (total ? count / total : NaN);
const isNear = (sorted: number[], t: number): boolean => Math.abs(nearestDelta(sorted, t)) <= MATCH_SEC;

function timeToLock(t: Trace, trueBpm: number): number {
  let runStart = NaN;
  for (let i = 0; i < t.times.length; i++) {
    const right = isTempoOk(t.bpm[i]!, trueBpm);
    if (!right) {
      runStart = NaN;
      continue;
    }
    if (Number.isNaN(runStart)) runStart = t.times[i]!;
    if (t.times[i]! - runStart >= TEMPO_LOCK_HOLD_SEC) return runStart;
  }
  return NaN;
}

/** The one scorer both detectors go through. `grid` is the song's beat times in take seconds (mic already shifted by its delay). */
function score(t: Trace, grid: number[], trueBpm: number): LegScore {
  const onsets = t.onsets.filter((o) => o >= SKIP_SEC).sort((a, b) => a - b);
  const recalled = grid.filter((b) => Math.abs(nearestDelta(onsets, b)) <= MATCH_SEC).length;
  const precise = onsets.filter((o) => Math.abs(nearestDelta(grid, o)) <= MATCH_SEC).length;
  // onset minus beat, for the onsets that land on a beat
  const offs = onsets.map((o) => -nearestDelta(grid, o)).filter((d) => Math.abs(d) <= MATCH_SEC);
  const settled = t.bpm.filter((_, i) => t.times[i]! >= TEMPO_SETTLE_SEC);
  const settledShare = (ok: (b: number) => boolean) => share(settled.filter(ok).length, settled.length);
  const levels = t.level.filter((_, i) => t.times[i]! >= SKIP_SEC);
  return {
    beatRecall: recalled / Math.max(1, grid.length),
    onsetPrecision: precise / Math.max(1, onsets.length),
    onsetsPerBeat: onsets.length / Math.max(1, grid.length),
    onsetOffsetMs: percentile(offs, 0.5) * 1000,
    tempoOk: settledShare((b) => isTempoOk(b, trueBpm)),
    tempoOkAnyOctave: settledShare((b) => isTempoOctaveOk(b, trueBpm)),
    timeToLockSec: timeToLock(t, trueBpm),
    endBpm: t.bpm.length ? t.bpm[t.bpm.length - 1]! : NaN,
    levelMedian: percentile(levels, 0.5),
  };
}

function scoreNoise(t: Trace, durationSec: number): NoiseScore {
  const levels = t.level.filter((_, i) => t.times[i]! >= SKIP_SEC);
  return {
    onsetsPerMin: t.onsets.filter((o) => o >= SKIP_SEC).length / ((durationSec - SKIP_SEC) / 60),
    levelP10: percentile(levels, 0.1),
    levelMedian: percentile(levels, 0.5),
    levelP90: percentile(levels, 0.9),
  };
}

function runApp(track: Track): Trace {
  const t: Trace = { times: [], onsets: [], bpm: [], level: [] };
  evaluate(track, FPS, {
    analyzer: true,
    gate: true,
    auto: true,
    onFrame: (time, frame) => {
      t.times.push(time);
      if (frame.onset) t.onsets.push(time);
      t.bpm.push(frame.bpm);
      t.level.push(frame.level);
    },
  });
  return t;
}

function runSynesthesia(mono: Float32Array, Ctor: SynCtor): Trace {
  const e = new Ctor({ sampleRate: SR });
  const t: Trace = { times: [], onsets: [], bpm: [], level: [], extra: { syn_BassLevel: [], syn_BPMConfidence: [], syn_Hits: [] } };
  const dt = 1 / FPS;
  const nFrames = Math.floor((mono.length / SR) * FPS);
  // Only audio up to each frame's time is fed, as evaluate() feeds the app, so
  // neither detector sees the future.
  let fed = 0;
  let prevOnBeat = 0;
  for (let k = 0; k < nFrames; k++) {
    const time = k * dt;
    const upTo = Math.round(time * SR);
    while (fed + HOP <= upTo) {
      e.processAudio(mono.subarray(fed, fed + HOP));
      fed += HOP;
    }
    e.update(dt);
    const u = e.uniforms;
    // An onset is a rise of syn_OnBeat, not a threshold on it: the value jumps to
    // 1 only on a frame where the beat gate fires, and falls back within a frame
    // or two, so a threshold would also depend on the Reactivity setting.
    const onBeat = u.syn_OnBeat ?? 0;
    if (onBeat > prevOnBeat) t.onsets.push(time);
    prevOnBeat = onBeat;
    t.times.push(time);
    t.bpm.push(u.syn_BPM ?? NaN);
    t.level.push(u.syn_Level ?? NaN);
    t.extra!.syn_BassLevel!.push(u.syn_BassLevel ?? NaN);
    t.extra!.syn_BPMConfidence!.push(u.syn_BPMConfidence ?? NaN);
    t.extra!.syn_Hits!.push(u.syn_Hits ?? NaN);
  }
  return t;
}

function gridFor(s: SongSignal, durSec: number, delaySec: number): number[] {
  const grid: number[] = [];
  for (let b = s.phi; b - s.songTimeAtTab0 + delaySec < durSec; b += s.period) {
    const t = b - s.songTimeAtTab0 + delaySec;
    if (t > SKIP_SEC) grid.push(t);
  }
  return grid;
}

function framesIn(t: Trace, from: number, to: number): number[] {
  const idx: number[] = [];
  for (let i = 0; i < t.times.length; i++) {
    const at = t.times[i]!;
    if (at >= from && at < to) idx.push(i);
  }
  return idx;
}

function groupRecall(hits: LegHit[], onsets: number[]): number {
  return share(hits.filter((h) => isNear(onsets, h.t)).length, hits.length);
}

function tempoShares(bpms: number[], trueBpm: number | null): Pick<SectionScore, "tempoOk" | "tempoOkAnyOctave"> {
  if (trueBpm === null) return { tempoOk: NaN, tempoOkAnyOctave: NaN };
  return {
    tempoOk: share(bpms.filter((b) => isTempoOk(b, trueBpm)).length, bpms.length),
    tempoOkAnyOctave: share(bpms.filter((b) => isTempoOctaveOk(b, trueBpm)).length, bpms.length),
  };
}

/** `onsets` are the scored onsets (past the skip), sorted; `hits` and `truthTimes` are the section's truth on this take's timeline. */
function scoreSection(
  sec: Section,
  shift: number,
  durSec: number,
  t: Trace,
  onsets: number[],
  hits: LegHit[],
  truthTimes: number[],
): SectionScore {
  const lo = sec.from + shift;
  const hi = sec.to + shift;
  const winFrom = Math.max(lo, SKIP_SEC);
  const winTo = Math.min(hi, durSec);
  const onsetsIn = onsets.filter((o) => o >= winFrom && o < winTo);
  const here = hits.filter((h) => h.section === sec.name);
  const recall = Object.fromEntries(
    GROUP_NAMES.map((g) => [g, groupRecall(here.filter((h) => GROUPS[g].includes(h.instrument)), onsets)]),
  ) as Record<Group, number>;
  const tempoFrom = Math.max(lo + TEMPO_WINDOW_START_FRAC * (hi - lo), SKIP_SEC);
  const tempoBpms = framesIn(t, tempoFrom, winTo).map((i) => t.bpm[i]!);
  const levels = framesIn(t, winFrom, winTo).map((i) => t.level[i]!);
  // gainDb is null only for the silence parts of mic-gap-synth.ts's PLAN.
  const silent = sec.gainDb === null;
  return {
    section: sec.name,
    recall,
    precision: share(onsetsIn.filter((o) => isNear(truthTimes, o)).length, onsetsIn.length),
    falsePerMin: silent && winTo > winFrom ? onsetsIn.length / ((winTo - winFrom) / 60) : NaN,
    ...tempoShares(tempoBpms, sec.bpm),
    levelMedian: percentile(levels, 0.5),
  };
}

/** Scores one calibration take per section for both detectors. Truth moves onto the take as songTime - songTimeAtTab0 + delay. */
function scoreCalibrationLeg(
  song: SongSignal,
  delaySec: number,
  durSec: number,
  traces: Record<Pipeline, Trace>,
  truth: CalibrationTruth,
): Record<Pipeline, SectionScore[]> {
  const shift = delaySec - song.songTimeAtTab0;
  const hits: LegHit[] = truth.hits
    .map((h) => ({ t: h.time + shift, instrument: h.instrument, section: h.section }))
    .sort((a, b) => a.t - b.t);
  const truthTimes = hits.map((h) => h.t);
  const out = {} as Record<Pipeline, SectionScore[]>;
  for (const p of PIPELINES) {
    const onsets = traces[p].onsets.filter((o) => o >= SKIP_SEC).sort((a, b) => a - b);
    out[p] = truth.sections.map((sec) => scoreSection(sec, shift, durSec, traces[p], onsets, hits, truthTimes));
  }
  return out;
}

const TRUTH_COLS = ["kick", "snr+clp", "hats", "bass", "prec", "fa/min", "tempo", "octave", "level"];

function sectionCells(r: SectionScore): string[] {
  return [
    f(r.recall.kick),
    f(r.recall.snareClap),
    f(r.recall.hats),
    f(r.recall.bass),
    f(r.precision),
    f(r.falsePerMin, 1),
    f(r.tempoOk),
    f(r.tempoOkAnyOctave),
    f(r.levelMedian, 3),
  ];
}

function printSectionTable(title: string, byPipeline: Record<Pipeline, SectionScore[]>): void {
  const groupRow = ["", ...PIPELINES.flatMap((p) => [p, ...TRUTH_COLS.slice(1).map(() => "")])];
  const rows: string[][] = [groupRow, ["section", ...PIPELINES.flatMap(() => TRUTH_COLS)]];
  byPipeline.app.forEach((r, i) => rows.push([r.section, ...PIPELINES.flatMap((p) => sectionCells(byPipeline[p][i]!))]));
  const widths = groupRow.map((_, c) => Math.max(...rows.map((r) => r[c]!.length)));
  console.log(`\n${title}`);
  for (const r of rows) console.log("  " + r.map((c, i) => pad(c, widths[i]!)).join("  "));
}

function loadCalibrationTruth(songs: SongSignal[], path: string): CalibrationTruth | null {
  if (!songs.some((s) => s.name.startsWith(CALIBRATION_PREFIX))) return null;
  if (!existsSync(path)) {
    console.error(`mic-gap-compare: calibration takes need ${path}; render it with node tools/mic-gap-synth.ts`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, "utf8")) as CalibrationTruth;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const repoRoot = resolve(execSync("git rev-parse --path-format=absolute --git-common-dir", { encoding: "utf8" }).trim(), "..");
const synDir = process.env.SYNESTHESIA_AUDIO_DIR ?? join(repoRoot, "..", "synesthesia-audio");
const session = process.argv[2];
if (!session) {
  console.error("usage: node tools/mic-gap-compare.ts <session dir> [--noise-from <dir>] [--out <file>]");
  process.exit(2);
}
const entry = join(synDir, "src/index.ts");
if (!existsSync(entry)) {
  console.error(
    `mic-gap-compare: no synesthesia-audio checkout at ${synDir}. It is a local-only optional dependency, not bundled; set SYNESTHESIA_AUDIO_DIR to its directory.`,
  );
  process.exit(1);
}
const { SynesthesiaAudio } = (await import(entry)) as { SynesthesiaAudio: SynCtor };

const noiseDir = arg("--noise-from") ?? session;
const outPath = arg("--out") ?? join(session, "compare.json");
const signal = JSON.parse(readFileSync(join(session, "signal.json"), "utf8")) as { songs: SongSignal[] };
const truth = loadCalibrationTruth(signal.songs, join(repoRoot, TRUTH_PATH));

const f = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "  -  ");
const pad = (s: string, n: number) => s.padEnd(n);
const LEG_HEADER = ["leg", "recall", "prec", "on/beat", "offMs", "tempo", "octave", "lockS", "endBpm", "level"];

const noiseOut: Record<string, { app: NoiseScore; synesthesia: NoiseScore }> = {};
for (const file of readdirSync(noiseDir).filter((n) => /^noise.*\.(tab|mic)\.wav$/.test(n)).sort()) {
  const name = file.slice(0, -".wav".length);
  const mono = readWav(join(noiseDir, file));
  const dur = mono.length / SR;
  const noiseTrack: Track = { name, mono, tempo: [], beats: [], gridBeats: [] };
  noiseOut[name] = {
    app: scoreNoise(runApp(noiseTrack), dur),
    synesthesia: scoreNoise(runSynesthesia(mono, SynesthesiaAudio), dur),
  };
}
if (Object.keys(noiseOut).length) {
  console.log("noise (onsets/min, level p10 / median / p90)");
  for (const [name, legs] of Object.entries(noiseOut)) {
    for (const k of ["app", "synesthesia"] as const) {
      const n = legs[k];
      console.log(`  ${pad(`${name} ${k}`, 22)} ${f(n.onsetsPerMin, 1)}/min  ${f(n.levelP10, 3)} / ${f(n.levelMedian, 3)} / ${f(n.levelP90, 3)}`);
    }
  }
}

const songsOut = [];
const synthTruth: Record<string, Record<string, Record<Pipeline, SectionScore[]>>> = {};
for (const s of signal.songs) {
  const delaySec = s.lagMs / 1000;
  const results: Record<string, LegScore> = {};
  const extras: Record<string, Record<string, number>> = {};
  const rows: string[][] = [LEG_HEADER];
  const calibration = truth && s.name.startsWith(CALIBRATION_PREFIX) ? truth : null;
  const truthByLeg: Record<string, Record<Pipeline, SectionScore[]>> = {};
  for (const [leg, file, delay] of [
    ["tab", `${s.name}.tab.wav`, 0],
    ["mic", `${s.name}.mic.wav`, delaySec],
  ] as const) {
    const mono = readWav(join(session, file));
    const dur = mono.length / SR;
    const grid = gridFor(s, dur, delay);
    const track: Track = { name: `${s.name} ${leg}`, mono, tempo: [{ from: 0, to: dur, bpm: s.bpm }], beats: grid, gridBeats: grid };
    const app = runApp(track);
    const syn = runSynesthesia(mono, SynesthesiaAudio);
    const sc = { app: score(app, grid, s.bpm), synesthesia: score(syn, grid, s.bpm) };
    if (calibration) truthByLeg[leg] = scoreCalibrationLeg(s, delay, dur, { app, synesthesia: syn }, calibration);
    for (const k of ["app", "synesthesia"] as const) {
      const m = sc[k];
      results[`${leg}.${k}`] = m;
      rows.push([
        `${leg} ${k}`,
        f(m.beatRecall),
        f(m.onsetPrecision),
        f(m.onsetsPerBeat),
        f(m.onsetOffsetMs, 0),
        f(m.tempoOk),
        f(m.tempoOkAnyOctave),
        f(m.timeToLockSec, 1),
        f(m.endBpm, 1),
        f(m.levelMedian, 3),
      ]);
    }
    extras[`${leg}.synesthesia`] = Object.fromEntries(
      Object.entries(syn.extra!).map(([k, v]) => [`${k}Median`, percentile(v, 0.5)]),
    );
  }
  console.log(`\n${s.name} (${s.bpm.toFixed(1)} BPM, lag ${s.lagMs.toFixed(1)} ms)`);
  const widths = LEG_HEADER.map((_, c) => Math.max(...rows.map((r) => r[c]!.length)));
  for (const r of rows) console.log("  " + r.map((c, i) => pad(c, widths[i]!)).join("  "));
  if (calibration) {
    console.log(
      `  per section vs truth: kick / snr+clp / hats / bass = hit recall within ${MATCH_SEC * 1000} ms; prec = onsets within ${MATCH_SEC * 1000} ms of any hit; fa/min = silence only; tempo / octave = last ${Math.round((1 - TEMPO_WINDOW_START_FRAC) * 100)}% of section; level = median`,
    );
    for (const leg of ["tab", "mic"]) printSectionTable(`${s.name} ${leg}`, truthByLeg[leg]!);
    synthTruth[s.name] = truthByLeg;
  }
  songsOut.push({ name: s.name, bpm: s.bpm, lagMs: s.lagMs, legs: results, synesthesiaExtras: extras });
}

writeFileSync(
  outPath,
  JSON.stringify({ session, synesthesiaDir: synDir, noise: noiseOut, songs: songsOut, synthTruth }, null, 2),
);
console.log(`\nwrote ${outPath}`);
