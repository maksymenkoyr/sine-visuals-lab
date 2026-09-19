// Crystal Wall's sequencer — moved verbatim from the pre-v4 crystal.ts (see
// index.ts's header for the picture this drives and why v4 rebuilt the
// rendering around it) plus two accumulators v4 added for the raymarched
// camera: `travel` (distance flown down the corridor) and `roll` (camera
// roll about the view axis). Nothing here is discrete except the beat/bar/
// drop triggers of the light-layer envelopes below — travel and roll are
// plain forward accumulators, never reversed, same continuity guarantee as
// the zoom/pan wander they sit beside.

/** Light-layer envelope times, seconds — attacks in [0.12, 0.25], releases
 *  in [0.45, 0.9]. RELIGHT_GATE (below) is what actually keeps a re-trigger
 *  from being visible, not these numbers by themselves: light() always
 *  resets a layer's age to 0, and layerEnvelope(0, …) is always 0, so
 *  restarting a layer whose output hasn't faded low enough would show up
 *  as a same-frame drop — a cut in everything but name. */
const LIGHT_ATTACK_SEC = 0.18;
const LIGHT_RELEASE_SEC = 0.6;
const RED_ATTACK_SEC = 0.2;
const RED_RELEASE_SEC = 0.7;
const EDGE_ATTACK_SEC = 0.15;
const EDGE_RELEASE_SEC = 0.5;
/** A layer only restarts once its current (envelope × amp) output has
 *  faded under this. */
const RELIGHT_GATE = 0.15;
/** A bar wrap can't be told from a tempo lock; without one, every fourth
 *  onset stands in for the bar. */
const UNLOCKED_BAR_BEATS = 4;
/** Beat swell: attack and release of the difference-of-exponentials
 *  brightness pulse a beat adds (kaleido's shape, fixed times). */
const SWELL_ATTACK_SEC = 0.03;
const SWELL_RELEASE_SEC = 0.25;
const SWELL_STACK_CAP = 1.5;
/** Flow accumulator: units per second at Drift = 0 and 1, and the extra
 *  factor the bass adds. */
const FLOW_RATE_MIN = 0.05;
const FLOW_RATE_MAX = 0.8;
const FLOW_BASS_GAIN = 0.8;

/** Camera wander: zoomT/panT are seconds of travel fed through smooth
 *  bounded functions — never a switch. `wander` sums two incommensurate
 *  sines (period ratio the golden ratio, so it never settles into a short
 *  repeat) into a range within ±1. With ZOOM_MID = log(1.6) and
 *  ZOOM_AMP = log(1.9), the lattice's cell spacing wanders between ~0.85
 *  and ~3 screen half-heights — the "many small cells" and "one rosette
 *  fills the screen" looks of the reference, reached by travel, never a
 *  switch. */
const ZOOM_RATE_MAX = 0.75;
export const ZOOM_MID = Math.log(1.6);
export const ZOOM_AMP = Math.log(1.9);
const ZOOM_SECTION_GAIN = 0.4;
/** A beat nudges the zoom's travel speed (not its position) by this much
 *  per unit Beat pulse, decaying over ZOOM_SURGE_TAU_SEC — the same
 *  damped-velocity shape as kaleido/index.ts's advanceBeatSurge, copied
 *  rather than imported (scenes don't import each other). The impulse
 *  lands after this frame's travel is computed, so a beat only speeds up
 *  where the camera was already headed starting next frame — never a jump
 *  on the tick it fires. The v4 camera's forward travel (below) shares this
 *  same velocity, so a beat pushes it down the corridor too. */
const ZOOM_SURGE_IMPULSE = 1.8;
const ZOOM_SURGE_TAU_SEC = 0.18;
const ZOOM_SURGE_VEL_CAP = 6;
const PAN_RATE = 0.6;
/** Morph clock: radians per second at Drift = 0 and 1, and the extra
 *  factor the bass adds — moves motif radii/sizes and the facet light
 *  direction (FRAG below), never their placement on the wedge bisector. */
const MORPH_RATE_MIN = 0.15;
const MORPH_RATE_MAX = 0.5;
const MORPH_BASS_GAIN = 0.5;
/** Mood: a slow continuous cycle deciding how much of a beat's red/edges
 *  split goes to each look — never a coin flip, always a glide. */
const MOOD_RATE = (2 * Math.PI) / 16;

/** v4's forward camera: world units per second down the corridor at Speed
 *  = 0 and 1, plus the extra factor the bass adds — the beat surge above
 *  (st.zoomVel) is added on top of this base rate, shared with the zoom
 *  wander so a beat pushes the camera forward the same way it speeds up the
 *  zoom, never a separate impulse of its own. */
const FLY_MIN = 0.15;
const FLY_MAX = 1.05;
const FLY_LOW_GAIN = 0.6;
/** Camera roll about the view axis, radians per second at Speed = 1 — a
 *  plain forward accumulator, never reversed, so the whole picture keeps
 *  turning rather than wandering back and forth. */
const ROLL_RATE = 0.22;

