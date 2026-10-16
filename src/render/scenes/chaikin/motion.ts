// Chaikin Curves' motion: two layers that move every seed a little around
// its place on the lattice, on top of the zoom, each with its own amount
// setting (Swell, Fireflies; 0 turns a layer off). index.ts steps them once a
// frame and hands seeds.ts a `move` callback, which seeds.ts calls for each
// seed it lays out and caps (seeds.ts's MAX_SHIFT, MAX_WEIGHT). Pure apart
// from the Fireflies state object, so tests/chaikin.test.ts drives both
// layers with plain numbers.
//
// Units. An offset is in lattice cells: one row of U or one column of angle,
// both `delta` (seeds.ts's header), so a move is the same share of a cell at
// every radius. A weight change is in cell areas, added to the seed's
// power-diagram weight: it grows or shrinks a cell without moving its seed or
// its dot. Only differences of weight move a wall, so the same change on
// every seed moves nothing.
//
// Swell. Trains of Gerstner (trochoidal) water waves, SWELL_WAVES, running in
// the lattice's own (U, θ) coordinates. That grid is a conformal map of the
// screen, so a straight wave in it is a true wave on screen that grows with
// the cells and winds into spirals round the centre. A seed moves along its
// wave by sin(phase) and its cell shrinks by cos(phase), so cells pack
// together on a crest and spread out in a trough. Every wave makes a whole
// number of turns round the circle (Arms) and a whole number of cycles per bar
// (Travel), so it closes on itself and the field comes back to the same shape
// on every downbeat. The bar clock is the beat clock's (anim.barPhase,
// anim.beatPhase), each beat eased by Punch (`swellBar`) so the waves surge on
// the beat and settle. Order mixes in a per-seed random phase, from moving as
// one wave to every cell on its own. Stateless.
//
// Fireflies. The Kuramoto model of coupled oscillators: each seed has a phase
// φ that runs near the tempo at its own rate (Spread), is pulled toward its
// lattice neighbours' phases (Pull, times its drive squared, so the music's
// level decides how ordered the field is) and toward the beat (Beat lock),
// and a drop pulls every phase toward the beat at once (Drop sync). A seed
// pops when φ comes round: its cell swells and it steps outward (`firePop`).
// With little pull the pops land at random, with more they run across the
// field in waves and spirals, and in full step every weight rises at once, so
// the field only breathes outward. This layer has memory: phases live in a
// ring of rows keyed by the seed's global row (seeds.ts's `g`, which stays
// with a seed as the zoom carries it out), so a seed keeps its phase as it
// flies, and a row entering the ring is seeded from the hash.
import { ROW_PERIOD } from "./launch.ts";
import { cellBits, ROW_LO, TEX_W, unit24, MAX_ROWS, type SeedMove } from "./seeds.ts";

const TAU = 2 * Math.PI;
const wrapPi = (a: number): number => a - TAU * Math.round(a / TAU);

// ---- Swell ----

/** The wave trains, relative to the settings: `m` adds to (`sign` times)
 *  Arms, `k` scales the wavenumber, `n` scales Travel, `a` is the share of
 *  the height. No two share a direction or a speed, so their sum never
 *  settles into one plain pattern. */
export const SWELL_WAVES = [
  { sign: 1, m: 0, k: 1, n: 1, a: 1 },
  { sign: -1, m: -2, k: 1 / 0.62, n: 2, a: 0.45 },
  { sign: 0, m: 0, k: 1 / 1.7, n: -1, a: 0.35 },
] as const;
/** Offset and weight change per unit of height, in cells and cell areas. */
export const SWELL_SHIFT = 0.5;
export const SWELL_WEIGHT = 0.35;
/** The height follows the Swell drive as FLOOR + GAIN · drive. */
export const SWELL_FLOOR = 0.3;
export const SWELL_GAIN = 0.9;
/** The drive reading with nothing plugged in: the one that leaves the
 *  slider's own height. */
export const SWELL_REST = (1 - SWELL_FLOOR) / SWELL_GAIN;
const SWELL_SALT = 301;

export function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
}

/** Where in the bar the waves are, 0..1: whole beats from the bar phase,
 *  the beat in progress eased by `punch` (0 = the plain clock, 1 = each
 *  beat surges and overshoots, then holds). */
export function swellBar(barPhase: number, beatPhase: number, punch: number): number {
  const beatInBar = (((Math.round(barPhase * 4 - beatPhase) % 4) + 4) % 4);
  const b = beatPhase + (easeOutBack(beatPhase) - beatPhase) * punch;
  return (beatInBar + b) / 4;
}

export interface SwellInput {
  /** Height after its drive (0 = still). */
  height: number;
  /** Cells between crests. */
  wavelength: number;
  arms: number;
  travel: number;
  order: number;
  /** swellBar's reading. */
  bar: number;
  /** The lattice's cell size in U (seeds.ts's `delta`). */
  delta: number;
}

