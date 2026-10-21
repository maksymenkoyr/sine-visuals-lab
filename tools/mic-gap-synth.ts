// Renders the calibration track that tools/mic-gap.mjs plays: one mono 16-bit
// WAV whose every hit is known to the sample, so the tab share and the mic can
// each be scored against exact truth (tools/mic-gap-analyze.ts reads the truth
// file back). Built from the instruments in tests/tempoEval/synth.ts.
//
//   node tools/mic-gap-synth.ts
//
// Writes into tools/.cache/mic-gap/synth/ under the main checkout, the root
// tools/mic-gap.mjs uses, so a worktree writes to the same place:
//   calibration.wav         the track
//   calibration.song.json   the fields mic-gap.mjs and mic-gap-signal.py read
//   calibration.truth.json  the sections, every hit, and beats/gridBeats/tempo
//                           in the Track shape tests/tempoEval/run.ts evaluate() takes
//
// The song.json grid is the first house section's: mic-gap-signal.py grades the
// whole file against one grid. Only sections with a `bpm` are tempo truth; their
// beats and grid go into the truth lists. The other sections only contribute hits.
// The section list is `PLAN`.
//
// Deterministic: the one RNG is seeded with `SEED`, so every run writes the same bytes.
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as synth from "../tests/tempoEval/synth.ts";
import type { Track, TempoSegment } from "../tests/tempoEval/synth.ts";

const { SR } = synth;
const SEED = 585;
const HOUSE_BPM = 128;
const DNB_BPM = 174;
const HIPHOP_BPM = 86;
const BEATS_PER_BAR = 4;
const STEPS_PER_BEAT = 4;
const STEPS_PER_BAR = BEATS_PER_BAR * STEPS_PER_BEAT;
const SILENCE_SEC = 3;
const LADDER_DB = [-6, -12, -18, -24];
const LONE_KICK_SEC = 12;
const LONE_LEAD_SEC = 0.3;
const LONE_GAP_MIN_SEC = 0.35;
const LONE_GAP_MAX_SEC = 0.9;
// Same note length as the groove's bass (synth.ts's KICK_BASS_DUR_FRAC, which isn't exported).
const BASS_NOTE_FRAC = 0.45;
const HIPHOP_SWING_FRAC = 0.1;
// Room past a section's end for drum, bass and pad tails; they are summed into the track.
const SECTION_TAIL_SEC = 1;
// mic-gap.mjs starts each take this far before `dropTime`. Setting it to the same lead
// makes every take start at the track's beginning.
const DROP_TIME_SEC = 15;

export interface Hit {
  time: number;
  instrument: "kick" | "snare" | "clap" | "hat" | "openHat" | "bass" | "pad";
  velocity: number;
  section: string;
}

export interface Section {
  name: string;
  from: number;
  to: number;
  bpm: number | null;
  gainDb: number | null;
  rmsDb: number | null;
}

export type CalibrationTruth = Omit<Track, "mono"> & {
  duration: number;
  sections: Section[];
  hits: Hit[];
};

export interface SongFields {
  id: string;
  bpm: number;
  period: number;
  phi: number;
  dropTime: number;
  duration: number;
}

interface Score {
  hits: Hit[];
  beats: number[];
  gridBeats: number[];
  tempo: TempoSegment[];
}

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;
const round2 = (x: number): number => Math.round(x * 100) / 100;

// Instrument calls take section-local times; the hit list records absolute ones.
class Pen {
  private readonly out: Float32Array;
  private readonly score: Score;
  private readonly section: string;
  private readonly from: number;
  readonly rand: () => number;

  constructor(out: Float32Array, score: Score, section: string, from: number, rand: () => number) {
    this.out = out;
    this.score = score;
    this.section = section;
    this.from = from;
    this.rand = rand;
  }

  private note(t: number, instrument: Hit["instrument"], velocity: number): void {
    this.score.hits.push({ time: round6(this.from + t), instrument, velocity, section: this.section });
  }

  kick(t: number, v = 1): void {
    this.note(t, "kick", v);
    synth.kick(this.out, SR, t, v, this.rand);
  }

  snare(t: number, v = 1): void {
    this.note(t, "snare", v);
    synth.snare(this.out, SR, t, v, this.rand);
  }

