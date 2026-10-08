import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { buildAlienMesh, MAX_INFLUENCES } from "../src/render/scenes/alien/mesh.ts";
import { PARTS, compileSet, partDistance } from "../src/render/scenes/alien/body.ts";
import { GROUP_TUNING } from "../src/render/bandEnergy.ts";
import {
  BOUNCE_MAX,
  bounceSpring,
  clipSeconds,
  createBounce,
  createReel,
  easeSpeed,
  LOOPS,
  MIN_SHOT_SEC,
  pickOther,
  stepBounce,
  stepCut,
  type CutInput,
} from "../src/render/scenes/alien/reel.ts";
import { packSkin, projectToFrame } from "../src/render/scenes/alien/renderer.ts";
import { STANDOUT_THRESHOLD_DEFAULT } from "../src/render/standout.ts";
import { BAKED } from "../src/render/scenes/alien/loops/manifest.ts";
import { decodeClipLibrary } from "../src/render/scenes/dancers/clipFormat.ts";
import { BONE_COUNT } from "../src/render/scenes/dancers/rig.ts";

describe("alien mesh", () => {
  const mesh = buildAlienMesh();

  it("is a few tens of thousands of triangles, skinned to real bones with weights summing to one", () => {
    expect(mesh.triCount).toBeGreaterThan(10_000);
    expect(mesh.triCount).toBeLessThan(60_000);
    for (let v = 0; v < mesh.triCount * 3; v++) {
      let sum = 0;
      for (let k = 0; k < MAX_INFLUENCES; k++) {
        sum += mesh.weights[v * MAX_INFLUENCES + k];
        expect(mesh.bones[v * MAX_INFLUENCES + k]).toBeLessThan(BONE_COUNT);
      }
      expect(sum).toBe(255);
    }
  });

  it("winds nearly every triangle outward, along its vertex normals", () => {
    const p = mesh.position, n = mesh.normal;
    let against = 0;
    for (let t = 0; t < mesh.triCount; t++) {
      const o = t * 9;
      const ax = p[o + 3] - p[o], ay = p[o + 4] - p[o + 1], az = p[o + 5] - p[o + 2];
      const bx = p[o + 6] - p[o], by = p[o + 7] - p[o + 1], bz = p[o + 8] - p[o + 2];
      const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
      const dot = cx * (n[o] + n[o + 3] + n[o + 6]) + cy * (n[o + 1] + n[o + 4] + n[o + 7]) + cz * (n[o + 2] + n[o + 5] + n[o + 8]);
      if (dot < 0) against++;
    }
    expect(against / mesh.triCount).toBeLessThan(0.001);
  });

  it("puts its vertices on the surface it was sampled from", () => {
    const sets = new Map<string, ReturnType<typeof compileSet>>();
    for (const set of new Set(PARTS.map((part) => part.set))) {
      sets.set(set, compileSet(PARTS.filter((part) => part.set === set), mesh.bind));
    }
    // Every 97th vertex: its distance to the nearest set's surface is small.
    for (let v = 0; v < mesh.triCount * 3; v += 97) {
      const x = mesh.position[v * 3], y = mesh.position[v * 3 + 1], z = mesh.position[v * 3 + 2];
      const nearest = Math.min(...[...sets.values()].map((s) => Math.abs(s.sd(x, y, z))));
      expect(nearest).toBeLessThan(0.006);
    }
  });

  it("prunes no part that would change the distance", () => {
    const body = PARTS.filter((part) => part.set === "body");
    const compiled = compileSet(body, mesh.bind);
    // Unpruned union of the adds, in list order, at points around the torso.
    for (const [x, y, z] of [[0, 1.3, 0.1], [0.15, 1.6, 0], [0.4, 1.6, 0.05], [0.1, 0.5, 0.05], [0, 1.0, -0.2]]) {
      let d = Infinity;
      for (const part of body) {
        const pd = partDistance(part, mesh.bind, x, y, z);
        if (d === Infinity) d = pd;
        else {
          const k = part.blend;
          const h = k <= 0 ? (pd < d ? 0 : 1) : Math.max(0, Math.min(1, 0.5 + (0.5 * (pd - d)) / k));
          d = pd + (d - pd) * h - k * h * (1 - h);
        }
      }
      expect(compiled.sd(x, y, z)).toBeCloseTo(d, 6);
    }
  });

  it("skins the bind pose to itself", () => {
    const out = new Float32Array(BONE_COUNT * 8);
    packSkin(mesh.bind.pos, mesh.bind.rot, mesh.bind.pos, mesh.bind.rot, out);
    for (let b = 0; b < BONE_COUNT; b++) {
      expect(Math.abs(out[b * 8 + 3])).toBeCloseTo(1, 5);
      for (const i of [0, 1, 2, 4, 5, 6]) expect(out[b * 8 + i]).toBeCloseTo(0, 5);
    }
  });
});

