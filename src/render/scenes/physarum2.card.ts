// Physarum 2's card: what every page needs before the scene's code loads (src/render/lazyScene.ts).
import type { PanelSection, Scene, SceneCard } from "../scene.ts";
import type { SceneSetting } from "../sceneSettings.ts";
import { composeSettings, defineItemPairs, defineItems } from "../sceneItems.ts";
import { STANDOUT_THRESHOLD_DEFAULT } from "../standout.ts";
import { AFFINITY_PRESETS, ATTRACT_ROWS, PAIR_WORDS } from "./physarum2Affinity.ts";
import {
  ANGLE_MAX_DEG,
  ANGLE_MIN_DEG,
  DEG,
  LIFE_DEFAULT,
  rgbToHsl,
  SENSOR_DIST_MAX,
  SENSOR_DIST_MIN,
  STRAINS,
  STRIDE_MAX,
  STRIDE_MIN,
  TURN_DEG_MAX,
} from "./physarum2Strains.ts";

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "released", added: "2026-09-27" } as const;

/** How many independent strains/trail channels this scene runs — see
 *  physarum2.ts's header. Everything else here (packing, uniform array sizes, the
 *  attraction table's shape) is keyed to this rather than a repeated
 *  literal. */
export const SPECIES_COUNT = STRAINS.length;

// --- "Spread"'s linear map onto the reseed/inject disc's radius (unit-
// square units) — see physarum2.ts's header for why this scene clusters a reseed
// instead of scattering it field-wide like physarum.ts's own beat seeding.
// Replaces the old fixed SEED_CLUSTER_RADIUS so the pipette (Phase 3) and
// the automatic beat reseed can share one live control. ---
export const SEED_SPREAD_MIN = 0.02;
export const SEED_SPREAD_MAX = 0.3;
/** The old fixed disc radius, before "seedSpread" existed — kept only to
 *  derive that setting's default (radiusToSeedSpreadSlider), so the shipped
 *  radius is unchanged. */
const LEGACY_SEED_CLUSTER_RADIUS = 0.12;

export function radiusToSeedSpreadSlider(r: number): number {
  return (r - SEED_SPREAD_MIN) / (SEED_SPREAD_MAX - SEED_SPREAD_MIN);
}

/** The `switching` setting's default. The rule it scales (SWITCH_MAX and the
 *  rest) is documented in physarum2.ts, under "Headcount". */
export const SWITCHING_DEFAULT = 0.4;

export function distToSensorSlider(d: number): number {
  return (d - SENSOR_DIST_MIN) / (SENSOR_DIST_MAX - SENSOR_DIST_MIN);
}

