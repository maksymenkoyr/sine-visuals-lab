import { describe, it, expect } from "vitest";
import {
  createBeatListener,
  resolveHold,
  sourceEdge,
  SOURCE_SIGNAL,
  type HoldBeats,
} from "../src/render/beatListener.ts";
import { CUT_LISTENER } from "../src/render/scenes/shards/layout.ts";
import { SIGNALS } from "../src/render/signals.ts";
import type { AnimFrame } from "../src/render/animClock.ts";
import type { OnsetDiag } from "../src/audio/onsetDiag.ts";
import type { HitParts } from "../src/audio/hitStrength.ts";

const NULL_DIAG: OnsetDiag = { ratio: 0, gated: false, blocked: false, sinceOnsetSec: Infinity };
const NULL_HIT: HitParts = { standout: 0, loudness: 0, strength: 0 };

// Minimal AnimFrame factory, same shape as renderLatch.test.ts's own — only
// the fields a given test cares about vary per call.
function frame(overrides: Partial<AnimFrame> = {}): AnimFrame {
  return {
    dtSec: 1 / 60,
    timeSec: 0,
    flowPhase: 0,
    beatPulse: 0,
    onset: false,
    beatRatio: 0,
    beatPhase: 0,
    barPhase: 0,
    tempoLock: 0,
    beats: 0,
    tempoBpm: 0,
    low: 0,
    mid: 0,
    high: 0,
    lowPulse: 0,
    midPulse: 0,
    highPulse: 0,
    lowOnset: false,
    midOnset: false,
    highOnset: false,
    sectionIntensity: 0,
    dropPulse: 0,
    dropOnset: false,
    centroid: 0,
    centroidRaw: 0,
    bpm: 0,
    gateDimmer: 1,
    hits: { low: NULL_DIAG, mid: NULL_DIAG, high: NULL_DIAG },
    hitStrength: { beat: NULL_HIT, low: NULL_HIT, mid: NULL_HIT, high: NULL_HIT },
    profile: { pulse: 0, tempo: 0, brightness: 0, density: 0, dynamics: 0, attack: 0, loudness: 0 },
    raw: { sectionIntensity: 0, profile: { pulse: 0, tempo: 0, brightness: 0, density: 0, dynamics: 0, attack: 0, loudness: 0 } },
    ...overrides,
  };
}

describe("sourceEdge", () => {
  it("reads the matching AnimFrame one-shot for beat/bass/mid/high/drop", () => {
    expect(sourceEdge("beat", frame({ onset: true }), null)).toBe(true);
    expect(sourceEdge("beat", frame({ lowOnset: true }), null)).toBe(false);
    expect(sourceEdge("bass", frame({ lowOnset: true }), null)).toBe(true);
    expect(sourceEdge("mid", frame({ midOnset: true }), null)).toBe(true);
    expect(sourceEdge("high", frame({ highOnset: true }), null)).toBe(true);
    expect(sourceEdge("drop", frame({ dropOnset: true }), null)).toBe(true);
  });

  it("bar wraps on a barPhase drop while tempoLock is confident, else falls back to the beat edge", () => {
    // Locked: a real wrap (this tick's phase below the last tick's).
    expect(sourceEdge("bar", frame({ tempoLock: 1, barPhase: 0.1 }), 0.9)).toBe(true);
    // Locked, no wrap.
    expect(sourceEdge("bar", frame({ tempoLock: 1, barPhase: 0.5 }), 0.4)).toBe(false);
    // Locked but no prior phase to compare against yet.
    expect(sourceEdge("bar", frame({ tempoLock: 1, barPhase: 0.1 }), null)).toBe(false);
    // Not locked (tempoLock <= 0.5): falls back to the plain beat edge.
    expect(sourceEdge("bar", frame({ tempoLock: 0.2, barPhase: 0.1, onset: true }), 0.9)).toBe(true);
    expect(sourceEdge("bar", frame({ tempoLock: 0.2, barPhase: 0.1, onset: false }), 0.9)).toBe(false);
  });
});

describe("resolveHold", () => {
  // Reproduces shards' pre-listener minHoldSec exactly — see layout.ts's
  // CUT_LISTENER, which carries these same three numbers.
  it("reproduces the three minHoldSec cases", () => {
    const hold: HoldBeats = { beats: 0.7, fallbackSec: 0.25, lockMin: 0.35 };
    expect(resolveHold(hold, 0, 0)).toBeCloseTo(0.25, 5);
    expect(resolveHold(hold, 0.2, 160)).toBeCloseTo(0.25, 5);
    expect(resolveHold(hold, 1, 160)).toBeCloseTo((0.7 * 60) / 160, 5);
    // A 160 bpm beat is 375 ms; the hold must let every beat through.
    expect(resolveHold(hold, 1, 160)).toBeLessThan(60 / 160);
  });

  it("a plain number holds for exactly that many seconds regardless of tempo", () => {
    expect(resolveHold(0.5, 1, 160)).toBe(0.5);
    expect(resolveHold(0.5, 0, 0)).toBe(0.5);
  });

  it("undefined holds for nothing", () => {
    expect(resolveHold(undefined, 1, 160)).toBe(0);
  });
});

