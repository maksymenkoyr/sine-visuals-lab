import { describe, it, expect } from "vitest";
import { B, bonePitch, createPose } from "../src/render/scenes/dancers/rig.ts";
import { sway, type MoveClocks } from "../src/render/scenes/dancers/moves.ts";
import { createChoreographer, type ChoreoParams } from "../src/render/scenes/dancers/choreo.ts";
import { makeLibrary } from "./dancersClips.helper.ts";

const DT = 1 / 60;
const PARAMS: ChoreoParams = { energy: 0.6, bob: 0.4, groove: 0.5, jaw: 0.5, family: null };

type Frame = ReturnType<ReturnType<typeof createChoreographer>["advance"]>;

/** Drives a choreographer (with the synthetic library unless `withLibrary`
 *  is false) through `seconds` of a scripted track. */
function run(
  seconds: number,
  script: (t: number) => Partial<MoveClocks>,
  params: ChoreoParams = PARAMS,
  onFrame?: (t: number, frame: Frame, clocks: MoveClocks) => void,
  withLibrary = true,
) {
  const ch = createChoreographer();
  if (withLibrary) ch.setLibrary(makeLibrary());
  const bpm = 128;
  let beats = 0;
  let last = null as Frame | null;
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

  it("sways until a library arrives, then dances a clip", () => {
    const noLib = run(2, () => ({}), PARAMS, undefined, false);
    expect(noLib.clip).toBeNull();
    const withLib = run(2, () => ({}));
    expect(withLib.clip).not.toBeNull();
  });

  it("asks for bigger moves as the section builds and settles back to a groove, never to standing still", () => {
    const seen = new Map<string, number>();
    let lastClip: string | null = null;
    run(
      40,
      (t) => ({ sectionIntensity: t < 20 ? t / 20 : 1 - (t - 20) / 20 }),
      PARAMS,
      (t, f) => {
        if (f.clip) seen.set(f.clip, t);
        lastClip = f.clip;
      },
    );
    expect(seen.has("wild")).toBe(true); // the chorus got the big move
    // At the end the section has decayed to 0 but the beat holds: still a clip,
    // and a modest one.
    expect(lastClip).not.toBeNull();
    expect(["chill", "groove"]).toContain(lastClip);
  });

  it("never snaps: a handover, a drop and a jaw hit all stay under the per-frame slew budget", () => {
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
    // bound is what "hits hard but doesn't teleport" means: no quaternion
    // component moves more than 0.2 in one frame (~23° for a pure rotation).
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
    // Pose channels are quaternion components; the synthetic clips swing
    // ~0.8 rad, so a component delta of ~0.3 is "still dancing".
    expect(shortlyAfter).toBeGreaterThan(0.15); // 0.4 s after the dropout the move is still mostly there
    expect(longAfter).toBeLessThan(0.06); // seconds later it has let go
  });
});
