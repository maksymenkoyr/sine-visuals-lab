import { NUM_BANDS } from "../../audio/types.ts";
import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../gl.ts";
import { PALETTE_GLSL } from "../palette.ts";
import type { SceneSetting } from "../sceneSettings.ts";
import type { Scene, SceneContext, PanelSection } from "../scene.ts";
import { COMMON_UNIFORMS_GLSL, DRIVE_GLSL, ROOM_UV_GLSL, settingUniformName, uploadCommonUniforms } from "../sceneCommon.ts";
import { resolveSceneSetting } from "../autoTune.ts";
import { grainTextureSide } from "./chladni.ts";
import { FLOAT_HASH_GLSL } from "../noiseHash.ts";
import { PASSTHROUGH_DRIVES } from "../drives.ts";
import { composeSettings, defineItemPairs, defineItems } from "../sceneItems.ts";
import { packUnit, createBeatSeeder, type BeatSeeder } from "./physarum.ts";

// Physarum 2: a second slime-mould scene, after Michael Fogleman's
// fogleman/physarum (Go, MIT — https://github.com/fogleman/physarum), studied
// for its multi-species idea (also described at https://sagejenson.com/physarum)
// and written independently rather than ported from his Go — CLAUDE.md's
// standing rule, the same one physarum.ts's own header cites for Mesh Grid.
// Where physarum.ts grows one shared trail split by band group, this scene
// runs SPECIES_COUNT independent strains (STRAINS), each with its own motion
// (sensor angle/distance, turn angle, step length) and its own trail
// channel. Every strain senses *every* strain's trail at once, through a
// weighted sum (the `att<i><j>` settings, defaulting to ATTRACT_ROWS):
// strongly its own trail (the diagonal), weakly or negatively everyone
// else's (the off-diagonal, scaled live by the Hostility setting). A strain
// pulled away from every other strain's ink carves out its own territory
// instead of merging into one shared network — that's the entire visual
// difference from physarum.ts, and the one idea taken from Fogleman's model
// rather than any of his code.
//
// Packing follows physarum.ts's playbook — RGBA8 ping-pong, no
// EXT_color_buffer_float dependency, gl_VertexID point deposits, a
// REPEAT/LINEAR torus trail — see that file's header for the shared
// reasoning (8-bit evaporation precision, frame.time vs anim.dtSec, why
// LINEAR+REPEAT on the trail). Two things are genuinely different here:
//
// - The trail is one RGBA8 texture with one live channel per strain, not
//   physarum.ts's three band-group channels: a deposit's ONE,ONE blend adds
//   into every channel, including alpha, which here is a strain's own ink —
//   never real transparency.
// - The model is defined per *simulation step*, not per second: Fogleman's
//   rule turns an agent by a fixed angle each iteration and diffuses/decays
//   the trail by a fixed amount each iteration, so this scene runs a
//   fixed-rate stepper (STEP_RATE_MIN/MAX across the Crawl speed setting,
//   stepAccumulator's carry-over) in render(), rather than scaling every
//   rate by frame.time's dt the way physarum.ts's continuous model does. Each
//   step is diffuse -> sense/turn/move -> deposit, in that order, for the
//   same reason physarum.ts keeps that order (a deposit is never blurred in
//   the step it lands — see that file's header) — just repeated up to
//   MAX_STEPS_PER_FRAME times when a slow frame owes the sim more than one
//   step, and skipped (composite-only) on a frame that owes none. A frame
//   that owes far more steps than the cap drops the backlog rather than ever
//   catching up in one burst (stepAccumulator's own comment).
//
// Turning: an agent samples its own weighted sum straight ahead and to each
// side, at its own STRAINS entry's fixed sensor angle and its own live
// Sensor range. Centre strongest holds course; centre weakest (both sides
// beat it) turns its own live Turn angle in a random direction; anything
// else turns toward whichever side read stronger. Reseeding on a beat reuses
// physarum.ts's own createBeatSeeder (the same rise-detector, the same
// refractory) but doesn't scatter the chosen agents across the whole field
// the way physarum.ts's reseed does: they drop into a small disc
// (SEED_CLUSTER_RADIUS) around one hash-chosen point per epoch, so a beat
// reads as a new colony visibly sprouting from a point rather than a
// field-wide reseed. A reseeded agent's strain never changes — only where
// it is and which way it's facing resets.
//
// Per-strain settings and the Strains panel (2026-09-27): every strain got
// its own Nutrient/Sensor range/Turn angle/Speed/Excitability/Stain controls
// (src/render/sceneItems.ts's `defineItems`, family "strain") plus a full
// Affinity matrix (`defineItemPairs`, `att<i><j>`, defaulting to
// ATTRACT_ROWS) instead of the old fixed SPECIES/ATTRACT_ROWS/PALETTE
// constants and one shared "Band feed"/"Surge" pair. `panel` below (a
// `PanelSection` naming the `itemBoxes` widget) renders them as specimen
// boxes + the selected strain's rows + the Affinity block, inside the
// device menu's Scene card — see src/ui/widgets/itemBoxes.ts. STRAINS is now
// the one source of truth for a strain's *identity* (code, base colour, the
// fixed sensor-layout angle); its *motion and reactivity* are the generated
// settings, resolved live in JS each frame (see "Uniform budget" below) —
// LEGACY_MOTION exists only to derive the sensor/turn/stride sliders'
// defaults so the shipped look is unchanged (tests/physarum2.test.ts checks
// the round trip).
//
// Uniform budget: a setting tagged `item` (sceneItems.ts) has no GLSL
// uniform of its own — SETTINGS_UNIFORMS_GLSL/DRIVE_GLSL below are built
// from NON_ITEM_SETTINGS only. Every per-strain effective value is instead
// resolved in JS each frame render() — reading `resolveSceneSetting` for the
// stored amount and `drives.value(key, sceneDefault)` for its own drive,
// exactly the JS-side twin of the generated `<key>Drive(sceneDefault)` GLSL
// helper (see drives.ts's header; this scene just calls the same engine
// method directly instead of through a per-setting GLSL macro, since each
// strain's own `sceneDefault` differs — a per-strain band for Nutrient, 0
// ["inert until patched"] for Sensor range/Turn angle/Speed/Stain, matching
// caustics.ts's own `breathe` pattern) — and packed into plain vec4/vec3
// uniform arrays every program already declared: `uSpecies[4]` (sensor
// angle, sensor distance, rotation, step — unchanged shape, now uploaded
// every frame instead of once at init), `uAttractRow[4]` (still scaled by
// Hostility inside SIM_FRAG), plus new `uStrainSurge` (a beat's step-length
// multiplier per strain), `uStrainFeed` (deposit multiplier per strain) and
// `uStrainColor[4]` (the composite's per-strain colour, after any Stain hue
// shift).
//
// Render: black background; each channel's trail goes through a fixed
// exposure and a 1/2.2 gamma before being weighted by its strain's own
// colour (uStrainColor) and summed — Fogleman's own render step (see the
// links above), reproduced with our own colours and exposure curve rather
// than his. The final clamp is a hard min(), not physarum.ts's softer
// Reinhard roll-off — that's what keeps the strains reading as discrete,
// saturated territories instead of bleeding toward white where they overlap.
const ID = "physarum2";

const TWO_PI = Math.PI * 2;
const DEG = Math.PI / 180;

/** A strain's fixed identity — code, base render colour, and the sensor
 *  *layout* angle (how far apart its left/right sensors sit) it was hand-
 *  picked with. Everything about a strain's *motion* (sensor range, turn
 *  angle, speed) and *reactivity* (nutrient, excitability, stain) is a
 *  generated per-strain setting instead — see the file header. */
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

