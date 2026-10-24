// Ambience's card: what every page needs before the scene's code loads (src/render/lazyScene.ts).
import type { Scene, SceneCard } from "../scene.ts";
import type { SceneSetting } from "../sceneSettings.ts";

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "development", added: "2026-09-04" } as const;

// Every table below reproduces its plain `default` when all dials sit at
// NEUTRAL (musicProfile.ts) — nothing is hand-biased. `pulse` is kept small:
// it floors near 0.9 on any locked-tempo track (see the Fog pulse comment in
// caustics.ts), so a large pulse weight is a constant offset in disguise.
export const SETTINGS: SceneSetting[] = [
  {
    key: "sheetDensity",
    label: "Sheet density",
    description: "Multiplies the lattice's rows and columns: above 1 is a finer lattice, below 1 a coarser one",
    group: "Form",
    min: 0.5,
    max: 2,
    step: 0.25,
    default: 1,
    advanced: true,
  },
  {
    key: "waveHeight",
    label: "Wave height",
    description: "How far the sheet's ripples lift and drop its rows",
    group: "Motion",
    min: 0,
    max: 3,
    step: 0.05,
    default: 1,
    // Dynamic material rolls harder; bright mixes stay a little calmer.
    auto: { dynamics: 0.3, brightness: -0.15 },
    // Two signals across two ripple terms (bass, mid), plus a non-audio
    // noise roll — no single catalogue pick reproduces the mix, so the
    // default is Scene.
    drive: { default: "scene", sceneLabel: "Scene: bass + mid ripple terms", sceneSources: ["anim.low", "anim.mid"] },
  },
  {
    key: "waveSpeed",
    label: "Wave speed",
    description: "How fast the ripples travel across the sheet",
    group: "Motion",
    min: 0,
    max: 3,
    step: 0.05,
    default: 1,
    // Faster tracks get faster ripples.
    auto: { tempo: 0.25 },
  },
  {
    key: "breathe",
    label: "Breathe",
    description: "How much each disc swells with its own frequency band (bass in the middle columns, treble at the edges)",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { dynamics: 0.25 },
  },
  {
    key: "swell",
    label: "Beat swell",
    description: "How far the discs balloon inside the swell a hit sends along a row or column",
    group: "Motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    // Punchy, transient-heavy material gets bigger blobs.
    auto: { attack: 0.3, pulse: 0.2 },
    // Spawns a swell on a bass hit OR a beat hit, unconditionally (render())
    // — no single catalogue source covers that union, so the default is
    // Scene. A drop's own burst is unconditional, independent of this choice.
    drive: { default: "scene", sceneLabel: "Scene: bass or beat hit", sceneSources: ["anim.lowOnset", "feature.onset"], hit: { reactionLabel: "swell" } },
  },
  {
    key: "swellSpeed",
    label: "Swell speed",
    description: "How fast a swell runs along its line",
    group: "Motion",
    min: 0.3,
    max: 3,
    step: 0.05,
    default: 1,
    advanced: true,
  },
  {
    key: "stretch",
    label: "Motion streaks",
    description: "How far a fast-moving disc smears along its path -- the streaks of a flip or the line sweeping out the sheet",
    group: "Motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    auto: { tempo: 0.2 },
  },
  {
    key: "dotSize",
    label: "Dot size",
    description: "Disc radius as a share of the lattice spacing, before the beat swells",
    group: "Look",
    min: 0.2,
    max: 3,
    step: 0.05,
    default: 1,
    // Bright, sharp-attack material reads well with bolder discs.
    auto: { brightness: 0.2, attack: 0.15 },
  },
  {
    key: "glow",
    label: "Glow",
    description: "Width and strength of the soft halo around every disc and comet",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 0.8,
  },
  {
    key: "fog",
    label: "Fog",
    description: "How quickly the far rows dim into the ground",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
  },
  {
    key: "cameraDrift",
    label: "Camera drift",
    description: "How often the camera and the sheet move to a new pose (every few bars at 0, every bar at 1) and how briskly they sweep there",
    group: "Camera",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { tempo: 0.2 },
  },
  {
    key: "flip",
    label: "Flip",
    description: "How far the sheet itself tumbles between poses -- low tilts it, high turns it right over",
    group: "Camera",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    auto: { dynamics: 0.2 },
  },
  {
    key: "transitions",
    label: "Transitions",
    description: "How often the lattice leaves the sheet for a journey -- folding down to a line and a dot, rolling into a tube, stacking into a cube, turning through the fourth dimension -- and comes back",
    group: "Camera",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { dynamics: 0.2 },
  },
  {
    key: "cameraRange",
    label: "Camera range",
    description: "How far a pose may stray from the resting three-quarter view: angle, distance, roll, sheet curvature, stretch, and the band of rows shown",
    group: "Camera",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    advanced: true,
  },
];

export const card: SceneCard = {
  id: "ambience",
  name: "Ambience",
  settings: SETTINGS,
};

export const loadBody = (): Promise<Scene> => import("./ambience.ts").then((m) => m.ambienceScene);
