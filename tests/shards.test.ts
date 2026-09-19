import { describe, it, expect } from "vitest";
import {
  CUT,
  CUT_MODE,
  FORM_REBUILD_STEP,
  KIND,
  MAX_SHARDS,
  PALETTE,
  PRISM_VERTS,
  advanceShards,
  buildCluster,
  cameraBasis,
  cornerOf,
  createRng,
  createShardState,
  cutSource,
  faceOf,
  packShards,
  pickCut,
  randomCamera,
  shardCounts,
  type AdvanceOptions,
  type ClusterOptions,
} from "../src/render/scenes/shards/layout.ts";

const FORM: ClusterOptions = { density: 1, spread: 1, blades: 0.55, detail: 1 };
const OPTS: AdvanceOptions = { ...FORM, extend: 1, spin: 1, dolly: 1, recolour: 1 };
const DT = 1 / 60;
const FIRED = { fired: true, reason: "fired" } as const;
const QUIET = { fired: false, reason: "quiet" } as const;
const REFRACTORY = { fired: false, reason: "refractory" } as const;

describe("shards cluster", () => {
  it("is deterministic in its seed", () => {
    const a = buildCluster(createRng(7), FORM);
    const b = buildCluster(createRng(7), FORM);
    expect(a).toEqual(b);
    const c = buildCluster(createRng(8), FORM);
    expect(c).not.toEqual(a);
  });

  it("has the measured mix at full detail and never exceeds the uniform budget", () => {
    const counts = shardCounts(FORM);
    expect(counts.panels).toBeGreaterThanOrEqual(5);
    expect(counts.blades).toBeGreaterThan(counts.fragments * 0.8);
    for (const density of [0.3, 1, 2]) {
      for (const detail of [0.25, 0.4, 0.7, 1]) {
        const shards = buildCluster(createRng(1), { ...FORM, density, detail });
        expect(shards.length).toBeLessThanOrEqual(MAX_SHARDS);
        expect(shards.length).toBeGreaterThan(0);
      }
    }
  });

  it("shrinks with detail and grows with density", () => {
    const hi = shardCounts({ ...FORM, detail: 1 });
    const lo = shardCounts({ ...FORM, detail: 0.25 });
    expect(lo.panels + lo.blades + lo.fragments).toBeLessThan(hi.panels + hi.blades + hi.fragments);
    const dense = shardCounts({ ...FORM, density: 2 });
    expect(dense.panels + dense.blades + dense.fragments).toBeGreaterThan(hi.panels + hi.blades + hi.fragments);
  });

  it("puts panels first, largest first, with blades far thinner than long", () => {
    const shards = buildCluster(createRng(3), FORM);
    const panels = shards.filter((s) => s.kind === KIND.PANEL);
    expect(shards.slice(0, panels.length).every((s) => s.kind === KIND.PANEL)).toBe(true);
    for (let i = 1; i < panels.length; i++) expect(panels[i].length).toBeLessThanOrEqual(panels[i - 1].length);
    for (const s of shards.filter((b) => b.kind === KIND.BLADE)) {
      expect(s.length / s.width).toBeGreaterThan(8);
    }
    for (const s of shards) {
      expect(Math.hypot(s.ax, s.ay, s.az)).toBeCloseTo(1, 5);
      expect(Math.hypot(s.nx, s.ny, s.nz)).toBeCloseTo(1, 5);
      expect(Math.abs(s.ax * s.nx + s.ay * s.ny + s.az * s.nz)).toBeLessThan(1e-5);
      expect(s.colour).toBeLessThan(PALETTE.length);
    }
  });

  it("keeps yellow the dominant panel colour over many seeds", () => {
    let yellowLargest = 0;
    const N = 200;
    for (let seed = 0; seed < N; seed++) {
      const shards = buildCluster(createRng(seed), FORM);
      if (shards[0].colour === 0) yellowLargest++;
    }
    expect(yellowLargest / N).toBeGreaterThan(0.6);
  });
});

describe("shards camera", () => {
  it("rolls clockwise and looks at the cluster", () => {
    for (let seed = 0; seed < 20; seed++) {
      const cam = randomCamera(createRng(seed));
      expect(cam.rollRate).toBeLessThan(0);
      const b = cameraBasis(cam);
      // The forward vector points from the eye toward the origin region.
      const toOrigin = [-b.pos[0], -b.pos[1], -b.pos[2]];
      const dot = toOrigin[0] * b.fwd[0] + toOrigin[1] * b.fwd[1] + toOrigin[2] * b.fwd[2];
      expect(dot).toBeGreaterThan(0);
      // Orthonormal basis.
      expect(b.right[0] * b.up[0] + b.right[1] * b.up[1] + b.right[2] * b.up[2]).toBeCloseTo(0, 5);
      expect(b.right[0] * b.fwd[0] + b.right[1] * b.fwd[1] + b.right[2] * b.fwd[2]).toBeCloseTo(0, 5);
      expect(Math.hypot(...b.up)).toBeCloseTo(1, 5);
    }
  });
});

