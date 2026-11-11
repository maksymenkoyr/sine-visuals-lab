// The drop population behind Oil Drops, kept pure so tests can run it under
// node: where every drop is, how big, which colour family, whether it sits
// inside another drop or carries a lens ring, and how it all moves. index.ts
// steps it once per frame and copies it into the instance buffer.
//
// Units: a width unit is the room's full width, so x runs 0..1 and y runs
// 0..aspect (height over width). A radius, a speed and a distance are all in
// width units, which is what the measurements were taken in (percent of
// frame width, docs/scenes/oildrops.md).
//
// Motion is one analytic flow, so nothing is read back from the GPU: a
// slide-turn-spread sheet (SheetState: a translation, a rotation and a
// spread about the frame's centre, each easing toward a target that is
// re-rolled every few seconds) plus eddies, the curl of a value-noise field
// with EDDY_WAVELENGTH-sized cells, so that neighbours agree about where to
// go and drops farther apart don't. Drops press against each other without
// merging: an overlapping pair is pushed apart until it overlaps by
// CONTACT_OVERLAP of the smaller radius, the smaller one giving way, and
// nothing ever joins. An inner drop (`host` >= 0) rides its host and wanders
// a little inside it. A drop that drifts out of the frame is dropped, and
// while the population is under its target a new one enters from the side
// the flow comes in from. A pour (`pour()`) sets a cluster of drops down
// inside the frame at size zero and lets them grow over POUR_GROW_SEC, so
// the contact push shoves the neighbours aside.

/** The instance buffer's capacity, and so the most drops ever on screen. */
export const MAX_DROPS = 320;
/** Floats per instance in the buffer index.ts uploads: x, y, drawn radius,
 *  seed, family, lens flag, two spare. */
export const DROP_FLOATS = 8;

/** The radius distribution, as its quantile function: (share of drops
 *  below, radius in width units) knots, interpolated in log radius, then
 *  scaled by the Size setting. The knots are the measured red-on-blue
 *  clip's (docs/scenes/oildrops.md, Measurements): its detector's floor,
 *  its median, its 90th percentile and its largest drop. A log-normal was
 *  tried first and could not hold the floor, the median and the 90th
 *  percentile at once. R_MAX keeps a pool from swallowing the frame. */
export const RADIUS_QUANTILES: ReadonlyArray<readonly [share: number, radius: number]> = [
  [0, 0.0031],
  [0.5, 0.0067],
  [0.9, 0.0447],
  [1, 0.107],
];
export const R_MIN = RADIUS_QUANTILES[0][1];
export const R_MAX = 0.11;
/** A poured drop stays under this radius, so a pour reads as a handful of
 *  drops and not one new pool. */
const POUR_R_MAX = 0.035;
const POUR_GROW_SEC = 1.2;
/** Drops a full-size pour puts down at Pour = 1, and the cluster's reach. */
const POUR_COUNT = 9;
const POUR_SPREAD = 0.07;

/** How far two drops may overlap, as a share of the smaller radius: the
 *  clips' touching drops press into each other by about a tenth. */
export const CONTACT_OVERLAP = 0.1;
/** Contact is undone on positions, not velocities: CONTACT_PASSES relaxation
 *  passes a frame, each taking CONTACT_RELAX of the remaining overlap out,
 *  and no drop moved more than CONTACT_MAX_STEP a frame, so a pour shoves
 *  its neighbours aside rather than firing them across the frame. A velocity
 *  push was tried first: its resting overlap grew with the flow and shrank
 *  with the radius, so beads sat deep inside pools. */
const CONTACT_PASSES = 3;
const CONTACT_RELAX = 0.7;
const CONTACT_MAX_STEP = 0.012;

/** The flow: drift at Drift = 1 in width units per second, how much a full
 *  Rush reading on a full Rush setting multiplies it by, and the sheet's
 *  shape. The quiet clip's drops moved about a quarter of a percent of the
 *  width per second and the sweeping clip's about four, which is Drift at its
 *  default with Rush at rest and at full, so loudness spans the two. */
