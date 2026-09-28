import { describe, it, expect } from "vitest";
import {
  createInputHealth,
  mainsHumHz,
  CLIP_HOLD_SEC,
  SKIP_HOLD_SEC,
  SILENT_DB,
  SILENT_AFTER_SEC,
  SILENT_CLEAR_MARGIN_DB,
  HUM_AFTER_SEC,
  HUM_CLEAR_SEC,
  type InputHealth,
  type InputHealthReading,
  type InputMeasure,
} from "../src/audio/inputHealth.ts";

const DT = 1 / 60;

/** A benign default reading — loud enough that "silent" never fires, nothing
 *  else set — so a test only exercising one condition doesn't need to spell
 *  out every field. */
function measure(overrides: Partial<InputMeasure> = {}): InputMeasure {
  return { peakL: 0, peakR: 0, rmsDb: -20, humHz: null, glitchFrames: null, ...overrides };
}

/** Calls advance() with DT `count` times, same measure every tick, and
 *  returns the last reading — the shape every hold/entry test below drives. */
function advanceTicks(ih: InputHealth, count: number, m: InputMeasure): InputHealthReading {
  let last: InputHealthReading = { kind: "ok" };
  for (let i = 0; i < count; i++) last = ih.advance(DT, m);
  return last;
}

// ---- mainsHumHz --------------------------------------------------------

/** A hum-shaped tone: the fundamental plus falling-off odd harmonics, the
 *  shape a ground loop actually produces (not a bare sine) — see this
 *  function's callers for why the detector has to survive that. */
function humSignal(hz: number, sampleRate: number, samples: number, amplitude = 0.3): Float32Array {
  const harmonics = [1, 3, 5, 7];
  const weights = [1, 1 / 3, 1 / 5, 1 / 7];
  const buf = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    let s = 0;
    for (let h = 0; h < harmonics.length; h++) s += weights[h] * Math.sin(2 * Math.PI * hz * harmonics[h] * t);
    buf[i] = amplitude * s;
  }
  return buf;
}

/** Deterministic PRNG (mulberry32) so the white-noise test can't flake. */
function whiteNoise(samples: number, seed = 1): Float32Array {
  let a = seed;
  const buf = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    buf[i] = r * 2 - 1;
  }
  return buf;
}

/** A train of kick drums, each a fast 150->50 Hz pitch sweep over a decaying
 *  envelope, retriggered on a period unrelated to either mains lag — real
 *  percussive content, not hum, and not periodic at a fixed 50/60 Hz lag
 *  even though its own pitch passes through both on the way down. */
function kickSweepTrain(sampleRate: number, samples: number): Float32Array {
  const kickPeriod = Math.round(sampleRate / 2.3);
  const buf = new Float32Array(samples);
  let phase = 0;
  for (let i = 0; i < samples; i++) {
    const tKick = (i % kickPeriod) / sampleRate;
    const freq = 50 + (150 - 50) * Math.exp(-tKick / 0.03);
    phase += (2 * Math.PI * freq) / sampleRate;
    const amp = Math.exp(-tKick / 0.12);
    buf[i] = amp * Math.sin(phase);
  }
  return buf;
}

describe("mainsHumHz", () => {
  it("locks onto a 50 Hz hum (with odd harmonics) at 48kHz", () => {
    expect(mainsHumHz(humSignal(50, 48000, 4096), 48000)).toBe(50);
  });

  it("locks onto a 50 Hz hum (with odd harmonics) at 44.1kHz", () => {
    expect(mainsHumHz(humSignal(50, 44100, 4096), 44100)).toBe(50);
  });

  it("locks onto a 60 Hz hum the same way", () => {
    expect(mainsHumHz(humSignal(60, 48000, 4096), 48000)).toBe(60);
    expect(mainsHumHz(humSignal(60, 44100, 4096), 44100)).toBe(60);
  });

  it("white noise never locks", () => {
    expect(mainsHumHz(whiteNoise(4096), 48000)).toBeNull();
  });

  it("a decaying 50->150 Hz kick sweep train doesn't read as hum", () => {
    expect(mainsHumHz(kickSweepTrain(48000, 8192), 48000)).toBeNull();
  });

  it("digital silence reads null, not a false lock", () => {
    expect(mainsHumHz(new Float32Array(4096), 48000)).toBeNull();
  });
});