/** How many independent strains/trail channels this scene runs — see the
 *  file header. Everything else here (packing, uniform array sizes, the
 *  attraction table's shape) is keyed to this rather than a repeated
 *  literal. */
export const SPECIES_COUNT = STRAINS.length;

/** Row i is strain i's *default* sensing weights against every strain's
 *  trail (itself included) — the `att<i><j>` settings' own default, and the
 *  "Rivals" experiment preset (src/ui/widgets/itemBoxes.ts's panel below).
 *  Diagonal near +1 (follow own trail), off-diagonal negative (avoid
 *  everyone else's), scaled live by the Hostility setting (SIM_FRAG's `w`).
 *  Fixed, hand-picked — not derived from Fogleman's own published table,
 *  which uses different values. */
export const ATTRACT_ROWS: readonly [number, number, number, number][] = [
  [1.0, -0.85, -1.1, -0.7],
  [-1.2, 1.1, -0.6, -0.95],
  [-0.75, -1.05, 0.9, -1.25],
  [-1.0, -0.65, -1.15, 1.05],
];

/** Cap on the square trail map's side, and the floor physarum2TrailSide
 *  clamps to for a degenerate agent count. */
export const TRAIL_SIDE_CAP = 1024;
export const TRAIL_SIDE_MIN = 32;

/** Agents per trail texel the map is sized to hold — see physarum.ts's own
 *  AGENTS_PER_TEXEL for why density, not screen size, decides this. */
export const AGENTS_PER_TEXEL = 1.0;

/** Agents are cheap relative to the trail map, and Fogleman's own renders
 *  run far more of them than pixels on screen — so this scene seeds more
 *  agents than quality.maxParticles alone would give a particle scene. */
export const AGENT_MULTIPLIER = 4;

/** Side of the square trail map for `agentCount` agents, clamped to
 *  [TRAIL_SIDE_MIN, maxSide]. Pure and tested so the sizing holds at every
 *  quality preset without a GL context — physarum.ts's own trailSide, sized
 *  for this scene's own AGENTS_PER_TEXEL. */
export function physarum2TrailSide(agentCount: number, maxSide: number): number {
  const count = Number.isFinite(agentCount) && agentCount > 0 ? agentCount : 0;
  const cap = Number.isFinite(maxSide) && maxSide > 0 ? Math.floor(maxSide) : TRAIL_SIDE_MIN;
  const raw = Math.round(Math.sqrt(count / AGENTS_PER_TEXEL));
  return Math.max(1, Math.min(cap, Math.max(TRAIL_SIDE_MIN, raw)));
}

/** Steps per second the fixed-rate stepper runs at across the Crawl speed
 *  setting — see the file header for why this scene steps at a fixed rate
 *  rather than scaling every rate by dt. */
const STEP_RATE_MIN = 30;
const STEP_RATE_MAX = 120;

/** Ceiling on how many simulation steps one rendered frame can run —
 *  stepAccumulator's own comment covers why a frame owing more than this
 *  drops the backlog instead of ever catching up in one burst. */
export const MAX_STEPS_PER_FRAME = 3;

/** Fixed-rate step accumulator: given the elapsed dt and the Crawl-speed-
 *  mapped step rate, returns how many simulation steps render() should run
 *  this frame (capped at MAX_STEPS_PER_FRAME) and the accumulator's next
 *  value. Backlog past the cap is dropped rather than carried forward — a
 *  backgrounded tab that resumes after minutes away would otherwise try to
 *  run thousands of steps in its first frame back. Pure and tested. */
export function stepAccumulator(prevAcc: number, dt: number, stepRate: number): { steps: number; acc: number } {
  const acc0 = Number.isFinite(prevAcc) ? prevAcc : 0;
  const d = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const rate = Number.isFinite(stepRate) && stepRate > 0 ? stepRate : 0;
  let acc = acc0 + d * rate;
  const steps = Math.min(MAX_STEPS_PER_FRAME, Math.floor(acc));
  acc -= steps;
  if (acc > 1) acc = 0;
  return { steps, acc };
}

/** Radius (unit-square units) of the disc a beat's reseeded agents land in —
 *  see the file header for why this scene clusters a reseed instead of
 *  scattering it field-wide like physarum.ts's own beat seeding. */
const SEED_CLUSTER_RADIUS = 0.12;

// --- Sensor/step geometry across the Network scale slider — multiplies
// every strain's own live Sensor range/Speed (below), never its fixed
// sensorAngleRad. ---
const SCALE_MIN = 0.5;
const SCALE_MAX = 1.8;

// --- Sensor range/Turn angle/Speed sliders' linear maps, in the same
// reference-texel/degree units SIM_FRAG already worked in — see the file
// header's "Uniform budget" note. ---
const SENSOR_DIST_MIN = 2;
const SENSOR_DIST_MAX = 64;
const TURN_DEG_MAX = 120; // min is 0
const STRIDE_MIN = 0.2;
const STRIDE_MAX = 2;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function sensorSliderToDist(v: number): number {
  return lerp(SENSOR_DIST_MIN, SENSOR_DIST_MAX, v);
}
export function distToSensorSlider(d: number): number {
  return (d - SENSOR_DIST_MIN) / (SENSOR_DIST_MAX - SENSOR_DIST_MIN);
}
export function turnSliderToDeg(v: number): number {
  return v * TURN_DEG_MAX;
}
export function degToTurnSlider(deg: number): number {
  return deg / TURN_DEG_MAX;
}
export function strideSliderToDist(v: number): number {
  return lerp(STRIDE_MIN, STRIDE_MAX, v);
}
export function distToStrideSlider(d: number): number {
  return (d - STRIDE_MIN) / (STRIDE_MAX - STRIDE_MIN);
}

/** This scene's motion before per-strain sliders existed — kept only to
 *  derive the Sensor range/Turn angle/Speed settings' defaults below (via
 *  distToSensorSlider/degToTurnSlider/distToStrideSlider), so the shipped
 *  default motion is the same as it always was
 *  (tests/physarum2.test.ts's own round-trip check). Not itself a source of
 *  truth for anything at render time. */
const LEGACY_MOTION: readonly { sensorDist: number; turnDeg: number; strideDist: number }[] = [
  { sensorDist: 30, turnDeg: 40, strideDist: 1.4 },
  { sensorDist: 12, turnDeg: 35, strideDist: 0.9 },
  { sensorDist: 45, turnDeg: 100, strideDist: 1.8 },
  { sensorDist: 5, turnDeg: 20, strideDist: 0.45 },
];

// --- How much harder a beat lengthens each strain's step — Excitability's
// own gain, same magnitude the old shared "Surge" setting used (the scene
// record has that history). ---
const SURGE_GAIN = 6.0;

// --- The Sensor range/Turn angle/Speed/Stain "inert until patched" drive
// formula (see the file header) — caustics.ts's own `breathe` pattern, read
// in JS instead of GLSL: at drive 0 (unpatched) this is the identity
// (eff === v), so the default look never depends on it. ---
const PUSH_GAIN = 0.7;
/** Stain's own drive gain — a patched source shifts hue by up to this many
 *  turns on top of the stored shift. */
const STAIN_DRIVE_GAIN = 0.18;

function pushToward1(v: number, drive: number): number {
  return v + (1 - v) * PUSH_GAIN * drive;
}

// --- Trail decay, per *step* (see the file header) — the Trail decay
// setting's range, and the small per-step floor that keeps 8-bit evaporation
// monotone (physarum.ts's file header covers why a bare multiply stalls). ---
const DECAY_MIN = 0.04;
const DECAY_MAX = 0.25;
const EVAP_FLOOR = 0.6 / 255;
/** Dither amplitude on the trail write, in quantisation steps. */
const EVAP_DITHER = 1.0;

