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
import { buildLibrary, sampleClip, type ClipMeta } from "../src/render/scenes/dancers/clipFormat.ts";
import { createPose } from "../src/render/scenes/dancers/rig.ts";
import { makeClip, makeLibrary } from "./dancersClips.helper.ts";

const clip = (beats: number, nativeBpm: number): ClipMeta => ({
  name: "c", family: "test", beats, nativeBpm, frames: beats * 16, energy: 0.5, bigness: 0.5, mirrorOf: -1, source: "",
});

const params = (over: Partial<PlayerParams> = {}): PlayerParams => ({ intensity: 0.5, family: null, dropPulse: 0, bpm: 120, blend: "crossfade", ...over });

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

  it("keeps a clip's loop length for as long as it plays, so a wobbling or dropped bpm never jumps the pose", () => {
    // Native 100 bpm: 130 is the normal loop (2 bars), 140 crosses
    // HALF_TIME_RATIO, and 0 (a break) falls back to the native bars.
    const lib = buildLibrary([makeClip({ name: "solo", beats: 8, nativeBpm: 100 })]);
    const maxStep = (bpmAt: (bars: number) => number): number => {
      const player = createClipPlayer(lib, 1);
      let prev: Float32Array | null = null;
      let maxDelta = 0;
      const out = createPose();
      // Three bars stays inside the HOLD_LOOPS hold (4 bars for this clip),
      // so no re-pick happens.
      for (let i = 0; i < 3 * 60; i++) {
        const bars = i / 60;
        player.advance(bars % 1, params({ bpm: bpmAt(bars) }), out);
        if (prev) for (let k = 0; k < out.length; k++) maxDelta = Math.max(maxDelta, Math.abs(out[k] - prev[k]));
        prev = Float32Array.from(out);
      }
      return maxDelta;
    };
    const steady = maxStep(() => 130);
    // 140 for one frame, 0 for another, then back — and a long stretch at 140.
    const wobble = maxStep((b) => (Math.abs(b - 1.25) < 1e-9 ? 140 : Math.abs(b - 1.5) < 1e-9 ? 0 : b > 2 ? 140 : 130));
    expect(wobble).toBeLessThan(steady * 1.01 + 1e-6);
  });

  it("re-reads the loop length when the same clip is picked again after its hold", () => {
    const lib = buildLibrary([makeClip({ name: "solo", beats: 3, nativeBpm: 100 })]);
    const player = createClipPlayer(lib, 1);
    const out = createPose();
    // 100 bpm: a 0.75-bar loop, held round(1.5) = 2 bars. Then 140 bpm
    // (half-time): a 1.5-bar loop, picked up again at bar 2.
    for (let i = 0; i <= 2 * 60 + 15; i++) player.advance((i % 60) / 60, params({ bpm: i < 2 * 60 ? 100 : 140 }), out);
    // The loop restarted on the bar-2 downbeat, so a quarter bar later it is
    // 0.25 / 1.5 of the way round (continuing from bar 0 would give 0.5).
    const want = createPose();
    sampleClip(lib.clips[0], 0.25 / 1.5, want);
    for (let k = 0; k < want.length; k++) expect(out[k]).toBeCloseTo(want[k], 5);
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

  it("inertialization: the handover frame is continuous, and the offset is gone after FADE_BARS", () => {
    const lib = makeLibrary();
    const player = createClipPlayer(lib, 7);
    let prev: Float32Array | null = null;
    let maxDelta = 0;
    let switchAt = -1;
    let last: string | null = null;
    let settled: { pose: Float32Array; clip: string; bars: number } | null = null;
    runPlayer(player, 12, (bar) => params({ intensity: bar < 4 ? 0.1 : 1, blend: "inertial" }), (bars, name, pose) => {
      if (last && name !== last && switchAt < 0) switchAt = bars;
      last = name;
      if (prev) for (let i = 0; i < pose.length; i++) maxDelta = Math.max(maxDelta, Math.abs(pose[i] - prev[i]));
      prev = Float32Array.from(pose);
      if (switchAt >= 0 && !settled && bars > switchAt + FADE_BARS + 0.05) settled = { pose: Float32Array.from(pose), clip: name!, bars };
    });
    expect(switchAt).toBeGreaterThan(0);
    // No jump anywhere — the old pose carries straight into the new clip.
    expect(maxDelta).toBeLessThan(0.08 + 2 / (FADE_BARS * 60));
    // Once the offset has decayed, the output is the bare clip sample.
    const s = settled!;
    const c = lib.byName.get(s.clip)!;
    const expected = createPose();
    sampleClip(c, clipPhaseAt(c, 120, s.bars - Math.floor(switchAt)), expected);
    for (let i = 0; i < expected.length; i++) expect(s.pose[i]).toBeCloseTo(expected[i], 5);
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
