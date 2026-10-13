/**
 * Caustics' Treble sparkle as two picks: an Effect (what a treble hit does
 * to the pool) and a Shape (how that effect moves over time after the hit).
 * Pure, no GL and no DOM: caustics.ts runs the hits through this every frame
 * and uploads the result, and the panel's Sparkle widget
 * (src/ui/widgets/causticsSparkle.ts) draws the same curve in its preview,
 * so the two can't disagree about a shape.
 *
 * **Effects.** `SPARKLE_EFFECTS` is the option list of the "sparkleEffect"
 * enum setting, in stored-value order — append only, since saved Looks and
 * share codes hold the index. The first few add light on top of the pool
 * (Grain is the scene's original glint field; Rings and Bloom are struck
 * spots bent by the water); the rest change the pool itself (its brightest
 * crests, its sharpness, its coordinate, its colour, a band of light
 * running along it). caustics.ts's FRAG is where each one is drawn.
 *
 * **Shapes.** `sparkleEnvelope` is one hit's strength `t` seconds after it,
 * signed: Bell's vibration and nothing else swings below 0, and an effect
 * that has a direction (Tighten loosens, Shimmer pushes the other way,
 * Prism swaps its fringes) reads the sign. Every shape lasts exactly
 * `length` seconds and fades to 0 over its last stretch, so a hit older
 * than that can be dropped. `SPARKLE_SHAPE_HINTS` says what each shape
 * looks like; Bell is the one with parameters of its own — a hit that fades
 * faster than Pluck's, plus a vibration at `speedHz` that starts with it
 * and fades on its own time constant (`vibDecay`, a fraction of `length`),
 * which is the trembling that rings on after the hit.
 *
 * **Hits.** `advanceSparkleHits` keeps the last `SPARKLE_HITS` hits in a
 * ring buffer (age, size, a per-hit seed) and sums their envelopes into one
 * reading with a soft cap, so fast hats stack without blowing out. Rings
 * and Bloom read the buffer itself (each hit strikes its own spots); every
 * other effect reads only the sum.
 */

export const SPARKLE_EFFECTS = ["Grain", "Rings", "Bloom", "Flare", "Tighten", "Shimmer", "Prism", "Run"] as const;
export const SPARKLE_SHAPES = ["Pluck", "Bell", "Swell", "Bounce"] as const;

export const EFFECT_GRAIN = 0;
export const EFFECT_RINGS = 1;
export const EFFECT_BLOOM = 2;
export const EFFECT_FLARE = 3;
export const EFFECT_TIGHTEN = 4;
export const EFFECT_SHIMMER = 5;
export const EFFECT_PRISM = 6;
export const EFFECT_RUN = 7;

export const SHAPE_PLUCK = 0;
export const SHAPE_BELL = 1;
export const SHAPE_SWELL = 2;
export const SHAPE_BOUNCE = 3;

/** One plain sentence per effect and per shape, in option order — the
 *  panel shows the picked pair under its preview. */
export const SPARKLE_EFFECT_HINTS: readonly string[] = [
  "A fine grain flashes on the bright ridges.",
  "Each hit strikes a few spots. A ring spreads from each one, bent by the water and showing only on lit filaments.",
  "Each hit lights a soft, uneven patch of filaments that swells and dissolves.",
  "The brightest crests ignite and burn white. Dim water stays dim.",
  "Every filament snaps thin and sharp, then relaxes. A swing below zero softens them past rest.",
  "The filaments quiver like heat haze, breaking into fine trembling lines.",
  "Each filament splits into colour fringes, like light through a prism.",
  "Light runs along the filaments in travelling bands. Each hit pushes the bands forward.",
];
export const SPARKLE_SHAPE_HINTS: readonly string[] = [
  "Instant hit, exponential fade.",
  "Hard hit and exponential fade, with a fast vibration that trembles through it and rings on after the hit fades.",
  "Grows exponentially after the hit, then cuts off, like a reversed cymbal.",
  "Hits again and again, each bounce lower.",
];

/** The settings each pick adds to the panel's Sparkle section, by key, in
 *  option order — the widget mounts the picked effect's and shape's rows
 *  under the always-shown ones. Every key here must be a caustics setting
 *  (tests/causticsSparkle.test.ts checks). */
export const SPARKLE_EFFECT_ROWS: readonly (readonly string[])[] = [
  ["sparkleDensity", "sparkleGrain"],
  ["sparkleDensity", "sparkleSize"],
  ["sparkleDensity", "sparkleSize"],
  [],
  [],
  [],
  [],
  [],
];
export const SPARKLE_SHAPE_ROWS: readonly (readonly string[])[] = [
  ["sparkleLength"],
  ["sparkleLength", "sparkleVibration", "sparkleSpeed", "sparkleVibDecay"],
  ["sparkleLength"],
  ["sparkleLength", "sparkleBounces"],
];

/** The two picks and the amount, shown above the preview and the picked
 *  rows. */
export const SPARKLE_EFFECT_KEY = "sparkleEffect";
export const SPARKLE_SHAPE_KEY = "sparkleShape";
export const SPARKLE_AMOUNT_KEY = "sparkle";

/** Every setting the panel's Sparkle section renders itself, so the Scene
 *  card's flat list leaves them out (PanelSection.settings). */
export const SPARKLE_PANEL_KEYS: readonly string[] = [
  ...new Set([SPARKLE_EFFECT_KEY, SPARKLE_SHAPE_KEY, SPARKLE_AMOUNT_KEY, ...SPARKLE_EFFECT_ROWS.flat(), ...SPARKLE_SHAPE_ROWS.flat()]),
];