describe("shards cuts", () => {
  it("picks mostly whole-cluster cuts, and no recolours at Recolour 0", () => {
    const rng = createRng(11);
    const counts = [0, 0, 0];
    for (let i = 0; i < 2000; i++) counts[pickCut(rng, 1)]++;
    expect(counts[CUT.CLUSTER]).toBeGreaterThan(counts[CUT.CAMERA]);
    expect(counts[CUT.CAMERA]).toBeGreaterThan(counts[CUT.RECOLOUR]);
    expect(counts[CUT.RECOLOUR]).toBeGreaterThan(0);
    for (let i = 0; i < 200; i++) expect(pickCut(rng, 0)).not.toBe(CUT.RECOLOUR);
  });

  it("cutSource maps each Cut mode to what it actually listens to", () => {
    expect(cutSource(CUT_MODE.BEAT)).toBe("beat");
    expect(cutSource(CUT_MODE.BASS)).toBe("bass");
    expect(cutSource(CUT_MODE.BARS)).toBe("bar");
  });

  it("applies one cut per fired hit and holds on a same-beat (held/refractory) one", () => {
    const state = createShardState(5, FORM);
    const before = state.shards.map((s) => ({ ...s }));
    const applied = advanceShards(state, DT, FIRED, 0.5, { ...OPTS, recolour: 0 });
    expect(applied).not.toBeNull();
    expect(applied).not.toBe(CUT.RECOLOUR);
    expect(state.cuts[0] + state.cuts[1]).toBe(1);
    const afterFirst = state.shards.map((s) => ({ ...s }));
    expect(afterFirst).not.toEqual(before);
    // A same-beat hit (what beatListener.ts reports as "held"/"refractory"):
    // with Recolour at 0 nothing can land, so no cut at all.
    const second = advanceShards(state, DT, REFRACTORY, 0.5, { ...OPTS, recolour: 0 });
    expect(second).toBeNull();
    expect(state.cuts[0] + state.cuts[1]).toBe(1);
    // A later, fresh hit cuts again.
    const third = advanceShards(state, DT, FIRED, 0.5, { ...OPTS, recolour: 0 });
    expect(third).not.toBeNull();
    expect(state.cuts[0] + state.cuts[1]).toBe(2);
  });

  it("a same-beat hit may still land a recolour, at Recolour's own odds", () => {
    // Find a seed whose very next roll (inside the held/refractory branch)
    // is a recolour, without needing an arranging cut first.
    for (let seed = 0; seed < 200; seed++) {
      const state = createShardState(seed, FORM);
      const positions = state.shards.map((s) => [s.x, s.y, s.z, s.length]);
      const applied = advanceShards(state, DT, REFRACTORY, 0, { ...OPTS, extend: 0, spin: 0, dolly: 0 });
      if (applied === null) continue;
      expect(applied).toBe(CUT.RECOLOUR);
      expect(state.shards.map((s) => [s.x, s.y, s.z, s.length])).toEqual(positions);
      expect(state.cuts[CUT.RECOLOUR]).toBe(1);
      return;
    }
    throw new Error("no seed produced a recolour on a held/refractory hit");
  });

  it("recolours in place without moving anything", () => {
    // Find a seed whose first pick is a recolour.
    for (let seed = 0; seed < 200; seed++) {
      const state = createShardState(seed, FORM);
      const positions = state.shards.map((s) => [s.x, s.y, s.z, s.length]);
      const cam = { ...state.camera };
      const applied = advanceShards(state, DT, FIRED, 0, { ...OPTS, extend: 0, spin: 0, dolly: 0 });
      if (applied !== CUT.RECOLOUR) continue;
      expect(state.shards.map((s) => [s.x, s.y, s.z, s.length])).toEqual(positions);
      expect(state.camera.yaw).toBe(cam.yaw);
      expect(state.cuts[CUT.RECOLOUR]).toBe(1);
      return;
    }
    throw new Error("no seed produced a recolour first");
  });

  it("nothing cuts on a quiet tick — no free-run", () => {
    const state = createShardState(9, FORM);
    for (let i = 0; i < 300; i++) expect(advanceShards(state, DT, QUIET, 0, OPTS)).toBeNull();
    expect(state.cuts).toEqual([0, 0, 0]);
  });

  it("extends shards monotonically inside a hold, faster on bass, and rolls clockwise", () => {
    const state = createShardState(2, FORM);
    const roll0 = state.camera.roll;
    const dist0 = state.camera.dist;
    let prev = state.shards.map((s) => s.grow);
    for (let i = 0; i < 30; i++) {
      advanceShards(state, DT, QUIET, 0.2, OPTS);
      const now = state.shards.map((s) => s.grow);
      for (let k = 0; k < now.length; k++) {
        if (state.shards[k].kind === KIND.BACKDROP) expect(now[k]).toBe(0);
        else expect(now[k]).toBeGreaterThan(prev[k]);
      }
      prev = now;
    }
    const quietGrow = state.shards[0].grow;
    const loud = createShardState(2, FORM);
    for (let i = 0; i < 30; i++) advanceShards(loud, DT, QUIET, 1, OPTS);
    expect(loud.shards[0].grow).toBeGreaterThan(quietGrow);
    expect(state.camera.roll).toBeLessThan(roll0);
    expect(state.camera.dist).toBeGreaterThan(dist0);
  });

  it("rebuilds in place when a Form slider is dragged, not when auto-tune creeps", () => {
    const state = createShardState(4, FORM);
    const n0 = state.shards.length;
    const before = state.shards.map((s) => ({ ...s, grow: 0 }));
    // Auto-tune drift of a fraction of a step: the cluster stays put.
    advanceShards(state, DT, QUIET, 0, { ...OPTS, density: 1 + FORM_REBUILD_STEP * 0.5, extend: 0, spin: 0, dolly: 0 });
    expect(state.shards.map((s) => ({ ...s, grow: 0 }))).toEqual(before);
    // A real drag rebuilds at once, without counting as a cut.
    advanceShards(state, DT, QUIET, 0, { ...OPTS, density: 2 });
    expect(state.shards.length).toBeGreaterThan(n0);
    expect(state.cuts).toEqual([0, 0, 0]);
  });

  it("keeps the backdrop behind the cluster, square to the camera", () => {
    for (let seed = 0; seed < 60; seed++) {
      const state = createShardState(seed, FORM);
      const b = state.shards.find((s) => s.kind === KIND.BACKDROP);
      if (!b) continue;
      const cam = cameraBasis(state.camera).pos;
      const toCam = cam.map((c) => c / Math.hypot(...cam));
      // Behind the origin as seen from the camera, facing it.
      expect(b.x * toCam[0] + b.y * toCam[1] + b.z * toCam[2]).toBeLessThan(-1);
      expect(b.nx * toCam[0] + b.ny * toCam[1] + b.nz * toCam[2]).toBeCloseTo(1, 5);
      expect(Math.abs(b.ax * b.nx + b.ay * b.ny + b.az * b.nz)).toBeLessThan(1e-5);
      return;
    }
    throw new Error("no seed produced a backdrop");
  });
});