export const DRIFT_SPEED = 0.01;
const RUSH_GAIN = 12;
/** Rotation and spread of the sheet, relative to its translation. */
const SHEET_TURN = 0.6;
const SHEET_SPREAD = 0.3;
/** How often the sheet is given a new target and how long it takes to get
 *  there: the clips' slide-turn-spread fit changed over a few seconds. */
const SHEET_RETARGET_SEC = 4;
const SHEET_TAU_SEC = 2.5;
/** The eddies: the noise cells' size (neighbours agreed to 10–20 % of the
 *  width apart, then stopped), their speed relative to the drift at rest,
 *  how much a full Swirl reading on a full Swirl setting adds, and how fast
 *  the eddy pattern itself moves on. */
const EDDY_WAVELENGTH = 0.16;
export const EDDY_BASE = 0.8;
const SWIRL_GAIN = 3;
const EDDY_DRIFT = 0.4;
/** Value noise's curl needs a gain to come out at about the drift speed:
 *  measured on the noise below (tests/oildrops.test.ts checks the ratio). */
const EDDY_GAIN = 1.2;
const EDDY_H = 0.004;

/** A kick's jolt: its speed in width units per second for a unit Shove on a
 *  full-size kick, how it relaxes, and how it depends on the drop's size (a
 *  bead of SHOVE_REF_R moves as given; bigger drops less, down to the floor). */
export const SHOVE_SPEED = 0.08;
const SHOVE_TAU_SEC = 0.22;
const SHOVE_REF_R = 0.01;
const SHOVE_SIZE_POW = 0.4;
const SHOVE_MIN = 0.35;
const SHOVE_MAX = 1.8;

/** Inner drops: how big a host has to be, how often one carries an inner
 *  drop at Inner drops = 1, the inner radius as a share of the host's, and
 *  how fast the inner drop wanders inside. A quarter to a fifth of the
 *  clips' big drops held one. */
const NEST_MIN_R = 0.0125;
const NEST_PROB_AT_FULL = 0.44;
const NEST_RATIO_MIN = 0.25;
const NEST_RATIO_MAX = 0.55;
const NEST_WANDER = 0.08;
/** The lens ring: a clear ring around about a quarter of the drops at least
 *  LENS_MIN_R wide. */
const LENS_MIN_R = 0.025;
const LENS_PROB = 0.25;

/** How far past the frame a drop may go before it is dropped, and how far
 *  outside a new one enters. */
const EXIT_MARGIN = 0.03;
const ENTRY_MARGIN = 0.01;
const PLACE_TRIES = 24;
/** The Drops setting to a population: COUNT_MIN at 0, COUNT_MIN + COUNT_SPAN
 *  at 1, bowed so the default lands near the quiet clip's eighty. */
export const COUNT_MIN = 16;
export const COUNT_SPAN = 284;

/** Longest frame step that still counts as motion: a hidden tab hands in
 *  seconds of dt, and the drops should resume, not fly. */
const MAX_STEP_SEC = 0.1;

/** Colour families, by index: the shader's per-family shading table
 *  (glsl.ts's FAMILY_SHADING) and colours are in this order. */
export const FAMILY_RED = 0;
export const FAMILY_MAGENTA = 1;
export const FAMILY_ORANGE = 2;
export const FAMILY_PINK = 3;
export const FAMILY_YELLOW = 4;
export const FAMILY_PURPLE = 5;
export const FAMILY_COUNT = 6;
/** Per Paint option (card.ts's PAINTS), the families and their shares. */
const FAMILY_MIX: ReadonlyArray<ReadonlyArray<readonly [family: number, share: number]>> = [
  [
    [FAMILY_RED, 0.75],
    [FAMILY_MAGENTA, 0.15],
    [FAMILY_ORANGE, 0.1],
  ],
  [
    [FAMILY_PINK, 0.45],
    [FAMILY_ORANGE, 0.25],
    [FAMILY_YELLOW, 0.15],
    [FAMILY_PURPLE, 0.15],
  ],
];

