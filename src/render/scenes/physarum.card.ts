// Physarum's card: what every page needs before the scene's code loads (src/render/lazyScene.ts).
import type { Scene, SceneCard } from "../scene.ts";
import type { SceneSetting } from "../sceneSettings.ts";

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "draft", added: "2026-09-16" } as const;

export const SETTINGS: SceneSetting[] = [
  // --- Form ---
  {
    key: "scale",
    label: "Network scale",
    description: "Sensor distance and step length together — how coarse or fine the whole structure grows",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // A busy, bright mix reads better on a finer network.
    auto: { density: -0.25, brightness: -0.15 },
  },
  {
    key: "fan",
    label: "Fan angle",
    description: "How wide the side sensors sit from the centre one — narrow grows long filaments, wide grows a reticulated mesh",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    reads: ["anim.centroid"],
    auto: { brightness: 0.2, density: 0.2 },
  },
  {
    key: "turn",
    label: "Turn rate",
    description: "How sharply an agent steers onto a trail it finds",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { attack: 0.2 },
  },
  {
    key: "wander",
    label: "Wander",
    description: "Random component in the turn — 0 grows a crystalline lattice, 1 a fuzzy one",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
    auto: { dynamics: 0.15 },
  },
  {
    key: "decay",
    label: "Trail decay",
    description: "How fast an unused route evaporates — long memory, or a network that keeps rerouting",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { density: 0.2, tempo: 0.15 },
  },
  {
    key: "braid",
    label: "Band merge",
    description: "Off keeps the band groups' networks separate and braided; on merges them into a shared structure",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.2,
    auto: { density: 0.2 },
  },
  // --- Motion ---
  {
    key: "speed",
    label: "Crawl speed",
    description: "Base agent speed across the field",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { tempo: 0.3, pulse: 0.15 },
  },
  {
    key: "beatSurge",
    label: "Beat surge",
    description: "How hard each beat kicks the crawl, throwing new branches",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { pulse: 0.25, attack: 0.2 },
    // uBeatPulse directly (SIM_FRAG's surge term) — a plain Beat default.
    drive: { default: "feature.onset" },
  },
  {
    key: "seed",
    label: "Beat seeding",
    description: "Share of agents a beat relocates to a fresh spawn point, starting growth somewhere new",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
    auto: { attack: 0.25, dynamics: 0.15 },
    // The trigger is this scene's own beatSeeder (a *rise* in the decaying
    // beat pulse, onset folded in as a bonus, its own refractory — see the
    // file header and createBeatSeeder), not a plain onset edge, so the
    // default is Scene.
    drive: { default: "scene", sceneLabel: "Scene: a rise in the beat pulse (bonus on a raw onset)", sceneSources: ["feature.onset"], hit: { reactionLabel: "seeding" } },
  },
  {
    key: "reach",
    label: "Band pull",
    description: "How strongly each band group's attractor pulls its own network toward it",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { density: 0.2 },
    // Three signals across three channels (each group pulls toward its own
    // uLow/uMid/uHigh), plus a bass-hit boost on the low group alone — see
    // the DIFFUSE_FRAG loop — so the default is Scene.
    drive: {
      default: "scene",
      sceneLabel: "Scene: each band's own level (bass boosted on a hit)",
      sceneSources: ["anim.low", "anim.mid", "anim.high", "anim.lowOnset"],
    },
  },
  // --- Look ---
  {
    key: "vivid",
    label: "Vividness",
    description: "How saturated the colours stay where the network is dense — 0 lets them wash toward white",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.7,
  },
  {
    key: "glow",
    label: "Glow",
    description: "Brightness of the network",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { loudness: 0.2 },
  },
  {
    key: "relief",
    label: "Relief",
    description: "Shades the filaments as lit tubes instead of flat ink",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
  },
  {
    key: "paletteMix",
    label: "Palette tint",
    description: "0 keeps the network's own band colours; 1 recolours it with the app palette",
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
    default: 0.3,
    // Same convention powder.ts and chladni.ts share for this control.
    auto: { attack: 0.3, pulse: 0.2, density: -0.15 },
    // uBeatPulse directly (COMPOSITE_FRAG) — a plain Beat default.
    drive: { default: "feature.onset" },
  },
];

export const card: SceneCard = {
  id: "physarum",
  name: "Physarum",
  settings: SETTINGS,
};

export const loadBody = (): Promise<Scene> => import("./physarum.ts").then((m) => m.physarumScene);