  clap(t: number, v = 1): void {
    this.note(t, "clap", v);
    synth.clap(this.out, SR, t, v, this.rand);
  }

  hat(t: number, v: number): void {
    this.note(t, "hat", v);
    synth.hat(this.out, SR, t, v, this.rand, false);
  }

  openHat(t: number, v: number): void {
    this.note(t, "openHat", v);
    synth.hat(this.out, SR, t, v, this.rand, true);
  }

  bass(t: number, freq: number, dur: number, v = 1): void {
    this.note(t, "bass", v);
    synth.bass(this.out, SR, t, freq, dur, v);
  }

  pad(t: number, freqs: number[], dur: number, v: number): void {
    this.note(t, "pad", v);
    synth.pad(this.out, SR, t, freqs, dur, v);
  }

  // A beat of a tempo section's grid. `drum` marks whether a drum sits on it,
  // which decides whether it is in `beats` as well as `gridBeats`.
  beat(t: number, drum: boolean): void {
    this.score.gridBeats.push(round6(this.from + t));
    if (drum) this.score.beats.push(round6(this.from + t));
  }
}

type Play = (pen: Pen) => void;

interface Part {
  name: string;
  bpm: number | null;
  gainDb: number | null;
  sec: number;
  play: Play;
}

const barsSec = (bars: number, bpm: number): number => (bars * BEATS_PER_BAR * 60) / bpm;

// Kick on every beat, clap on the second and fourth, a bass note under each off-beat, a pad per bar.
function houseGroove(pen: Pen, bpm: number, bars: number): void {
  const beatSec = 60 / bpm;
  const stepSec = beatSec / STEPS_PER_BEAT;
  for (let s = 0; s < bars * STEPS_PER_BAR; s++) {
    const t = s * stepSec;
    const bar = Math.floor(s / STEPS_PER_BAR);
    const st = s % STEPS_PER_BAR;
    if (st === 0) pen.pad(t, synth.CHORDS[bar % synth.CHORDS.length]!, beatSec * BEATS_PER_BAR, 0.7);
    if (st % STEPS_PER_BEAT === 0) {
      pen.kick(t);
      pen.beat(t, true);
    }
    if (st === 4 || st === 12) pen.clap(t);
    offBeatHats(pen, t, st);
    if (st % STEPS_PER_BEAT === 2) pen.bass(t, synth.ROOT[bar % synth.ROOT.length]! * 2, beatSec * BASS_NOTE_FRAC);
  }
}

function offBeatHats(pen: Pen, t: number, st: number): void {
  if (st % STEPS_PER_BEAT === 2) pen.openHat(t, 1);
  else if (st % STEPS_PER_BEAT !== 0) pen.hat(t, 0.5);
}

// The same off-beat hats as the groove, with no drum on the beat: the grid keeps
// ticking, but there is nothing audible on it for `beats` to list.
function breakdown(pen: Pen, bpm: number, bars: number): void {
  const beatSec = 60 / bpm;
  const stepSec = beatSec / STEPS_PER_BEAT;
  for (let s = 0; s < bars * STEPS_PER_BAR; s++) {
    const t = s * stepSec;
    const bar = Math.floor(s / STEPS_PER_BAR);
    const st = s % STEPS_PER_BAR;
    if (st === 0) pen.pad(t, synth.CHORDS[bar % synth.CHORDS.length]!, beatSec * BEATS_PER_BAR, 1.5);
    if (st % STEPS_PER_BEAT === 0) pen.beat(t, false);
    offBeatHats(pen, t, st);
  }
}

function hatsAlone(pen: Pen, bpm: number, bars: number): void {
  const stepSec = 60 / bpm / STEPS_PER_BEAT;
  for (let s = 0; s < bars * STEPS_PER_BAR; s++) offBeatHats(pen, s * stepSec, s % STEPS_PER_BAR);
}

function subBassAlone(pen: Pen, bpm: number, bars: number): void {
  const beatSec = 60 / bpm;
  for (let b = 0; b < bars * BEATS_PER_BAR; b++) {
    const root = synth.ROOT[Math.floor(b / BEATS_PER_BAR) % synth.ROOT.length]!;
    pen.bass(b * beatSec, root, beatSec * BASS_NOTE_FRAC, 1);
  }
}

