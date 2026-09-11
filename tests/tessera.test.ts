import { describe, it, expect } from "vitest";
import {
  advanceBarCounter,
  advanceBurstHold,
  advanceFreeBurst,
  burstHoldSec,
  createBarCounterState,
  createBurstHoldState,
  createFreeBurstState,
  hueStepTarget,
  lensDriftEnvelope,
  radialSpeed,
  radialTravelTime,
  slewToward,
  spokeColumnRate,
} from "../src/render/scenes/tessera.ts";

describe("tessera radial speed law", () => {
  it("radialSpeed at r=0.5 is exactly the inflow setting (the law's calibration point)", () => {
    expect(radialSpeed(0.5, 0.6)).toBeCloseTo(0.6, 10);
  });

  it("radialSpeed is 0 at r=0 regardless of inflow", () => {
    expect(radialSpeed(0, 1)).toBe(0);
  });

  it("radialSpeed is monotonically increasing in r", () => {
    let prev = radialSpeed(0, 0.6);
    for (let r = 0.05; r <= 1.5; r += 0.05) {
      const s = radialSpeed(r, 0.6);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it("uses the measured r^0.6 exponent, not r^0.5 — a value that would fail under the old law", () => {
    // pow(4, 0.6): the old r^0.5 law would give exactly 2 here (sqrt(4)),
    // which this is not close to — pins that the exponent actually changed.
    const expected = Math.pow(4, 0.6);
    expect(radialSpeed(2.0, 1.0)).toBeCloseTo(expected, 10);
    expect(radialSpeed(2.0, 1.0)).not.toBeCloseTo(2.0, 1);
  });

  it("travelling r 0.75 -> 0.42 takes approximately one beat at the defaults (inflow=0.6, ~118bpm)", () => {
    // Matches the plan's echo-ring finding: successive generations sit
    // about one beat apart. beat @ 118bpm = 60/118 ~= 0.5085s. Holds under
    // the measured r^0.6 law too (0.507s), not just the old r^0.5 one.
    const t = radialTravelTime(0.75, 0.42, 0.6);
    const beat = 60 / 118;
    expect(t).toBeGreaterThan(beat * 0.9);
    expect(t).toBeLessThan(beat * 1.1);
  });

  it("radialTravelTime matches a step-integrated reference of the same ODE", () => {
    const r0 = 0.9;
    const r1 = 0.2;
    const inflow = 0.6;
    let r = r0;
    let t = 0;
    const dt = 1e-5;
    while (r > r1) {
      r -= radialSpeed(r, inflow) * dt;
      t += dt;
    }
    expect(radialTravelTime(r0, r1, inflow)).toBeCloseTo(t, 2);
  });

  it("radialTravelTime is infinite at inflow=0 (nothing ever moves)", () => {
    expect(radialTravelTime(0.9, 0.1, 0)).toBe(Infinity);
  });

  it("radialTravelTime is 0 when r0 === r1", () => {
    expect(radialTravelTime(0.5, 0.5, 0.6)).toBeCloseTo(0, 10);
  });
});

// Continuous emission's physically-derived baseline rate (round 6: the
// reference's echo rings are density modulations within a steady field of
// objects, not isolated bands, so tiles stream in every frame rather than
// only on a beat — see the file header's Sprite pool section).
describe("tessera continuous emission rate (spokeColumnRate)", () => {
  it("is 0 at inflow=0 (nothing ever moves, so nothing needs to spawn)", () => {
    expect(spokeColumnRate(0)).toBe(0);
  });

  it("is monotonically increasing in inflow", () => {
    let prev = spokeColumnRate(0);
    for (let inflow = 0.1; inflow <= 1.2; inflow += 0.1) {
      const r = spokeColumnRate(inflow);
      expect(r).toBeGreaterThan(prev);
      prev = r;
    }
  });

  it("matches radialSpeed at the spawn edge (r=1.35, the midpoint of 1.25..1.45) divided by 1.2 tile-lengths of the weighted mean size", () => {
    // Pinned via the exported radialSpeed and the same size-distribution
    // arithmetic tessera.ts's own SPRITE_MEAN_SIZE_HH uses, not a restated
    // magic number: 95% of spawns are 0.025-0.06 hh, 5% are 0.06-0.11 hh.
    const inflow = 0.6;
    const edgeSpeed = radialSpeed(1.35, inflow);
    const meanSize = 0.95 * ((0.025 + 0.06) / 2) + 0.05 * ((0.06 + 0.11) / 2);
    const expected = edgeSpeed / (1.2 * meanSize);
    expect(spokeColumnRate(inflow)).toBeCloseTo(expected, 6);
  });

  it("never produces NaN or a negative rate across a broad sweep", () => {
    for (let i = 0; i < 200; i++) {
      const r = spokeColumnRate(Math.random() * 2);
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("tessera bar counter / hue stepper", () => {
  it("does not fire on the first sample even at a nonzero barPhase", () => {
    const st = createBarCounterState();
    expect(advanceBarCounter(st, 0.9)).toBe(false);
    expect(st.bars).toBe(0);
  });

  it("fires exactly once per wrap, not gradually as barPhase rises", () => {
    const st = createBarCounterState();
    let fires = 0;
    // Three full bar cycles, sampled finely.
    for (let bar = 0; bar < 3; bar++) {
      for (let i = 0; i <= 100; i++) {
        if (advanceBarCounter(st, i / 100)) fires++;
      }
    }
    // A wrap happens going from phase~1 back to phase~0, i.e. once per bar
    // after the first (the first bar's rise from 0 never wraps).
    expect(fires).toBe(2);
    expect(st.bars).toBe(2);
  });

  it("does not fire on an ordinary small backward jitter", () => {
    const st = createBarCounterState();
    advanceBarCounter(st, 0.5);
    expect(advanceBarCounter(st, 0.48)).toBe(false);
    expect(st.bars).toBe(0);
  });

  it("hueStepTarget only changes every two bars (HUE_STEP_BARS), not every bar", () => {
    const hueDrift = 0.03;
    expect(hueStepTarget(0, hueDrift)).toBeCloseTo(0, 10);
    expect(hueStepTarget(1, hueDrift)).toBeCloseTo(0, 10);
    expect(hueStepTarget(2, hueDrift)).toBeCloseTo(hueDrift, 10);
    expect(hueStepTarget(3, hueDrift)).toBeCloseTo(hueDrift, 10);
    expect(hueStepTarget(4, hueDrift)).toBeCloseTo(2 * hueDrift, 10);
  });

  it("hueStepTarget is a bounded triangle wave (bounces back), never an unbounded walk — the reference stays yellow-dominant for the whole clip, not cycling the full wheel", () => {
    const hueDrift = 0.03; // period = 4*HUE_SPAN(0.12)/hueDrift = 16 steps = 32 bars
    expect(hueStepTarget(8, hueDrift)).toBeCloseTo(0.12, 10); // peaks at +HUE_SPAN
    expect(hueStepTarget(10, hueDrift)).toBeCloseTo(0.09, 10); // ...then bounces back down
    expect(hueStepTarget(16, hueDrift)).toBeCloseTo(0, 10);
    expect(hueStepTarget(24, hueDrift)).toBeCloseTo(-0.12, 10); // and down to -HUE_SPAN
    expect(hueStepTarget(32, hueDrift)).toBeCloseTo(0, 10); // back to start: one full period
  });

  it("hueStepTarget never exceeds +/-0.12 (HUE_SPAN) across many bars, for a wide range of hueDrift values", () => {
    for (const hueDrift of [0.01, 0.02, 0.03, 0.08, 0.15, 0.3]) {
      for (let bars = 0; bars <= 400; bars += 2) {
        const v = hueStepTarget(bars, hueDrift);
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(-0.12 - 1e-9);
        expect(v).toBeLessThanOrEqual(0.12 + 1e-9);
      }
    }
  });

  it("slewToward approaches the target gradually rather than jumping", () => {
    let v = 0;
    const target = 1;
    v = slewToward(v, target, 0.5, 1 / 60);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(0.1);
    // After many frames it converges close to the target.
    for (let i = 0; i < 600; i++) v = slewToward(v, target, 0.5, 1 / 60);
    expect(v).toBeCloseTo(target, 1);
  });

  it("slewToward is a no-op once current equals target", () => {
    expect(slewToward(0.42, 0.42, 0.5, 1 / 60)).toBeCloseTo(0.42, 10);
  });
});

describe("tessera lens drift envelope", () => {
  it("starts at 0", () => {
    expect(lensDriftEnvelope(0)).toBeCloseTo(0, 6);
  });

  it("reaches 1 mid-way through the lens phase (period=30, on=12 -> flat top around t=6)", () => {
    expect(lensDriftEnvelope(6)).toBeCloseTo(1, 6);
  });

  it("is back at 0 once the lens phase ends (t=12) and stays 0 through the starburst phase", () => {
    expect(lensDriftEnvelope(12)).toBeCloseTo(0, 6);
    expect(lensDriftEnvelope(20)).toBe(0);
    expect(lensDriftEnvelope(29)).toBe(0);
  });

  it("is periodic with period 30s", () => {
    for (const t of [0, 1.5, 6, 11.9, 20, 29.9]) {
      expect(lensDriftEnvelope(t)).toBeCloseTo(lensDriftEnvelope(t + 30), 6);
      expect(lensDriftEnvelope(t)).toBeCloseTo(lensDriftEnvelope(t - 30), 6);
    }
  });

  it("handles negative time (wraps correctly rather than going negative or NaN)", () => {
    const v = lensDriftEnvelope(-5);
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });

  it("stays within [0,1] across a broad sweep", () => {
    for (let t = -60; t <= 60; t += 0.37) {
      const v = lensDriftEnvelope(t);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("tessera free-running burst fallback", () => {
  it("wraps once per FREE_BURST_PERIOD_SEC (0.5s)", () => {
    const st = createFreeBurstState();
    let fires = 0;
    const dt = 1 / 60;
    // A touch over 4 periods, so a tiny float rounding at an exact 4.0
    // boundary can't swallow the last wrap.
    const totalSec = 2.05;
    for (let i = 0; i < totalSec / dt; i++) {
      if (advanceFreeBurst(st, dt)) fires++;
    }
    expect(fires).toBe(4);
  });

  it("never fires within the same call it starts from phase 0 unless dt alone exceeds the period", () => {
    const st = createFreeBurstState();
    expect(advanceFreeBurst(st, 1 / 60)).toBe(false);
  });
});

// The tempo-derived hold between bursts — without it, the analyser's
// default Hits grid fires several onsets a beat on a busy track (this
// bundle: ~5 onsets/s at 118 bpm) and the imprint re-stamps the lattice
// that often, filling the frame solid instead of once-per-beat echo rings.
describe("tessera burst hold", () => {
  it("at lock 0, the hold is the floor value (0.45s) regardless of bpm", () => {
    expect(burstHoldSec(60, 0)).toBeCloseTo(0.45, 10);
    expect(burstHoldSec(200, 0)).toBeCloseTo(0.45, 10);
    expect(burstHoldSec(118, 0.49)).toBeCloseTo(0.45, 10); // just under the 0.5 lock threshold
  });

  it("at or above lock 0.5, the hold is 0.85 of a beat when that exceeds the floor", () => {
    expect(burstHoldSec(80, 1)).toBeCloseTo((0.85 * 60) / 80, 10);
    expect(burstHoldSec(80, 0.5)).toBeCloseTo((0.85 * 60) / 80, 10); // exactly at the threshold counts as locked
  });

  it("at or above lock 0.5, a fast bpm still falls back to the floor (0.85 of a 118bpm beat is under 0.45s)", () => {
    expect(burstHoldSec(118, 1)).toBeCloseTo(0.45, 10);
  });

  it("never produces NaN and never drops below the floor across a broad sweep", () => {
    for (let i = 0; i < 300; i++) {
      const bpm = 40 + Math.random() * 200;
      const tempoLock = Math.random();
      const hold = burstHoldSec(bpm, tempoLock);
      expect(Number.isFinite(hold)).toBe(true);
      expect(hold).toBeGreaterThanOrEqual(0.45 - 1e-9);
    }
  });

  it("at 118 bpm with tempo locked, two onsets 0.2s apart produce only one burst", () => {
    const st = createBurstHoldState();
    expect(advanceBurstHold(st, 0, true, 118, 1)).toBe(true); // the very first request always fires
    // 0.2s later, well under the ~0.45s hold at 118bpm (0.85 of a beat,
    // ~0.432s, is under the floor, so the floor is what applies here).
    expect(advanceBurstHold(st, 0.2, true, 118, 1)).toBe(false);
  });

  it("fires again once the hold has elapsed", () => {
    const st = createBurstHoldState();
    advanceBurstHold(st, 0, true, 118, 1);
    expect(advanceBurstHold(st, 0.2, true, 118, 1)).toBe(false);
    expect(advanceBurstHold(st, 0.3, true, 118, 1)).toBe(true); // 0.5s since the first fire, past the 0.45s hold
  });

  it("the very first request fires immediately even with dt=0 — sinceLastSec starts at Infinity", () => {
    const st = createBurstHoldState();
    expect(advanceBurstHold(st, 0, true, 60, 1)).toBe(true);
  });

  it("advancing with no request never fires, even long past the hold", () => {
    const st = createBurstHoldState();
    advanceBurstHold(st, 0, true, 118, 1);
    expect(advanceBurstHold(st, 10, false, 118, 1)).toBe(false);
  });

  it("a locked tempo's hold suppresses a busy run of onsets to about once a beat", () => {
    const st = createBurstHoldState();
    const bpm = 80;
    const holdSec = (0.85 * 60) / bpm; // 0.6375s
    // Five onsets across one beat's worth of time (a busy Hits-grid run),
    // spaced far closer together than the hold.
    const onsetSpacing = 0.15;
    let fires = 0;
    for (let i = 0; i < 5; i++) {
      if (advanceBurstHold(st, i === 0 ? 0 : onsetSpacing, true, bpm, 1)) fires++;
    }
    expect(4 * onsetSpacing).toBeLessThan(holdSec); // sanity-check the scenario itself
    expect(fires).toBe(1);
  });
});
