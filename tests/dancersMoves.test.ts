import { describe, it, expect } from "vitest";
import {
  B,
  boneTail,
  createPose,
  createRigWorld,
  forwardKinematics,
} from "../src/render/scenes/dancers/rig.ts";
import {
  BEAT_FLOOR,
  GROOVE_BIAS,
  MOVE_LADDER,
  MOVE_NAMES,
  armSwing,
  effectiveIntensity,
  elbowFlex,
  kneeFlex,
  legSwing,
  pickMoveLevel,
  restPose,
  stance,
  sway,
  type MoveClocks,
} from "../src/render/scenes/dancers/moves.ts";

const clocks = (over: Partial<MoveClocks> = {}): MoveClocks => ({
  beatPhase: 0.3,
  barPhase: 0.6,
  tempoLock: 1,
  beatPulse: 0.5,
  lowPulse: 0.2,
  sectionIntensity: 0.5,
  dropPulse: 0,
  flowPhase: 3.7,
  timeSec: 10,
  bpm: 124,
  pulse: 0.5,
  ...over,
});

const world = createRigWorld();
const tail = new Float32Array(3);
const solve = (pose: Float32Array) => forwardKinematics(pose, world);
const head = (bone: number) => [world.pos[bone * 3], world.pos[bone * 3 + 1], world.pos[bone * 3 + 2]];
const tailOf = (bone: number) => {
  boneTail(world, bone, tail, 0);
  return [tail[0], tail[1], tail[2]];
};

describe("dancers intent helpers", () => {
  // These pin the sign conventions the helpers exist to hide — if a rest
  // rotation in rig.ts changes, this is what catches a backwards knee.
  it("armSwing forward brings the hand in front of the shoulder (+Z)", () => {
    const pose = createPose();
    armSwing(pose, "L", 0.8, 0);
    solve(pose);
    expect(tailOf(B.L_forearm)[2]).toBeGreaterThan(head(B.L_upperArm)[2] + 0.2);
  });

  it("armSwing spread moves each arm away from the body on its own side", () => {
    const pose = createPose();
    armSwing(pose, "L", 0, 1.2);
    armSwing(pose, "R", 0, 1.2);
    solve(pose);
    expect(tailOf(B.L_forearm)[0]).toBeGreaterThan(head(B.L_upperArm)[0] + 0.2);
    expect(tailOf(B.R_forearm)[0]).toBeLessThan(head(B.R_upperArm)[0] - 0.2);
  });

  it("elbowFlex brings the forearm forward of the elbow", () => {
    const pose = createPose();
    elbowFlex(pose, "R", 1.3);
    solve(pose);
    expect(tailOf(B.R_forearm)[2]).toBeGreaterThan(head(B.R_forearm)[2] + 0.15);
  });

  it("kneeFlex tucks the foot behind the knee; legSwing drives the thigh forward and outward", () => {
    const pose = createPose();
    kneeFlex(pose, "L", 1.2);
    solve(pose);
    expect(tailOf(B.L_shin)[2]).toBeLessThan(head(B.L_shin)[2] - 0.15);

    restPose(pose);
    legSwing(pose, "L", 0.9, 0.5);
    legSwing(pose, "R", 0.9, 0.5);
    solve(pose);
    expect(tailOf(B.L_thigh)[2]).toBeGreaterThan(head(B.L_thigh)[2] + 0.2);
    expect(tailOf(B.L_thigh)[0]).toBeGreaterThan(head(B.L_thigh)[0] + 0.1);
    expect(tailOf(B.R_thigh)[0]).toBeLessThan(head(B.R_thigh)[0] - 0.1);
  });
});

