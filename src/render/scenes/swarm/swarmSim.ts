// Swarm simulation -- the pure half of the Entropic Collapse scene (no GL, no
// DOM, so tests/swarmSim.test.ts runs it directly). Our own design, found in
// a numpy prototype (docs/scenes/swarm.md's Materials names where it is kept)
// before it was ported here; nothing in it is taken from anyone else's code.
//
// Every particle has a position, a velocity and a phase. Three couplings:
//
// 1. All pairs repel with a 1/r force. With the trap (below) this sets the
//    rim's radius by Gauss's law -- the repulsion from everything inside a
//    ring balances the trap at the same radius however packed the core is --
//    so the core can breathe while the rim holds still.
// 2. Close pairs (inside `mind`) attract, but only as much as both particles
//    are *locked*: a particle's lock is a slow average of how closely its
//    phase follows its own neighbourhood's mean phase (over the same reach),
//    so drifters (whose natural rate differs, `omegaSpread`) average out near
//    zero and never pull in, while in-step particles pull together -- first
//    as local clumps, then as one dense core. A core packed tighter than its
//    share of the trap expels the drifters into a thin annulus: the dark gap
//    and the rim. The attraction strength `attract` breathes with the
//    caller's `breathWave`.
// 3. Phases pull toward neighbours (a Kuramoto coupling weighted by
//    closeness, `phaseLength`) with a little noise (`noise`, the "heat").
//
// A weak trap toward the centroid keeps the swarm from drifting off; its
// strength is the collapse ramp (`collapseTrap`) -- the scattered start only
// falls into one body as the ramp rises, which is what makes the collapse
// take seconds instead of one.
//
// World units are the prototype's pixels: the reference frame was 720 px
// tall, so a world length L is L / WORLD_HALF_HEIGHT half-heights on screen.
// The origin is (0, 0). Equal and opposite pair forces make the swarm's total
// momentum a constant (tests/swarmSim.test.ts checks it with the trap off).
//
// Inputs the scene supplies each step, not state kept here: `breathWave`
// (0..1, from the Breath drive) and `trapScale` (the collapse ramp). A hit is
// `scatterPhases`; a drop is `rescatter`.

/** Half the reference frame's height, in world units. */
export const WORLD_HALF_HEIGHT = 360;
/** Half-height of the scattered start box, in world units. */
export const SPAWN_HALF_H = 280;
/** The prototype's start box half-width; the scene passes a wider one. */
export const DEFAULT_SPAWN_HALF_W = 355;

export interface SwarmParams {
  /** Rim: all-pairs repulsion strength, force = -repulsion / max(r, repulsionFloor). */
  repulsion: number;
  repulsionFloor: number;
  /** Core: peak attraction between two fully locked particles. */
  attract: number;
  /** How much `breathWave` swings the attraction (1 = 0..2x at the extremes). */
  breath: number;
  /** Attraction reaches this far (world units), fading to 0 at the edge. */
  mind: number;
  /** Exponent on the lock gate: higher = only the most locked pull. */
  sharp: number;
  /** Seconds the lock average takes to follow the swarm phase. */
  lockTau: number;
  /** Phase coupling strength (Kuramoto K). */
  phaseCoupling: number;
  /** How far (world units) the phase coupling reaches (exponential falloff). */
  phaseLength: number;
  /** Spread of the particles' natural rates (a Cauchy draw times this). */
  omegaSpread: number;
  /** Phase noise: the swarm's temperature. */
  noise: number;
  /** Pull toward the centroid at trapScale = 1. */
  trap: number;
  /** Velocity drag (per second is drag * 4). */
  drag: number;
}

/** The tuned values from the prototype (its MODE 3 settings). */
export const DEFAULT_SWARM_PARAMS: SwarmParams = {
  repulsion: 27556,
  repulsionFloor: 6,
  attract: 600,
  breath: 0.5,
  mind: 150,
  sharp: 2,
  lockTau: 0.5,
  phaseCoupling: 8,
  phaseLength: 120,
  omegaSpread: 0.8,
  noise: 0.3,
  trap: 1,
  drag: 0.3,
};

