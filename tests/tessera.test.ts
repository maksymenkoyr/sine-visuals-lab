import { describe, it, expect } from "vitest";
import {
  BALL_RADIUS,
  CAM_FAR,
  CAM_NEAR,
  DOLLY_HOLD_FAR_SEC,
  DOLLY_HOLD_NEAR_SEC,
  DOLLY_IN_SEC,
  DOLLY_OUT_SEC,
  DOLLY_PERIOD_SEC,
  HUE_FAST_RATE,
  HUE_LOCK_THRESHOLD,
  MAX_RINGS,
  POLE_HALF,
  POLE_LEN,
  RING_THETA_MAX,
  SLOT_PITCH_RATIO,
  advanceHueClock,
  cameraBasis,
  camDistanceForDolly,
  createHueClockState,
  dollyCycle,
  effectiveDolly,
  focalFromFovDeg,
  hashLattice,
  instanceRingSlot,
  latticeLayout,
  lobeValue,
  project,
  screenBallRadius,
  sectorHue,
  slotPhi,
} from "../src/render/scenes/tessera/lattice.ts";

describe("tessera lattice layout: constant arc-length spacing", () => {
  it("every ring's slot count is a multiple of fold", () => {
    for (const fold of [4, 8, 12]) {
      for (const pitch of [0.05, 0.085, 0.15, 0.2]) {
        const layout = latticeLayout(pitch, fold);
        for (const count of layout.slots) {
          expect(count % fold).toBe(0);
        }
      }
    }
  });

  it("a ring's own azimuthal arc spacing (2*pi*sin(theta)/slots) stays within ~35% of pitch*SLOT_PITCH_RATIO, past the first two rings", () => {
    for (const pitch of [0.05, 0.085, 0.15, 0.2]) {
      const layout = latticeLayout(pitch, 8);
      const target = pitch * SLOT_PITCH_RATIO;
      for (let i = 2; i < layout.ringCount; i++) {
        const arc = (2 * Math.PI * Math.sin(layout.theta[i])) / layout.slots[i];
        expect(arc).toBeGreaterThan(target * 0.65);
        expect(arc).toBeLessThan(target * 1.35);
      }
    }
  });

  it("the slot count grows with ring radius (constant arc-length spacing, not constant slot count)", () => {
    const layout = latticeLayout(0.085, 8);
    // The reference's own measured lattice: angular box count grows with
    // radius (swift-weaving-parnas.md) -- round 1's bug was a flat count.
    expect(layout.slots[layout.ringCount - 1]).toBeGreaterThan(layout.slots[0] * 3);
    let prevMeaningfullyGrew = false;
    for (let i = 1; i < layout.ringCount; i++) {
      if (layout.slots[i] > layout.slots[0]) prevMeaningfullyGrew = true;
    }
    expect(prevMeaningfullyGrew).toBe(true);
  });

  it("ringStart is the exact prefix sum of slots, and total = sum(slots) + 1 (the pole)", () => {
    const layout = latticeLayout(0.085, 8);
    expect(layout.ringStart.length).toBe(layout.ringCount + 1);
    expect(layout.ringStart[0]).toBe(0);
    let running = 0;
    for (let i = 0; i < layout.ringCount; i++) {
      running += layout.slots[i];
      expect(layout.ringStart[i + 1]).toBe(running);
    }
    expect(layout.total).toBe(running + 1);
  });

  it("theta increases by exactly pitch each ring, from pitch itself (k=1)", () => {
    const pitch = 0.085;
    const layout = latticeLayout(pitch, 8);
    for (let i = 0; i < layout.ringCount; i++) {
      expect(layout.theta[i]).toBeCloseTo(pitch * (i + 1), 10);
    }
  });

  it("stops at RING_THETA_MAX or MAX_RINGS, whichever comes first", () => {
    // A tiny pitch would need far more than MAX_RINGS rings to reach
    // RING_THETA_MAX -- the cap must bite first.
    const tiny = latticeLayout(0.01, 8);
    expect(tiny.ringCount).toBe(MAX_RINGS);
    expect(tiny.theta[tiny.ringCount - 1]).toBeLessThanOrEqual(MAX_RINGS * 0.01 + 1e-9);

    // A large pitch (within the setting's own max) should stop well short
    // of MAX_RINGS, bounded by RING_THETA_MAX instead.
    const coarse = latticeLayout(0.2, 8);
    expect(coarse.ringCount).toBeLessThan(MAX_RINGS);
    expect(coarse.theta[coarse.ringCount - 1]).toBeLessThanOrEqual(RING_THETA_MAX);
    expect(coarse.theta[coarse.ringCount - 1] + 0.2).toBeGreaterThan(RING_THETA_MAX);
  });
});

