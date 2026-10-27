/**
 * Caustics' Sparkle: what a treble hit does to the pool (the Effect) and how
 * that moves over time after the hit (the shape). Pure, no GL and no DOM:
 * caustics.ts runs the hits through this every frame and uploads the sum.
 *
 * **Effects.** `SPARKLE_EFFECTS` is the option list of the "sparkleFx" enum
 * setting, in stored-value order — append only, since saved Looks and share
 * codes hold the index. Grain is the scene's original glint field on the
 * crests; Prism and Run change the filaments themselves. caustics.ts's FRAG
 * draws each one. Droplets sprays drops out of the lines, a simulation with
 * its own GPU passes (causticsDroplets.ts) that takes the hits' summed shape
 * as its pressure. Flare and Tighten used to be picks here and are now their
 * own sliders, read straight from their drives in FRAG.
 *
 * **Modes.** "Sparkle shape" picks between `SPARKLE_MODES`. Basic plays one
 * fixed curve per hit: the dev-only Basic shape pick (`SPARKLE_SHAPES`,
 * Pluck unless the dev server changed it) and its dials. Adaptive decides
 * each hit from the music, `ADAPT_*` below:
 * - its size comes from how far the hit stood out (the treble lane's
 *   stand-out, hitStrength.ts) against the recent hits', so accents flare
 *   and ghost notes almost vanish, where Basic plays every hit the same;
 * - its length follows the gap between hits, so every flash ends before the
 *   next lands, and a bigger hit lasts longer;
 * - a hit whose treble holds on `ADAPT_RING_CHECK_SEC` after it (a cymbal
 *   wash, a held synth or piano) trembles with Bell's vibration while it
 *   holds, until the next hit cuts it.
 * Swell and Bounce are never chosen: Swell peaks after the hit, late with
 * no way to hear ahead, and Bounce's repeats read as the echo look #508
 * turned down.
 *
 * **Shapes.** `sparkleEnvelope` is one hit's strength `t` seconds after it,
 * signed: Bell's vibration and nothing else swings below 0, and only Prism
 * reads the sign (it swaps its fringes). Every shape lasts exactly `length`
 * seconds and fades to 0 over its last stretch, so a hit older than that
 * can be dropped. `SparkleShapeParams` says what each dial bends; every
 * dial's middle (or Attack 0) draws the shape as first built. Bell is a hit
 * that fades faster than Pluck's, plus a vibration at `speedHz` that starts
 * with it and fades on its own time constant (`vibDecay`, a fraction of
 * `length`).
 *
 * **Hits.** `advanceSparkleHits` keeps the last `SPARKLE_HITS` hits in a
 * ring buffer (age, size, own length) and sums their envelopes into one
 * reading with a soft cap, so fast hats stack without blowing out.
 */

export const SPARKLE_EFFECTS = ["Grain", "Prism", "Run", "Droplets"] as const;
export const SPARKLE_SHAPES = ["Pluck", "Bell", "Swell", "Bounce"] as const;
export const SPARKLE_MODES = ["Basic", "Adaptive"] as const;

export const EFFECT_GRAIN = 0;
export const EFFECT_PRISM = 1;
export const EFFECT_RUN = 2;
export const EFFECT_DROPLETS = 3;

export const SHAPE_PLUCK = 0;
export const SHAPE_BELL = 1;
export const SHAPE_SWELL = 2;
export const SHAPE_BOUNCE = 3;

export const MODE_BASIC = 0;
export const MODE_ADAPTIVE = 1;

export interface SparkleShapeParams {
  /** SHAPE_* index. */
  shape: number;
  /** Seconds a hit lasts, swell-in included. */
  length: number;
  /** 0..1: 0 lands the hit at once; above 0 the effect first swells up
   *  exponentially over up to ATTACK_SWELL_MAX of `length`, then plays the
   *  shape from its peak (Pluck, Bell, Bounce). */
  attack: number;
  /** 0..1: how long the hit itself takes to fade (Pluck, Bell's hit,
   *  Bounce). 0.5 is each shape's own fade; the ends are
   *  DECAY_SPAN_OCTAVES apart. */
  decay: number;
  /** Bell, and Adaptive's tremble: the vibration's height against the hit's (0..1). */
  vibration: number;
  /** Bell, and Adaptive's tremble: vibrations per second. */
  speedHz: number;
  /** Bell: the vibration's fade time constant, as a fraction of `length`. */
  vibDecay: number;
  /** Bounce: how many bumps fit in `length`. */
  bounces: number;
  /** Swell: the fraction of `length` it spends growing. */
  rise: number;
  /** Swell, 0..1: how softly it lets go after the peak. 0.5 is
   *  SWELL_CUT_TAU; the ends are RELEASE_SPAN_OCTAVES apart. */
  release: number;
}

