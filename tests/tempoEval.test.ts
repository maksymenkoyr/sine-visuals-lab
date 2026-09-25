import { describe, it, expect } from "vitest";
import { buildTracks, type Track } from "./tempoEval/synth.ts";
import { evaluate, type EvalMetrics } from "./tempoEval/run.ts";

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

function fmt(v: number, digits = 3): string {
  return Number.isFinite(v) ? v.toFixed(digits) : "--";
}

const table: Record<string, Record<string, string>> = {};
for (const [name, m] of Object.entries(metrics)) {
  table[name] = {
    tempoOk: fmt(m.tempoOk),
    ticksOn30ms: fmt(m.ticksOn30ms),
    medianOffsetMs: fmt(m.medianOffsetMs, 1),
    lockInTempo: fmt(m.lockInTempo),
    lockNoTempo: fmt(m.lockNoTempo),
    endBpm: fmt(m.endBpm, 1),
    endLock: fmt(m.endLock),
  };
}
// eslint-disable-next-line no-console
console.table(table);

describe("tempo eval scoreboard", () => {
  it("house: tracks tempo tightly, holds most beats within 30ms, and lets go cleanly after the track ends", () => {
    expect(metrics.house!.tempoOk).toBeGreaterThanOrEqual(0.9);
    expect(metrics.house!.ticksOn30ms).toBeGreaterThanOrEqual(0.6);
    expect(metrics.house!.endBpm).toBe(0);
    expect(metrics.house!.endLock).toBeLessThan(0.1);
  });

  it("hiphop: tracks tempo through the swing pattern", () => {
    expect(metrics.hiphop!.tempoOk).toBeGreaterThanOrEqual(0.88);
    expect(metrics.hiphop!.ticksOn30ms).toBeGreaterThanOrEqual(0.9);
  });

  // Known gap, left failing rather than loosened (see the plan/PR this
  // harness shipped with): tempoOk reads straight off FeatureExtractor.bpm,
  // upstream of every parameter this PR was allowed to tune (all in
  // beatClock.ts/animClock.ts). dnb's shortfall is almost entirely its own
  // few-second warm-up before the comb first locks onto 174bpm — nothing
  // downstream can move that.
  it("dnb: tracks tempo at 174bpm", () => {
    expect(metrics.dnb!.tempoOk).toBeGreaterThanOrEqual(0.9);
    expect(metrics.dnb!.ticksOn30ms).toBeGreaterThanOrEqual(0.8);
  });

  it("ramp: follows a drifting tempo well enough to be usable", () => {
    expect(metrics.ramp!.tempoOk).toBeGreaterThanOrEqual(0.4);
  });

  it("random: doesn't fake a lock on unstructured hits", () => {
    expect(metrics.random!.lockNoTempo).toBeLessThanOrEqual(0.3);
  });

  // ramp's own lockInTempo is the other known gap: FeatureExtractor.bpm
  // itself drifts onto a wrong (often 4:3-ish) candidate for long stretches
  // during the ramp — tempoPrior (features.ts) softens this but doesn't
  // eliminate it on a continuously-drifting tempo, and the comb naturally
  // (and correctly) reads low confidence while it's combing at that wrong
  // period. PHASE_BASS/STABILITY_ALPHA (both tuned up for this PR) improved
  // it substantially (0.52 -> 0.58) but pushing either further starts
  // breaking `random`'s own lockNoTempo target instead — see beatClock.ts's
  // own STABILITY_ALPHA/PHASE_BASS comments for what was tried.
  it("every music track locks in confidently while a tempo is actually playing", () => {
    for (const name of ["house", "hiphop", "dnb", "ramp"]) {
      expect(metrics[name]!.lockInTempo, name).toBeGreaterThanOrEqual(0.7);
    }
  });
});