describe("tessera lattice: instance -> (ring, slot) round trip against the layout", () => {
  it("decodes every ring x slot instance back to the same indices, row-major within each ring", () => {
    const layout = latticeLayout(0.085, 8);
    for (let ring = 0; ring < layout.ringCount; ring++) {
      for (let slot = 0; slot < layout.slots[ring]; slot++) {
        const id = layout.ringStart[ring] + slot;
        expect(instanceRingSlot(id, layout)).toEqual({ ring, slot });
      }
    }
  });

  it("returns null for the trailing pole instance, and for nothing before it", () => {
    const layout = latticeLayout(0.085, 8);
    const total = layout.ringStart[layout.ringCount];
    expect(instanceRingSlot(total, layout)).toBeNull();
    expect(instanceRingSlot(total - 1, layout)).not.toBeNull();
    expect(instanceRingSlot(-1, layout)).toBeNull();
  });

  it("slotPhi wraps a full turn across the slot count", () => {
    const slotCount = 48;
    expect(slotPhi(0, slotCount)).toBeCloseTo(0, 10);
    expect(slotPhi(slotCount, slotCount)).toBeCloseTo(2 * Math.PI, 10);
  });
});

describe("tessera lobe/hue: symmetry under phi -> phi+pi (fold even)", () => {
  it("lobeValue is unchanged under phi -> phi+pi for an even fold, at any latitude", () => {
    const fold = 8;
    const swirl = 0.55;
    for (let ring = 0; ring < 9; ring++) {
      const theta = (ring + 1) * 0.085;
      for (let s = 0; s < 20; s++) {
        const phi = (s / 20) * Math.PI * 2;
        expect(lobeValue(phi + Math.PI, theta, fold, swirl)).toBeCloseTo(lobeValue(phi, theta, fold, swirl), 8);
      }
    }
  });

  it("lobeValue is NOT generally unchanged under phi -> phi+pi for an odd fold", () => {
    const fold = 5;
    const swirl = 0.55;
    const theta = 4 * 0.085;
    let anyDiffers = false;
    for (let s = 0; s < 20; s++) {
      const phi = (s / 20) * Math.PI * 2;
      if (Math.abs(lobeValue(phi + Math.PI, theta, fold, swirl) - lobeValue(phi, theta, fold, swirl)) > 1e-6) anyDiffers = true;
    }
    expect(anyDiffers).toBe(true);
  });

  it("lobeValue stays within its 0.5 +/- 0.6 cosine bounds", () => {
    for (let i = 0; i < 200; i++) {
      const v = lobeValue(Math.random() * 10 - 5, Math.random() * 2, 8, Math.random() * 2 - 1);
      expect(v).toBeGreaterThanOrEqual(0.5 - 0.6 - 1e-9);
      expect(v).toBeLessThanOrEqual(0.5 + 0.6 + 1e-9);
    }
  });

  it("lobeValue peaks near 1.1 and troughs near -0.1 (amplitude 0.6 around a 0.5 mean)", () => {
    expect(lobeValue(0, 0, 8, 0)).toBeCloseTo(1.1, 10);
    expect(lobeValue(Math.PI / 8, 0, 8, 0)).toBeCloseTo(-0.1, 10);
  });

  it("sectorHue is also symmetric under phi -> phi+pi for an even fold (each petal is one hue)", () => {
    const fold = 8;
    const swirl = 0.55;
    for (let ring = 0; ring < 9; ring++) {
      const theta = (ring + 1) * 0.085;
      for (let s = 0; s < 20; s++) {
        const phi = (s / 20) * Math.PI * 2;
        expect(sectorHue(phi + Math.PI, theta, fold, swirl)).toBeCloseTo(sectorHue(phi, theta, fold, swirl), 8);
      }
    }
  });

  it("sectorHue only ever returns the two complementary stops 0 or 0.5", () => {
    for (let i = 0; i < 300; i++) {
      const v = sectorHue(Math.random() * 20 - 10, Math.random() * 2, 8, Math.random() * 2 - 1);
      expect(v === 0 || v === 0.5).toBe(true);
    }
  });

  it("the lobe/hue argument is continuous in latitude -- a small theta step never jumps by more than a small step's worth of phase", () => {
    // Round 2's whole point: swirl*theta*SWIRL_SCALE replaces the old
    // discrete swirl*ringIndex, so nudging theta by a tiny amount can never
    // jump the lobe value the way changing ring index by one used to.
    const fold = 8;
    const swirl = 2; // the setting's own max
    let prev = lobeValue(0.3, 0, fold, swirl);
    for (let theta = 0.001; theta <= 1.75; theta += 0.001) {
      const v = lobeValue(0.3, theta, fold, swirl);
      expect(Math.abs(v - prev)).toBeLessThan(0.05);
      prev = v;
    }
  });
});

