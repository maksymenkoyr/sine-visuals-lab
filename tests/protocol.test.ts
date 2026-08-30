import { describe, it, expect } from "vitest";
import { encodeFeatureFrame, decodeFeatureFrame } from "../src/net/protocol.ts";
import { NUM_BANDS } from "../src/audio/types.ts";

describe("protocol", () => {
  it("round-trips every field within quantization tolerance", () => {
    const bands = new Float32Array(NUM_BANDS).map((_, i) => (i % NUM_BANDS) / (NUM_BANDS - 1));
    const frame = { bands, energy: 0.73, onset: true, bpm: 128.4, onsetPhase: 0.61, level: 0.42 };
    const roomTimeMs = 1_755_000_123_456.789;

    const buf = encodeFeatureFrame(frame, roomTimeMs);
    const decoded = decodeFeatureFrame(buf);

    expect(decoded).not.toBeNull();
    for (let i = 0; i < NUM_BANDS; i++) {
      expect(decoded!.bands[i]).toBeCloseTo(bands[i], 2); // 8-bit quantization
    }
    expect(decoded!.energy).toBeCloseTo(frame.energy, 2);
    expect(decoded!.onset).toBe(true);
    expect(decoded!.onsetPhase).toBeCloseTo(frame.onsetPhase, 3); // 16-bit quantization
    expect(decoded!.bpm).toBeCloseTo(frame.bpm, 1); // stored as bpm*10
    expect(decoded!.level).toBeCloseTo(frame.level, 2); // 8-bit quantization
    expect(decoded!.roomTimeMs).toBeCloseTo(roomTimeMs, 6); // float64, effectively exact
  });

  it("round-trips onset=false and boundary values", () => {
    const bands = new Float32Array(NUM_BANDS); // all zero
    const frame = { bands, energy: 0, onset: false, bpm: 0, onsetPhase: 0, level: 0 };

    const decoded = decodeFeatureFrame(encodeFeatureFrame(frame, 0));

    expect(decoded!.onset).toBe(false);
    expect(decoded!.energy).toBe(0);
    expect(decoded!.bpm).toBe(0);
    expect(decoded!.onsetPhase).toBe(0);
    expect(decoded!.level).toBe(0);
    expect(decoded!.roomTimeMs).toBe(0);
  });

  it("clamps out-of-range inputs instead of wrapping or corrupting the buffer", () => {
    const bands = new Float32Array(NUM_BANDS).fill(1.5); // out of [0,1]
    const frame = { bands, energy: -0.5, onset: true, bpm: 99999, onsetPhase: 2, level: 1.5 };

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
      { bands: new Float32Array(NUM_BANDS), energy: 0, onset: false, bpm: 0, onsetPhase: 0, level: 0 },
      0,
    );
    const corrupted = good.slice(0);
    new DataView(corrupted).setUint8(0, 99); // not MSG_FEATURE_FRAME
    expect(decodeFeatureFrame(corrupted)).toBeNull();
  });

  it("decodes a legacy (pre-level) frame, defaulting level to 0.5 instead of rejecting it", () => {
    // Simulates an old sender that never learned about the `level` byte —
    // build the 39-byte legacy layout by hand rather than adding a second
    // encode path just for this test.
    const LEGACY_BYTES = 1 + NUM_BANDS + 1 + 1 + 2 + 2 + 8;
    const buf = new ArrayBuffer(LEGACY_BYTES);
    const view = new DataView(buf);
    let o = 0;
    view.setUint8(o, 1); // MSG_FEATURE_FRAME
    o += 1;
    for (let i = 0; i < NUM_BANDS; i++, o += 1) view.setUint8(o, 128);
    view.setUint8(o, 200); // energy
    o += 1;
    view.setUint8(o, 1); // onset
    o += 1;
    view.setUint16(o, 30000, true); // onsetPhase
    o += 2;
    view.setUint16(o, 1200, true); // bpm*10
    o += 2;
    view.setFloat64(o, 42, true); // roomTimeMs

    const decoded = decodeFeatureFrame(buf);
    expect(decoded).not.toBeNull();
    expect(decoded!.level).toBe(0.5);
    expect(decoded!.roomTimeMs).toBe(42);
    expect(decoded!.bpm).toBeCloseTo(120, 1);
  });
});