/** The time constant of every shape's near-instant attack, in seconds. */
const ATTACK_SEC = 0.008;
/** At Attack 1, the swell-in takes this fraction of `length`. */
const ATTACK_SWELL_MAX = 0.6;
/** How steep every exponential swell is (Attack's and Swell's rise). */
const SWELL_CURVE = 4;
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
const SWELL_CUT_TAU = 0.04;
const BOUNCE_TAU = 0.35;
/** Decay's full travel, in octaves of the fade time (half each side of
 *  0.5); Release's, of the cut-off's. */
const DECAY_SPAN_OCTAVES = 3;
const RELEASE_SPAN_OCTAVES = 4;
/** Every shape fades to exactly 0 between this fraction of `length` and
 *  `length` itself. */
const END_FADE_FROM = 0.85;

// Adaptive. Each value was picked for a visible change against Basic's
// 0.6 s Pluck, not a fine adjustment (the owner's ask, 2026-10-26), by
// replaying five recorded songs' treble hits through both. Against Basic
// these values keep about nine tenths of the average sparkle, make the hits'
// peaks 5 to 16 times more varied, and differ by a third to four fifths
// frame by frame; lengthening alone, the first try, differed by a tenth to
// a quarter. tests/causticsSparkle.test.ts pins how far apart the two read.
/** A hit lasts this many gaps between hits, within the two bounds below,
 *  then scaled by its size (ADAPT_LENGTH_AT_0 at size 0, rising
 *  ADAPT_LENGTH_PER_SIZE per unit of size up to ADAPT_LENGTH_SIZE_CAP). */
export const ADAPT_GAPS_PER_LENGTH = 1.5;
export const ADAPT_MIN_LENGTH = 0.15;
export const ADAPT_MAX_LENGTH = 1.2;
const ADAPT_LENGTH_AT_0 = 0.6;
const ADAPT_LENGTH_PER_SIZE = 0.4;
const ADAPT_LENGTH_SIZE_CAP = 1.5;
/** How fast the gap estimate follows the hits, per hit. A gap longer than
 *  ADAPT_GAP_MAX_SEC (a break) counts as that, so one pause can't stretch
 *  the next hits out. */
const ADAPT_GAP_FOLLOW = 0.35;
const ADAPT_GAP_MAX_SEC = 1.5;
const ADAPT_GAP_START_SEC = 0.5;
/** Each hit's size is ADAPT_GAIN × (stand-out / recent mean stand-out) to
 *  ADAPT_ACCENT, up to ADAPT_SIZE_MAX: a hit standing out twice as far as
 *  usual plays about four times as big. Stand-out runs from about 0.1 to
 *  0.8 on real songs. ADAPT_GAIN gives back the light the quiet hits lose. */
export const ADAPT_ACCENT = 2;
const ADAPT_GAIN = 1.4;
const ADAPT_SIZE_MAX = 2;
const ADAPT_MEAN_FOLLOW = 0.15;
/** The ring test: the treble level's peak over the first ADAPT_PEAK_SEC
 *  after a hit, against its level ADAPT_RING_CHECK_SEC after it. It can't
 *  tell a cymbal from other held treble: on real songs (2026-10-26, the
 *  engine's treble lane) every hit kept at least a fifth of its peak, in
 *  one spread with no gap between closed and open hats, and the Hats stem
 *  held on longer still. ADAPT_RING_HOLD was picked from that spread: it
 *  trembled 0% of hits on Around the World, 13% on Billie Jean, about a
 *  third on Levitating and Tarantula, and half on Still D.R.E.'s piano. */
export const ADAPT_RING_CHECK_SEC = 0.12;
export const ADAPT_RING_HOLD = 0.85;
const ADAPT_PEAK_SEC = 0.05;
/** The tremble ends once the level falls below this fraction of its peak,
 *  or ADAPT_RING_MAX_SEC after the hit. */