/** A tiny deterministic hash, seed × k -> [0, 1). Exported for
 *  tests/crystal.test.ts. Nothing here needs per-frame randomness anymore
 *  (the old flicker dropout that used to consume it is gone) — kept as a
 *  small pure utility rather than deleted along with the feature. */
export function hash01(seed: number, k: number): number {
  const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Sum of two incommensurate sines, bounded within ±1 for any t — the
 *  shape the camera's log-zoom rides so it never settles into a short
 *  repeat, however fast or slow t itself is moving. */
function wander(t: number): number {
  return 0.6 * Math.sin(t) + 0.4 * Math.sin(1.618 * t + 1.3);
}

/** A light layer `ageSec` after it was switched on: a ramp over
 *  `attackSec`, a hold at 1, an exponential release. Pure, exported for
 *  tests/crystal.test.ts. */
export function layerEnvelope(ageSec: number, attackSec: number, holdSec: number, releaseSec: number): number {
  if (!(ageSec >= 0)) return 0;
  const holdEnd = attackSec + Math.max(0, holdSec);
  if (ageSec < attackSec) return ageSec / attackSec;
  if (ageSec < holdEnd) return 1;
  return Math.exp(-(ageSec - holdEnd) / releaseSec);
}

interface Layer {
  /** Seconds since switched on; Infinity while off. */
  age: number;
  hold: number;
  /** Scales the envelope: 1 for blobs/fan, the mood weight for red/edges. */
  amp: number;
}

const offLayer = (): Layer => ({ age: Infinity, hold: 0, amp: 1 });

/** Reads a layer's current (envelope × amp) output without mutating it —
 *  used both to gate a restart (RELIGHT_GATE) and to report the frame's
 *  output, so the two never disagree. */
function layerOut(layer: Layer, attackSec: number, releaseSec: number): number {
  return layerEnvelope(layer.age, attackSec, layer.hold, releaseSec) * layer.amp;
}

function light(layer: Layer, hold: number, amp = 1): void {
  layer.age = 0;
  layer.hold = hold;
  layer.amp = amp;
}

export interface CrystalState {
  beatCount: number;
  /** Bar-like moments seen; the ice light takes the odd ones (every other
   *  bar), which puts the bright look on screen about as often as the
   *  reference shows it instead of most of the time. */
  barCount: number;
  blobs: Layer;
  fan: Layer;
  red: Layer;
  edges: Layer;
  prevBarPhase: number;
  prevDropOnset: boolean;
  /** Beat swell's two exponentials (release minus attack). */
  rel: number;
  att: number;
  flowPos: number;
  /** Camera wander: seconds of travel, and the beat surge's velocity
   *  (added to the zoom's travel speed, decaying). */
  zoomT: number;
  zoomVel: number;
  panT: number;
  /** Morph clock's position. */
  morphPos: number;
  /** Mood cycle's phase. */
  moodT: number;
  /** v4: distance flown down the raymarched corridor, world units. */
  travel: number;
  /** v4: camera roll about the view axis, radians. */
  roll: number;
}

export function createCrystalState(): CrystalState {
  return {
    beatCount: 0,
    barCount: 0,
    blobs: offLayer(),
    fan: offLayer(),
    red: offLayer(),
    edges: offLayer(),
    prevBarPhase: 0,
    prevDropOnset: false,
    rel: 0,
    att: 0,
    flowPos: 0,
    zoomT: 0,
    zoomVel: 0,
    panT: 0,
    morphPos: 0,
    moodT: 0,
    travel: 0,
    roll: 0,
  };
}

const SWELL_KA = 1 / SWELL_ATTACK_SEC;
const SWELL_KR = 1 / SWELL_RELEASE_SEC;
const SWELL_PEAK = (() => {
  const tPeak = Math.log(SWELL_KA / SWELL_KR) / (SWELL_KA - SWELL_KR);
  return Math.exp(-SWELL_KR * tPeak) - Math.exp(-SWELL_KA * tPeak);
})();

export interface CrystalInputs {
  dtSec: number;
  onset: boolean;
  dropOnset: boolean;
  barPhase: number;
  tempoLock: number;
  low: number;
  sectionIntensity: number;
}

export interface CrystalOpts {
  /** Travel slider: how fast the camera's log-zoom and pan wander. */
  zoom: number;
  pulse: number;
  /** Flare slider: light-layer strength; 0 leaves the dark look alone. */
  flareAmt: number;
  hold: number;
  /** Speed slider: how fast the camera flies and rolls down the corridor,
   *  and (as before, under the old Drift key) how fast the pan and morph
   *  clock move. */
  speed: number;
}

export interface CrystalOut {
  logZoom: number;
  pan: [number, number];
  morphPos: number;
  blobs: number;
  fan: number;
  red: number;
  edges: number;
  swell: number;
  flowPos: number;
  /** v4: distance flown down the corridor, world units. */
  travel: number;
  /** v4: camera roll about the view axis, radians. */
  roll: number;
}

/** One frame of the sequencer: advances the camera's wander (zoom + pan),
 *  the morph clock and the mood cycle, then fades the light layers up on
 *  bar wraps / drops / beats and down on their own. Pure apart from `st`;
 *  exported for tests/crystal.test.ts. */
export function advanceCrystal(st: CrystalState, input: CrystalInputs, opts: CrystalOpts): CrystalOut {
  const dt = input.dtSec;
  const locked = input.tempoLock > 0.5;
  const barWrap = locked && input.barPhase < st.prevBarPhase - 0.5;
  st.prevBarPhase = input.barPhase;
  const drop = input.dropOnset && !st.prevDropOnset;
  st.prevDropOnset = input.dropOnset;

  for (const l of [st.blobs, st.fan, st.red, st.edges]) l.age += dt;
  if (input.onset) st.beatCount++;

  // Camera wander: this frame's travel uses last frame's surge velocity;
  // only after advancing does the velocity decay and pick up this tick's
  // impulse, so an onset speeds up next frame's travel, never this one's.
  st.zoomT += dt * (ZOOM_RATE_MAX * opts.zoom * (1 + ZOOM_SECTION_GAIN * input.sectionIntensity) + st.zoomVel);
  // v4: the corridor camera's forward travel and roll advance alongside the
  // zoom wander, sharing its (pre-decay) surge velocity — see ZOOM_SURGE_*
  // above and the field comment on `travel`.
  st.travel += dt * ((FLY_MIN + FLY_MAX * opts.speed) * (1 + FLY_LOW_GAIN * input.low) + st.zoomVel);
  st.roll += dt * ROLL_RATE * opts.speed;
  st.zoomVel *= Math.exp(-dt / ZOOM_SURGE_TAU_SEC);
  if (input.onset) st.zoomVel = Math.min(st.zoomVel + opts.pulse * ZOOM_SURGE_IMPULSE, ZOOM_SURGE_VEL_CAP);
  const logZoom = ZOOM_MID + ZOOM_AMP * wander(st.zoomT);

  st.panT += dt * PAN_RATE * opts.speed;
  const pan: [number, number] = [0.35 * Math.sin(0.7 * st.panT), 0.35 * Math.sin(0.53 * st.panT + 2.0)];

  st.morphPos += dt * (MORPH_RATE_MIN + MORPH_RATE_MAX * opts.speed) * (1 + MORPH_BASS_GAIN * input.low);

  st.moodT += dt * MOOD_RATE;
  const mood = 0.5 + 0.5 * Math.sin(st.moodT);

  const layersOn = opts.flareAmt > 0;
  const barLike = barWrap || (!locked && input.onset && st.beatCount % UNLOCKED_BAR_BEATS === 0);
  if (barLike) st.barCount++;
  if (layersOn && barLike && st.barCount % 2 === 1 && layerOut(st.blobs, LIGHT_ATTACK_SEC, LIGHT_RELEASE_SEC) < RELIGHT_GATE) {
    light(st.blobs, opts.hold);
  }
  if (layersOn && drop && layerOut(st.fan, LIGHT_ATTACK_SEC, LIGHT_RELEASE_SEC) < RELIGHT_GATE) {
    light(st.fan, opts.hold * 1.5);
  }
  if (layersOn && input.onset && layerOut(st.red, RED_ATTACK_SEC, RED_RELEASE_SEC) < RELIGHT_GATE) {
    light(st.red, opts.hold * 1.5, mood);
  }
  if (layersOn && input.onset && layerOut(st.edges, EDGE_ATTACK_SEC, EDGE_RELEASE_SEC) < RELIGHT_GATE) {
    light(st.edges, opts.hold * 2, 1 - mood);
  }

  const blobs = layerOut(st.blobs, LIGHT_ATTACK_SEC, LIGHT_RELEASE_SEC);
  const fan = layerOut(st.fan, LIGHT_ATTACK_SEC, LIGHT_RELEASE_SEC);
  const red = layerOut(st.red, RED_ATTACK_SEC, RED_RELEASE_SEC);
  const edges = layerOut(st.edges, EDGE_ATTACK_SEC, EDGE_RELEASE_SEC);

  if (input.onset) {
    st.rel = Math.min(st.rel + opts.pulse, SWELL_STACK_CAP);
    st.att = Math.min(st.att + opts.pulse, SWELL_STACK_CAP);
  }
  st.rel *= Math.exp(-dt * SWELL_KR);
  st.att *= Math.exp(-dt * SWELL_KA);
  const swell = Math.max(0, st.rel - st.att) / SWELL_PEAK;

  const flowRate = (FLOW_RATE_MIN + (FLOW_RATE_MAX - FLOW_RATE_MIN) * opts.speed) * (1 + FLOW_BASS_GAIN * input.low);
  st.flowPos += dt * flowRate;

  const amt = Math.max(0, opts.flareAmt);
  return {
    logZoom,
    pan,
    morphPos: st.morphPos,
    blobs: blobs * amt,
    fan: fan * amt,
    red: red * amt,
    edges: edges * amt,
    swell,
    flowPos: st.flowPos,
    travel: st.travel,
    roll: st.roll,
  };
}
