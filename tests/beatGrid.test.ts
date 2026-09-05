import { describe, it, expect } from "vitest";
import {
  BEAT_RATES,
  advanceBeatGate,
  createBeatGateState,
  gatedOnset,
  gatedPulse,
  gridPhase,
  isBeatRate,
  type BeatRate,
} from "../src/render/beatGrid.ts";
import { createBeatClock } from "../src/render/beatClock.ts";

describe("isBeatRate", () => {
  it("accepts every value in BEAT_RATES", () => {
    for (const r of BEAT_RATES) expect(isBeatRate(r)).toBe(true);
  });

  it("rejects a rate outside the vocabulary", () => {
    expect(isBeatRate(3)).toBe(false);
    expect(isBeatRate(0)).toBe(false);
    expect(isBeatRate(1.5)).toBe(false);
    expect(isBeatRate(-1)).toBe(false);
  });
});

describe("gridPhase", () => {
  it("matches BeatClock.barPhase bit for bit at rate 4", () => {
    const clock = createBeatClock();
    // A held tempo, several ticks — spans multiple bars.
    for (let i = 0; i < 400; i++) {
      clock.advance(1 / 60, 120, i % 30 === 0);
      expect(gridPhase(clock.beats, 4)).toBe(clock.barPhase);
    }
  });

  it("matches BeatClock.beatPhase bit for bit at rate 1", () => {
    const clock = createBeatClock();
    for (let i = 0; i < 200; i++) {
      clock.advance(1 / 60, 95, i % 22 === 0);
      expect(gridPhase(clock.beats, 1)).toBe(clock.beatPhase);
    }
  });

  it("cycles twice as fast at rate 0.5", () => {
    expect(gridPhase(1, 0.5)).toBeCloseTo(0, 10);
    expect(gridPhase(0.75, 0.5)).toBeCloseTo(0.5, 10);
    expect(gridPhase(0.25, 0.5)).toBeCloseTo(0.5, 10);
  });

  it("wraps to [0,1) for a large beat count", () => {
    const phase = gridPhase(37.25, 2);
    expect(phase).toBeGreaterThanOrEqual(0);
    expect(phase).toBeLessThan(1);
    expect(phase).toBeCloseTo(0.625, 10); // 37.25/2 = 18.625 -> fractional .625
  });
});

describe("advanceBeatGate", () => {
  it("fires no onset on the very first tick at beats 0", () => {
    const st = createBeatGateState();
    const gate = advanceBeatGate(st, 1 / 60, 0, 1);
    expect(gate.onset).toBe(false);
  });

  it("fires exactly on the tick a grid line is crossed, at rate 1", () => {
    const st = createBeatGateState();
    const events: boolean[] = [];
    for (const beats of [0, 0.4, 0.8, 0.99, 1.01, 1.5, 1.99, 2.02]) {
      events.push(advanceBeatGate(st, 1 / 60, beats, 1).onset);
    }
    expect(events).toEqual([false, false, false, false, true, false, false, true]);
  });

  it("fires once, not once per crossing, when several lines are skipped in one call", () => {
    // Models a render-cap-sized gap: several rAF ticks (and several beats)
    // passed with no render in between, so this call sees a big beats jump.
    const st = createBeatGateState();
    advanceBeatGate(st, 1 / 60, 0.9, 1); // establishes gridIndex 0
    const gate = advanceBeatGate(st, 0.2, 3.9, 1); // jumps straight past beats 1, 2 and 3
    expect(gate.onset).toBe(true);
    // A second call at the same beats (nothing further crossed) doesn't refire.
    const again = advanceBeatGate(st, 1 / 600, 3.9, 1);
    expect(again.onset).toBe(false);
  });

  it("pulse jumps to 1 on onset and decays otherwise", () => {
    const st = createBeatGateState();
    const onsetGate = advanceBeatGate(st, 1 / 60, 1.0, 1);
    expect(onsetGate.onset).toBe(true);
    expect(onsetGate.pulse).toBe(1);
    const later = advanceBeatGate(st, 0.5, 1.1, 1); // no new crossing, half a second later
    expect(later.onset).toBe(false);
    expect(later.pulse).toBeGreaterThan(0);
    expect(later.pulse).toBeLessThan(1);
  });

  it("a slower rate crosses less often than rate 1 for the same beats", () => {
    const st1 = createBeatGateState();
    const st4 = createBeatGateState();
    let crossings1 = 0;
    let crossings4 = 0;
    // beats computed fresh from the integer step each time (i * 0.05) rather
    // than accumulated by repeated += — avoids compounding float drift
    // across 160 additions, which could otherwise nudge a sample that's
    // meant to land exactly on an integer beat to just short of it.
    for (let i = 0; i <= 160; i++) {
      const beats = i * 0.05; // 0..8
      if (advanceBeatGate(st1, 0.05, beats, 1).onset) crossings1++;
      if (advanceBeatGate(st4, 0.05, beats, 4).onset) crossings4++;
    }
    expect(crossings1).toBe(8);
    expect(crossings4).toBe(2);
  });
});

describe("gatedOnset / gatedPulse", () => {
  const REST: BeatRate = 1;

  it("passes the rest source through bit for bit when rate equals rest", () => {
    const st = createBeatGateState();
    // Even though beats would cross a grid line here, rate === rest must
    // short-circuit straight to the given rest value, untouched.
    expect(gatedOnset(st, 1 / 60, 4, REST, REST, false)).toBe(false);
    expect(gatedOnset(st, 1 / 60, 4, REST, REST, true)).toBe(true);
  });

  it("ignores the rest pulse and uses the grid once rate differs from rest", () => {
    const st = createBeatGateState();
    // rest source claims a pulse of 1, but at a non-rest rate this must be
    // ignored in favor of the grid's own (here: no crossing yet -> 0).
    const pulse = gatedPulse(st, 1 / 60, 0, 2, REST, 1);
    expect(pulse).toBe(0);
  });

  it("fires away from rest purely off the grid, independent of the rest source", () => {
    const st = createBeatGateState();
    // restOnset is always false here — a non-rest rate must still fire on
    // its own grid crossings regardless.
    const events = [0.4, 0.9, 2.1, 2.4].map((beats) => gatedOnset(st, 0.1, beats, 2, REST, false));
    expect(events).toEqual([false, false, true, false]);
  });
});
