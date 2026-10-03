/**
 * A self-contained, pure-TS port of the "Physarum Lab" prototype's
 * `createStrainPreview` (docs/scenes/physarum2/artifacts/strainPreview.js) —
 * the tiny single-strain Physarum sim behind each specimen box's live
 * pure-culture preview (src/ui/widgets/previews.ts, itemBoxes.ts). No DOM:
 * this module never touches `document`/`canvas`/`ImageData` so it runs and
 * is tested under plain Node (tests/physarum2Preview.test.ts) exactly like
 * every other pure module in src/render/ — the UI side (previews.ts) owns
 * turning `pixels()`'s raw RGBA buffer into an actual on-screen canvas via
 * putImageData.
 *
 * This is deliberately its own tiny torus, not a CPU mirror of the real
 * scene's trail map: a box is meant to look like a zoomed patch of one
 * strain's own network, at a size cheap enough to run four of, continuously,
 * inside the device menu. `motion` (see `StrainPreviewMotion` below) is
 * supplied by the caller in this preview's OWN cell units — the caller
 * (previews.ts) is the one place that converts physarum2.ts's
 * `resolveStrainEffective` (reference-texel units) into these, with one
 * documented constant (REF_TEXELS_PER_PREVIEW_CELL) — so the two simulations
 * share exactly one strain-motion formula (physarum2.ts's file header, "the
 * one strain-motion mapping") even though they run on differently-sized
 * fields.
 *
 * `createPairCulture` (2026-09-27, the Pairs widget) is the same idea for
 * *two* strains at once: a pure port of the prototype's `makeCulture` called
 * with `K = 2` (`affinity-studio.html:514-602`), so a Pairs pad's own live
 * two-strain dish reads Touch's feed/eat exactly the way a specimen box's
 * `StrainPreview` reads Smell alone. It shares `TOUCH_FEED_GAIN`/
 * `TOUCH_EAT_GAIN`/`TOUCH_MAX_BITE` with physarum2.ts's GPU packing
 * (physarum2Affinity.ts) rather than recalibrating for the CPU, so a pad's
 * preview and the main dish agree on what a given Touch value looks like.
 */

import { TOUCH_EAT_GAIN, TOUCH_FEED_GAIN, TOUCH_MAX_BITE } from "./physarum2Affinity.ts";

const TWO_PI = Math.PI * 2;

/** The factor one step's blur+decay multiplies the (3x3-summed) trail by: the
 *  shared 10% evaporation, scaled by Trail life (`decayMul`, 1 or omitted =
 *  shared) and divided by the kernel's 9. Shared by both cultures so a pad's
 *  dish and a box's specimen age their trails alike. */
