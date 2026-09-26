import { describe, it, expect } from "vitest";
import { buildTracks, type Track } from "./tempoEval/synth.ts";
import { evaluate, type EvalMetrics } from "./tempoEval/run.ts";
import { GRID_LOCK_ON } from "../src/render/gridPulse.ts";

// Permanent offline scoreboard for the real FeatureExtractor + AnimClock
// tempo tracker (see tempoEval/synth.ts and run.ts) — `npm run eval:tempo`
// always prints the table, win or lose, so a tuning session can see the
// whole picture rather than just the first failing assert. Computed at
// module scope, once, rather than in a beforeAll: Vitest doesn't run a
// file's beforeAll at all when every it() in it is skipped, and this table
// has to print even while every assertion below is (see the next
// paragraph) — module-level code runs whenever the file is collected,
// skipped tests or not.
//
// The assertions started as `it.skip` (pre-tracker-change baseline — see the
// PR that introduced this file for that baseline table) and were switched on
// once the tracker changes they check for landed; see this file's git
// history for the exact baseline.

const tracks: Track[] = buildTracks();
const metrics: Record<string, EvalMetrics> = {};
for (const track of tracks) metrics[track.name] = evaluate(track, 60);
// The same tracks at half the frame rate: hits are timestamped to the render
// tick, so a slower device sees every hit later and more coarsely — the
// tick-placement targets below hold at both rates.
const metrics30: Record<string, EvalMetrics> = {};
for (const track of tracks) metrics30[track.name] = evaluate(track, 30);

function fmt(v: number, digits = 3): string {
  return Number.isFinite(v) ? v.toFixed(digits) : "--";
}

function printTable(label: string, rows: Record<string, EvalMetrics>): void {
  const table: Record<string, Record<string, string>> = {};
  for (const [name, m] of Object.entries(rows)) {
    table[name] = {
      tempoOk: fmt(m.tempoOk),
      tempoOkSteady: fmt(m.tempoOkSteady),
      timeToLockSec: fmt(m.timeToLockSec, 2),
      ticksOn30ms: fmt(m.ticksOn30ms),
      medianOffsetMs: fmt(m.medianOffsetMs, 1),
      lockWhenRight: fmt(m.lockWhenRight),
      lockWhenWrong: fmt(m.lockWhenWrong),
      lockNoTempo: fmt(m.lockNoTempo),
      endBpm: fmt(m.endBpm, 1),
      endLock: fmt(m.endLock),
    };
  }
  // eslint-disable-next-line no-console
  console.log(label);
  // eslint-disable-next-line no-console
  console.table(table);
}
printTable("60 fps", metrics);
printTable("30 fps", metrics30);

// Accuracy is scored after a WARMUP_SEC warm-up (tempoOkSteady), with the
// first lock's speed as its own column and target (timeToLockSec): the
// tempo prior (features.ts's tempoPrior) trades a slower first lock on a
// fast track — a few hits in, a 2:3 candidate nearer the prior's centre can
// briefly win — for no 4:3 lock on busy 16th-note hats, and the two numbers
// keep that trade visible instead of blending it into one. Lock is split by
// whether the tracker is right: a confidence worth having reads high when it
// is right and lower when it is wrong.
describe("tempo eval scoreboard", () => {
  it("house: tracks tempo tightly, holds most beats within 30ms, and lets go cleanly after the track ends", () => {
    expect(metrics.house!.tempoOkSteady).toBeGreaterThanOrEqual(0.9);
    expect(metrics.house!.ticksOn30ms).toBeGreaterThanOrEqual(0.6);
    expect(metrics.house!.endBpm).toBe(0);
    expect(metrics.house!.endLock).toBeLessThan(0.1);
  });

  it("hiphop: tracks tempo through the swing pattern", () => {
    expect(metrics.hiphop!.tempoOkSteady).toBeGreaterThanOrEqual(0.88);
    expect(metrics.hiphop!.ticksOn30ms).toBeGreaterThanOrEqual(0.9);
  });

  it("dnb: tracks tempo at 174bpm", () => {
    expect(metrics.dnb!.tempoOkSteady).toBeGreaterThanOrEqual(0.9);
    expect(metrics.dnb!.ticksOn30ms).toBeGreaterThanOrEqual(0.8);
  });

  it("steady tracks find their tempo within a few seconds", () => {
    for (const name of ["house", "hiphop", "dnb"]) {
      expect(metrics[name]!.timeToLockSec, name).toBeLessThanOrEqual(3);
    }
  });

  it("ramp: follows a drifting tempo well enough to be usable", () => {
    expect(metrics.ramp!.tempoOk).toBeGreaterThanOrEqual(0.4);
  });

  // Held to the beat grid's own switch-on line (gridPulse.ts): below it a
  // grid drive falls back to raw hits, which is the behaviour a beatless
  // track should get.
  it("random: doesn't fake a lock on unstructured hits", () => {
    expect(metrics.random!.lockNoTempo).toBeLessThan(GRID_LOCK_ON);
    expect(metrics30.random!.lockNoTempo).toBeLessThan(GRID_LOCK_ON);
  });

  it("30 fps: beats still land on the kick", () => {
    for (const name of ["house", "hiphop", "dnb"]) {
      expect(metrics30[name]!.ticksOn30ms, name).toBeGreaterThanOrEqual(0.8);
    }
  });

  // ramp is held to the comparison only, not the absolute level: its tempo
  // never stops moving, and the tracker only gets it right late in the track
  // (see its own timeToLockSec — the 4:3 lock the prior eventually breaks),
  // so most of its "right" frames sit inside tempoLock's own rise time.
  it("lock is high when the tempo is right, and lower when it is wrong", () => {
    for (const name of ["house", "hiphop", "dnb"]) {
      expect(metrics[name]!.lockWhenRight, name).toBeGreaterThanOrEqual(0.7);
    }
    expect(metrics.ramp!.lockWhenWrong).toBeLessThan(metrics.ramp!.lockWhenRight);
  });
});