export interface Swarm {
  count: number;
  x: Float64Array;
  y: Float64Array;
  vx: Float64Array;
  vy: Float64Array;
  theta: Float64Array;
  /** The unit Cauchy draw behind each particle's natural rate, so the
   *  spread can change live: omega_i = omegaSpread * cauchy_i. */
  cauchy: Float64Array;
  lock: Float64Array;
  /** The swarm's mean phase as of the last step. */
  psi: number;
  /** Scratch for the per-step phase deltas and forces. */
  fx: Float64Array;
  fy: Float64Array;
  dth: Float64Array;
  lk: Float64Array;
  /** Scratch: Σ q·sin θj and Σ q·cos θj over the neighbours inside the
   *  attraction's reach (q its own falloff) -- the local mean phase a lock
   *  measures against -- and each phase's own sin/cos for the step. */
  locSin: Float64Array;
  locCos: Float64Array;
  sinTh: Float64Array;
  cosTh: Float64Array;
  rng: () => number;
}

/** mulberry32 -- a small seeded PRNG in [0, 1). */
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

/** One standard normal draw (Box-Muller) from `rng`. */
export function gauss(rng: () => number): number {
  const u = 1 - rng(); // (0, 1]
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const TWO_PI = Math.PI * 2;

function wrapPi(a: number): number {
  a = (a + Math.PI) % TWO_PI;
  if (a < 0) a += TWO_PI;
  return a - Math.PI;
}

function scatterPositions(s: Swarm, spawnHalfW: number): void {
  for (let i = 0; i < s.count; i++) {
    s.x[i] = (s.rng() * 2 - 1) * spawnHalfW;
    s.y[i] = (s.rng() * 2 - 1) * SPAWN_HALF_H;
    s.vx[i] = 0;
    s.vy[i] = 0;
    s.lock[i] = 0;
  }
}

export function createSwarm(count: number, seed: number, spawnHalfW = DEFAULT_SPAWN_HALF_W): Swarm {
  const rng = createRng(seed);
  const s: Swarm = {
    count,
    x: new Float64Array(count),
    y: new Float64Array(count),
    vx: new Float64Array(count),
    vy: new Float64Array(count),
    theta: new Float64Array(count),
    cauchy: new Float64Array(count),
    lock: new Float64Array(count),
    psi: 0,
    fx: new Float64Array(count),
    fy: new Float64Array(count),
    dth: new Float64Array(count),
    lk: new Float64Array(count),
    locSin: new Float64Array(count),
    locCos: new Float64Array(count),
    sinTh: new Float64Array(count),
    cosTh: new Float64Array(count),
    rng,
  };
  scatterPositions(s, spawnHalfW);
  for (let i = 0; i < count; i++) {
    s.theta[i] = wrapPi(rng() * TWO_PI);
    const c = Math.tan(Math.PI * (rng() - 0.5));
    s.cauchy[i] = Math.max(-20, Math.min(20, c));
  }
  return s;
}

/** Mean phase of the swarm. */
function meanPhase(s: Swarm): number {
  let sn = 0;
  let cs = 0;
  for (let i = 0; i < s.count; i++) {
    sn += Math.sin(s.theta[i]);
    cs += Math.cos(s.theta[i]);
  }
  return Math.atan2(sn, cs);
}

/** The collapse ramp: the trap strength factor, eased in (cubic) from 0.04
 *  to 1 over `seconds`, `tSinceStart` seconds after the collapse began. Eased
 *  in rather than smoothstepped so the first seconds belong to the local
 *  clumps, not the trap: a strong early trap shrank the whole net as one
 *  box. */
export function collapseTrap(tSinceStart: number, seconds: number): number {
  const u = seconds <= 0 ? 1 : Math.max(0, Math.min(1, tSinceStart / seconds));
  return 0.04 + 0.96 * u * u * u;
}

/** One fixed step of dt seconds. `breathWave` is 0..1 (a beat wave: 1 on the
 *  beat), `trapScale` the collapse ramp (collapseTrap). */
export function stepSwarm(s: Swarm, p: SwarmParams, dt: number, breathWave = 0.5, trapScale = 1): void {
  const n = s.count;
  const { x, y, vx, vy, theta, lock, fx, fy, dth, lk, locSin, locCos, sinTh, cosTh } = s;

  // Lock: a slow average of how closely each phase sits to its own
  // neighbourhood's mean phase (updated after the pair loop below, so this step attracts
  // on last step's locks). Local, not the swarm's mean: with random starting
  // phases the global mean is ~0 and nothing would pull until the whole swarm
  // had synced; locally, in-step clumps form first and merge -- the way the
  // reference's scattered net gathers.
  s.psi = meanPhase(s);
  const lockRate = Math.min(1, dt / p.lockTau);
  for (let i = 0; i < n; i++) {
    const l = lock[i] > 0 ? lock[i] : 0;
    lk[i] = p.sharp === 2 ? l * l : Math.pow(l, p.sharp);
    fx[i] = 0;
    fy[i] = 0;
    dth[i] = 0;
    locSin[i] = 0;
    locCos[i] = 0;
    sinTh[i] = Math.sin(theta[i]);
    cosTh[i] = Math.cos(theta[i]);
  }

  const a = p.attract * (1 + p.breath * (2 * breathWave - 1));
  const invN = 1 / n;
  const mind = p.mind;
  const invMind2 = 1 / (mind * mind);
  const invPl = 1 / p.phaseLength;
  const k = p.phaseCoupling * invN;

  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    cx += x[i];
    cy += y[i];
  }
  cx *= invN;
  cy *= invN;

  for (let i = 0; i < n; i++) {
    const xi = x[i];
    const yi = y[i];
    const thi = theta[i];
    const lki = lk[i];
    let fxi = fx[i];
    let fyi = fy[i];
    let di = dth[i];
    let si = locSin[i];
    let ci = locCos[i];
    const sThi = sinTh[i];
    const cThi = cosTh[i];
    for (let j = i + 1; j < n; j++) {
      const ddx = x[j] - xi;
      const ddy = y[j] - yi;
      const r = Math.max(Math.sqrt(ddx * ddx + ddy * ddy), 1e-6);
      let f = -p.repulsion / (r > p.repulsionFloor ? r : p.repulsionFloor);
      const dTh = theta[j] - thi;
      if (r < mind) {
        const q = 1 - r * r * invMind2;
        f += a * lki * lk[j] * q;
        // The local mean phase, over the neighbours this pair force reaches.
        si += q * sinTh[j];
        ci += q * cosTh[j];
        locSin[j] += q * sThi;
        locCos[j] += q * cThi;
      }
      const fr = (f * invN) / r;
      const gx = fr * ddx;
      const gy = fr * ddy;
      fxi += gx;
      fyi += gy;
      fx[j] -= gx;
      fy[j] -= gy;
      const w = Math.exp(-r * invPl);
      const t = k * w * Math.sin(dTh);
      di += t;
      dth[j] -= t;
    }
    fx[i] = fxi;
    fy[i] = fyi;
    dth[i] = di;
    locSin[i] = si;
    locCos[i] = ci;
  }
  for (let i = 0; i < n; i++) {
    // cos(θi − local mean phase) = (cos θi·C + sin θi·S) / |(S, C)|.
    const m = Math.hypot(locSin[i], locCos[i]);
    const target = m > 1e-9 ? (cosTh[i] * locCos[i] + sinTh[i] * locSin[i]) / m : 0;
    lock[i] += (target - lock[i]) * lockRate;
  }

  const trap = p.trap * trapScale;
  const damp = Math.exp(-p.drag * 4 * dt);
  const noiseAmp = p.noise * Math.sqrt(dt);
  const rng = s.rng;
  for (let i = 0; i < n; i++) {
    vx[i] = (vx[i] + (fx[i] + trap * (cx - x[i])) * dt) * damp;
    vy[i] = (vy[i] + (fy[i] + trap * (cy - y[i])) * dt) * damp;
    x[i] += vx[i] * dt;
    y[i] += vy[i] * dt;
    let th = theta[i] + (p.omegaSpread * s.cauchy[i] + dth[i]) * dt;
    if (noiseAmp > 0) th += noiseAmp * gauss(rng);
    theta[i] = wrapPi(th);
  }
}