// --- Deposit, per step (not per second — see the file header): a fixed
// amount every agent lays down, times how much its own strain's Nutrient
// setting scales it. Sized so a texel a trail keeps reinforcing settles well
// below saturation before the exposure curve below, the same budget
// reasoning as physarum.ts's DEPOSIT_FLOOR_RATE/DEPOSIT_GAIN_RATE. ---
const DEPOSIT = 0.03;
const FEED_BASE = 0.35;
const FEED_GAIN = 1.65;

// --- Composite exposure and gamma — Fogleman's own render step (file
// header), our own numbers. ---
const GLOW_MIN = 0.45;
const GLOW_MAX = 2.2;
const FLASH_GAIN = 1.2;
const GAMMA_INV = 1 / 2.2;

/** Composite smoothing kernel: how much of a channel's read comes from the
 *  centre texel versus each of its four neighbours — physarum.ts's own
 *  SMOOTH_CENTER/SMOOTH_SIDE, for the same reason (a fresh deposit is still
 *  a sharp single texel when this reads it). Sums to one. */
const SMOOTH_CENTER = 0.44;
const SMOOTH_SIDE = 0.14;

// ---------------------------------------------------------------------
// Colour: an HSL hue rotation over a strain's fixed base colour, for the
// Stain setting. See hueRotateRGB's own doc comment for why shift===0 is a
// hard identity rather than a round trip through HSL.
// ---------------------------------------------------------------------