export function degToTurnSlider(deg: number): number {
  return deg / TURN_DEG_MAX;
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

// Per-item gain (SceneSetting.drive.gain) for the Sensor range/Turn
// angle/Speed and Stain jacks' own per-strain band default: tames a
// sustained band level (anim.low/mid/high/energy can sit near 1 through a
// whole loud passage) before it reaches pushToward1/the stain shift in physarum2Strains.ts,
// so the default reads as a nudge rather than pinning every strain toward 1
// (or rotating a strain off its own identity colour) for as long as the
// band stays loud. Tuned from side-by-side frames against the pre-jack look —
// the scene's record has the rejected values and what they did.
export const MOTION_JACK_GAIN = 0.15; // Sensor range/Turn angle/Speed
export const STAIN_JACK_GAIN = 0.2; // Stain

/** The `level` setting's default. */
export const LEVEL_DEFAULT = 0.5;

/** The `startInk` setting's default. */
export const START_INK_DEFAULT = 0.15;

function cssColor([r, g, b]: readonly [number, number, number]): string {
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

// ---------------------------------------------------------------------
// Settings: per-strain items (sceneItems.ts) + the remaining global rows.
// ---------------------------------------------------------------------

const BAND_LABELS = ["low", "mid", "high", "overall"] as const;
/** Each strain's own band, in strain order — reused for the Sensor
 *  range/Turn angle/Speed/Stain jacks' own default below (a strain's own
 *  band drives its own motion the same as it already drives its own
 *  Nutrient) and for Nutrient's own `sceneSources` (its Scene composite is
 *  honestly this same per-strain band). */
export const STRAIN_BAND_SIGNALS = ["anim.low", "anim.mid", "anim.high", "anim.energy"] as const;

export const nutrientSettings = defineItems("strain", SPECIES_COUNT, {
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
    sceneSources: (k) => [STRAIN_BAND_SIGNALS[k]!],
  },
});

export const exciteSettings = defineItems("strain", SPECIES_COUNT, {
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

export const sensorSettings = defineItems("strain", SPECIES_COUNT, {
  key: "sensor",
  label: "Sensor range",
  description: "How far ahead this strain smells — longer range grows bigger, smoother networks",
  group: "Form",
  min: 0,
  max: 1,
  step: 0.02,
  default: (k) => distToSensorSlider(LEGACY_MOTION[k]!.sensorDist),
  // This strain's own band by default (STRAIN_BAND_SIGNALS, same signal as
  // its own Nutrient) — a loud band nudges the range out a little further;
  // pushToward1 is identity at drive 0, so an unplugged jack (or every
  // source muted) leaves the slider's own range exactly where it sits.
  drive: { default: (k) => STRAIN_BAND_SIGNALS[k]!, gain: MOTION_JACK_GAIN },
});

export const turnSettings = defineItems("strain", SPECIES_COUNT, {
  key: "turn",
  label: "Turn angle",
  description: "How sharply this strain turns toward a scent",
  group: "Form",
  min: 0,
  max: 1,
  step: 0.02,
  default: (k) => degToTurnSlider(LEGACY_MOTION[k]!.turnDeg),
  // This strain's own band by default — a loud band nudges the turn a
  // little sharper; identity at drive 0, same reasoning as Sensor range.
  drive: { default: (k) => STRAIN_BAND_SIGNALS[k]!, gain: MOTION_JACK_GAIN },
});

export const strideSettings = defineItems("strain", SPECIES_COUNT, {
  key: "stride",
  label: "Speed",
  description: "How far this strain moves each step, on top of the global Crawl speed",
  group: "Form",
  min: 0,
  max: 1,
  step: 0.02,
  default: (k) => distToStrideSlider(LEGACY_MOTION[k]!.strideDist),
  // This strain's own band by default — a loud band nudges the speed a
  // little further; identity at drive 0, same reasoning as Sensor range.
  drive: { default: (k) => STRAIN_BAND_SIGNALS[k]!, gain: MOTION_JACK_GAIN },
});

export const stainSettings = defineItems("strain", SPECIES_COUNT, {
  key: "stain",
  label: "Stain",
  description: "Colour shift over this strain's own base colour",
  group: "Form",
  min: -0.5,
  max: 0.5,
  step: 0.01,
  default: 0,
  // This strain's own band by default — a loud band shifts the hue a little
  // further. The additive `drive.stain*STAIN_DRIVE_GAIN` term
  // (resolveStrainEffective) is already 0 at drive 0, so an unplugged jack
  // leaves the slider's own shift alone.
  drive: { default: (k) => STRAIN_BAND_SIGNALS[k]!, gain: STAIN_JACK_GAIN },
});

// Sensor angle and Trail life got their jacks on 2026-10-04 (every lane in
// the Strain settings card has a port): this strain's own band by default,
// like Sensor range — a loud band widens the angle and lengthens the trail a
// little; identity at drive 0, same reasoning as Sensor range.
export const angleSettings = defineItems("strain", SPECIES_COUNT, {
  key: "angle",
  label: "Sensor angle",
  description: "How wide apart this strain's left and right sensors look, in degrees — with Turn angle it decides the pattern it grows",
  group: "Form",
  min: ANGLE_MIN_DEG,
  max: ANGLE_MAX_DEG,
  step: 1,
  default: (k) => Math.round(STRAINS[k]!.sensorAngleRad / DEG),
  drive: { default: (k) => STRAIN_BAND_SIGNALS[k]!, gain: MOTION_JACK_GAIN },
});

export const lifeSettings = defineItems("strain", SPECIES_COUNT, {
  key: "life",
  label: "Trail life",
  description: "How long this strain's trail lasts before it evaporates — more keeps its roads longer",
  group: "Form",
  min: 0,
  max: 1,
  step: 0.02,
  default: LIFE_DEFAULT, // the shared Trail decay, unchanged
  drive: { default: (k) => STRAIN_BAND_SIGNALS[k]!, gain: MOTION_JACK_GAIN },
});

export const attSettings = defineItemPairs("strain", SPECIES_COUNT, {
  key: "att",
  label: (i, j) => (i === j ? `${STRAINS[i]!.code} → own trail` : `${STRAINS[i]!.code} → ${STRAINS[j]!.code}`),
  description: "How strongly this strain is drawn to, or repelled by, each trail",
  group: "Form",
  min: -1.5,
  max: 1.5,
  step: 0.05,
  default: ATTRACT_ROWS,
  masterScale: false,
});

// Off-diagonal only (diagonal: false) — a strain doesn't feed or eat its own
// trail through Touch, so `touchii` would otherwise sit as a permanently
// dead key in Looks, resets and share codes. See physarum2Affinity.ts's
// header and physarum2.ts's header's "Touch" paragraph for what this feeds into.
export const touchSettings = defineItemPairs("strain", SPECIES_COUNT, {
  key: "touch",
  label: (i, j) => `${STRAINS[i]!.code} touch ${STRAINS[j]!.code}`,
  description: "What this strain's steps do to that strain's trail — right feeds it, left eats it",
  group: "Form",
  min: -1.5,
  max: 1.5,
  step: 0.05,
  default: 0,
  diagonal: false,
  masterScale: false,
});

const STRAIN_ITEM_SETTINGS: readonly SceneSetting[] = [
  ...nutrientSettings,
  ...exciteSettings,
  ...sensorSettings,
  ...turnSettings,
  ...strideSettings,
  ...stainSettings,
  ...angleSettings,
  ...lifeSettings,
  ...attSettings,
  ...touchSettings,
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
    label: "Cross-smell",
    description: "How strongly each strain reacts to the others' trails, whichever way its Smell pads point — 0 ignores them, 1 doubles them",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { dynamics: 0.15 },
  },
  {
    key: "wander",
    label: "Wander",
    description:
      "How often an agent picks its turn by chance — weighted toward whichever way smells stronger — instead of always taking the strongest; more grows looser, softer networks",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    // 0 is the old rule exactly: SIM_FRAG's weighted branch is never taken.
    default: 0,
  },
  {
    key: "startInk",
    label: "Start ink",
    description:
      "How much random ink a fresh dish starts with, so the networks condense out of it at once instead of growing from black — used when the scene opens and on Fresh dish",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: START_INK_DEFAULT,
  },
  // --- Motion ---
  {
    key: "speed",
    label: "Crawl speed",
    description: "The base pace: how many simulation steps run per second before Speed boost and Speed pump add to it",
    group: "Motion",
    family: "Crawl speed",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { tempo: 0.3, pulse: 0.15 },
  },
  {
    key: "speedBoost",
    label: "Speed boost",
    description: "The sim runs faster the louder the music is right now, and drops straight back to Crawl speed when it quietens",
    group: "Motion",
    family: "Crawl speed",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { dynamics: 0.3, density: -0.15 },
    // Loudness by default; an unplugged jack adds nothing (rest 0), since
    // this only ever adds on top of Crawl speed.
    drive: { default: "anim.energy" },
  },
  {
    key: "speedPump",
    label: "Speed pump",
    description: "Each push accelerates the crawl like a gas pedal; the extra speed then coasts back down to Crawl speed",
    group: "Motion",
    family: "Crawl speed",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
    // Only reads as a pump on music with real hits to push against.
    auto: { pulse: 0.35, attack: 0.2 },
    // A kick is the natural pedal to push against; rewire it in the picker.
    drive: { default: "anim.kickOnset" },
  },
  {
    key: "seed",
    label: "Dose",
    description: "Share of agents relocated into a fresh cluster — by a beat, or by the pipette in the Strains panel above",
    group: "Motion",
    // A finer step than this scene's usual 0.05: the reseed disc's area is
    // only a few percent of the trail map ("Spread", below), so this setting
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
    // The trigger is a *climb* in the decaying beat pulse that stands out from
    // the everyday ones (standout.ts's StandoutTrigger, the same filter
    // Caustics' Beat ripple uses), so a busy passage reseeds only on its
    // clear hits instead of on every tick. Scene-handled threshold: the scene
    // owns the idea (drive.threshold, read back with drives.threshold), so the
    // engine's own generic gate stays out of it. command("inject") (the
    // pipette, Phase 3) reads this setting's plain stored amount too, with no
    // drive involved — the drive only ever gates the *automatic* trigger,
    // never the pipette's own one-shot command. See physarum2.ts's header.
    drive: {
      default: "scene",
      sceneLabel: "Scene: a beat hit that stands out",
      sceneSources: ["feature.onset"],
      // Flat or Sized (the Reaction row): Sized moves a share of agents
      // as big as the hit stood out, Dose times its size.
      hit: { ownDetector: true },
      threshold: {
        default: STANDOUT_THRESHOLD_DEFAULT,
        label: "Dose threshold",
        hint: "Moves the dotted line: how far a sound has to stand out from the everyday ones to start a new colony. Left: more colonies, even from quiet sounds. Right: only clear standouts.",
      },
    },
  },
  {
    key: "switching",
    label: "Switching",
    description:
      "How readily an agent joins the strain whose ink outweighs its own where it stands, so the headcount follows the settings — 0 keeps every agent in its strain",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: SWITCHING_DEFAULT,
  },
  {
    key: "seedSpread",
    label: "Spread",
    description: "Radius of the disc a beat's reseed, or the pipette's injection, lands agents in",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.02,
    // Reproduces the scene's old fixed disc radius (LEGACY_SEED_CLUSTER_RADIUS)
    // so the shipped look is unchanged.
    default: radiusToSeedSpreadSlider(LEGACY_SEED_CLUSTER_RADIUS),
  },
  {
    key: "seedFrom",
    label: "Auto-inject from",
    description: "Which strains the automatic beat trigger may move agents from — it never converts species (only the pipette does)",
    group: "Motion",
    type: "enum",
    options: ["All strains", ...STRAINS.map((s) => s.code)],
    min: 0,
    max: SPECIES_COUNT,
    step: 1,
    default: 0,
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
    key: "level",
    label: "Auto level",
    description:
      "Brings every strain's brightest roads to the same brightness, so a sparse or short-lived strain isn't drowned out by a dense one — 0 lights them all by Exposure alone",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: LEVEL_DEFAULT,
  },
  {
    key: "synergy",
    label: "Synergy",
    description:
      "Pulls the four stains toward the nearest colour harmony — 0 shows them as set, 1 snaps them onto it (the stains you set are kept)",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
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

export const SETTINGS: SceneSetting[] = composeSettings(STRAIN_ITEM_SETTINGS, GLOBAL_SETTINGS);

// ---------------------------------------------------------------------
// Motion presets (2026-10-02): the Strain Console's preset pills — each sets
// every strain's MOTION_PARAMS at once, like a saved species config in
// Fogleman's viewer. Our own sets, picked from a headless random search over
// these same sliders (the scene record's Decisions entry); "Lab" is the
// shipped default motion.
// ---------------------------------------------------------------------

/** The per-strain params a motion preset (and the console's Random) sets. */
export const MOTION_PARAMS = ["sensor", "angle", "turn", "stride"] as const;

export interface MotionPreset {
  name: string;
  hint: string;
  /** Slider values, one per strain, for each of MOTION_PARAMS. */
  values: Readonly<Record<(typeof MOTION_PARAMS)[number], readonly number[]>>;
}

export const MOTION_PRESETS: readonly MotionPreset[] = [
  {
    name: "Lab",
    hint: "The shipped motion: highways, a mesh, coarse cells and a fine fuzz.",
    values: {
      sensor: LEGACY_MOTION.map((m) => distToSensorSlider(m.sensorDist)),
      angle: STRAINS.map((s) => Math.round(s.sensorAngleRad / DEG)),
      turn: LEGACY_MOTION.map((m) => degToTurnSlider(m.turnDeg)),
      stride: LEGACY_MOTION.map((m) => distToStrideSlider(m.strideDist)),
    },
  },
  {
    name: "Cells",
    hint: "Round cells, each walled in by another strain's thin roads.",
    values: {
      sensor: [0.8, 0.16, 0.98, 0.38],
      angle: [17, 62, 84, 61],
      turn: [0.56, 0.4, 0.3, 0.94],
      stride: [0.12, 0.94, 0.22, 0.46],
    },
  },
  {
    name: "Coral",
    hint: "One strain grows thick branching worms through a dense ground.",
    values: {
      sensor: [0.38, 0.96, 0.52, 0.28],
      angle: [98, 15, 95, 107],
      turn: [0.56, 0.12, 0.68, 0.1],
      stride: [0.92, 0.64, 0.1, 0.04],
    },
  },
  {
    name: "Weave",
    hint: "Fine crossing fibres over soft pools of colour.",
    values: {
      sensor: [0.44, 0.18, 0.66, 0.44],
      angle: [17, 11, 64, 114],
      turn: [0.5, 0.06, 0.3, 0.6],
      stride: [0.92, 0.32, 1, 0.38],
    },
  },
  {
    name: "Islands",
    hint: "Big blotchy islands with a lacy sea between.",
    values: {
      sensor: [0.7, 0.72, 0.54, 0.84],
      angle: [79, 6, 82, 35],
      turn: [0.22, 0.9, 0.26, 0.02],
      stride: [0.06, 0.48, 0.68, 0.2],
    },
  },
  {
    name: "Grains",
    hint: "Short scattered grains, like seeds, on a soft ground.",
    values: {
      sensor: [0.02, 0.68, 0.46, 0.2],
      angle: [19, 30, 85, 119],
      turn: [0.02, 0.2, 0.28, 0.56],
      stride: [0.22, 0.62, 0.26, 0.72],
    },
  },
];

// ---------------------------------------------------------------------
// The panel: one Strains group (specimen boxes + the selected strain's
// rows + the Pairs pads) — see src/ui/widgets/itemBoxes.ts and, for the
// pads themselves, src/ui/widgets/pairPads.ts. `options` is typed `unknown`
// by PanelSection (scene.ts) precisely so this file, under src/render/,
// never has to import anything under src/ui/ — see sceneItems.ts's header
// for why that boundary matters. The Pairs block's words (`PAIR_WORDS`) and
// presets (`AFFINITY_PRESETS`, which replaces this scene's old, Smell-only
// `EXPERIMENT_PRESETS`) live in physarum2Affinity.ts instead of here, next
// to the pure pad logic that reads them.
// ---------------------------------------------------------------------

const PANEL: readonly PanelSection[] = [
  {
    widget: "itemBoxes",
    title: "Strains",
    items: "strain",
    // Switching and Synergy are drawn by the widget itself (under the
    // headcount bar and under the Strain Console's stains), so the Scene
    // card's flat list leaves them out.
    settings: ["switching", "synergy"],
    options: {
      labels: STRAINS.map((s) => s.code),
      colours: STRAINS.map((s) => cssColor(s.color)),
      headcountSetting: "switching",
      // The Strain Console card: every per-strain setting for all the strains
      // at once, a row of lanes each, with Stain Synergy under them — see
      // src/ui/widgets/strainConsole.ts. The order is the row order.
      console: {
        title: "Strain settings",
        params: ["nutrient", "excite", "sensor", "angle", "turn", "stride", "life", "stain"],
        formats: { angle: "degrees", stain: "turns" },
        // A Stain is a hue shift over the strain's own base colour, so each
        // lane's rail and the Synergy wheel need the base hue (turns).
        hue: { param: "stain", baseHues: STRAINS.map((s) => rgbToHsl(s.color)[0]) },
        synergy: { key: "synergy" },
        // Random rolls MOTION_PARAMS over their whole ranges, and
        // the pills are MOTION_PRESETS; Shuffle/New palette rewrite the
        // stains (strainConsole.ts's header).
        mix: { random: MOTION_PARAMS, presets: MOTION_PRESETS },
        colourActions: true,
      },
      // Phase 3's live pure-culture preview — src/ui/widgets/previews.ts's
      // registry id. itemBoxes.ts falls back to the old empty placeholder
      // swatch when a widget's options carry no preview id at all, so this
      // doesn't disturb any other itemBoxes-based scene.
      preview: "physarum2",
      relations: {
        title: "Affinity",
        tables: { smell: "att", touch: "touch" },
        shortLabels: STRAINS.map((s) => s.code.replace(/^PP-/, "")),
        words: PAIR_WORDS,
        presets: AFFINITY_PRESETS,
      },
    },
  },
];

export const card: SceneCard = {
  id: "physarum2",
  name: "Physarum 2",
  settings: SETTINGS,
  panel: PANEL,
};

export const loadBody = (): Promise<Scene> => import("./physarum2.ts").then((m) => m.physarum2Scene);
