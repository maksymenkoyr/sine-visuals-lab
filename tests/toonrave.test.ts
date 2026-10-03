import {
  describe as describeConductor,
  it as itConductor,
  expect as expectConductor,
} from "vitest";
import {
  createConductor,
  type ConductorInput,
} from "../src/render/scenes/toonrave/conductor.ts";

describeConductor("toonrave conductor", () => {
  const FPS = 60;
  const mk = (
    t: number,
    bpm: number,
    lock: number,
    beats: number,
    drop = false,
  ): ConductorInput => ({
    timeSec: t,
    dtSec: 1 / FPS,
    beats,
    beatPhase: beats - Math.floor(beats),
    barPhase: beats / 4 - Math.floor(beats / 4),
    tempoLock: lock,
    bpm,
    dropFired: drop,
  });

  itConductor("a steady locked tempo advances c by 1 per beat and wraps", () => {
    const k = createConductor();
    const bpm = 120;
    let prev = -1;
    let wraps = 0;
    for (let i = 0; i <= FPS * 20; i++) {
      const t = i / FPS;
      const beats = (t * bpm) / 60;
      const o = k.step(mk(t, bpm, 1, beats), 32);
      expectConductor(o.c).toBeCloseTo(beats % 32, 6);
      expectConductor(o.locked).toBe(true);
      if (o.c < prev) wraps++;
      prev = o.c;
    }
    expectConductor(wraps).toBe(1);
  });

  itConductor("losing and regaining the lock keeps c continuous", () => {
    const k = createConductor();
    const bpm = 120;
    const perFrame = bpm / 60 / FPS;
    let prev = 0;
    let maxStep = 0;
    let minStep = Infinity;
    let c0 = -1;
    for (let i = 0; i <= FPS * 40; i++) {
      const t = i / FPS;
      const beats = (t * bpm) / 60;
      const lock = t >= 5 && t < 12 ? 0 : 1;
      const o = k.step(mk(t, lock ? bpm : 0, lock, beats), 64);
      if (i > 0) {
        const d = o.c - prev;
        if (d > -30) {
          maxStep = Math.max(maxStep, d);
          minStep = Math.min(minStep, d);
        }
      } else c0 = o.c;
      prev = o.c;
    }
    expectConductor(c0).toBe(0);
    expectConductor(minStep).toBeGreaterThanOrEqual(-1e-9);
    expectConductor(maxStep).toBeLessThanOrEqual(perFrame * 1.5 + 1e-9);
  });

  itConductor("free-runs at the last good bpm while unlocked", () => {
    const k = createConductor();
    let o = k.step(mk(0, 100, 1, 0), 32);
    for (let i = 1; i <= FPS * 6; i++) {
      o = k.step(mk(i / FPS, 0, 0, i / FPS), 32);
    }
    expectConductor(o.bpm).toBe(100);
    expectConductor(o.locked).toBe(false);
    expectConductor(o.c).toBeCloseTo(10, 4);
  });

  itConductor("dropFired resets c to 0", () => {
    const k = createConductor();
    const bpm = 120;
    let o = k.step(mk(0, bpm, 1, 0), 32);
    for (let i = 1; i <= FPS * 10; i++) {
      const t = i / FPS;
      o = k.step(mk(t, bpm, 1, (t * bpm) / 60), 32);
    }
    expectConductor(o.c).toBeGreaterThan(5);
    // Fired a frame after beat 20: the cycle starts on that whole beat, so c
    // is the one frame of beats already elapsed.
    const t = 10 + 1 / FPS;
    o = k.step(mk(t, bpm, 1, (t * bpm) / 60, true), 32);
    expectConductor(o.c).toBeCloseTo(bpm / 60 / FPS, 6);
    const t2 = t + 1 / FPS;
    o = k.step(mk(t2, bpm, 1, (t2 * bpm) / 60), 32);
    expectConductor(o.c).toBeGreaterThanOrEqual(0);
    expectConductor(o.c).toBeLessThan(0.1);
  });

  itConductor("a second dropFired within 8 bars is ignored", () => {
    const k = createConductor();
    const bpm = 120;
    let t = 0;
    let o = k.step(mk(t, bpm, 1, 0, true), 128);
    expectConductor(o.c).toBeCloseTo(0, 6);
    // 5 s = 10 beats later: ignored.
    for (let i = 1; i <= FPS * 5; i++) {
      t = i / FPS;
      o = k.step(mk(t, bpm, 1, (t * bpm) / 60), 128);
    }
    const before = o.c;
    t += 1 / FPS;
    o = k.step(mk(t, bpm, 1, (t * bpm) / 60, true), 128);
    expectConductor(o.c).toBeGreaterThan(before);
    // 8 bars = 16 s after the first: accepted.
    for (; t < 17; t += 1 / FPS) {
      o = k.step(mk(t, bpm, 1, (t * bpm) / 60), 128);
    }
    o = k.step(mk(t, bpm, 1, (t * bpm) / 60, true), 128);
    expectConductor(o.c).toBeCloseTo(0, 6);
  });
});

