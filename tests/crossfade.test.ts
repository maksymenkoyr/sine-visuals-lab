import { describe, it, expect } from "vitest";
import {
  barLengthMs,
  createCrossfade,
  CROSSFADE_FALLBACK_MS,
  CROSSFADE_MAX_MS,
  CROSSFADE_MAX_WAIT_MS,
  CROSSFADE_MIN_MS,
} from "../src/render/crossfade.ts";
import { METRONOME_BEATS_PER_BAR } from "../src/render/metronome.ts";

const TEMPO = { tempoOn: true, bpm: 120, beat: false };
const NO_TEMPO = { tempoOn: false, bpm: 0, beat: false };

describe("barLengthMs", () => {
  it("is one bar of beats at the tempo", () => {
    expect(barLengthMs(120)).toBe((METRONOME_BEATS_PER_BAR * 60_000) / 120);
  });
  it("stays inside the min and max, and falls back with no tempo", () => {
    expect(barLengthMs(1000)).toBe(CROSSFADE_MIN_MS);
    expect(barLengthMs(10)).toBe(CROSSFADE_MAX_MS);
    expect(barLengthMs(0)).toBe(CROSSFADE_FALLBACK_MS);
  });
});

describe("createCrossfade", () => {
  it("waits on the outgoing scene until a beat lands", () => {
    const c = createCrossfade();
    expect(c.step(1000, TEMPO)).toEqual({ stage: "wait", mix: 0 });
    expect(c.step(1300, TEMPO)).toEqual({ stage: "wait", mix: 0 });
    expect(c.step(1400, { ...TEMPO, beat: true }).stage).toBe("blend");
  });

  it("blends over one bar from the beat, ending exactly at 1", () => {
    const c = createCrossfade();
    c.step(0, TEMPO);
    const start = 500;
    const bar = barLengthMs(120);
    expect(c.step(start, { ...TEMPO, beat: true })).toEqual({ stage: "blend", mix: 0 });
    const mid = c.step(start + bar / 2, TEMPO);
    expect(mid.stage).toBe("blend");
    expect(mid.mix).toBeCloseTo(0.5, 5);
    expect(c.step(start + bar, TEMPO)).toEqual({ stage: "done", mix: 1 });
    expect(c.step(start + bar + 5000, TEMPO).stage).toBe("done");
  });

  it("mix only rises", () => {
    const c = createCrossfade();
    c.step(0, { ...TEMPO, beat: true });
    let last = -1;
    for (let t = 0; t <= 2000; t += 50) {
      const v = c.step(t, TEMPO);
      expect(v.mix).toBeGreaterThanOrEqual(last);
      last = v.mix;
    }
  });

  it("starts at once with the fallback length when there is no settled tempo", () => {
    const c = createCrossfade();
    expect(c.step(100, NO_TEMPO)).toEqual({ stage: "blend", mix: 0 });
    expect(c.step(100 + CROSSFADE_FALLBACK_MS / 2, NO_TEMPO).mix).toBeCloseTo(0.5, 5);
    expect(c.step(100 + CROSSFADE_FALLBACK_MS, NO_TEMPO).stage).toBe("done");
  });

  it("gives up waiting for a beat that never comes", () => {
    const c = createCrossfade();
    c.step(0, TEMPO);
    expect(c.step(CROSSFADE_MAX_WAIT_MS - 1, TEMPO).stage).toBe("wait");
    expect(c.step(CROSSFADE_MAX_WAIT_MS, TEMPO).stage).toBe("blend");
  });

  it("starts at once if the tempo is lost while waiting", () => {
    const c = createCrossfade();
    c.step(0, TEMPO);
    expect(c.step(200, NO_TEMPO).stage).toBe("blend");
  });

  it("takes an explicit length for the blend, still starting on the beat", () => {
    const c = createCrossfade({ lengthMs: 4000 });
    expect(c.step(0, TEMPO).stage).toBe("wait");
    c.step(300, { ...TEMPO, beat: true });
    expect(c.step(2300, TEMPO).mix).toBeCloseTo(0.5, 5);
    expect(c.step(4300, TEMPO).stage).toBe("done");
  });

  it("cuts on the beat with no blend", () => {
    const c = createCrossfade({ cut: true });
    expect(c.step(0, TEMPO).stage).toBe("wait");
    expect(c.step(300, { ...TEMPO, beat: true })).toEqual({ stage: "done", mix: 1 });
  });

  it("a cut with no tempo is done at once", () => {
    const c = createCrossfade({ cut: true });
    expect(c.step(0, NO_TEMPO).stage).toBe("done");
  });
});