export interface SwellWave {
  ku: number;
  m: number;
  phase: number;
  a: number;
  /** The wave's direction in (U, θ), unit length. */
  eu: number;
  et: number;
}

export interface Swell {
  height: number;
  order: number;
  waves: SwellWave[];
}

export function swellFrame(inp: SwellInput): Swell {
  const ku0 = TAU / (Math.max(inp.wavelength, 1) * inp.delta);
  const arms = Math.round(inp.arms);
  const travel = Math.round(inp.travel);
  const waves = SWELL_WAVES.map((w) => {
    const ku = ku0 * w.k;
    const m = w.sign * arms + w.m;
    const len = Math.hypot(ku, m) || 1;
    return { ku, m, phase: TAU * w.n * travel * inp.bar, a: w.a, eu: ku / len, et: m / len };
  });
  return { height: inp.height, order: inp.order, waves };
}

/** Adds the swell's move for the seed at (u, θ), column `c` of global row
 *  `g`, to `out`. */
export function addSwell(s: Swell, u: number, th: number, g: number, c: number, out: SeedMove): void {
  if (s.height <= 0) return;
  const rnd = s.order < 1 ? (1 - s.order) * TAU * unit24(cellBits(c, g, SWELL_SALT)) : 0;
  let du = 0;
  let dth = 0;
  let dw = 0;
  for (const w of s.waves) {
    const ph = w.ku * u + w.m * th - w.phase + rnd;
    const sn = Math.sin(ph) * w.a;
    du -= sn * w.eu;
    dth -= sn * w.et;
    dw -= Math.cos(ph) * w.a;
  }
  out.du += SWELL_SHIFT * s.height * du;
  out.dth += SWELL_SHIFT * s.height * dth;
  out.dw += SWELL_WEIGHT * s.height * dw;
}

// ---- Fireflies ----

/** Pull and Beat lock at 1, in radians per second. */
export const PULL_GAIN = 20;
export const LOCK_GAIN = 6;
/** Spread at 1: each seed's own tempo lies within this share either side of
 *  the beat's. */
export const SPREAD_RANGE = 0.4;
/** The longest integration step, seconds; a longer frame is split. */
export const MAX_SUBSTEP = 1 / 90;
/** Tempo when the beat clock has none yet. */
export const FALLBACK_BPM = 120;
/** How sharp a pop is: pop = max(0, cos φ)^POP_SHARPNESS. */
export const POP_SHARPNESS = 6;
/** The mean of that pop over a turn, taken off the weight so the field's
 *  average weight stays where the births and the centre seed expect it. */
export const POP_MEAN = 5 / 32;
/** Weight change and outward step at the top of a pop, at Fireflies 1. */
export const POP_WEIGHT = 1.2;
export const POP_PUSH = 0.45;
/** Rows of phase kept, a power of two above the rows a frame can fill. */
export const FLY_RING = 128;
const PHASE_SALT = 411;
const RATE_SALT = 413;

export interface Fireflies {
  /** Phase per (ring row, column). */
  ring: Float64Array;
  /** Each seed's tempo offset, −1..1, beside its phase. */
  rate: Float32Array;
  /** The global row each ring row holds (−1 = none). */
  tag: Int32Array;
  /** This frame's phases by local row (seeds.ts's `t`) × column. */
  grid: Float64Array;
  rows: number;
  cols: number;
}

export function createFireflies(): Fireflies {
  return {
    ring: new Float64Array(FLY_RING * TEX_W),
    rate: new Float32Array(FLY_RING * TEX_W),
    tag: new Int32Array(FLY_RING).fill(-1),
    grid: new Float64Array(MAX_ROWS * TEX_W),
    rows: 0,
    cols: 0,
  };
}

export function resetFireflies(f: Fireflies): void {
  f.tag.fill(-1);
  f.rows = 0;
}

export interface FirefliesInput {
  dtSec: number;
  /** The frame's lattice: rows filled from ROW_LO, columns, whole zoom rows. */
  rows: number;
  cols: number;
  zRow: number;
  bpm: number;
  beatPhase: number;
  /** Neighbour pull, 0..1 after its drive. */
  pull: number;
  lock: number;
  spread: number;
  /** A drop this frame: how far every phase moves toward the beat, 0..1. */
  snap: number;
}

const sinS = new Float64Array(MAX_ROWS * TEX_W);
const cosS = new Float64Array(MAX_ROWS * TEX_W);
const next = new Float64Array(MAX_ROWS * TEX_W);

/** Brings the frame's rows into `grid` (seeding rows new to the ring),
 *  advances every phase by `dtSec` and writes them back. `dtSec` 0 only
 *  gathers. */