function decayKeep(decayMul: number | undefined): number {
  return (1 - 0.1 * Math.max(0, Math.min(9, decayMul ?? 1))) / 9;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function rnd(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One step's motion, in this preview's own cell units (see the file header)
 *  — the same five numbers strainPreview.js's own `strainMotion()`/
 *  `applySurge()` produced, just supplied directly here instead of computed
 *  from raw slider values, since that computation is now
 *  physarum2.ts's shared `resolveStrainEffective`. */
export interface StrainPreviewMotion {
  /** Radians — the strain's fixed sensor-layout angle (STRAINS entry). */
  sensorAngle: number;
  /** Cells — how far ahead each of the three sensors probes. */
  reach: number;
  /** Radians — how sharply the agent turns when it turns at all. */
  turn: number;
  /** Cells — how far the agent moves this step. */
  step: number;
  /** Absolute amount added to the landed cell's trail value this step. */
  deposit: number;
  /** Multiplier on the preview's evaporation (Trail life —
   *  physarum2.ts's `lifeToDecayMul`); 1 or omitted is the shared decay. */
  decayMul?: number;
}

export interface StrainPreview {
  readonly size: number;
  /** Runs exactly one simulation step (agents sense/turn/move/deposit, then
   *  the trail blurs+decays) — see the file header. */
  step(motion: StrainPreviewMotion): void;
  /** Renders the current trail as a flat RGBA buffer (`size*size*4` bytes,
   *  gamma 1/2.2 and the same 0.85 exposure the prototype's own `draw()`
   *  used), tinted by `rgb` (each 0..1). Pure — no DOM; the caller
   *  (previews.ts) is the one that puts this into an actual canvas. */
  pixels(rgb: readonly [number, number, number]): Uint8ClampedArray;
  /** `pixels`, written into a caller-owned buffer (`size*size*4` bytes) — no
   *  per-call allocation, for a box that redraws on every panel tick. */
  pixelsInto(out: Uint8ClampedArray, rgb: readonly [number, number, number]): void;
}

// Fraction of agents re-spawned at random each step. A pure culture has no
// rival strain to push against, so without this it keeps coarsening until
// one thick loop holds most of the trail (measured 2026-09-27 with a node
// harness: Spotter reached 76% of its trail in the densest 2% of cells after
// 900 steps with surges). A small constant trickle of fresh agents keeps it
// exploring, which is also what a real plasmodium's growing front does.
const RESPAWN_PER_STEP = 0.005;

// The prototype's own draw() constants — kept identical so a box's preview
// reads at the same brightness/contrast as the approved "Physarum Lab" v3.
const EXPOSURE = 0.85;
const GAMMA_INV = 1 / 2.2;

export interface StrainPreviewOptions {
  size?: number;
  agents?: number;
  seed?: number;
}

export function createStrainPreview(opts: StrainPreviewOptions = {}): StrainPreview {
  const size = Math.max(1, Math.floor(opts.size ?? 64));
  const agents = Math.max(1, Math.floor(opts.agents ?? 2000));
  const rnd = mulberry32(opts.seed ?? 1);
  const CELLS = size * size;
  const trail = new Float32Array(CELLS);
  const tmp = new Float32Array(CELLS);
  const ax = new Float32Array(agents);
  const ay = new Float32Array(agents);
  const ah = new Float32Array(agents);
  for (let i = 0; i < agents; i++) {
    ax[i] = rnd() * size;
    ay[i] = rnd() * size;
    ah[i] = rnd() * TWO_PI;
  }

  const GAMMA = new Float32Array(256);
  for (let i = 0; i < 256; i++) GAMMA[i] = Math.pow(i / 255, GAMMA_INV);

  function sense(x: number, y: number): number {
    // Math.floor, not |0: |0 truncates toward zero, so small negative probe
    // coordinates near the seam wrap to the wrong edge and bias the sensed
    // trail toward row/col 0 -- very visible on this small single-strain
    // torus since there's no other strain's trail to compete against it.
    let xi = Math.floor(x);
    let yi = Math.floor(y);
    xi = ((xi % size) + size) % size;
    yi = ((yi % size) + size) % size;
    return trail[yi * size + xi]!;
  }

  function step(m: StrainPreviewMotion): void {
    for (let i = 0; i < agents; i++) {
      if (rnd() < RESPAWN_PER_STEP) {
        ax[i] = rnd() * size;
        ay[i] = rnd() * size;
        ah[i] = rnd() * TWO_PI;
        continue;
      }
      const h = ah[i]!;
      const x = ax[i]!;
      const y = ay[i]!;
      const sC = sense(x + Math.cos(h) * m.reach, y + Math.sin(h) * m.reach);
      const sL = sense(x + Math.cos(h - m.sensorAngle) * m.reach, y + Math.sin(h - m.sensorAngle) * m.reach);
      const sR = sense(x + Math.cos(h + m.sensorAngle) * m.reach, y + Math.sin(h + m.sensorAngle) * m.reach);
      let nh = h;
      if (sC >= sL && sC >= sR) {
        // hold heading
      } else if (sL > sC && sR > sC) {
        nh += (rnd() < 0.5 ? -1 : 1) * m.turn;
      } else if (sL > sR) {
        nh -= m.turn;
      } else {
        nh += m.turn;
      }
      let nx = x + Math.cos(nh) * m.step;
      let ny = y + Math.sin(nh) * m.step;
      if (nx < 0) nx += size;
      else if (nx >= size) nx -= size;
      if (ny < 0) ny += size;
      else if (ny >= size) ny -= size;
      ax[i] = nx;
      ay[i] = ny;
      ah[i] = nh;
      trail[(ny | 0) * size + (nx | 0)]! += m.deposit;
    }
    // 3x3 box blur (separable, wrapped) + decay -- the same kernel as the
    // dish sim, so a box shows the strain's real grain. RESPAWN_PER_STEP,
    // not a wider blur, is what keeps a pure culture from collapsing.
    for (let y = 0; y < size; y++) {
      const r = y * size;
      for (let x = 0; x < size; x++) {
        tmp[r + x] = trail[r + ((x + size - 1) % size)]! + trail[r + x]! + trail[r + ((x + 1) % size)]!;
      }
    }
    const keep = decayKeep(m.decayMul);
    for (let y = 0; y < size; y++) {
      const r = y * size;
      const up = ((y + size - 1) % size) * size;
      const dn = ((y + 1) % size) * size;
      for (let x = 0; x < size; x++) {
        trail[r + x] = (tmp[up + x]! + tmp[r + x]! + tmp[dn + x]!) * keep;
      }
    }
  }

  function pixelsInto(out: Uint8ClampedArray, rgb: readonly [number, number, number]): void {
    for (let p = 0, q = 0; p < CELLS; p++, q += 4) {
      let t = trail[p]! * EXPOSURE;
      if (t > 1) t = 1;
      t = GAMMA[(t * 255) | 0]!;
      out[q] = Math.min(255, t * rgb[0]! * 255);
      out[q + 1] = Math.min(255, t * rgb[1]! * 255);
      out[q + 2] = Math.min(255, t * rgb[2]! * 255);
      out[q + 3] = 255;
    }
  }

  function pixels(rgb: readonly [number, number, number]): Uint8ClampedArray {
    const out = new Uint8ClampedArray(CELLS * 4);
    pixelsInto(out, rgb);
    return out;
  }

  return { size, step, pixels, pixelsInto };
}

// ---------------------------------------------------------------------
// Pair cultures — a live two-strain dish behind one Pairs pad. See this
// file's header.
// ---------------------------------------------------------------------

/** 0..1 per channel, same convention as `StrainPreview.pixels`'s `rgb`. */
export type RGB = readonly [number, number, number];

/** Fraction of agents re-spawned at random each step — the prototype's own
 *  pair-culture value (`affinity-studio.html`'s `ensurePairCultures`:
 *  `makeCulture(72, 72, 1600, [a, b], 0.004)`), higher than the single-strain
 *  `RESPAWN_PER_STEP` since a two-strain dish this small coarsens faster. */
export const PAIR_RESPAWN_PER_STEP = 0.004;

export interface PairCultureInputs {
  motion: readonly [StrainPreviewMotion, StrainPreviewMotion];
  /** `smell[i][j]` — strain `i`'s sensing weight against strain `j`'s trail,
   *  in this pad's own *local* 0/1 indices (not the scene's strain indices),
   *  Cross-smell already folded in (`smellWeight`) for `i !== j`; `i === j` is
   *  the (unaffected) own-trail weight. */
  smell: readonly [readonly [number, number], readonly [number, number]];
  /** `touch[i][j]` — what strain `i`'s steps do to strain `j`'s trail, same
   *  local indices; the diagonal is never read (Touch has no own-strain
   *  meaning, `defineItemPairs`'s `diagonal: false`). */
  touch: readonly [readonly [number, number], readonly [number, number]];
}

export interface PairCulture {
  readonly size: number;
  /** Runs one simulation step for both strains at once — sense/turn/move,
   *  Touch's feed/eat at the landed cell, then each channel's own 3x3
   *  blur+decay (`StrainPreview.step`'s own kernel). */
  step(inputs: PairCultureInputs): void;
  /** Renders both channels, additively combined and tinted by `colors`, into
   *  a caller-owned buffer (`out`, `size*size*4` bytes) — no per-frame
   *  allocation, since a pad redraws whenever it steps (pairPads.ts's own
   *  stepping cadence). Alpha is always 255. */
  pixelsInto(out: Uint8ClampedArray, colors: readonly [RGB, RGB]): void;
  /** Each channel's raw trail sum — for tests only (a pixel-space assertion
   *  would have to redo the same gamma/exposure curve `pixelsInto` applies). */
  totals(): [number, number];
  /** Both channels' raw trail maps (`size*size`, row-major), live — read
   *  them, never write. For measuring what a culture is doing (how much of
   *  their territory two strains share) without `pixelsInto`'s clip. */
  trails(): readonly [Float32Array, Float32Array];
  /** The scene's automatic beat reseed, at pad scale: each agent, with
   *  probability `share`, jumps into one disc of `radius` (a fraction of the
   *  dish's side, like the scene's field-unit Spread) at a random centre,
   *  with a random heading and its strain unchanged. Without this a pad's
   *  network settles into a fixed shape within seconds, while the scene's
   *  own keeps being rebuilt on every beat. */
  seedColony(share: number, radius: number): void;
}

/** The value at quantile `q` (0..1) of every `stride`-th cell of `trail` —
 *  a cheap sorted sample, 0 for an empty map. A pad keeps this at 0.98 per
 *  channel as the bright end `pairContactPixelsInto` scales to. */
export function trailQuantile(trail: Float32Array, q: number, stride = 5): number {
  const s: number[] = [];
  for (let i = 0; i < trail.length; i += stride) s.push(trail[i]!);
  if (s.length === 0) return 0;
  s.sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))]!;
}