interface Drop {
  x: number;
  y: number;
  /** The full radius; `grow` scales what is drawn and what touches. */
  r: number;
  grow: number;
  seed: number;
  family: number;
  lens: number;
  /** Index of the drop this one sits inside, or -1. */
  host: number;
  /** Offset from the host's centre, for an inner drop. */
  ox: number;
  oy: number;
  vx: number;
  vy: number;
}

interface SheetState {
  tx: number;
  ty: number;
  turn: number;
  spread: number;
  /** Where each is heading, and the time left until a new target. */
  ttx: number;
  tty: number;
  tturn: number;
  tspread: number;
  untilSec: number;
}

/** What one step of the population needs from the scene. */
export interface StepParams {
  /** Height over width of the room. */
  aspect: number;
  /** The population to hold, before any pour. */
  count: number;
  /** The Size setting. */
  size: number;
  /** The Inner drops setting. */
  nested: number;
  /** Which Paint option is on. */
  paint: number;
  /** The drift speed this frame, width units per second (driftSpeed()). */
  speed: number;
  /** The eddies' speed relative to the drift (eddyScale()). */
  eddy: number;
  /** A kick's jolt this frame, 0 for none, else its size times the Shove
   *  setting. */
  shove: number;
  /** A pour this frame, 0 for none, else its size times the Pour setting. */
  pour: number;
}

export interface DropSim {
  readonly drops: Drop[];
  readonly sheet: SheetState;
  /** The current jolt, decaying. */
  shoveX: number;
  shoveY: number;
  /** How far the paint has slid, in width units: index.ts wraps it per
   *  octave for the paint shader. */
  paintX: number;
  paintY: number;
  /** Where the eddy pattern has moved on to, in noise cells. */
  eddyPhase: number;
  /** The Paint option the families were last dealt for. */
  paintMode: number;
  rng: () => number;
}

/** The drift speed this frame: Drift times the Rush lift, so with nothing
 *  plugged in (reading 0) the slider alone sets the pace. */
export function driftSpeed(drift: number, rush: number, rushReading: number): number {
  return DRIFT_SPEED * Math.max(0, drift) * (1 + RUSH_GAIN * Math.max(0, rush) * Math.max(0, rushReading));
}

/** The eddies' speed relative to the drift: a base that is always there,
 *  lifted by the Swirl reading. */
export function eddyScale(swirl: number, swirlReading: number): number {
  return EDDY_BASE * (1 + SWIRL_GAIN * Math.max(0, swirl) * Math.max(0, swirlReading));
}

/** The Drops setting to a population. */
export function dropCount(drops: number): number {
  const d = Math.min(1, Math.max(0, drops));
  return Math.round(COUNT_MIN + COUNT_SPAN * d * d);
}

/** mulberry32: a small seeded generator, so a test can replay a run. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** The radius at a share `u` (0..1) of the distribution, before Size. */
export function radiusAtShare(u: number): number {
  const q = RADIUS_QUANTILES;
  const x = Math.min(1, Math.max(0, u));
  for (let i = 1; i < q.length; i++) {
    if (x <= q[i][0]) {
      const t = (x - q[i - 1][0]) / (q[i][0] - q[i - 1][0]);
      return Math.exp(Math.log(q[i - 1][1]) + t * (Math.log(q[i][1]) - Math.log(q[i - 1][1])));
    }
  }
  return q[q.length - 1][1];
}

/** A fresh radius from the distribution, scaled by Size and clamped. */
export function sampleRadius(rng: () => number, size: number, rMax = R_MAX): number {
  return Math.min(rMax, Math.max(R_MIN, radiusAtShare(rng()) * size));
}

/** A family for a drop under a Paint option, by the option's shares. */
function dealFamily(rng: () => number, paint: number): number {
  const mix = FAMILY_MIX[Math.min(FAMILY_MIX.length - 1, Math.max(0, Math.round(paint)))];
  let u = rng();
  for (const [family, share] of mix) {
    u -= share;
    if (u <= 0) return family;
  }
  return mix[mix.length - 1][0];
}

