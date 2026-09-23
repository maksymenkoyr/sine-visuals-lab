import { describe, it, expect } from "vitest";
import {
  advanceGates,
  BARS_PER_PHRASE,
  createGateState,
  FREE_BAR_SEC,
  gatesScene,
  LOOK_COUNT,
  morphEase,
  SPIN_RAD_MAX,
  type GateAnim,
  type GateOpts,
  type GateState,
} from "../src/render/scenes/gates/index.ts";
import {
  buildLook,
  identityPairs,
  LOOKS,
  MAX_OBJ,
  morphLayout,
  morphSegment,
  objectCountFor,
  pairLayouts,
  RADIUS_MAX,
  RADIUS_MIN,
  SEG_MAX,
  segmentOf,
  SHAPE,
  TUNNEL_LEN,
} from "../src/render/scenes/gates/layout.ts";
import { computeAutoTarget } from "../src/render/autoTune.ts";
import { NEUTRAL } from "../src/render/musicProfile.ts";

// The scene's look changes are a scheduler, not a shader: this pins where a
// morph may *begin* (a bar wrap, a phrase, a drop — never mid-bar at a low
// Change rate), that once begun it always takes exactly one bar and nothing
// can interrupt or restart it early, and that motion accumulates
// continuously through all of it.
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
  const OPTS: GateOpts = { speed: 0.5, cutRate: 1, spin: 0.35 };

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

  it("does not start a morph mid-bar while the tempo is locked", () => {
    const st = createGateState();
    for (let k = 0; k < 100; k++) advanceGates(st, anim({ barPhase: (k / 100) * 0.95 }), { ...OPTS, cutRate: 0.4 }, lcg(1));
    expect(st.look).toBe(0);
    expect(st.bars).toBe(0);
  });

  it("a bar wrap at Change rate 1 morphs to a different look, never the same twice", () => {
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

  it("at Change rate 0 only phrase bars start a morph, and it lasts exactly one bar", () => {
    const st = createGateState();
    const opts = { ...OPTS, cutRate: 0 };
    for (let bar = 1; bar < BARS_PER_PHRASE; bar++) {
      runBar(st, opts, lcg(bar));
      expect(st.look).toBe(0);
      expect(st.morph).toBe(1);
    }
    const rng = lcg(9);
    for (let k = 1; k < STEPS; k++) advanceGates(st, anim({ barPhase: k / STEPS }), opts, rng);
    expect(st.look).toBe(0);
    expect(st.morph).toBe(1);
    advanceGates(st, anim({ barPhase: 0 }), opts, rng); // the phrase boundary
    expect(st.look).not.toBe(0);
    expect(st.morph).toBe(0); // the morph just began this very frame
    const look = st.look;
    const looks = runBar(st, opts, rng);
    expect(looks[looks.length - 1]).toBe(look);
    expect(st.morph).toBe(1);
    expect(st.fromLook).toBe(look);
  });

  it("free-runs on a timer with no tempo lock", () => {
    const st = createGateState();
    const frames = Math.ceil((BARS_PER_PHRASE * FREE_BAR_SEC + 0.1) / DT);
    for (let k = 0; k < frames; k++) advanceGates(st, anim({ tempoLock: 0 }), OPTS, lcg(2));
    expect(st.bars).toBeGreaterThanOrEqual(BARS_PER_PHRASE);
  });

  it("spin never reverses across morphs; travel changes smoothly and settles to each look's direction", () => {
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
        expect(Math.abs(st.travel - prevTravel)).toBeLessThan(0.2);
        // st.look snaps to the new look the instant a morph begins (only
        // fromLook/morph describe the in-between), so this is meaningful
        // every frame, not just once settled.
        dirs.add(LOOKS[st.look].dir);
        if (st.morph >= 1) expect(Math.sign(st.flyVel)).toBe(Math.sign(LOOKS[st.look].dir));
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

  it("morphEase is a smoothstep: 0 at 0, 1 at 1, monotonic, clamped outside", () => {
    expect(morphEase(0)).toBe(0);
    expect(morphEase(1)).toBe(1);
    expect(morphEase(-1)).toBe(0);
    expect(morphEase(2)).toBe(1);
    let prev = -1;
    for (let k = 0; k <= 20; k++) {
      const v = morphEase(k / 20);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("treats a non-finite or backwards dt as no time passing", () => {
    const st = createGateState();
    advanceGates(st, anim({ onset: true }), OPTS, lcg(1));
    const before = { ...st };
    advanceGates(st, anim({ dtSec: Number.NaN, barPhase: 0.1, tempoLock: 0 }), OPTS, lcg(1));
    advanceGates(st, anim({ dtSec: -1, barPhase: 0.2, tempoLock: 0 }), OPTS, lcg(1));
    expect(st.travel).toBe(before.travel);
    expect(st.bars).toBe(before.bars);
  });

  it("a morph lasts exactly one bar and lands on the boundary frame", () => {
    const st = createGateState();
    const opts = { ...OPTS, cutRate: 0 };
    const rng = lcg(21);
    for (let bar = 1; bar < BARS_PER_PHRASE; bar++) runBar(st, opts, rng);
    for (let k = 1; k < STEPS; k++) advanceGates(st, anim({ barPhase: k / STEPS }), opts, rng);
    expect(st.morph).toBe(1);
    advanceGates(st, anim({ barPhase: 0 }), opts, rng); // the phrase boundary
    expect(st.morph).toBe(0); // just began this very frame
    const fromLook = st.fromLook;
    const look = st.look;
    expect(look).not.toBe(fromLook);
    for (let k = 1; k < STEPS; k++) {
      advanceGates(st, anim({ barPhase: k / STEPS }), opts, rng);
      expect(st.morph).toBeLessThan(1);
    }
    advanceGates(st, anim({ barPhase: 0 }), opts, rng); // one bar later: settled
    expect(st.morph).toBe(1);
    expect(st.look).toBe(look);
    expect(st.fromLook).toBe(look);
  });

  it("is uninterruptible: a trigger mid-morph changes nothing until it settles", () => {
    const st = createGateState();
    const opts = { ...OPTS, cutRate: 1 };
    const rng = lcg(4);
    // Climb through a bar so the wrap frame is a real boundary (a fresh
    // state's barPhase/lastBarPhase are both already 0, which is not
    // itself a wrap).
    for (let k = 1; k < STEPS; k++) advanceGates(st, anim({ barPhase: k / STEPS }), opts, rng);
    advanceGates(st, anim({ barPhase: 0 }), opts, rng); // begins a morph
    const fromLook = st.fromLook;
    const look = st.look;
    expect(st.morph).toBeLessThan(1);
    expect(look).not.toBe(fromLook);
    // A drop mid-morph, with Change rate 1 (which would otherwise always
    // start one): begin() is a no-op while morph < 1.
    advanceGates(st, anim({ barPhase: 0.02, dropOnset: true }), opts, rng);
    expect(st.fromLook).toBe(fromLook);
    expect(st.look).toBe(look);
    advanceGates(st, anim({ barPhase: 0.05, dropOnset: true }), opts, rng);
    expect(st.fromLook).toBe(fromLook);
    expect(st.look).toBe(look);
  });

  it("follows tempo: the morph is driven by bar phase, not frame count", () => {
    for (const steps of [8, 40]) {
      const st = createGateState();
      const opts = { ...OPTS, cutRate: 0 };
      const rng = lcg(steps);
      for (let bar = 1; bar < BARS_PER_PHRASE; bar++) {
        for (let k = 1; k < steps; k++) advanceGates(st, anim({ barPhase: k / steps }), opts, rng);
        advanceGates(st, anim({ barPhase: 0 }), opts, rng);
      }
      for (let k = 1; k < steps; k++) advanceGates(st, anim({ barPhase: k / steps }), opts, rng);
      advanceGates(st, anim({ barPhase: 0 }), opts, rng); // phrase boundary: morph begins
      expect(st.morph).toBe(0); // just began this frame, regardless of steps
      for (let k = 1; k < steps; k++) advanceGates(st, anim({ barPhase: k / steps }), opts, rng);
      advanceGates(st, anim({ barPhase: 0 }), opts, rng); // one bar later
      expect(st.morph).toBe(1);
    }
  });

  it("free-runs the morph over about FREE_BAR_SEC seconds with no tempo lock", () => {
    const st = createGateState();
    const opts = { ...OPTS, cutRate: 0 };
    const rng = lcg(6);
    let frames = 0;
    while (st.morph >= 1) {
      advanceGates(st, anim({ tempoLock: 0 }), opts, rng);
      frames++;
      if (frames > 100_000) throw new Error("a morph never began");
    }
    let morphFrames = 0;
    while (st.morph < 1) {
      advanceGates(st, anim({ tempoLock: 0 }), opts, rng);
      morphFrames++;
    }
    const seconds = morphFrames * DT;
    expect(seconds).toBeGreaterThan(FREE_BAR_SEC * 0.9);
    expect(seconds).toBeLessThan(FREE_BAR_SEC * 1.1);
  });

  it("chains at Change rate 1: a new morph begins as soon as the previous settles", () => {
    const st = createGateState();
    const opts = { ...OPTS, cutRate: 1 };
    const rng = lcg(8);
    let lastMorphs = st.morphs;
    let gap = 0;
    let maxGap = 0;
    for (let bar = 0; bar < 20; bar++) {
      for (let k = 1; k <= STEPS; k++) {
        advanceGates(st, anim({ barPhase: k === STEPS ? 0 : k / STEPS }), opts, rng);
        if (st.morphs === lastMorphs) gap++;
        else {
          maxGap = Math.max(maxGap, gap);
          gap = 0;
          lastMorphs = st.morphs;
        }
      }
    }
    expect(st.morphs).toBeGreaterThanOrEqual(20);
    // No frame gap bigger than one bar's worth of frames between morphs —
    // each new one starts right as the previous settles, never later.
    expect(maxGap).toBeLessThanOrEqual(STEPS);
  });

  it("velocity steps smoothly (bounded per frame, monotonic) through a direction flip", () => {
    const st = createGateState();
    // "big gates" (index 2) flies backward; "nested" (index 3) flies
    // forward — force a morph directly between them rather than relying on
    // a random pick.
    expect(LOOKS[2].dir).toBe(-1);
    expect(LOOKS[3].dir).toBe(1);
    st.fromLook = 2;
    st.look = 3;
    st.morph = 0;
    const opts = { ...OPTS, cutRate: 0 };
    const rng = lcg(1);
    // Prime flyVel at e=0 (dtSec: 0 and barPhase unchanged so nothing else
    // advances) — a freshly created state's flyVel is 0, which isn't the
    // right baseline for "how far does the first real step move it".
    advanceGates(st, anim({ barPhase: 0, dtSec: 0 }), opts, rng);
    let prevVel = st.flyVel;
    let sawNegative = false;
    let sawPositive = false;
    const steps = 64;
    for (let k = 1; k <= steps; k++) {
      advanceGates(st, anim({ barPhase: k / steps }), opts, rng);
      // Bounded step: never jumps far in one frame — it eases through zero.
      expect(Math.abs(st.flyVel - prevVel)).toBeLessThan(0.5);
      if (st.flyVel < 0) sawNegative = true;
      if (st.flyVel > 0) sawPositive = true;
      prevVel = st.flyVel;
    }
    expect(sawNegative).toBe(true);
    expect(sawPositive).toBe(true);
    expect(st.morph).toBe(1);
    expect(Math.sign(st.flyVel)).toBe(1); // settled on look 3's direction
  });

  it("a rebuild morphs in place, and waits for a running morph to settle first", () => {
    const st = createGateState();
    const opts = { ...OPTS, cutRate: 0 };
    const rng = lcg(2);

    st.rebuild = true;
    advanceGates(st, anim({ barPhase: 0.01 }), opts, rng);
    expect(st.morph).toBeLessThan(1);
    expect(st.fromLook).toBe(st.look); // same-look morph
    expect(st.cutSeed).toBe(0); // unchanged — not a look change
    expect(st.rebuild).toBe(false);
    const morphsAfterFirst = st.morphs;

    // Ask again mid-morph: it must wait rather than start immediately.
    st.rebuild = true;
    advanceGates(st, anim({ barPhase: 0.02 }), opts, rng);
    expect(st.morphs).toBe(morphsAfterFirst);
    expect(st.rebuild).toBe(true);

    // barPhase only ever climbs here, so no bar boundary competes with the
    // pending rebuild for the frame it settles on.
    let phase = 0.02;
    let fired = false;
    for (let k = 0; k < 300 && !fired; k++) {
      phase += 0.01;
      advanceGates(st, anim({ barPhase: phase }), opts, rng);
      if (st.morphs > morphsAfterFirst) fired = true;
    }
    expect(fired).toBe(true);
    expect(st.rebuild).toBe(false);
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

  it("buildLook is prefix-stable: a larger count starts with exactly the smaller count's objects", () => {
    for (let look = 0; look < LOOKS.length; look++) {
      const small = buildLook(look, 7, 10);
      const large = buildLook(look, 7, 30);
      for (let i = 0; i < 10; i++) {
        expect(large.objA[i * 4]).toBe(small.objA[i * 4]);
        expect(large.objA[i * 4 + 1]).toBe(small.objA[i * 4 + 1]);
        expect(large.objA[i * 4 + 2]).toBe(small.objA[i * 4 + 2]);
        expect(large.objA[i * 4 + 3]).toBe(small.objA[i * 4 + 3]);
        expect(large.objB[i * 4]).toBe(small.objB[i * 4]);
        expect(large.gain[i]).toBe(small.gain[i]);
      }
    }
  });
});

describe("gates morph", () => {
  // A lerp that's mathematically exact at its endpoints (p + (q - p) * 1)
  // isn't always bit-exact in IEEE754 — a near-zero coordinate can come out
  // as a tiny negative epsilon on one side and a tiny positive one on the
  // other, which toFixed renders as "-0.000000" vs "0.000000". Snap
  // anything under a tolerance far below any real geometric difference to
  // plain 0 before formatting, so the edge-set comparison isn't sensitive
  // to which side of zero that noise landed on.
  const fmt = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v).toFixed(6);
  function edgeKey(a: readonly number[], b: readonly number[]): string {
    const pa = a.map(fmt).join(",");
    const pb = b.map(fmt).join(",");
    return [pa, pb].sort().join("|");
  }

  it("morphSegment at e=0/1 reproduces segmentOf's own edges exactly, for every shape pair", () => {
    const shapes = [SHAPE.PRISM, SHAPE.FRAME, SHAPE.ROD, SHAPE.PANEL] as const;
    const dimsFrom = { sx: 0.5, sy: 0.8, dz: 0.6 };
    const dimsTo = { sx: 0.3, sy: 1.1, dz: 0.9 };
    for (const shapeFrom of shapes) {
      for (const shapeTo of shapes) {
        const wantFrom = new Set<string>();
        const wantTo = new Set<string>();
        for (let i = 0; i < SEG_MAX; i++) {
          const sf = segmentOf(shapeFrom, i, dimsFrom.sx, dimsFrom.sy, dimsFrom.dz);
          if (sf) wantFrom.add(edgeKey(sf[0], sf[1]));
          const stg = segmentOf(shapeTo, i, dimsTo.sx, dimsTo.sy, dimsTo.dz);
          if (stg) wantTo.add(edgeKey(stg[0], stg[1]));
        }
        const gotAt0 = new Set<string>();
        const gotAt1 = new Set<string>();
        for (let i = 0; i < SEG_MAX; i++) {
          const m0 = morphSegment(shapeFrom, shapeTo, i, dimsFrom, dimsTo, 0);
          if (m0.presence > 0.5) gotAt0.add(edgeKey(m0.a, m0.b));
          const m1 = morphSegment(shapeFrom, shapeTo, i, dimsFrom, dimsTo, 1);
          if (m1.presence > 0.5) gotAt1.add(edgeKey(m1.a, m1.b));
        }
        expect(gotAt0).toEqual(wantFrom);
        expect(gotAt1).toEqual(wantTo);
      }
    }
  });

  it("identityPairs pairs every object to itself, no births or deaths", () => {
    const L = buildLook(2, 3, 20);
    const pairs = identityPairs(L);
    expect(pairs.count).toBe(20);
    for (let i = 0; i < 20; i++) {
      expect(pairs.fromIdx[i]).toBe(i);
      expect(pairs.toIdx[i]).toBe(i);
      expect(pairs.born[i]).toBe(0);
      expect(pairs.dying[i]).toBe(0);
    }
  });

  it("pairLayouts on equal-count layouts has no births or deaths", () => {
    const from = buildLook(0, 1, 24);
    const to = buildLook(1, 2, 24);
    const pairs = pairLayouts(from, to);
    expect(pairs.count).toBe(24);
    for (let k = 0; k < pairs.count; k++) {
      expect(pairs.born[k]).toBe(0);
      expect(pairs.dying[k]).toBe(0);
    }
  });

  it("pairLayouts references every source and every target object at least once", () => {
    const combos: [number, number][] = [
      [10, 10],
      [10, 16],
      [16, 10],
      [4, 48],
      [48, 4],
    ];
    for (const [nf, nt] of combos) {
      const from = buildLook(0, 1, nf);
      const to = buildLook(1, 2, nt);
      const pairs = pairLayouts(from, to);
      expect(pairs.count).toBe(Math.max(nf, nt));
      const seenFrom = new Set<number>();
      const seenTo = new Set<number>();
      for (let k = 0; k < pairs.count; k++) {
        seenFrom.add(pairs.fromIdx[k]);
        seenTo.add(pairs.toIdx[k]);
      }
      for (let i = 0; i < nf; i++) expect(seenFrom.has(i)).toBe(true);
      for (let j = 0; j < nt; j++) expect(seenTo.has(j)).toBe(true);
    }
  });

  it("morphLayout is exact at e=0 (from) and e=1 (to) for plain matches", () => {
    const from = buildLook(0, 1, 20);
    const to = buildLook(1, 2, 20);
    const pairs = pairLayouts(from, to);
    const outA = new Float32Array(MAX_OBJ * 4);
    const outB = new Float32Array(MAX_OBJ * 4);
    const outC = new Float32Array(MAX_OBJ * 4);
    morphLayout(from, to, pairs, 0, outA, outB, outC);
    for (let k = 0; k < pairs.count; k++) {
      const fi = pairs.fromIdx[k];
      expect(outA[k * 4]).toBeCloseTo(from.objA[fi * 4], 6);
      expect(outA[k * 4 + 1]).toBeCloseTo(from.objA[fi * 4 + 1], 6);
      expect(outA[k * 4 + 2]).toBeCloseTo(from.objA[fi * 4 + 2], 6);
      expect(outB[k * 4 + 3]).toBeCloseTo(from.gain[fi], 6);
    }
    morphLayout(from, to, pairs, 1, outA, outB, outC);
    for (let k = 0; k < pairs.count; k++) {
      const ti = pairs.toIdx[k];
      expect(outA[k * 4]).toBeCloseTo(to.objA[ti * 4], 6);
      expect(outA[k * 4 + 1]).toBeCloseTo(to.objA[ti * 4 + 1], 6);
      expect(outA[k * 4 + 2]).toBeCloseTo(to.objA[ti * 4 + 2], 6);
      expect(outB[k * 4 + 3]).toBeCloseTo(to.gain[ti], 6);
    }
  });

  it("morphLayout stays in the first quadrant at every progress", () => {
    const from = buildLook(0, 5, 30);
    const to = buildLook(3, 6, 18);
    const pairs = pairLayouts(from, to);
    const outA = new Float32Array(MAX_OBJ * 4);
    const outB = new Float32Array(MAX_OBJ * 4);
    const outC = new Float32Array(MAX_OBJ * 4);
    for (let step = 0; step <= 10; step++) {
      const n = morphLayout(from, to, pairs, step / 10, outA, outB, outC);
      for (let k = 0; k < n; k++) {
        expect(outA[k * 4]).toBeGreaterThanOrEqual(-1e-9);
        expect(outA[k * 4 + 1]).toBeGreaterThanOrEqual(-1e-9);
      }
    }
  });

  it("ramps a birth's presence from 0 to 1 and a death's from 1 to 0", () => {
    const from = buildLook(0, 1, 6);
    const to = buildLook(0, 1, 12); // more objects: some are born
    const pairs = pairLayouts(from, to);
    expect(Array.from(pairs.born)).toContain(1);
    const bornIdx = Array.from(pairs.born).indexOf(1);
    const outA = new Float32Array(MAX_OBJ * 4);
    const outB = new Float32Array(MAX_OBJ * 4);
    const outC = new Float32Array(MAX_OBJ * 4);
    const gain = to.gain[pairs.toIdx[bornIdx]];
    morphLayout(from, to, pairs, 0, outA, outB, outC);
    expect(outB[bornIdx * 4 + 3]).toBeCloseTo(0, 6);
    morphLayout(from, to, pairs, 1, outA, outB, outC);
    expect(outB[bornIdx * 4 + 3]).toBeCloseTo(gain, 5);
    morphLayout(from, to, pairs, 0.5, outA, outB, outC);
    expect(outB[bornIdx * 4 + 3]).toBeGreaterThan(0);
    expect(outB[bornIdx * 4 + 3]).toBeLessThan(gain);

    const from2 = buildLook(0, 1, 12);
    const to2 = buildLook(0, 1, 6); // fewer objects: some die
    const pairs2 = pairLayouts(from2, to2);
    expect(Array.from(pairs2.dying)).toContain(1);
    const dyingIdx = Array.from(pairs2.dying).indexOf(1);
    const gain2 = from2.gain[pairs2.fromIdx[dyingIdx]];
    morphLayout(from2, to2, pairs2, 0, outA, outB, outC);
    expect(outB[dyingIdx * 4 + 3]).toBeCloseTo(gain2, 5);
    morphLayout(from2, to2, pairs2, 1, outA, outB, outC);
    expect(outB[dyingIdx * 4 + 3]).toBeCloseTo(0, 6);
  });
});