/** How much ground two strains share, 0..1: each strain's trail summed into
 *  `block`×`block` cells and normalised to sum 1, then `Σ min(pA, pB)` (1 for
 *  identical maps, 0 for disjoint ones, 0 when either strain is empty). The
 *  same measure as `together()` in
 *  docs/scenes/physarum2/scripts/padresponse.mjs. `size` is the maps' side. */
export function pairOverlap(trails: readonly [Float32Array, Float32Array], size: number, block = 6): number {
  const n = Math.floor(size / block);
  if (n <= 0) return 0;
  const a = new Float64Array(n * n);
  const b = new Float64Array(n * n);
  for (let y = 0; y < n * block; y++) {
    const row = Math.floor(y / block) * n;
    for (let x = 0; x < n * block; x++) {
      const k = row + Math.floor(x / block);
      const p = y * size + x;
      a[k]! += trails[0][p]!;
      b[k]! += trails[1][p]!;
    }
  }
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < a.length; i++) {
    sa += a[i]!;
    sb += b[i]!;
  }
  if (!(sa > 0 && sb > 0)) return 0;
  let o = 0;
  for (let i = 0; i < a.length; i++) o += Math.min(a[i]! / sa, b[i]! / sb);
  return o;
}

const GAMMA_TABLE = new Float32Array(256);
for (let i = 0; i < 256; i++) GAMMA_TABLE[i] = Math.pow(i / 255, GAMMA_INV);

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** A pad's picture in "contact" colours (the Clearer-pads look): each strain
 *  keeps its own colour and the ground they share turns white, instead of the
 *  two hues adding into one mixed shade (`PairCulture.pixelsInto`). Each
 *  channel is scaled to its own bright end (`exposure`, a
 *  `trailQuantile(…, 0.98)` the caller keeps) instead of one fixed exposure,
 *  so dense paths stop clipping. `trails` are a culture's raw maps
 *  (`PairCulture.trails()`), `out` is `size*size*4` bytes, alpha 255. */