export function stepFireflies(f: Fireflies, inp: FirefliesInput): void {
  const rows = Math.min(inp.rows, MAX_ROWS);
  const cols = Math.min(inp.cols, TEX_W);
  const { ring, rate, tag, grid } = f;
  for (let t = 0; t < rows; t++) {
    const g = (((t + ROW_LO - inp.zRow) % ROW_PERIOD) + ROW_PERIOD) % ROW_PERIOD;
    const slot = g & (FLY_RING - 1);
    const base = slot * TEX_W;
    if (tag[slot] !== g) {
      tag[slot] = g;
      for (let c = 0; c < TEX_W; c++) {
        ring[base + c] = TAU * unit24(cellBits(c, g, PHASE_SALT));
        rate[base + c] = 2 * unit24(cellBits(c, g, RATE_SALT)) - 1;
      }
    }
    for (let c = 0; c < cols; c++) grid[t * cols + c] = ring[base + c];
  }
  f.rows = rows;
  f.cols = cols;
  const dt = Math.max(0, inp.dtSec);
  if (dt > 0) {
    const bps = (inp.bpm > 0 ? inp.bpm : FALLBACK_BPM) / 60;
    const K = PULL_GAIN * Math.max(0, inp.pull);
    const F = LOCK_GAIN * Math.max(0, inp.lock);
    const sub = Math.max(1, Math.ceil(dt / MAX_SUBSTEP));
    const h = dt / sub;
    const n = rows * cols;
    for (let s = 0; s < sub; s++) {
      for (let i = 0; i < n; i++) {
        sinS[i] = Math.sin(grid[i]);
        cosS[i] = Math.cos(grid[i]);
      }
      // The beat's phase at the end of this substep.
      const beat = TAU * (inp.beatPhase - (sub - s - 1) * h * bps);
      for (let t = 0; t < rows; t++) {
        const slot = ((((t + ROW_LO - inp.zRow) % ROW_PERIOD) + ROW_PERIOD) % ROW_PERIOD) & (FLY_RING - 1);
        for (let c = 0; c < cols; c++) {
          const i = t * cols + c;
          const cl = c === 0 ? cols - 1 : c - 1;
          const cr = c === cols - 1 ? 0 : c + 1;
          let S = sinS[t * cols + cl] + sinS[t * cols + cr];
          let C = cosS[t * cols + cl] + cosS[t * cols + cr];
          let k = 2;
          for (let tt = t - 1; tt <= t + 1; tt += 2) {
            if (tt < 0 || tt >= rows) continue;
            const b = tt * cols;
            S += sinS[b + cl] + sinS[b + c] + sinS[b + cr];
            C += cosS[b + cl] + cosS[b + c] + cosS[b + cr];
            k += 3;
          }
          // Σ sin(φj − φi) = cos φi · Σ sin φj − sin φi · Σ cos φj.
          const coupling = (cosS[i] * S - sinS[i] * C) / k;
          const omega = TAU * bps * (1 + SPREAD_RANGE * inp.spread * rate[slot * TEX_W + c]);
          next[i] = grid[i] + h * (omega + K * coupling + F * Math.sin(beat - grid[i]));
        }
      }
      for (let i = 0; i < n; i++) grid[i] = next[i] - TAU * Math.floor(next[i] / TAU);
    }
  }
  if (inp.snap > 0) {
    const beat = TAU * inp.beatPhase;
    const a = Math.min(1, inp.snap);
    for (let i = 0; i < rows * cols; i++) grid[i] += a * wrapPi(beat - grid[i]);
  }
  for (let t = 0; t < rows; t++) {
    const g = (((t + ROW_LO - inp.zRow) % ROW_PERIOD) + ROW_PERIOD) % ROW_PERIOD;
    const base = (g & (FLY_RING - 1)) * TEX_W;
    for (let c = 0; c < cols; c++) ring[base + c] = grid[t * cols + c];
  }
}

/** How far into its pop the seed in local row `t`, column `c` is, 0..1. */
export function firePop(f: Fireflies, t: number, c: number): number {
  if (t < 0 || t >= f.rows || c >= f.cols) return 0;
  return Math.max(0, Math.cos(f.grid[t * f.cols + c])) ** POP_SHARPNESS;
}

/** Adds a firefly's pop to the seed's move, at Fireflies `amount`. */
export function addPop(f: Fireflies, amount: number, t: number, c: number, out: SeedMove): void {
  if (amount <= 0) return;
  const pop = firePop(f, t, c);
  out.dw += amount * POP_WEIGHT * (pop - POP_MEAN);
  out.du += amount * POP_PUSH * pop;
}

/** How much in step the frame's phases are: |mean of e^{iφ}|, 0 (scattered)
 *  to 1 (one phase). */
export function fireOrder(f: Fireflies): number {
  const n = f.rows * f.cols;
  if (!n) return 0;
  let s = 0;
  let c = 0;
  for (let i = 0; i < n; i++) {
    s += Math.sin(f.grid[i]);
    c += Math.cos(f.grid[i]);
  }
  return Math.hypot(s, c) / n;
}
