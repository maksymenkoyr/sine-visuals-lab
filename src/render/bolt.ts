/**
 * Lifted from the Storm scene's bolt generator (`src/render/scenes/storm.ts`
 * on `origin/worktree-storm-scene`) so the Fluid scene's lightning and
 * Storm's own lightning share one implementation instead of two copies of
 * the same math. Storm's branch should import from here when it lands,
 * rather than keeping its own copy.
 *
 * A bolt is a branched tree of jagged polylines (`jagPolyline`'s midpoint
 * displacement) packed into one strike's fixed slice of a shared vertex
 * buffer, meant to be drawn as a single TRIANGLE_STRIP ribbon — see
 * `buildBoltTree`'s own header for the packing. `strikeEnvelope` is the
 * brightness curve a strike follows after it fires: an exponential decay
 * plus a train of "return stroke" re-flashes.
 *
 * Pure and GL-free by design: every scene that draws bolts owns its own
 * vertex/fragment programs, its own render target and its own strike pool
 * (endpoints, refractory, amplitude — see `src/render/scenes/fluidBolts.ts`
 * for the Fluid scene's) and calls into this module only for the shape and
 * timing math. 2D callers (the Fluid scene) pass z = 0 throughout; the
 * 3-component layout stays so a 3D caller (Storm) can adopt this module
 * unchanged. Unlike Storm's original, `buildBoltTree` here does not clamp
 * branch tips to any bounding volume — Storm's version pulled them back
 * inside its cloud's ellipsoid, which is scene geometry this module has no
 * business knowing about. A caller that needs its bolts contained should
 * clamp the endpoints it passes in, or clamp `buildBoltTree`'s output.
 */

/** Segments in a bolt's main channel; the channel is this many vertices plus
 *  one. */
export const BOLT_SEGMENTS = 16;
/** Segments in one branch, main or sub — every branch is the same length in
 *  vertices so a branch slot is a fixed stride into the strike's budget. */
export const BOLT_BRANCH_SEGMENTS = 6;
/** Branch slots a strike's tree is allowed. Primary branches and their
 *  sub-branches draw from the one pool, so a bolt with fewer primaries can
 *  spend the difference going a level deeper. */
export const BOLT_MAX_BRANCHES = 6;
/** Path vertices one strike's whole tree is packed into: the main channel
 *  plus every branch slot, filled or not. Fixed, so a slot's slice of the
 *  shared vertex buffer never moves. */
export const BOLT_PATH_VERTS = BOLT_SEGMENTS + 1 + BOLT_MAX_BRANCHES * (BOLT_BRANCH_SEGMENTS + 1);
/** Ribbon vertices per strike: buildBoltTree writes every path vertex twice,
 *  once per side of the ribbon (see its header). */
export const BOLT_RIBBON_VERTS = BOLT_PATH_VERTS * 2;
/** Floats per ribbon vertex: position, tangent, signed half-width, level. */
export const BOLT_VERT_FLOATS = 8;

// Sideways displacement of the coarsest midpoint, as a fraction of the
// polyline's own length — halved at every finer level, so no vertex ends up
// further than about twice this off the straight line. Branches kink harder
// for their length than the channel they came off, which is what keeps a
// short branch from reading as a straight whisker.
export const BOLT_JITTER = 0.22;
export const BOLT_BRANCH_JITTER = 0.34;
// How many primary branches leave the main channel, and how likely each of
// them is to fork once more while a branch slot is left.
export const BOLT_BRANCH_MIN = 3;
export const BOLT_BRANCH_MAX = 4;
export const BOLT_SUB_CHANCE = 0.65;
// A branch's length as a fraction of its parent's, and how far off the
// parent's own direction it leaves, in radians. Both ends of the angle range
// stay well short of a right angle: a branch that leaves sideways reads as a
// separate bolt rather than as part of this one.
export const BOLT_BRANCH_LEN_MIN = 0.22;
export const BOLT_BRANCH_LEN_MAX = 0.5;
export const BOLT_BRANCH_ANGLE_MIN = 0.35;
export const BOLT_BRANCH_ANGLE_MAX = 0.95;
// A branch's peak width as a fraction of its parent's width where it leaves.
export const BOLT_BRANCH_WIDTH = 0.62;
// The width profile along a polyline: sin(pi * t) raised to this, so a
// channel is 0 wide at both tips (which is what lets one triangle strip run
// through every polyline in the tree — the joins between them collapse) and
// broad across its middle rather than a lens. Below 1 it plateaus; the lower
// it goes the more of the channel is at full width.
export const BOLT_TAPER_POW = 0.35;