export function pairContactPixelsInto(
  trails: readonly [Float32Array, Float32Array],
  size: number,
  out: Uint8ClampedArray,
  colors: readonly [RGB, RGB],
  exposure: readonly [number, number],
): void {
  const kA = 1 / Math.max(1e-4, exposure[0]);
  const kB = 1 / Math.max(1e-4, exposure[1]);
  const [cA, cB] = colors;
  const tA = trails[0];
  const tB = trails[1];
  const cells = size * size;
  for (let p = 0, q = 0; p < cells; p++, q += 4) {
    const a = Math.min(1, tA[p]! * kA);
    const b = Math.min(1, tB[p]! * kB);
    const m = a > b ? a : b;
    let r = 0;
    let g = 0;
    let bl = 0;
    if (m >= 0.003) {
      const w = smoothstep(0.3, 0.75, (a < b ? a : b) / m);
      const base = a >= b ? cA : cB;
      const l = GAMMA_TABLE[(m * 255) | 0]!;
      r = (base[0] * (1 - w) + w) * l;
      g = (base[1] * (1 - w) + w) * l;
      bl = (base[2] * (1 - w) + w) * l;
    }
    out[q] = Math.min(255, r * 255);
    out[q + 1] = Math.min(255, g * 255);
    out[q + 2] = Math.min(255, bl * 255);
    out[q + 3] = 255;
  }
}