import { createHash } from "node:crypto";
import {
  describe as describeArt,
  it as itArt,
  expect as expectArt,
} from "vitest";
import { buildSceneSvg } from "../src/render/scenes/toonrave/art/scene.ts";

describeArt("toonrave art", () => {
  // The SHA-256 of the prototype builder's output. It was made by concatenating the prototype's
  // src/lib.js, room.js and cast.js plus the page assembly from its src/app.js ("build the SVG":
  // the world list, the two impact filters, the <svg> template) and running that under node `vm`
  // with no DOM, then hashing the resulting <svg> string as UTF-8.
  const PROTOTYPE_SHA256 =
    "79f7e432cdaa642e555b2c6908b646c340bbb78ccd5cf0d12c8a057ff57828b2";

  itArt("buildSceneSvg is deterministic", () => {
    expectArt(buildSceneSvg()).toBe(buildSceneSvg());
  });

  itArt("buildSceneSvg matches the prototype builder's output byte for byte", () => {
    const hash = createHash("sha256")
      .update(buildSceneSvg(), "utf8")
      .digest("hex");
    expectArt(hash).toBe(PROTOTYPE_SHA256);
  });
});

// ---- Step 2: the motion module (motion.ts) -------------------------------------------------
import {
  describe as describeMotion,
  it as itMotion,
  expect as expectMotion,
} from "vitest";
import {
  cameraMatrix,
  cutPlan,
  frameAt,
  stepsPerBeat,
  type Mat,
  type MotionOpts,
} from "../src/render/scenes/toonrave/motion.ts";
import { GOLDEN } from "./toonraveMotion.golden.ts";

