import { describe, it, expect } from "vitest";
import { JitterBuffer } from "../src/net/jitterBuffer.ts";
import { NUM_BANDS } from "../src/audio/types.ts";
import type { WireEngine } from "../src/net/protocol.ts";
import { engineReading } from "./engineReading.ts";
import { songFrame } from "./songFrame.ts";

function frame(roomTimeMs: number, energy: number, onset = false, bpm = 0, level = energy, pulseOnset = onset) {
  return { bands: new Float32Array(NUM_BANDS).fill(energy), energy, onset, pulseOnset, bpm, level, hats: 0, lead: 0, roomTimeMs };
}

/** An engine reading as it travels, with the fields a test names. */
function wire(over: Parameters<typeof engineReading>[0] = {}): WireEngine {
  const { beatTime: _beat, downbeatTime: _downbeat, ...rest } = engineReading(over);
  return { ...rest, beatAgoMs: 0, downbeatAgoMs: 0 };
}

describe("JitterBuffer", () => {
  it("hands a hit out with the level of the frame it came in, not the level at the instant", () => {
    const buf = new JitterBuffer();
    buf.push({ ...frame(0, 0.2, false, 0, 0.6), engine: wire({ snare: 3 }) });
    buf.push({ ...frame(33, 0.2, false, 0, 0.05), engine: wire() });
    const s = buf.sampleAt(20)!;
    expect(s.engine!.snare).toBe(3);
    expect(s.level).toBeLessThan(0.6);
    expect(s.engine!.hitLevel).toBe(0.6);
    expect(buf.sampleAt(30)!.engine!.hitLevel).toBeUndefined();
  });

  it("interpolates linearly between two bracketing frames", () => {
    const buf = new JitterBuffer();
    buf.push(frame(0, 0.0));
    buf.push(frame(100, 1.0));

    const mid = buf.sampleAt(25);
    expect(mid).not.toBeNull();
    expect(mid!.energy).toBeCloseTo(0.25, 5);
    expect(mid!.bands[0]).toBeCloseTo(0.25, 5);
    expect(mid!.level).toBeCloseTo(0.25, 5); // level interpolates the same way as energy

    const stems = new JitterBuffer();
    stems.push({ ...frame(0, 0.0), hats: 0, lead: 0.2 });
    stems.push({ ...frame(100, 1.0), hats: 1, lead: 0.6 });
    const stemMid = stems.sampleAt(50);
    expect(stemMid!.hats).toBeCloseTo(0.5, 5); // hats and lead interpolate like level
    expect(stemMid!.lead).toBeCloseTo(0.4, 5);
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

  it("fires consumePulseIfDue independently of consumeOnsetIfDue — a gated onset still pulses", () => {
    const buf = new JitterBuffer();
    // onset false (the silence gate stopped it), pulseOnset true (tempo
    // tracking must still see it) — see FeatureFrame.pulseOnset's own doc.
    buf.push({ ...frame(1000, 0.5, false, 120), pulseOnset: true });

    expect(buf.consumeOnsetIfDue(1000)).toBe(false); // onset never fires
    expect(buf.consumePulseIfDue(999)).toBe(false); // not due yet
    expect(buf.consumePulseIfDue(1000)).toBe(true); // due now
    expect(buf.consumePulseIfDue(1001)).toBe(false); // already fired

    buf.push({ ...frame(1500, 0.6, false, 120), pulseOnset: true });
    expect(buf.consumePulseIfDue(1400)).toBe(false);
    expect(buf.consumePulseIfDue(1500)).toBe(true);
  });

  it("hands back the waveform of the frame covering the instant, not a blend", () => {
    const buf = new JitterBuffer();
    buf.push({ ...frame(0, 0), wave: { min: -0.1, max: 0.1 } });
    buf.push({ ...frame(33, 0), wave: { min: -0.8, max: 0.6 } });
    buf.push({ ...frame(66, 0), wave: null });

    expect(buf.sampleAt(10)!.wave).toEqual({ min: -0.8, max: 0.6 });
    expect(buf.sampleAt(0)!.wave).toEqual({ min: -0.1, max: 0.1 });
    expect(buf.sampleAt(50)!.wave).toBeNull();
    expect(buf.sampleAt(9999)!.wave).toBeNull();
  });

  it("reads no waveform from a frame that never carried one", () => {
    const buf = new JitterBuffer();
    buf.push(frame(0, 0.5));
    expect(buf.sampleAt(0)!.wave).toBeNull();
  });

  it("hands on gateOff from the frame at or before the instant", () => {
    const buf = new JitterBuffer();
    buf.push(frame(0, 0.5));
    buf.push({ ...frame(33, 0.5), gateOff: true });
    expect(buf.sampleAt(0)!.gateOff).toBe(false);
    expect(buf.sampleAt(20)!.gateOff).toBe(false);
    expect(buf.sampleAt(33)!.gateOff).toBe(true);
    expect(buf.sampleAt(9999)!.gateOff).toBe(true);
  });

  it("interpolates the song levels between frames", () => {
    const buf = new JitterBuffer();
    buf.push({ ...frame(0, 0.5), song: songFrame({ keys: 0, loudness: 1 }) });
    buf.push({ ...frame(100, 0.5), song: songFrame({ keys: 1, loudness: 0 }) });
    const mid = buf.sampleAt(25)!.song!;
    expect(mid.keys).toBeCloseTo(0.25, 5);
    expect(mid.loudness).toBeCloseTo(0.75, 5);
  });

  it("hands a song edge out once, when its time comes due", () => {
    const buf = new JitterBuffer();
    buf.push({ ...frame(0, 0.5), song: songFrame() });
    buf.push({ ...frame(50, 0.5), song: songFrame({ clap: true }) });
    buf.push({ ...frame(100, 0.5), song: songFrame() });
    expect(buf.sampleAt(25)!.song!.clap).toBe(false);
    expect(buf.sampleAt(60)!.song!.clap).toBe(true);
    expect(buf.sampleAt(70)!.song!.clap).toBe(false);
    expect(buf.sampleAt(100)!.song!.clap).toBe(false);
  });

  it("gives song null for a sender that sent none", () => {
    const buf = new JitterBuffer();
    buf.push(frame(0, 0.5));
    buf.push(frame(100, 0.5));
    expect(buf.sampleAt(50)!.song).toBeNull();
    expect(buf.sampleAt(500)!.song).toBeNull();
  });
});
