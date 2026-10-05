import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildAlienMesh, MAX_INFLUENCES } from "../src/render/scenes/alien/mesh.ts";
import { PARTS, compileSet, partDistance } from "../src/render/scenes/alien/body.ts";
import { advanceReel, clipFps, createReel, LOOPS, MIN_SHOT_SEC, pickOther, type ReelInput } from "../src/render/scenes/alien/reel.ts";
import { packSkin } from "../src/render/scenes/alien/index.ts";
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
  const FRAMES = [128, 64, 128];
  const FPS = [32, 26.7, 38.4];
  const input = (over: Partial<ReelInput>): ReelInput => ({
    dtSec: 1 / 60,
    speed: 1,
    cutOn: true,
    cutSignal: 0,
    cutLine: 0.85,
    frames: FRAMES,
    fps: FPS,
    ...over,
  });

  it("buys no frames in silence: the alien holds the frame it was on", () => {
    const reel = createReel();
    for (let i = 0; i < 30; i++) advanceReel(reel, input({}));
    const held = reel.heads[0];
    for (let i = 0; i < 600; i++) advanceReel(reel, input({ speed: 0 }));
    expect(reel.heads[0]).toBe(held);
  });

  it("plays the clip's own frames per second at speed 1, half as many at 0.5, and wraps", () => {
    const reel = createReel();
    advanceReel(reel, input({ dtSec: 1 }));
    expect(reel.heads[0]).toBeCloseTo(FPS[0], 6);
    advanceReel(reel, input({ dtSec: 1, speed: 0.5 }));
    expect(reel.heads[0]).toBeCloseTo(FPS[0] * 1.5, 6);
    advanceReel(reel, input({ dtSec: 4 }));
    expect(reel.heads[0]).toBeGreaterThanOrEqual(0);
    expect(reel.heads[0]).toBeLessThan(FRAMES[0]);
  });

  it("cuts to another loop when the signal rises over the line, and never within the minimum shot", () => {
    const reel = createReel();
    // Long enough on the first shot, then a rise over the line.
    advanceReel(reel, input({ dtSec: MIN_SHOT_SEC, cutSignal: 0.5 }));
    expect(advanceReel(reel, input({ cutSignal: 0.9 }), () => 0.3)).toBe(true);
    expect(reel.loop).not.toBe(0);
    const after = reel.loop;
    // Falls and rises again at once: too soon for another cut.
    advanceReel(reel, input({ cutSignal: 0.5 }));
    expect(advanceReel(reel, input({ cutSignal: 0.9 }))).toBe(false);
    expect(reel.loop).toBe(after);
    // Staying above the line is not a rise, however long it lasts.
    expect(advanceReel(reel, input({ dtSec: MIN_SHOT_SEC * 2, cutSignal: 0.95 }))).toBe(false);
    advanceReel(reel, input({ cutSignal: 0.5 }));
    expect(advanceReel(reel, input({ cutSignal: 0.9 }))).toBe(true);
    expect(reel.cuts).toBe(2);
  });

  it("never cuts with Cut off, and each loop keeps its own playhead", () => {
    const reel = createReel();
    advanceReel(reel, input({ dtSec: MIN_SHOT_SEC, cutSignal: 0 }));
    advanceReel(reel, input({ cutOn: false, cutSignal: 1 }));
    expect(reel.cuts).toBe(0);
    const head0 = reel.heads[0];
    advanceReel(reel, input({ cutSignal: 0 }));
    advanceReel(reel, input({ cutSignal: 1 }), () => 0);
    expect(reel.loop).toBe(1);
    expect(reel.heads[0]).toBeCloseTo(head0 + FPS[0] / 60, 6);
    expect(reel.heads[1]).toBeCloseTo(FPS[1] / 60, 6);
  });

  it("picks every other loop and never the current one", () => {
    for (let cur = 0; cur < 3; cur++) {
      const seen = new Set([0, 0.34, 0.67, 0.999].map((r) => pickOther(cur, 3, r)));
      expect(seen.has(cur)).toBe(false);
      expect(seen.size).toBe(2);
    }
  });

  it("names clips that are in the shipped library", () => {
    const bin = readFileSync(new URL("../src/render/scenes/dancers/clips.bin", import.meta.url));
    const library = decodeClipLibrary(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
    for (const loop of LOOPS) {
      const clip = library.byName.get(loop.clip);
      expect(clip, loop.clip).toBeDefined();
      expect(clipFps(clip!)).toBeGreaterThan(0);
    }
  });
});
