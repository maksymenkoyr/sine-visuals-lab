import { describe, it, expect } from "vitest";
import { JitterBuffer } from "../src/net/jitterBuffer.ts";
import { NUM_BANDS } from "../src/audio/types.ts";

function frame(roomTimeMs: number, energy: number, onset = false, bpm = 0, level = energy) {
  return { bands: new Float32Array(NUM_BANDS).fill(energy), energy, onset, bpm, level, roomTimeMs };
}

describe("JitterBuffer", () => {
  it("interpolates linearly between two bracketing frames", () => {
    const buf = new JitterBuffer();
    buf.push(frame(0, 0.0));
    buf.push(frame(100, 1.0));

    const mid = buf.sampleAt(25);
    expect(mid).not.toBeNull();
    expect(mid!.energy).toBeCloseTo(0.25, 5);
    expect(mid!.bands[0]).toBeCloseTo(0.25, 5);
    expect(mid!.level).toBeCloseTo(0.25, 5); // level interpolates the same way as energy
  });

  it("holds the nearest edge frame outside the buffered range", () => {
    const buf = new JitterBuffer();
    buf.push(frame(100, 0.5));
    buf.push(frame(200, 0.9));

    expect(buf.sampleAt(0)!.energy).toBeCloseTo(0.5, 5);
    expect(buf.sampleAt(9999)!.energy).toBeCloseTo(0.9, 5);
  });

  it("accepts out-of-order pushes and still interpolates correctly", () => {
    const buf = new JitterBuffer();
    buf.push(frame(200, 1.0));
    buf.push(frame(0, 0.0));
    buf.push(frame(100, 0.5));

    expect(buf.sampleAt(150)!.energy).toBeCloseTo(0.75, 5);
  });

  it("returns null before any frame has been pushed", () => {
    expect(new JitterBuffer().sampleAt(0)).toBeNull();
  });

  it("extrapolates beat phase from bpm + last beat time between packets", () => {
    const buf = new JitterBuffer();
    const bpm = 120; // one beat every 500ms
    buf.push(frame(0, 0.5, true, bpm));

    expect(buf.beatPhaseAt(0)).toBeCloseTo(0, 5);
    expect(buf.beatPhaseAt(125)).toBeCloseTo(0.25, 5);
    expect(buf.beatPhaseAt(499)).toBeCloseTo(0.998, 2);
    expect(buf.beatPhaseAt(500)).toBeCloseTo(0, 5); // wraps to next beat
  });

  it("fires consumeOnsetIfDue exactly once per beat, only once the target time reaches it", () => {
    const buf = new JitterBuffer();
    buf.push(frame(1000, 0.5, true, 120));

    expect(buf.consumeOnsetIfDue(999)).toBe(false); // not due yet
    expect(buf.consumeOnsetIfDue(1000)).toBe(true); // due now
    expect(buf.consumeOnsetIfDue(1001)).toBe(false); // already fired

    buf.push(frame(1500, 0.6, true, 120));
    expect(buf.consumeOnsetIfDue(1400)).toBe(false);
    expect(buf.consumeOnsetIfDue(1500)).toBe(true);
  });
});