function dnb(pen: Pen): void {
  const beatSec = 60 / DNB_BPM;
  const stepSec = beatSec / STEPS_PER_BEAT;
  for (let s = 0; s < 16 * STEPS_PER_BAR; s++) {
    const t = s * stepSec;
    const bar = Math.floor(s / STEPS_PER_BAR);
    const st = s % STEPS_PER_BAR;
    if (st === 0 || st === 10) pen.kick(t);
    if (st === 4 || st === 12) pen.snare(t);
    pen.hat(t, st % 2 === 0 ? 0.6 : 0.25);
    if (st === 0) pen.bass(t, synth.ROOT[bar % synth.ROOT.length]!, beatSec * 3.5, 1.2);
    if (st === 0 && bar % 2 === 0) pen.pad(t, synth.CHORDS[Math.floor(bar / 2) % synth.CHORDS.length]!, beatSec * 8, 0.7);
    if (st % STEPS_PER_BEAT === 0) pen.beat(t, true);
  }
}

function hiphop(pen: Pen): void {
  const beatSec = 60 / HIPHOP_BPM;
  const stepSec = beatSec / STEPS_PER_BEAT;
  for (let s = 0; s < 8 * STEPS_PER_BAR; s++) {
    const t = s * stepSec;
    const bar = Math.floor(s / STEPS_PER_BAR);
    const st = s % STEPS_PER_BAR;
    if (st === 0 || st === 7 || st === 10) {
      pen.kick(t);
      pen.bass(t, synth.ROOT[bar % synth.ROOT.length]!, beatSec * BASS_NOTE_FRAC);
    }
    if (st === 4 || st === 12) pen.snare(t);
    if (st % 2 === 0) {
      if (st % STEPS_PER_BEAT === 0) pen.hat(t, 0.7);
      else pen.hat(t + HIPHOP_SWING_FRAC * beatSec, 0.45);
    }
    if (st === 15) pen.hat(t, 0.25);
    if (st === 0 && bar % 2 === 0) pen.pad(t, synth.CHORDS[Math.floor(bar / 2) % synth.CHORDS.length]!, beatSec * 8, 0.7);
    if (st % STEPS_PER_BEAT === 0) pen.beat(t, true);
  }
}

function loneKicks(pen: Pen): void {
  let t = LONE_LEAD_SEC;
  while (t < LONE_KICK_SEC) {
    pen.kick(t);
    t += LONE_GAP_MIN_SEC + pen.rand() * (LONE_GAP_MAX_SEC - LONE_GAP_MIN_SEC);
  }
}

// Order is playback order. `bpm` is set only for tempo truth; sections that
// keep a grid but aren't scored for tempo (hats, sub-bass) carry null.
const PLAN: Part[] = [
  { name: "lead-in silence", bpm: null, gainDb: null, sec: SILENCE_SEC, play: () => {} },
  { name: "house", bpm: HOUSE_BPM, gainDb: 0, sec: barsSec(16, HOUSE_BPM), play: (p) => houseGroove(p, HOUSE_BPM, 16) },
  { name: "breakdown", bpm: HOUSE_BPM, gainDb: 0, sec: barsSec(4, HOUSE_BPM), play: (p) => breakdown(p, HOUSE_BPM, 4) },
  { name: "house again", bpm: HOUSE_BPM, gainDb: 0, sec: barsSec(8, HOUSE_BPM), play: (p) => houseGroove(p, HOUSE_BPM, 8) },
  ...LADDER_DB.map(
    (db): Part => ({
      name: `ladder ${db} dB`,
      bpm: HOUSE_BPM,
      gainDb: db,
      sec: barsSec(4, HOUSE_BPM),
      play: (p) => houseGroove(p, HOUSE_BPM, 4),
    }),
  ),
  { name: "dnb", bpm: DNB_BPM, gainDb: 0, sec: barsSec(16, DNB_BPM), play: dnb },
  { name: "hip-hop", bpm: HIPHOP_BPM, gainDb: 0, sec: barsSec(8, HIPHOP_BPM), play: hiphop },
  { name: "lone kicks", bpm: null, gainDb: 0, sec: LONE_KICK_SEC, play: loneKicks },
  { name: "hats alone", bpm: null, gainDb: 0, sec: barsSec(4, HOUSE_BPM), play: (p) => hatsAlone(p, HOUSE_BPM, 4) },
  { name: "sub-bass alone", bpm: null, gainDb: 0, sec: barsSec(4, HOUSE_BPM), play: (p) => subBassAlone(p, HOUSE_BPM, 4) },
  { name: "tail silence", bpm: null, gainDb: null, sec: SILENCE_SEC, play: () => {} },
];

