// Mandelbox Flight's camera (src/render/scenes/mandelbox/flight.ts): the search finds places that
// pass its own view test, the same ones however it is sliced into frames; the flight closes in
// without ever reaching a wall and ends a place at the float32 floor; the pace holds still in
// silence and follows the song's own loudness.
import { describe, expect, it } from "vitest";
import {
  advanceFlight,
  createFlight,
  createPace,
  createPlaceSearch,
  de,
  DE_FLOOR,
  foldScale,
  LEVEL_QUIET,
  PACE_MAX,
  stepPace,
  stepPlaceSearch,
  viewScore,
  type Place,
} from "../src/render/scenes/mandelbox/flight.ts";

const SCALE = foldScale(0.6);
const DT = 1 / 60;
/** Mirror's options (card.ts). */
const OFF = 0;
const ON = 1;
const PER_PLACE = 2;

function placeFor(seed: number, mirror = PER_PLACE): Place {
  const place = stepPlaceSearch(createPlaceSearch(SCALE, seed, mirror), Number.POSITIVE_INFINITY);
  if (!place) throw new Error("no place found");
  return place;
}

describe("Mandelbox Flight place search", () => {
  it("draws a fractal symmetric under every swap and sign flip of its axes", () => {
    const [x, y, z] = [0.31, -0.77, 1.12];
    const d = de(x, y, z, SCALE);
    for (const q of [[-x, y, z], [x, -y, -z], [y, x, z], [z, y, x], [y, z, -x]]) expect(de(q[0], q[1], q[2], SCALE)).toBeCloseTo(d, 12);
  });

  it("puts every place on a mirror line with Mirror on, and none with it off", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const on = placeFor(seed, ON);
      expect(on.kind).not.toBe("free");
      expect(on.roll).toBe(0);
      if (on.kind === "plane") {
        expect(on.p[0]).toBe(0);
        expect(on.fwd[0]).toBe(0);
      } else {
        // Position and view both lie along the same axis through the centre.
        const c = Math.hypot(...on.p);
        expect(Math.abs(on.p[0] * on.fwd[0] + on.p[1] * on.fwd[1] + on.p[2] * on.fwd[2])).toBeCloseTo(c, 9);
      }
      expect(placeFor(seed, OFF).kind).toBe("free");
    }
  });

  it("mixes mirrored and free places under Per place", () => {
    let mirrored = 0;
    const n = 40;
    for (let seed = 1; seed <= n; seed++) if (placeFor(seed).kind !== "free") mirrored++;
    expect(mirrored / n).toBeGreaterThan(0.25);
    expect(mirrored / n).toBeLessThan(0.65);
  });

  it("finds a place in open space whose view passes its own test", () => {
    for (const seed of [1, 6, 11]) {
      const place = placeFor(seed);
      const gap = de(place.p[0], place.p[1], place.p[2], SCALE);
      expect(gap).toBeGreaterThan(DE_FLOOR * 10);
      expect(viewScore(place.p, place.fwd, gap, SCALE)).toBeGreaterThan(0);
      expect(Math.hypot(...place.fwd)).toBeCloseTo(1, 6);
    }
  });

  it("finds the same place however the search is sliced into frames", () => {
    const whole = placeFor(6);
    let clock = 0;
    const s = createPlaceSearch(SCALE, 6, PER_PLACE);
    let sliced: Place | null = null;
    let frames = 0;
    // Each clock read moves time on a millisecond, so a 3 ms budget stops after a few views.
    while (!sliced) {
      sliced = stepPlaceSearch(s, 3, () => clock++);
      frames++;
    }
    expect(frames).toBeGreaterThan(1);
    expect(sliced.p).toEqual(whole.p);
    expect(sliced.fwd).toEqual(whole.fwd);
  });
});

describe("Mandelbox Flight flight", () => {
  it("closes in on what lies ahead at its rate, without reaching a wall", () => {
    const place = placeFor(6);
    const f = createFlight(place);
    const ahead0 = f.ahead;
    const rate = 0.5;
    for (let i = 0; i < 600; i++) {
      advanceFlight(f, DT, rate, 1);
      expect(f.gap).toBeGreaterThan(0);
    }
    // A fixed share of the distance ahead per second is a fixed zoom rate.
    expect(Math.log(ahead0 / f.ahead)).toBeCloseTo(rate * 600 * DT, 1);
    expect(f.place.p).not.toEqual(place.p);
  });

  it("holds still at pace 0 and calls a place used up at the float32 floor", () => {
    const f = createFlight(placeFor(1));
    const before = [...f.place.p];
    advanceFlight(f, 1, 1, 0);
    expect(f.place.p).toEqual(before);
    let usedUp = false;
    for (let i = 0; i < 2000 && !usedUp; i++) usedUp = advanceFlight(f, 0.1, 1, 1);
    expect(usedUp).toBe(true);
  });
});

describe("Mandelbox Flight pace", () => {
  function settle(level: number, push: number, seconds: number) {
    const s = createPace();
    let v = 0;
    for (let t = 0; t < seconds; t += DT) v = stepPace(s, level, push, DT);
    return { s, v };
  }

  it("holds still in silence at full Push", () => {
    expect(settle(0, 1, 5).v).toBeLessThan(0.01);
    expect(settle(LEVEL_QUIET, 1, 5).v).toBeLessThan(0.01);
  });

  it("keeps a steady pace at Push 0, whatever the level", () => {
    expect(settle(0, 0, 5).v).toBeCloseTo(1, 3);
    expect(settle(0.95, 0, 5).v).toBeCloseTo(1, 3);
  });

  it("runs at 1 on a song's own level and faster when it gets louder, up to PACE_MAX", () => {
    const quiet = settle(0.55, 1, 120);
    expect(quiet.v).toBeCloseTo(1, 1);
    const louder = stepPaceFor(quiet.s, 0.7, 1, 2);
    expect(louder).toBeGreaterThan(1.2);
    expect(louder).toBeLessThanOrEqual(PACE_MAX);
  });

  it("doesn't let a silence drag the song's average down", () => {
    const { s } = settle(0.7, 1, 120);
    const before = s.average;
    stepPaceFor(s, 0, 1, 60);
    expect(s.average).toBe(before);
  });

  function stepPaceFor(s: ReturnType<typeof createPace>, level: number, push: number, seconds: number): number {
    let v = s.value;
    for (let t = 0; t < seconds; t += DT) v = stepPace(s, level, push, DT);
    return v;
  }
});
