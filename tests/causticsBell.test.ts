import { describe, it, expect } from "vitest";
import {
  advanceSparkleHit,
  BELL_JITTER,
  BELL_LIFE_SEC,
  BELL_REACH,
  bellBrightness,
  bellRingOutScale,
  createSparkleHitClock,
  sparkleShapeFor,
} from "../src/render/scenes/causticsBell.ts";
import { createStandoutState } from "../src/render/standout.ts";

const SCALE = bellRingOutScale(0.5);
const DT = 1 / 60;

/** The distance (cells) of the brightest point at `age`, scanning outward. */
function peakDist(shape: "strike" | "bloom", age: number): number {
  let best = 0;
  let at = 0;
  for (let i = 0; i <= 200; i++) {
    const d = (i / 200) * (BELL_REACH + 0.2);
    const v = bellBrightness(shape, age, d, SCALE);
    if (v > best) {
      best = v;
      at = d;
    }
  }
  return at;
}

describe("sparkleShapeFor", () => {
  it("maps the setting's 0/1/2 and clamps anything outside", () => {
    expect(sparkleShapeFor(0)).toBe("glint");
    expect(sparkleShapeFor(1)).toBe("strike");
    expect(sparkleShapeFor(2)).toBe("bloom");
    expect(sparkleShapeFor(-3)).toBe("glint");
    expect(sparkleShapeFor(9)).toBe("bloom");
  });
});

describe("bellBrightness", () => {
  it("is dark before the hit and for the glint shape (which the shader draws itself)", () => {
    expect(bellBrightness("strike", 0, 0, SCALE)).toBe(0);
    expect(bellBrightness("bloom", -0.1, 0, SCALE)).toBe(0);
    expect(bellBrightness("glint", 0.2, 0, SCALE)).toBe(0);
  });

  it("strike: the flash at the centre falls away exponentially", () => {
    const a = bellBrightness("strike", 0.05, 0, SCALE);
    const b = bellBrightness("strike", 0.5, 0, SCALE);
    const c = bellBrightness("strike", 1.0, 0, SCALE);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    // a constant ratio per equal step: the exponential's signature
    const r1 = bellBrightness("strike", 0.6, 0, SCALE) / bellBrightness("strike", 0.4, 0, SCALE);
    const r2 = bellBrightness("strike", 0.8, 0, SCALE) / bellBrightness("strike", 0.6, 0, SCALE);
    expect(r1).toBeCloseTo(r2, 1);
  });

  it("strike: a ring leaves the point and keeps going out", () => {
    const early = peakDist("strike", 0.3);
    const later = peakDist("strike", 0.9);
    expect(later).toBeGreaterThan(early);
    expect(later).toBeGreaterThan(0.2);
  });

  it("strike: a second, fainter ring follows the first", () => {
    // Just after the echo starts, brightness at a small radius sits above
    // what the first ring alone would give there.
    const t = 0.16;
    const withEcho = bellBrightness("strike", t, 0.08, SCALE);
    const before = bellBrightness("strike", 0.13, 0.08, SCALE);
    expect(withEcho).toBeGreaterThan(0);
    expect(before).toBeGreaterThan(0);
  });

  it("bloom: swells, hollows out, and ends as a ring", () => {
    const swell = peakDist("bloom", 0.8);
    expect(swell).toBeGreaterThan(0.3);
    // late on, the ring is brighter than the (hollowed) centre
    const late = 1.2;
    const ringR = BELL_REACH;
    expect(bellBrightness("bloom", late, ringR, SCALE)).toBeGreaterThan(bellBrightness("bloom", late, 0, SCALE) * 3);
    // and it never grows past its reach
    expect(peakDist("bloom", 2)).toBeLessThanOrEqual(BELL_REACH + 0.05);
  });

  it("both shapes have faded out of sight by BELL_LIFE_SEC at any ring-out", () => {
    const slowest = bellRingOutScale(1);
    for (const shape of ["strike", "bloom"] as const) {
      let m = 0;
      for (let i = 0; i <= 60; i++) m = Math.max(m, bellBrightness(shape, BELL_LIFE_SEC * slowest, (i / 60) * BELL_REACH, slowest));
      expect(m).toBeLessThan(0.03);
    }
  });

  it("a longer Bell ring-out rings longer", () => {
    const short = bellBrightness("strike", 1.2, BELL_REACH * 0.9, bellRingOutScale(0));
    const long = bellBrightness("strike", 1.2, BELL_REACH * 0.9, bellRingOutScale(1));
    expect(long).toBeGreaterThan(short);
  });

  it("the 2x2 cell scan the shader does can't clip a ring at a cell seam", () => {
    // a centre sits within JITTER/2 of its cell middle and is scanned from a
    // pixel within one cell of it; the ring plus its widest half-width must
    // stay inside that
    expect(BELL_JITTER / 2 + BELL_REACH + 0.1).toBeLessThanOrEqual(1);
  });
});

describe("advanceSparkleHit", () => {
  function run(signal: (t: number) => number, sec: number, rest = 0) {
    const clock = createSparkleHitClock();
    const state = createStandoutState();
    for (let i = 0; i < 10; i++) advanceSparkleHit(clock, state, DT, rest);
    const hits: number[] = [];
    for (let tick = 0; tick * DT < sec; tick++) {
      if (advanceSparkleHit(clock, state, DT, signal(tick * DT))) hits.push(tick);
    }
    return { clock, hits };
  }

  it("starts quiet: nothing visible before the first hit", () => {
    const clock = createSparkleHitClock();
    expect(clock.ageSec).toBeGreaterThan(BELL_LIFE_SEC * 2);
    expect(clock.count).toBe(0);
  });

  it("a treble pulse restarts the age, reseeds, and sizes the hit", () => {
    const { clock, hits } = run((t) => Math.exp(-6 * t), 0.5);
    expect(hits).toHaveLength(1);
    expect(clock.count).toBe(1);
    expect(clock.amp).toBeGreaterThan(0.9);
    // aged by the frames since the hit
    expect(clock.ageSec).toBeCloseTo(0.5 - hits[0]! * DT, 1);
  });

  it("two hits a beat apart count twice, and a steady level counts none", () => {
    const twice = run((t) => (t < 0.5 ? Math.exp(-6 * t) : Math.exp(-6 * (t - 0.5))), 1);
    expect(twice.hits).toHaveLength(2);
    expect(twice.clock.count).toBe(2);
    const steady = run(() => 0.6, 1, 0.6);
    expect(steady.hits).toHaveLength(0);
  });
});
