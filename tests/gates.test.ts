import { describe, it, expect } from "vitest";
import {
  advanceGates,
  BARS_PER_PHRASE,
  createGateState,
  FREE_BAR_SEC,
  gatesScene,
  LOOK_COUNT,
  SPIN_RAD_MAX,
  type GateAnim,
  type GateOpts,
  type GateState,
} from "../src/render/scenes/gates/index.ts";
import {
  buildLook,
  LOOKS,
  MAX_OBJ,
  objectCountFor,
  RADIUS_MAX,
  RADIUS_MIN,
  SEG_MAX,
  segmentOf,
  SHAPE,
  TUNNEL_LEN,
} from "../src/render/scenes/gates/layout.ts";
import { computeAutoTarget } from "../src/render/autoTune.ts";
import { NEUTRAL } from "../src/render/musicProfile.ts";

// The scene's cuts are a scheduler, not a shader: this pins where a cut may
// land (a bar wrap, a phrase, a drop — never mid-bar at a low Cut rate), that
// a blackout is exactly one frame with the cut on the frame after, and that
// motion accumulates continuously through all of it.
describe("advanceGates", () => {
  const DT = 1 / 60;
  const STEPS = 32;

  const anim = (over: Partial<GateAnim> = {}): GateAnim => ({
    dtSec: DT,
    barPhase: 0,
    tempoLock: 1,
    onset: false,
    dropOnset: false,
    low: 0,
    ...over,
  });
  const OPTS: GateOpts = { speed: 0.5, cutRate: 1, spin: 0.35, blackouts: true };

  function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /** One bar of climbing phase, ending on the wrap frame. Returns the looks
   *  seen frame by frame. */
  function runBar(st: GateState, opts: GateOpts, rng: () => number, over: Partial<GateAnim> = {}): number[] {
    const looks: number[] = [];
    for (let k = 1; k < STEPS; k++) {
      advanceGates(st, anim({ barPhase: k / STEPS, ...over }), opts, rng);
      looks.push(st.look);
    }
    advanceGates(st, anim({ barPhase: 0, ...over }), opts, rng);
    looks.push(st.look);
    return looks;
  }

  it("does not cut mid-bar while the tempo is locked", () => {
    const st = createGateState();
    for (let k = 0; k < 100; k++) advanceGates(st, anim({ barPhase: (k / 100) * 0.95 }), { ...OPTS, cutRate: 0.4 }, lcg(1));
    expect(st.look).toBe(0);
    expect(st.bars).toBe(0);
  });

  it("a bar wrap at Cut rate 1 cuts to a different look, never the same twice", () => {
    const st = createGateState();
    const rng = lcg(7);
    let prev = st.look;
    let changes = 0;
    for (let bar = 0; bar < 200; bar++) {
      for (const look of runBar(st, OPTS, rng)) {
        if (look !== prev) {
          changes++;
          expect(look).not.toBe(prev);
          expect(look).toBeGreaterThanOrEqual(0);
          expect(look).toBeLessThan(LOOK_COUNT);
        }
        prev = look;
      }
    }
    expect(changes).toBeGreaterThanOrEqual(200);
  });

  it("at Cut rate 0 only phrase bars cut, through a blackout", () => {
    const st = createGateState();
    const opts = { ...OPTS, cutRate: 0 };
    for (let bar = 1; bar < BARS_PER_PHRASE; bar++) {
      runBar(st, opts, lcg(bar));
      expect(st.look).toBe(0);
      expect(st.blackFrame).toBe(0);
    }
    runBar(st, opts, lcg(9));
    expect(st.blackFrame).toBe(1);
    expect(st.look).toBe(0);
  });

  it("the phrase blackout lasts exactly one frame and the cut lands after it", () => {
    const st = createGateState();
    const opts = { ...OPTS, cutRate: 0 };
    const rng = lcg(3);
    for (let bar = 0; bar < BARS_PER_PHRASE; bar++) runBar(st, opts, rng);
    expect(st.blackFrame).toBe(1);
    const seed = st.cutSeed;
    advanceGates(st, anim({ barPhase: 1 / STEPS }), opts, rng);
    expect(st.blackFrame).toBe(0);
    expect(st.look).not.toBe(0);
    expect(st.cutSeed).toBe(seed + 1);
    advanceGates(st, anim({ barPhase: 2 / STEPS }), opts, rng);
    expect(st.blackFrame).toBe(0);
    expect(st.cutSeed).toBe(seed + 1);
  });

  it("a drop blacks out for one frame and cuts, mid-bar, once per drop edge", () => {
    const st = createGateState();
    const opts = { ...OPTS, cutRate: 0 };
    const rng = lcg(5);
    advanceGates(st, anim({ barPhase: 0.3 }), opts, rng);
    advanceGates(st, anim({ barPhase: 0.31, dropOnset: true }), opts, rng);
    expect(st.blackFrame).toBe(1);
    advanceGates(st, anim({ barPhase: 0.32, dropOnset: true }), opts, rng);
    expect(st.blackFrame).toBe(0);
    expect(st.look).not.toBe(0);
    const look = st.look;
    advanceGates(st, anim({ barPhase: 0.33, dropOnset: true }), opts, rng);
    expect(st.blackFrame).toBe(0);
    expect(st.look).toBe(look);
  });

  it("with Blackouts off, phrase and drop cut on the same frame with no black frame", () => {
    const st = createGateState();
    const opts = { ...OPTS, cutRate: 0, blackouts: false };
    const rng = lcg(11);
    for (let bar = 0; bar < BARS_PER_PHRASE - 1; bar++) runBar(st, opts, rng);
    const looks = runBar(st, opts, rng);
    expect(st.blackFrame).toBe(0);
    expect(looks[looks.length - 1]).not.toBe(0);
    const look = st.look;
    advanceGates(st, anim({ barPhase: 0.1, dropOnset: true }), opts, rng);
    expect(st.blackFrame).toBe(0);
    expect(st.look).not.toBe(look);
  });

  it("free-runs on a timer with no tempo lock", () => {
    const st = createGateState();
    const frames = Math.ceil((BARS_PER_PHRASE * FREE_BAR_SEC + 0.1) / DT);
    for (let k = 0; k < frames; k++) advanceGates(st, anim({ tempoLock: 0 }), OPTS, lcg(2));
    expect(st.bars).toBeGreaterThanOrEqual(BARS_PER_PHRASE);
  });

  it("flash jumps on an onset and decays to nothing within a second", () => {
    const st = createGateState();
    advanceGates(st, anim({ onset: true }), OPTS, lcg(1));
    expect(st.flash).toBeGreaterThan(0.9);
    let prev = st.flash;
    for (let k = 0; k < 60; k++) {
      advanceGates(st, anim({ barPhase: 0.5 * (k / 60) }), OPTS, lcg(1));
      expect(st.flash).toBeLessThan(prev);
      prev = st.flash;
    }
    expect(st.flash).toBeLessThan(0.05);
  });

  it("spin never reverses across cuts; travel follows each look's direction, continuously", () => {
    const st = createGateState();
    const rng = lcg(13);
    let prevTravel = st.travel;
    let prevSpin = st.spinPos;
    const dirs = new Set<number>();
    for (let bar = 0; bar < 12; bar++) {
      for (let k = 1; k <= STEPS; k++) {
        advanceGates(st, anim({ barPhase: k === STEPS ? 0 : k / STEPS }), OPTS, rng);
        expect(st.spinPos).toBeGreaterThan(prevSpin);
        expect(st.spinPos - prevSpin).toBeCloseTo(SPIN_RAD_MAX * OPTS.spin * DT, 9);
        expect(st.dir).toBe(LOOKS[st.look].dir);
        expect(Math.sign(st.travel - prevTravel)).toBe(st.dir);
        expect(Math.abs(st.travel - prevTravel)).toBeLessThan(0.2);
        dirs.add(st.dir);
        prevTravel = st.travel;
        prevSpin = st.spinPos;
      }
    }
    // Both directions are visited over the looks.
    expect(dirs.size).toBe(2);

    const slow = createGateState();
    const fast = createGateState();
    const bassy = createGateState();
    for (let k = 0; k < 60; k++) {
      advanceGates(slow, anim(), { ...OPTS, speed: 0 }, lcg(1));
      advanceGates(fast, anim(), { ...OPTS, speed: 1 }, lcg(1));
      advanceGates(bassy, anim({ low: 1 }), { ...OPTS, speed: 0 }, lcg(1));
    }
    expect(Math.abs(fast.travel)).toBeGreaterThan(Math.abs(slow.travel));
    expect(Math.abs(bassy.travel)).toBeGreaterThan(Math.abs(slow.travel));
  });

  it("the default Spin turns the tunnel at the reference's measured rate", () => {
    // The reference spins +35 to +36 degrees per second counter-clockwise
    // in every regime (tools/.cache/refs/neon-groove/report.md).
    const spinSetting = gatesScene.settings!.find((s) => s.key === "spin")!;
    const degPerSec = (SPIN_RAD_MAX * spinSetting.default * 180) / Math.PI;
    expect(degPerSec).toBeGreaterThan(33);
    expect(degPerSec).toBeLessThan(39);
  });

  it("treats a non-finite or backwards dt as no time passing", () => {
    const st = createGateState();
    advanceGates(st, anim({ onset: true }), OPTS, lcg(1));
    const before = { ...st };
    advanceGates(st, anim({ dtSec: Number.NaN, barPhase: 0.1, tempoLock: 0 }), OPTS, lcg(1));
    advanceGates(st, anim({ dtSec: -1, barPhase: 0.2, tempoLock: 0 }), OPTS, lcg(1));
    expect(st.travel).toBe(before.travel);
    expect(st.flash).toBe(before.flash);
    expect(st.bars).toBe(before.bars);
  });
});