const ADAPT_RING_STOP = 0.15;
const ADAPT_RING_MAX_SEC = 1.5;
/** The tremble's height is Bell's Vibration dial times this, so Adaptive
 *  shakes harder than a Basic Bell at the same dial. */
const ADAPT_VIB_GAIN = 1.6;

/** Every adaptive hit plays a Pluck at its own length. */
const ADAPT_PLUCK: SparkleShapeParams = {
  shape: SHAPE_PLUCK,
  length: 0.6,
  attack: 0,
  decay: 0.5,
  vibration: 0,
  speedHz: 0,
  vibDecay: 0.5,
  bounces: 1,
  rise: 0.5,
  release: 0.5,
};

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

function swellUp(x: number): number {
  return (Math.exp(SWELL_CURVE * x) - 1) / (Math.exp(SWELL_CURVE) - 1);
}

/** One hit's signed strength `t` seconds after it (0 outside [0, length]).
 *  `length` overrides `p.length` for a hit that carries its own. */
export function sparkleEnvelope(t: number, p: SparkleShapeParams, length = p.length): number {
  const L = length;
  if (!(t >= 0) || t > L || L <= 0) return 0;
  const endFade = 1 - smoothstep(END_FADE_FROM * L, L, t);
  if (p.shape === SHAPE_SWELL) {
    const rise = Math.min(Math.max(p.rise, 0.05), 0.98) * L;
    const cutTau = SWELL_CUT_TAU * 2 ** ((p.release - 0.5) * RELEASE_SPAN_OCTAVES) * L;
    return (t < rise ? swellUp(t / rise) : Math.exp(-(t - rise) / cutTau)) * endFade;
  }
  // Attack: swell up first, then play the shape from its peak over what is
  // left of the length (`u`, `Lr`).
  const swellIn = Math.min(Math.max(p.attack, 0), 1) * ATTACK_SWELL_MAX * L;
  if (t < swellIn) return swellUp(t / swellIn) * endFade;
  const u = t - swellIn;
  const Lr = L - swellIn;
  const hitIn = swellIn > 0 ? 1 : 1 - Math.exp(-u / ATTACK_SEC);
  const fade = 2 ** ((p.decay - 0.5) * DECAY_SPAN_OCTAVES) * Lr;
  let e: number;
  switch (p.shape) {
    case SHAPE_BELL: {
      const hit = hitIn * Math.exp(-u / (BELL_HIT_TAU * fade));
      const vib =
        p.vibration *
        Math.sin(2 * Math.PI * p.speedHz * u) *
        (1 - Math.exp(-u / BELL_VIB_IN_SEC)) *
        Math.exp(-u / (Math.max(p.vibDecay, 0.01) * Lr));
      e = hit + vib;
      break;
    }
    case SHAPE_BOUNCE:
      e = hitIn * Math.exp(-u / (BOUNCE_TAU * fade)) * Math.abs(Math.cos((Math.PI * p.bounces * u) / Lr));
      break;
    default:
      e = hitIn * Math.exp(-u / (PLUCK_TAU * fade));
  }
  return e * endFade;
}

/** Hits in flight add up; past 1 the sum bends toward 1.5 instead of
 *  growing without bound. Signed, so a negative swing keeps its direction. */
export function sparkleSoftCap(sum: number): number {
  const a = Math.abs(sum);
  return a <= 1 ? sum : Math.sign(sum) * (1 + 0.5 * Math.tanh(a - 1));
}

/** How many hits the ring buffer keeps. When hits come faster than this
 *  many per length, the oldest one still playing is overwritten; by then
 *  the newer hits stacked on top hide it. */
export const SPARKLE_HITS = 12;

export interface SparkleHits {
  /** Seconds since each hit, -1 for an empty slot. */
  age: Float32Array;
  size: Float32Array;
  /** Each hit's own length, fixed when it lands. */
  length: Float32Array;
  next: number;
  /** Seconds since the last hit, -1 before the first. Tracked in both
   *  modes, so switching to Adaptive mid-song starts already adapted. */
  sinceHit: number;
  gapSec: number;
  meanStandout: number;
  /** The last hit's treble peak and size, and whether it rings: -1 not
   *  decided yet, 0 no, 1 trembling. */
  levelPeak: number;
  lastSize: number;
  ring: number;
}

