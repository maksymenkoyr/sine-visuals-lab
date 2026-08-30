import { describe, it, expect } from "vitest";
import { FeatureExtractor } from "../src/audio/features.ts";
import { NUM_BANDS } from "../src/audio/types.ts";
import { ANALYSER_MIN_DB, ANALYSER_MAX_DB } from "../src/audio/analyser.ts";

const QUIET_DB = -90;
const LOUD_DB = -20;

function bandsFrame(baseDb: number, overrides: Record<number, number> = {}): Float32Array {
  const bands = new Float32Array(NUM_BANDS).fill(baseDb);
  for (const [i, v] of Object.entries(overrides)) bands[Number(i)] = v;
  return bands;
}

describe("FeatureExtractor", () => {
  it("responds selectively to the band that's actually loud", () => {
    const extractor = new FeatureExtractor();
    const dt = 1 / 60;
    let time = 0;
    let frame;

    // Establish a quiet floor first so there's a range to normalize against.
    for (let i = 0; i < 60; i++) {
      time += dt;
      frame = extractor.update(bandsFrame(QUIET_DB), time);
    }

    // Now drive one band loud, others stay quiet.
    for (let i = 0; i < 60; i++) {
      time += dt;
      frame = extractor.update(bandsFrame(QUIET_DB, { 5: LOUD_DB }), time);
    }

    expect(frame!.bands[5]).toBeGreaterThan(0.7);
    expect(frame!.bands[0]).toBeLessThan(0.3);
    expect(frame!.bands[NUM_BANDS - 1]).toBeLessThan(0.3);
  });

  it("locks onto the tempo of a periodic click track", () => {
    const extractor = new FeatureExtractor();
    const bpm = 120;
    const intervalSec = 60 / bpm;
    const dt = 1 / 60;
    let time = 0;
    let frame;
    let nextClickAt = intervalSec;

    // Prime the adaptive floor/peak with a couple of quiet seconds first.
    for (let i = 0; i < 120; i++) {
      time += dt;
      frame = extractor.update(bandsFrame(QUIET_DB), time);
    }

    const endTime = time + 8; // ~16 clicks at 120bpm
    while (time < endTime) {
      time += dt;
      const isClick = time >= nextClickAt;
      if (isClick) nextClickAt += intervalSec;
      frame = extractor.update(bandsFrame(QUIET_DB, isClick ? { 0: LOUD_DB, 12: LOUD_DB } : {}), time);
    }

    expect(frame!.bpm).toBeGreaterThan(bpm - 5);
    expect(frame!.bpm).toBeLessThan(bpm + 5);
  });

  it("still reads the click tempo when every click also fires a second onset from its tail", () => {
    // A metronome at 100bpm whose clicks each trigger the detector twice —
    // the attack, then the tail 140ms later (just past the refractory).
    // Adjacent gaps then alternate 0.14s / 0.46s and neither is the beat;
    // 0.46s is 130bpm, which is what this used to read.
    const extractor = new FeatureExtractor();
    const bpm = 100;
    const intervalSec = 60 / bpm;
    const tailSec = 0.14;
    const dt = 1 / 60;
    let time = 0;
    let frame;
    let nextClickAt = intervalSec;
    let nextTailAt = Infinity;

    for (let i = 0; i < 120; i++) {
      time += dt;
      frame = extractor.update(bandsFrame(QUIET_DB), time);
    }

    const endTime = time + 10;
    while (time < endTime) {
      time += dt;
      const isClick = time >= nextClickAt;
      if (isClick) {
        nextTailAt = nextClickAt + tailSec;
        nextClickAt += intervalSec;
      }
      const isTail = time >= nextTailAt;
      if (isTail) nextTailAt = Infinity;
      const loud: Record<number, number> = isClick
        ? { 0: LOUD_DB, 12: LOUD_DB }
        : isTail
          ? { 3: LOUD_DB, 15: LOUD_DB }
          : {};
      frame = extractor.update(bandsFrame(QUIET_DB, loud), time);
    }

    expect(frame!.bpm).toBeGreaterThan(bpm - 5);
    expect(frame!.bpm).toBeLessThan(bpm + 5);
  });

  it("still reads the click tempo through mic noise that fires spurious onsets", () => {
    // Between metronome clicks a real mic isn't silent: the floor/peak
    // window collapses onto the noise and its wobble clears the onset
    // threshold at random. Those onsets must not outvote the clicks.
    const extractor = new FeatureExtractor();
    const bpm = 100;
    const intervalSec = 60 / bpm;
    const dt = 1 / 60;
    let seed = 12345;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const noisy = (loud: Record<number, number>) => {
      const bands = new Float32Array(NUM_BANDS);
      for (let i = 0; i < NUM_BANDS; i++) bands[i] = QUIET_DB + (rand() - 0.5) * 8;
      for (const [i, v] of Object.entries(loud)) bands[Number(i)] = v;
      return bands;
    };
    let time = 0;
    let frame;
    let nextClickAt = intervalSec;
    let spurious = 0;

    for (let i = 0; i < 120; i++) {
      time += dt;
      frame = extractor.update(noisy({}), time);
    }
    const endTime = time + 12;
    while (time < endTime) {
      time += dt;
      const isClick = time >= nextClickAt;
      if (isClick) nextClickAt += intervalSec;
      frame = extractor.update(noisy(isClick ? { 0: LOUD_DB, 12: LOUD_DB } : {}), time);
      if (frame.beat && !isClick) spurious++;
    }

    expect(spurious).toBeGreaterThan(0); // the scenario must actually be noisy
    expect(frame!.bpm).toBeGreaterThan(bpm - 5);
    expect(frame!.bpm).toBeLessThan(bpm + 5);
  });

  it("attacks fast: a step up reaches ~90% of its target within 2 frames at 60fps", () => {
    const extractor = new FeatureExtractor();
    const dt = 1 / 60;
    let time = 0;
    let frame;

    // Establish a steady quiet floor/peak first, as in the other tests.
    for (let i = 0; i < 120; i++) {
      time += dt;
      frame = extractor.update(bandsFrame(QUIET_DB), time);
    }

    // Step one band loud and check how fast its envelope catches up —
    // release (RELEASE_PER_SEC) is deliberately slow, but attack should be
    // near-instant so transients don't lag the sound that caused them.
    time += dt;
    frame = extractor.update(bandsFrame(QUIET_DB, { 5: LOUD_DB }), time);
    time += dt;
    frame = extractor.update(bandsFrame(QUIET_DB, { 5: LOUD_DB }), time);

    expect(frame!.bands[5]).toBeGreaterThan(0.9);
  });

  it("converges after a sudden step up in level", () => {
    const extractor = new FeatureExtractor();
    const dt = 1 / 60;
    let time = 0;
    let frame;

    for (let i = 0; i < 120; i++) {
      time += dt;
      frame = extractor.update(bandsFrame(QUIET_DB), time);
    }
    expect(frame!.energy).toBeLessThan(0.2);

    for (let i = 0; i < 120; i++) {
      time += dt;
      frame = extractor.update(bandsFrame(LOUD_DB), time);
    }
    expect(frame!.energy).toBeGreaterThan(0.6);
  });

  it("with autoGain off, maps a band's absolute dB straight to [0,1] against the analyser's fixed window", () => {
    const extractor = new FeatureExtractor();
    const dt = 1 / 60;
    let time = 0;
    let frame;

    // Prime with a steady quiet level so the adaptive floor/peak trackers
    // (which keep running regardless — see features.ts) would, if consulted,
    // read this next jump as loud. autoGain=false must ignore them.
    for (let i = 0; i < 120; i++) {
      time += dt;
      frame = extractor.update(bandsFrame(QUIET_DB), time, 0);
    }
    const fixedSpan = ANALYSER_MAX_DB - ANALYSER_MIN_DB;
    expect(frame!.bands[0]).toBeCloseTo((QUIET_DB - ANALYSER_MIN_DB) / fixedSpan, 2);

    // Jump to the fixed window's midpoint dB and let the (exponential, see
    // expBlend) attack converge — a handful of frames is enough at
    // ATTACK_PER_SEC=70.
    const midDb = (ANALYSER_MIN_DB + ANALYSER_MAX_DB) / 2;
    for (let i = 0; i < 10; i++) {
      time += dt;
      frame = extractor.update(bandsFrame(midDb), time, 0);
    }
    expect(frame!.bands[0]).toBeCloseTo(0.5, 2);
  });

  it("adaptive (on) and fixed (off) modes diverge for the same moderately loud signal", () => {
    const dt = 1 / 60;
    function run(autoGain: number): number {
      const extractor = new FeatureExtractor();
      let time = 0;
      let frame;
      for (let i = 0; i < 120; i++) {
        time += dt;
        frame = extractor.update(bandsFrame(QUIET_DB), time, autoGain);
      }
      for (let i = 0; i < 60; i++) {
        time += dt;
        frame = extractor.update(bandsFrame(QUIET_DB, { 5: -70 }), time, autoGain);
      }
      return frame!.bands[5];
    }

    // Adaptive mode has already re-normalized around -70dB as "loud" relative
    // to the quiet room; fixed mode reports it as what it absolutely is —
    // still well below the analyser's -10dB ceiling.
    expect(run(1)).toBeGreaterThan(0.6);
    expect(run(0)).toBeLessThan(0.45);

    // A partial amount lands strictly between the two, and the fixed-side
    // diagnostic is unaffected by where the blend sits.
    const half = run(0.5);
    expect(half).toBeGreaterThan(run(0));
    expect(half).toBeLessThan(run(1));
  });

  it("reports fixedEnergy as what energy would read with autoGain at 0, whatever the blend", () => {
    const dt = 1 / 60;
    function run(autoGain: number): { energy: number; fixedEnergy: number } {
      const extractor = new FeatureExtractor();
      let time = 0;
      let frame;
      for (let i = 0; i < 120; i++) {
        time += dt;
        frame = extractor.update(bandsFrame(QUIET_DB), time, autoGain);
      }
      for (let i = 0; i < 60; i++) {
        time += dt;
        frame = extractor.update(bandsFrame(QUIET_DB, { 5: -70 }), time, autoGain);
      }
      return { energy: frame!.energy, fixedEnergy: extractor.fixedEnergy };
    }
    const off = run(0);
    const on = run(1);
    // At 0 the diagnostic *is* the output; at 1 it still reads the same
    // number — the blend never leaks into it.
    expect(off.fixedEnergy).toBeCloseTo(off.energy, 6);
    expect(on.fixedEnergy).toBeCloseTo(off.energy, 6);
  });

  it("locks onto tempo the same way with autoGain off — beat detection reads the adaptive tracker regardless", () => {
    const extractor = new FeatureExtractor();
    const bpm = 120;
    const intervalSec = 60 / bpm;
    const dt = 1 / 60;
    let time = 0;
    let frame;
    let nextClickAt = intervalSec;

    for (let i = 0; i < 120; i++) {
      time += dt;
      frame = extractor.update(bandsFrame(QUIET_DB), time, 0);
    }

    const endTime = time + 8;
    while (time < endTime) {
      time += dt;
      const isClick = time >= nextClickAt;
      if (isClick) nextClickAt += intervalSec;
      frame = extractor.update(bandsFrame(QUIET_DB, isClick ? { 0: LOUD_DB, 12: LOUD_DB } : {}), time, 0);
    }

    expect(frame!.bpm).toBeGreaterThan(bpm - 5);
    expect(frame!.bpm).toBeLessThan(bpm + 5);
  });

  it("envelope attack is frame-rate independent (regression: was a raw Math.min(1, rate*dt) coefficient)", () => {
    // A step held for exactly one 60fps frame's worth of elapsed real time —
    // one update() at 60fps vs. two at 120fps — should land the envelope at
    // the same value either way once it's blended with expBlend, since that's
    // a proper exponential rather than a per-frame-saturating linear ramp.
    function run(fps: number): number {
      const dt = 1 / fps;
      const extractor = new FeatureExtractor();
      let time = 0;
      let frame;
      // Prime a steady quiet floor/peak for the same elapsed real time on
      // both runs, regardless of fps.
      for (let i = 0; i < Math.round(2 / dt); i++) {
        time += dt;
        frame = extractor.update(bandsFrame(QUIET_DB), time);
      }
      // Step loud for exactly 1/60s of elapsed time.
      for (let i = 0; i < Math.round(1 / 60 / dt); i++) {
        time += dt;
        frame = extractor.update(bandsFrame(QUIET_DB, { 5: LOUD_DB }), time);
      }
      return frame!.bands[5];
    }

    const at60 = run(60);
    const at120 = run(120);
    expect(Math.abs(at60 - at120)).toBeLessThan(0.01);
  });

  // smoothingScale=Infinity is what sensitivity.ts's smoothingRateScale
  // returns at the Smoothing row's Off stop (deviceMenu.ts) — the envelope
  // must assign `target` to `env[b]` directly rather than compute an
  // expBlend coefficient of 1, so a band jumps to exactly the adaptive-or-
  // fixed mapping computed this same tick, with none of expBlend's
  // floating-point rounding. With autoGain off that mapping is the same
  // fixed window app.ts's captureRawBands uses for the meters panel's RAW
  // chip, so this is what makes RAW a true no-op at Smoothing Off — down to
  // `env` being a Float32Array, same as captureRawBands's own scratch
  // buffer: Math.fround below rounds the expectation to float32 the same
  // way that assignment does, since two independent float64 computations
  // agree exactly only after both are rounded to the same precision.
  it("at smoothingScale=Infinity with autoGain off, a band jumps to exactly the fixed-window mapping in one tick", () => {
    const extractor = new FeatureExtractor();
    const dt = 1 / 60;
    let time = 0;
    let frame;

    for (let i = 0; i < 60; i++) {
      time += dt;
      frame = extractor.update(bandsFrame(QUIET_DB), time, 0, Infinity);
    }
    const fixedSpan = ANALYSER_MAX_DB - ANALYSER_MIN_DB;
    expect(frame!.bands[0]).toBe(Math.fround(Math.min(1, Math.max(0, (QUIET_DB - ANALYSER_MIN_DB) / fixedSpan))));

    const midDb = (ANALYSER_MIN_DB + ANALYSER_MAX_DB) / 2;
    time += dt;
    frame = extractor.update(bandsFrame(midDb), time, 0, Infinity);
    expect(frame!.bands[0]).toBe(Math.fround(Math.min(1, Math.max(0, (midDb - ANALYSER_MIN_DB) / fixedSpan))));
  });

  it("never produces NaN at smoothingScale=Infinity across a long, varied run", () => {
    const extractor = new FeatureExtractor();
    const dt = 1 / 60;
    let time = 0;
    let frame;
    for (let i = 0; i < 1200; i++) {
      time += dt;
      const db = QUIET_DB + (LOUD_DB - QUIET_DB) * (0.5 + 0.5 * Math.sin(i * 0.05));
      frame = extractor.update(bandsFrame(QUIET_DB, { 5: db }), time, 1, Infinity);
      for (const b of frame.bands) expect(Number.isFinite(b)).toBe(true);
      expect(Number.isFinite(frame.energy)).toBe(true);
    }
  });

  it("peak hold delays the ceiling's decay: a dip while held, then a rise once the hold window elapses", () => {
    // Signature verified against a reference implementation without hold
    // (the ceiling decaying unconditionally, as it did before this change):
    // WITH hold the probe's reading dips to a local minimum right around the
    // hold boundary (still settling from the transient, ceiling frozen) and
    // only then climbs, because holding the ceiling delays when it starts
    // shrinking the [floor, ceiling] range back toward the probe level.
    // WITHOUT hold there is no dip — the reading rises monotonically from the
    // first sample, since the ceiling starts relaxing immediately. This test
    // would fail against that old behavior.
    const extractor = new FeatureExtractor();
    const dt = 1 / 60;
    let time = 0;
    let frame: ReturnType<FeatureExtractor["update"]> | undefined;
    // Between the quiet floor (~-90, after priming) and the transient's
    // resulting ceiling (~-66) — sensitive to how fast the ceiling relaxes
    // back toward it.
    const probeDb = -70;

    for (let i = 0; i < 120; i++) {
      time += dt;
      frame = extractor.update(bandsFrame(QUIET_DB), time);
    }
    // A single loud transient jumps the ceiling and starts the hold window.
    time += dt;
    frame = extractor.update(bandsFrame(QUIET_DB, { 5: LOUD_DB }), time);

    function probeFor(frames: number): number {
      let f = frame;
      for (let i = 0; i < frames; i++) {
        time += dt;
        f = extractor.update(bandsFrame(QUIET_DB, { 5: probeDb }), time);
      }
      frame = f;
      return f!.bands[5];
    }

    const at0_1s = probeFor(6); // 0.1s after the transient — still inside the hold
    const at0_4s = probeFor(18); // cumulative 0.4s — just past PEAK_HOLD_SEC (0.3s)
    const at0_9s = probeFor(30); // cumulative 0.9s — well past the hold

    expect(at0_4s).toBeLessThan(at0_1s);
    expect(at0_9s).toBeGreaterThan(at0_4s);
  });

  it("bandSpanDb widens as the per-band range actually seen grows", () => {
    const narrow = new FeatureExtractor();
    const wide = new FeatureExtractor();
    const dt = 1 / 60;
    let time = 0;

    // `narrow` only ever sees one level; `wide` alternates between quiet and
    // loud, so its floor/peak trackers open up further.
    for (let i = 0; i < 300; i++) {
      time += dt;
      narrow.update(bandsFrame(-60), time);
      wide.update(bandsFrame(i % 2 === 0 ? QUIET_DB : LOUD_DB), time);
    }

    expect(wide.bandSpanDb).toBeGreaterThan(narrow.bandSpanDb);
  });

  // autoGain.ts's auto mode leans on bandSpanDb reading the room, not the
  // setting it's used to drive — this pins that no-feedback-loop property.
  // features.ts's own `autoGain` param doc already says the floor/peak
  // trackers run unconditionally; this is what actually holds it to that.
  it("bandSpanDb reads the same regardless of the autoGain argument passed to update()", () => {
    const withAutoGain = new FeatureExtractor();
    const withoutAutoGain = new FeatureExtractor();
    const dt = 1 / 60;
    let time = 0;

    for (let i = 0; i < 300; i++) {
      time += dt;
      const db = bandsFrame(i % 2 === 0 ? QUIET_DB : LOUD_DB);
      withAutoGain.update(db, time, 1);
      withoutAutoGain.update(db, time, 0);
    }

    expect(withoutAutoGain.bandSpanDb).toBeCloseTo(withAutoGain.bandSpanDb, 5);
  });
});