describe("dancers moves", () => {
  it("sway at energy 0 is exactly the rest stance", () => {
    const out = createPose();
    sway(clocks(), 0, out);
    const expected = createPose();
    restPose(expected);
    stance(expected);
    expect([...out]).toEqual([...expected]);
  });

  it("sway reads only the free clock, never the beat", () => {
    const a = createPose();
    const b = createPose();
    sway(clocks({ beatPhase: 0.1, barPhase: 0.2, beatPulse: 1, lowPulse: 1 }), 0.8, a);
    sway(clocks({ beatPhase: 0.9, barPhase: 0.7, beatPulse: 0, lowPulse: 0 }), 0.8, b);
    expect([...a]).toEqual([...b]);
  });

  it("every move is continuous through a full bar, including the phase wrap", () => {
    const moves = MOVE_LADDER.filter((m): m is NonNullable<typeof m> => m !== null);
    expect(moves.length).toBe(MOVE_NAMES.length - 1);
    const steps = 240;
    for (const move of [sway, ...moves]) {
      const prev = createPose();
      const cur = createPose();
      let maxDelta = 0;
      for (let i = 0; i <= steps + 8; i++) {
        // Runs past the wrap so bar 1.0 -> 0.0 (and beat 4 -> 0) is covered.
        const bar = (i / steps) % 1;
        const beat = ((i * 4) / steps) % 1;
        move(clocks({ barPhase: bar, beatPhase: beat, flowPhase: 2 + i / steps }), 1, cur);
        if (i > 0) for (let k = 0; k < cur.length; k++) maxDelta = Math.max(maxDelta, Math.abs(cur[k] - prev[k]));
        prev.set(cur);
      }
      // A phase-wrap cliff is a whole radian in one step; the fastest
      // legitimate motion (a knee driving up in a 240-step bar at energy 1)
      // stays well under this.
      expect(maxDelta).toBeLessThan(0.15);
    }
  });
});

describe("dancers move picker", () => {
  it("climbs on the UP thresholds and only falls back below the DOWN ones", () => {
    expect(pickMoveLevel(0, 0.29)).toBe(0);
    expect(pickMoveLevel(0, 0.31)).toBe(1);
    expect(pickMoveLevel(1, 0.28)).toBe(1); // inside the hysteresis band: stays
    expect(pickMoveLevel(1, 0.19)).toBe(0);
    expect(pickMoveLevel(0, 0.9)).toBe(3); // climbs every rung at once
    expect(pickMoveLevel(3, 0.72)).toBe(3);
    expect(pickMoveLevel(3, 0.69)).toBe(2);
    expect(pickMoveLevel(3, 0.1)).toBe(0);
  });

  it("the groove setting is bias-free at its default and monotone either side", () => {
    for (const x of [0, 0.25, 0.5, 0.75, 1]) expect(effectiveIntensity(x, 0, 0.5, 0.5)).toBe(x);
    expect(effectiveIntensity(0.5, 0, 0.5, 1)).toBeCloseTo(0.5 + 0.5 * GROOVE_BIAS);
    expect(effectiveIntensity(0.5, 0, 0.5, 0)).toBeCloseTo(0.5 - 0.5 * GROOVE_BIAS);
    expect(effectiveIntensity(0.95, 0, 0.5, 1)).toBe(1);
    expect(effectiveIntensity(0.05, 0, 0.5, 0)).toBe(0);
  });

  it("a held beat puts a floor under the picker that a decayed section can't undercut", () => {
    // A steady section: sectionIntensity has crept back to ~0 (see
    // sectionIntensity.ts) but the beat is still there — so the dancer grooves.
    expect(effectiveIntensity(0.1, 1, 0.5, 0.5)).toBe(BEAT_FLOOR);
    expect(pickMoveLevel(0, effectiveIntensity(0.1, 1, 0.5, 0.5))).toBe(1);
    // ...and after a chorus settles it comes back down to groove, not below it.
    expect(pickMoveLevel(3, effectiveIntensity(0.1, 1, 0.5, 0.5))).toBe(1);
    // A strong pulse dial lifts the floor into bounce; a barely-there beat drops it out of groove.
    expect(pickMoveLevel(0, effectiveIntensity(0, 1, 1, 0.5))).toBe(2);
    expect(pickMoveLevel(0, effectiveIntensity(0, 1, 0, 0.5))).toBe(0);
    // The section still wins when it's above the floor; no beat, no floor.
    expect(effectiveIntensity(0.9, 1, 0.5, 0.5)).toBe(0.9);
    expect(effectiveIntensity(0.1, 0, 1, 0.5)).toBeCloseTo(0.1);
  });
});