/** The most of the swarm one full-strength hit flings out of step. */
export const SCATTER_MAX_SHARE = 0.1;

/** A hit: a random share of the particles (`amount` * SCATTER_MAX_SHARE,
 *  amount 0..1) each get a phase kick of half to a whole turn, the rest are
 *  untouched. A flung particle loses its lock, drifts out to the rim and
 *  rejoins the core when it re-syncs -- the "trying to escape" look -- while
 *  the core itself stays whole. (Kicking every phase a little dissolved the
 *  core outright at one hit per beat.) Locks are left alone: they decay
 *  through their own average. */
export function scatterPhases(s: Swarm, amount: number, rng: () => number = s.rng): void {
  if (amount <= 0) return;
  const share = Math.min(1, amount) * SCATTER_MAX_SHARE;
  for (let i = 0; i < s.count; i++) {
    if (rng() >= share) continue;
    const kick = Math.PI * (0.5 + 0.5 * rng()) * (rng() < 0.5 ? -1 : 1);
    s.theta[i] = wrapPi(s.theta[i] + kick);
  }
}

/** The re-collapse: back to the scattered box, at rest, phases re-rolled,
 *  locks cleared. The scene restarts the collapse ramp alongside. */
export function rescatter(s: Swarm, rng: () => number = s.rng, spawnHalfW = DEFAULT_SPAWN_HALF_W): void {
  const keep = s.rng;
  s.rng = rng;
  scatterPositions(s, spawnHalfW);
  s.rng = keep;
  for (let i = 0; i < s.count; i++) s.theta[i] = wrapPi(rng() * TWO_PI);
}

