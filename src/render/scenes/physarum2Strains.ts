// Physarum 2's strain math: the strains, the slider-to-motion maps, the stain's
// hue rotation and the one mapping from a strain's settings and drives to its
// effective motion and colour. No GLSL and no GL, so the body (physarum2.ts),
// the card (physarum2.card.ts) and the panel's widgets (src/ui/widgets/previews.ts)
// share it and none of them pulls in the body.

export const DEG = Math.PI / 180;

/** A strain's fixed identity — code, base render colour, and the sensor
 *  *layout* angle (how far apart its left/right sensors sit) it was hand-
 *  picked with. Everything about a strain's *motion* (sensor range, turn
 *  angle, speed) and *reactivity* (nutrient, excitability, stain) is a
 *  generated per-strain setting instead — see physarum2.ts's header. */
interface StrainConfig {
  readonly code: string;
  readonly color: readonly [number, number, number];
  readonly sensorAngleRad: number;
}

/** Codes are lab-isolate style, not nicknames — every strain is labelled
 *  this way everywhere (boxes, Affinity rows, the web, resets). Colours are
 *  additive-on-black and spread across hue so overlapping strains stay
 *  visually distinct rather than averaging toward white — our own choice,
 *  not Fogleman's palette. */
export const STRAINS: readonly StrainConfig[] = [
  { code: "PP-A1", color: [1.0, 0.3, 0.28], sensorAngleRad: 22 * DEG }, // long flowing highways
  { code: "PP-B2", color: [1.0, 0.72, 0.1], sensorAngleRad: 60 * DEG }, // reticulated mesh
  { code: "PP-C3", color: [0.05, 0.78, 0.7], sensorAngleRad: 95 * DEG }, // coarse cells / spots
  { code: "PP-D4", color: [0.5, 0.36, 1.0], sensorAngleRad: 35 * DEG }, // fine fuzz / labyrinth
];

// --- Sensor range/Turn angle/Speed sliders' linear maps, in the same
// reference-texel/degree units SIM_FRAG already worked in — see physarum2.ts's
// header's "Uniform budget" note. ---
export const SENSOR_DIST_MIN = 2;
export const SENSOR_DIST_MAX = 64;
export const TURN_DEG_MAX = 120; // min is 0
export const STRIDE_MIN = 0.2;
export const STRIDE_MAX = 2;

// Sensor angle is a plain slider in degrees (right = a wider fan of sensors);
// its default per strain is that strain's own STRAINS.sensorAngleRad, so the
// shipped look is unchanged.
export const ANGLE_MIN_DEG = 5;
export const ANGLE_MAX_DEG = 120;
// Trail life: slider 0..1, right = the trail lasts longer. It scales the
// global Trail decay for this strain's channel by 2^(±LIFE_OCTAVES) across the
// slider, exactly 1 at the middle (LIFE_DEFAULT) so the default reproduces the
// shared decay.
const LIFE_OCTAVES = 1.5;
export const LIFE_DEFAULT = 0.5;
/** The multiplier on a strain's evaporation rate for a Trail life slider
 *  value — 1 at LIFE_DEFAULT, below 1 (slower evaporation) to the right. */
