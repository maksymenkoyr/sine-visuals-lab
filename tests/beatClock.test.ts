import { describe, it, expect } from "vitest";
import { createBeatClock } from "../src/render/beatClock.ts";

const DT = 1 / 60;

describe("beat clock", () => {
  it("advances monotonically through a burst of onsets, never restarting to 0", () => {
    // Regression test for the bug this replaces: FeatureFrame.onsetPhase
    // reset to exactly 0 on every fired onset, so a burst of hats/fills
    // stuttered anything animating off it. Feed a dense onset burst (well
    // past the 0.1s refractory the old detector allowed) and assert the
    // phase never drops — it should only ever be nudged forward or held,
    // never snapped back toward 0 mid-beat. Still true under the phase comb:
    // the per-tick correction is rate-capped (PHASE_MAX_RATE) specifically
    // to keep this guarantee.
    const clock = createBeatClock();
    let prevPhase = 0;
    let sawJump = false;
    for (let t = 0; t < 3; t += DT) {
      const beatFired = Math.abs((t % 0.05) - 0) < DT / 2; // fire every 50ms — much denser than a real beat grid
      clock.advance(DT, 128, beatFired);
      // A raw beatPhase delta is very negative both on a real restart (the
      // bug this replaces) AND on an ordinary wrap from just under 1 to just
      // over 0 — unwrap it first so only an actual reset shows up. The
      // largest legitimate single-tick pullback is one correction step
      // (capped at PHASE_MAX_RATE*DT), so anything past a generous margin
      // above that is a real jump.
      let delta = clock.beatPhase - prevPhase;
      if (delta < -0.5) delta += 1;
      else if (delta > 0.5) delta -= 1;
      if (delta < -0.15) sawJump = true;
      prevPhase = clock.beatPhase;
    }
    expect(sawJump).toBe(false);
  });

  it("a single stray onset doesn't move the phase (fewer than PHASE_MIN_HITS hits)", () => {
    // Below the comb's own minimum hit count, advance() computes no
    // correction at all — a lone onset (a fill, an offbeat snare) can't yank
    // the phase on its own; it takes a small train of them agreeing on the
    // same offset (see beatClock.ts's own header).
    const clock = createBeatClock();
    for (let i = 0; i < 200; i++) clock.advance(DT, 120, false);
    const before = clock.beatPhase;
    clock.advance(DT, 120, true);
    expect(clock.beatPhase).toBeCloseTo(before + DT * (120 / 60), 3);
  });

  it("converges toward a steady onset train landing near the predicted beat", () => {
    // Longer than the old per-onset-nudge version needed: tempoLock now
    // builds from `stability`, which only updates when the comb actually
    // runs (once per onset here, not every frame), and only then eases
    // toward it at LOCK_RISE_RATE — a single onset a beat apart at 120bpm
    // needs on the order of 14s of real time to clear 0.8, not the old
    // ~8s a plain bpm>0 boolean gave it for free.
    const clock = createBeatClock();
    const bpm = 120;
    const period = 60 / bpm;
    let t = 0;
    let lastBeat = 0;
    for (; t < 14; t += DT) {
      const beatFired = t - lastBeat >= period;
      if (beatFired) lastBeat = t;
      clock.advance(DT, bpm, beatFired);
    }
    // After several seconds of a steady train, tempo should be locked.
    expect(clock.tempoLock).toBeGreaterThan(0.8);
  });

  it("locks onto weighted beats among evenly spaced off-beat hits", () => {
    // A steady train of hits on every quarter beat (so the comb always has
    // PHASE_MIN_HITS+ to work with), only every 4th one weighted heavily —
    // like a kick's own hitWeight (animClock.ts) standing out among a busy
    // hi-hat pattern filling the other three 16ths/quarters. The comb should
    // settle on the offset that lands the *weighted* hits on whole beats,
    // not just whichever of the four evenly-spaced candidates a plain
    // (unweighted) comb might have picked.
    const clock = createBeatClock();
    const bpm = 120;
    const quarterBeatSec = 60 / bpm / 4;
    const onBeatWeight = 3;
    const offBeatWeight = 1;
    let t = 0;
    let nextHitAt = quarterBeatSec;
    let step = 1;
    const onBeatPhasesLate: number[] = [];

    for (; t < 10; t += DT) {
      const isHit = t >= nextHitAt;
      if (isHit) {
        nextHitAt += quarterBeatSec;
        const onBeat = step % 4 === 0;
        clock.advance(DT, bpm, true, onBeat ? onBeatWeight : offBeatWeight);
        if (onBeat && t > 6) onBeatPhasesLate.push(clock.beatPhase);
        step++;
      } else {
        clock.advance(DT, bpm, false);
      }
    }

    expect(onBeatPhasesLate.length).toBeGreaterThan(0); // sanity: the scenario produced late on-beat samples
    for (const phase of onBeatPhasesLate) {
      const distanceToWholeBeat = Math.min(phase, 1 - phase);
      expect(distanceToWholeBeat).toBeLessThan(0.06);
    }
  });

  it("tempoLock rises on a steady train and stays low on random onsets", () => {
    // Same 14s the "converges" test above needs — see its own comment.
    const bpm = 120;
    const period = 60 / bpm;

    const steady = createBeatClock();
    let t = 0;
    let lastBeat = 0;
    for (; t < 14; t += DT) {
      const beatFired = t - lastBeat >= period;
      if (beatFired) lastBeat = t;
      steady.advance(DT, bpm, beatFired);
    }
    expect(steady.tempoLock).toBeGreaterThan(0.8);

    // Same nominal bpm (so smoothedBpm still climbs toward 120 the same
    // way), but onsets land at seeded random times unrelated to that
    // tempo — a "detector" firing on noise rather than a real beat.
    const random = createBeatClock();
    let seed = 99;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    t = 0;
    let nextOnsetAt = rand() * period;
    for (; t < 14; t += DT) {
      const beatFired = t >= nextOnsetAt;
      if (beatFired) nextOnsetAt += rand() * period * 2; // gaps averaging one period, but unrelated to its phase
      random.advance(DT, bpm, beatFired);
    }
    expect(random.tempoLock).toBeLessThan(0.5);
    expect(random.tempoLock).toBeLessThan(steady.tempoLock);
  });

  it("ramps tempoLock down once bpm returns to 0", () => {
    // Build-up doubled to 600 frames (10s, still one onset per true 120bpm
    // beat — see the "converges" test's own comment on why longer) so
    // tempoLock has comfortably passed 0.5 before the decay half starts;
    // LOCK_FALL_RATE's decay itself is unaffected by how long the build-up
    // ran, so the second half's 5s is unchanged.
    const clock = createBeatClock();
    for (let i = 0; i < 600; i++) clock.advance(DT, 120, i % 30 === 0);
    expect(clock.tempoLock).toBeGreaterThan(0.5);
    for (let i = 0; i < 300; i++) clock.advance(DT, 0, false);
    expect(clock.tempoLock).toBeLessThan(0.1);
  });

  it("barPhase is beatPhase stretched over 4 beats and both stay in [0,1)", () => {
    const clock = createBeatClock();
    for (let t = 0; t < 5; t += DT) {
      clock.advance(DT, 100, false);
      expect(clock.beatPhase).toBeGreaterThanOrEqual(0);
      expect(clock.beatPhase).toBeLessThan(1);
      expect(clock.barPhase).toBeGreaterThanOrEqual(0);
      expect(clock.barPhase).toBeLessThan(1);
    }
  });
});