describe("alien reel", () => {
  const input = (over: Partial<CutInput>): CutInput => ({
    dtSec: 1 / 60,
    cutOn: true,
    cutSignal: 0,
    cutThreshold: STANDOUT_THRESHOLD_DEFAULT,
    ...over,
  });
  const run = (seconds: number, fn: (dt: number) => void): void => {
    for (let i = 0; i < Math.round(seconds * 60); i++) fn(1 / 60);
  };

  it("eases the speed toward the music instead of jumping, and down to 0 in silence", () => {
    let speed = 0;
    speed = easeSpeed(speed, 1, 1 / 60);
    expect(speed).toBeGreaterThan(0);
    expect(speed).toBeLessThan(0.1);
    run(3, (dt) => (speed = easeSpeed(speed, 1, dt)));
    expect(speed).toBeCloseTo(1, 2);
    run(5, (dt) => (speed = easeSpeed(speed, 0, dt)));
    expect(speed).toBeLessThan(0.001);
  });

  it("eases the same over a second however it is sliced into frames", () => {
    let a = 0;
    let b = 0;
    run(1, (dt) => (a = easeSpeed(a, 1, dt)));
    for (let i = 0; i < 30; i++) b = easeSpeed(b, 1, 1 / 30);
    expect(a).toBeCloseTo(b, 6);
  });

  /** A hit wire's pulse (anim's 6/s decay) with hits of `h` at times `t`. */
  const pulseAt = (hits: { t: number; h: number }[], t: number): number => {
    let v = 0;
    for (const hit of hits) if (hit.t <= t) v = Math.max(v, hit.h * Math.exp(-6 * (t - hit.t)));
    return v;
  };
  /** The time of every cut over `seconds` of `signal(t)`, at 60 fps. */
  const cutTimes = (reel: ReturnType<typeof createReel>, seconds: number, signal: (t: number) => number, over: Partial<CutInput> = {}): number[] => {
    const cuts: number[] = [];
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      const t = i / 60;
      if (stepCut(reel, input({ cutSignal: signal(t), ...over }))) cuts.push(t);
    }
    return cuts;
  };

  it("keeps looping on a held level, however long, and cuts on a hit", () => {
    const reel = createReel();
    expect(cutTimes(reel, 30, () => 0.2)).toEqual([]);
    const cuts = cutTimes(reel, 1, (t) => Math.max(0.2, pulseAt([{ t: 0.5, h: 1 }], t)));
    expect(cuts).toHaveLength(1);
    expect(cuts[0]).toBeCloseTo(0.5, 1);
    expect(reel.loop).not.toBe(0);
  });

  it("never cuts twice within the minimum shot, however fast the hits", () => {
    const reel = createReel();
    const kicks = Array.from({ length: 24 }, (_, i) => ({ t: 0.5 + i * 0.5, h: 1 }));
    const cuts = cutTimes(reel, 12.5, (t) => pulseAt(kicks, t));
    for (let i = 1; i < cuts.length; i++) expect(cuts[i]! - cuts[i - 1]!).toBeGreaterThanOrEqual(MIN_SHOT_SEC);
    expect(cuts.length).toBeGreaterThanOrEqual(4);
  });

  it("on a busy hit signal cuts on the accents, not on the everyday hits between them", () => {
    // An accent every 2.5 s, a quieter hit every 0.25 s between (the hats a
    // Bass or Mid hit wire also catches). A fixed line under 0.45 would cut
    // on the hats as soon as each shot was old enough.
    const hits: { t: number; h: number }[] = [];
    for (let i = 0; i < 120; i++) {
      const t = 0.25 + i * 0.25;
      hits.push({ t, h: i % 10 === 9 ? 1 : 0.3 + 0.15 * ((i * 7) % 5) / 4 });
    }
    const accents = hits.filter((h) => h.h === 1 && h.t > 5).map((h) => h.t);
    const cuts = cutTimes(createReel(), 30, (t) => pulseAt(hits, t)).filter((t) => t > 5);
    for (const t of cuts) expect(accents.some((a) => Math.abs(a - t) < 0.1)).toBe(true);
    expect(cuts.length).toBeGreaterThanOrEqual(accents.length - 1);
  });

  it("never cuts with Cut off, but keeps listening", () => {
    const reel = createReel();
    const kicks = Array.from({ length: 10 }, (_, i) => ({ t: 0.5 + i * 0.5, h: 1 }));
    expect(cutTimes(reel, 5.5, (t) => pulseAt(kicks, t), { cutOn: false })).toEqual([]);
    expect(reel.cut.detector.peak).toBeGreaterThan(0.5);
  });

  it("picks every other loop and never the current one", () => {
    for (let cur = 0; cur < 3; cur++) {
      const seen = new Set([0, 0.34, 0.67, 0.999].map((r) => pickOther(cur, 3, r)));
      expect(seen.has(cur)).toBe(false);
      expect(seen.size).toBe(2);
    }
  });

  it("bounces: squashes on a hit, overshoots into a stretch, settles, and stays still with no hits", () => {
    const b = createBounce();
    run(2, (dt) => stepBounce(b, 0, dt));
    expect(b.squash).toBe(0);
    // A hit that decays like a bass pulse.
    let pulse = 1;
    let deepest = 0;
    let tallest = 0;
    run(1.5, (dt) => {
      stepBounce(b, BOUNCE_MAX * pulse, dt);
      pulse *= Math.exp(-dt * 8);
      deepest = Math.max(deepest, b.squash);
      tallest = Math.min(tallest, b.squash);
    });
    expect(deepest).toBeGreaterThan(BOUNCE_MAX * 0.3);
    expect(deepest).toBeLessThan(BOUNCE_MAX * 1.5);
    expect(tallest).toBeLessThan(0);
    run(3, (dt) => stepBounce(b, 0, dt));
    expect(Math.abs(b.squash)).toBeLessThan(1e-3);
  });

  it("smooths the bounce: as deep a squash on one Bass hit, reached later, with no stretch past rest", () => {
    expect(bounceSpring(0).gain).toBe(1);
    const hit = (smooth: number) => {
      const b = createBounce();
      let pulse = 1;
      let t = 0;
      let deepest = 0;
      let deepestAt = 0;
      let tallest = 0;
      run(2, (dt) => {
        stepBounce(b, BOUNCE_MAX * pulse, dt, smooth);
        pulse *= Math.exp(-dt * GROUP_TUNING.low.pulseDecayRate);
        t += dt;
        if (b.squash > deepest) [deepest, deepestAt] = [b.squash, t];
        tallest = Math.min(tallest, b.squash);
      });
      return { deepest, deepestAt, tallest };
    };
    const snappy = hit(0);
    const smooth = hit(1);
    expect(smooth.deepest).toBeCloseTo(snappy.deepest, 2);
    expect(smooth.deepestAt).toBeGreaterThan(snappy.deepestAt * 1.5);
    expect(smooth.tallest).toBeGreaterThan(-1e-4);
  });
});

