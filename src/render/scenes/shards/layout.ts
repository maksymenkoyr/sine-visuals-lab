// Shards — the pure side: what a cluster is, how one is built from a seed,
// how the camera frames it, and how a hard cut is chosen and applied per
// onset. No GL in here; index.ts owns the drawing and tests/shards.test.ts
// pins the behaviour.
//
// Every number below is from the /ref measurement of the reference short
// (tools/.cache/refs/AcUcijyvpVc/report.md, "Picture, measured" + the
// 1.47–4.47 s burst): one close cluster of flat, extruded triangular plates
// — big panels, long thin blades, small fragments — hard-cutting to a new
// arrangement on every beat with no rank preference, and between cuts
// extending outward along their own axes while the camera rolls slowly
// clockwise. The clip has no timer cuts; FREE_RUN_SEC only keeps dead air
// from freezing the picture.
//
// One primitive draws everything: a triangular prism — a triangle in the
// (axis, across) plane, extruded ±thickness/2 along its normal. PRISM_VERTS
// vertices per instance, derived from gl_VertexID in glsl.ts with the same
// arithmetic as faceOf()/cornerOf() below, so a test can pin it.

export interface Rng {
  (): number;
}

/** mulberry32 — the same shape ambience.ts and storm.ts use, kept local so
 *  no scene imports another scene. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const KIND = { PANEL: 0, BLADE: 1, FRAGMENT: 2, BACKDROP: 3 } as const;
export type ShardKind = (typeof KIND)[keyof typeof KIND];

/** Face colours, from the reference's lit-area hues: yellow dominates,
 *  rose/violet next, then blue and green; thin spikes are mostly pale.
 *  The last entry is the deep magenta backdrop panel of regime 2. */
export const PALETTE: readonly [number, number, number][] = [
  [0.93, 0.76, 0.24], // yellow  #edc13d
  [0.94, 0.19, 0.49], // rose    #f0307c
  [0.25, 0.37, 0.88], // blue    #3f5fe0
  [0.37, 0.78, 0.21], // green   #5fc835
  [0.93, 0.9, 0.86], // pale    lighter than the measured #d3c8b9, which is a lit spike seen mid-tone
  [0.36, 0.3, 0.78], // violet  #5c4dc7
  [0.3, 0.05, 0.14], // backdrop magenta, darker than #500d23 so bloom can lift it
];
export const COLOUR = { YELLOW: 0, ROSE: 1, BLUE: 2, GREEN: 3, PALE: 4, VIOLET: 5, BACKDROP: 6 } as const;

/** Colour weights per kind (index = PALETTE index, backdrop excluded). */
const COLOUR_WEIGHTS: Record<number, number[]> = {
  [KIND.PANEL]: [0.5, 0.3, 0.08, 0.02, 0.0, 0.1],
  [KIND.BLADE]: [0.2, 0.15, 0.08, 0.0, 0.57, 0.0],
  [KIND.FRAGMENT]: [0.3, 0.2, 0.15, 0.03, 0.22, 0.1],
};

export interface Shard {
  kind: ShardKind;
  /** Centre of the prism, world units, cluster origin at 0. */
  x: number;
  y: number;
  z: number;
  /** Long direction (unit). The triangle's tip is at +axis. */
  ax: number;
  ay: number;
  az: number;
  /** Face normal (unit), perpendicular to the axis. */
  nx: number;
  ny: number;
  nz: number;
  /** Base length along the axis, width across, extrusion thickness. */
  length: number;
  width: number;
  thickness: number;
  /** Where the tip sits across the base, -1..1 (0 = isosceles). */
  taper: number;
  /** PALETTE index. */
  colour: number;
  /** Per-shard extension rate, as a fraction of length per second at Extend = 1. */
  extend: number;
  /** Accumulated extension since the last cut, fraction of length. */
  grow: number;
}

export interface Camera {
  yaw: number;
  pitch: number;
  roll: number;
  dist: number;
  /** Look-at offset from the cluster origin, so the cluster sits off-centre
   *  and is cut by the frame edges the way the reference's is. */
  tx: number;
  ty: number;
  /** Roll rate in rad/s at Spin = 1; always clockwise on screen (negative),
   *  as measured in both regimes. */
  rollRate: number;
  /** Recede rate in units/s at Dolly = 1 (hypothesis 5: brightest just after
   *  the cut, dimming as the big shard drifts away). */
  dollyRate: number;
}

