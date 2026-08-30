import { describe, it, expect } from "vitest";
import { B, bonePitch, createPose } from "../src/render/scenes/dancers/rig.ts";
import { sway, type MoveClocks } from "../src/render/scenes/dancers/moves.ts";
import { createChoreographer, type ChoreoParams } from "../src/render/scenes/dancers/choreo.ts";

const DT = 1 / 60;
const PARAMS: ChoreoParams = { energy: 0.6, bob: 0.4, groove: 0.5, jaw: 0.5 };

/** Drives a choreographer through `seconds` of a scripted track. */
function run(
  seconds: number,
  script: (t: number) => Partial<MoveClocks>,
  params: ChoreoParams = PARAMS,
  onFrame?: (t: number, frame: ReturnType<ReturnType<typeof createChoreographer>["advance"]>, clocks: MoveClocks) => void,
) {
  const ch = createChoreographer();
  const bpm = 128;
  let beats = 0;
  let last = null as ReturnType<typeof ch.advance> | null;
  for (let i = 0; i < seconds * 60; i++) {
    const t = i * DT;
    beats += DT * (bpm / 60);
    const beatPhase = beats % 1;
    const clocks: MoveClocks = {
      beatPhase,
      barPhase: (beats / 4) % 1,
      tempoLock: 1,
      beatPulse: Math.exp(-6 * (beatPhase * 60) / bpm),
      lowPulse: 0,
      sectionIntensity: 0.5,
      dropPulse: 0,
      flowPhase: t * 1.2,
      timeSec: t,
      bpm,
      pulse: 0.5,
      ...script(t),
    };
    last = ch.advance(clocks, DT, params);
    onFrame?.(t, last, clocks);
  }
  return last!;
}