/** Floats per edge written by collectEdges: x0, y0, x1, y1, c0, c1, alpha. */
export const EDGE_STRIDE = 7;

/** Neighbour counts (within the edge reach) at which a particle's colour
 *  coordinate reaches 0 (white) and 1 (the far end of the ramp). Dense =
 *  white, sparse = coloured: the reference's core is white, its rim rose,
 *  its loosest tips orange and yellow-green, and its spread-out sheet magenta
 *  in the middle and green at the edge -- colour follows crowding, not phase.
 *  Counted as if the swarm had NEIGHBOUR_REF_COUNT particles and the reach
 *  were NEIGHBOUR_REF_REACH (counts scale with both), so the Particles and
 *  Reach settings don't repaint it. At those, the settled core counts well
 *  over a hundred and the rim around a dozen. */
export const DENSE_NEIGHBOURS = 50;
export const SPARSE_NEIGHBOURS = 0;
export const NEIGHBOUR_REF_COUNT = 256;
export const NEIGHBOUR_REF_REACH = 90;

/** How much an edge dims for each end that is more crowded than
 *  DENSE_NEIGHBOURS: (DENSE / count)^this per end. Without it the packed core
 *  piles up into flat white; the reference's core stays white but shows its
 *  lines. */
export const CROWD_DIMMING = 0.6;