export interface ClusterOptions {
  /** Shard-count multiplier, the Density slider. */
  density: number;
  /** Cluster radius multiplier, the Spread slider. */
  spread: number;
  /** Share of blades among the non-panel shards, 0..1. */
  blades: number;
  /** Quality detail proxy 0..1 — scales the count like Density does. */
  detail: number;
}

/** The measured mix: ~6 panels, ~9 blades, ~7 fragments per frame. */
const BASE_PANELS = 6;
const BASE_OTHERS = 16;
/** Uniform-array budget in glsl.ts; buildCluster never exceeds it. */
export const MAX_SHARDS = 40;
/** Chance a cluster gets the regime-2 backdrop panel behind it. */
const BACKDROP_SHARE = 0.25;
/** How far a plate's normal is pulled toward the camera when it is placed:
 *  the reference never shows a plate edge-on (that reads as a black bar). */
const FACE_MIX = 0.6;

const TAU = Math.PI * 2;

function pickWeighted(rng: Rng, weights: number[]): number {
  let total = 0;
  for (const w of weights) total += w;
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

function randomDir(rng: Rng): [number, number, number] {
  const z = rng() * 2 - 1;
  const a = rng() * TAU;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return [r * Math.cos(a), r * Math.sin(a), z];
}

function normalize(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** A unit normal perpendicular to `axis`, at a random angle around it. */
function perpendicular(rng: Rng, axis: [number, number, number]): [number, number, number] {
  const helper: [number, number, number] = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = normalize(cross(axis, helper));
  const v = cross(axis, u);
  const a = rng() * TAU;
  return [
    u[0] * Math.cos(a) + v[0] * Math.sin(a),
    u[1] * Math.cos(a) + v[1] * Math.sin(a),
    u[2] * Math.cos(a) + v[2] * Math.sin(a),
  ];
}

/** How many shards a cluster gets at these options, split by kind. */
export function shardCounts(opts: ClusterOptions): { panels: number; blades: number; fragments: number } {
  const scale = Math.max(0.2, opts.density) * (0.5 + 0.5 * Math.max(0, Math.min(1, opts.detail)));
  const panels = Math.max(1, Math.round(BASE_PANELS * scale));
  const others = Math.round(BASE_OTHERS * scale);
  const blades = Math.round(others * Math.max(0, Math.min(1, opts.blades)));
  const fragments = others - blades;
  const total = panels + blades + fragments;
  if (total <= MAX_SHARDS - 1) return { panels, blades, fragments };
  const f = (MAX_SHARDS - 1) / total;
  return { panels: Math.floor(panels * f), blades: Math.floor(blades * f), fragments: Math.floor(fragments * f) };
}

function makeShard(rng: Rng, kind: ShardKind, radius: number): Shard {
  const dir = randomDir(rng);
  // Panels crowd the middle; blades and fragments reach further out.
  const reach = kind === KIND.PANEL ? 0.45 : kind === KIND.BLADE ? 0.6 : 1.0;
  const r = radius * reach * Math.pow(rng(), 0.6);
  const pos: [number, number, number] = [dir[0] * r, dir[1] * r, dir[2] * r];
  // Axis: about half the elongated objects lie radially — bias a random
  // direction toward "away from the origin".
  const radial = normalize(pos.every((c) => c === 0) ? randomDir(rng) : pos);
  const rnd = randomDir(rng);
  const bias = 0.35 + 0.65 * rng();
  const axis = normalize([
    rnd[0] + radial[0] * bias * 2,
    rnd[1] + radial[1] * bias * 2,
    rnd[2] + radial[2] * bias * 2,
  ]);
  const normal = perpendicular(rng, axis);
  let length: number;
  let width: number;
  let thickness: number;
  let extend: number;
  if (kind === KIND.PANEL) {
    // A couple of huge plates and a spread of medium ones, as measured.
    length = 0.8 + 2.6 * Math.pow(rng(), 1.4);
    width = length * (0.45 + 0.6 * rng());
    thickness = 0.035 * length;
    extend = 0.05 + 0.1 * rng();
  } else if (kind === KIND.BLADE) {
    length = 0.7 + 1.6 * rng();
    width = length * (0.02 + 0.045 * rng());
    thickness = Math.min(0.03, Math.max(0.012, width * 0.5));
    extend = 0.25 + 0.35 * rng();
  } else {
    length = 0.1 + 0.3 * rng();
    width = length * (0.3 + 0.7 * rng());
    thickness = 0.03 * length + 0.008;
    extend = 0.1 + 0.2 * rng();
  }
  return {
    kind,
    x: pos[0],
    y: pos[1],
    z: pos[2],
    ax: axis[0],
    ay: axis[1],
    az: axis[2],
    nx: normal[0],
    ny: normal[1],
    nz: normal[2],
    length,
    width,
    thickness,
    taper: (rng() * 2 - 1) * 0.9,
    colour: pickWeighted(rng, COLOUR_WEIGHTS[kind]),
    extend,
    grow: 0,
  };
}

/** One arrangement. Deterministic in `rng`; the same seed and options give
 *  the same cluster. Panels first (index 0 is the largest), then blades,
 *  then fragments, then the optional backdrop last. */
export function buildCluster(rng: Rng, opts: ClusterOptions): Shard[] {
  const counts = shardCounts(opts);
  const radius = 1.1 * Math.max(0.2, opts.spread);
  const out: Shard[] = [];
  for (let i = 0; i < counts.panels; i++) out.push(makeShard(rng, KIND.PANEL, radius));
  out.sort((a, b) => b.length - a.length);
  // The lit area is mostly yellow in every measured regime: the biggest
  // panel is yellow three times out of four.
  if (out.length && rng() < 0.75) out[0].colour = COLOUR.YELLOW;
  for (let i = 0; i < counts.blades; i++) out.push(makeShard(rng, KIND.BLADE, radius));
  for (let i = 0; i < counts.fragments; i++) out.push(makeShard(rng, KIND.FRAGMENT, radius));
  if (rng() < BACKDROP_SHARE) {
    const s = makeShard(rng, KIND.PANEL, 0);
    s.kind = KIND.BACKDROP;
    s.colour = COLOUR.BACKDROP;
    s.length = BACKDROP_SIZE;
    s.width = BACKDROP_SIZE;
    s.thickness = 0.2;
    s.extend = 0;
    s.taper = (rng() * 2 - 1) * 0.6;
    out.push(s);
  }
  return out;
}

/** A fresh viewpoint. Distance puts the cluster across roughly 70 % of the
 *  short side at 60° vertical FOV (glsl.ts's FOCAL); the look-at offset and
 *  pitch keep it off-centre like the reference. */
export function randomCamera(rng: Rng): Camera {
  return {
    yaw: rng() * TAU,
    pitch: (rng() * 2 - 1) * 0.6,
    roll: rng() * TAU,
    dist: 1.9 + 1.0 * rng(),
    tx: (rng() * 2 - 1) * 0.5,
    ty: (rng() * 2 - 1) * 0.35,
    rollRate: -(0.025 + 0.035 * rng()),
    dollyRate: 0.1 + 0.15 * rng(),
  };
}

/** The camera's basis from its pose: position, right, up, forward (all in
 *  world units; forward points from the eye toward the look-at point). */
export function cameraBasis(cam: Camera): {
  pos: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
  fwd: [number, number, number];
} {
  const cp = Math.cos(cam.pitch);
  const dir: [number, number, number] = [cp * Math.cos(cam.yaw), Math.sin(cam.pitch), cp * Math.sin(cam.yaw)];
  const pos: [number, number, number] = [dir[0] * cam.dist, dir[1] * cam.dist, dir[2] * cam.dist];
  // Look-at offset lives in the camera's own right/up, so it reads as a
  // reframing rather than a world shift.
  const fwd = normalize([-dir[0], -dir[1], -dir[2]]);
  let right = normalize(cross(fwd, [0, 1, 0]));
  if (!Number.isFinite(right[0]) || Math.hypot(...right) < 1e-6) right = [1, 0, 0];
  let up = cross(right, fwd);
  const c = Math.cos(cam.roll);
  const s = Math.sin(cam.roll);
  const rr: [number, number, number] = [
    right[0] * c + up[0] * s,
    right[1] * c + up[1] * s,
    right[2] * c + up[2] * s,
  ];
  const uu: [number, number, number] = [
    up[0] * c - right[0] * s,
    up[1] * c - right[1] * s,
    up[2] * c - right[2] * s,
  ];
  right = rr;
  up = uu;
  // Shift the eye sideways by the look-at offset so the origin lands off-centre.
  const eye: [number, number, number] = [
    pos[0] - right[0] * cam.tx - up[0] * cam.ty,
    pos[1] - right[1] * cam.tx - up[1] * cam.ty,
    pos[2] - right[2] * cam.tx - up[2] * cam.ty,
  ];
  return { pos: eye, right, up, fwd };
}

export const CUT = { CLUSTER: 0, CAMERA: 1, RECOLOUR: 2 } as const;
export type CutKind = (typeof CUT)[keyof typeof CUT];

/** Cut flavours and their shares, from the burst: most cuts are a new
 *  cluster with a new camera; some are a camera jump on the same cluster;
 *  a few recolour a big shard in place. `recolour` (the slider) scales the
 *  last share. */
export function pickCut(rng: Rng, recolour: number): CutKind {
  const w = [0.6, 0.25, 0.15 * Math.max(0, Math.min(2, recolour))];
  return pickWeighted(rng, w) as CutKind;
}

export const CUT_MODE_NAMES = ["Every beat", "Bass hits", "Bars"] as const;
export const CUT_MODE = { BEAT: 0, BASS: 1, BARS: 2 } as const;

/** Whether this frame's audio asks for a cut under the given Cut mode. The
 *  reference cuts on every onset (mode 0); the other two exist for songs
 *  where our broadband onset is too busy. */
export function shouldCut(
  mode: number,
  a: { onset: boolean; lowOnset: boolean; barWrapped: boolean; tempoLock: number },
): boolean {
  if (mode === CUT_MODE.BASS) return a.lowOnset;
  if (mode === CUT_MODE.BARS) return a.tempoLock > 0.5 ? a.barWrapped : a.onset;
  return a.onset;
}

/** Two cuts inside this window are one cut: the reference's only
 *  consecutive-frame "cut" was a recolour ramp, not two arrangements. */
export const CUT_REFRACTORY_SEC = 0.1;
/** The minimum hold between arrangements, from the tempo when one is held.
 *  The reference cuts at beat rate while the track (and our detector) has
 *  about twice as many onsets — hi-hats between the beats — so a raw onset
 *  inside most of a beat is the same beat. Without a lock, a fixed hold
 *  that still lets a 160 bpm track through at every beat. */
export function minHoldSec(tempoLock: number, bpm: number): number {
  if (tempoLock >= 0.35 && bpm > 0) return 0.7 * (60 / bpm);
  return 0.25;
}
/** No onset for this long → cut anyway, so silence still moves. */
export const FREE_RUN_SEC = 2.0;

export interface ShardState {
  rng: Rng;
  shards: Shard[];
  camera: Camera;
  /** Seconds since the last cut of any kind. */
  holdT: number;
  /** Seconds since the last cluster/camera cut. */
  sinceArrange: number;
  /** Cuts applied so far, by kind — for tests and the probe. */
  cuts: [number, number, number];
  /** The options the current cluster was built with; a change rebuilds. */
  builtWith: ClusterOptions | null;
}

export interface AdvanceOptions extends ClusterOptions {
  /** Extension speed multiplier (Extend slider). */
  extend: number;
  /** Camera roll multiplier (Spin slider). */
  spin: number;
  /** Camera recede multiplier (Dolly slider). */
  dolly: number;
  /** Recolour share multiplier. */
  recolour: number;
  /** Minimum seconds between arrangements — see minHoldSec(). */
  minHold: number;
}

export function createShardState(seed: number, opts: ClusterOptions): ShardState {
  const rng = createRng(seed);
  const state: ShardState = {
    rng,
    shards: [],
    camera: randomCamera(rng),
    holdT: 0,
    sinceArrange: CUT_REFRACTORY_SEC,
    cuts: [0, 0, 0],
    builtWith: null,
  };
  rebuild(state, opts);
  return state;
}

/** How far a Form option must move before the cluster is rebuilt in place.
 *  Density is auto-tuned, so its resolved value creeps every frame on real
 *  music; below this a change simply waits for the next cut (at most a
 *  beat away), above it — a dragged slider — the change shows at once. */
export const FORM_REBUILD_STEP = 0.1;

function formDrift(a: ClusterOptions, b: ClusterOptions): number {
  return Math.max(
    Math.abs(a.density - b.density),
    Math.abs(a.spread - b.spread),
    Math.abs(a.blades - b.blades),
    Math.abs(a.detail - b.detail),
  );
}

function rebuild(state: ShardState, opts: ClusterOptions): void {
  state.shards = buildCluster(state.rng, opts);
  state.builtWith = { density: opts.density, spread: opts.spread, blades: opts.blades, detail: opts.detail };
  settle(state);
}

/** Everything that depends on where the camera is: runs after a cluster is
 *  built and after a camera jump. */
function settle(state: ShardState): void {
  frontLargest(state);
  faceCamera(state);
  placeBackdrop(state);
}

/** The regime-2 ground: a big dark plate behind the cluster, square to the
 *  camera, its edges still in frame the way the reference's are. */
const BACKDROP_BEHIND = 2.4;
const BACKDROP_SIZE = 9;
function placeBackdrop(state: ShardState): void {
  const b = state.shards.find((s) => s.kind === KIND.BACKDROP);
  if (!b) return;
  const toCam = normalize(cameraBasis(state.camera).pos);
  b.x = -toCam[0] * BACKDROP_BEHIND;
  b.y = -toCam[1] * BACKDROP_BEHIND;
  b.z = -toCam[2] * BACKDROP_BEHIND;
  b.nx = toCam[0];
  b.ny = toCam[1];
  b.nz = toCam[2];
  const helper: [number, number, number] = Math.abs(toCam[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const axis = normalize(cross(toCam, helper));
  b.ax = axis[0];
  b.ay = axis[1];
  b.az = axis[2];
  b.length = BACKDROP_SIZE;
  b.width = BACKDROP_SIZE;
}

/** Plates turn part-way toward the camera (FACE_MIX), staying perpendicular
 *  to their own axis; blades are thin enough to be left alone. */
function faceCamera(state: ShardState): void {
  const toCam = normalize(cameraBasis(state.camera).pos);
  for (const s of state.shards) {
    if (s.kind === KIND.BLADE) continue;
    const axis: [number, number, number] = [s.ax, s.ay, s.az];
    const d = toCam[0] * axis[0] + toCam[1] * axis[1] + toCam[2] * axis[2];
    const perp: [number, number, number] = [toCam[0] - axis[0] * d, toCam[1] - axis[1] * d, toCam[2] - axis[2] * d];
    if (Math.hypot(perp[0], perp[1], perp[2]) < 1e-4) continue;
    const nCam = normalize(perp);
    let n: [number, number, number] = [s.nx, s.ny, s.nz];
    if (n[0] * nCam[0] + n[1] * nCam[1] + n[2] * nCam[2] < 0) n = [-n[0], -n[1], -n[2]];
    const mixed: [number, number, number] = [
      n[0] * (1 - FACE_MIX) + nCam[0] * FACE_MIX,
      n[1] * (1 - FACE_MIX) + nCam[1] * FACE_MIX,
      n[2] * (1 - FACE_MIX) + nCam[2] * FACE_MIX,
    ];
    const dm = mixed[0] * axis[0] + mixed[1] * axis[1] + mixed[2] * axis[2];
    const out = normalize([mixed[0] - axis[0] * dm, mixed[1] - axis[1] * dm, mixed[2] - axis[2] * dm]);
    s.nx = out[0];
    s.ny = out[1];
    s.nz = out[2];
  }
}

/** Hypothesis 5: the largest panel starts nearest the camera. */
function frontLargest(state: ShardState): void {
  const s = state.shards[0];
  if (!s || s.kind !== KIND.PANEL) return;
  const { pos } = cameraBasis(state.camera);
  const d = normalize(pos);
  const k = 0.55 * state.camera.dist * 0.3;
  s.x = d[0] * k;
  s.y = d[1] * k;
  s.z = d[2] * k;
}

function applyCut(state: ShardState, kind: CutKind, opts: AdvanceOptions): void {
  if (kind === CUT.CLUSTER) {
    state.camera = randomCamera(state.rng);
    rebuild(state, opts);
    state.sinceArrange = 0;
  } else if (kind === CUT.CAMERA) {
    state.camera = randomCamera(state.rng);
    for (const s of state.shards) s.grow = 0;
    settle(state);
    state.sinceArrange = 0;
  } else {
    // Recolour the biggest one to three shards, never to the same colour.
    const n = 1 + Math.floor(state.rng() * 3);
    for (let i = 0; i < n && i < state.shards.length; i++) {
      const s = state.shards[i];
      if (s.kind === KIND.BACKDROP) continue;
      const w = COLOUR_WEIGHTS[s.kind].slice();
      w[s.colour] = 0;
      s.colour = pickWeighted(state.rng, w);
    }
  }
  state.holdT = 0;
  state.cuts[kind]++;
}

/** One frame. `cut` is this frame's trigger (see shouldCut); `low` the slewed
 *  low band 0..1. Returns the cut applied, or null. */
export function advanceShards(
  state: ShardState,
  dt: number,
  cut: boolean,
  low: number,
  opts: AdvanceOptions,
): CutKind | null {
  dt = Math.max(0, Math.min(0.25, dt));
  state.holdT += dt;
  state.sinceArrange += dt;
  let applied: CutKind | null = null;

  if (state.builtWith && formDrift(state.builtWith, opts) > FORM_REBUILD_STEP) {
    // A Form slider was dragged: rebuild in place so the change shows now.
    rebuild(state, opts);
  }

  if (cut || state.holdT >= FREE_RUN_SEC) {
    let kind: CutKind = cut ? pickCut(state.rng, opts.recolour) : CUT.CLUSTER;
    const arranging = kind !== CUT.RECOLOUR;
    const hold = Math.max(CUT_REFRACTORY_SEC, opts.minHold);
    if (arranging && state.sinceArrange < hold) {
      kind = CUT.RECOLOUR;
      // Inside the refractory a second beat is the same beat: only a
      // recolour may still land, and only if the rng picked one.
      if (cut && pickCut(state.rng, opts.recolour) !== CUT.RECOLOUR) return null;
    }
    applyCut(state, kind, opts);
    applied = kind;
  }

  // Between cuts: shards extend along their axis, faster on bass; the
  // camera rolls clockwise and recedes a little.
  const rate = opts.extend * (0.3 + low);
  for (const s of state.shards) s.grow += s.extend * rate * dt;
  state.camera.roll += state.camera.rollRate * opts.spin * dt;
  state.camera.dist += state.camera.dollyRate * opts.dolly * dt;
  return applied;
}

/** Vertices per prism instance: two triangular caps plus three quad sides. */
export const PRISM_VERTS = 24;

/** Which face a vertex id belongs to: 0/1 = front/back cap, 2..4 = the side
 *  along edge (k, k+1) of the triangle. Mirrors glsl.ts. */
export function faceOf(vertexId: number): number {
  if (vertexId < 3) return 0;
  if (vertexId < 6) return 1;
  return 2 + Math.floor((vertexId - 6) / 6);
}

/** The triangle corner (0..2) and side (+1 front / -1 back) a vertex id
 *  sits at. Mirrors glsl.ts. */
export function cornerOf(vertexId: number): { corner: number; side: number } {
  if (vertexId < 3) return { corner: vertexId, side: 1 };
  if (vertexId < 6) return { corner: 2 - (vertexId - 3), side: -1 };
  const k = Math.floor((vertexId - 6) / 6);
  const s = (vertexId - 6) % 6;
  // Quad (k front, k+1 front, k+1 back) + (k front, k+1 back, k back).
  const cornerA = k;
  const cornerB = (k + 1) % 3;
  switch (s) {
    case 0:
      return { corner: cornerA, side: 1 };
    case 1:
      return { corner: cornerB, side: 1 };
    case 2:
      return { corner: cornerB, side: -1 };
    case 3:
      return { corner: cornerA, side: 1 };
    case 4:
      return { corner: cornerB, side: -1 };
    default:
      return { corner: cornerA, side: -1 };
  }
}

/** Packs the cluster into the four vec4 uniform arrays glsl.ts reads.
 *  Returns how many instances to draw. */
export function packShards(
  shards: Shard[],
  a: Float32Array,
  b: Float32Array,
  c: Float32Array,
  d: Float32Array,
): number {
  const n = Math.min(shards.length, MAX_SHARDS);
  for (let i = 0; i < n; i++) {
    const s = shards[i];
    const o = i * 4;
    // Extension moves the tip outward and keeps the base put: the centre
    // shifts by half the growth along the axis.
    const g = s.length * s.grow;
    a[o] = s.x + s.ax * g * 0.5;
    a[o + 1] = s.y + s.ay * g * 0.5;
    a[o + 2] = s.z + s.az * g * 0.5;
    a[o + 3] = s.length + g;
    b[o] = s.ax;
    b[o + 1] = s.ay;
    b[o + 2] = s.az;
    b[o + 3] = s.width;
    c[o] = s.nx;
    c[o + 1] = s.ny;
    c[o + 2] = s.nz;
    c[o + 3] = s.thickness;
    d[o] = s.colour;
    d[o + 1] = s.taper;
    d[o + 2] = s.grow;
    d[o + 3] = s.kind;
  }
  return n;
}
