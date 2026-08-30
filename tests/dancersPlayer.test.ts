import { describe, it, expect } from "vitest";
import {
  DOUBLE_TIME_RATIO,
  FADE_BARS,
  HALF_TIME_RATIO,
  HOLD_LOOPS,
  clipCycleBars,
  clipPhaseAt,
  createBarCounter,
  createClipPlayer,
  mulberry32,
  pickClip,
  type PlayerParams,
} from "../src/render/scenes/dancers/player.ts";
import { sampleClip, type ClipMeta } from "../src/render/scenes/dancers/clipFormat.ts";
import { createPose } from "../src/render/scenes/dancers/rig.ts";
import { makeLibrary } from "./dancersClips.helper.ts";

const clip = (beats: number, nativeBpm: number): ClipMeta => ({
  name: "c", family: "test", beats, nativeBpm, frames: beats * 16, energy: 0.5, bigness: 0.5, mirrorOf: -1, source: "",
});

const params = (over: Partial<PlayerParams> = {}): PlayerParams => ({ intensity: 0.5, family: null, dropPulse: 0, bpm: 120, ...over });

/** Runs a player over `bars` bars at 60 steps per bar, calling back each step. */
function runPlayer(player: ReturnType<typeof createClipPlayer>, bars: number, p: (bar: number) => PlayerParams, onStep?: (bars: number, name: string | null, pose: Float32Array) => void) {
  const out = createPose();
  const steps = 60;
  for (let i = 0; i < bars * steps; i++) {
    const barPhase = (i % steps) / steps;
    const c = player.advance(barPhase, p(Math.floor(i / steps)), out);
    onStep?.(i / steps, c ? c.name : null, out);
  }
}

describe("dancers clip clock", () => {
  it("spans the clip's own bars near its native tempo, and goes half/double-time past the ratios", () => {
    const c = clip(8, 120);
    expect(clipCycleBars(c, 120)).toBe(2);
    expect(clipCycleBars(c, 120 * HALF_TIME_RATIO * 0.99)).toBe(2);
    expect(clipCycleBars(c, 120 * HALF_TIME_RATIO * 1.01)).toBe(4);
    expect(clipCycleBars(c, 120 * DOUBLE_TIME_RATIO * 1.01)).toBe(2);
    expect(clipCycleBars(c, 120 * DOUBLE_TIME_RATIO * 0.99)).toBe(1);
    // No tempo yet: the clip's own bars, so it still plays once the bar clock moves.
    expect(clipCycleBars(c, 0)).toBe(2);
  });

  it("is a pure function of bars elapsed — the same bar always lands on the same clip phase", () => {
    const c = clip(8, 120);
    expect(clipPhaseAt(c, 120, 0)).toBe(0);
    expect(clipPhaseAt(c, 120, 1)).toBeCloseTo(0.5, 9);
    expect(clipPhaseAt(c, 120, 2)).toBe(0);
    expect(clipPhaseAt(c, 120, 2.25)).toBeCloseTo(0.125, 9);
    // Half-time: two bars of music per clip bar.
    expect(clipPhaseAt(c, 180, 2)).toBeCloseTo(0.5, 9);
  });

  it("never steps backwards across a bar wrap, however coarse the frames", () => {
    const c = clip(4, 124);
    const bars = createBarCounter();
    let prev = -1;
    let wraps = 0;
    for (let i = 0; i < 400; i++) {
      const barPhase = (i * 0.037) % 1;
      const phase = clipPhaseAt(c, 124, bars.advance(barPhase));
      if (phase < prev) wraps++;
      prev = phase;
    }
    // A 1-bar clip wraps exactly when the bar does: ~14 wraps in 400 × 0.037 bars.
    expect(wraps).toBe(Math.floor(400 * 0.037));
  });

  it("counts bars from the bar phase's wraps", () => {
    const bars = createBarCounter();
    expect(bars.advance(0.2)).toBeCloseTo(0.2);
    expect(bars.advance(0.9)).toBeCloseTo(0.9);
    expect(bars.advance(0.1)).toBeCloseTo(1.1);
    expect(bars.advance(0.05)).toBeCloseTo(2.05);
  });
});