export function lifeToDecayMul(life: number): number {
  return Math.pow(2, (LIFE_DEFAULT - clamp01(life)) * 2 * LIFE_OCTAVES);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function sensorSliderToDist(v: number): number {
  return lerp(SENSOR_DIST_MIN, SENSOR_DIST_MAX, v);
}

export function turnSliderToDeg(v: number): number {
  return v * TURN_DEG_MAX;
}

export function strideSliderToDist(v: number): number {
  return lerp(STRIDE_MIN, STRIDE_MAX, v);
}

// --- How much harder a beat lengthens each strain's step — Excitability's
// own gain, same magnitude the old shared "Surge" setting used (the scene
// record has that history). ---
const SURGE_GAIN = 6.0;

// --- The Sensor range/Turn angle/Speed/Stain drive formula (see physarum2.ts's
// header): each strain's own band (STRAIN_BAND_SIGNALS in physarum2.card.ts, same as its
// own Nutrient) nudges it toward 1 by default now, rather than sitting
// inert until patched — caustics.ts's own `breathe` pattern, read in JS
// instead of GLSL. Identity at drive 0 either way (eff === v), so an
// unplugged jack (or a muted source) still leaves a strain's own look
// exactly where its slider puts it. ---
const PUSH_GAIN = 0.7;

/** Stain's own drive gain — a patched source shifts hue by up to this many
 *  turns on top of the stored shift. */
const STAIN_DRIVE_GAIN = 0.18;

function pushToward1(v: number, drive: number): number {
  return v + (1 - v) * PUSH_GAIN * drive;
}

// --- Deposit, per step (not per second — see physarum2.ts's header): a fixed
// amount every agent lays down, times how much its own strain's Nutrient
// setting scales it. Sized so a texel a trail keeps reinforcing settles well
// below saturation before the exposure curve below, the same budget
// reasoning as physarum.ts's DEPOSIT_FLOOR_RATE/DEPOSIT_GAIN_RATE. ---
/** Exported for physarum2Preview.ts's callers: a preview computes its own
 *  absolute per-step deposit as `DEPOSIT * StrainEffective.feed`, the same
 *  product DEPOSIT_FRAG bakes in as a GLSL constant times `strainFeedFor(k)`. */
export const DEPOSIT = 0.03;
const FEED_BASE = 0.35;
const FEED_GAIN = 1.65;
/** Nutrient's own rest — passed as `drives.value`/`ctx.driveValue`'s third
 *  argument everywhere Nutrient's drive is read (resolveStrains in physarum2.ts,
 *  src/ui/widgets/previews.ts's own Strains preview), so an unplugged jack
 *  (or every source muted) reads as exactly this instead of drives.ts's
 *  plain rest of 0: `feed = lerp(1, FEED_BASE + FEED_GAIN * NUTRIENT_REST,
 *  raw.nutrient) === 1` for every raw.nutrient (solving FEED_BASE +
 *  FEED_GAIN * x = 1 for x). Rest 0 made `feed` run backwards — a raised
 *  slider laid down LESS trail (feed sliding toward FEED_BASE, not staying
 *  at 1) the moment its jack was unplugged. */
export const NUTRIENT_REST = (1 - FEED_BASE) / FEED_GAIN;

// ---------------------------------------------------------------------
// Colour: an HSL hue rotation over a strain's fixed base colour, for the
// Stain setting. See hueRotateRGB's own doc comment for why shift===0 is a
// hard identity rather than a round trip through HSL.
// ---------------------------------------------------------------------

export function rgbToHsl([r, g, b]: readonly [number, number, number]): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hue2rgb(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}

/** Rotates `rgb`'s hue by `shift` (turns, wrapping) — the Stain setting's
 *  live colour shift over a strain's base colour. `shift === 0` returns
 *  `rgb` completely unchanged, without any HSL round trip — the identity an
 *  unplugged or silent Stain (raw 0, drive 0) still needs to hold exactly,
 *  rather than whatever precision an RGB->HSL->RGB conversion happens to
 *  leave (tests/physarum2.test.ts checks this identity). */
export function hueRotateRGB(rgb: readonly [number, number, number], shift: number): [number, number, number] {
  if (shift === 0) return [rgb[0], rgb[1], rgb[2]];
  const [h, s, l] = rgbToHsl(rgb);
  const hh = (((h + shift) % 1) + 1) % 1;
  return hslToRgb(hh, s, l);
}

// ---------------------------------------------------------------------
// The one strain-motion mapping — see physarum2.ts's header's "Uniform budget".
// Called by resolveStrains (physarum2.ts's GPU packing) and by the specimen
// boxes' live pure-culture previews (src/ui/widgets/previews.ts), so a box
// can never show a strain behaving differently than it does in the main
// dish. Every distance here is in reference-texel units — the same
// resolution-independent space SIM_FRAG's uSpecies/uStrainFeed already work
// in (a caller converts to its own field's cell size with one documented
// constant — physarum2Preview.ts's REF_TEXELS_PER_PREVIEW_CELL). Doesn't
// touch the Network scale setting (a global multiplier only the GPU shader
// applies) or the attraction table (a pure culture has no rival trail to
// sense).
// ---------------------------------------------------------------------

/** A strain's stored setting amounts for one frame — resolveSceneSetting's
 *  reading, before any drive is applied. */
export interface StrainRawValues {
  nutrient: number;
  excite: number;
  sensor: number;
  turn: number;
  stride: number;
  stain: number;
  /** Sensor angle in degrees. */
  angle: number;
  /** Trail life slider, 0..1. */
  life: number;
}

/** A strain's live drive reading for each of the same controls — the GPU
 *  path reads `drives.value(key, sceneDefault, rest?)` (a per-strain band
 *  for every control but Excitability — STRAIN_BAND_SIGNALS —
 *  `anim.beatPulse` for Excitability; Nutrient alone passes NUTRIENT_REST as
 *  its own `rest`, since an unplugged jack there must read as exactly 1, not
 *  0 — see that constant's own doc); the preview reads
 *  `WidgetCtx.driveValue(spec, rest?)` the same way — see
 *  src/ui/widgets/registry.ts's header. */
export interface StrainDriveValues {
  nutrient: number;
  excite: number;
  sensor: number;
  turn: number;
  stride: number;
  stain: number;
  angle: number;
  life: number;
}

export interface StrainEffective {
  /** Radians — SIM_FRAG's `cfg.x`. */
  sensorAngleRad: number;
  /** Multiplier on the global Trail decay for this strain's channel —
   *  DIFFUSE_FRAG's `uLifeMul`. */
  decayMul: number;
  /** The Stain shift in turns (stored value plus drive), before Synergy —
   *  `color` below is the base colour rotated by exactly this. */
  stainShift: number;
  /** Reference-texel units — SIM_FRAG's `cfg.y`. */
  sensorDist: number;
  rotationRad: number;
  /** Reference-texel units per step, Excitability's surge multiplier already
   *  applied — SIM_FRAG's `cfg.w`. */
  stepDist: number;
  /** Deposit multiplier — SIM_FRAG's `strainFeedFor(k)`; a caller multiplies
   *  by DEPOSIT itself for an absolute per-step amount (the preview does; the
   *  GPU deposit shader bakes DEPOSIT in as a GLSL constant instead). */
  feed: number;
  /** Stain-shifted colour over STRAINS[k]'s own base colour. */
  color: readonly [number, number, number];
}

export function resolveStrainEffective(k: number, raw: StrainRawValues, drive: StrainDriveValues): StrainEffective {
  const strain = STRAINS[k]!;
  const feed = lerp(1, FEED_BASE + FEED_GAIN * drive.nutrient, raw.nutrient);
  const surge = 1 + raw.excite * drive.excite * SURGE_GAIN;
  const sensorEff = clamp01(pushToward1(raw.sensor, drive.sensor));
  const sensorDist = sensorSliderToDist(sensorEff);
  const turnEff = clamp01(pushToward1(raw.turn, drive.turn));
  const rotationRad = turnSliderToDeg(turnEff) * DEG;
  const strideEff = clamp01(pushToward1(raw.stride, drive.stride));
  const stepDist = strideSliderToDist(strideEff) * surge;
  const stainShift = raw.stain + drive.stain * STAIN_DRIVE_GAIN;
  const color = hueRotateRGB(strain.color, stainShift);
  // Sensor angle is in degrees: pushed toward the widest angle the same way
  // the 0..1 controls are pushed toward 1, so drive 0 is the slider exactly.
  const angleSet = Math.max(ANGLE_MIN_DEG, Math.min(ANGLE_MAX_DEG, raw.angle));
  const angleUnit = pushToward1((angleSet - ANGLE_MIN_DEG) / (ANGLE_MAX_DEG - ANGLE_MIN_DEG), drive.angle);
  const sensorAngleRad = (ANGLE_MIN_DEG + clamp01(angleUnit) * (ANGLE_MAX_DEG - ANGLE_MIN_DEG)) * DEG;
  const decayMul = lifeToDecayMul(clamp01(pushToward1(clamp01(raw.life), drive.life)));
  return { sensorAngleRad, decayMul, stainShift, sensorDist, rotationRad, stepDist, feed, color };
}
