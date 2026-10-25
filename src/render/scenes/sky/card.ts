// Sky's card: what every page needs before the scene's code loads (src/render/lazyScene.ts).
import type { Scene, SceneCard } from "../../scene.ts";
import type { SceneSetting } from "../../sceneSettings.ts";

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "released", added: "2026-09-27" } as const;

// Every auto table below reproduces its plain `default` when all dials sit
// at NEUTRAL (musicProfile.ts) — nothing hand-biased; see
// tests/sky.test.ts. Weights follow autoTune.ts's convention (|weight| in
// ~0.15..0.5, per-setting sum under ~0.8).
export const SETTINGS: SceneSetting[] = [
  // Form
  {
    key: "cloudCover",
    label: "Cloud cover",
    description: "How much dye the ambient drift injects into the sky — thin wisps at the low end, a fuller cover at the high end",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { density: 0.3 },
    // A plain Section default — a chorus gathers a little more cloud than a
    // verse does; lifted on top of the slider (liftByDrive in render()), so
    // an unplugged jack leaves Cloud cover exactly where its slider sits.
    drive: { default: "anim.sectionIntensity" },
  },
  // Motion
  {
    key: "flowSpeed",
    label: "Flow speed",
    description: "How fast the whole fluid evolves — a slow drift at the low end, a brisker roll at the high end",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { tempo: 0.25 },
    // A plain All level default — the room's own energy nudges the fluid to
    // roll a little faster (liftByDrive in render(), which is where the
    // drive actually moves the fluid, through the sim's own dt/force — the
    // streak-wind formula in FRAG deliberately reads the slider alone; see
    // that formula's own comment).
    drive: { default: "anim.energy" },
  },
  {
    key: "turbulence",
    label: "Turbulence",
    description: "How readily the drift curls into swirls and tendrils instead of a smooth roll",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.45,
    auto: { density: 0.2, tempo: 0.2 },
    // A plain Bass level default — a bass-heavy passage curls the drift into
    // a few more swirls (liftByDrive in render()).
    drive: { default: "anim.low" },
  },
  {
    key: "floaterDensity",
    label: "Floaters",
    description:
      "How many floaters each stamp lays down — a light touch at the low end, a dense cloud of them at the high end. The input node scales it beat by beat, and 0 stops the brush stamping entirely",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { density: 0.2, dynamics: 0.15 },
    // The one floater param: its jack owns the stamp trigger AND how many
    // floaters a stamp lays down (render(): spawnFloaters gates the spawn on
    // this amount's product, drives.value() grades the count). Scene
    // composite is the shared beat listener (one stamp per beat) with the
    // count riding loudness — see floaterCountFromEnergy — so sceneSources
    // names both halves a re-patch replaces.
    drive: {
      default: "scene",
      sceneLabel: "Scene: every beat, count rides loudness",
      sceneSources: ["feature.onset", "anim.energy"],
      hit: { reactionLabel: "stamp" },
    },
  },
  {
    key: "brushMove",
    label: "Brush move",
    description: "How far the brush steps across the sky each time it stamps — held in place at 0 (stamps pile up), long hops toward the edges at 1",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
  },
  {
    key: "floaterSustain",
    label: "Floater sustain",
    description: "How long each wave of floaters stays before it dissolves — a quick flicker at the low end, several seconds of hanging in the sky at the high end",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
  },
  {
    key: "floaterGlide",
    label: "Floater glide",
    description:
      "How the floaters travel with their streak — snapping from cell to cell on a fixed screen grid at 0, gliding smoothly with the wind at 1",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 1,
  },
  {
    key: "dayDrift",
    label: "Day drift",
    description:
      "How fast the sky moves through its day — held still at 0, a slow daylight drift just above it, a quick one at 1. It hurries through the hours after sunset, since the scene has no night",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
  },
  // Look
  {
    key: "timeOfDay",
    label: "Time of day",
    description:
      "Where in a 24-hour day the sky sits — 0.25 sunrise, 0.5 noon, 0.75 sunset; between sunset and sunrise it holds a soft twilight glow rather than going dark. With Day drift above zero the sky keeps moving on from here",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.71,
    // A position on a 24-hour clock, not an amount: the Master and Expansion
    // dials must not move the sun (see SceneSetting.masterScale).
    masterScale: false,
  },
  {
    key: "cloudBrightness",
    label: "Cloud brightness",
    description: "How brightly lit the cloud tops read against the sky",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    auto: { loudness: 0.2 },
    // A plain Mid level default — the cloud tops lift a little brighter with
    // the mids (skyLift in FRAG, the GLSL twin of liftByDrive).
    drive: { default: "anim.mid" },
  },
  {
    key: "brushOpacity",
    label: "Brush opacity",
    description: "Faintness of Haidinger's brush, the bowtie afterimage that turns slowly over the centre of view — dims a little further as the music gets louder",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
    auto: { density: -0.2 },
    // A plain All level default: the shader dims the brush by
    // (1 - 0.4 * brushOpacityDrive(uEnergy)) (buildDisplayFrag's brush
    // term) — identity at drive 0, so an unplugged jack leaves the brush at
    // the slider's own opacity rather than making it vanish.
    drive: { default: "anim.energy" },
  },
  {
    key: "floaterVisibility",
    label: "Floater visibility",
    description: "How strongly the floaters stand out from the sky behind them — gone at 0, faint and glassy low, crisp and bold high",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // A plain Treble level default — floaters stand out a little more with
    // the hats/cymbals (liftByDrive in render()).
    drive: { default: "anim.high" },
  },
  {
    key: "lightWaves",
    label: "Light waves",
    description: "How brightly the floaters glint in pale sky tints as a ring of light passes through them on each beat",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    // The beat sweep's spawn trigger (the brightness itself is this
    // slider's amount). Scene composite is the beat beatListener — its
    // one-per-beat hold still owns the cadence under Scene (see render());
    // its edge is the broadband onset, which is what sceneSources names.
    drive: {
      default: "scene",
      sceneLabel: "Scene: every beat",
      sceneSources: ["feature.onset"],
      hit: { reactionLabel: "light wave" },
    },
  },
  {
    key: "rainbow",
    label: "Rainbow",
    description:
      "How much the light waves split into rainbow bands, and the floaters' rims into faint prism colours — the pale sky tints alone at 0, a clear spectrum at 1",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
  },
  {
    key: "sprites",
    label: "Blue-field sprites",
    description:
      "Tiny bright specks darting along short curved paths all over the sky, the way they do when you stare at a bright blue sky — none at 0, a busy field at 1. They thin out right at the centre of view, and the input node makes them surge forward",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    // A plain Beat default: each beat pulse surges the sprites forward
    // (spriteSpeed in render(), 1 at drive 0), like the real ones pulsing
    // with the heartbeat; an unplugged jack leaves them at their own pace.
    drive: { default: "feature.onset" },
  },
  {
    key: "dither",
    label: "Gradient dither",
    description:
      "Fine noise, about one brightness step, that hides the stripes a smooth sky gradient shows on an 8-bit screen — off at 0, two steps at 1",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
  },
];

export const card: SceneCard = {
  id: "sky",
  name: "Sky",
  settings: SETTINGS,
};

export const loadBody = (): Promise<Scene> => import("./index.ts").then((m) => m.skyScene);
