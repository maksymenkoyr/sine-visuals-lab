// The shapes Caustics' sparkle can take, and the clock that plays them.
//
// Sparkle's "Glint" shape is the original noise-threshold field in
// caustics.ts's FRAG: a point that flashes with the treble drive and fades
// with that drive's own decay. The two bell shapes are different in kind:
// each glint is a bell struck at one spot, with its own age, so a ring can
// leave the point and ring out after the flash has gone.
//
//   - Strike: a flash at the hit that dies away exponentially, a ring that
//     leaves the point, and a fainter second ring a beat behind it, like the
//     tone ringing on.
//   - Bloom: the point swells exponentially, hollows out, and the animation
//     ends as a ring that fades.
//
// This file holds the maths for both, written once in TypeScript
// (`bellBrightness`, which the Scene card's preview draws and the tests pin)
// and mirrored line for line in GLSL (`BELL_GLSL`, spliced into FRAG). Edit
// the two together; tests/causticsBell.test.ts checks the TypeScript side.
//
// Distances are in bell cells: the lattice FRAG lays over the pool, whose
// size follows Sparkle grain (BELL_CELLS_PER_GRAIN). A ring never travels
// farther than BELL_REACH cells, which FRAG's 2x2 neighbour scan relies on.
//
// The clock (`advanceSparkleHit`) turns the Sparkle driver's climbs into
// hits: each one restarts every bell's age at zero, reseeds which cells
// ring, and sizes the hit by how far the climb stood out (standout.ts).

import { advanceStandoutSized, type StandoutState } from "../standout.ts";

export type SparkleShape = "glint" | "strike" | "bloom";

/** The Sparkle shape setting's 0/1/2 as a shape. Out-of-range values clamp. */
export function sparkleShapeFor(setting: number): SparkleShape {
  const i = Math.max(0, Math.min(2, Math.round(setting)));
  return i === 1 ? "strike" : i === 2 ? "bloom" : "glint";
}

/** How far, in cells, any ring or bloom grows from its bell's centre. */
export const BELL_REACH = 0.62;
/** Bell cells per glint-noise unit (a power-of-two fraction, so the lattice
 *  period divides noiseHash.ts's NOISE_PERIOD). */
export const BELL_CELLS_PER_GRAIN = 1 / 16;
/** How far from the middle of its cell a bell's centre may sit. */
export const BELL_JITTER = 0.5;
/** Seconds a hit's stagger can delay a single bell, so a hit doesn't land
 *  on every bell in the same frame. */
export const BELL_STAGGER_SEC = 0.09;

const SPOT_R = 0.1; // the flash's radius, cells
const RING_W0 = 0.045; // a ring's half-width as it leaves the point, cells
const RING_W1 = 0.03; // how much wider it gets by full reach
const RING_RISE_SEC = 0.35; // time constant of a ring's growth to BELL_REACH
const STRIKE_CORE_SEC = 0.32; // flash decay time constant
const STRIKE_RING_SEC = 0.7; // ring fade time constant
const STRIKE_ECHO_DELAY_SEC = 0.14;
const STRIKE_ECHO_LEVEL = 0.4;
const STRIKE_RING_LEVEL = 0.8;
const BLOOM_RISE_SEC = 0.28; // time constant of the swell
const BLOOM_FILL_SEC = 0.22; // how fast the filled disc hollows out
const BLOOM_RING_ONSET_SEC = 0.12;
const BLOOM_RING_SEC = 0.6;
const BLOOM_START_R = 0.08;
const BLOOM_FILL_LEVEL = 0.9;
const BLOOM_RING_LEVEL = 0.9;

/** Seconds after a hit when a bell has faded below sight at the default
 *  ring-out; FRAG skips every pixel once the age passes this times
 *  `bellRingOutScale`. */
export const BELL_LIFE_SEC = 5.5;

/** The Ring-out setting (0..1) as a multiplier on every fade time. */
export function bellRingOutScale(ringOut: number): number {
  return 0.5 + 1.5 * Math.max(0, Math.min(1, ringOut));
}

function ringAt(d: number, rad: number, amp: number): number {
  const w = RING_W0 + RING_W1 * (rad / BELL_REACH);
  const x = (d - rad) / w;
  return amp * Math.exp(-x * x);
}

function spotAt(d: number, r: number): number {
  return Math.exp((-2.2 * d * d) / (r * r));
}

/** One bell's brightness (0..~1) `ageSec` after its hit, at `dist` cells from
 *  its centre; `scale` is `bellRingOutScale`. The mirror of FRAG's bellGlint. */
