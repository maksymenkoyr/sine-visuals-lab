import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getSilenceGate,
  setSilenceGateClosed,
  setSilenceGateOpen,
  resetSilenceGate,
  silenceGateDimmer,
  isSilenceGateAuto,
  setSilenceGateAuto,
  resolveSilenceGate,
  feedSilenceGateMeasurement,
  silenceGateMarksForFloor,
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

// silenceGateMarksForFloor is the pure mapping the room-floor tracker leans
// on — a higher floor should never ask for a lower `closed` than a quieter
// one, and the gap between the two marks should track the shipped manual
// defaults' own gap regardless of where `closed` lands.
describe("silenceGateMarksForFloor", () => {
  it("keeps the same gap width as the shipped manual defaults, away from either clamp", () => {
    const gap = SILENCE_GATE_OPEN_DEFAULT - SILENCE_GATE_CLOSED_DEFAULT;
    for (const floor of [0.02, 0.1, 0.2]) {
      const marks = silenceGateMarksForFloor(floor);
      expect(marks.open - marks.closed).toBeCloseTo(gap);
    }
  });

  it("never returns closed at SILENCE_GATE_MIN even for a very low or negative floor", () => {
    for (const floor of [0, -1, -100]) {
      const marks = silenceGateMarksForFloor(floor);
      expect(marks.closed).toBeGreaterThan(SILENCE_GATE_MIN);
    }
  });

  it("never returns closed anywhere near SILENCE_GATE_MAX even for a very high floor", () => {
    const marks = silenceGateMarksForFloor(100);
    expect(marks.closed).toBeLessThan(SILENCE_GATE_MAX);
    expect(marks.open).toBeLessThanOrEqual(SILENCE_GATE_MAX);
  });

  it("is monotonically non-decreasing as the floor rises", () => {
    let prevClosed = -Infinity;
    for (let floor = -0.1; floor <= 1; floor += 0.05) {
      const marks = silenceGateMarksForFloor(floor);
      expect(marks.closed).toBeGreaterThanOrEqual(prevClosed - 1e-9);
      prevClosed = marks.closed;
    }
  });

  it("falls back sanely on a non-finite floor", () => {
    const marks = silenceGateMarksForFloor(Number.NaN);
    expect(Number.isFinite(marks.closed)).toBe(true);
    expect(Number.isFinite(marks.open)).toBe(true);
  });
});

