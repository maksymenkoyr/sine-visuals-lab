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
    // never snapped back toward 0 mid-beat.
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
      // (capped at MAX_CORRECTION_BEATS = 0.05), so anything past a
      // generous margin above that is a real jump.
      let delta = clock.beatPhase - prevPhase;
      if (delta < -0.5) delta += 1;
      else if (delta > 0.5) delta -= 1;
      if (delta < -0.15) sawJump = true;
      prevPhase = clock.beatPhase;
    }
    expect(sawJump).toBe(false);
  });

  it("ignores an onset far from the predicted beat line", () => {
    const clock = createBeatClock();
    // Get the clock running at a settled tempo first.
    for (let i = 0; i < 200; i++) clock.advance(DT, 120, false);
    const before = clock.beatPhase;
    // An onset roughly half a beat off-grid (a fill, an offbeat snare) should
    // be ignored outright rather than yanking the phase toward it.
    clock.advance(DT, 120, true);
    expect(clock.beatPhase).toBeCloseTo(before + DT * (120 / 60), 3);
  });

  it("converges toward a steady onset train landing near the predicted beat", () => {
    const clock = createBeatClock();
    const bpm = 120;
    const period = 60 / bpm;
    let t = 0;
    let lastBeat = 0;
    for (; t < 8; t += DT) {
      const beatFired = t - lastBeat >= period;
      if (beatFired) lastBeat = t;
      clock.advance(DT, bpm, beatFired);
    }
    // After several seconds of a steady train, tempo should be locked.
    expect(clock.tempoLock).toBeGreaterThan(0.8);
  });

  // The regression test for the stuck-tempoLock bug: the extractor retains
  // its bpm through a breakdown on purpose (features.ts's BPM_RETAIN_SEC),
  // so "bpm > 0" alone must not keep the lock pinned at 1 — lock has to key
  // off whether beats are actually landing. Before the fix, every
  // pulse/tempo-weighted auto setting read tempoLock = 1 for the whole
  // session, through silence and beatless bridges alike.
  it("drops tempoLock during a breakdown — onsets stop but bpm stays known", () => {
    const clock = createBeatClock();
    // A held tempo with steady onsets locks it in.
    for (let i = 0; i < 600; i++) clock.advance(DT, 120, i % 30 === 0);
    expect(clock.tempoLock).toBeGreaterThan(0.8);
    // Breakdown: bpm still reported (the extractor remembers the period),
    // but no onsets land. One bar of silence must NOT drop the lock (drum
    // breaks and funk stops go a bar without onsets routinely)…
    for (let i = 0; i < 120; i++) clock.advance(DT, 120, false); // 2s = 1 bar at 120
    expect(clock.tempoLock).toBeGreaterThan(0.8);
    // …but well past the two-bar timeout it must fall.
    for (let i = 0; i < 480; i++) clock.advance(DT, 120, false); // +8s
    expect(clock.tempoLock).toBeLessThan(0.1);
  });

  it("re-locks quickly when the beat returns after a breakdown", () => {
    const clock = createBeatClock();
    for (let i = 0; i < 600; i++) clock.advance(DT, 120, i % 30 === 0);
    for (let i = 0; i < 600; i++) clock.advance(DT, 120, false); // lock decays
    expect(clock.tempoLock).toBeLessThan(0.1);
    for (let i = 0; i < 300; i++) clock.advance(DT, 120, i % 30 === 0); // drums back, 5s
    expect(clock.tempoLock).toBeGreaterThan(0.8);
  });

  it("ramps tempoLock down once bpm returns to 0", () => {
    const clock = createBeatClock();
    for (let i = 0; i < 300; i++) clock.advance(DT, 120, i % 30 === 0);
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
