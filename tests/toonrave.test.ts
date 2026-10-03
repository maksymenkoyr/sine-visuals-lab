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

  itConductor("the first lock after reset snaps to the bar line instead of slewing", () => {
    const k = createConductor();
    const bpm = 128;
    // free-run 3.3 s (not on any bar), then the lock arrives mid-bar
    let t = 0;
    let o = k.step(mk(t, bpm, 0, 0), 32);
    for (let i = 0; i < 200; i++) {
      t += 1 / FPS;
      o = k.step(mk(t, bpm, 0, 0), 32);
    }
    const beatsAtLock = 77.37; // 1.37 beats into a bar
    t += 1 / FPS;
    o = k.step(mk(t, bpm, 1, beatsAtLock), 32);
    // c sits on the bar grid: (beats - c) is a whole number of bars
    const off = (c: number, beats: number): number => {
      const r = (((beats - c) % 4) + 4) % 4;
      return Math.min(r, 4 - r);
    };
    expectConductor(off(o.c, beatsAtLock)).toBeLessThan(1e-6);
    // and it stays on the grid: no slew leaves it drifting afterwards
    let beats = beatsAtLock;
    for (let i = 0; i < 120; i++) {
      t += 1 / FPS;
      beats += bpm / 60 / FPS;
      o = k.step(mk(t, bpm, 1, beats), 32);
      expectConductor(off(o.c, beats)).toBeLessThan(1e-6);
    }
  });

  itConductor("a lock regained after the first 8 s still slews, not snaps", () => {
    const k = createConductor();
    const bpm = 120;
    let t = 0;
    let beats = 0;
    for (let i = 0; i < 20 * FPS; i++) {
      t += 1 / FPS;
      beats += bpm / 60 / FPS;
      k.step(mk(t, bpm, 1, beats), 32);
    }
    for (let i = 0; i < 3 * FPS; i++) {
      t += 1 / FPS;
      k.step(mk(t, bpm, 0, beats), 32);
    }
    let prev = k.step(mk(t, bpm, 0, beats), 32).c;
    let maxStep = 0;
    for (let i = 0; i < 4 * FPS; i++) {
      t += 1 / FPS;
      beats += (0.37 * bpm) / 60 / FPS; // the clock drifts off the free-run
      const c = k.step(mk(t, bpm, 1, beats), 32).c;
      maxStep = Math.max(maxStep, Math.abs(c - prev));
      prev = c;
    }
    expectConductor(maxStep).toBeLessThan(0.1);
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
          for (let i = 1; i < plan.length; i++) {
            expectMotion(plan[i]![0], `${at} cuts ascend`).toBeGreaterThan(plan[i - 1]![0]);
            expectMotion(plan[i]![0], `${at} cuts inside the cycle`).toBeLessThan(cycleBeats);
            expectMotion(plan[i]![1], `${at} cut ${i} repeats the shot before`).not.toBe(plan[i - 1]![1]);
          }
          // across the wrap: the last shot of the previous cycle is not this cycle's first
          if (cuts > 0 && lastOfPrev !== null) expectMotion(plan[0]![1], `${at} wrap`).not.toBe(lastOfPrev);
          lastOfPrev = plan[plan.length - 1]![1];
          // and the picture follows the plan: each cut lands on its beat. Three
          // cycles show the camera obeys the plan; the plan checks above run on all 40.
          if (cycle >= 3) continue;
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

import {
  describe as describeDraw,
  it as itDraw,
  expect as expectDraw,
} from "vitest";
import {
  boxesOverlap,
  colorWithOpacity,
  mulMat,
  parseFraction,
  parseStyle,
  parseTransform,
  roundRectPath,
  roundedOpacity,
  transformBox,
  unionBox,
} from "../src/render/scenes/toonrave/svgDraw.ts";

describeDraw("toonrave svgDraw helpers", () => {
  const close = (a: number[], b: number[]) => {
    expectDraw(a.length).toBe(b.length);
    a.forEach((v, i) => expectDraw(v).toBeCloseTo(b[i], 6));
  };

  itDraw("parses the transform forms the art uses", () => {
    close(parseTransform("matrix(0.834465 0.337146 -0.337146 0.834465 379.166434 -297.018487)"), [0.834465, 0.337146, -0.337146, 0.834465, 379.166434, -297.018487]);
    close(parseTransform("translate(140,-4)"), [1, 0, 0, 1, 140, -4]);
    close(parseTransform("translate(7)"), [1, 0, 0, 1, 7, 0]);
    close(parseTransform("scale(2)"), [2, 0, 0, 2, 0, 0]);
    close(parseTransform(""), [1, 0, 0, 1, 0, 0]);
    close(parseTransform(null), [1, 0, 0, 1, 0, 0]);
  });

  itDraw("rotates about a point, in either separator style", () => {
    // 90 degrees about (10, 0) sends (0, 0) to (10, -10) and (10, 5) to (5, 0)
    for (const s of ["rotate(90 10 0)", "rotate(90,10,0)"]) {
      const m = parseTransform(s);
      close([m[4], m[5]], [10, -10]);
      close([m[0] * 10 + m[2] * 5 + m[4], m[1] * 10 + m[3] * 5 + m[5]], [5, 0]);
    }
    const r = parseTransform("rotate(-10 902.7 529)");
    const rad = -Math.PI / 18;
    close([r[0], r[1], r[2], r[3]], [Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad)]);
    // the fixed point stays put
    close([r[0] * 902.7 + r[2] * 529 + r[4], r[1] * 902.7 + r[3] * 529 + r[5]], [902.7, 529]);
  });

  itDraw("chains the world transform in order", () => {
    const world = parseTransform("rotate(-7,800,450) translate(800,450) scale(1.1) translate(-800,-450)");
    // the centre of the art maps to itself, and the chain equals the product of its parts
    close([world[0] * 800 + world[2] * 450 + world[4], world[1] * 800 + world[3] * 450 + world[5]], [800, 450]);
    const rot = parseTransform("rotate(-7,800,450)");
    const rest = parseTransform("translate(800,450) scale(1.1) translate(-800,-450)");
    close(world, mulMat(rot, rest));
  });

  itDraw("rejects a transform function it does not know", () => {
    expectDraw(() => parseTransform("perspective(4)")).toThrow();
    expectDraw(() => parseTransform("matrix(1 2 3)")).toThrow();
  });

  itDraw("parses style strings", () => {
    expectDraw(parseStyle("display:none")).toEqual({ display: "none" });
    expectDraw(parseStyle("mix-blend-mode:screen")).toEqual({ "mix-blend-mode": "screen" });
    expectDraw(parseStyle(" Opacity : .5 ;display:none; ")).toEqual({ opacity: ".5", display: "none" });
    expectDraw(parseStyle("")).toEqual({});
    expectDraw(parseStyle(null)).toEqual({});
  });

  itDraw("reads fractions, colours, opacities and rounded rects", () => {
    expectDraw(parseFraction("50%", 0)).toBe(0.5);
    expectDraw(parseFraction("0.25", 0)).toBe(0.25);
    expectDraw(parseFraction(null, 0.5)).toBe(0.5);
    expectDraw(colorWithOpacity("#ff4fb6", 0.5)).toBe("rgba(255,79,182,0.5)");
    expectDraw(colorWithOpacity("#f80", 1)).toBe("rgba(255,136,0,1)");
    expectDraw(colorWithOpacity("red", 0.5)).toBe("red");
    expectDraw(roundedOpacity(0.99949)).toBe(1);
    expectDraw(roundedOpacity(0.5)).toBe(0.5);
    expectDraw(roundedOpacity(0.12345)).toBe(0.123);
    expectDraw(roundRectPath(0, 0, 10, 20, null, null)).toBe("M0,0h10v20h-10z");
    // rx clamps to half the width
    expectDraw(roundRectPath(0, 0, 10, 20, 100, null)).toContain("A5,10 ");
  });

  itDraw("boxes: transform, union and overlap", () => {
    const b = transformBox([0, 0, 10, 20], [0, 1, -1, 0, 5, 5]); // a quarter turn
    close(b, [-15, 5, 5, 15]);
    close(unionBox(null, [1, 2, 3, 4]), [1, 2, 3, 4]);
    close(unionBox([0, 0, 1, 1], [2, 2, 3, 3]), [0, 0, 3, 3]);
    expectDraw(boxesOverlap([0, 0, 2, 2], [1, 1, 3, 3])).toBe(true);
    expectDraw(boxesOverlap([0, 0, 2, 2], [2, 0, 4, 2])).toBe(false);
    expectDraw(boxesOverlap([0, 0, 1, 1], [5, 5, 6, 6])).toBe(false);
  });
});

// --- step 5: the scene --------------------------------------------------------------------------

import {
  describe as describeScene,
  it as itScene,
  expect as expectScene,
} from "vitest";
import {
  toonraveScene,
  shapeState,
  coverView,
  canvasSize,
  DROP_CYCLE_BEATS,
  CAST_RIGS,
  HERO_C,
} from "../src/render/scenes/toonrave/index.ts";
import { clampCentre, frameFocus } from "../src/render/scenes/toonrave/focus.ts";
import { cutPlan as cutPlanScene } from "../src/render/scenes/toonrave/motion.ts";
import { buildPostFrag } from "../src/render/scenes/toonrave/glsl.ts";
import { frameAt as sceneFrameAt } from "../src/render/scenes/toonrave/motion.ts";
import { SETTING_GROUPS } from "../src/render/sceneSettings.ts";

describeScene("toonrave settings", () => {
  const settings = toonraveScene.settings ?? [];
  const byKey = (k: string) => settings.find((s) => s.key === k)!;

  itScene("groups are all set and in SETTING_GROUPS order", () => {
    const order = settings.map((s) => SETTING_GROUPS.indexOf(s.group as (typeof SETTING_GROUPS)[number]));
    expectScene(order.every((i) => i >= 0)).toBe(true);
    expectScene(order).toEqual([...order].sort((a, b) => a - b));
    expectScene(settings.map((s) => s.group)).toEqual(["Motion", "Motion", "Motion", "Look", "Camera", "Camera", "Post"]);
  });

  itScene("no setting has auto or macro", () => {
    for (const s of settings) {
      expectScene(s.auto, s.key).toBeUndefined();
      expectScene(s.macro, s.key).toBeUndefined();
    }
  });

  itScene("defaults sit inside their ranges", () => {
    for (const s of settings) {
      expectScene(s.default, s.key).toBeGreaterThanOrEqual(s.min);
      expectScene(s.default, s.key).toBeLessThanOrEqual(s.max);
    }
    expectScene(byKey("bounce").default).toBe(1);
    expectScene(byKey("lights").default).toBe(1);
    expectScene(byKey("shake").default).toBe(1);
    expectScene(byKey("cuts").default).toBe(2);
    expectScene(byKey("flash").default).toBe(1);
    expectScene(byKey("dropHits").default).toBe(1);
  });

  itScene("the enum and boolean shapes are valid", () => {
    const drops = byKey("drops");
    expectScene(drops.type).toBe("enum");
    expectScene(drops.options).toEqual(["Every 32 bars", "Every 16 bars", "Every 8 bars"]);
    expectScene([drops.min, drops.max, drops.step]).toEqual([0, drops.options!.length - 1, 1]);
    expectScene(drops.options![drops.default]).toBe("Every 16 bars");
    expectScene(DROP_CYCLE_BEATS).toEqual([128, 64, 32]);
    for (const k of ["dropHits", "flash"]) {
      const s = byKey(k);
      expectScene(s.type, k).toBe("boolean");
      expectScene([s.min, s.max, s.step], k).toEqual([0, 1, 1]);
    }
    const cuts = byKey("cuts");
    expectScene([cuts.min, cuts.max, cuts.step]).toEqual([0, 3, 1]);
  });

  itScene("the reactive settings have drives, and the trigger reads the drop edge", () => {
    expectScene(byKey("bounce").drive?.default).toEqual({ source: "beat", grid: 2 });
    expectScene(byKey("lights").drive).toBeDefined();
    expectScene(byKey("dropHits").drive?.default).toBe("anim.dropOnset");
  });
});

describeScene("toonrave look shaping", () => {
  const opts = { cycleBeats: 32 as const, cuts: 0 as const, bpm: 128 };
  const at = (c: number) => sceneFrameAt(c, opts);

  itScene("all amounts at 1 leave the state exactly as frameAt made it", () => {
    const a = JSON.stringify(at(20.3));
    const s = shapeState(at(20.3), { bounce: 1, lights: 1, shake: 1 });
    expectScene(JSON.stringify(s)).toBe(a);
  });

  itScene("the hero frame is untouched by any Bounce amount", () => {
    const a = JSON.stringify(at(HERO_C).x);
    for (const bounce of [0, 0.5, 1.5]) {
      const s = shapeState(at(HERO_C), { bounce, lights: 1, shake: 1 });
      expectScene(JSON.stringify(s.x), `bounce ${bounce}`).toBe(a);
    }
  });

  itScene("Bounce 0 holds the cast in the rest pose and leaves the lights' rigs alone", () => {
    const rest = at(HERO_C).x;
    const moving = at(20.3);
    const s = shapeState(at(20.3), { bounce: 0, lights: 1, shake: 1 });
    for (const id of CAST_RIGS) expectScene(s.x[id], id).toEqual(rest[id]);
    expectScene(s.x.rays).toEqual(moving.x.rays);
    expectScene(s.x.laser0).toEqual(moving.x.laser0);
  });

  itScene("Bounce halves the motion away from the rest pose", () => {
    const rest = at(HERO_C).x;
    const moving = at(20.3).x.dj;
    const s = shapeState(at(20.3), { bounce: 0.5, lights: 1, shake: 1 });
    for (let i = 0; i < 6; i++) expectScene(s.x.dj[i]).toBeCloseTo((rest.dj[i] + moving[i]) / 2, 9);
  });

  itScene("Lights scales lasers, lamps and rays, capped at fully on, and 0 turns them off", () => {
    const base = at(20.3);
    const off = shapeState(at(20.3), { bounce: 1, lights: 0, shake: 1 });
    expectScene(off.rayOp).toBe(0);
    for (const id in off.o) {
      if (id.indexOf("lampGlow") === 0 || id.indexOf("laser") === 0) expectScene(off.o[id], id).toBe(0);
    }
    const bright = shapeState(at(20.3), { bounce: 1, lights: 1.5, shake: 1 });
    for (const id in bright.o) expectScene(bright.o[id], id).toBeLessThanOrEqual(Math.max(1, base.o[id]));
    expectScene(bright.rayOp).toBeLessThanOrEqual(1);
    // everything else is left alone
    expectScene(off.o.btnGlow).toBe(base.o.btnGlow);
  });

  itScene("Shake scales the camera's shake and nothing else of the camera", () => {
    const base = at(0.2);
    const s = shapeState(at(0.2), { bounce: 1, lights: 1, shake: 0 });
    expectScene(s.camera.shake).toEqual({ x: 0, y: 0, rot: 0 });
    expectScene(s.camera.src).toEqual(base.camera.src);
    expectScene(s.camera.shot).toBe(base.camera.shot);
    const half = shapeState(at(0.2), { bounce: 1, lights: 1, shake: 0.5 });
    expectScene(half.camera.shake.x).toBeCloseTo(base.camera.shake.x * 0.5, 9);
    expectScene(half.camera.shake.rot).toBeCloseTo(base.camera.shake.rot * 0.5, 9);
  });
});

describeScene("toonrave framing", () => {
  itScene("a 16:9 canvas on the full viewport draws the art 1:1 scaled", () => {
    const v = coverView(1600, 900, { x: 0, y: 0, w: 1, h: 1 });
    expectScene(v.scale).toBeCloseTo(1, 9);
    expectScene(v.tx).toBeCloseTo(0, 9);
    expectScene(v.ty).toBeCloseTo(0, 9);
    const half = coverView(800, 450, { x: 0, y: 0, w: 1, h: 1 });
    expectScene(half.scale).toBeCloseTo(0.5, 9);
  });

  itScene("a portrait canvas covers by height and crops the sides, centred", () => {
    const v = coverView(390, 844, { x: 0, y: 0, w: 1, h: 1 });
    expectScene(v.scale).toBeCloseTo(844 / 900, 9);
    expectScene(v.ty).toBeCloseTo(0, 9);
    expectScene(v.tx).toBeCloseTo(390 / 2 - 800 * v.scale, 9);
  });

  itScene("a wide canvas covers by width and crops top and bottom, centred", () => {
    const v = coverView(2000, 600, { x: 0, y: 0, w: 1, h: 1 });
    expectScene(v.scale).toBeCloseTo(2000 / 1600, 9);
    expectScene(v.ty).toBeCloseTo(300 - 450 * v.scale, 9);
  });

  itScene("a Panorama slice fills the canvas with its part of the art", () => {
    const v = coverView(800, 900, { x: 0.5, y: 0, w: 0.5, h: 1 });
    expectScene(v.scale).toBeCloseTo(1, 9);
    // the slice's left edge (art x = 800) lands on canvas x = 0
    expectScene(800 * v.scale + v.tx).toBeCloseTo(0, 9);
  });

  itScene("a portrait crop looks at the focus, clamped inside the frame", () => {
    const full = { x: 0, y: 0, w: 1, h: 1 };
    const vis = (900 * 390) / 844; // visible width in art units on a 390x844 canvas
    const scale = 844 / 900;
    const v = coverView(390, 844, full, { x: 450, y: 450 });
    expectScene(v.scale).toBeCloseTo(scale, 9);
    expectScene(v.tx + 450 * scale).toBeCloseTo(195, 6); // the focus sits mid-canvas
    // a focus near an edge is pushed in so the crop stays inside the frame
    expectScene(coverView(390, 844, full, { x: 10, y: 450 }).tx).toBeCloseTo(0, 6);
    expectScene(coverView(390, 844, full, { x: 1590, y: 450 }).tx).toBeCloseTo(390 - 1600 * scale, 6);
    expectScene(clampCentre(10, vis, 0, 1600)).toBeCloseTo(vis / 2, 9);
    expectScene(clampCentre(800, vis, 0, 1600)).toBe(800);
    expectScene(clampCentre(5000, vis, 0, 1600)).toBeCloseTo(1600 - vis / 2, 9);
    // a crop as long as the range is centred on it, whatever the focus
    expectScene(clampCentre(5, 900, 0, 900)).toBe(450);
    // 16:9 on the full viewport: identical to no focus at all
    expectScene(coverView(1600, 900, full, { x: 100, y: 800 })).toEqual(coverView(1600, 900, full));
    expectScene(coverView(1280, 720, full, { x: 100, y: 800 })).toEqual(coverView(1280, 720, full));
  });

  itScene("every shot's focus lands inside the frame, and the wide shot looks at the DJ", () => {
    for (const shot of ["wide", "dj", "djUp", "button", "raver", "pomp", "crowd"] as const) {
      const cut = cutPlanScene(0, 2, 32).find(([, s]) => s === shot);
      if (!cut) continue;
      const f = frameFocus(sceneFrameAt(cut[0] + 0.5, { cycleBeats: 32, cuts: 2, bpm: 128 }).camera);
      expectScene(f.x).toBeGreaterThanOrEqual(0);
      expectScene(f.x).toBeLessThanOrEqual(1600);
      expectScene(f.y).toBeGreaterThanOrEqual(0);
      expectScene(f.y).toBeLessThanOrEqual(900);
    }
    expectScene(frameFocus(sceneFrameAt(0.3, { cycleBeats: 32, cuts: 0, bpm: 128 }).camera).x).toBeLessThan(600);
  });

  itScene("canvasSize caps the width per preset and keeps the aspect", () => {
    expectScene(canvasSize(1280, 720, "high")).toEqual({ w: 1280, h: 720 });
    expectScene(canvasSize(3840, 2160, "high")).toEqual({ w: 1920, h: 1080 });
    expectScene(canvasSize(3840, 2160, "floor")).toEqual({ w: 960, h: 540 });
    expectScene(canvasSize(0, 0, "high").w).toBeGreaterThanOrEqual(2);
  });
});

describeScene("toonrave post shader", () => {
  itScene("carries the impact filters' luminance rows and both tables", () => {
    const src = buildPostFrag();
    expectScene(src).toContain("vec3(0.3, 0.59, 0.11)");
    expectScene(src).toContain("vec3(0.06, 0.01, 0.05)");
    expectScene(src).toContain("vec3(1.0, 0.18, 0.64)");
    expectScene(src).toContain("vec3(1.0, 0.93, 0.97)");
    expectScene(src.startsWith("#version 300 es")).toBe(true);
  });
});
