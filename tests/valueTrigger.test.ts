import { describe, it, expect } from "vitest";
import {
  createValueTrigger,
  stepValueTrigger,
  HELD_REFIRE_FALLBACK_SEC,
  VALUE_TRIGGER_UPPER_DEFAULT,
} from "../src/render/valueTrigger.ts";

const DT = 1 / 60;

function tick(timeSec: number, beats = 0, tempoLock = 0): { timeSec: number; beats: number; tempoLock: number } {
  return { timeSec, beats, tempoLock };
}

describe("createValueTrigger", () => {
  it("starts armed, so the very first rise past upper fires immediately", () => {
    const st = createValueTrigger();
    expect(st.armed).toBe(true);
    expect(stepValueTrigger(st, 1, VALUE_TRIGGER_UPPER_DEFAULT, tick(0))).toBe(true);
  });
});

describe("stepValueTrigger: clean pulse train", () => {
  it("fires exactly once per pulse", () => {
    const st = createValueTrigger();
    let fires = 0;
    for (let p = 0; p < 10; p++) {
      const base = p * 0.5;
      // Rising edge — the one tick that should fire.
      if (stepValueTrigger(st, 1, VALUE_TRIGGER_UPPER_DEFAULT, tick(base))) fires++;
      // Held for a few frames, well under both refire paths (< 1 beat's
      // worth of time and well under HELD_REFIRE_FALLBACK_SEC) — must not
      // refire while still on the same pulse.
      for (let i = 1; i <= 3; i++) {
        if (stepValueTrigger(st, 1, VALUE_TRIGGER_UPPER_DEFAULT, tick(base + i * DT))) fires++;
      }
      // Falls back below the lower mark, re-arming for the next pulse.
      stepValueTrigger(st, 0, VALUE_TRIGGER_UPPER_DEFAULT, tick(base + 0.1));
    }
    expect(fires).toBe(10);
  });
});

describe("stepValueTrigger: noisy signal near the upper mark", () => {
  it("fires once, not per crossing, as long as it never dips below the lower mark", () => {
    const st = createValueTrigger();
    const upper = VALUE_TRIGGER_UPPER_DEFAULT; // lower mark = 0.6 * 0.65 = 0.39
    // Oscillates between 0.5 and 0.75 — repeatedly crosses `upper` (0.6) but
    // never comes close to the lower mark.
    const values = [0.5, 0.7, 0.55, 0.75, 0.5, 0.65, 0.58, 0.72, 0.5, 0.68];
    let fires = 0;
    for (let i = 0; i < values.length; i++) {
      if (stepValueTrigger(st, values[i]!, upper, tick(i * DT))) fires++;
    }
    expect(fires).toBe(1);
  });
});

describe("stepValueTrigger: held-high re-fire", () => {
  it("re-fires once per beat while held above upper with a confident tempo lock", () => {
    const st = createValueTrigger();
    const bps = 2; // 120 bpm
    let fires = 0;
    const beatsSeen = new Set<number>();
    for (let i = 0; i < 600; i++) {
      const t = i * DT;
      const beats = t * bps;
      beatsSeen.add(Math.floor(beats));
      if (stepValueTrigger(st, 1, VALUE_TRIGGER_UPPER_DEFAULT, tick(t, beats, 1))) fires++;
    }
    // One fire per distinct beat visited (the initial rise counts as beat 0).
    expect(fires).toBe(beatsSeen.size);
    expect(fires).toBeGreaterThan(1); // sanity: this really is a held re-fire, not just the initial one
  });

  it("re-fires every HELD_REFIRE_FALLBACK_SEC while held above upper without a confident lock", () => {
    const st = createValueTrigger();
    const fireTimes: number[] = [];
    for (let i = 0; i < 600; i++) {
      const t = i * DT;
      // beats keeps advancing but tempoLock stays under the trust line —
      // the beat-boundary refire path must never fire here.
      if (stepValueTrigger(st, 1, VALUE_TRIGGER_UPPER_DEFAULT, tick(t, t * 2, 0.1))) fireTimes.push(t);
    }
    expect(fireTimes.length).toBeGreaterThanOrEqual(19);
    expect(fireTimes.length).toBeLessThanOrEqual(21);
    for (let i = 1; i < fireTimes.length; i++) {
      expect(fireTimes[i]! - fireTimes[i - 1]!).toBeCloseTo(HELD_REFIRE_FALLBACK_SEC, 1);
    }
  });
});

describe("stepValueTrigger: re-arming", () => {
  it("dropping below the lower mark re-arms without firing, allowing an immediate re-fire on the next rise", () => {
    const st = createValueTrigger();
    const upper = VALUE_TRIGGER_UPPER_DEFAULT;
    expect(stepValueTrigger(st, 0.9, upper, tick(0))).toBe(true);
    expect(st.armed).toBe(false);

    // Between the marks — neither fires nor re-arms.
    expect(stepValueTrigger(st, 0.5, upper, tick(0.01))).toBe(false);
    expect(st.armed).toBe(false);

    // Below the lower mark (0.39) — re-arms, but the re-arming tick itself never fires.
    expect(stepValueTrigger(st, 0.1, upper, tick(0.02))).toBe(false);
    expect(st.armed).toBe(true);

    expect(stepValueTrigger(st, 0.9, upper, tick(0.03))).toBe(true);
  });
});

describe("stepValueTrigger: upper clamp", () => {
  it("clamps an out-of-range upper into [0.05, 0.98]", () => {
    const high = createValueTrigger();
    // Clamped to 0.98 — 0.5 doesn't clear it.
    expect(stepValueTrigger(high, 0.5, 10, tick(0))).toBe(false);

    const low = createValueTrigger();
    // Clamped to 0.05 — 0.5 clears it easily.
    expect(stepValueTrigger(low, 0.5, -3, tick(0))).toBe(true);
  });
});