describe("alien bake", () => {
  it("has a baked video for every loop, of that loop's clip, at its captured length", () => {
    const bin = readFileSync(new URL("../src/render/scenes/dancers/clips.bin", import.meta.url));
    const library = decodeClipLibrary(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
    expect(BAKED.loops.length).toBe(LOOPS.length);
    LOOPS.forEach((loop, i) => {
      const baked = BAKED.loops[i];
      const clip = library.byName.get(loop.clip);
      expect(clip, loop.clip).toBeDefined();
      expect(baked.clip).toBe(loop.clip);
      expect(baked.frames).toBe(Math.round(clipSeconds(clip!) * BAKED.fps));
      expect(statSync(new URL(`../src/render/scenes/alien/loops/${baked.file}`, import.meta.url)).size).toBeGreaterThan(10_000);
    });
  });

  it("puts each loop's Bounce pivot where its camera sees the floor under the alien", () => {
    LOOPS.forEach((loop, i) => {
      const [u, v] = projectToFrame(loop.camera, BAKED.width / BAKED.height, [0, 0, 0]);
      // The bake averages the pelvis's floor point; the dances barely leave the origin.
      expect(Math.abs(BAKED.loops[i].pivot[0] - u)).toBeLessThan(0.1);
      expect(Math.abs(BAKED.loops[i].pivot[1] - v)).toBeLessThan(0.15);
    });
  });
});