describe("silence gate auto mode", () => {
  // Auto must be off before resetting the manual marks, or setSilenceGateAuto
  // wouldn't be the thing seeding the tracker off a known baseline — same
  // ordering autoGain.test.ts uses for its own auto-mode reset.
  beforeEach(() => {
    setSilenceGateAuto(false);
    resetSilenceGate();
  });

  it("resolveSilenceGate falls back to the manual marks while off", () => {
    expect(isSilenceGateAuto()).toBe(false);
    setSilenceGateClosed(0.02);
    setSilenceGateOpen(0.3);
    expect(resolveSilenceGate()).toEqual(getSilenceGate());
  });

  it("is a no-op to feed measurements while off — resolveSilenceGate stays on the manual marks", () => {
    setSilenceGateClosed(0.02);
    setSilenceGateOpen(0.3);
    feedSilenceGateMeasurement(0, 5);
    expect(resolveSilenceGate()).toEqual(getSilenceGate());
  });

  it("toggling on seeds from the current manual marks — no jump on the chip click", () => {
    // silenceGateMarksForFloor always reconstructs `open` as `closed` plus
    // the *default* gap (see its own doc comment) rather than whatever gap
    // the manual marks happened to have, so this uses a manual pair that
    // already sits at the default gap width — the case where seeding really
    // must reproduce both marks exactly, not just `closed`.
    const gap = SILENCE_GATE_OPEN_DEFAULT - SILENCE_GATE_CLOSED_DEFAULT;
    setSilenceGateClosed(0.08);
    setSilenceGateOpen(0.08 + gap);
    setSilenceGateAuto(true);
    const resolved = resolveSilenceGate();
    expect(resolved.closed).toBeCloseTo(0.08);
    expect(resolved.open).toBeCloseTo(0.08 + gap);
  });

  it("round-trips the flag", () => {
    setSilenceGateAuto(true);
    expect(isSilenceGateAuto()).toBe(true);
    setSilenceGateAuto(false);
    expect(isSilenceGateAuto()).toBe(false);
  });

  it("a steady low level pulls the marks to settle just above it", () => {
    setSilenceGateAuto(true);
    const quietLevel = 0.01; // below SILENCE_GATE_CLOSED_DEFAULT's own seed
    for (let i = 0; i < 60; i++) feedSilenceGateMeasurement(quietLevel, 1);
    const resolved = resolveSilenceGate();
    // "Just above" — closer to the room's own quiet level than to the
    // shipped default gap between the two marks, without pinning the exact
    // margin (an unmeasured placeholder — see this module's header).
    const gap = SILENCE_GATE_OPEN_DEFAULT - SILENCE_GATE_CLOSED_DEFAULT;
    expect(resolved.closed).toBeGreaterThan(quietLevel);
    expect(resolved.closed).toBeLessThan(quietLevel + gap);
  });

  it("a fluctuating, music-like level never lets the floor rise", () => {
    setSilenceGateAuto(true);
    const before = resolveSilenceGate();
    // Both levels sit above the seeded floor, so this only exercises the
    // steadiness gate, not the fast-drop path — a wide, constantly-moving
    // window should never read as "the room went quiet."
    for (let i = 0; i < 400; i++) feedSilenceGateMeasurement(i % 2 === 0 ? 0.4 : 0.15, 1 / 20);
    const after = resolveSilenceGate();
    expect(after.closed).toBeCloseTo(before.closed);
  });

  it("a level dropping below the floor pulls the marks down faster than an equally-distant rise", () => {
    // Mid-range starting point, away from either auto clamp in both
    // directions, so neither leg below saturates SILENCE_GATE_AUTO_CLOSED_
    // FLOOR/CEIL and confounds the comparison.
    setSilenceGateClosed(0.15);
    setSilenceGateAuto(true); // seeds the floor from that manual value
    const before = resolveSilenceGate();
    feedSilenceGateMeasurement(before.closed - 0.1, 0.1);
    const afterDrop = resolveSilenceGate().closed;

    // Fresh seed + fresh envelope for a clean second comparison — a
    // first-ever reading needs only one sample (both envelope bounds start
    // unset), so this isolates the rate difference from any envelope
    // warm-up effect the first leg left behind.
    setSilenceGateAuto(false);
    setSilenceGateClosed(0.15);
    setSilenceGateAuto(true);
    const beforeRise = resolveSilenceGate();
    feedSilenceGateMeasurement(beforeRise.closed + 0.1, 0.1);
    const afterRise = resolveSilenceGate().closed;

    const dropDelta = before.closed - afterDrop;
    const riseDelta = afterRise - beforeRise.closed;
    expect(dropDelta).toBeGreaterThan(0);
    expect(riseDelta).toBeGreaterThan(0);
    expect(dropDelta).toBeGreaterThan(riseDelta * 3);
  });

  it("auto closed never reaches SILENCE_GATE_MIN, even after a very long silence", () => {
    setSilenceGateAuto(true);
    for (let i = 0; i < 200; i++) feedSilenceGateMeasurement(0, 5);
    expect(resolveSilenceGate().closed).toBeGreaterThan(SILENCE_GATE_MIN);
  });

  it("auto closed never approaches SILENCE_GATE_MAX, even after a very long, loud drone", () => {
    setSilenceGateAuto(true);
    for (let i = 0; i < 200; i++) feedSilenceGateMeasurement(SILENCE_GATE_MAX, 5);
    expect(resolveSilenceGate().closed).toBeLessThan(SILENCE_GATE_MAX);
  });

  it("keeps the open >= closed + SILENCE_GATE_MIN_WIDTH invariant across a run with varied levels", () => {
    setSilenceGateAuto(true);
    const levels = [0.5, 0.02, 0.4, 0.01, 0.6, 0, 0.3];
    for (let i = 0; i < 200; i++) feedSilenceGateMeasurement(levels[i % levels.length], 1 / 30);
    const resolved = resolveSilenceGate();
    expect(resolved.open - resolved.closed).toBeGreaterThanOrEqual(SILENCE_GATE_MIN_WIDTH - 1e-9);
  });

  it("ignores a non-finite level or dt outright, holding the last estimate", () => {
    setSilenceGateAuto(true);
    feedSilenceGateMeasurement(0.02, 1); // establish a real reading first
    const before = resolveSilenceGate();
    feedSilenceGateMeasurement(Number.NaN, 1);
    feedSilenceGateMeasurement(0.02, Number.NaN);
    feedSilenceGateMeasurement(Number.POSITIVE_INFINITY, 1);
    expect(resolveSilenceGate()).toEqual(before);
  });
});

