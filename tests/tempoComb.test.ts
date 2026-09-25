import { describe, it, expect } from "vitest";
import { estimateTempo, BPM_MIN, BPM_MAX, type TempoOnsetVote } from "../src/audio/tempoComb.ts";

// features.ts's own COMB_TOL_SEC/REFINE_TOL_SEC/PERIOD_STEP_SEC/
// TEMPO_SWITCH_MARGIN — this test doesn't import them (they're private to
// features.ts) but mirrors their shape so the scenarios below behave the
// way the render-tick pipeline actually would.
const OPTS = { tolSec: 0.03, refineTolSec: 0.015, recencySec: 0, switchMargin: 1.25, periodStepSec: 0.0025, bpmMin: BPM_MIN, bpmMax: BPM_MAX };

function clickTrain(bpm: number, count: number, startTime = 0, weight = 1): TempoOnsetVote[] {
  const period = 60 / bpm;
  const out: TempoOnsetVote[] = [];
  for (let i = 0; i < count; i++) out.push({ time: startTime + i * period, weight });
  return out;
}

describe("estimateTempo", () => {
  it("returns null with fewer than three onsets", () => {
    expect(estimateTempo([], 0, 0, OPTS)).toBeNull();
    expect(estimateTempo(clickTrain(120, 2), 1, 0, OPTS)).toBeNull();
  });

  it("finds the tempo of a steady click train", () => {
    const onsets = clickTrain(120, 12);
    const now = onsets[onsets.length - 1]!.time;
    const bpm = estimateTempo(onsets, now, 0, OPTS);
    expect(bpm).not.toBeNull();
    expect(bpm!).toBeGreaterThan(119);
    expect(bpm!).toBeLessThan(121);
  });

  // Mirrors tests/features.test.ts's "prefers the tempo people actually tap
  // on a busy 16th-note pattern" — same construction, at the estimateTempo
  // level directly: without tempoPrior's bias toward the octave most music
  // sits in, a 4:3 sub-candidate (three 16ths) fits every gap just as
  // exactly as the true beat and can out-score it.
  it("prior favors the true beat over a busy 4:3 sub-candidate on a tie", () => {
    const bpm = 110;
    const sixteenthSec = 60 / bpm / 4;
    const onsets: TempoOnsetVote[] = [];
    for (let step = 1; step <= 48; step++) {
      const onBeat = step % 4 === 0;
      onsets.push({ time: step * sixteenthSec, weight: onBeat ? 4 : 1 });
    }
    const now = onsets[onsets.length - 1]!.time;
    const result = estimateTempo(onsets, now, 0, OPTS);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(bpm - 3);
    expect(result!).toBeLessThan(bpm + 3);
  });

  it("hysteresis holds the current tempo against a rival that doesn't clearly win, but not one that does", () => {
    // Train A: bpm 120, 7 onsets — a moderately strong, unambiguous signal.
    // Train B: bpm ~126, 8 onsets, far enough away in time (gap > the
    // pair-walk's own MAX_PAIR_GAP_SEC) that no cross-pair between A and B
    // ever scores — so this is really two independent trains, B's just
    // slightly stronger (one more onset) than A's.
    const bpmA = 120;
    const bpmB = 126;
    const trainA = clickTrain(bpmA, 7, 0);
    const trainB = clickTrain(bpmB, 8, 10);
    const combined = [...trainA, ...trainB];
    const now = combined[combined.length - 1]!.time;

    const cold = estimateTempo(combined, now, 0, OPTS);
    expect(cold).not.toBeNull();
    // Raw, no current tempo to hold onto: B's extra onset makes it the
    // stronger candidate, so a fresh estimate should land near B.
    expect(Math.abs(cold! - bpmB)).toBeLessThan(Math.abs(cold! - bpmA));

    const held = estimateTempo(combined, now, bpmA, OPTS);
    expect(held).not.toBeNull();
    // Same evidence, but already locked onto A: B's lead isn't large enough
    // to clear OPTS.switchMargin, so the estimate should stay on A rather
    // than jump to B on every call.
    expect(held!).toBeGreaterThan(bpmA - 1);
    expect(held!).toBeLessThan(bpmA + 1);

    // A rival that DOES clearly win (bpmA held, but the data only supports
    // a period far outside the tempo window near bpmA — combScore(bpmA)
    // reads ~0) should not be held onto.
    const heldAgainstNothing = estimateTempo(trainB, trainB[trainB.length - 1]!.time, bpmA, OPTS);
    expect(heldAgainstNothing).not.toBeNull();
    expect(Math.abs(heldAgainstNothing! - bpmB)).toBeLessThan(Math.abs(heldAgainstNothing! - bpmA));
  });

  it("recency makes the estimate follow a tempo step faster than without", () => {
    // A long, well-established train at 120bpm, then an abrupt step to
    // 150bpm for a few beats. Right after the step, the old tempo still has
    // far more corroborating pairs — recencySec lets the fresh onsets win
    // anyway by fading the stale ones out; without it, the old train's sheer
    // numbers keep winning for longer.
    const before = clickTrain(120, 16, 0);
    const after = clickTrain(150, 5, before[before.length - 1]!.time + 60 / 150);
    const combined = [...before, ...after];
    const now = combined[combined.length - 1]!.time;

    const withoutRecency = estimateTempo(combined, now, 0, { ...OPTS, recencySec: 0 });
    const withRecency = estimateTempo(combined, now, 0, { ...OPTS, recencySec: 1 });
    expect(withoutRecency).not.toBeNull();
    expect(withRecency).not.toBeNull();
    // With recency, the fresh 150bpm evidence should win (or at least read
    // much closer to it) than the un-decayed comb, which is still anchored
    // by the much larger 120bpm train.
    expect(Math.abs(withRecency! - 150)).toBeLessThan(Math.abs(withoutRecency! - 150));
  });
});