function rgbToHsl([r, g, b]: readonly [number, number, number]): [number, number, number] {
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
 *  `rgb` completely unchanged, without any HSL round trip, so Stain's
 *  default (0, inert until patched) reproduces STRAINS' own colour
 *  bit-for-bit rather than whatever precision an RGB->HSL->RGB conversion
 *  happens to leave (tests/physarum2.test.ts checks this identity). */
export function hueRotateRGB(rgb: readonly [number, number, number], shift: number): [number, number, number] {
  if (shift === 0) return [rgb[0], rgb[1], rgb[2]];
  const [h, s, l] = rgbToHsl(rgb);
  const hh = (((h + shift) % 1) + 1) % 1;
  return hslToRgb(hh, s, l);
}

function cssColor([r, g, b]: readonly [number, number, number]): string {
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

// ---------------------------------------------------------------------
// Settings: per-strain items (sceneItems.ts) + the remaining global rows.
// ---------------------------------------------------------------------

const BAND_LABELS = ["low", "mid", "high", "overall"] as const;

const nutrientSettings = defineItems("strain", SPECIES_COUNT, {
  key: "nutrient",
  label: "Nutrient",
  description: "How much trail this strain lays down",
  group: "Form",
  min: 0,
  max: 1,
  step: 0.05,
  default: 0.6, // the old shared "Band feed" default
  drive: {
    default: "scene",
    sceneLabel: (k) => `Scene: ${BAND_LABELS[k]} level`,
    sceneSources: (k) => [(["anim.low", "anim.mid", "anim.high", "anim.energy"] as const)[k]!],
  },
});

const exciteSettings = defineItems("strain", SPECIES_COUNT, {
  key: "excite",
  label: "Excitability",
  description: "How hard a hit lengthens this strain's step, throwing new branches",
  group: "Form",
  min: 0,
  max: 1,
  step: 0.01,
  default: 0.1, // the old shared "Surge" default
  // uBeatPulse directly, same as the old shared Surge setting — a plain
  // Beat default, but each strain's own patch can pick any source.
  drive: { default: "feature.onset" },
});

const sensorSettings = defineItems("strain", SPECIES_COUNT, {
  key: "sensor",
  label: "Sensor range",
  description: "How far ahead this strain smells — longer range grows bigger, smoother networks",
  group: "Form",
  min: 0,
  max: 1,
  step: 0.02,
  default: (k) => distToSensorSlider(LEGACY_MOTION[k]!.sensorDist),
  drive: { default: "scene", sceneLabel: "Scene: inert until patched" },
});

const turnSettings = defineItems("strain", SPECIES_COUNT, {
  key: "turn",
  label: "Turn angle",
  description: "How sharply this strain turns toward a scent",
  group: "Form",
  min: 0,
  max: 1,
  step: 0.02,
  default: (k) => degToTurnSlider(LEGACY_MOTION[k]!.turnDeg),
  drive: { default: "scene", sceneLabel: "Scene: inert until patched" },
});

const strideSettings = defineItems("strain", SPECIES_COUNT, {
  key: "stride",
  label: "Speed",
  description: "How far this strain moves each step, on top of the global Crawl speed",
  group: "Form",
  min: 0,
  max: 1,
  step: 0.02,
  default: (k) => distToStrideSlider(LEGACY_MOTION[k]!.strideDist),
  drive: { default: "scene", sceneLabel: "Scene: inert until patched" },
});

const stainSettings = defineItems("strain", SPECIES_COUNT, {
  key: "stain",
  label: "Stain",
  description: "Colour shift over this strain's own base colour",
  group: "Form",
  min: -0.5,
  max: 0.5,
  step: 0.01,
  default: 0,
  drive: { default: "scene", sceneLabel: "Scene: inert until patched" },
});

const attSettings = defineItemPairs("strain", SPECIES_COUNT, {
  key: "att",
  label: (i, j) => (i === j ? `${STRAINS[i]!.code} → own trail` : `${STRAINS[i]!.code} → ${STRAINS[j]!.code}`),
  description: "How strongly this strain is drawn to, or repelled by, each trail",
  group: "Form",
  min: -1.5,
  max: 1.5,
  step: 0.05,
  default: ATTRACT_ROWS,
});

function attSpecAt(i: number, j: number): SceneSetting {
  return attSettings[i * SPECIES_COUNT + j]!;
}

const STRAIN_ITEM_SETTINGS: readonly SceneSetting[] = [
  ...nutrientSettings,
  ...exciteSettings,
  ...sensorSettings,
  ...turnSettings,
  ...strideSettings,
  ...stainSettings,
  ...attSettings,
];

const GLOBAL_SETTINGS: SceneSetting[] = [
  // --- Form ---
  {
    key: "scale",
    label: "Network scale",
    description: "Sensor distance and step length together — how coarse or fine every strain's network grows",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // A busy mix reads better on a finer network — physarum.ts's own scale.
    auto: { density: -0.25 },
  },
  {
    key: "decay",
    label: "Trail decay",
    description: "How fast an unused route evaporates for every strain at once",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
    auto: { density: 0.2, tempo: 0.15 },
  },
  {
    key: "rivalry",
    label: "Hostility",
    description: "How hard each strain avoids the others' trails — 0 lets them overlap, 1 keeps them apart",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { dynamics: 0.15 },
  },
  // --- Motion ---
  {
    key: "speed",
    label: "Crawl speed",
    description: "How many simulation steps run per second — the whole sim's pace",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { tempo: 0.3, pulse: 0.15 },
  },
  {
    key: "seed",
    label: "Beat seeding",
    description: "Share of agents a beat relocates into a fresh cluster, sprouting a new colony",
    group: "Motion",
    // A finer step than this scene's usual 0.05: the reseed disc's area is
    // only a few percent of the trail map (SEED_CLUSTER_RADIUS), so this setting
    // is far more sensitive per unit than physarum.ts's own field-wide seed.
    step: 0.01,
    min: 0,
    max: 1,
    // Reseeded agents concentrate into one small disc rather than scattering
    // field-wide the way physarum.ts's own reseed does, so a much smaller
    // share already reads as a strong burst — this default is deliberately
    // far below physarum.ts's own 0.3 (measured against screenshots: 0.15
    // packed the disc dense enough to saturate solid white, and 0.03 in a
    // radius-0.06 disc still read as a white blob).
    default: 0.01,
    auto: { attack: 0.25, dynamics: 0.15 },
    // The trigger is this scene's own beatSeeder (a *rise* in the decaying
    // beat pulse, onset folded in as a bonus) — physarum.ts's own "seed"
    // setting, same reasoning, same default.
    drive: { default: "scene", sceneLabel: "Scene: a rise in the beat pulse (bonus on a raw onset)", sceneSources: ["feature.onset"] },
  },
  // --- Look ---
  {
    key: "glow",
    label: "Exposure",
    description: "Brightness of the four networks before the gamma curve",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { loudness: 0.2 },
  },
  {
    key: "paletteMix",
    label: "Palette tint",
    description: "0 keeps each strain's own colour; 1 recolours all of them with the app palette",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
    advanced: true,
  },
  // --- Post ---
  {
    key: "flash",
    label: "Beat flash",
    description: "Brightness punch on each beat",
    group: "Post",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.25,
    auto: { attack: 0.3, pulse: 0.2, density: -0.15 },
    // uBeatPulse directly (COMPOSITE_FRAG) — a plain Beat default.
    drive: { default: "feature.onset" },
  },
];

const SETTINGS: SceneSetting[] = composeSettings(STRAIN_ITEM_SETTINGS, GLOBAL_SETTINGS);

/** Every non-`item` setting — the only ones with a GLSL uniform of their
 *  own (see the file header's "Uniform budget"). */
const NON_ITEM_SETTINGS = SETTINGS.filter((s) => !s.item);

function settingFor(key: string): SceneSetting {
  const s = SETTINGS.find((x) => x.key === key);
  if (!s) throw new Error(`physarum2: unknown setting ${key}`);
  return s;
}

// ---------------------------------------------------------------------
// The panel: one Strains group (specimen boxes + the selected strain's
// rows + Affinity) — see src/ui/widgets/itemBoxes.ts. `options` is typed
// `unknown` by PanelSection (scene.ts) precisely so this file, under
// src/render/, never has to import anything under src/ui/ — see
// sceneItems.ts's header for why that boundary matters.
// ---------------------------------------------------------------------

const RELATION_WORDS = [
  { label: "Flees", value: -1.2 },
  { label: "Avoids", value: -0.6 },
  { label: "Ignores", value: 0 },
  { label: "Follows", value: 0.6 },
  { label: "Loves", value: 1.1 },
];

// Copied from the approved "Physarum Lab" prototype
// (docs/scenes/physarum2/artifacts/lab.src.html's EXPERIMENTS) — matrices
// and one-line hypotheses, unchanged. "Rivals" is this scene's own
// ATTRACT_ROWS default.
const EXPERIMENT_PRESETS = [
  { name: "Rivals", hypothesis: "Every strain guards its own territory.", matrix: ATTRACT_ROWS },
  {
    name: "Symbiosis",
    hypothesis: "Strains share each other's routes.",
    matrix: [
      [1, 0.35, 0.2, 0.1],
      [0.3, 1, 0.35, 0.15],
      [0.15, 0.3, 1, 0.35],
      [0.35, 0.15, 0.25, 1],
    ],
  },
  {
    name: "Chase",
    hypothesis: "Each strain hunts the next and flees the last.",
    matrix: [
      [0.6, 1.2, 0, -1.2],
      [-1.2, 0.6, 1.2, 0],
      [0, -1.2, 0.6, 1.2],
      [1.2, 0, -1.2, 0.6],
    ],
  },
  {
    name: "Mob",
    hypothesis: "Everyone piles onto everyone's trails.",
    matrix: [
      [1, 0.8, 0.8, 0.8],
      [0.8, 1, 0.8, 0.8],
      [0.8, 0.8, 1, 0.8],
      [0.8, 0.8, 0.8, 1],
    ],
  },
  {
    name: "Self-avoid",
    hypothesis: "Like real slime mould, each strain shuns its own old slime and explores.",
    matrix: [
      [-0.6, 0, 0, 0],
      [0, -0.6, 0, 0],
      [0, 0, -0.6, 0],
      [0, 0, 0, -0.6],
    ],
  },
];

const PANEL: readonly PanelSection[] = [
  {
    widget: "itemBoxes",
    title: "Strains",
    items: "strain",
    options: {
      labels: STRAINS.map((s) => s.code),
      colours: STRAINS.map((s) => cssColor(s.color)),
      rowOrder: ["nutrient", "sensor", "turn", "stride", "excite", "stain"],
      relations: {
        prefix: "att",
        title: "Affinity",
        words: RELATION_WORDS,
        presets: EXPERIMENT_PRESETS,
      },
    },
  },
];

const SETTINGS_UNIFORMS_GLSL = NON_ITEM_SETTINGS.map((s) => `uniform float ${settingUniformName(s.key)};`).join("\n");
const DRIVE_UNIFORMS_GLSL = DRIVE_GLSL(NON_ITEM_SETTINGS);

// Shared by every pass so the packing, the hashes, the strain decode and
// the room mapping can't drift apart between them.
const PHYSARUM2_GLSL = `
const int SPECIES_COUNT = ${SPECIES_COUNT};
const float TWO_PI = ${TWO_PI.toFixed(6)};
const float REF_FIELD = 1024.0;

// --- 16-bit fixed point over [0, range) — see physarum.ts's file header for
// why position and heading share this one-sided packing (packUnit, the JS
// side of this exact round trip, is imported from there). ---
vec2 packUnitR(float v, float range) {
  float u = floor(clamp(v / range, 0.0, 1.0) * 65535.0 + 0.5);
  float hi = floor(u / 256.0);
  return vec2(hi, u - hi * 256.0) / 255.0;
}
float unpackUnitR(vec2 c, float range) {
  vec2 b = floor(c * 255.0 + 0.5);
  return (b.x * 256.0 + b.y) / 65535.0 * range;
}

// --- hashes: the shared lattice-corner hash family (see noiseHash.ts). ---
${FLOAT_HASH_GLSL}

// Strain index k (0..SPECIES_COUNT-1) is packed into the direction
// texture's B channel as k/(SPECIES_COUNT-1) — see the file header.
int decodeSpecies(float b) {
  return int(floor(b * ${(SPECIES_COUNT - 1).toFixed(1)} + 0.5));
}

vec4 onehot4(int k) {
  if (k == 0) return vec4(1.0, 0.0, 0.0, 0.0);
  if (k == 1) return vec4(0.0, 1.0, 0.0, 0.0);
  if (k == 2) return vec4(0.0, 0.0, 1.0, 0.0);
  return vec4(0.0, 0.0, 0.0, 1.0);
}

ivec2 wrapTexel(ivec2 t, int side) {
  return ivec2(mod(vec2(t), vec2(float(side))));
}

// Aspect of the whole room-space canvas — physarum.ts's/powder.ts's
// roomAspect(), reused so a Panorama pairing keeps every device sampling the
// same field.
float roomAspect() {
  return (uResolution.x * uViewport.w) / max(uResolution.y * uViewport.z, 1e-4);
}

// Cover-fit of the square trail field across a roomAspect()-shaped room —
// see physarum.ts's file header for why the crop is free on a torus.
vec2 coverUv(vec2 ruv) {
  float aspect = roomAspect();
  float s = max(aspect, 1.0);
  vec2 rectSize = vec2(aspect, 1.0);
  return (ruv * rectSize + (vec2(s) - rectSize) * 0.5) / s;
}
`;

const DIFFUSE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
${DRIVE_UNIFORMS_GLSL}
uniform sampler2D uTrailIn;
uniform float uTrailSide;
uniform float uNoiseSeed;
${PHYSARUM2_GLSL}

const float DECAY_MIN = ${DECAY_MIN.toFixed(4)};
const float DECAY_MAX = ${DECAY_MAX.toFixed(4)};
const float EVAP_FLOOR = ${EVAP_FLOOR.toFixed(6)};
const float EVAP_DITHER = ${EVAP_DITHER.toFixed(4)};

float blurWeight(int d) {
  if (d == -2 || d == 2) return 1.0 / 9.0;
  if (d == -1 || d == 1) return 2.0 / 9.0;
  return 3.0 / 9.0;
}

void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  int side = int(uTrailSide);

  // One pass of the separable 5-tap [1,2,3,2,1]/9 kernel in x and y — the
  // fixed-rate equivalent of two radius-1 box blurs per step (see the file
  // header on why every rate here is per *step*, not per second), all four
  // strains' channels at once.
  vec4 sum = vec4(0.0);
  for (int dy = -2; dy <= 2; dy++) {
    float wy = blurWeight(dy);
    for (int dx = -2; dx <= 2; dx++) {
      ivec2 nt = wrapTexel(texel + ivec2(dx, dy), side);
      sum += texelFetch(uTrailIn, nt, 0) * (blurWeight(dx) * wy);
    }
  }

  // Evaporate: multiply, then subtract a floor — physarum.ts's file header
  // covers why a bare multiply stalls in 8-bit.
  float decay = mix(DECAY_MIN, DECAY_MAX, uDecay);
  vec4 trail = max(vec4(0.0), sum * (1.0 - decay) - EVAP_FLOOR);

  // Dither the write by up to half a quantisation step — same reasoning as
  // physarum.ts's own EVAP_DITHER.
  vec2 fuv = (vec2(texel) + 0.5) / uTrailSide;
  float dither = (hash21(fuv * uTrailSide + uNoiseSeed) - 0.5) * EVAP_DITHER / 255.0;
  outColor = max(vec4(0.0), trail + vec4(dither));
}
`;

const SIM_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
layout(location = 0) out vec4 outPos;
layout(location = 1) out vec4 outDir;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
${DRIVE_UNIFORMS_GLSL}
uniform sampler2D uAgentPos;
uniform sampler2D uAgentDir;
uniform sampler2D uTrail;
uniform float uSeedEpoch;
uniform float uSeedFresh;
uniform float uNoiseSeed;
uniform vec4 uSpecies[${SPECIES_COUNT}];
uniform vec4 uAttractRow[${SPECIES_COUNT}];
uniform vec4 uStrainSurge;
${PHYSARUM2_GLSL}

const float SCALE_MIN = ${SCALE_MIN.toFixed(4)};
const float SCALE_MAX = ${SCALE_MAX.toFixed(4)};
const float SEED_CLUSTER_RADIUS = ${SEED_CLUSTER_RADIUS.toFixed(4)};

vec4 speciesConfig(int k) {
  if (k == 0) return uSpecies[0];
  if (k == 1) return uSpecies[1];
  if (k == 2) return uSpecies[2];
  return uSpecies[3];
}

vec4 attractRowFor(int k) {
  if (k == 0) return uAttractRow[0];
  if (k == 1) return uAttractRow[1];
  if (k == 2) return uAttractRow[2];
  return uAttractRow[3];
}

// A strain's own beat-driven step-length multiplier — computed in JS each
// frame from its Excitability setting and drive (see the file header's
// "Uniform budget"), packed into one vec4 the same way uSpecies/uAttractRow
// already are.
float strainSurgeFor(int k) {
  if (k == 0) return uStrainSurge.x;
  if (k == 1) return uStrainSurge.y;
  if (k == 2) return uStrainSurge.z;
  return uStrainSurge.w;
}

void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  vec4 cp = texelFetch(uAgentPos, texel, 0);
  vec4 cd = texelFetch(uAgentDir, texel, 0);
  vec2 pos = vec2(unpackUnitR(cp.rg, 1.0), unpackUnitR(cp.ba, 1.0));
  float heading = unpackUnitR(cd.rg, TWO_PI);
  int k = decodeSpecies(cd.b);

  vec4 cfg = speciesConfig(k);
  float scale = mix(SCALE_MIN, SCALE_MAX, uScale);
  float sensorAngle = cfg.x;
  float sensorDist = cfg.y / REF_FIELD * scale;
  float rotationAngle = cfg.z;

  vec2 dirC = vec2(cos(heading), sin(heading));
  vec2 dirL = vec2(cos(heading - sensorAngle), sin(heading - sensorAngle));
  vec2 dirR = vec2(cos(heading + sensorAngle), sin(heading + sensorAngle));

  // Own channel strongly, everyone else's weakly or negatively — Hostility
  // scales only the off-diagonal, so the diagonal (follow-self) never
  // weakens as strains are pushed further apart.
  vec4 row = attractRowFor(k);
  vec4 own = onehot4(k);
  vec4 w = row * (own + (vec4(1.0) - own) * (uRivalry * 2.0));

  float sC = dot(texture(uTrail, fract(pos + dirC * sensorDist)), w);
  float sL = dot(texture(uTrail, fract(pos + dirL * sensorDist)), w);
  float sR = dot(texture(uTrail, fract(pos + dirR * sensorDist)), w);

  vec2 seed = vec2(texel) * 0.173 + uNoiseSeed;

  // Centre strongest: hold. Both sides beat the centre: turn at random.
  // Otherwise: turn toward whichever side read stronger. Each strain turns
  // by its own live Turn angle — the whole point of that setting.
  if (sC >= sL && sC >= sR) {
    // hold
  } else if (sL > sC && sR > sC) {
    heading += (hash21(seed + 5.17) < 0.5 ? -1.0 : 1.0) * rotationAngle;
  } else if (sL > sR) {
    heading -= rotationAngle;
  } else {
    heading += rotationAngle;
  }
  heading = mod(mod(heading, TWO_PI) + TWO_PI, TWO_PI);

  float moveStep = cfg.w / REF_FIELD * scale * strainSurgeFor(k);
  pos = fract(pos + vec2(cos(heading), sin(heading)) * moveStep);

  // Seed on the beat: only on the exact tick uSeedFresh says the epoch
  // stepped (physarum.ts's file header covers why), and only for the
  // frame's first sim step — the caller only ever passes uSeedFresh=1 once
  // per firing. Reseeded agents cluster around one hash-chosen point per
  // epoch instead of scattering field-wide, so a beat reads as a colony
  // sprouting from a point — see the file header. Strain is untouched.
  if (uSeedFresh > 0.5) {
    float draw = hash21(seed + uSeedEpoch * 7.919 + 11.3);
    if (draw < uSeed) {
      vec2 center = hash22(vec2(uSeedEpoch * 12.9898, uSeedEpoch * 78.233) + 17.0);
      vec2 seed2 = seed + uNoiseSeed * 3.13 + 91.7;
      float r = SEED_CLUSTER_RADIUS * sqrt(hash21(seed2 + 3.7));
      float theta = hash21(seed2 + 9.1) * TWO_PI;
      pos = fract(center + vec2(cos(theta), sin(theta)) * r);
      heading = hash21(seed2 + 4.71) * TWO_PI;
    }
  }

  outPos = vec4(packUnitR(pos.x, 1.0), packUnitR(pos.y, 1.0));
  outDir = vec4(packUnitR(heading, TWO_PI), cd.b, cd.a);
}
`;

const DEPOSIT_VERT = `#version 300 es
precision highp float;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
${DRIVE_UNIFORMS_GLSL}
uniform sampler2D uAgentPos;
uniform sampler2D uAgentDir;
uniform float uAgentSide;
uniform vec4 uStrainFeed;
${PHYSARUM2_GLSL}
out vec4 vDepositColor;

const float DEPOSIT = ${DEPOSIT.toFixed(4)};

// A strain's own deposit multiplier — computed in JS each frame from its
// Nutrient setting and drive (see the file header's "Uniform budget").
float strainFeedFor(int k) {
  if (k == 0) return uStrainFeed.x;
  if (k == 1) return uStrainFeed.y;
  if (k == 2) return uStrainFeed.z;
  return uStrainFeed.w;
}

// No vertex attributes at all — every agent is addressed by gl_VertexID into
// the position/direction textures (physarum.ts's/chladni's/powder's trick),
// so this draws from an empty VAO.
void main() {
  int side = int(uAgentSide);
  ivec2 texel = ivec2(gl_VertexID % side, gl_VertexID / side);
  vec4 cp = texelFetch(uAgentPos, texel, 0);
  vec4 cd = texelFetch(uAgentDir, texel, 0);
  vec2 pos = vec2(unpackUnitR(cp.rg, 1.0), unpackUnitR(cp.ba, 1.0));
  int k = decodeSpecies(cd.b);
  vDepositColor = onehot4(k) * DEPOSIT * strainFeedFor(k);
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
  // The only point size WebGL guarantees, and the mechanic itself: a
  // one-texel deposit.
  gl_PointSize = 1.0;
}
`;

const DEPOSIT_FRAG = `#version 300 es
precision highp float;
in vec4 vDepositColor;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
${DRIVE_UNIFORMS_GLSL}

void main() {
  outColor = vDepositColor;
}
`;

const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
${DRIVE_UNIFORMS_GLSL}
uniform sampler2D uTrail;
uniform float uTrailTexel;
uniform vec3 uStrainColor[${SPECIES_COUNT}];
${PALETTE_GLSL}
${ROOM_UV_GLSL}
${PHYSARUM2_GLSL}

const float GLOW_MIN = ${GLOW_MIN.toFixed(4)};
const float GLOW_MAX = ${GLOW_MAX.toFixed(4)};
const float FLASH_GAIN = ${FLASH_GAIN.toFixed(4)};
const float GAMMA_INV = ${GAMMA_INV.toFixed(6)};
const float SMOOTH_CENTER = ${SMOOTH_CENTER.toFixed(4)};
const float SMOOTH_SIDE = ${SMOOTH_SIDE.toFixed(4)};

void main() {
  vec2 ruv = roomUv(vUv);
  vec2 fuv = fract(coverUv(ruv));

  // Five taps — the freshest deposit is still a sharp single texel when this
  // reads it (physarum.ts's file header covers why) — averaged before the
  // exposure/gamma curve below.
  vec2 texel = vec2(uTrailTexel);
  vec4 tC = texture(uTrail, fuv);
  vec4 tL = texture(uTrail, fract(fuv - vec2(texel.x, 0.0)));
  vec4 tR = texture(uTrail, fract(fuv + vec2(texel.x, 0.0)));
  vec4 tD = texture(uTrail, fract(fuv - vec2(0.0, texel.y)));
  vec4 tU = texture(uTrail, fract(fuv + vec2(0.0, texel.y)));
  vec4 trail = tC * SMOOTH_CENTER + (tL + tR + tD + tU) * SMOOTH_SIDE;

  float exposure = mix(GLOW_MIN, GLOW_MAX, uGlow) * (1.0 + uFlash * flashDrive(uBeatPulse) * FLASH_GAIN);
  vec4 t = pow(clamp(trail * exposure, 0.0, 1.0), vec4(GAMMA_INV));

  vec3 col0 = mix(uStrainColor[0], palette(0.1, uPalA, uPalB, uPalC, uPalD), uPaletteMix);
  vec3 col1 = mix(uStrainColor[1], palette(0.35, uPalA, uPalB, uPalC, uPalD), uPaletteMix);
  vec3 col2 = mix(uStrainColor[2], palette(0.6, uPalA, uPalB, uPalC, uPalD), uPaletteMix);
  vec3 col3 = mix(uStrainColor[3], palette(0.85, uPalA, uPalB, uPalC, uPalD), uPaletteMix);

  // Fogleman's own render step (see the file header): gamma each channel,
  // weight by its strain's colour, sum, then a hard clamp rather than
  // physarum.ts's softer Reinhard roll-off — the clamp is what keeps
  // overlapping territories reading as discrete colours instead of bleeding
  // toward white.
  vec3 col = t.r * col0 + t.g * col1 + t.b * col2 + t.a * col3;
  outColor = vec4(min(col, vec3(1.0)), 1.0);
}
`;

interface AgentSeed {
  pos: Uint8Array;
  dir: Uint8Array;
}

function writeUnit(out: Uint8Array, off: number, v: number, range: number): void {
  const [hi, lo] = packUnit(v, range);
  out[off] = hi;
  out[off + 1] = lo;
}

/** Seeds every texel of a `side x side` agent texture pair: random position
 *  and heading, strain round-robin over SPECIES_COUNT so every strain
 *  starts with an equal share of agents. */
function seedAgents(side: number): AgentSeed {
  const n = side * side;
  const pos = new Uint8Array(n * 4);
  const dir = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    writeUnit(pos, i * 4, Math.random(), 1);
    writeUnit(pos, i * 4 + 2, Math.random(), 1);
    writeUnit(dir, i * 4, Math.random() * TWO_PI, TWO_PI);
    const k = i % SPECIES_COUNT;
    dir[i * 4 + 2] = Math.round((k / (SPECIES_COUNT - 1)) * 255);
    dir[i * 4 + 3] = 0; // unused
  }
  return { pos, dir };
}

function createPhysarum2Scene(): Scene {
  let diffuseProg: GLProgram | null = null;
  let simProg: GLProgram | null = null;
  let depositProg: GLProgram | null = null;
  let compositeProg: GLProgram | null = null;
  let quadVao: WebGLVertexArrayObject | null = null;
  let depositVao: WebGLVertexArrayObject | null = null;

  const agentPosTex: (WebGLTexture | null)[] = [null, null];
  const agentDirTex: (WebGLTexture | null)[] = [null, null];
  const agentFbo: (WebGLFramebuffer | null)[] = [null, null];
  const trailTex: (WebGLTexture | null)[] = [null, null];
  const trailFbo: (WebGLFramebuffer | null)[] = [null, null];

  const samplerLocs = new Map<string, WebGLUniformLocation | null>();
  let agentRead = 0;
  let trailReadIdx = 0;
  let agentSide = 1;
  let agentCount = 0;
  let trailSideCur = 0;
  let lastFrameTime: number | null = null;
  let beatSeeder: BeatSeeder | null = null;
  // How many times a reseed has actually fired — kept separate from
  // beatSeeder.epoch (its own beat-rise bookkeeping), same convention as
  // physarum.ts's own seedEpoch.
  let seedEpoch = 0;
  let stepAcc = 0;
  const bandsBuf = new Float32Array(NUM_BANDS);

  // Per-strain scratch, resolved fresh every render() call — see the file
  // header's "Uniform budget". Allocated once and reused so a busy render
  // loop never allocates.
  const strainSensorDist = new Float32Array(SPECIES_COUNT);
  const strainRotationRad = new Float32Array(SPECIES_COUNT);
  const strainStepDist = new Float32Array(SPECIES_COUNT);
  const strainSurge = new Float32Array(SPECIES_COUNT);
  const strainFeed = new Float32Array(SPECIES_COUNT);
  const strainColor = new Float32Array(SPECIES_COUNT * 3);
  const attRow = new Float32Array(SPECIES_COUNT * SPECIES_COUNT);

  function samplerLoc(
    gl: WebGL2RenderingContext,
    prog: GLProgram,
    key: string,
    name: string,
  ): WebGLUniformLocation | null {
    let l = samplerLocs.get(key);
    if (l === undefined) {
      l = gl.getUniformLocation(prog.program, name);
      samplerLocs.set(key, l);
    }
    return l;
  }

  function makeAgentTexture(gl: WebGL2RenderingContext, side: number, data: Uint8Array): WebGLTexture | null {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, side, side, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  /** LINEAR — the composite and the sensors both tap between texels — and
   *  REPEAT, because the field is a torus (see physarum.ts's file header). */
  function makeTrailTexture(gl: WebGL2RenderingContext, side: number, data: Uint8Array): WebGLTexture | null {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, side, side, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return tex;
  }

  function freeTrailTargets(gl: WebGL2RenderingContext): void {
    for (let i = 0; i < 2; i++) {
      if (trailFbo[i]) gl.deleteFramebuffer(trailFbo[i]);
      if (trailTex[i]) gl.deleteTexture(trailTex[i]);
      trailFbo[i] = null;
      trailTex[i] = null;
    }
  }

  /** Rebuilds the trail map, and reseeds it to zero, only when its size
   *  actually changes — physarum.ts's own ensureTrailTargets. */
  function ensureTrailTargets(gl: WebGL2RenderingContext): void {
    const maxSide = Math.min(TRAIL_SIDE_CAP, Math.max(gl.drawingBufferWidth, gl.drawingBufferHeight));
    const side = physarum2TrailSide(agentCount, maxSide);
    if (side === trailSideCur && trailFbo[0] && trailFbo[1]) return;
    freeTrailTargets(gl);
    trailSideCur = side;
    const zero = new Uint8Array(side * side * 4);
    for (let i = 0; i < 2; i++) {
      trailTex[i] = makeTrailTexture(gl, side, zero);
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, trailTex[i], 0);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`physarum2: trail framebuffer incomplete (0x${status.toString(16)})`);
      }
      trailFbo[i] = f;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    trailReadIdx = 0;
  }

  /** Resolves every per-strain setting for this frame into the scratch
   *  arrays above — see the file header's "Uniform budget". Pure JS: reads
   *  `resolveSceneSetting` (so a dev pin/override still applies even though
   *  these bypass uploadCommonUniforms) and `drives.value(key, sceneDefault)`
   *  (the JS twin of the generated `<key>Drive(sceneDefault)` GLSL helper —
   *  see drives.ts's header), one strain at a time. */
  function resolveStrains(frame: { energy: number }, anim: { low: number; mid: number; high: number; beatPulse: number }, drives: Parameters<Scene["render"]>[5]): void {
    const d = drives ?? PASSTHROUGH_DRIVES;
    for (let k = 0; k < SPECIES_COUNT; k++) {
      const strain = STRAINS[k]!;
      const bandDefault = k === 0 ? anim.low : k === 1 ? anim.mid : k === 2 ? anim.high : frame.energy;

      const nutrientValue = resolveSceneSetting(ID, nutrientSettings[k]!);
      const nutrientDrive = d.value(nutrientSettings[k]!.key, bandDefault);
      strainFeed[k] = lerp(1, FEED_BASE + FEED_GAIN * nutrientDrive, nutrientValue);

      const exciteValue = resolveSceneSetting(ID, exciteSettings[k]!);
      const exciteDrive = d.value(exciteSettings[k]!.key, anim.beatPulse);
      strainSurge[k] = 1 + exciteValue * exciteDrive * SURGE_GAIN;

      const sensorValue = resolveSceneSetting(ID, sensorSettings[k]!);
      const sensorEff = clamp01(pushToward1(sensorValue, d.value(sensorSettings[k]!.key, 0)));
      strainSensorDist[k] = sensorSliderToDist(sensorEff);

      const turnValue = resolveSceneSetting(ID, turnSettings[k]!);
      const turnEff = clamp01(pushToward1(turnValue, d.value(turnSettings[k]!.key, 0)));
      strainRotationRad[k] = turnSliderToDeg(turnEff) * DEG;

      const strideValue = resolveSceneSetting(ID, strideSettings[k]!);
      const strideEff = clamp01(pushToward1(strideValue, d.value(strideSettings[k]!.key, 0)));
      strainStepDist[k] = strideSliderToDist(strideEff);

      const stainValue = resolveSceneSetting(ID, stainSettings[k]!);
      const stainDrive = d.value(stainSettings[k]!.key, 0);
      const [r, g, b] = hueRotateRGB(strain.color, stainValue + stainDrive * STAIN_DRIVE_GAIN);
      strainColor[k * 3] = r;
      strainColor[k * 3 + 1] = g;
      strainColor[k * 3 + 2] = b;

      for (let j = 0; j < SPECIES_COUNT; j++) {
        attRow[k * SPECIES_COUNT + j] = resolveSceneSetting(ID, attSpecAt(k, j));
      }
    }
  }

  return {
    id: ID,
    name: "Physarum 2",
    settings: SETTINGS,
    panel: PANEL,

    init(ctx: SceneContext) {
      const { gl } = ctx;
      diffuseProg = createProgram(gl, DIFFUSE_FRAG);
      simProg = createProgram(gl, SIM_FRAG);
      depositProg = createProgram(gl, DEPOSIT_FRAG, DEPOSIT_VERT);
      compositeProg = createProgram(gl, COMPOSITE_FRAG);
      samplerLocs.clear();
      quadVao = createFullscreenQuad(gl);
      // No vertex attributes at all — every agent is addressed by
      // gl_VertexID — so this draws from an empty VAO rather than the
      // quad's 3-vertex buffer.
      depositVao = gl.createVertexArray();

      agentCount = Math.max(1, Math.floor(ctx.quality.maxParticles * AGENT_MULTIPLIER));
      agentSide = grainTextureSide(agentCount);
      const seed = seedAgents(agentSide);
      for (let i = 0; i < 2; i++) {
        agentPosTex[i] = makeAgentTexture(gl, agentSide, seed.pos);
        agentDirTex[i] = makeAgentTexture(gl, agentSide, seed.dir);
        const f = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, f);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, agentPosTex[i], 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, agentDirTex[i], 0);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
          throw new Error(`physarum2: agent framebuffer incomplete (0x${status.toString(16)})`);
        }
        agentFbo[i] = f;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);

      trailSideCur = 0;
      ensureTrailTargets(gl);

      agentRead = 0;
      lastFrameTime = null;
      beatSeeder = createBeatSeeder();
      seedEpoch = 0;
      stepAcc = 0;
    },

    render(ctx, frame, viewport, palette, anim, drives = PASSTHROUGH_DRIVES) {
      if (!diffuseProg || !simProg || !depositProg || !compositeProg) return;
      if (!quadVao || !depositVao || !beatSeeder) return;
      const { gl } = ctx;
      ensureTrailTargets(gl);

      // See physarum.ts's file header for why frame.time and not anim.dtSec.
      const dt = lastFrameTime === null ? 1 / 60 : Math.max(0, Math.min(0.05, frame.time - lastFrameTime));
      lastFrameTime = frame.time;

      // beatSeeder.advance() is this setting's Scene default (see its own
      // comment in GLOBAL_SETTINGS) — always called so its internal
      // refractory clock keeps running regardless of the setting's actual
      // drive choice. drives.fired() is what actually gates the reseed
      // below; seedEpoch (not beatSeeder.epoch) is what rotates the reseed
      // cluster's centre, so a non-default choice still varies it across
      // repeated fires.
      const seedFresh = drives.fired("seed", beatSeeder.advance(dt, anim.beatPulse, anim.onset));
      if (seedFresh) seedEpoch++;

      resolveStrains(frame, anim, drives);

      const speedSetting = resolveSceneSetting(ID, settingFor("speed"));
      const stepRate = STEP_RATE_MIN + (STEP_RATE_MAX - STEP_RATE_MIN) * speedSetting;
      const { steps, acc } = stepAccumulator(stepAcc, dt, stepRate);
      stepAcc = acc;

      gl.disable(gl.BLEND);

      // Every uniform below is identical across every step this frame runs
      // — nothing here is scaled by dt (see the file header) — so each
      // program's settings/frame/anim upload and sampler-unit bindings
      // happen once, outside the step loop; only uNoiseSeed/uSeedFresh vary
      // per step, set fresh inside it.
      diffuseProg.use();
      uploadCommonUniforms(diffuseProg, ctx, frame, viewport, palette, anim, ID, NON_ITEM_SETTINGS, bandsBuf, drives);
      diffuseProg.setF("uTrailSide", trailSideCur);
      gl.uniform1i(samplerLoc(gl, diffuseProg, "diff.uTrailIn", "uTrailIn"), 0);

      simProg.use();
      uploadCommonUniforms(simProg, ctx, frame, viewport, palette, anim, ID, NON_ITEM_SETTINGS, bandsBuf, drives);
      simProg.setF("uSeedEpoch", seedEpoch);
      for (let k = 0; k < SPECIES_COUNT; k++) {
        const strain = STRAINS[k]!;
        simProg.setV4(`uSpecies[${k}]`, strain.sensorAngleRad, strainSensorDist[k]!, strainRotationRad[k]!, strainStepDist[k]!);
        simProg.setV4(
          `uAttractRow[${k}]`,
          attRow[k * SPECIES_COUNT]!,
          attRow[k * SPECIES_COUNT + 1]!,
          attRow[k * SPECIES_COUNT + 2]!,
          attRow[k * SPECIES_COUNT + 3]!,
        );
      }
      simProg.setV4("uStrainSurge", strainSurge[0]!, strainSurge[1]!, strainSurge[2]!, strainSurge[3]!);
      gl.uniform1i(samplerLoc(gl, simProg, "sim.uAgentPos", "uAgentPos"), 0);
      gl.uniform1i(samplerLoc(gl, simProg, "sim.uAgentDir", "uAgentDir"), 1);
      gl.uniform1i(samplerLoc(gl, simProg, "sim.uTrail", "uTrail"), 2);

      depositProg.use();
      uploadCommonUniforms(depositProg, ctx, frame, viewport, palette, anim, ID, NON_ITEM_SETTINGS, bandsBuf, drives);
      depositProg.setF("uAgentSide", agentSide);
      depositProg.setV4("uStrainFeed", strainFeed[0]!, strainFeed[1]!, strainFeed[2]!, strainFeed[3]!);
      gl.uniform1i(samplerLoc(gl, depositProg, "dep.uAgentPos", "uAgentPos"), 0);
      gl.uniform1i(samplerLoc(gl, depositProg, "dep.uAgentDir", "uAgentDir"), 1);

      for (let step = 0; step < steps; step++) {
        const trailWrite = 1 - trailReadIdx;
        const agentWrite = 1 - agentRead;

        // 1. Diffuse/decay: trailRead -> trailWrite.
        gl.bindFramebuffer(gl.FRAMEBUFFER, trailFbo[trailWrite]);
        gl.viewport(0, 0, trailSideCur, trailSideCur);
        diffuseProg.use();
        diffuseProg.setF("uNoiseSeed", Math.random() * 100);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, trailTex[trailReadIdx]);
        drawFullscreenQuad(gl, quadVao);

        // 2. Sim: agentRead -> agentWrite, sensing the trail diffuse just
        //    wrote.
        gl.bindFramebuffer(gl.FRAMEBUFFER, agentFbo[agentWrite]);
        gl.viewport(0, 0, agentSide, agentSide);
        simProg.use();
        simProg.setF("uSeedFresh", step === 0 && seedFresh ? 1 : 0);
        simProg.setF("uNoiseSeed", Math.random() * 100);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, agentPosTex[agentRead]);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, agentDirTex[agentRead]);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, trailTex[trailWrite]);
        drawFullscreenQuad(gl, quadVao);

        // 3. Deposit: additive points from the agent state sim just wrote,
        //    into the same trail write target diffuse just produced — never
        //    blurred in the step it's laid (see the file header).
        gl.bindFramebuffer(gl.FRAMEBUFFER, trailFbo[trailWrite]);
        gl.viewport(0, 0, trailSideCur, trailSideCur);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        depositProg.use();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, agentPosTex[agentWrite]);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, agentDirTex[agentWrite]);
        gl.bindVertexArray(depositVao);
        gl.drawArrays(gl.POINTS, 0, agentCount);
        gl.bindVertexArray(null);
        gl.disable(gl.BLEND);

        agentRead = agentWrite;
        trailReadIdx = trailWrite;
      }

      // 4. Composite to the default framebuffer — always, even when this
      //    frame owed zero steps (the picture just doesn't advance).
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      compositeProg.use();
      uploadCommonUniforms(compositeProg, ctx, frame, viewport, palette, anim, ID, NON_ITEM_SETTINGS, bandsBuf, drives);
      compositeProg.setF("uTrailTexel", 1 / trailSideCur);
      for (let k = 0; k < SPECIES_COUNT; k++) {
        compositeProg.setV3v(`uStrainColor[${k}]`, strainColor.subarray(k * 3, k * 3 + 3));
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, trailTex[trailReadIdx]);
      gl.uniform1i(samplerLoc(gl, compositeProg, "comp.uTrail", "uTrail"), 0);
      drawFullscreenQuad(gl, quadVao);

      // 5. The gallery renders every scene into one shared context each
      //    tick — must not leak blend state or a bound texture onto the
      //    next tile.
      gl.disable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ZERO);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      for (let unit = 2; unit >= 0; unit--) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      diffuseProg?.dispose();
      simProg?.dispose();
      depositProg?.dispose();
      compositeProg?.dispose();
      if (quadVao) gl.deleteVertexArray(quadVao);
      if (depositVao) gl.deleteVertexArray(depositVao);
      for (let i = 0; i < 2; i++) {
        if (agentFbo[i]) gl.deleteFramebuffer(agentFbo[i]);
        if (agentPosTex[i]) gl.deleteTexture(agentPosTex[i]);
        if (agentDirTex[i]) gl.deleteTexture(agentDirTex[i]);
        agentFbo[i] = null;
        agentPosTex[i] = null;
        agentDirTex[i] = null;
      }
      freeTrailTargets(gl);
      samplerLocs.clear();
      diffuseProg = null;
      simProg = null;
      depositProg = null;
      compositeProg = null;
      quadVao = null;
      depositVao = null;
      lastFrameTime = null;
      beatSeeder = null;
      seedEpoch = 0;
      stepAcc = 0;
      trailSideCur = 0;
    },
  };
}

export const physarum2Scene = createPhysarum2Scene();