export function createSparkleHits(): SparkleHits {
  return {
    age: new Float32Array(SPARKLE_HITS).fill(-1),
    size: new Float32Array(SPARKLE_HITS),
    length: new Float32Array(SPARKLE_HITS),
    next: 0,
    sinceHit: -1,
    gapSec: ADAPT_GAP_START_SEC,
    meanStandout: 0,
    levelPeak: 0,
    lastSize: 0,
    ring: 0,
  };
}

/** Adaptive's length for a hit of Adaptive `size`, from the gap estimate. */
export function adaptiveLength(gapSec: number, size: number): number {
  const fromGap = Math.min(ADAPT_MAX_LENGTH, Math.max(ADAPT_MIN_LENGTH, ADAPT_GAPS_PER_LENGTH * gapSec));
  return fromGap * (ADAPT_LENGTH_AT_0 + ADAPT_LENGTH_PER_SIZE * Math.min(size, ADAPT_LENGTH_SIZE_CAP));
}

/** Adaptive's size for a hit that stood out `standout` against the recent
 *  mean; 1 with no reading (a negative `standout`, a wire's edge). */
export function adaptiveSize(standout: number, meanStandout: number): number {
  if (!(standout >= 0) || !(meanStandout > 0)) return 1;
  return Math.min(ADAPT_SIZE_MAX, ADAPT_GAIN * (standout / meanStandout) ** ADAPT_ACCENT);
}

/** One frame: ages every hit by `dtSec`, records a new hit of `size` when
 *  `fired`, and returns the hits' soft-capped sum. `adaptive` plays the hit
 *  as Adaptive decides (this file's header) instead of `p`, reading
 *  `level`, the treble level the sparkle listens to, for the ring test, and
 *  `standout`, the hit's stand-out (negative for none), for its size. */
export function advanceSparkleHits(
  st: SparkleHits,
  dtSec: number,
  fired: boolean,
  size: number,
  p: SparkleShapeParams,
  adaptive = false,
  level = 0,
  standout = -1,
): number {
  for (let i = 0; i < SPARKLE_HITS; i++) {
    if (st.age[i] < 0) continue;
    st.age[i] += dtSec;
    if (st.age[i] > st.length[i]) st.age[i] = -1;
  }
  if (st.sinceHit >= 0) st.sinceHit += dtSec;
  if (fired) {
    if (st.sinceHit >= 0) st.gapSec += ADAPT_GAP_FOLLOW * (Math.min(st.sinceHit, ADAPT_GAP_MAX_SEC) - st.gapSec);
    const accent = adaptiveSize(standout, st.meanStandout);
    const played = adaptive ? size * accent : size;
    if (standout >= 0) st.meanStandout = st.meanStandout > 0 ? st.meanStandout + ADAPT_MEAN_FOLLOW * (standout - st.meanStandout) : standout;
    const i = st.next;
    st.age[i] = 0;
    st.size[i] = played;
    st.length[i] = adaptive ? adaptiveLength(st.gapSec, accent) : p.length;
    st.next = (i + 1) % SPARKLE_HITS;
    st.sinceHit = 0;
    st.levelPeak = level;
    st.lastSize = played;
    st.ring = -1;
  }

  let sum = 0;
  for (let i = 0; i < SPARKLE_HITS; i++) {
    if (st.age[i] < 0) continue;
    sum += st.size[i] * sparkleEnvelope(st.age[i], adaptive ? ADAPT_PLUCK : p, st.length[i]);
  }

  if (st.sinceHit >= 0 && st.sinceHit <= ADAPT_PEAK_SEC) st.levelPeak = Math.max(st.levelPeak, level);
  if (st.ring === -1 && st.sinceHit >= ADAPT_RING_CHECK_SEC) st.ring = st.levelPeak > 0 && level >= ADAPT_RING_HOLD * st.levelPeak ? 1 : 0;
  if (st.ring === 1) {
    const still = st.levelPeak > 0 ? Math.min(1, level / st.levelPeak) : 0;
    if (still < ADAPT_RING_STOP || st.sinceHit > ADAPT_RING_MAX_SEC) st.ring = 0;
    else if (adaptive) {
      const v = st.sinceHit - ADAPT_RING_CHECK_SEC;
      sum +=
        ADAPT_VIB_GAIN *
        p.vibration *
        st.lastSize *
        still *
        Math.sin(2 * Math.PI * p.speedHz * v) *
        (1 - Math.exp(-v / BELL_VIB_IN_SEC));
    }
  }
  return sparkleSoftCap(sum);
}