describeMotion("toonrave motion", () => {
  const CYCLES = [32, 64, 128] as const;
  const CUTS = [0, 1, 2, 3] as const;
  const closeArr = (got: ArrayLike<number>, want: number[], what: string) => {
    expectMotion(got.length, what).toBe(want.length);
    for (let i = 0; i < want.length; i++) expectMotion(got[i]!, `${what}[${i}]`).toBeCloseTo(want[i]!, 4);
  };

  itMotion("equals the prototype's frame() at the golden positions (32-beat cycle)", () => {
    for (const g of GOLDEN) {
      const opts: MotionOpts = { cycleBeats: 32, cuts: g.cuts, bpm: g.bpm, cycle: g.cycle };
      const F = frameAt(g.c, opts);
      const at = `${g.name} (c=${g.c}, cuts=${g.cuts}, bpm=${g.bpm}, cycle=${g.cycle})`;
      expectMotion(Object.keys(F.x).sort(), `${at} x keys`).toEqual(Object.keys(g.f.x).sort());
      for (const id in g.f.x) closeArr(F.x[id]!, g.f.x[id]!, `${at} x.${id}`);
      expectMotion(Object.keys(F.o).sort(), `${at} o keys`).toEqual(Object.keys(g.f.o).sort());
      for (const id in g.f.o) expectMotion(F.o[id]!, `${at} o.${id}`).toBeCloseTo(g.f.o[id]!, 4);
      expectMotion(F.cel, `${at} cel`).toEqual(g.f.cel);
      expectMotion(F.cls, `${at} cls`).toEqual(g.f.cls);
      expectMotion(F.slot, `${at} slot`).toEqual(g.f.slot);
      expectMotion(F.led, `${at} led`).toEqual(g.f.led);
      expectMotion(F.rayOp, `${at} rayOp`).toBeCloseTo(g.f.rayOp, 4);
      expectMotion(F.camera.shot, `${at} shot`).toBe(g.f.shot);
      closeArr(cameraMatrix(F.camera), g.f.cam, `${at} camera`);
      const filter = F.impact > 0 ? (F.impactInvert ? "impactB" : "impactA") : "";
      expectMotion(filter, `${at} filter`).toBe(g.f.filter);
    }
  });

  itMotion("covers the hero frame, the impact pair and the pompadour landing", () => {
    const names = GOLDEN.map((g) => g.name);
    for (const n of ["drop +0", "impact first half", "impact second half", "drop +2 frames", "pompadour lands c8", "c8.4", "c15.3", "c17"]) {
      expectMotion(names).toContain(n);
    }
    const opts: MotionOpts = { cycleBeats: 32, cuts: 2, bpm: 128 };
    expectMotion(frameAt(0, opts).impact).toBe(1);
    expectMotion(frameAt(0, opts).impactInvert).toBe(false);
    expectMotion(frameAt(0.05, opts).impactInvert).toBe(true);
    expectMotion(frameAt(0.0711, opts).impact).toBe(0);
    // the hero frame is the still: wide, no shake, the full frame
    const hero = frameAt(0.3, opts).camera;
    expectMotion(hero.shot).toBe("wide");
    expectMotion(hero.src).toEqual({ x: 0, y: 0, w: 1600, h: 900 });
    expectMotion(hero.shake).toEqual({ x: 0, y: 0, rot: 0 });
  });

  itMotion("is periodic in the cycle for every length and cuts level", () => {
    for (const cycleBeats of CYCLES) {
      for (const cuts of CUTS) {
        const opts: MotionOpts = { cycleBeats, cuts, bpm: 120, cycle: 2 };
        for (let i = 0; i < 40; i++) {
          const c = (i * 7.31) % cycleBeats;
          expectMotion(frameAt(c + cycleBeats, opts), `${cycleBeats}/${cuts} c=${c}`).toEqual(frameAt(c, opts));
        }
      }
    }
  });

  itMotion("never repeats a shot back to back, and the drop is always wide, over 40 cycles", () => {
    for (const cycleBeats of CYCLES) {
      for (const cuts of CUTS) {
        let lastOfPrev: string | null = null;
        for (let cycle = 0; cycle < 40; cycle++) {
          const opts: MotionOpts = { cycleBeats, cuts, bpm: 128, cycle };
          const at = `${cycleBeats}/${cuts} cycle ${cycle}`;
          const plan = cutPlan(cycle, cuts, cycleBeats);
          expectMotion(plan[0], `${at} first cut`).toEqual([0, "wide"]);
          expectMotion(frameAt(0, opts).camera.shot, `${at} drop`).toBe("wide");
          for (let i = 1; i < plan.length; i++) {
            expectMotion(plan[i]![0], `${at} cuts ascend`).toBeGreaterThan(plan[i - 1]![0]);
            expectMotion(plan[i]![0], `${at} cuts inside the cycle`).toBeLessThan(cycleBeats);
            expectMotion(plan[i]![1], `${at} cut ${i} repeats the shot before`).not.toBe(plan[i - 1]![1]);
          }
          // across the wrap: the last shot of the previous cycle is not this cycle's first
          if (cuts > 0 && lastOfPrev !== null) expectMotion(plan[0]![1], `${at} wrap`).not.toBe(lastOfPrev);
          lastOfPrev = plan[plan.length - 1]![1];
          // and the picture follows the plan: each cut lands on its beat
          for (let i = 0; i < plan.length; i++) {
            expectMotion(frameAt(plan[i]![0], opts).camera.shot, `${at} at cut ${i}`).toBe(plan[i]![1]);
            if (i > 0) expectMotion(frameAt(plan[i]![0] - 0.01, opts).camera.shot, `${at} before cut ${i}`).toBe(plan[i - 1]![1]);
          }
          expectMotion(frameAt(cycleBeats - 0.01, opts).camera.shot, `${at} last shot`).toBe(plan[plan.length - 1]![1]);
        }
      }
    }
  });

  itMotion("cuts every 4, 2 and 1 bars in the groove, and holds wide at cuts 0", () => {
    for (const cycleBeats of CYCLES) {
      const groove = (cuts: number) => cutPlan(0, cuts, cycleBeats).filter(([t]) => t >= 16 && t < cycleBeats - 8);
      expectMotion(cutPlan(0, 0, cycleBeats)).toEqual([[0, "wide"]]);
      for (const [cuts, period] of [[1, 16], [2, 8], [3, 4]] as const) {
        const g = groove(cuts);
        expectMotion(g.length).toBe(Math.ceil((cycleBeats - 8 - 16) / period));
        g.forEach(([t], i) => expectMotion(t).toBe(16 + i * period));
      }
      for (let c = 0; c < cycleBeats; c += 0.25) expectMotion(frameAt(c, { cycleBeats, cuts: 0, bpm: 128 }).camera.shot).toBe("wide");
    }
  });

  itMotion("the build is the last eight beats of any cycle", () => {
    // the pose code's build runs the same on any length, so the end of a longer
    // cycle matches the 32-beat cycle's end
    for (const cycleBeats of CYCLES) {
      for (const rel of [0.5, 2.25, 3.9, 5, 6.5, 7.9]) {
        const a = frameAt(24 + rel, { cycleBeats: 32, cuts: 2, bpm: 128 });
        const b = frameAt(cycleBeats - 8 + rel, { cycleBeats, cuts: 2, bpm: 128 });
        closeArr(b.x.dj!, a.x.dj!, `dj ${cycleBeats}/${rel}`);
        expectMotion(b.cel, `cels ${cycleBeats}/${rel}`).toEqual(a.cel);
        expectMotion(b.o.btnGlow).toBeCloseTo(a.o.btnGlow!, 9);
        expectMotion(b.rayOp).toBe(a.rayOp);
      }
    }
  });

  itMotion("a longer groove keeps dancing on the beat (finite numbers, varied poses)", () => {
    const opts: MotionOpts = { cycleBeats: 128, cuts: 2, bpm: 128 };
    const seen = new Set<string>();
    for (let q = 0; q < 128 * 8; q++) {
      const F = frameAt(q / 8, opts);
      for (const id in F.x) for (const v of F.x[id]!) if (!Number.isFinite(v)) throw new Error(`${id} at ${q / 8}`);
      for (const id in F.o) if (!Number.isFinite(F.o[id]!)) throw new Error(`${id} at ${q / 8}`);
      if (q / 8 >= 16 && q / 8 < 120) seen.add(`${F.cel.raverTorso}/${F.cel.djTorso}`);
    }
    expectMotion(seen.size).toBeGreaterThan(3);
  });

  itMotion("characters step on twos; lights and the camera run continuously", () => {
    const bpm = 128, spb = stepsPerBeat(bpm), opts: MotionOpts = { cycleBeats: 32, cuts: 2, bpm };
    expectMotion(spb).toBe(6);
    // two positions inside one step: the same character pose
    const a = frameAt(20.02, opts), b = frameAt(20.02 + 0.4 / spb, opts);
    expectMotion(b.x.dj).toEqual(a.x.dj);
    expectMotion(b.x.kid).toEqual(a.x.kid);
    // but the lasers and the camera moved
    expectMotion(b.x.laser0).not.toEqual(a.x.laser0);
    expectMotion(cameraMatrix(b.camera)).not.toEqual(cameraMatrix(a.camera));
    // the next step changes the pose
    expectMotion(frameAt(20 + 1 / spb + 0.01, opts).x.dj).not.toEqual(a.x.dj);
  });

  itMotion("reduced motion drops the shake and the impact frame", () => {
    const opts: MotionOpts = { cycleBeats: 32, cuts: 2, bpm: 128, reduced: true };
    expectMotion(frameAt(0.02, opts).impact).toBe(0);
    expectMotion(frameAt(30, opts).camera.shake).toEqual({ x: 0, y: 0, rot: 0 });
    expectMotion(frameAt(30, { ...opts, reduced: false }).camera.shake.x).not.toBe(0);
  });

  itMotion("cameraMatrix composes the source rectangle and the shake", () => {
    const id: Mat = [1, 0, 0, 1, 0, 0];
    closeArr(cameraMatrix({ shot: "wide", src: { x: 0, y: 0, w: 1600, h: 900 }, shake: { x: 0, y: 0, rot: 0 } }), id, "identity");
    // a half-size source in the top-left corner maps its corner to the origin at 2x
    closeArr(cameraMatrix({ shot: "dj", src: { x: 0, y: 0, w: 800, h: 450 }, shake: { x: 0, y: 0, rot: 0 } }), [2, 0, 0, 2, 0, 0], "crop");
    closeArr(cameraMatrix({ shot: "wide", src: { x: 0, y: 0, w: 1600, h: 900 }, shake: { x: 5, y: -3, rot: 0 } }), [1, 0, 0, 1, 5, -3], "shake");
  });
});
