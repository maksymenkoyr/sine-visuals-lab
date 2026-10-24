import { describe, it, expect } from "vitest";
import {
  buildRippleSpots,
  createRippleSpots,
  emitRippleSpot,
  RIPPLE_SPOTS,
  ringOriginFor,
  spotPosition,
  spotStartsRing,
  tickRippleSpots,
} from "../src/render/scenes/causticsRippleSpots.ts";
import {
  buildProfile,
  NARROW_EVENT_MIN,
  PROFILE_SAMPLES,
  rippleDecayFor,
  rippleSpeedFor,
  rippleWidthFor,
  type RippleProfileParams,
} from "../src/render/scenes/rippleEmitter.ts";

const PARAMS: RippleProfileParams = {
  decayPerSec: rippleDecayFor(0.3),
  speedUnitsPerSec: rippleSpeedFor(0.5),
  widthGaussianW: rippleWidthFor(0.5),
};
const DT = 1 / 60;

describe("ringOriginFor", () => {
  it("maps the setting's 0/1 to Center/Random spot", () => {
    expect(ringOriginFor(0)).toBe("center");
    expect(ringOriginFor(1)).toBe("spot");
  });
});

describe("spotPosition", () => {
  it("is deterministic and stays inside -1..1", () => {
    for (let n = 0; n < 1000; n++) {
      const [x, y] = spotPosition(n);
      expect(spotPosition(n)).toEqual([x, y]);
      expect(x).toBeGreaterThanOrEqual(-1);
      expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(-1);
      expect(y).toBeLessThanOrEqual(1);
    }
  });

  it("spreads consecutive counters over different x values", () => {
    const xs = new Set<number>();
    for (let n = 0; n < 50; n++) xs.add(spotPosition(n)[0]);
    expect(xs.size).toBeGreaterThanOrEqual(40);
  });
});

describe("spotStartsRing", () => {
  it("is true only on the frame an emission run begins", () => {
    const s = createRippleSpots();
    expect(spotStartsRing(s, 0)).toBe(false);
    expect(spotStartsRing(s, NARROW_EVENT_MIN * 2)).toBe(true);
    expect(spotStartsRing(s, NARROW_EVENT_MIN * 2)).toBe(false);
    expect(spotStartsRing(s, 0)).toBe(false);
    expect(spotStartsRing(s, NARROW_EVENT_MIN * 2)).toBe(true);
  });
});

describe("emitRippleSpot", () => {
  it("a new spot takes the ring and a following same-run emission stays in that spot", () => {
    const s = createRippleSpots();
    tickRippleSpots(s, DT, PARAMS);
    emitRippleSpot(s, 1, "bump", true);
    buildRippleSpots(s, PARAMS, "bump");
    const k = s.current;
    expect(s.spot[k * 4 + 2]).toBe(1);
    expect(s.spot[k * 4]).toBe(Math.fround(spotPosition(0)[0]));

    const before = s.emitters.map((e) => e.count);
    emitRippleSpot(s, 0.5, "bump", false);
    expect(s.current).toBe(k);
    expect(s.emitters[k]!.count).toBe(1);
    expect(s.emitters[k]!.amp[0]).toBe(1.5);
    s.emitters.forEach((e, j) => {
      if (j !== k) expect(e.count).toBe(before[j]);
    });
  });
});

describe("emitRippleSpot spot reuse", () => {
  it("with every spot busy, a new start clears and reuses the weakest (oldest) spot", () => {
    const s = createRippleSpots();
    for (let k = 0; k < RIPPLE_SPOTS; k++) {
      tickRippleSpots(s, 0.5, PARAMS);
      emitRippleSpot(s, 1, "bump", true);
    }
    expect(s.emitters.every((e) => e.count === 1)).toBe(true);

    tickRippleSpots(s, 0.5, PARAMS);
    emitRippleSpot(s, 1, "bump", true);
    expect(s.current).toBe(0);
    expect(s.emitters[0]!.count).toBe(1);
    expect(s.spot[0]).toBe(Math.fround(spotPosition(RIPPLE_SPOTS)[0]));
  });
});

describe("buildRippleSpots", () => {
  it("writes each spot's buildProfile output as one texture row and flags the live spots", () => {
    const s = createRippleSpots();
    tickRippleSpots(s, DT, PARAMS);
    emitRippleSpot(s, 1, "bump", true);
    tickRippleSpots(s, 0.2, PARAMS);
    emitRippleSpot(s, 1, "bump", true);
    buildRippleSpots(s, PARAMS, "bump");

    const crest = new Float32Array(PROFILE_SAMPLES);
    const slope = new Float32Array(PROFILE_SAMPLES);
    for (let k = 0; k < RIPPLE_SPOTS; k++) {
      buildProfile(s.emitters[k]!, PARAMS, crest, slope, "bump");
      for (let i = 0; i < PROFILE_SAMPLES; i++) {
        const t = (k * PROFILE_SAMPLES + i) * 2;
        expect(s.tex[t]).toBe(crest[i]);
        expect(s.tex[t + 1]).toBe(slope[i]);
      }
      expect(s.spot[k * 4 + 2]).toBe(s.emitters[k]!.count > 0 ? 1 : 0);
    }
  });

  it("leaves an empty spot's row at zero and its live flag at 0", () => {
    const s = createRippleSpots();
    tickRippleSpots(s, DT, PARAMS);
    emitRippleSpot(s, 1, "bump", true);
    buildRippleSpots(s, PARAMS, "bump");
    const empty = 1;
    expect(s.spot[empty * 4 + 2]).toBe(0);
    for (let i = 0; i < PROFILE_SAMPLES * 2; i++) {
      expect(s.tex[empty * PROFILE_SAMPLES * 2 + i]).toBe(0);
    }
  });
});
