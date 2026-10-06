import { describe, it, expect } from "vitest";
import { encodeFeatureFrame, decodeFeatureFrame } from "../src/net/protocol.ts";
import { NUM_BANDS } from "../src/audio/types.ts";
import { isClipping } from "../src/audio/waveform.ts";

describe("protocol", () => {
  it("round-trips every field within quantization tolerance", () => {
    const bands = new Float32Array(NUM_BANDS).map((_, i) => (i % NUM_BANDS) / (NUM_BANDS - 1));
    const frame = { bands, energy: 0.73, onset: true, pulseOnset: true, bpm: 128.4, onsetPhase: 0.61, level: 0.42 };
    const roomTimeMs = 1_755_000_123_456.789;

    const buf = encodeFeatureFrame(frame, roomTimeMs);
    const decoded = decodeFeatureFrame(buf);

    expect(decoded).not.toBeNull();
    for (let i = 0; i < NUM_BANDS; i++) {
      expect(decoded!.bands[i]).toBeCloseTo(bands[i], 2); // 8-bit quantization
    }
    expect(decoded!.energy).toBeCloseTo(frame.energy, 2);
    expect(decoded!.onset).toBe(true);
    expect(decoded!.pulseOnset).toBe(true);
    expect(decoded!.onsetPhase).toBeCloseTo(frame.onsetPhase, 3); // 16-bit quantization
    expect(decoded!.bpm).toBeCloseTo(frame.bpm, 1); // stored as bpm*10
    expect(decoded!.level).toBeCloseTo(frame.level, 2); // 8-bit quantization
    expect(decoded!.roomTimeMs).toBeCloseTo(roomTimeMs, 6); // float64, effectively exact
  });

  it("round-trips onset=false and boundary values", () => {
    const bands = new Float32Array(NUM_BANDS); // all zero
    const frame = { bands, energy: 0, onset: false, pulseOnset: false, bpm: 0, onsetPhase: 0, level: 0 };

    const decoded = decodeFeatureFrame(encodeFeatureFrame(frame, 0));

    expect(decoded!.onset).toBe(false);
    expect(decoded!.pulseOnset).toBe(false);
    expect(decoded!.energy).toBe(0);
    expect(decoded!.bpm).toBe(0);
    expect(decoded!.onsetPhase).toBe(0);
    expect(decoded!.level).toBe(0);
    expect(decoded!.roomTimeMs).toBe(0);
  });

  it("round-trips every onset/pulseOnset bit combination", () => {
    const bands = new Float32Array(NUM_BANDS);
    for (const onset of [false, true]) {
      for (const pulseOnset of [false, true]) {
        const frame = { bands, energy: 0, onset, pulseOnset, bpm: 0, onsetPhase: 0, level: 0 };
        const decoded = decodeFeatureFrame(encodeFeatureFrame(frame, 0));
        expect(decoded!.onset, `onset=${onset} pulseOnset=${pulseOnset}`).toBe(onset);
        // Decode ORs bit1 with onset (see protocol.ts's header on the
        // mixed-version story) — bit0 alone still decodes pulseOnset true.
        expect(decoded!.pulseOnset, `onset=${onset} pulseOnset=${pulseOnset}`).toBe(pulseOnset || onset);
      }
    }
  });

  it("clamps out-of-range inputs instead of wrapping or corrupting the buffer", () => {
    const bands = new Float32Array(NUM_BANDS).fill(1.5); // out of [0,1]
    const frame = { bands, energy: -0.5, onset: true, pulseOnset: true, bpm: 99999, onsetPhase: 2, level: 1.5 };

    const decoded = decodeFeatureFrame(encodeFeatureFrame(frame, 1000));

    expect(decoded!.bands[0]).toBeCloseTo(1, 2);
    expect(decoded!.energy).toBe(0);
    expect(decoded!.bpm).toBeCloseTo(6553.5, 1); // Uint16 ceiling at bpm*10
    expect(decoded!.onsetPhase).toBeCloseTo(1, 3);
    expect(decoded!.level).toBeCloseTo(1, 2);
  });

  it("rejects buffers of the wrong length or wrong message type", () => {
    expect(decodeFeatureFrame(new ArrayBuffer(10))).toBeNull();
    const good = encodeFeatureFrame(
      { bands: new Float32Array(NUM_BANDS), energy: 0, onset: false, pulseOnset: false, bpm: 0, onsetPhase: 0, level: 0 },
      0,
    );
    const corrupted = good.slice(0);
    new DataView(corrupted).setUint8(0, 99); // not MSG_FEATURE_FRAME
    expect(decodeFeatureFrame(corrupted)).toBeNull();
  });

  it("rejects a frame whose room time is NaN or infinite", () => {
    const frame = { bands: new Float32Array(NUM_BANDS), energy: 0, onset: false, pulseOnset: false, bpm: 0, onsetPhase: 0, level: 0 };
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(decodeFeatureFrame(encodeFeatureFrame(frame, bad))).toBeNull();
    }
    expect(decodeFeatureFrame(encodeFeatureFrame(frame, 1_755_000_000_000))).not.toBeNull();
  });

  it("decodes a legacy (pre-level) frame, defaulting level to 0.5 instead of rejecting it", () => {
    // Simulates an old sender that never learned about the `level` byte, and
    // — same sender, before pulseOnset (bit1) existed — a flags byte with
    // only bit0 (onset) ever set: build the 39-byte legacy layout by hand
    // rather than adding a second encode path just for this test.
    const LEGACY_BYTES = 1 + NUM_BANDS + 1 + 1 + 2 + 2 + 8;
    const buf = new ArrayBuffer(LEGACY_BYTES);
    const view = new DataView(buf);
    let o = 0;
    view.setUint8(o, 1); // MSG_FEATURE_FRAME
    o += 1;
    for (let i = 0; i < NUM_BANDS; i++, o += 1) view.setUint8(o, 128);
    view.setUint8(o, 200); // energy
    o += 1;
    view.setUint8(o, 1); // flags: bit0 (onset) only — a legacy sender never sets bit1
    o += 1;
    view.setUint16(o, 30000, true); // onsetPhase
    o += 2;
    view.setUint16(o, 1200, true); // bpm*10
    o += 2;
    view.setFloat64(o, 42, true); // roomTimeMs

    const decoded = decodeFeatureFrame(buf);
    expect(decoded).not.toBeNull();
    expect(decoded!.onset).toBe(true);
    // bit1 unset but onset true -> pulseOnset = onset, not a pulse that never fires.
    expect(decoded!.pulseOnset).toBe(true);
    expect(decoded!.level).toBe(0.5);
    expect(decoded!.roomTimeMs).toBe(42);
    expect(decoded!.bpm).toBeCloseTo(120, 1);
  });

  it("leaves the wave tail off without a waveform, and decodes that as none", () => {
    const frame = { bands: new Float32Array(NUM_BANDS), energy: 0, onset: false, pulseOnset: false, bpm: 0, onsetPhase: 0, level: 0 };
    const buf = encodeFeatureFrame(frame, 1000);
    expect(buf.byteLength).toBe(1 + NUM_BANDS + 1 + 1 + 2 + 2 + 1 + 8);
    expect(decodeFeatureFrame(buf)!.wave).toBeNull();
  });

  it("round-trips the waveform, finer near silence than near full scale", () => {
    const frame = { bands: new Float32Array(NUM_BANDS), energy: 0.3, onset: true, pulseOnset: true, bpm: 120, onsetPhase: 0, level: 0.4 };
    const loud = decodeFeatureFrame(encodeFeatureFrame(frame, 1000, { min: -0.7, max: 0.65 }))!;
    expect(loud.wave!.min).toBeCloseTo(-0.7, 1);
    expect(loud.wave!.max).toBeCloseTo(0.65, 1);
    expect(loud.roomTimeMs).toBe(1000); // the tail doesn't move the fields before it
    expect(loud.level).toBeCloseTo(0.4, 2);
    const quiet = decodeFeatureFrame(encodeFeatureFrame(frame, 1000, { min: -0.01, max: 0.02 }))!;
    expect(quiet.wave!.min).toBeCloseTo(-0.01, 3);
    expect(quiet.wave!.max).toBeCloseTo(0.02, 3);
  });

  it("keeps a clipped sample clipped and a quiet one quiet", () => {
    const frame = { bands: new Float32Array(NUM_BANDS), energy: 0, onset: false, pulseOnset: false, bpm: 0, onsetPhase: 0, level: 0 };
    const clipped = decodeFeatureFrame(encodeFeatureFrame(frame, 0, { min: -1, max: 0.99 }))!;
    expect(isClipping(new Float32Array([clipped.wave!.min, clipped.wave!.max]))).toBe(true);
    const below = decodeFeatureFrame(encodeFeatureFrame(frame, 0, { min: -0.9, max: 0.9 }))!;
    expect(isClipping(new Float32Array([below.wave!.min, below.wave!.max]))).toBe(false);
    const silent = decodeFeatureFrame(encodeFeatureFrame(frame, 0, { min: 0, max: 0 }))!;
    expect(silent.wave).toEqual({ min: 0, max: 0 });
  });

  it("reads the known prefix of a frame longer than this layout", () => {
    const frame = { bands: new Float32Array(NUM_BANDS), energy: 0.5, onset: false, pulseOnset: false, bpm: 90, onsetPhase: 0, level: 0.5 };
    const buf = encodeFeatureFrame(frame, 777, { min: -0.25, max: 0.25 });
    const longer = new Uint8Array(buf.byteLength + 3);
    longer.set(new Uint8Array(buf));
    const decoded = decodeFeatureFrame(longer.buffer);
    expect(decoded!.roomTimeMs).toBe(777);
    expect(decoded!.wave!.max).toBeCloseTo(0.25, 2);
  });
});