function rmsDb(x: Float32Array, from: number, to: number): number | null {
  const a = Math.round(from * SR);
  const b = Math.round(to * SR);
  let sum = 0;
  for (let i = a; i < b; i++) sum += x[i]! * x[i]!;
  if (sum === 0) return null;
  return round2(10 * Math.log10(sum / (b - a)));
}

export function renderCalibration(): { mono: Float32Array; truth: CalibrationTruth; song: SongFields } {
  const rand = synth.makeRng(SEED);
  const total = PLAN.reduce((sum, p) => sum + p.sec, 0);
  const master = new Float32Array(Math.round(total * SR));
  const score: Score = { hits: [], beats: [], gridBeats: [], tempo: [] };
  const sections: Section[] = [];
  let from = 0;
  for (const part of PLAN) {
    const to = from + part.sec;
    const scratch = new Float32Array(Math.round((part.sec + SECTION_TAIL_SEC) * SR));
    part.play(new Pen(scratch, score, part.name, from, rand));
    const gain = part.gainDb === null ? 1 : 10 ** (part.gainDb / 20);
    const at = Math.round(from * SR);
    for (let i = 0; i < scratch.length && at + i < master.length; i++) master[at + i]! += scratch[i]! * gain;
    if (part.bpm !== null) score.tempo.push({ from: round6(from), to: round6(to), bpm: part.bpm });
    sections.push({
      name: part.name,
      from: round6(from),
      to: round6(to),
      bpm: part.bpm,
      gainDb: part.gainDb,
      rmsDb: null,
    });
    from = to;
  }
  synth.finish(master);
  for (const s of sections) s.rmsDb = rmsDb(master, s.from, s.to);

  const duration = master.length / SR;
  const period = 60 / HOUSE_BPM;
  const firstHouse = sections.find((s) => s.name === "house")!;
  score.hits.sort((a, b) => a.time - b.time);
  const truth: CalibrationTruth = {
    name: "calibration",
    duration,
    sections,
    hits: score.hits,
    tempo: score.tempo,
    beats: score.beats,
    gridBeats: score.gridBeats,
  };
  const song: SongFields = {
    id: "calibration",
    bpm: HOUSE_BPM,
    period,
    phi: firstHouse.from % period,
    dropTime: DROP_TIME_SEC,
    duration,
  };
  return { mono: master, truth, song };
}

export function encodeWav(mono: Float32Array): Buffer {
  const n = mono.length;
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24);
  b.writeUInt32LE(SR * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(mono[i]! * 32767))), 44 + i * 2);
  }
  return b;
}

function main(): void {
  const mainRoot = resolve(execSync("git rev-parse --path-format=absolute --git-common-dir", { encoding: "utf8" }).trim(), "..");
  const dir = join(mainRoot, "tools/.cache/mic-gap/synth");
  mkdirSync(dir, { recursive: true });
  const wavPath = join(dir, "calibration.wav");
  const songPath = join(dir, "calibration.song.json");
  const truthPath = join(dir, "calibration.truth.json");
  const { mono, truth, song } = renderCalibration();
  writeFileSync(wavPath, encodeWav(mono));
  writeFileSync(songPath, `${JSON.stringify({ ...song, file: relative(mainRoot, wavPath) }, null, 1)}\n`);
  writeFileSync(truthPath, `${JSON.stringify(truth, null, 1)}\n`);
  console.log(`calibration track: ${truth.duration.toFixed(3)} s, ${truth.hits.length} hits`);
  for (const s of truth.sections) {
    console.log(`  ${s.name}: ${s.from}-${s.to} s, bpm ${s.bpm ?? "-"}, gain ${s.gainDb ?? "-"} dB, rms ${s.rmsDb ?? "-"} dB`);
  }
  console.log(wavPath);
  console.log(songPath);
  console.log(truthPath);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
