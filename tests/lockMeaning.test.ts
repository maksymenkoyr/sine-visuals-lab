import { describe, expect, it } from "vitest";
import type { ClockFrame } from "../src/audio/engine/clock.ts";
import { LOCK_MEANINGS, LockMeter, lockMeaningFromQuery } from "../src/render/lockMeaning.ts";
import { FOLLOW_LOCK } from "../src/render/metronome.ts";
import { engineReading } from "./engineReading.ts";

const DT = 1 / 60;

function clock(locked: boolean): ClockFrame {
  return { beat: false, beats: 0, beatPhase: 0, beatInBar: 0, barPhase: 0, bpm: locked ? 120 : 0, locked };
}

/** Runs `meter` for `sec`, a phase error of `error` every half second while locked. */
function run(meter: LockMeter, sec: number, locked: boolean, error: number, confidence = 0.8): void {
  const engine = engineReading({ music: locked, confidence });
  const steps = Math.round(sec / DT);
  for (let i = 1; i <= steps; i++) {
    const due = Math.floor((i * DT) / 0.5) > Math.floor(((i - 1) * DT) / 0.5);
    meter.update(DT, clock(locked), locked && due ? error : null, engine);
  }
}

describe("LockMeter", () => {
  it("every meaning starts at 0, and falls back to 0 once the clock unlocks", () => {
    const meter = new LockMeter();
    for (const m of LOCK_MEANINGS) expect(meter.values[m]).toBe(0);
    run(meter, 10, true, 0.01);
    for (const m of LOCK_MEANINGS) expect(meter.values[m], m).toBeGreaterThan(0.5);
    for (let i = 0; i < 300; i++) meter.update(DT, clock(false), null, null);
    for (const m of LOCK_MEANINGS) expect(meter.values[m], m).toBeLessThan(0.01);
  });

  it("stability climbs on small errors and stays low on errors near half a beat", () => {
    const steady = new LockMeter();
    run(steady, 10, true, 0.01);
    expect(steady.values.stability).toBeGreaterThan(0.9);
    const lost = new LockMeter();
    run(lost, 10, true, 0.45);
    expect(lost.values.stability).toBeLessThan(0.05);
  });

  it("presence passes the metronome's follow line within a second of a lock", () => {
    const meter = new LockMeter();
    run(meter, 1, true, 0.3);
    expect(meter.values.presence).toBeGreaterThan(FOLLOW_LOCK);
  });

  it("clarity follows the engine's confidence", () => {
    const meter = new LockMeter();
    run(meter, 5, true, 0.01, 0.4);
    expect(meter.values.clarity).toBeCloseTo(0.4, 2);
  });
});

describe("lockMeaningFromQuery", () => {
  it("reads ?lock=, and falls back to stability on junk or none", () => {
    expect(lockMeaningFromQuery("?lock=presence")).toBe("presence");
    expect(lockMeaningFromQuery("?scene=x&lock=clarity")).toBe("clarity");
    expect(lockMeaningFromQuery("?lock=wobble")).toBe("stability");
    expect(lockMeaningFromQuery("")).toBe("stability");
  });
});