export interface PairCultureOptions {
  size?: number;
  agents?: number;
  seed?: number;
}

/** A pure port of the prototype's `makeCulture` fixed at `K = 2` — see this
 *  file's header. Deliberately its own tiny torus per pad, exactly like
 *  `createStrainPreview`, not a slice of the real scene's trail map. */
export function createPairCulture(opts: PairCultureOptions = {}): PairCulture {
  const size = Math.max(1, Math.floor(opts.size ?? 72));
  const agents = Math.max(1, Math.floor(opts.agents ?? 1600));
  const rnd = mulberry32(opts.seed ?? 1);
  const CELLS = size * size;
  const trail: [Float32Array, Float32Array] = [new Float32Array(CELLS), new Float32Array(CELLS)];
  const tmp = new Float32Array(CELLS);
  const ax = new Float32Array(agents);
  const ay = new Float32Array(agents);
  const ah = new Float32Array(agents);
  // Fixed 50/50 split by index parity — same as the prototype's `kinds`
  // list, and simpler than physarum2.ts's own Share-weighted `assign` (no
  // per-strain Share setting exists for a two-strain pad).
  const ak = new Uint8Array(agents);
  for (let i = 0; i < agents; i++) {
    ax[i] = rnd() * size;
    ay[i] = rnd() * size;
    ah[i] = rnd() * TWO_PI;
    ak[i] = i & 1;
  }

  const GAMMA = new Float32Array(256);
  for (let i = 0; i < 256; i++) GAMMA[i] = Math.pow(i / 255, GAMMA_INV);

  function sense(x: number, y: number, w0: number, w1: number): number {
    let xi = Math.floor(x);
    let yi = Math.floor(y);
    xi = ((xi % size) + size) % size;
    yi = ((yi % size) + size) % size;
    const p = yi * size + xi;
    return w0 * trail[0]![p]! + w1 * trail[1]![p]!;
  }

  function step(inputs: PairCultureInputs): void {
    const { motion, smell, touch } = inputs;
    for (let i = 0; i < agents; i++) {
      if (rnd() < PAIR_RESPAWN_PER_STEP) {
        ax[i] = rnd() * size;
        ay[i] = rnd() * size;
        ah[i] = rnd() * TWO_PI;
        continue;
      }
      const a = ak[i]! as 0 | 1;
      const m = motion[a]!;
      const w0 = smell[a]![0]!;
      const w1 = smell[a]![1]!;
      const h = ah[i]!;
      const x = ax[i]!;
      const y = ay[i]!;
      const sC = sense(x + Math.cos(h) * m.reach, y + Math.sin(h) * m.reach, w0, w1);
      const sL = sense(x + Math.cos(h - m.sensorAngle) * m.reach, y + Math.sin(h - m.sensorAngle) * m.reach, w0, w1);
      const sR = sense(x + Math.cos(h + m.sensorAngle) * m.reach, y + Math.sin(h + m.sensorAngle) * m.reach, w0, w1);
      let nh = h;
      if (sC >= sL && sC >= sR) {
        // hold heading
      } else if (sL > sC && sR > sC) {
        nh += (rnd() < 0.5 ? -1 : 1) * m.turn;
      } else if (sL > sR) {
        nh -= m.turn;
      } else {
        nh += m.turn;
      }
      let nx = x + Math.cos(nh) * m.step;
      let ny = y + Math.sin(nh) * m.step;
      if (nx < 0) nx += size;
      else if (nx >= size) nx -= size;
      if (ny < 0) ny += size;
      else if (ny >= size) ny -= size;
      ax[i] = nx;
      ay[i] = ny;
      ah[i] = nh;
      const cell = (ny | 0) * size + (nx | 0);
      trail[a]![cell]! += m.deposit;
      // Touch (physarum2Affinity.ts's packTouch, the CPU twin): the other
      // local strain's channel gains a share of this deposit if fed, or
      // loses a share of what's already there if eaten. Diagonal (b === a)
      // never applies — see this function's own `touch` doc.
      const b = (1 - a) as 0 | 1;
      const v = touch[a]![b]!;
      if (v > 0) trail[b]![cell]! += v * m.deposit * TOUCH_FEED_GAIN;
      else if (v < 0) trail[b]![cell]! *= 1 - Math.min(TOUCH_MAX_BITE, -v * TOUCH_EAT_GAIN);
    }
    // 3x3 box blur (separable, wrapped) + decay, same kernel/decay as
    // StrainPreview.step (each strain's own Trail life included), applied to
    // each channel independently.
    for (let k = 0; k < 2; k++) {
      const t = trail[k]!;
      const keep = decayKeep(motion[k]!.decayMul);
      for (let y = 0; y < size; y++) {
        const r = y * size;
        for (let x = 0; x < size; x++) {
          tmp[r + x] = t[r + ((x + size - 1) % size)]! + t[r + x]! + t[r + ((x + 1) % size)]!;
        }
      }
      for (let y = 0; y < size; y++) {
        const r = y * size;
        const up = ((y + size - 1) % size) * size;
        const dn = ((y + 1) % size) * size;
        for (let x = 0; x < size; x++) {
          t[r + x] = (tmp[up + x]! + tmp[r + x]! + tmp[dn + x]!) * keep;
        }
      }
    }
  }

  function pixelsInto(out: Uint8ClampedArray, colors: readonly [RGB, RGB]): void {
    for (let p = 0, q = 0; p < CELLS; p++, q += 4) {
      let r = 0;
      let g = 0;
      let bl = 0;
      for (let k = 0; k < 2; k++) {
        let t = trail[k]![p]! * EXPOSURE;
        if (t <= 0.002) continue;
        if (t > 1) t = 1;
        t = GAMMA[(t * 255) | 0]!;
        const c = colors[k]!;
        r += t * c[0];
        g += t * c[1];
        bl += t * c[2];
      }
      out[q] = Math.min(255, r * 255);
      out[q + 1] = Math.min(255, g * 255);
      out[q + 2] = Math.min(255, bl * 255);
      out[q + 3] = 255;
    }
  }

  function totals(): [number, number] {
    let t0 = 0;
    let t1 = 0;
    for (let p = 0; p < CELLS; p++) {
      t0 += trail[0]![p]!;
      t1 += trail[1]![p]!;
    }
    return [t0, t1];
  }

  function seedColony(share: number, radius: number): void {
    if (!(share > 0)) return;
    const cx = rnd() * size;
    const cy = rnd() * size;
    const r = Math.max(0, radius) * size;
    for (let i = 0; i < agents; i++) {
      if (rnd() >= share) continue;
      const d = r * Math.sqrt(rnd());
      const th = rnd() * TWO_PI;
      ax[i] = (((cx + Math.cos(th) * d) % size) + size) % size;
      ay[i] = (((cy + Math.sin(th) * d) % size) + size) % size;
      ah[i] = rnd() * TWO_PI;
    }
  }

  function trails(): readonly [Float32Array, Float32Array] {
    return trail;
  }

  return { size, step, pixelsInto, totals, trails, seedColony };
}
