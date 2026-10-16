import { describe, expect, it } from "vitest";
import { buildTracks, makeRng, SR, type Track } from "./tempoEval/synth.ts";
import { evaluate, type EvalOptions } from "./tempoEval/run.ts";

// Tap tempo (src/render/tapTempo.ts) through the same offline harness as
// tests/tempoEval.test.ts — the real extractor, the fixed-hop analyzer and
// the anim clock, solo mode at FPS — with taps scripted on the track's
// own clock. A separate file so `npm run eval:tempo`, which must print the
// same table before and after any tap work, is untouched. The numbers each
// scenario measured are printed as one table; the assertions hold the
// behaviour the tap promises: the tapped tempo and beat at once, the tap's
// octave kept while the music stays in it, and the tracker's own retune
// rule deciding when the music has moved on.

const tracks = new Map(buildTracks().map((t) => [t.name, t] as const));
const FPS = 60;
const SOLO: EvalOptions = { analyzer: true };

/** The end of a track's last tempo segment — where its music stops. */
function musicEnd(track: Track): number {
  return Math.max(...track.tempo.map((s) => s.to));
}

/** `tracks` played back to back, each starting where the one before's music
 *  ends (its tail mixed under the next one's start), ground truth shifted. */
function chain(name: string, parts: Track[]): Track {
  const offsets: number[] = [];
  let at = 0;
  for (const p of parts) {
    offsets.push(at);
    at += musicEnd(p);
  }
  const last = parts[parts.length - 1]!;
  const total = Math.ceil((offsets[offsets.length - 1]! + last.mono.length / SR) * SR);
  const mono = new Float32Array(total);
  parts.forEach((p, i) => {
    const start = Math.round(offsets[i]! * SR);
    for (let s = 0; s < p.mono.length && start + s < total; s++) mono[start + s] = mono[start + s]! + p.mono[s]!;
  });
  const shift = (xs: number[], i: number) => xs.map((x) => x + offsets[i]!);
  return {
    name,
    mono,
    tempo: parts.flatMap((p, i) => p.tempo.map((s) => ({ from: s.from + offsets[i]!, to: s.to + offsets[i]!, bpm: s.bpm }))),
    beats: parts.flatMap((p, i) => shift(p.beats, i)),
    gridBeats: parts.flatMap((p, i) => shift(p.gridBeats, i)),
  };
}

/** `count` taps at `bpm`, the first on the track's true beat nearest
 *  `nearSec`, each moved by up to ±jitterMs. */
function taps(track: Track, bpm: number, count: number, nearSec: number, jitterMs = 0, seed = 1): number[] {
  const first = track.beats.reduce((a, b) => (Math.abs(b - nearSec) < Math.abs(a - nearSec) ? b : a));
  const rand = makeRng(seed);
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(first + (i * 60) / bpm + ((rand() * 2 - 1) * jitterMs) / 1000);
  return out;
}

/** Signed distance (s) from `x` to the nearest of `beats`. */
function offBeat(x: number, beats: number[]): number {
  let best = Infinity;
  for (const b of beats) if (Math.abs(x - b) < Math.abs(best)) best = x - b;
  return best;
}

interface Run {
  /** The first frame a tap tempo guided the tracker. */
  shownAt: number;
  /** How long after the tap that made it take effect. */
  shownLag: number;
  shownBpm: number;
  /** The frame guidance ended, NaN if it never did. */
  releasedAt: number;
  /** [from, to): the metronome's BPM over it, min and max, and the share of time guided. */
  window(from: number, to: number): { min: number; max: number; guided: number };
  /** Metronome ticks in [from, to): the share within 30 ms of one of
   *  `beats`, and their median signed offset from the nearest, in ms. */
  onBeat(from: number, to: number, beats: number[]): { share: number; medianMs: number };
  /** Mean tempoLock over [from, to). */
  lock(from: number, to: number): number;
}

