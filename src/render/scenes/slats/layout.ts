/**
 * Slats' slab/slat model — pure and CPU-only, so it's directly testable
 * (tests/slats.test.ts) without a GL context. The wall (index.ts's vertex
 * shader) is a horizontal strip tiled by `partitionSlabs` into contiguous
 * "slabs": flat-topped rectangular groups with their own height, vertical
 * offset, depth layer and translucency, after the reference's stacks of
 * overlapping bars (see index.ts's header for the source clip). Each slab is
 * then covered by many individual "slats" (`layoutSlats`) — the actual thin
 * vertical quads the shader draws — spread across the slab's width and
 * carrying the slab's own height/centre/alpha plus a per-slat `seed` (for the
 * vertex shader's flutter noise) and an occasional `hairExtra` boost that
 * makes a slat run taller than its slab: the reference's fringe of thin tall
 * "hairs" at every slab's top and bottom.
 *
 * `packSlats` flattens a slat list into the Float32Array index.ts uploads as
 * an instanced vertex buffer — see SLAT_STRIDE and its own comment for the
 * field order the shader's attributes expect.
 *
 * Two more pieces of state live here because they're pure and worth testing
 * in isolation: `OnsetEnvelope`, the fast-decay beat pulse index.ts drives a
 * height/brightness kick from (sync hypothesis 1 in the plan), and
 * `shouldReshuffle`, the bar-start gate on regenerating a fresh layout early
 * (hypothesis 3) — it only ever fires on a genuine bar wrap while the tempo
 * clock is actually locked, never on a free-running estimate.
 */

export type Rng = () => number;

/** Small deterministic PRNG (mulberry32), the same shape ambience.ts's
 *  createRng uses — a seed reproduces a whole layout, which is what makes
 *  partitionSlabs/layoutSlats testable and lets index.ts advance one shared
 *  generator across every regeneration instead of reseeding it. */