describe("gates settings", () => {
  it("every setting with an auto table reproduces its default at NEUTRAL", () => {
    for (const s of gatesScene.settings ?? []) {
      if (s.auto) expect(computeAutoTarget(s, NEUTRAL, 1)).toBe(s.default);
    }
  });
});

describe("gates layout", () => {
  it("counts scale with density and detail and stay within the uniform arrays", () => {
    for (let look = 0; look < LOOKS.length; look++) {
      const lo = objectCountFor(look, 0, 0.25);
      const mid = objectCountFor(look, 0.5, 1);
      const hi = objectCountFor(look, 1, 1);
      expect(lo).toBeGreaterThanOrEqual(4);
      expect(lo).toBeLessThan(mid);
      expect(mid).toBeLessThanOrEqual(hi);
      expect(hi).toBeLessThanOrEqual(MAX_OBJ);
      expect(mid).toBe(Math.min(MAX_OBJ, LOOKS[look].objects));
    }
  });

  it("places every object in the tunnel's radius band and length, on the first quadrant", () => {
    for (let look = 0; look < LOOKS.length; look++) {
      const L = buildLook(look, 3, MAX_OBJ);
      expect(L.count).toBe(MAX_OBJ);
      for (let i = 0; i < L.count; i++) {
        const x = L.objA[i * 4];
        const y = L.objA[i * 4 + 1];
        const r = Math.hypot(x, y);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(r).toBeGreaterThanOrEqual(RADIUS_MIN - 1e-9);
        expect(r).toBeLessThanOrEqual(RADIUS_MAX + 1e-9);
        expect(L.objA[i * 4 + 2]).toBeGreaterThanOrEqual(0);
        expect(L.objA[i * 4 + 2]).toBeLessThan(TUNNEL_LEN);
        const shape = L.objA[i * 4 + 3] % 4;
        const key = Math.floor(L.objA[i * 4 + 3] / 4);
        expect([0, 1, 2, 3]).toContain(shape);
        expect([0, 1, 2]).toContain(key);
        expect(L.objB[i * 4 + 2]).toBeGreaterThan(0);
        expect(L.objB[i * 4 + 3]).toBeGreaterThan(0);
      }
    }
  });

  it("puts the look's share of objects exactly on an axis", () => {
    for (let look = 0; look < LOOKS.length; look++) {
      let onAxis = 0;
      let total = 0;
      for (let seed = 0; seed < 40; seed++) {
        const L = buildLook(look, seed, MAX_OBJ);
        for (let i = 0; i < L.count; i++) {
          total++;
          if (L.objA[i * 4] === 0 || L.objA[i * 4 + 1] === 0) onAxis++;
        }
      }
      expect(Math.abs(onAxis / total - LOOKS[look].onAxis)).toBeLessThan(0.05);
    }
  });

  it("same seed, same layout; a new seed moves things", () => {
    const a = buildLook(2, 5, 20);
    const b = buildLook(2, 5, 20);
    const c = buildLook(2, 6, 20);
    expect(Array.from(a.objA)).toEqual(Array.from(b.objA));
    expect(Array.from(a.objA)).not.toEqual(Array.from(c.objA));
  });

  it("Shape mix leans the shapes: 0 gives no rods or panels, 1 gives no prisms or frames", () => {
    for (let look = 0; look < LOOKS.length; look++) {
      const rings = buildLook(look, 1, MAX_OBJ, 0);
      const bars = buildLook(look, 1, MAX_OBJ, 1);
      for (let i = 0; i < MAX_OBJ; i++) {
        expect(rings.objA[i * 4 + 3] % 4).toBeLessThan(2);
        expect(bars.objA[i * 4 + 3] % 4).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("a hex prism has 18 distinct edges, a frame 12, a rod 1, every slot within SEG_MAX", () => {
    const edges = (shape: 0 | 1 | 2 | 3) => {
      const seen = new Set<string>();
      let n = 0;
      for (let i = 0; i < SEG_MAX; i++) {
        const s = segmentOf(shape, i, 0.5, 0.8, 0.6);
        if (!s) continue;
        n++;
        const key = [s[0], s[1]].map((p) => p.map((v) => v.toFixed(6)).join(",")).sort().join("|");
        expect(seen.has(key)).toBe(false);
        seen.add(key);
        expect(Math.hypot(s[0][0] - s[1][0], s[0][1] - s[1][1], s[0][2] - s[1][2])).toBeGreaterThan(0.1);
      }
      return n;
    };
    expect(edges(SHAPE.PRISM)).toBe(18);
    expect(edges(SHAPE.FRAME)).toBe(12);
    expect(edges(SHAPE.ROD)).toBe(1);
    expect(edges(SHAPE.PANEL)).toBe(1);
    expect(segmentOf(SHAPE.PRISM, SEG_MAX, 1, 1, 1)).toBeNull();
  });
});