describe("dancers clip picker", () => {
  const lib = makeLibrary();
  const noRand = () => 0;

  it("matches clip energy to the intensity asked for", () => {
    expect(pickClip(lib, params({ intensity: 0.05 }), null, [], noRand, false)!.name).toBe("chill");
    expect(pickClip(lib, params({ intensity: 0.45 }), null, [], noRand, false)!.name).toBe("groove");
    expect(pickClip(lib, params({ intensity: 0.95 }), null, [], noRand, false)!.name).toBe("wild");
  });

  it("prefers the family asked for, and falls back to everything when the family is empty", () => {
    expect(pickClip(lib, params({ intensity: 0.1, family: "street" }), null, [], noRand, false)!.name).toBe("groove");
    expect(pickClip(lib, params({ intensity: 0.1, family: "nonesuch" }), null, [], noRand, false)!.name).toBe("chill");
  });

  it("avoids the clip already playing and recent repeats", () => {
    const groove = lib.byName.get("groove")!;
    expect(pickClip(lib, params({ intensity: 0.4 }), groove, [], noRand, false)!.name).not.toBe("groove");
    expect(pickClip(lib, params({ intensity: 0.4 }), null, ["groove"], noRand, false)!.name).not.toBe("groove");
  });

  it("a drop asks for the biggest move regardless of intensity", () => {
    expect(pickClip(lib, params({ intensity: 0.1 }), null, [], noRand, true)!.name).toBe("wild");
  });

  it("returns null on an empty library", () => {
    expect(pickClip({ clips: [], byName: new Map() }, params(), null, [], noRand, false)).toBeNull();
  });
});

describe("dancers clip player", () => {
  it("starts a clip on the first frame at its own frame 0, and changes only on bar boundaries after the hold", () => {
    const lib = makeLibrary();
    const player = createClipPlayer(lib, 3);
    const changes: number[] = [];
    let last: string | null = null;
    runPlayer(player, 16, () => params({ intensity: 0.4 }), (bars, name) => {
      if (name !== last) {
        changes.push(bars);
        last = name;
      }
    });
    expect(changes[0]).toBe(0);
    // Every change lands exactly on a bar line.
    for (const b of changes) expect(b % 1).toBeCloseTo(0, 9);
    // A 2-bar clip is held HOLD_LOOPS loops: no change before bar 2·HOLD_LOOPS.
    expect(changes[1]).toBeGreaterThanOrEqual(2 * HOLD_LOOPS);
    expect(changes.length).toBeGreaterThan(1); // and it does eventually move on
  });

  it("phase-locks: the clip's pose at bar N+cycle equals its pose at bar N", () => {
    const lib = makeLibrary();
    const player = createClipPlayer(lib, 1);
    const snaps = new Map<number, Float32Array>();
    runPlayer(player, 4, () => params({ intensity: 0.4 }), (bars, _name, pose) => {
      if (Math.abs(bars - 0.5) < 1e-9 || Math.abs(bars - 2.5) < 1e-9) snaps.set(Math.round(bars * 2), Float32Array.from(pose));
    });
    const a = snaps.get(1)!;
    const b = snaps.get(5)!;
    for (let i = 0; i < a.length; i++) expect(b[i]).toBeCloseTo(a[i], 5);
  });

  it("crossfades a handover over FADE_BARS without a jump", () => {
    const lib = makeLibrary();
    const player = createClipPlayer(lib, 7);
    let prev: Float32Array | null = null;
    let maxDelta = 0;
    let changed = false;
    let last: string | null = null;
    // Swing the intensity so the picker changes clip at the first opportunity.
    runPlayer(player, 12, (bar) => params({ intensity: bar < 4 ? 0.1 : 1 }), (_bars, name, pose) => {
      if (last && name !== last) changed = true;
      last = name;
      if (prev) for (let i = 0; i < pose.length; i++) maxDelta = Math.max(maxDelta, Math.abs(pose[i] - prev[i]));
      prev = Float32Array.from(pose);
    });
    expect(changed).toBe(true);
    // 60 steps per bar; a synthetic clip's fastest channel moves ~0.05 per
    // step, and a fade over FADE_BARS bars adds at most the pose gap / (FADE_BARS·60).
    expect(maxDelta).toBeLessThan(0.08 + 2 / (FADE_BARS * 60));
  });

  it("a drop pulse switches to the biggest clip at the next bar", () => {
    const lib = makeLibrary();
    const player = createClipPlayer(lib, 5);
    let atBar3: string | null = null;
    runPlayer(player, 4, (bar) => params({ intensity: 0.1, dropPulse: bar === 2 ? 1 : 0 }), (bars, name) => {
      if (Math.abs(bars - 3.1) < 1e-9) atBar3 = name;
    });
    expect(atBar3).toBe("wild");
  });

  it("samples the same frames the format does", () => {
    const lib = makeLibrary();
    const player = createClipPlayer(lib, 1);
    const out = createPose();
    const c = player.advance(0, params({ intensity: 0.4 }), out)!;
    const expected = createPose();
    sampleClip(c, 0, expected);
    expect([...out]).toEqual([...expected]);
  });

  it("the seeded PRNG is deterministic and in [0,1)", () => {
    const a = mulberry32(42), b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});
