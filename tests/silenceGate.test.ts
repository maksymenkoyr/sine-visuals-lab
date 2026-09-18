import { describe, it, expect, beforeEach } from "vitest";
import {
  getSilenceGate,
  setSilenceGateClosed,
  setSilenceGateOpen,
  resetSilenceGate,
  silenceGateDimmer,
  SILENCE_GATE_MIN,
  SILENCE_GATE_MAX,
  SILENCE_GATE_MIN_WIDTH,
  SILENCE_GATE_CLOSED_DEFAULT,
  SILENCE_GATE_OPEN_DEFAULT,
} from "../src/audio/silenceGate.ts";
import { createSyntheticFeed } from "../src/audio/synthetic.ts";

// Single global value, like autoGain/bandSplit — every test resets first so
// none of them can leak state into the next (vitest runs a file's tests in
// one module instance, sharing the module-level cache).
describe("silence gate persistence", () => {
  beforeEach(() => {
    resetSilenceGate();
  });

  // vitest runs under environment: "node" (vitest.config.ts), so there is no
  // localStorage global at all here — this also proves the module tolerates that.
  it("defaults to the documented closed/open marks", () => {
    expect(getSilenceGate()).toEqual({ closed: SILENCE_GATE_CLOSED_DEFAULT, open: SILENCE_GATE_OPEN_DEFAULT });
  });

  it("round-trips a set anywhere in range", () => {
    setSilenceGateClosed(0.02);
    setSilenceGateOpen(0.3);
    expect(getSilenceGate()).toEqual({ closed: 0.02, open: 0.3 });
  });

  it("clamps out-of-range and non-finite values", () => {
    setSilenceGateClosed(-1);
    expect(getSilenceGate().closed).toBe(SILENCE_GATE_MIN);
    setSilenceGateClosed(Number.NaN);
    expect(getSilenceGate().closed).toBe(SILENCE_GATE_CLOSED_DEFAULT);

    resetSilenceGate();
    setSilenceGateOpen(99);
    expect(getSilenceGate().open).toBe(SILENCE_GATE_MAX);
    setSilenceGateOpen(Number.NaN);
    expect(getSilenceGate().open).toBe(SILENCE_GATE_OPEN_DEFAULT);
  });

  it("getSilenceGate returns a snapshot the caller can't mutate", () => {
    const marks = getSilenceGate();
    expect(() => {
      (marks as { closed: number }).closed = 0.9;
    }).toThrow();
    expect(getSilenceGate().closed).toBe(SILENCE_GATE_CLOSED_DEFAULT);
  });

  describe("the open >= closed + SILENCE_GATE_MIN_WIDTH invariant", () => {
    it("pushing closed above open drags open up", () => {
      setSilenceGateOpen(0.2);
      setSilenceGateClosed(0.25);
      const marks = getSilenceGate();
      expect(marks.closed).toBeCloseTo(0.25);
      expect(marks.open).toBeCloseTo(0.25 + SILENCE_GATE_MIN_WIDTH);
    });

    it("pushing open below closed drags closed down", () => {
      setSilenceGateClosed(0.3);
      setSilenceGateOpen(0.1);
      const marks = getSilenceGate();
      expect(marks.open).toBeCloseTo(0.1);
      expect(marks.closed).toBeCloseTo(0.1 - SILENCE_GATE_MIN_WIDTH);
    });

    it("holds at the top end: closed can't push open past SILENCE_GATE_MAX", () => {
      setSilenceGateClosed(SILENCE_GATE_MAX);
      const marks = getSilenceGate();
      expect(marks.open).toBe(SILENCE_GATE_MAX);
      expect(marks.closed).toBeCloseTo(SILENCE_GATE_MAX - SILENCE_GATE_MIN_WIDTH);
      expect(marks.open - marks.closed).toBeGreaterThanOrEqual(SILENCE_GATE_MIN_WIDTH - 1e-9);
    });

    it("holds at the bottom end: open can't push closed below SILENCE_GATE_MIN", () => {
      setSilenceGateOpen(SILENCE_GATE_MIN);
      const marks = getSilenceGate();
      expect(marks.closed).toBe(SILENCE_GATE_MIN);
      expect(marks.open).toBeCloseTo(SILENCE_GATE_MIN + SILENCE_GATE_MIN_WIDTH);
      expect(marks.open - marks.closed).toBeGreaterThanOrEqual(SILENCE_GATE_MIN_WIDTH - 1e-9);
    });

    it("never violates the invariant across a sweep of both marks", () => {
      for (let c = SILENCE_GATE_MIN; c <= SILENCE_GATE_MAX; c += 0.03) {
        setSilenceGateClosed(c);
        const marks = getSilenceGate();
        expect(marks.open - marks.closed).toBeGreaterThanOrEqual(SILENCE_GATE_MIN_WIDTH - 1e-9);
      }
      for (let o = SILENCE_GATE_MAX; o >= SILENCE_GATE_MIN; o -= 0.03) {
        setSilenceGateOpen(o);
        const marks = getSilenceGate();
        expect(marks.open - marks.closed).toBeGreaterThanOrEqual(SILENCE_GATE_MIN_WIDTH - 1e-9);
      }
    });
  });
});

describe("silenceGateDimmer", () => {
  const marks = { closed: 0.1, open: 0.3 };

  it("is 0 at and below the closed mark", () => {
    expect(silenceGateDimmer(0.1, marks)).toBe(0);
    expect(silenceGateDimmer(0.05, marks)).toBe(0);
    expect(silenceGateDimmer(SILENCE_GATE_MIN, marks)).toBe(0);
  });

  it("is 1 at and above the open mark", () => {
    expect(silenceGateDimmer(0.3, marks)).toBe(1);
    expect(silenceGateDimmer(0.9, marks)).toBe(1);
  });

  it("is strictly between 0 and 1 inside the marks", () => {
    const mid = silenceGateDimmer(0.2, marks);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it("is monotonically non-decreasing across a sweep from closed to open", () => {
    let prev = -1;
    for (let level = 0; level <= 0.4; level += 0.01) {
      const d = silenceGateDimmer(level, marks);
      expect(d).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = d;
    }
  });

  it("is always 1 — the gate off — when closed sits at SILENCE_GATE_MIN", () => {
    const off = { closed: SILENCE_GATE_MIN, open: 0.3 };
    expect(silenceGateDimmer(0, off)).toBe(1);
    expect(silenceGateDimmer(0.01, off)).toBe(1);
    expect(silenceGateDimmer(0.5, off)).toBe(1);
  });

  it("fails open on a non-finite level", () => {
    expect(silenceGateDimmer(Number.NaN, marks)).toBe(1);
    expect(silenceGateDimmer(Number.POSITIVE_INFINITY, marks)).toBe(1);
  });

  // The default marks are placeholders picked so that src/audio/synthetic.ts's
  // feed — every headless screenshot/tuning tool run with ?audio=synthetic —
  // is never dimmed. Drive the real feed across a long span at the default
  // marks and check every frame agrees, rather than trusting the arithmetic
  // (SILENCE_GATE_OPEN_DEFAULT sitting at synthetic's own quietest `level`)
  // by eye.
  it("never dims the synthetic feed at the default marks", () => {
    const defaults = { closed: SILENCE_GATE_CLOSED_DEFAULT, open: SILENCE_GATE_OPEN_DEFAULT };
    const feed = createSyntheticFeed();
    const dt = 1 / 60;
    for (let t = 0; t < 60; t += dt) {
      const frame = feed.frame(t);
      expect(silenceGateDimmer(frame.level, defaults)).toBe(1);
    }
  });
});
