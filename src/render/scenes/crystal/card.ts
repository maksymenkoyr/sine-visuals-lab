// Crystal's card: what every page needs before the scene's code loads (src/render/lazyScene.ts).
import type { Scene, SceneCard } from "../../scene.ts";
import type { SceneSetting } from "../../sceneSettings.ts";

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "draft", added: "2026-09-19" } as const;

export const SETTINGS: SceneSetting[] = [
  {
    key: "tiling",
    label: "Cell size",
    description: "Scale of the lattice: below 1 more, smaller cells; above 1 fewer, bigger.",
    group: "Form",
    min: 0.5,
    max: 2.0,
    step: 0.05,
    default: 1.0,
  },
  {
    key: "density",
    label: "Density",
    description: "How much crystal fills each cell of the corridor.",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    auto: { density: 0.3 },
  },
  {
    key: "zoom",
    label: "Travel",
    description: "How fast the camera wanders through the crystal — zooming and sliding, never cutting.",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    auto: { tempo: 0.25, loudness: 0.15 },
  },
  {
    key: "speed",
    label: "Speed",
    description: "How fast the camera flies and rolls through the crystal.",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
    auto: { tempo: 0.3, loudness: 0.2 },
  },
  {
    key: "pulse",
    label: "Beat pulse",
    description: "Brightness pop on each beat, and the push it gives the marks.",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    auto: { pulse: 0.3, attack: 0.2 },
    // anim.onset directly (advanceCrystal's zoomVel/swell impulses) — a
    // plain Beat default. beatCount and the light layers still run off the
    // raw onset regardless of this choice — see CrystalInputs.pulseOnset.
    drive: { default: "feature.onset", hit: { reactionLabel: "pulse" } },
  },
  {
    key: "flare",
    label: "Flare",
    description:
      "Strength of the light layers: the ice blobs fading in on every bar, the fan on drops, and the red / edge-lit looks a slow mood alternates between.",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.8,
    auto: { dynamics: 0.3, loudness: 0.2 },
    reads: ["anim.dropOnset"],
  },
  {
    key: "hold",
    label: "Light hold",
    description: "How long a lit layer stays before it decays, in seconds.",
    group: "Motion",
    min: 0.1,
    max: 2.0,
    step: 0.05,
    default: 0.35,
    auto: { tempo: -0.3 },
  },
  {
    key: "glow",
    label: "Glow",
    description: "Strength of the soft bloom halo around the lit edges and the ice blobs.",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { brightness: 0.25 },
  },
  {
    key: "neon",
    label: "Neon",
    description: "The red neon strips along some of the panel edges.",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.7,
    auto: { loudness: 0.2, brightness: -0.15 },
  },
  {
    key: "ground",
    label: "View depth",
    description: "How far the corridor stays visible before fading to black.",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    auto: { brightness: 0.2 },
  },
];

export const card: SceneCard = {
  id: "crystal",
  name: "Crystal Wall",
  minQuality: "low",
  settings: SETTINGS,
};

export const loadBody = (): Promise<Scene> => import("./index.ts").then((m) => m.crystalScene);