function play(track: Track, tapTimes: number[]): Run {
  const rows: { t: number; bpm: number; guided: boolean; lock: number }[] = [];
  const ticks: number[] = [];
  let prevBeats = 0;
  let prevOn = false;
  let prevT = 0;
  evaluate(track, FPS, {
    ...SOLO,
    taps: tapTimes,
    onFrame: (t, _frame, anim) => {
      rows.push({ t, bpm: anim.metronomeBpm, guided: anim.tapGuided, lock: anim.tempoLock });
      if (prevOn && anim.metronomeOn && anim.metronomeBeats > prevBeats) {
        for (let b = Math.floor(prevBeats) + 1; b <= Math.floor(anim.metronomeBeats); b++) {
          ticks.push(prevT + ((b - prevBeats) / (anim.metronomeBeats - prevBeats)) * (t - prevT));
        }
      }
      prevBeats = anim.metronomeBeats;
      prevOn = anim.metronomeOn;
      prevT = t;
    },
  });
  const shown = rows.find((r) => r.guided)!;
  const released = rows.find((r) => r.t > shown.t && !r.guided);
  const lastTap = Math.max(...tapTimes.filter((x) => x <= shown.t));
  return {
    shownAt: shown.t,
    shownLag: shown.t - lastTap,
    shownBpm: shown.bpm,
    releasedAt: released ? released.t : NaN,
    window(from, to) {
      const w = rows.filter((r) => r.t >= from && r.t < to);
      return {
        min: Math.min(...w.map((r) => r.bpm)),
        max: Math.max(...w.map((r) => r.bpm)),
        guided: w.filter((r) => r.guided).length / w.length,
      };
    },
    onBeat(from, to, beats) {
      const offs = ticks.filter((x) => x >= from && x < to).map((x) => offBeat(x, beats));
      if (offs.length === 0) return { share: NaN, medianMs: NaN };
      const sorted = [...offs].sort((a, b) => a - b);
      return { share: offs.filter((o) => Math.abs(o) <= 0.03).length / offs.length, medianMs: sorted[sorted.length >> 1]! * 1000 };
    },
    lock(from, to) {
      const w = rows.filter((r) => r.t >= from && r.t < to);
      return w.reduce((a, r) => a + r.lock, 0) / w.length;
    },
  };
}

const hiphop = tracks.get("hiphop")!;
const dnb = tracks.get("dnb")!;
const house = tracks.get("house")!;
const hiphopTwice = chain("hiphop×2", [hiphop, hiphop]);
const dnbThrice = chain("dnb×3", [dnb, dnb, dnb]);
const hiphopThenHouse = chain("hiphop→house", [hiphop, house]);
const houseStart = musicEnd(hiphop);
const HOLD_SEC = 20;

// Steady taps at hiphop's own tempo, jittered like a real hand.
const steadyTaps = taps(hiphopTwice, 90, 8, 10, 15, 11);
const steady = play(hiphopTwice, steadyTaps);
// The same run with one stray tap between the second and third beats.
const strayTaps = [...steadyTaps.slice(0, 2), steadyTaps[1]! + 0.4 * (60 / 90), ...steadyTaps.slice(2)];
const stray = play(hiphopTwice, strayTaps);
// dnb's tracker reads dnb's own tempo; the taps say half of it.
const halfTaps = taps(dnbThrice, 87, 6, 8, 15, 12);
const half = play(dnbThrice, halfTaps);
// hiphop's tracker reads hiphop's own tempo; the taps say twice that (every eighth note).
const doubleTaps = taps(hiphopTwice, 180, 8, 10, 10, 15);
const double = play(hiphopTwice, doubleTaps);
const hiphopEighths = hiphopTwice.beats.flatMap((b) => [b, b + 30 / 90]);
// Taps at hiphop's tempo, then the music turns into house, whose tempo is outside the tap's family.
const changeTaps = taps(hiphopThenHouse, 90, 6, 10, 15, 13);
const change = play(hiphopThenHouse, changeTaps);
// A deliberately wrong tap on hiphop.
const wrongTaps = taps(hiphopTwice, 110, 6, 10, 15, 14);
const wrong = play(hiphopTwice, wrongTaps);

function fmt(v: number, d = 2): string {
  return Number.isFinite(v) ? v.toFixed(d) : "--";
}