export interface SparkleShapeParams {
  /** SHAPE_* index. */
  shape: number;
  /** Seconds a hit lasts. */
  length: number;
  /** Bell: the vibration's height against the hit's (0..1). */
  vibration: number;
  /** Bell: vibrations per second. */
  speedHz: number;
  /** Bell: the vibration's fade time constant, as a fraction of `length`. */
  vibDecay: number;
  /** Bounce: how many bumps fit in `length`. */
  bounces: number;
}

/** The time constant of every shape's near-instant attack, in seconds. */
const ATTACK_SEC = 0.008;
/** Pluck's fade time constant as a fraction of `length`. At the default
 *  length this is the treble pulse's own decay (animClock.ts's
 *  BEAT_PULSE_DECAY_PER_SEC), so Grain + Pluck reads as the sparkle did
 *  before the picks existed. */
export const PLUCK_TAU = 0.28;
/** Bell's hit fades faster than Pluck's, so the vibration is what rings on. */
const BELL_HIT_TAU = 0.18;
/** How fast Bell's vibration grows in from the hit, in seconds — fast
 *  enough to tremble from the first moment without a click at t = 0. */
const BELL_VIB_IN_SEC = 0.015;
/** Swell rises over this fraction of `length`, then cuts off. */
const SWELL_RISE = 0.75;
const SWELL_CURVE = 4;
const SWELL_CUT_TAU = 0.04;
const BOUNCE_TAU = 0.35;
/** Every shape fades to exactly 0 between this fraction of `length` and
 *  `length` itself. */
const END_FADE_FROM = 0.85;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** One hit's signed strength `t` seconds after it (0 outside [0, length]). */
export function sparkleEnvelope(t: number, p: SparkleShapeParams): number {
  const L = p.length;
  if (!(t >= 0) || t > L || L <= 0) return 0;
  const endFade = 1 - smoothstep(END_FADE_FROM * L, L, t);
  const attack = 1 - Math.exp(-t / ATTACK_SEC);
  let e: number;
  switch (p.shape) {
    case SHAPE_BELL: {
      const hit = attack * Math.exp(-t / (BELL_HIT_TAU * L));
      const vib =
        p.vibration *
        Math.sin(2 * Math.PI * p.speedHz * t) *
        (1 - Math.exp(-t / BELL_VIB_IN_SEC)) *
        Math.exp(-t / (Math.max(p.vibDecay, 0.01) * L));
      e = hit + vib;
      break;
    }
    case SHAPE_SWELL: {
      const rise = SWELL_RISE * L;
      e = t < rise ? (Math.exp((SWELL_CURVE * t) / rise) - 1) / (Math.exp(SWELL_CURVE) - 1) : Math.exp(-(t - rise) / (SWELL_CUT_TAU * L));
      break;
    }
    case SHAPE_BOUNCE:
      e = attack * Math.exp(-t / (BOUNCE_TAU * L)) * Math.abs(Math.cos((Math.PI * p.bounces * t) / L));
      break;
    default:
      e = attack * Math.exp(-t / (PLUCK_TAU * L));
  }
  return e * endFade;
}

/** Hits in flight add up; past 1 the sum bends toward 1.5 instead of
 *  growing without bound. Signed, so a negative swing keeps its direction. */
export function sparkleSoftCap(sum: number): number {
  const a = Math.abs(sum);
  return a <= 1 ? sum : Math.sign(sum) * (1 + 0.5 * Math.tanh(a - 1));
}

/** How many hits the ring buffer keeps — the uniform arrays' length too.
 *  When hits come faster than this many per `length`, the oldest one still
 *  playing is overwritten; by then the newer hits stacked on top hide it. */
export const SPARKLE_HITS = 12;

export interface SparkleHits {
  /** Seconds since each hit, -1 for an empty slot. */
  age: Float32Array;
  /** Each hit's own size (0..1), times its envelope this frame — what
   *  Rings and Bloom draw each hit's spots with. */
  env: Float32Array;
  /** A per-hit seed (the hit's serial number, wrapped), so each hit strikes
   *  different spots. */
  seed: Float32Array;
  size: Float32Array;
  next: number;
  serial: number;
}

export function createSparkleHits(): SparkleHits {
  return {
    age: new Float32Array(SPARKLE_HITS).fill(-1),
    env: new Float32Array(SPARKLE_HITS),
    seed: new Float32Array(SPARKLE_HITS),
    size: new Float32Array(SPARKLE_HITS),
    next: 0,
    serial: 0,
  };
}

/** Seeds wrap here so they stay exact as floats in the shader. */
const SEED_WRAP = 4096;

/** One frame: ages every hit by `dtSec`, records a new hit of `size` when
 *  `fired`, refreshes each hit's envelope, and returns their soft-capped
 *  sum. A hit past `length` is cleared, so it can't come back if the length
 *  is raised later. */
export function advanceSparkleHits(st: SparkleHits, dtSec: number, fired: boolean, size: number, p: SparkleShapeParams): number {
  for (let i = 0; i < SPARKLE_HITS; i++) {
    if (st.age[i] < 0) continue;
    st.age[i] += dtSec;
    if (st.age[i] > p.length) {
      st.age[i] = -1;
      st.env[i] = 0;
    }
  }
  if (fired) {
    const i = st.next;
    st.age[i] = 0;
    st.size[i] = size;
    st.seed[i] = st.serial % SEED_WRAP;
    st.serial++;
    st.next = (i + 1) % SPARKLE_HITS;
  }
  let sum = 0;
  for (let i = 0; i < SPARKLE_HITS; i++) {
    st.env[i] = st.age[i] < 0 ? 0 : st.size[i] * sparkleEnvelope(st.age[i], p);
    sum += st.env[i];
  }
  return sparkleSoftCap(sum);
}