export function createRng(seed: number): Rng {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Slab {
  /** Left/right edges in world x (see index.ts's WALL_HALF_WIDTH for the
   *  world-unit scale) — contiguous across a partition, x1[i] === x0[i+1]. */
  x0: number;
  x1: number;
  /** Half-height in normalized units: 1.0 would span the whole half-band: see
   *  HALF_HEIGHT_CAP below for the actual ceiling. index.ts's heightScale
   *  turns this into a world/screen size. */
  halfHeight: number;
  /** Vertical centre offset, same normalized units as halfHeight — the
   *  reference's slabs don't all sit on one midline. */
  centre: number;
  /** Depth layer index, 0..layers-1 — which of index.ts's translucent wall
   *  copies this slab belongs to. */
  layer: number;
  /** Base translucency for every slat in this slab; index.ts's `opacity`
   *  setting scales it further. */
  alpha: number;
}

/** Half-height is drawn log-skewed toward the low end (`Math.pow(rng(), HALF_HEIGHT_SKEW)`)
 *  so most slabs read as modest bars and a few reach the cap — the reference's
 *  "per-slab height distinct" mix, not a flat random spread. */
const HALF_HEIGHT_MIN = 0.2;
const HALF_HEIGHT_CAP = 0.85;
const HALF_HEIGHT_SKEW = 1.25;
const CENTRE_SPAN = 0.32;
const ALPHA_MIN = 0.15;
const ALPHA_MAX = 0.5;

export interface PartitionOptions {
  /** Slab width bounds, as a fraction of `worldWidth`. A slab's width is
   *  drawn log-uniform between them, so widths span roughly minWidth to
   *  maxWidth rather than clustering at their average. */
  minWidthFrac: number;
  maxWidthFrac: number;
  /** Depth layers a slab can land on — Math.max(1, Math.round(layers)). */
  layers: number;
  /** Share of slabs left empty (no slats) by buildWall — the dark columns
   *  between the reference's slabs, where the ground shows through a layer. */
  gapFraction?: number;
}

/**
 * Tiles [-worldWidth/2, worldWidth/2] into contiguous slabs with no gaps or
 * overlaps: each slab's width is clamped to what's left, so the very last
 * slab may be narrower than `minWidthFrac * worldWidth` — the only case
 * where a returned slab's width can fall outside [minWidthFrac, maxWidthFrac]
 * * worldWidth (tests/slats.test.ts allows for exactly that one slab).
 */
export function partitionSlabs(rng: Rng, worldWidth: number, opts: PartitionOptions): Slab[] {
  const minW = Math.max(1e-4, opts.minWidthFrac) * worldWidth;
  const maxW = Math.max(minW, opts.maxWidthFrac * worldWidth);
  const layers = Math.max(1, Math.round(opts.layers));
  const end = worldWidth / 2;
  const slabs: Slab[] = [];
  let x = -worldWidth / 2;
  while (x < end - 1e-6) {
    const t = rng();
    const width = Math.min(end - x, minW * Math.pow(maxW / minW, t));
    const x1 = x + width;
    const halfHeight = HALF_HEIGHT_MIN + (HALF_HEIGHT_CAP - HALF_HEIGHT_MIN) * Math.pow(rng(), HALF_HEIGHT_SKEW);
    const centre = (rng() * 2 - 1) * CENTRE_SPAN;
    const layer = Math.floor(rng() * layers);
    const alpha = ALPHA_MIN + (ALPHA_MAX - ALPHA_MIN) * rng();
    slabs.push({ x0: x, x1, halfHeight, centre, layer, alpha });
    x = x1;
  }
  return slabs;
}

export interface PackedSlat {
  x: number;
  slabHalfHeight: number;
  slabCentre: number;
  alpha: number;
  layer: number;
  hairExtra: number;
  seed: number;
  slabIndex: number;
}

export interface LayoutOptions {
  /** Fraction of slats that get a hairExtra boost — the tall singleton
   *  slices that fringe a slab's top and bottom in the reference. */
  hairFraction: number;
  /** Mean of the exponential hairExtra draw, same normalized units as
   *  Slab.halfHeight. index.ts's `hair` setting scales the rendered result
   *  live, so this only shapes the baked distribution a regeneration draws
   *  from. */
  hairScale: number;
  /** Hard ceiling on a single hairExtra draw, so one freak exponential tail
   *  can't dwarf the whole wall. */
  hairMax: number;
  /** Within a slab, consecutive slats share a height factor in runs of
   *  stepMin..stepMax slats — the reference's slabs are not one flat top but
   *  a few flat steps. A run's factor is drawn in [1 - stepSpan, 1 + stepSpan]. */
  stepMin: number;
  stepMax: number;
  stepSpan: number;
  /** Per-slat alpha jitter, ±alphaJitter around the slab's alpha — what
   *  makes neighbouring slices read as distinct stripes instead of one
   *  flat fill (the reference's fine vertical edges inside every slab). */
  alphaJitter: number;
}

/**
 * Spreads exactly `n` slats across `slabs` (already left-to-right, as
 * partitionSlabs returns them), proportional to each slab's width via
 * largest-remainder apportionment — so the total is always exactly `n`,
 * even when `n` is smaller than slabs.length (some slabs then get none) or
 * `slabs` is empty (returns []). Slats land evenly spaced within their slab,
 * so the result is already monotone non-decreasing in `x` with no separate
 * sort.
 */
export function layoutSlats(slabs: readonly Slab[], n: number, rng: Rng, opts: LayoutOptions): PackedSlat[] {
  if (slabs.length === 0 || n <= 0) return [];
  const totalWidth = slabs.reduce((sum, s) => sum + (s.x1 - s.x0), 0);
  if (totalWidth <= 0) return [];

  const raw = slabs.map((s) => (n * (s.x1 - s.x0)) / totalWidth);
  const counts = raw.map((r) => Math.floor(r));
  let assigned = counts.reduce((a, b) => a + b, 0);
  const byRemainder = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  let k = 0;
  while (assigned < n && byRemainder.length > 0) {
    counts[byRemainder[k % byRemainder.length].i]++;
    assigned++;
    k++;
  }

  const slats: PackedSlat[] = [];
  slabs.forEach((slab, si) => {
    const count = counts[si];
    if (count <= 0) return;
    const width = slab.x1 - slab.x0;
    let runLeft = 0;
    let stepFactor = 1;
    for (let j = 0; j < count; j++) {
      if (runLeft <= 0) {
        runLeft = opts.stepMin + Math.floor(rng() * Math.max(1, opts.stepMax - opts.stepMin + 1));
        stepFactor = 1 + (rng() * 2 - 1) * opts.stepSpan;
      }
      runLeft--;
      const x = slab.x0 + ((j + 0.5) / count) * width;
      const isHair = rng() < opts.hairFraction;
      const hairExtra = isHair
        ? Math.min(opts.hairMax, -Math.log(Math.max(1e-6, rng())) * opts.hairScale)
        : 0;
      slats.push({
        x,
        slabHalfHeight: slab.halfHeight * stepFactor,
        slabCentre: slab.centre,
        alpha: slab.alpha * (1 + (rng() * 2 - 1) * opts.alphaJitter),
        layer: slab.layer,
        hairExtra,
        seed: rng() * 1000,
        slabIndex: si,
      });
    }
  });
  return slats;
}

/**
 * The whole wall: one independent partition per depth layer, each covering
 * the full width and each given an equal share of the slat budget, so slabs
 * on different layers overlap in x — that overlap is where the reference's
 * cores saturate to white, and a single partition with layers assigned per
 * slab (never overlapping) could not produce it. Slats come back layer by
 * layer, monotone in x within a layer; the layer index is stamped from the
 * partition, so every slab in a partition sits on that partition's layer.
 */
export function buildWall(
  rng: Rng,
  worldWidth: number,
  part: PartitionOptions,
  n: number,
  opts: LayoutOptions,
): PackedSlat[] {
  const layers = Math.max(1, Math.round(part.layers));
  const out: PackedSlat[] = [];
  for (let layer = 0; layer < layers; layer++) {
    const gap = part.gapFraction ?? 0;
    const slabs = partitionSlabs(rng, worldWidth, { ...part, layers: 1 })
      .map((s) => ({ ...s, layer }))
      .filter(() => rng() >= gap);
    const share = Math.floor(n / layers) + (layer < n % layers ? 1 : 0);
    out.push(...layoutSlats(slabs, share, rng, opts));
  }
  return out;
}

/** Floats per slat in packSlats' output — two vec4 vertex attributes' worth
 *  (index.ts's aSlatA0/aSlatA1, or aSlatB0/aSlatB1), in this exact order:
 *  x, slabHalfHeight, slabCentre, alpha | layer, hairExtra, seed, slabIndex. */
export const SLAT_STRIDE = 8;

export function packSlats(slats: readonly PackedSlat[]): Float32Array {
  const out = new Float32Array(slats.length * SLAT_STRIDE);
  for (let i = 0; i < slats.length; i++) {
    const s = slats[i];
    const o = i * SLAT_STRIDE;
    out[o] = s.x;
    out[o + 1] = s.slabHalfHeight;
    out[o + 2] = s.slabCentre;
    out[o + 3] = s.alpha;
    out[o + 4] = s.layer;
    out[o + 5] = s.hairExtra;
    out[o + 6] = s.seed;
    out[o + 7] = s.slabIndex;
  }
  return out;
}

/** Time constant of the beat-triggered height/brightness kick (sync
 *  hypothesis 1) — short enough to read as a strike, the same family as
 *  caustics.ts's RIPPLE_ATTACK_SEC/LURCH_DECAY_PER_SEC. */
export const ONSET_ENV_TAU_SEC = 0.12;

export interface OnsetEnvelope {
  value: number;
}

export function createOnsetEnvelope(): OnsetEnvelope {
  return { value: 0 };
}

/** Decays `state.value` exponentially toward 0, then snaps it to 1 on
 *  `onset` — a fresh beat always wins even mid-decay. Pure aside from
 *  `state`, and exported so tests/slats.test.ts can pin the decay/retrigger
 *  shape directly. A non-finite or backwards dt is treated as no time
 *  passing, the same guard caustics.ts's advanceLurch and ambience.ts's
 *  choreographer use. */
export function advanceOnsetEnvelope(
  state: OnsetEnvelope,
  dtSec: number,
  onset: boolean,
  tauSec: number = ONSET_ENV_TAU_SEC,
): number {
  const dt = Number.isFinite(dtSec) && dtSec > 0 ? dtSec : 0;
  state.value *= Math.exp(-dt / tauSec);
  if (onset) state.value = 1;
  return state.value;
}

/**
 * The bar-start reshuffle gate (sync hypothesis 3): true only when barPhase
 * just wrapped (a new bar started, seen as `barPhase < prevBarPhase`) while
 * the phase-locked clock is actually holding a tempo (`tempoLock >= 0.5` —
 * AnimFrame has no phrase/bar counter, so a bar wrap is the closest real
 * signal, per the plan's beatClock.ts to-do), and then only with
 * `probability` chance so every bar doesn't reform. A free-running or
 * unlocked clock never reshuffles, so the layout doesn't reform on a guess.
 */
export function shouldReshuffle(
  prevBarPhase: number,
  barPhase: number,
  tempoLock: number,
  probability: number,
  rng: Rng,
): boolean {
  const wrapped = barPhase < prevBarPhase;
  if (!wrapped || tempoLock < 0.5) return false;
  return rng() < probability;
}
