import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { bindPose, buildAlienMesh, MAX_INFLUENCES } from "../src/render/scenes/alien/mesh.ts";
import { decodeAlienMesh, MESH_URL } from "../src/render/scenes/alien/meshFile.ts";
import { PARTS, compileSet, partDistance } from "../src/render/scenes/alien/body.ts";
import { GROUP_TUNING } from "../src/render/bandEnergy.ts";
import {
  BOUNCE_MAX,
  bounceSpring,
  chipLoop,
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
import { card, SETTINGS } from "../src/render/scenes/alien/card.ts";
import { easeHand, HAND_AT_REST, handCamera } from "../src/render/scenes/alien/camera.ts";
import { STANDOUT_THRESHOLD_DEFAULT } from "../src/render/standout.ts";
import { BAKED } from "../src/render/scenes/alien/loops/manifest.ts";
import { CLIP_LIBRARY_URL, decodeClipLibrary } from "../src/render/scenes/dancers/clipFormat.ts";
import { BONE_COUNT } from "../src/render/scenes/dancers/rig.ts";

describe("alien mesh", () => {
  const mesh = buildAlienMesh();

  it("is a few tens of thousands of triangles, skinned to real bones with weights summing to one", () => {
    expect(mesh.triCount).toBeGreaterThan(10_000);
    expect(mesh.triCount).toBeLessThan(60_000);
    // Counted, then checked once: an expect() per vertex took seconds and ran past the time limit on a busy machine.
    // The first bad vertex goes in the failure message, so a count still says where to look.
    let badBones = 0, badSums = 0, firstBadBone = "", firstBadSum = "";
    for (let v = 0; v < mesh.triCount * 3; v++) {
      let sum = 0;
      for (let k = 0; k < MAX_INFLUENCES; k++) {
        const bone = mesh.bones[v * MAX_INFLUENCES + k];
        sum += mesh.weights[v * MAX_INFLUENCES + k];
        if (!(bone < BONE_COUNT)) {
          badBones++;
          firstBadBone ||= `first at vertex ${v}, influence ${k}: bone ${bone}`;
        }
      }
      if (sum !== 255) {
        badSums++;
        firstBadSum ||= `first at vertex ${v}: weights sum to ${sum}`;
      }
    }
    expect(badBones, `bones out of range, ${firstBadBone}`).toBe(0);
    expect(badSums, `weights not summing to 255, ${firstBadSum}`).toBe(0);
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

/** An ALM1 file (tools/alien-model/build.py's header) of `nv` vertices, each
 *  filled from its index, and the given triangles. Vertex 3 is an eyeball. */
function alm1(nv: number, index: number[]): ArrayBuffer {
  const nt = index.length / 3;
  const buf = new ArrayBuffer(12 + nv * 40 + nt * 6);
  const view = new DataView(buf);
  new Uint8Array(buf, 0, 4).set([..."ALM1"].map((ch) => ch.charCodeAt(0)));
  view.setUint32(4, nv, true);
  view.setUint32(8, nt, true);
  let o = 12;
  for (let v = 0; v < nv; v++, o += 12) [v, 10 + v, 20 + v].forEach((x, k) => view.setFloat32(o + k * 4, x, true));
  for (let v = 0; v < nv; v++, o += 4) [0, 127, 0, v === 3 ? 127 : 0].forEach((x, k) => view.setInt8(o + k, x));
  for (let v = 0; v < nv; v++, o += 4) view.setUint8(o, v);
  for (let v = 0; v < nv; v++, o += 4) [200, 55].forEach((x, k) => view.setUint8(o + k, x));
  for (let v = 0; v < nv; v++, o += 12) view.setFloat32(o + 4, v / 100, true);
  for (let v = 0; v < nv; v++, o += 4) [-127, 0, 0, v === 3 ? 127 : 0].forEach((x, k) => view.setInt8(o + k, x));
  for (const i of index) {
    view.setUint16(o, i, true);
    o += 2;
  }
  return buf;
}

describe("alien mesh file", () => {
  it("de-indexes a hand-made two-triangle file, corner by corner", () => {
    const m = decodeAlienMesh(alm1(4, [0, 1, 2, 0, 2, 3]));
    const corners = [0, 1, 2, 0, 2, 3];
    expect(m.triCount).toBe(2);
    expect(Array.from(m.position)).toEqual(corners.flatMap((v) => [v, 10 + v, 20 + v]));
    expect(Array.from(m.normal)).toEqual(corners.flatMap(() => [0, 1, 0]));
    expect(Array.from(m.bones)).toEqual(corners.flatMap((v) => [v, 0, 0, 0]));
    expect(Array.from(m.weights)).toEqual(corners.flatMap(() => [200, 55, 0, 0]));
    expect(Array.from(m.eye)).toEqual([0, 0, 0, 0, 0, 1]);
    expect(Array.from(m.squeeze)).toEqual(corners.flatMap((v) => [0, Math.fround(v / 100), 0]));
    expect(Array.from(m.squeezeNormal)).toEqual(corners.flatMap(() => [-1, 0, 0]));
    expect(m.bind.pos).toEqual(bindPose().pos);
  });

  it("refuses a file that isn't ALM1, is cut short, or indexes past its vertices", () => {
    const good = alm1(4, [0, 1, 2]);
    const bad = good.slice(0);
    new Uint8Array(bad)[0] = 0;
    expect(() => decodeAlienMesh(bad)).toThrow(/not an ALM1/);
    expect(() => decodeAlienMesh(good.slice(0, good.byteLength - 2))).toThrow(/layout reads/);
    expect(() => decodeAlienMesh(alm1(4, [0, 1, 4]))).toThrow(/past 4 vertices/);
  });

  it("decodes the scene's model: #772's triangle count, real bones, whole eyeballs", () => {
    const bin = readFileSync(new URL(`../public${MESH_URL}`, import.meta.url));
    const m = decodeAlienMesh(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
    expect(m.triCount).toBe(20_480);
    let badSums = 0, badBones = 0, eyeTris = 0, mixedTris = 0;
    for (let c = 0; c < m.triCount * 3; c++) {
      let sum = 0;
      for (let k = 0; k < MAX_INFLUENCES; k++) {
        sum += m.weights[c * MAX_INFLUENCES + k];
        if (m.weights[c * MAX_INFLUENCES + k] > 0 && m.bones[c * MAX_INFLUENCES + k] >= BONE_COUNT) badBones++;
      }
      if (sum !== 255) badSums++;
    }
    for (let t = 0; t < m.triCount; t++) {
      const flags = m.eye[t * 3] + m.eye[t * 3 + 1] + m.eye[t * 3 + 2];
      if (flags === 3) eyeTris++;
      else if (flags > 0) mixedTris++;
    }
    expect(badSums).toBe(0);
    expect(badBones).toBe(0);
    // The eyeballs are shells of their own: a triangle is all eye or all skin.
    expect(eyeTris).toBe(480);
    expect(mixedTris).toBe(0);
  });
});

const clipBin = readFileSync(new URL(`../public${CLIP_LIBRARY_URL}`, import.meta.url));
const library = decodeClipLibrary(clipBin.buffer.slice(clipBin.byteOffset, clipBin.byteOffset + clipBin.byteLength));

describe("alien loops", () => {
  it("plays a clip the library has, each a different dance", () => {
    for (const loop of LOOPS) expect(library.byName.get(loop.clip), loop.clip).toBeDefined();
    expect(new Set(LOOPS.map((l) => l.clip)).size).toBe(LOOPS.length);
  });

  it("gives the Dance and View rows one chip per loop after Any and Own, each named once", () => {
    for (const [key, first, names] of [
      ["dance", "Any", LOOPS.map((l) => l.dance)],
      ["view", "Own", LOOPS.map((l) => l.view)],
    ] as const) {
      const spec = SETTINGS.find((s) => s.key === key)!;
      expect(spec.options).toEqual([first, ...names]);
      expect(spec.max).toBe(spec.options!.length - 1);
      expect(new Set(names).size, key).toBe(LOOPS.length);
    }
  });

  it("draws every loop through its own camera while the camera sliders rest", () => {
    for (const { camera } of LOOPS) {
      const moved = handCamera(camera, HAND_AT_REST);
      for (let i = 0; i < 3; i++) {
        expect(moved.eye[i]).toBeCloseTo(camera.eye[i], 9);
        expect(moved.target[i]).toBeCloseTo(camera.target[i], 9);
      }
      expect(moved.focal).toBe(camera.focal);
    }
  });

  it("moves the camera by hand round, over, nearer, higher and tighter", () => {
    const front = { eye: [0, 1, 3] as [number, number, number], target: [0, 1, 0] as [number, number, number], focal: 2 };
    const round = handCamera(front, { ...HAND_AT_REST, orbit: 90 });
    // A quarter turn walks it to its own right, +x (renderer.ts's cameraBasis).
    expect(round.eye[0]).toBeCloseTo(3, 9);
    expect(round.eye[2]).toBeCloseTo(0, 9);
    const over = handCamera(front, { ...HAND_AT_REST, tilt: 30 });
    expect(over.eye[1]).toBeCloseTo(1 + 3 * Math.sin(Math.PI / 6), 9);
    // Past the limit it stops short of straight down, where the view has no right-hand side.
    const top = handCamera(front, { ...HAND_AT_REST, tilt: 120 });
    expect(Math.hypot(top.eye[0], top.eye[2])).toBeGreaterThan(0.1);
    const near = handCamera(front, { ...HAND_AT_REST, distance: 0.5 });
    expect(near.eye[2]).toBeCloseTo(1.5, 9);
    const high = handCamera(front, { ...HAND_AT_REST, height: 0.4 });
    expect(high.eye[1]).toBeCloseTo(1.4, 9);
    expect(high.target[1]).toBeCloseTo(1.4, 9);
    expect(handCamera(front, { ...HAND_AT_REST, zoom: 1.5 }).focal).toBe(3);
  });

  it("eases the camera by hand toward the sliders, most of the way in a few frames", () => {
    const hand = { ...HAND_AT_REST };
    const to = { orbit: 40, tilt: -10, distance: 2, height: 0.5, zoom: 1.4 };
    for (let f = 0; f < 30; f++) easeHand(hand, to, 1 / 60);
    expect(hand.orbit).toBeGreaterThan(38);
    expect(hand.orbit).toBeLessThan(40);
    expect(hand.distance).toBeGreaterThan(1.9);
  });

  it("gives the arrow keys camera sliders that Master Scale leaves alone", () => {
    for (const slot of Object.values(card.arrows ?? {})) {
      const spec = SETTINGS.find((s) => s.key === slot.setting);
      expect(spec?.group, slot.setting).toBe("Camera");
      expect(spec?.masterScale, slot.setting).toBe(false);
    }
  });

  it("holds the loop under a Dance or View chip, and none on the first chip", () => {
    expect(chipLoop(0)).toBeNull();
    expect(chipLoop(1)).toBe(0);
    expect(chipLoop(LOOPS.length)).toBe(LOOPS.length - 1);
    expect(chipLoop(LOOPS.length + 1)).toBeNull();
  });
});

// The baked videos predate the loops after them: older builds still play them
// (src/pinnedAssets.ts's header), so they must stay the first loops as LOOPS lists them.
describe("alien bake", () => {
  it("has a baked video for each of the first loops, of that loop's clip, at its captured length", () => {
    expect(BAKED.loops.length).toBeLessThanOrEqual(LOOPS.length);
    BAKED.loops.forEach((baked, i) => {
      const clip = library.byName.get(LOOPS[i].clip);
      expect(baked.clip).toBe(LOOPS[i].clip);
      expect(baked.frames).toBe(Math.round(clipSeconds(clip!) * BAKED.fps));
      expect(statSync(new URL(`../public${baked.file}`, import.meta.url)).size).toBeGreaterThan(10_000);
    });
  });

  it("puts each baked loop's Bounce pivot where its camera sees the floor under the alien", () => {
    BAKED.loops.forEach((baked, i) => {
      const [u, v] = projectToFrame(LOOPS[i].camera, BAKED.width / BAKED.height, [0, 0, 0]);
      // The bake averages the pelvis's floor point; the dances barely leave the origin.
      expect(Math.abs(baked.pivot[0] - u)).toBeLessThan(0.1);
      expect(Math.abs(baked.pivot[1] - v)).toBeLessThan(0.15);
    });
  });
});