// ---- createInputHealth's state machine ---------------------------------

describe("createInputHealth", () => {
  it("reads ok with nothing wrong", () => {
    const ih = createInputHealth();
    expect(ih.advance(DT, measure()).kind).toBe("ok");
  });

  describe("clipping", () => {
    it("names the clipped channel and holds for CLIP_HOLD_SEC after the last clip", () => {
      const ih = createInputHealth();
      expect(ih.advance(DT, measure({ peakL: 1, peakR: 0 }))).toEqual({ kind: "clipping", channel: "left" });

      // Well inside the hold (< CLIP_HOLD_SEC since the clip) — still
      // clipping, still "left", even though nothing is clipping right now.
      const stillHeld = advanceTicks(ih, Math.round(CLIP_HOLD_SEC * 60) - 10, measure());
      expect(stillHeld).toEqual({ kind: "clipping", channel: "left" });

      // Past CLIP_HOLD_SEC since the last clip — cleared.
      const cleared = advanceTicks(ih, 20, measure());
      expect(cleared.kind).toBe("ok");
    });

    it("reports the right channel alone", () => {
      const ih = createInputHealth();
      expect(ih.advance(DT, measure({ peakL: 0, peakR: 1 }))).toEqual({ kind: "clipping", channel: "right" });
    });

    it("reports both when both channels clip together", () => {
      const ih = createInputHealth();
      expect(ih.advance(DT, measure({ peakL: 1, peakR: 1 }))).toEqual({ kind: "clipping", channel: "both" });
    });

    it("reports both for a mono track (peakR null) even though there's only one channel to blame", () => {
      const ih = createInputHealth();
      expect(ih.advance(DT, measure({ peakL: 1, peakR: null }))).toEqual({ kind: "clipping", channel: "both" });
    });
  });

  describe("skipping", () => {
    it("fires on a glitchFrames rise, ignoring the first reading and null readings", () => {
      const ih = createInputHealth();
      // First-ever reading: nothing to compare against, must be ignored.
      expect(ih.advance(DT, measure({ glitchFrames: 5 })).kind).toBe("ok");
      // Same value again — no rise.
      expect(ih.advance(DT, measure({ glitchFrames: 5 })).kind).toBe("ok");
      // A tick with no reading at all must be ignored outright — neither a
      // rise nor a reset of the last known value.
      expect(ih.advance(DT, measure({ glitchFrames: null })).kind).toBe("ok");
      expect(ih.advance(DT, measure({ glitchFrames: 5 })).kind).toBe("ok"); // still no rise vs. the last real reading
      // A genuine rise fires immediately, no entry delay.
      expect(ih.advance(DT, measure({ glitchFrames: 8 })).kind).toBe("skipping");
    });

    it("holds for SKIP_HOLD_SEC after the last rise, then clears", () => {
      const ih = createInputHealth();
      ih.advance(DT, measure({ glitchFrames: 1 }));
      expect(ih.advance(DT, measure({ glitchFrames: 2 })).kind).toBe("skipping"); // the rise

      const stillHeld = advanceTicks(ih, Math.round(SKIP_HOLD_SEC * 60) - 10, measure({ glitchFrames: 2 }));
      expect(stillHeld.kind).toBe("skipping");

      const cleared = advanceTicks(ih, 20, measure({ glitchFrames: 2 }));
      expect(cleared.kind).toBe("ok");
    });
  });

  describe("silent", () => {
    const quiet = measure({ rmsDb: SILENT_DB - 5 });

    it("only reports after SILENT_AFTER_SEC of continuous quiet", () => {
      const ih = createInputHealth();
      const before = advanceTicks(ih, Math.round(SILENT_AFTER_SEC * 60) - 10, quiet);
      expect(before.kind).toBe("ok");
      const after = advanceTicks(ih, 20, quiet);
      expect(after.kind).toBe("silent");
    });

    it("clears instantly once rmsDb climbs SILENT_CLEAR_MARGIN_DB above SILENT_DB", () => {
      const ih = createInputHealth();
      advanceTicks(ih, Math.round(SILENT_AFTER_SEC * 60) + 10, quiet);

      // A level between the entry mark and the clear mark must NOT clear it
      // — same two-mark hysteresis as silenceGate.ts.
      const between = ih.advance(DT, measure({ rmsDb: SILENT_DB + SILENT_CLEAR_MARGIN_DB - 1 }));
      expect(between.kind).toBe("silent");

      // One tick at/above the clear mark clears it immediately — no hold.
      const cleared = ih.advance(DT, measure({ rmsDb: SILENT_DB + SILENT_CLEAR_MARGIN_DB }));
      expect(cleared.kind).toBe("ok");
    });
  });

  describe("hum", () => {
    it("only reports after HUM_AFTER_SEC of a continuous humHz reading, then clears after HUM_CLEAR_SEC without one", () => {
      const ih = createInputHealth();
      const before = advanceTicks(ih, Math.round(HUM_AFTER_SEC * 60) - 10, measure({ humHz: 50 }));
      expect(before.kind).toBe("ok");
      const after = advanceTicks(ih, 20, measure({ humHz: 50 }));
      expect(after).toEqual({ kind: "hum", humHz: 50 });

      // Drops out, but for less than HUM_CLEAR_SEC — still reported.
      const stillHeld = advanceTicks(ih, Math.round(HUM_CLEAR_SEC * 60) - 10, measure({ humHz: null }));
      expect(stillHeld.kind).toBe("hum");

      // Past HUM_CLEAR_SEC without a reading — cleared.
      const cleared = advanceTicks(ih, 20, measure({ humHz: null }));
      expect(cleared.kind).toBe("ok");
    });
  });

  it("priority: clipping > skipping > silent > hum > ok", () => {
    const ih = createInputHealth();
    // Quiet AND humming at once, long enough for both silent and hum to
    // qualify — silent must win.
    const silentAndHumming = measure({ rmsDb: SILENT_DB - 5, humHz: 50 });
    const silent = advanceTicks(ih, Math.round(SILENT_AFTER_SEC * 60) + 10, silentAndHumming);
    expect(silent.kind).toBe("silent");

    // Add a glitch rise on top — skipping must win over silent (and hum).
    ih.advance(DT, { ...silentAndHumming, glitchFrames: 1 });
    const skipping = ih.advance(DT, { ...silentAndHumming, glitchFrames: 2 });
    expect(skipping.kind).toBe("skipping");

    // Add a clip on top of everything — clipping must win over all of it.
    const clipping = ih.advance(DT, { ...silentAndHumming, peakL: 1, glitchFrames: 2 });
    expect(clipping.kind).toBe("clipping");
  });

  it("reset() clears every hold/entry timer, not just the latched reading", () => {
    const ih = createInputHealth();
    const quiet = measure({ rmsDb: SILENT_DB - 5 });
    const silent = advanceTicks(ih, Math.round(SILENT_AFTER_SEC * 60) + 10, quiet);
    expect(silent.kind).toBe("silent");

    ih.reset();
    // Right after reset, a single quiet tick must NOT already read silent —
    // the entry timer needs a fresh SILENT_AFTER_SEC, proving reset() zeroed
    // the accumulator and not just the latched flag.
    expect(ih.advance(DT, quiet).kind).toBe("ok");

    // Clipping is cleared too.
    const ih2 = createInputHealth();
    ih2.advance(DT, measure({ peakL: 1 }));
    ih2.reset();
    expect(ih2.advance(DT, measure()).kind).toBe("ok");
  });
});