describe("tessera length jitter hash", () => {
  it("is deterministic for the same inputs", () => {
    expect(hashLattice(3, 7, 12)).toBe(hashLattice(3, 7, 12));
  });

  it("stays within [0,1)", () => {
    for (let i = 0; i < 500; i++) {
      const v = hashLattice(Math.floor(Math.random() * 20), Math.floor(Math.random() * 60), Math.floor(Math.random() * 100));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("differs across most neighbouring time buckets (it's meant to flicker)", () => {
    let distinct = 0;
    let prev = hashLattice(1, 1, 0);
    for (let k = 1; k < 50; k++) {
      const v = hashLattice(1, 1, k);
      if (v !== prev) distinct++;
      prev = v;
    }
    expect(distinct).toBeGreaterThan(40);
  });
});

describe("tessera dolly cycle: shape and period", () => {
  it("starts far (1) and ends the hold-far leg still at 1, one full period later", () => {
    expect(dollyCycle(0)).toBeCloseTo(1, 6);
    expect(dollyCycle(DOLLY_PERIOD_SEC - 0.01)).toBeCloseTo(1, 2);
    expect(dollyCycle(DOLLY_PERIOD_SEC)).toBeCloseTo(dollyCycle(0), 6);
  });

  it("reaches near (0) partway through the out leg and holds there", () => {
    expect(dollyCycle(DOLLY_OUT_SEC)).toBeCloseTo(0, 6);
    expect(dollyCycle(DOLLY_OUT_SEC + DOLLY_HOLD_NEAR_SEC / 2)).toBeCloseTo(0, 6);
  });

  it("is back at far (1) after the in leg and holds through the far leg", () => {
    const backAtFar = DOLLY_OUT_SEC + DOLLY_HOLD_NEAR_SEC + DOLLY_IN_SEC;
    expect(dollyCycle(backAtFar)).toBeCloseTo(1, 6);
    expect(dollyCycle(backAtFar + DOLLY_HOLD_FAR_SEC / 2)).toBeCloseTo(1, 6);
  });

  it("is periodic with period DOLLY_PERIOD_SEC and stays within [0,1]", () => {
    for (let t = -30; t <= 60; t += 1.3) {
      const v = dollyCycle(t);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(-1e-9);
      expect(v).toBeLessThanOrEqual(1 + 1e-9);
      expect(dollyCycle(t)).toBeCloseTo(dollyCycle(t + DOLLY_PERIOD_SEC), 6);
    }
  });

  it("monotonically falls across the out leg and rises across the in leg", () => {
    let prev = dollyCycle(0);
    for (let t = 0.1; t <= DOLLY_OUT_SEC; t += 0.1) {
      const v = dollyCycle(t);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
    const inStart = DOLLY_OUT_SEC + DOLLY_HOLD_NEAR_SEC;
    prev = dollyCycle(inStart);
    for (let t = inStart + 0.1; t <= inStart + DOLLY_IN_SEC; t += 0.1) {
      const v = dollyCycle(t);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });
});

describe("tessera effective dolly", () => {
  it("with drift off, is exactly the manual setting, clamped to [0,1]", () => {
    expect(effectiveDolly(0, false, 12.3)).toBeCloseTo(0, 10);
    expect(effectiveDolly(0.5, false, 999)).toBeCloseTo(0.5, 10);
    expect(effectiveDolly(1, false, 0)).toBeCloseTo(1, 10);
  });

  it("with drift on and dolly at its default 0, follows dollyCycle exactly", () => {
    for (const t of [0, 3, DOLLY_OUT_SEC, 20]) {
      expect(effectiveDolly(0, true, t)).toBeCloseTo(dollyCycle(t), 10);
    }
  });

  it("drift's cycle adds on top of a nonzero manual setting, clamped", () => {
    expect(effectiveDolly(0.9, true, 0)).toBeCloseTo(1, 10); // 0.9 + 1 clamped
    expect(effectiveDolly(0.1, true, DOLLY_OUT_SEC)).toBeCloseTo(0.1, 10); // 0.1 + 0
  });
});

describe("tessera hue clock", () => {
  it("holds (barely moves) through many frames of true silence (sectionIntensity 0)", () => {
    const st = createHueClockState();
    let v = 0;
    for (let i = 0; i < 600; i++) v = advanceHueClock(st, 1 / 60, 0, 0, (i % 240) / 240, 0.4);
    expect(v).toBeCloseTo(0, 6);
  });

  it("advances continuously (not by bar-wrap jumps) while unlocked, proportional to rate", () => {
    const st = createHueClockState();
    let v = 0;
    // tempoLock stays 0 (unlocked) the whole time regardless of rate.
    for (let i = 0; i < 300; i++) v = advanceHueClock(st, 1 / 60, 1, 0, 0.5, 0.4);
    expect(v).toBeGreaterThan(0);
  });

  it("once locked and fast, steps by exactly one turn per bar wrap (slewing there, never jumping past it)", () => {
    const st = createHueClockState();
    const dt = 1 / 60;
    const bpm = 117.5;
    const barSec = (60 / bpm) * 4;
    let barPhase = 0;
    let v = 0;
    let lastStepMagnitude = 0;
    let maxStep = 0;
    for (let i = 0; i < Math.round((barSec * 6) / dt); i++) {
      barPhase = (barPhase + dt / barSec) % 1;
      const nv = advanceHueClock(st, dt, 1, 1, barPhase, 0.5); // hueRate well above HUE_FAST_RATE at sectionIntensity 1
      lastStepMagnitude = Math.abs(nv - v);
      maxStep = Math.max(maxStep, lastStepMagnitude);
      v = nv;
    }
    // Roughly one turn per bar over six bars -- not exactly on-target every
    // instant (it slews), but clearly tracking, not stuck near 0.
    expect(v).toBeGreaterThan(4);
    expect(v).toBeLessThan(7);
    // "Never jumps": no single frame moves the value by anywhere near a full turn.
    expect(maxStep).toBeLessThan(0.2);
  });

  it("switching from the free-running regime to the locked+fast one never jumps the displayed value", () => {
    const st = createHueClockState();
    const dt = 1 / 30;
    let v = 0;
    let maxStep = 0;
    for (let i = 0; i < 400; i++) {
      const locked = i > 200 ? 1 : 0;
      const barPhase = (i * 0.02) % 1;
      const nv = advanceHueClock(st, dt, 1, locked, barPhase, 0.6);
      maxStep = Math.max(maxStep, Math.abs(nv - v));
      v = nv;
    }
    expect(maxStep).toBeLessThan(0.15);
  });

  it("HUE_FAST_RATE and HUE_LOCK_THRESHOLD are both inside (0,1) -- sane gates", () => {
    expect(HUE_FAST_RATE).toBeGreaterThan(0);
    expect(HUE_FAST_RATE).toBeLessThan(1);
    expect(HUE_LOCK_THRESHOLD).toBeGreaterThan(0);
    expect(HUE_LOCK_THRESHOLD).toBeLessThanOrEqual(1);
  });
});

describe("tessera camera", () => {
  it("a pole-tip point projects to the screen centre, at any roll", () => {
    const focal = focalFromFovDeg(75);
    for (const roll of [0, 0.7, Math.PI, -1.3]) {
      const cam = cameraBasis(2, roll);
      const p = project([0, BALL_RADIUS, 0], cam, focal, 1);
      expect(p.x).toBeCloseTo(0, 8);
      expect(p.y).toBeCloseTo(0, 8);
      expect(p.z).toBeGreaterThan(0); // in front of the camera
    }
  });

  it("camera basis stays orthonormal and right-handed at any roll", () => {
    for (const roll of [0, 0.3, 1.9, -2.4]) {
      const cam = cameraBasis(2.5, roll);
      const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      expect(dot(cam.right, cam.up)).toBeCloseTo(0, 8);
      expect(dot(cam.right, cam.fwd)).toBeCloseTo(0, 8);
      expect(dot(cam.up, cam.fwd)).toBeCloseTo(0, 8);
      expect(Math.hypot(...cam.right)).toBeCloseTo(1, 8);
      expect(Math.hypot(...cam.up)).toBeCloseTo(1, 8);
    }
  });

  it("camDistanceForDolly spans CAM_NEAR..CAM_FAR, monotonically", () => {
    expect(camDistanceForDolly(0)).toBeCloseTo(CAM_NEAR, 10);
    expect(camDistanceForDolly(1)).toBeCloseTo(CAM_FAR, 10);
    let prev = camDistanceForDolly(0);
    for (let d = 0.05; d <= 1; d += 0.05) {
      const v = camDistanceForDolly(d);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  it("ball radius on screen is comfortably inside the frame at dolly 1 (far/dome) -- screenBallRadius measures the bare BALL_RADIUS sphere, so this undercounts the dome's own visible edge (the boxes' own length reaches further out), but it must still land well under the near view's >1", () => {
    const focal = focalFromFovDeg(90); // the scene's own default FOV
    const r = screenBallRadius(CAM_FAR, BALL_RADIUS, focal);
    expect(r).toBeGreaterThan(0.1);
    expect(r).toBeLessThan(0.5);
  });

  it("ball radius on screen is well past the frame edge (>1) at dolly 0 (near/starburst), once a moderate box length is counted -- round 2's boxes are much smaller than round 1's (lenBase/lenAudio both shrank), so CAM_NEAR sits close to the ball; a margin of BALL_RADIUS + 0.6 (well above the default lenBase+lenAudio*lobe peak) still clears the frame comfortably", () => {
    const focal = focalFromFovDeg(90);
    const effectiveRadius = BALL_RADIUS + 0.6;
    const r = screenBallRadius(CAM_NEAR, effectiveRadius, focal);
    expect(r).toBeGreaterThan(1);
  });

  it("the pole box's screen width at Dolly 0 is close to the measured ~0.07 half-heights", () => {
    const focal = focalFromFovDeg(90);
    const poleY = BALL_RADIUS + POLE_LEN / 2;
    const width = (2 * focal * POLE_HALF) / (CAM_NEAR - poleY);
    expect(width).toBeGreaterThan(0.04);
    expect(width).toBeLessThan(0.1);
  });

  it("screenBallRadius shrinks as distance grows", () => {
    const focal = focalFromFovDeg(90);
    let prev = screenBallRadius(CAM_NEAR, BALL_RADIUS, focal);
    for (let d = CAM_NEAR + 0.1; d <= CAM_FAR; d += 0.1) {
      const r = screenBallRadius(d, BALL_RADIUS, focal);
      expect(r).toBeLessThan(prev);
      prev = r;
    }
  });

  it("focalFromFovDeg is monotonically decreasing in fov (wider fov = smaller focal)", () => {
    expect(focalFromFovDeg(40)).toBeGreaterThan(focalFromFovDeg(110));
  });
});
