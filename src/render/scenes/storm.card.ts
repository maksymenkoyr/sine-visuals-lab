// Storm's card: what every page needs before the scene's code loads (src/render/lazyScene.ts).
import type { Scene, SceneCard } from "../scene.ts";
import type { SceneSetting } from "../sceneSettings.ts";

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "draft", added: "2026-09-02" } as const;

/** The `mode` setting's options, in value order. Filaments is the default;
 *  it is appended rather than put first so every mode that shipped before it
 *  keeps the index a saved setting already refers to. */
const MODES: readonly string[] = ["Mesh", "Gas", "Voxel", "Points", "Filaments"];
/** The `spectrumMap` setting's options, in value order — see spectrumGain. */
const SPECTRUM_MAPS: readonly string[] = ["Off", "Screen", "Cloud"];
/** The `gasType` setting's options, in value order — one per entry of
 *  GAS_RECIPES, which is what each of them actually means. */
export const GAS_TYPES: readonly string[] = ["Cumulus", "Wisp", "Smoke", "Nebula"];
export const SPECTRUM_MAP_CLOUD = 2;
export const MODE_MESH = 0;
export const MODE_VOXEL = 2;
export const MODE_POINTS = 3;
export const MODE_FILAMENTS = 4;

// Every table below reproduces its plain `default` when all dials sit at
// NEUTRAL (musicProfile.ts) — nothing is hand-biased. `pulse` is kept small
// throughout: it floors near 0.9 on any locked-tempo track (see the Fog
// pulse comment in caustics.ts), so a large pulse weight is really a constant
// offset in disguise.
export const SETTINGS: SceneSetting[] = [
  {
    key: "bolt",
    label: "Bolt",
    description: "How much bolt each beat draws: from a thin bare channel up to a thick, brightly forked one",
    // Form, not Look — despite "brightly" in the description, uBolt's
    // shader math (buildBoltTree/boltCore in FRAG) mostly spends this on
    // branch count and stroke width; brightness is one term among three.
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    auto: { attack: 0.3 },
    // uBeatPulse directly (the extra brightness term in BOLT_VERT's
    // `bright`) — a plain Beat default.
    drive: { default: "feature.onset" },
  },
  {
    key: "density",
    label: "Cloud density",
    description: "How thick the gas is — and, in Points mode, how many particles are drawn",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    auto: { density: 0.3 },
    glide: false,
  },
  {
    key: "cloudShape",
    label: "Cloud shape",
    description: "Morphs the cloud through its silhouettes — a different mass at every setting",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
    auto: { density: 0.3, dynamics: 0.2 },
  },
  {
    // Keyed `grain`, not `detail`: settingUniformName would make that
    // `uDetail`, which COMMON_UNIFORMS_GLSL already owns as the quality proxy
    // — two declarations of the same name is a shader compile error.
    key: "grain",
    label: "Grain",
    description: "How coarse the cloud gets: how hard the noise erodes the cloud into billows, how big a voxel is, how big each point or lattice node draws, and how brightly a filament burns",
    // Form, not Look — three of its four shader uses (erosion depth, voxel
    // size, point/node pixel size) are size/structure; only the filament
    // gain at the end is a brightness term.
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    advanced: true,
  },
  {
    key: "morphSpeed",
    label: "Morph speed",
    description: "How fast the cloud glides from one silhouette to the next — Off holds the shape still",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
    auto: { tempo: 0.3 },
  },
  {
    key: "morphBeat",
    label: "Morph on beat",
    description: "How far each beat lurches the cloud's shape forward",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    auto: { pulse: 0.2, attack: 0.2 },
    // The lurch's amplitude (beatAmp, render()) is graded across a union of
    // three signals — a drop takes priority, else a bass or beat rise — so
    // the default is Scene.
    drive: {
      default: "scene",
      sceneLabel: "Scene: drop, else bass or beat hit",
      sceneSources: ["anim.dropOnset", "anim.lowOnset", "feature.onset"],
    },
  },
  {
    key: "flow",
    label: "Flow",
    description: "How fast the filament tangle crawls along its flow field, and how hard a strike shoves it",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    auto: { tempo: 0.3, pulse: 0.15 },
  },
  {
    key: "swirl",
    label: "Swirl speed",
    description: "How fast the cloud turns",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    auto: { tempo: 0.35, pulse: 0.15 },
  },
  {
    key: "swell",
    label: "Bass swell",
    description: "How much the low band puffs the cloud up",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { brightness: -0.35 },
    // uLow directly (swellScale() in CAMERA_GLSL) — a plain Bass level default.
    drive: { default: "anim.low" },
  },
  // "Look" leads so the picker sits at the top of the device menu: it decides
  // what the rest of the settings are even acting on.
  {
    key: "mode",
    label: "Mode",
    description: "Filaments traces the cloud as a tangle of glowing strands; Mesh is a digital lattice; Gas is the raymarched volume; Voxel is that volume gone blocky; Points is a point cloud.",
    group: "Look",
    type: "enum",
    options: MODES,
    min: 0,
    max: MODES.length - 1,
    step: 1,
    default: MODE_FILAMENTS,
  },
  {
    // Manual by design, like every enum: an auto table would be picking a
    // mapping for the viewer, and Off/Screen/Cloud are three different looks
    // rather than three amounts of one.
    key: "spectrumMap",
    label: "Spectrum map",
    description: "Lights the cloud by frequency: Screen splits the spectrum left-to-right across the frame, Cloud pins it to the cloud so it spins with the swirl.",
    group: "Look",
    type: "enum",
    options: SPECTRUM_MAPS,
    min: 0,
    max: SPECTRUM_MAPS.length - 1,
    step: 1,
    default: 1,
  },
  {
    key: "strike",
    label: "Strike intensity",
    description: "How hard each beat's lightning lights the cloud",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.75,
    auto: { attack: 0.3, pulse: 0.15 },
    // Gates the pool's ordinary strike (render()) — a bass hit OR a beat
    // hit: no single catalogue source covers that union, so the default is
    // Scene.
    // uStrike's own GLSL sites are all plain gain curves on the setting's
    // own resolved value, no live signal, so nothing there needs wrapping.
    drive: { default: "scene", sceneLabel: "Scene: bass or beat hit", sceneSources: ["anim.lowOnset", "feature.onset"], hit: { reactionLabel: "strike" } },
  },
  {
    key: "reach",
    label: "Flash reach",
    description: "How far into the cloud a strike's light carries",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.65,
    auto: { density: -0.2, dynamics: 0.2 },
  },
  {
    key: "flicker",
    label: "Flicker",
    description: "Return strokes: how many times a strike re-flashes before it fades",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { attack: 0.25 },
  },
  {
    key: "afterglow",
    label: "Afterglow",
    description: "How long a strike keeps glowing after the flash",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    auto: { tempo: -0.3, pulse: 0.15 },
  },
  {
    key: "sections",
    label: "Dark sections",
    description: "Rests the cloud in dark regions and lights them one or two at a time — on beats, on treble hits, and wherever a bolt lands",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.7,
    auto: { dynamics: 0.3, attack: 0.2 },
  },
  {
    // Manual by design, like every enum (see spectrumMap): the four gases are
    // four characters, not four amounts of one thing, and GAS_RECIPES is what
    // each of them means.
    key: "gasType",
    label: "Gas",
    description: "What the cloud is made of: Cumulus is the puffy default, Wisp a thin streaky stratus, Smoke a dark torn charcoal, Nebula a glowing translucent haze",
    // Look, not Form — GAS_RECIPES bundles noise-shape terms (freq, stretch,
    // erosion, worley) with light terms (extinction, powder, tint) into one
    // material identity, the same kind of categorical call as dancers' Skin.
    group: "Look",
    type: "enum",
    options: GAS_TYPES,
    min: 0,
    max: GAS_TYPES.length - 1,
    step: 1,
    default: 0,
  },
  {
    key: "ambient",
    label: "Ambient glow",
    description: "Resting brightness of the cloud between strikes — near zero leaves an ember for the lightning to reveal",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.25,
    auto: { loudness: 0.3, brightness: 0.2 },
    // uEnergy directly, at every site (the march's ambient term and each
    // geometry pass's own copy of it) — a plain All level default.
    drive: { default: "anim.energy" },
  },
  {
    key: "spark",
    label: "Treble wisps",
    description: "Fine detail the high band frays into the cloud's edges — a shimmer across the lattice in Mesh mode",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
    auto: { brightness: 0.35 },
    // Mode-dependent: the march's own erosion term reads uHigh (a level),
    // every geometry pass's shimmer reads uHighPulse (a hit) behind its own
    // stochastic gate — no single catalogue source covers both, so the
    // default is Scene.
    drive: {
      default: "scene",
      sceneLabel: "Scene: treble level (march) or treble hits (lattice/points/strands)",
      sceneSources: ["anim.high", "anim.highOnset"],
    },
  },
  {
    key: "spectrumGlow",
    label: "Spectrum glow",
    description: "How hard the band level under a part of the cloud drives how brightly it is lit (needs Spectrum map)",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { brightness: 0.25, density: 0.2 },
  },
];

export const card: SceneCard = {
  id: "storm",
  name: "Storm",
  // The floor preset's raymarch budget is too thin for a volume this deep —
  // it bands into shells rather than reading as gas.
  minQuality: "low",
  settings: SETTINGS,
};

export const loadBody = (): Promise<Scene> => import("./storm.ts").then((m) => m.stormScene);