describe("createBeatListener", () => {
  it("fires on the very first edge", () => {
    const listener = createBeatListener({ source: "beat" });
    const r = listener.advance(frame({ onset: true }));
    expect(r.fired).toBe(true);
    expect(r.reason).toBe("fired");
  });

  it("blocks a second edge inside the refractory, holds one inside the hold, then fires again", () => {
    const listener = createBeatListener({ source: "beat", refractorySec: 0.05, hold: 0.2 });
    const first = listener.advance(frame({ onset: true }));
    expect(first.fired).toBe(true);

    // ~17ms later: inside the refractory window.
    const second = listener.advance(frame({ onset: true }));
    expect(second.fired).toBe(false);
    expect(second.reason).toBe("refractory");

    // Advance well past the refractory but still inside the 0.2s hold.
    for (let i = 0; i < 6; i++) listener.advance(frame());
    const held = listener.advance(frame({ onset: true }));
    expect(held.fired).toBe(false);
    expect(held.reason).toBe("held");

    // Past the hold entirely.
    for (let i = 0; i < 20; i++) listener.advance(frame());
    const third = listener.advance(frame({ onset: true }));
    expect(third.fired).toBe(true);
  });

  it("reason is 'quiet' on a tick with no edge", () => {
    const listener = createBeatListener({ source: "beat" });
    listener.advance(frame({ onset: true }));
    const r = listener.advance(frame({ onset: false }));
    expect(r.fired).toBe(false);
    expect(r.reason).toBe("quiet");
  });

  it("pulse jumps to 1 on a fire and decays at pulseDecayPerSec afterward", () => {
    const listener = createBeatListener({ source: "beat", pulseDecayPerSec: 10 });
    const fired = listener.advance(frame({ onset: true }));
    expect(fired.pulse).toBe(1);
    const later = listener.advance(frame({ onset: false, dtSec: 1 }));
    expect(later.pulse).toBeCloseTo(Math.exp(-10), 6);
  });

  it("reset() clears sinceFireSec back to Infinity, so the next edge fires immediately", () => {
    const listener = createBeatListener({ source: "beat", hold: 10 });
    listener.advance(frame({ onset: true }));
    listener.reset();
    const r = listener.advance(frame({ onset: true }));
    expect(r.fired).toBe(true);
  });

  it("an explicit source overrides the spec's default for that call only", () => {
    const listener = createBeatListener({ source: "beat" });
    const r = listener.advance(frame({ lowOnset: true }), "bass");
    expect(r.fired).toBe(true);
  });

  describe("CUT_LISTENER (shards)", () => {
    it("holds a busy 160bpm eighth-note track to 4-7 arrangements in 2s", () => {
      const listener = createBeatListener(CUT_LISTENER);
      const bpm = 160;
      const eighth = 60 / bpm / 2;
      const dt = 1 / 60;
      let t = 0;
      let next = 0;
      let fired = 0;
      while (t < 2) {
        const isEdge = t >= next;
        if (isEdge) next += eighth;
        const r = listener.advance(frame({ onset: isEdge, tempoLock: 1, bpm, dtSec: dt }));
        if (r.fired) fired++;
        t += dt;
      }
      // About one per beat (5.3 beats in 2s), not one per onset (10.7).
      expect(fired).toBeGreaterThanOrEqual(4);
      expect(fired).toBeLessThanOrEqual(7);
    });

    it("holds a same-beat edge inside the refractory/hold", () => {
      const listener = createBeatListener(CUT_LISTENER);
      const first = listener.advance(frame({ onset: true, tempoLock: 1, bpm: 160 }));
      expect(first.fired).toBe(true);
      const second = listener.advance(frame({ onset: true, tempoLock: 1, bpm: 160 }));
      expect(second.fired).toBe(false);
      expect(["held", "refractory"]).toContain(second.reason);
    });
  });
});

describe("SOURCE_SIGNAL", () => {
  it("every entry resolves in SIGNALS", () => {
    for (const id of Object.values(SOURCE_SIGNAL)) {
      expect(SIGNALS[id!]).toBeDefined();
    }
  });
});