/** Writes every pair closer than `reach` into `out` (EDGE_STRIDE floats each;
 *  endpoints, each end's colour coordinate -- 0 crowded, 1 nearly alone, from
 *  its neighbour count -- and alpha, fading to 0 at `reach` and dimmed by
 *  CROWD_DIMMING at crowded ends). Returns the edge
 *  count, dropping the rest past the buffer's capacity. `colourOut`, when
 *  given, receives every particle's colour coordinate (for the node dots). */
export function collectEdges(s: Swarm, reach: number, out: Float32Array, colourOut?: Float64Array): number {
  const cap = Math.floor(out.length / EDGE_STRIDE);
  const n = s.count;
  const o = s.dth; // scratch reused: neighbour counts, then colour coordinates
  const reach2 = reach * reach;
  o.fill(0, 0, n);
  for (let i = 0; i < n; i++) {
    const xi = s.x[i];
    const yi = s.y[i];
    for (let j = i + 1; j < n; j++) {
      const dx = s.x[j] - xi;
      const dy = s.y[j] - yi;
      if (dx * dx + dy * dy < reach2) {
        o[i] += 1;
        o[j] += 1;
      }
    }
  }
  const span = DENSE_NEIGHBOURS - SPARSE_NEIGHBOURS;
  const rr = NEIGHBOUR_REF_REACH / reach;
  const norm = (NEIGHBOUR_REF_COUNT / Math.max(1, n - 1)) * rr * rr;
  const crowd = s.fy; // scratch (free between steps): each end's crowd dimming
  for (let i = 0; i < n; i++) {
    const d = o[i] * norm;
    crowd[i] = d > DENSE_NEIGHBOURS ? Math.pow(DENSE_NEIGHBOURS / d, CROWD_DIMMING) : 1;
    o[i] = Math.min(1, Math.max(0, (DENSE_NEIGHBOURS - d) / span));
  }
  if (colourOut) colourOut.set(o.subarray(0, n));
  let m = 0;
  for (let i = 0; i < n && m < cap; i++) {
    const xi = s.x[i];
    const yi = s.y[i];
    for (let j = i + 1; j < n; j++) {
      const dx = s.x[j] - xi;
      const dy = s.y[j] - yi;
      const d2 = dx * dx + dy * dy;
      if (d2 >= reach2) continue;
      const b = m * EDGE_STRIDE;
      out[b] = xi;
      out[b + 1] = yi;
      out[b + 2] = s.x[j];
      out[b + 3] = s.y[j];
      out[b + 4] = o[i];
      out[b + 5] = o[j];
      out[b + 6] = (1 - Math.sqrt(d2) / reach) * crowd[i] * crowd[j];
      if (++m >= cap) break;
    }
  }
  return m;
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export interface SwarmMetrics {
  /** 90th percentile distance from the centroid, all particles (world units). */
  r90: number;
  /** The same over particles with lock > 0.6 (NaN with fewer than 10). */
  coreR90: number;
  /** Share of particles with lock > 0.6. */
  lockedShare: number;
  /** Kuramoto order parameter |mean e^(i theta)|. */
  order: number;
}

export function swarmMetrics(s: Swarm): SwarmMetrics {
  const n = s.count;
  let cx = 0;
  let cy = 0;
  let sn = 0;
  let cs = 0;
  for (let i = 0; i < n; i++) {
    cx += s.x[i];
    cy += s.y[i];
    sn += Math.sin(s.theta[i]);
    cs += Math.cos(s.theta[i]);
  }
  cx /= n;
  cy /= n;
  const all: number[] = [];
  const core: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.hypot(s.x[i] - cx, s.y[i] - cy);
    all.push(r);
    if (s.lock[i] > 0.6) core.push(r);
  }
  all.sort((a, b) => a - b);
  core.sort((a, b) => a - b);
  return {
    r90: percentile(all, 0.9),
    coreR90: core.length >= 10 ? percentile(core, 0.9) : NaN,
    lockedShare: core.length / n,
    order: Math.hypot(sn, cs) / n,
  };
}