// A small integer hash and the value noise the eddies are the curl of. In
// JS, not GLSL, so the drops and the paint share nothing but the sheet; the
// eddies only ever move drops.
function hash2(ix: number, iy: number): number {
  let h = (ix * 374761393 + iy * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Value noise in [0, 1] with a smooth interpolant. */
function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** The eddy field's stream function at a point. */
function stream(x: number, y: number, phase: number): number {
  const f = 1 / EDDY_WAVELENGTH;
  return valueNoise(x * f + phase, y * f + 17.3 + 0.7 * phase) + 0.5 * valueNoise(x * f * 2.1 + 41.7 - phase, y * f * 2.1 + 0.5 * phase);
}

/** The eddies' velocity at a point for a unit drift speed: the curl of the
 *  stream function, scaled. */
export function eddyVelocity(x: number, y: number, phase: number, out: [number, number]): [number, number] {
  const h = EDDY_H;
  const dx = (stream(x + h, y, phase) - stream(x - h, y, phase)) / (2 * h);
  const dy = (stream(x, y + h, phase) - stream(x, y - h, phase)) / (2 * h);
  out[0] = dy * EDDY_GAIN * EDDY_WAVELENGTH;
  out[1] = -dx * EDDY_GAIN * EDDY_WAVELENGTH;
  return out;
}

/** The sheet's velocity at a point, for a unit drift speed. */
function sheetVelocity(sheet: SheetState, x: number, y: number, aspect: number, out: [number, number]): [number, number] {
  const px = x - 0.5;
  const py = y - 0.5 * aspect;
  out[0] = sheet.tx + sheet.turn * -py + sheet.spread * px;
  out[1] = sheet.ty + sheet.turn * px + sheet.spread * py;
  return out;
}

function retargetSheet(sheet: SheetState, rng: () => number): void {
  const a = rng() * 2 * Math.PI;
  const m = 0.6 + 0.8 * rng();
  sheet.ttx = Math.cos(a) * m;
  sheet.tty = Math.sin(a) * m;
  sheet.tturn = (rng() * 2 - 1) * SHEET_TURN;
  sheet.tspread = (rng() * 2 - 1) * SHEET_SPREAD;
  sheet.untilSec = SHEET_RETARGET_SEC * (0.6 + 0.8 * rng());
}

/** One step of the sheet's easing toward its target, re-rolled when due. */
function advanceSheet(sheet: SheetState, dtSec: number, rng: () => number): void {
  sheet.untilSec -= dtSec;
  if (sheet.untilSec <= 0) retargetSheet(sheet, rng);
  const k = 1 - Math.exp(-dtSec / SHEET_TAU_SEC);
  sheet.tx += (sheet.ttx - sheet.tx) * k;
  sheet.ty += (sheet.tty - sheet.ty) * k;
  sheet.turn += (sheet.tturn - sheet.turn) * k;
  sheet.spread += (sheet.tspread - sheet.spread) * k;
}

export function createDropSim(seed = (Math.random() * 4294967296) >>> 0): DropSim {
  const rng = createRng(seed);
  const sheet: SheetState = { tx: 0, ty: 0, turn: 0, spread: 0, ttx: 0, tty: 0, tturn: 0, tspread: 0, untilSec: 0 };
  retargetSheet(sheet, rng);
  sheet.tx = sheet.ttx;
  sheet.ty = sheet.tty;
  sheet.turn = sheet.tturn;
  sheet.spread = sheet.tspread;
  return { drops: [], sheet, shoveX: 0, shoveY: 0, paintX: 0, paintY: 0, eddyPhase: rng() * 100, paintMode: -1, rng };
}

/** Whether a drop of radius r at (x, y) would press into any free drop more
 *  than contact allows. Inner drops are skipped: they sit inside a host
 *  this test already covers. */
function crowded(sim: DropSim, x: number, y: number, r: number): boolean {
  for (const d of sim.drops) {
    if (d.host >= 0) continue;
    const rr = d.r * d.grow;
    const allowed = r + rr - CONTACT_OVERLAP * Math.min(r, rr);
    const dx = d.x - x;
    const dy = d.y - y;
    if (dx * dx + dy * dy < allowed * allowed) return true;
  }
  return false;
}

function makeDrop(sim: DropSim, x: number, y: number, r: number, paint: number, grow: number): Drop {
  return { x, y, r, grow, seed: sim.rng(), family: dealFamily(sim.rng, paint), lens: r >= LENS_MIN_R && sim.rng() < LENS_PROB ? 1 : 0, host: -1, ox: 0, oy: 0, vx: 0, vy: 0 };
}

/** Adds a drop, and with luck an inner drop inside it; returns how many were
 *  added (0 when the buffer is full). */
function addDrop(sim: DropSim, x: number, y: number, r: number, p: StepParams, grow = 1): number {
  if (sim.drops.length >= MAX_DROPS) return 0;
  const host = makeDrop(sim, x, y, r, p.paint, grow);
  sim.drops.push(host);
  let added = 1;
  if (r >= NEST_MIN_R && sim.drops.length < MAX_DROPS && sim.rng() < NEST_PROB_AT_FULL * Math.min(1, Math.max(0, p.nested))) {
    const ri = r * (NEST_RATIO_MIN + (NEST_RATIO_MAX - NEST_RATIO_MIN) * sim.rng());
    const reach = r - ri - 0.08 * r;
    const a = sim.rng() * 2 * Math.PI;
    const m = Math.sqrt(sim.rng()) * Math.max(0, reach);
    const inner = makeDrop(sim, x + Math.cos(a) * m, y + Math.sin(a) * m, ri, p.paint, grow);
    inner.host = sim.drops.length - 1;
    inner.ox = Math.cos(a) * m;
    inner.oy = Math.sin(a) * m;
    inner.lens = 0;
    sim.drops.push(inner);
    added++;
  }
  return added;
}

/** Fills the frame with drops up to the target, biggest first so they pack.
 *  Every sampled radius is placed, the inner drops added along the way
 *  overshooting the target a little: stopping at the count would leave the
 *  small tail of the distribution out and the frame half covered. */
function fillFrame(sim: DropSim, p: StepParams): void {
  const want = Math.min(MAX_DROPS, p.count) - sim.drops.length;
  if (want <= 0) return;
  const radii: number[] = [];
  for (let i = 0; i < want; i++) radii.push(sampleRadius(sim.rng, p.size));
  radii.sort((a, b) => b - a);
  for (const r of radii) {
    if (sim.drops.length >= MAX_DROPS) break;
    for (let t = 0; t < PLACE_TRIES; t++) {
      const x = sim.rng();
      const y = sim.rng() * p.aspect;
      if (!crowded(sim, x, y, r)) {
        addDrop(sim, x, y, r, p);
        break;
      }
    }
  }
}

const scratch: [number, number] = [0, 0];

/** The whole flow at a point, in width units per second. */
function flowVelocity(sim: DropSim, x: number, y: number, p: StepParams, out: [number, number]): [number, number] {
  sheetVelocity(sim.sheet, x, y, p.aspect, out);
  const sx = out[0];
  const sy = out[1];
  eddyVelocity(x, y, sim.eddyPhase, out);
  out[0] = p.speed * (sx + p.eddy * out[0]);
  out[1] = p.speed * (sy + p.eddy * out[1]);
  return out;
}

/** Puts one new drop just outside the frame on a side the flow comes in
 *  from; returns whether it managed to. */
function enterDrop(sim: DropSim, p: StepParams): boolean {
  const r = sampleRadius(sim.rng, p.size);
  const a = p.aspect;
  // Inflow at each side's midpoint: left, right, bottom, top.
  const sides: Array<[number, number, number]> = [];
  const mids: Array<[number, number]> = [
    [0, a / 2],
    [1, a / 2],
    [0.5, 0],
    [0.5, a],
  ];
  const normals: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  let total = 0;
  for (let s = 0; s < 4; s++) {
    flowVelocity(sim, mids[s][0], mids[s][1], p, scratch);
    const inflow = Math.max(0, scratch[0] * normals[s][0] + scratch[1] * normals[s][1]) + 1e-6;
    total += inflow;
    sides.push([s, inflow, total]);
  }
  for (let t = 0; t < PLACE_TRIES; t++) {
    const u = sim.rng() * total;
    let side = 3;
    for (const [s, , cum] of sides) {
      if (u <= cum) {
        side = s;
        break;
      }
    }
    const along = sim.rng();
    const off = r + ENTRY_MARGIN;
    const x = side === 0 ? -off : side === 1 ? 1 + off : along;
    const y = side === 2 ? -off : side === 3 ? a + off : along * a;
    if (!crowded(sim, x, y, r)) {
      addDrop(sim, x, y, r, p);
      return true;
    }
  }
  return false;
}

/** Sets a cluster of `n` small drops down around a random spot inside the
 *  frame, at size zero. */
function pour(sim: DropSim, n: number, p: StepParams): number {
  const cx = 0.2 + 0.6 * sim.rng();
  const cy = (0.2 + 0.6 * sim.rng()) * p.aspect;
  let added = 0;
  for (let i = 0; i < n && sim.drops.length < MAX_DROPS; i++) {
    const r = sampleRadius(sim.rng, p.size, POUR_R_MAX);
    const a = sim.rng() * 2 * Math.PI;
    const m = Math.sqrt(sim.rng()) * POUR_SPREAD;
    added += addDrop(sim, cx + Math.cos(a) * m, cy + Math.sin(a) * m, r, p, 0.02);
  }
  return added;
}

/** Deals every drop a new family for the Paint option in force. */
function redeal(sim: DropSim, paint: number): void {
  for (const d of sim.drops) d.family = dealFamily(sim.rng, paint);
  sim.paintMode = paint;
}

/** Removes the drops that have left the frame, and the inner drops of any
 *  host removed, keeping every `host` index right. */
function cull(sim: DropSim, aspect: number): void {
  const drops = sim.drops;
  const keep = new Array<boolean>(drops.length);
  for (let i = 0; i < drops.length; i++) {
    const d = drops[i];
    const m = d.r * d.grow + EXIT_MARGIN;
    keep[i] = d.host < 0 && d.x > -m && d.x < 1 + m && d.y > -m && d.y < aspect + m;
  }
  for (let i = 0; i < drops.length; i++) {
    const d = drops[i];
    if (d.host >= 0) keep[i] = keep[d.host];
  }
  const remap = new Int32Array(drops.length);
  let n = 0;
  for (let i = 0; i < drops.length; i++) remap[i] = keep[i] ? n++ : -1;
  if (n === drops.length) return;
  const next: Drop[] = [];
  for (let i = 0; i < drops.length; i++) {
    if (!keep[i]) continue;
    const d = drops[i];
    if (d.host >= 0) d.host = remap[d.host];
    next.push(d);
  }
  drops.length = 0;
  for (const d of next) drops.push(d);
}

/** How much a drop of radius r takes of a jolt. */
export function shoveFactor(r: number): number {
  return Math.min(SHOVE_MAX, Math.max(SHOVE_MIN, (SHOVE_REF_R / Math.max(r, 1e-6)) ** SHOVE_SIZE_POW));
}

/** One frame of the population. */
export function stepDrops(sim: DropSim, dtSec: number, p: StepParams): void {
  const dt = Math.min(Math.max(0, dtSec), MAX_STEP_SEC);
  const drops = sim.drops;
  if (sim.paintMode !== p.paint) redeal(sim, p.paint);

  advanceSheet(sim.sheet, dt, sim.rng);
  sim.eddyPhase += dt * p.speed * EDDY_DRIFT / EDDY_WAVELENGTH;
  sim.paintX += dt * p.speed * sim.sheet.tx;
  sim.paintY += dt * p.speed * sim.sheet.ty;

  // The jolt: a new kick adds its impulse in a fresh direction.
  const decay = Math.exp(-dt / SHOVE_TAU_SEC);
  sim.shoveX *= decay;
  sim.shoveY *= decay;
  if (p.shove > 0) {
    const a = sim.rng() * 2 * Math.PI;
    sim.shoveX += Math.cos(a) * SHOVE_SPEED * p.shove;
    sim.shoveY += Math.sin(a) * SHOVE_SPEED * p.shove;
  }

  if (p.pour > 0) pour(sim, Math.round(POUR_COUNT * p.pour), p);

  // Flow and jolt, free drops only; inner drops follow below.
  for (const d of drops) {
    if (d.grow < 1) d.grow = Math.min(1, d.grow + dt / POUR_GROW_SEC);
    if (d.host >= 0) continue;
    flowVelocity(sim, d.x, d.y, p, scratch);
    const f = shoveFactor(d.r);
    d.vx = scratch[0] + sim.shoveX * f;
    d.vy = scratch[1] + sim.shoveY * f;
  }

  for (const d of drops) {
    if (d.host >= 0) continue;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
  }

  // Contact: overlapping pairs are moved apart, the smaller drop giving way.
  for (let pass = 0; pass < CONTACT_PASSES; pass++) {
    for (let i = 0; i < drops.length; i++) {
      const a = drops[i];
      if (a.host >= 0) continue;
      const ra = a.r * a.grow;
      for (let j = i + 1; j < drops.length; j++) {
        const b = drops[j];
        if (b.host >= 0) continue;
        const rb = b.r * b.grow;
        const allowed = ra + rb - CONTACT_OVERLAP * Math.min(ra, rb);
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= allowed * allowed) continue;
        let dist = Math.sqrt(d2);
        if (dist < 1e-6) {
          dx = 1;
          dy = 0;
          dist = 1;
        }
        const move = Math.min(CONTACT_MAX_STEP, (allowed - dist) * CONTACT_RELAX);
        const ma = ra * ra;
        const mb = rb * rb;
        const wa = mb / (ma + mb);
        const nx = dx / dist;
        const ny = dy / dist;
        a.x -= nx * move * wa;
        a.y -= ny * move * wa;
        b.x += nx * move * (1 - wa);
        b.y += ny * move * (1 - wa);
      }
    }
  }

  // Inner drops ride their host and wander a little inside it, the jolt
  // sloshing them toward its direction.
  for (const d of drops) {
    if (d.host < 0) continue;
    const h = drops[d.host];
    const reach = Math.max(0, h.r - d.r - 0.08 * h.r) * h.grow;
    d.ox += (gauss(sim.rng) * NEST_WANDER * h.r * Math.sqrt(dt) + sim.shoveX * 1.5) * dt * 10;
    d.oy += (gauss(sim.rng) * NEST_WANDER * h.r * Math.sqrt(dt) + sim.shoveY * 1.5) * dt * 10;
    const m = Math.hypot(d.ox, d.oy);
    if (m > reach) {
      d.ox *= reach / m;
      d.oy *= reach / m;
    }
    d.x = h.x + d.ox;
    d.y = h.y + d.oy;
    d.vx = h.vx;
    d.vy = h.vy;
  }

  cull(sim, p.aspect);
  if (drops.length === 0) fillFrame(sim, p);
  else if (drops.length < Math.min(MAX_DROPS, p.count)) enterDrop(sim, p);
}

/** Writes the population into `out` in drawing order (biggest first, so a
 *  host is under its inner drop) and returns how many instances to draw. */
export function packDrops(sim: DropSim, out: Float32Array, order: number[]): number {
  const drops = sim.drops;
  order.length = 0;
  for (let i = 0; i < drops.length; i++) order.push(i);
  order.sort((i, j) => drops[j].r * drops[j].grow - drops[i].r * drops[i].grow);
  let n = 0;
  for (const i of order) {
    const d = drops[i];
    const o = n * DROP_FLOATS;
    if (o + DROP_FLOATS > out.length) break;
    out[o] = d.x;
    out[o + 1] = d.y;
    out[o + 2] = d.r * d.grow;
    out[o + 3] = d.seed;
    out[o + 4] = d.family;
    out[o + 5] = d.lens;
    out[o + 6] = 0;
    out[o + 7] = 0;
    n++;
  }
  return n;
}