// Module-load default: a fresh profile (no stored "vibe.silenceGateAuto" key
// at all) must come up with auto ON, and — since setSilenceGateAuto(true)
// never runs on that path — the tracker's `floor` must still seed from
// whatever manual `closed` mark was stored, not the hardcoded shipped
// default. This needs its own fake localStorage plus vi.resetModules() and a
// fresh dynamic import, same pattern tests/autoTune.test.ts uses for its own
// load-time store tests.
describe("silence gate auto mode: default on module load", () => {
  function makeFakeLocalStorage() {
    const store = new Map<string, string>();
    return {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      raw: store,
    };
  }

  const originalLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;

  afterEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = originalLocalStorage;
    vi.resetModules();
  });

  it("a missing key loads as auto on", async () => {
    const fake = makeFakeLocalStorage();
    (globalThis as { localStorage?: unknown }).localStorage = fake;
    vi.resetModules();
    const fresh = await import("../src/audio/silenceGate.ts");
    expect(fresh.isSilenceGateAuto()).toBe(true);
  });

  it("a stored \"0\" loads as auto off", async () => {
    const fake = makeFakeLocalStorage();
    fake.setItem("vibe.silenceGateAuto", "0");
    (globalThis as { localStorage?: unknown }).localStorage = fake;
    vi.resetModules();
    const fresh = await import("../src/audio/silenceGate.ts");
    expect(fresh.isSilenceGateAuto()).toBe(false);
  });

  it("a stored \"1\" loads as auto on", async () => {
    const fake = makeFakeLocalStorage();
    fake.setItem("vibe.silenceGateAuto", "1");
    (globalThis as { localStorage?: unknown }).localStorage = fake;
    vi.resetModules();
    const fresh = await import("../src/audio/silenceGate.ts");
    expect(fresh.isSilenceGateAuto()).toBe(true);
  });

  it("with a stored manual closed mark and no auto key, resolveSilenceGate right after load honors it as the seed", async () => {
    const fake = makeFakeLocalStorage();
    const storedClosed = 0.12;
    fake.setItem("vibe.silenceGateClosed", String(storedClosed));
    fake.setItem("vibe.silenceGateOpen", String(storedClosed + 0.1));
    (globalThis as { localStorage?: unknown }).localStorage = fake;
    vi.resetModules();
    const fresh = await import("../src/audio/silenceGate.ts");

    expect(fresh.isSilenceGateAuto()).toBe(true); // no auto key stored -> on by default
    const resolved = fresh.resolveSilenceGate();
    // The tracker hasn't been fed a single measurement yet, so its `floor`
    // is still exactly its seed — silenceGateMarksForFloor's own closed for
    // that seed must equal the stored manual closed mark.
    expect(resolved.closed).toBeCloseTo(storedClosed);
  });
});