/** mulberry32: a small deterministic PRNG so a bolt's shape (and tests) are
 *  reproducible for a given seed. Returns values in [0, 1). */
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

/** Deterministic [0,1) hash of a (seed, index) pair — what strikeEnvelope
 *  uses to place return strokes, so a given strike flickers the same way on
 *  every tick rather than jittering. */
function hash01(seed: number, k: number): number {
  const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** The kink every polyline in a bolt is drawn with: midpoint displacement —
 *  the midpoint of a span is pushed sideways off the line between its own
 *  ends, and each finer level is pushed half as far, which is what gives
 *  lightning its self-similar shape. The endpoints stay exactly on `a` and
 *  `b`, and no vertex strays further than about 2 * `jitter` of the length
 *  off the straight line.
 *
 *  Spans are split by index rather than by halving a power-of-two grid, so
 *  the segment count needn't be a power of two: each recursion sets exactly
 *  its own midpoint, and every interior vertex is some span's midpoint. */
export function jagPolyline(
  rng: () => number,
  a: readonly number[],
  b: readonly number[],
  segments: number,
  jitter: number,
): Float32Array {
  const out = new Float32Array((segments + 1) * 3);
  out[0] = a[0];
  out[1] = a[1];
  out[2] = a[2];
  out[segments * 3] = b[0];
  out[segments * 3 + 1] = b[1];
  out[segments * 3 + 2] = b[2];

  let ax = b[0] - a[0];
  let ay = b[1] - a[1];
  let az = b[2] - a[2];
  const len = Math.hypot(ax, ay, az) || 1e-6;
  ax /= len;
  ay /= len;
  az /= len;

  const displace = (lo: number, hi: number, amp: number): void => {
    const mid = (lo + hi) >> 1;
    if (mid === lo || mid === hi) return;
    const o0 = lo * 3;
    const o1 = hi * 3;
    let mx = (out[o0] + out[o1]) * 0.5;
    let my = (out[o0 + 1] + out[o1 + 1]) * 0.5;
    let mz = (out[o0 + 2] + out[o1 + 2]) * 0.5;
    // A random direction with its along-the-bolt component removed, so the
    // kink is sideways and the path never doubles back on itself.
    let dx = rng() * 2 - 1;
    let dy = rng() * 2 - 1;
    let dz = rng() * 2 - 1;
    const along = dx * ax + dy * ay + dz * az;
    dx -= along * ax;
    dy -= along * ay;
    dz -= along * az;
    const dn = Math.hypot(dx, dy, dz);
    if (dn > 1e-6) {
      const m = (amp * (rng() * 2 - 1)) / dn;
      mx += dx * m;
      my += dy * m;
      mz += dz * m;
    }
    const om = mid * 3;
    out[om] = mx;
    out[om + 1] = my;
    out[om + 2] = mz;
    displace(lo, mid, amp * 0.5);
    displace(mid, hi, amp * 0.5);
  };
  displace(0, segments, jitter * len);
  return out;
}

/** Width along a polyline at fraction `t` of its length, before the peak it
 *  is scaled by: 0 at both tips and a long plateau between them (see
 *  BOLT_TAPER_POW). Zero tips are load-bearing — they are what lets one
 *  triangle strip run through the whole tree, since the quads that join one
 *  polyline's end to the next one's start collapse to nothing. */
export function boltWidthAt(t: number): number {
  // The ends are returned rather than computed: sin(pi) is a hair off zero in
  // floating point, and raising that to a fractional power lifts it back into
  // a width, which would leave the "collapsed" joins as slivers.
  if (!(t > 0) || t >= 1) return 0;
  return Math.pow(Math.sin(Math.PI * t), BOLT_TAPER_POW);
}

/** Unit tangent at vertex `i` of a polyline — a central difference in the
 *  interior, one-sided at the ends. The vertex shader turns this into the
 *  screen-space (or, in 2D, layer-texel-space) normal it offsets the ribbon
 *  along, so it has to exist at every vertex; a polyline that doubled back on
 *  itself exactly would get the fallback, which is only ever a cosmetic
 *  wobble of one quad. */
export function polylineTangent(pts: Float32Array, i: number, out: number[]): void {
  const n = pts.length / 3;
  const lo = Math.max(0, i - 1) * 3;
  const hi = Math.min(n - 1, i + 1) * 3;
  let dx = pts[hi] - pts[lo];
  let dy = pts[hi + 1] - pts[lo + 1];
  let dz = pts[hi + 2] - pts[lo + 2];
  const d = Math.hypot(dx, dy, dz);
  if (d > 1e-6) {
    dx /= d;
    dy /= d;
    dz /= d;
  } else {
    dx = 0;
    dy = 1;
    dz = 0;
  }
  out[0] = dx;
  out[1] = dy;
  out[2] = dz;
}

/** One polyline in a bolt's tree: its points, its own length (for scaling a
 *  branch's length off it), its peak width as a fraction of the main
 *  channel's, and how many forks it is from that channel. */
type BoltLine = { pts: Float32Array; len: number; peak: number; level: number };

/** The bolt's visible geometry: a branched tree of jagged polylines packed
 *  into one strike's fixed slice of the vertex buffer, ready to draw as a
 *  single ribbon (TRIANGLE_STRIP).
 *
 *  The tree is the main channel from `a` to `b` plus primary branches leaving
 *  interior vertices of it at an angle, plus one deeper level of forks off
 *  those while branch slots remain (BOLT_MAX_BRANCHES). Everything is
 *  deterministic in `rng`.
 *
 *  Layout: BOLT_PATH_VERTS path vertices, each written *twice* back to back
 *  — once per side of the ribbon — as BOLT_VERT_FLOATS floats: position,
 *  tangent, signed half-width and fork level. The sign of the width is which
 *  side of the ribbon the vertex is; its magnitude is how wide the channel is
 *  there, tapering to 0 at every tip. Every polyline is written end to end
 *  and the leftover slots are padded with zero-width copies of the last
 *  vertex, so one TRIANGLE_STRIP over the whole slice draws the tree and
 *  nothing else: the joins between polylines, and the padding, are quads with
 *  two zero-width corners and no area.
 *
 *  Writes into `out` at `offset` when given — a pool can keep every slot's
 *  tree in one flat array — and returns the array written. `a`/`b` (and every
 *  intermediate point) are 3-component; a 2D caller passes z = 0. */
export function buildBoltTree(
  rng: () => number,
  a: readonly number[],
  b: readonly number[],
  out: Float32Array = new Float32Array(BOLT_RIBBON_VERTS * BOLT_VERT_FLOATS),
  offset = 0,
): Float32Array {
  const mainLen = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1e-6;
  const main: BoltLine = {
    pts: jagPolyline(rng, a, b, BOLT_SEGMENTS, BOLT_JITTER),
    len: mainLen,
    peak: 1,
    level: 0,
  };
  const lines: BoltLine[] = [main];

  // A fork off an interior vertex of `parent`: the parent's own direction
  // there, swung off by an angle around a random perpendicular, run out to a
  // fraction of the parent's length. Starting exactly on a parent vertex is
  // what makes the join invisible — both polylines are zero-width there.
  const forkFrom = (parent: BoltLine): BoltLine => {
    const n = parent.pts.length / 3;
    const i = 1 + Math.floor(rng() * (n - 2));
    const root = [parent.pts[i * 3], parent.pts[i * 3 + 1], parent.pts[i * 3 + 2]];
    const tan: number[] = [0, 0, 0];
    polylineTangent(parent.pts, i, tan);
    // A random direction with its along-the-parent component removed — the
    // same idiom the midpoint displacement uses, for the same reason.
    let px = rng() * 2 - 1;
    let py = rng() * 2 - 1;
    let pz = rng() * 2 - 1;
    const along = px * tan[0] + py * tan[1] + pz * tan[2];
    px -= along * tan[0];
    py -= along * tan[1];
    pz -= along * tan[2];
    const pn = Math.hypot(px, py, pz);
    if (pn > 1e-6) {
      px /= pn;
      py /= pn;
      pz /= pn;
    } else {
      px = 1;
      py = 0;
      pz = 0;
    }
    const ang = BOLT_BRANCH_ANGLE_MIN + rng() * (BOLT_BRANCH_ANGLE_MAX - BOLT_BRANCH_ANGLE_MIN);
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const len = parent.len * (BOLT_BRANCH_LEN_MIN + rng() * (BOLT_BRANCH_LEN_MAX - BOLT_BRANCH_LEN_MIN));
    const tip = [
      root[0] + (tan[0] * ca + px * sa) * len,
      root[1] + (tan[1] * ca + py * sa) * len,
      root[2] + (tan[2] * ca + pz * sa) * len,
    ];
    return {
      pts: jagPolyline(rng, root, tip, BOLT_BRANCH_SEGMENTS, BOLT_BRANCH_JITTER),
      len: Math.hypot(tip[0] - root[0], tip[1] - root[1], tip[2] - root[2]) || 1e-6,
      peak: parent.peak * boltWidthAt(i / (n - 1)) * BOLT_BRANCH_WIDTH,
      level: parent.level + 1,
    };
  };

  const primaries: BoltLine[] = [];
  const wanted = BOLT_BRANCH_MIN + Math.floor(rng() * (BOLT_BRANCH_MAX - BOLT_BRANCH_MIN + 1));
  for (let k = 0; k < wanted && lines.length <= BOLT_MAX_BRANCHES; k++) {
    const br = forkFrom(main);
    lines.push(br);
    primaries.push(br);
  }
  for (const p of primaries) {
    if (lines.length > BOLT_MAX_BRANCHES) break;
    if (rng() >= BOLT_SUB_CHANCE) continue;
    lines.push(forkFrom(p));
  }

  let v = 0;
  const tan: number[] = [0, 0, 0];
  const put = (x: number, y: number, z: number, w: number, level: number): void => {
    for (let s = 0; s < 2; s++) {
      const o = offset + (v * 2 + s) * BOLT_VERT_FLOATS;
      out[o] = x;
      out[o + 1] = y;
      out[o + 2] = z;
      out[o + 3] = tan[0];
      out[o + 4] = tan[1];
      out[o + 5] = tan[2];
      out[o + 6] = s === 0 ? w : -w;
      out[o + 7] = level;
    }
    v++;
  };
  for (const line of lines) {
    const n = line.pts.length / 3;
    for (let i = 0; i < n && v < BOLT_PATH_VERTS; i++) {
      polylineTangent(line.pts, i, tan);
      put(line.pts[i * 3], line.pts[i * 3 + 1], line.pts[i * 3 + 2], boltWidthAt(i / (n - 1)) * line.peak, line.level);
    }
  }
  // Unfilled branch slots: zero-width copies of the last vertex written, so
  // the strip runs off the end of the tree without drawing anything.
  const tailX = out[offset + (v * 2 - 2) * BOLT_VERT_FLOATS];
  const tailY = out[offset + (v * 2 - 2) * BOLT_VERT_FLOATS + 1];
  const tailZ = out[offset + (v * 2 - 2) * BOLT_VERT_FLOATS + 2];
  tan[0] = 0;
  tan[1] = 1;
  tan[2] = 0;
  while (v < BOLT_PATH_VERTS) put(tailX, tailY, tailZ, 0, 0);
  return out;
}

/** Brightness of a strike `ageSec` after it fired: 1 at the instant of the
 *  strike, an exponential decay whose rate Afterglow sets, plus a train of
 *  return strokes (re-flashes ~50–90 ms apart, each weaker than the last)
 *  whose count Flicker sets. `seed` fixes where a given strike's strokes
 *  land so the pattern is stable across ticks. */
export function strikeEnvelope(ageSec: number, seed: number, afterglow: number, flicker: number): number {
  if (!(ageSec >= 0)) return 0;
  const glow = Math.min(1, Math.max(0, afterglow));
  const flick = Math.min(1, Math.max(0, flicker));
  const decay = 14 - 9 * glow; // mix(14, 5, afterglow) per second
  let v = Math.exp(-ageSec * decay);
  const strokes = Math.round(flick * 3);
  let t = 0;
  for (let k = 0; k < strokes; k++) {
    t += 0.05 + 0.04 * hash01(seed, k);
    if (ageSec >= t) v += (0.3 + 0.4 * flick) * Math.pow(0.75, k) * Math.exp(-(ageSec - t) * decay * 1.3);
  }
  return Math.min(v, 1.5);
}