export function bellBrightness(shape: SparkleShape, ageSec: number, dist: number, scale: number): number {
  if (ageSec <= 0 || shape === "glint") return 0;
  if (shape === "strike") {
    const core = Math.exp(-ageSec / (STRIKE_CORE_SEC * scale)) * spotAt(dist, SPOT_R);
    const grow = (t: number) => BELL_REACH * (1 - Math.exp(-t / RING_RISE_SEC));
    const fade = (t: number) => Math.exp(-t / (STRIKE_RING_SEC * scale));
    const ring = ringAt(dist, grow(ageSec), STRIKE_RING_LEVEL * fade(ageSec));
    const t2 = ageSec - STRIKE_ECHO_DELAY_SEC;
    const echo = t2 > 0 ? ringAt(dist, grow(t2), STRIKE_ECHO_LEVEL * fade(t2)) : 0;
    return core + ring + echo;
  }
  const rb = BLOOM_START_R + (BELL_REACH - BLOOM_START_R) * (1 - Math.exp(-ageSec / BLOOM_RISE_SEC));
  const fill = BLOOM_FILL_LEVEL * Math.exp(-ageSec / (BLOOM_FILL_SEC * scale)) * spotAt(dist, rb);
  const ringAmp =
    BLOOM_RING_LEVEL * (1 - Math.exp(-ageSec / BLOOM_RING_ONSET_SEC)) * Math.exp(-ageSec / (BLOOM_RING_SEC * scale));
  return fill + ringAt(dist, rb, ringAmp);
}

/** The same maths for the fragment shader. `shape` is 1 (strike) or 2
 *  (bloom); `age` is already staggered; `k` is `bellRingOutScale`. */
export const BELL_GLSL = `
float bellRing(float d, float rad, float amp) {
  float w = ${RING_W0.toFixed(3)} + ${RING_W1.toFixed(3)} * (rad / ${BELL_REACH.toFixed(2)});
  float x = (d - rad) / w;
  return amp * exp(-x * x);
}
float bellSpot(float d, float r) {
  return exp(-2.2 * d * d / (r * r));
}
float bellGrow(float t) {
  return ${BELL_REACH.toFixed(2)} * (1.0 - exp(-t / ${RING_RISE_SEC.toFixed(2)}));
}
float bellGlint(int shape, float age, float d, float k) {
  if (age <= 0.0) return 0.0;
  if (shape == 1) {
    float core = exp(-age / (${STRIKE_CORE_SEC.toFixed(2)} * k)) * bellSpot(d, ${SPOT_R.toFixed(2)});
    float ring = bellRing(d, bellGrow(age), ${STRIKE_RING_LEVEL.toFixed(2)} * exp(-age / (${STRIKE_RING_SEC.toFixed(2)} * k)));
    float t2 = age - ${STRIKE_ECHO_DELAY_SEC.toFixed(2)};
    float echo = t2 > 0.0 ? bellRing(d, bellGrow(t2), ${STRIKE_ECHO_LEVEL.toFixed(2)} * exp(-t2 / (${STRIKE_RING_SEC.toFixed(2)} * k))) : 0.0;
    return core + ring + echo;
  }
  float rb = ${BLOOM_START_R.toFixed(2)} + (${BELL_REACH.toFixed(2)} - ${BLOOM_START_R.toFixed(2)}) * (1.0 - exp(-age / ${BLOOM_RISE_SEC.toFixed(2)}));
  float fill = ${BLOOM_FILL_LEVEL.toFixed(2)} * exp(-age / (${BLOOM_FILL_SEC.toFixed(2)} * k)) * bellSpot(d, rb);
  float ringAmp = ${BLOOM_RING_LEVEL.toFixed(2)} * (1.0 - exp(-age / ${BLOOM_RING_ONSET_SEC.toFixed(2)})) * exp(-age / (${BLOOM_RING_SEC.toFixed(2)} * k));
  return fill + bellRing(d, rb, ringAmp);
}
`;

// ---- The hit clock -----------------------------------------------------------

export interface SparkleHitClock {
  /** Seconds since the last hit; parked at BELL_AGE_PARK once nothing is visible. */
  ageSec: number;
  /** How many hits so far, wrapped at HIT_WRAP; seeds which cells ring. */
  count: number;
  /** The last hit's size, 0..1. */
  amp: number;
}

const BELL_AGE_PARK = 30;
const HIT_WRAP = 1024;

export function createSparkleHitClock(): SparkleHitClock {
  return { ageSec: BELL_AGE_PARK, count: 0, amp: 0 };
}

/** One frame: ages the bells, and on a climb of the Sparkle driver that
 *  stands out (standout.ts, every climb counting) starts them over. The
 *  detector `state` is stepped every frame so it keeps learning. */
export function advanceSparkleHit(clock: SparkleHitClock, state: StandoutState, dtSec: number, driver: number): boolean {
  clock.ageSec = Math.min(BELL_AGE_PARK, clock.ageSec + dtSec);
  const size = advanceStandoutSized(state, dtSec, driver, null);
  if (size <= 0) return false;
  clock.ageSec = 0;
  clock.count = (clock.count + 1) % HIT_WRAP;
  clock.amp = Math.min(1, size);
  return true;
}