const holdFrom = (r: Run) => r.shownAt + 2;
const afterHold = (r: Run) => r.window(holdFrom(r), holdFrom(r) + HOLD_SEC);
const holdBeat = (r: Run, beats: number[]) => r.onBeat(holdFrom(r), holdFrom(r) + HOLD_SEC, beats);
const table: Record<string, Record<string, string>> = {};
for (const [name, r, track, changedAt] of [
  ["steady 90 on hiphop", steady, hiphopTwice, NaN],
  ["stray tap", stray, hiphopTwice, NaN],
  ["87 on dnb (174)", half, dnbThrice, NaN],
  ["180 on hiphop (90)", double, { beats: hiphopEighths }, NaN],
  ["90, then house 124", change, hiphopThenHouse, houseStart],
  ["wrong 110 on hiphop", wrong, hiphopTwice, NaN],
] as const) {
  const hold = afterHold(r);
  const beat = holdBeat(r, track.beats);
  table[name] = {
    shownAt: fmt(r.shownAt),
    shownLagMs: fmt(r.shownLag * 1000, 1),
    shownBpm: fmt(r.shownBpm),
    holdMin: fmt(hold.min),
    holdMax: fmt(hold.max),
    holdGuided: fmt(hold.guided),
    holdOn30ms: fmt(beat.share),
    holdOffsetMs: fmt(beat.medianMs, 1),
    holdLock: fmt(r.lock(holdFrom(r), holdFrom(r) + HOLD_SEC)),
    releasedAt: fmt(r.releasedAt),
    sinceChange: Number.isFinite(changedAt) ? fmt(r.releasedAt - changedAt) : "",
  };
}
// eslint-disable-next-line no-console
console.log(`tap tempo, solo mode, ${FPS} fps (hold = the ${HOLD_SEC} s from 2 s after the tap took effect)`);
// eslint-disable-next-line no-console
console.table(table);

describe("tap tempo through the tracker", () => {
  it("steady taps at the music's tempo show on the next frame and hold, on the beat", () => {
    expect(steady.shownLag).toBeLessThanOrEqual(1 / FPS + 1e-9);
    expect(Math.abs(steady.shownBpm - 90)).toBeLessThan(1.5);
    const hold = afterHold(steady);
    expect(hold.min).toBeGreaterThan(88);
    expect(hold.max).toBeLessThan(92);
    expect(hold.guided).toBe(1);
    expect(holdBeat(steady, hiphopTwice.beats).share).toBeGreaterThanOrEqual(0.85);
  });

  it("a stray tap changes nothing that matters", () => {
    expect(stray.shownLag).toBeLessThanOrEqual(1 / FPS + 1e-9);
    expect(Math.abs(stray.shownBpm - 90)).toBeLessThan(1.5);
    const hold = afterHold(stray);
    expect(hold.min).toBeGreaterThan(88);
    expect(hold.max).toBeLessThan(92);
    expect(hold.guided).toBe(1);
    expect(holdBeat(stray, hiphopTwice.beats).share).toBeGreaterThanOrEqual(0.85);
  });

  it("taps at half the tracker's tempo resolve the octave to the tap, and stay there", () => {
    expect(half.shownLag).toBeLessThanOrEqual(1 / FPS + 1e-9);
    expect(Math.abs(half.shownBpm - 87)).toBeLessThan(1.5);
    const hold = afterHold(half);
    expect(hold.min).toBeGreaterThan(85);
    expect(hold.max).toBeLessThan(89);
    expect(hold.guided).toBe(1);
    expect(holdBeat(half, dnbThrice.beats).share).toBeGreaterThanOrEqual(0.85);
  });

  it("taps at twice the tracker's tempo resolve the octave up to the tap", () => {
    expect(double.shownLag).toBeLessThanOrEqual(1 / FPS + 1e-9);
    expect(Math.abs(double.shownBpm - 180)).toBeLessThan(2);
    const hold = afterHold(double);
    expect(hold.min).toBeGreaterThan(178);
    expect(hold.max).toBeLessThan(182);
    expect(hold.guided).toBe(1);
    expect(holdBeat(double, hiphopEighths).share).toBeGreaterThanOrEqual(0.85);
  });

  it("when the music changes tempo, the tracker moves on and the guidance ends", () => {
    expect(afterHold(change).guided).toBeGreaterThan(0);
    expect(change.releasedAt).toBeGreaterThan(houseStart);
    const after = change.window(change.releasedAt + 1, musicEnd(hiphopThenHouse) - 1);
    expect(after.min).toBeGreaterThan(122);
    expect(after.max).toBeLessThan(126);
    expect(after.guided).toBe(0);
  });

  it("a wrong tap shows at once, then the retune rule takes the tracker back to the music", () => {
    expect(Math.abs(wrong.shownBpm - 110)).toBeLessThan(2);
    expect(Number.isFinite(wrong.releasedAt)).toBe(true);
    const after = wrong.window(wrong.releasedAt + 1, wrong.releasedAt + 11);
    expect(after.min).toBeGreaterThan(88);
    expect(after.max).toBeLessThan(92);
  });

  it("no taps: the harness's own numbers are exactly the same with the tap path switched on", () => {
    expect(evaluate(hiphop, FPS, { ...SOLO, taps: [] })).toEqual(evaluate(hiphop, FPS, SOLO));
  });
});