describe("shards prism indexing", () => {
  it("covers two caps and three sides with 24 vertices", () => {
    const faces = new Set<number>();
    for (let v = 0; v < PRISM_VERTS; v++) {
      const f = faceOf(v);
      faces.add(f);
      const { corner, side } = cornerOf(v);
      expect(corner).toBeGreaterThanOrEqual(0);
      expect(corner).toBeLessThan(3);
      expect(Math.abs(side)).toBe(1);
      if (f === 0) expect(side).toBe(1);
      if (f === 1) expect(side).toBe(-1);
    }
    expect([...faces].sort()).toEqual([0, 1, 2, 3, 4]);
    // Each side quad uses exactly its two edge corners, both sides.
    for (let k = 0; k < 3; k++) {
      const seen = new Set<string>();
      for (let s = 0; s < 6; s++) {
        const { corner, side } = cornerOf(6 + k * 6 + s);
        expect([k, (k + 1) % 3]).toContain(corner);
        seen.add(`${corner}:${side}`);
      }
      expect(seen.size).toBe(4);
    }
  });

  it("packs the extension as a tip that moves outward from a fixed base", () => {
    const state = createShardState(6, FORM);
    const a = new Float32Array(MAX_SHARDS * 4);
    const b = new Float32Array(MAX_SHARDS * 4);
    const c = new Float32Array(MAX_SHARDS * 4);
    const d = new Float32Array(MAX_SHARDS * 4);
    const n = packShards(state.shards, a, b, c, d);
    expect(n).toBe(state.shards.length);
    const s = state.shards[0];
    const base0 = a[0] - s.ax * a[3] * 0.5;
    for (let i = 0; i < 20; i++) advanceShards(state, DT, QUIET, 1, OPTS);
    packShards(state.shards, a, b, c, d);
    expect(a[3]).toBeGreaterThan(s.length);
    const base1 = a[0] - s.ax * a[3] * 0.5;
    expect(base1).toBeCloseTo(base0, 5);
  });
});
