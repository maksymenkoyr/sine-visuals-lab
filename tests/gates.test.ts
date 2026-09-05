import { describe, it, expect } from "vitest";
import {
  advanceGates,
  BARS_PER_PHRASE,
  createGateState,
  FREE_BAR_SEC,
  gatesScene,
  LOOK_COUNT,
  type GateAnim,
  type GateOpts,
  type GateState,
} from "../src/render/scenes/gates/index.ts";
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

  it("a cut flips the spin direction while travel and spin stay continuous", () => {
    const st = createGateState();
    const rng = lcg(13);
    let prevTravel = st.travel;
    let prevSpin = st.spinPos;
    let flips = 0;
    let dir = st.spinDir;
    for (let bar = 0; bar < 8; bar++) {
      for (let k = 1; k <= STEPS; k++) {
        advanceGates(st, anim({ barPhase: k === STEPS ? 0 : k / STEPS }), OPTS, rng);
        expect(st.travel).toBeGreaterThan(prevTravel);
        expect(Math.abs(st.spinPos - prevSpin)).toBeLessThan(1.4 * DT + 1e-9);
        if (st.spinDir !== dir) flips++;
        dir = st.spinDir;
        prevTravel = st.travel;
        prevSpin = st.spinPos;
      }
    }
    expect(flips).toBeGreaterThan(0);

    const slow = createGateState();
    const fast = createGateState();
    const bassy = createGateState();
    for (let k = 0; k < 60; k++) {
      advanceGates(slow, anim(), { ...OPTS, speed: 0 }, lcg(1));
      advanceGates(fast, anim(), { ...OPTS, speed: 1 }, lcg(1));
      advanceGates(bassy, anim({ low: 1 }), { ...OPTS, speed: 0 }, lcg(1));
    }
    expect(fast.travel).toBeGreaterThan(slow.travel);
    expect(bassy.travel).toBeGreaterThan(slow.travel);
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