describe("dancers choreographer", () => {
  it("with no tempo lock, dances only the free sway — the beat clocks are invisible", () => {
    const framesA: Float32Array[] = [];
    const framesB: Float32Array[] = [];
    run(3, () => ({ tempoLock: 0, sectionIntensity: 1 }), PARAMS, (_t, f) => framesA.push(Float32Array.from(f.pose)));
    run(3, (t) => ({ tempoLock: 0, sectionIntensity: 1, beatPhase: (t * 3.1) % 1, barPhase: (t * 0.77) % 1 }), PARAMS, (_t, f) =>
      framesB.push(Float32Array.from(f.pose)),
    );
    expect(framesA.length).toBe(framesB.length);
    framesA.forEach((a, i) => expect([...a]).toEqual([...framesB[i]]));
    // And that free dance is sway itself once the slew has settled.
    const expected = createPose();
    sway({ beatPhase: 0, barPhase: 0, tempoLock: 0, beatPulse: 0, lowPulse: 0, sectionIntensity: 1, dropPulse: 0, flowPhase: (3 * 60 - 1) * DT * 1.2, timeSec: 0, bpm: 128, pulse: 0.5 }, PARAMS.energy, expected);
    const lastA = framesA[framesA.length - 1];
    for (let k = 0; k < expected.length; k++) expect(lastA[k]).toBeCloseTo(expected[k], 1);
  });

  it("climbs the move ladder as the section builds and comes back down, changing rungs only on a downbeat", () => {
    const levels: number[] = [];
    let lastBar = 0;
    let lastLevel = 0;
    run(
      24,
      (t) => ({ sectionIntensity: t < 12 ? t / 12 : 1 - (t - 12) / 12 }),
      PARAMS,
      (_t, f, c) => {
        if (f.level !== lastLevel) {
          // A rung change lands on the frame the bar wrapped.
          expect(c.barPhase).toBeLessThan(lastBar);
          lastLevel = f.level;
        }
        lastBar = c.barPhase;
        levels.push(f.level);
      },
    );
    expect(Math.max(...levels)).toBe(3);
    // Back down to the groove — never below it while the beat holds.
    expect(levels[levels.length - 1]).toBe(1);
    // It visits the rungs in order on the way up (no skipping past groove).
    const firstNonZero = levels.find((l) => l > 0);
    expect(firstNonZero).toBe(1);
  });

  it("keeps grooving through a steady section whose intensity has decayed to nothing", () => {
    // What a real track does thirty seconds into a verse: tempo held, section ~0.
    const last = run(12, () => ({ sectionIntensity: 0.05 }));
    expect(last.level).toBe(1);
  });

  it("releases the beat gate slowly, so a one-bar bpm dropout doesn't dump the dancer to sway", () => {
    const swayRef = createPose();
    const distFromSway = (pose: Float32Array, c: MoveClocks): number => {
      sway(c, PARAMS.energy, swayRef);
      let m = 0;
      for (let k = 0; k < pose.length; k++) m = Math.max(m, Math.abs(pose[k] - swayRef[k]));
      return m;
    };
    let shortlyAfter = 0;
    let longAfter = 0;
    run(
      8,
      (t) => ({ sectionIntensity: 0.9, tempoLock: t < 4 ? 1 : 0 }),
      PARAMS,
      (t, f, c) => {
        if (Math.abs(t - 4.4) < DT / 2) shortlyAfter = distFromSway(f.pose, c);
        if (Math.abs(t - 7.9) < DT / 2) longAfter = distFromSway(f.pose, c);
      },
    );
    // Pose channels are quaternion components, so a ~2 rad arm swing shows
    // up as a component delta of ~0.8; the thresholds are halves of that.
    expect(shortlyAfter).toBeGreaterThan(0.4); // 0.4 s after the dropout the arms are still up
    expect(longAfter).toBeLessThan(0.1); // seconds later it has let go
  });

  it("never snaps: a crossfade, a drop and a jaw hit all stay under the per-frame slew budget", () => {
    let maxDelta = 0;
    let prev: Float32Array | null = null;
    let drop = 0;
    run(
      14,
      (t) => {
        if (Math.abs(t - 6) < DT / 2) drop = 1;
        drop *= Math.exp(-DT * 2.5);
        return { sectionIntensity: t < 7 ? t / 7 : 1 - (t - 7) / 7, dropPulse: drop, lowPulse: t > 9 && t < 9.2 ? 1 : 0 };
      },
      PARAMS,
      (_t, f) => {
        if (prev) for (let k = 0; k < f.pose.length; k++) maxDelta = Math.max(maxDelta, Math.abs(f.pose[k] - prev[k]));
        prev = Float32Array.from(f.pose);
      },
    );
    // The drop's attack is the fastest thing in the system by design; this
    // bound is what "hits hard but doesn't teleport" means: no joint turns
    // more than ~11° in one frame (a true snap to the drop pose would be
    // several times that).
    expect(maxDelta).toBeLessThan(0.2);
  });

  it("blends the drop pose in on dropPulse and releases it again", () => {
    let peak = 0;
    let drop = 0;
    const last = run(
      8,
      (t) => {
        if (Math.abs(t - 2) < DT / 2) drop = 1;
        drop *= Math.exp(-DT * 2.5);
        return { sectionIntensity: 0.1, dropPulse: drop };
      },
      PARAMS,
      (t, f) => {
        if (t > 2 && t < 3) peak = Math.max(peak, bonePitch(f.pose, B.jaw));
      },
    );
    expect(peak).toBeGreaterThan(0.15); // the drop pose opens the jaw
    expect(bonePitch(last.pose, B.jaw)).toBeLessThan(0.02); // and it has closed again
  });

  it("keeps the camera still when bob is 0, however hard the beat hits", () => {
    const last = run(4, () => ({ beatPulse: 1, lowPulse: 1 }), { ...PARAMS, bob: 0 });
    expect(last.camDolly).toBe(0);
    expect(last.camTilt).toBe(0);
    expect(last.camRoll).toBe(0);
  });
});
