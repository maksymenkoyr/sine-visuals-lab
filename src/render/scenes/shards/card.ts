// Shards' card: what every page needs before the scene's code loads (src/render/lazyScene.ts).
import type { Scene, SceneCard } from "../../scene.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import type { SignalLink } from "../../signals.ts";
import { CUT_MODE, CUT_MODE_NAMES } from "./layout.ts";

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "development", added: "2026-09-12" } as const;

export const SETTINGS: SceneSetting[] = [
  {
    key: "density",
    label: "Density",
    description: "How many plates and spikes each arrangement gets",
    group: "Form",
    min: 0.3,
    max: 2,
    step: 0.05,
    default: 1,
    auto: { density: 0.3 },
    glide: false,
  },
  {
    key: "spread",
    label: "Spread",
    description: "How far the cluster reaches from its centre — tight knot low, scattered high",
    group: "Form",
    min: 0.4,
    max: 2,
    step: 0.05,
    default: 1,
  },
  {
    key: "blades",
    label: "Blades",
    description: "Share of thin spikes among the small pieces, against chunky fragments",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.55,
  },
  {
    key: "cutMode",
    label: "Cut on",
    description:
      "What triggers a hard cut to a new arrangement. Every beat and Bars both listen to the broadband beat (Bars cuts once a bar instead of every beat, once the tempo is locked); Kick cuts on each kick instead, for songs whose broadband beat is too busy",
    group: "Motion",
    type: "enum",
    options: CUT_MODE_NAMES,
    min: 0,
    max: CUT_MODE_NAMES.length - 1,
    step: 1,
    default: 0,
    reads: [
      { signal: "feature.onset", activeWhen: (get) => get("cutMode") !== CUT_MODE.BASS },
      { signal: "anim.kickOnset", activeWhen: (get) => get("cutMode") === CUT_MODE.BASS },
    ] satisfies readonly SignalLink[],
  },
  {
    key: "extend",
    label: "Extend",
    description: "How fast the plates grow along their own length between cuts — bass pushes it",
    group: "Motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    auto: { pulse: 0.25, loudness: 0.2 },
    // anim.low directly (advanceShards' growth rate, layout.ts) — a plain
    // Bass level default.
    drive: { default: "anim.low" },
  },
  {
    key: "spin",
    label: "Spin",
    description: "How fast the whole view rolls between cuts",
    group: "Motion",
    min: 0,
    max: 3,
    step: 0.05,
    default: 1,
    auto: { tempo: 0.2 },
  },
  {
    key: "recolour",
    label: "Recolour",
    description: "How often a beat swaps a big plate's colour instead of the whole arrangement",
    group: "Motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
  },
  {
    key: "rim",
    label: "Rim",
    description: "Width of the bright line along every edge, in pixels",
    group: "Look",
    min: 0,
    max: 4,
    step: 0.1,
    default: 2,
  },
  {
    key: "edge",
    label: "Thickness",
    description: "How thick the plates are — the dark extruded side you see on the big ones",
    group: "Look",
    min: 0.3,
    max: 2.5,
    step: 0.05,
    default: 1,
  },
  {
    key: "stars",
    label: "Stars",
    description: "How many stars in the ground behind the cluster",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
  },
  {
    key: "distance",
    label: "Distance",
    description: "How close the camera sits — the cluster fills the frame low, breathes high",
    group: "Camera",
    min: 0.6,
    max: 1.6,
    step: 0.05,
    default: 1,
  },
  {
    key: "dolly",
    label: "Dolly",
    description: "How much the camera drifts back between cuts, so each new arrangement lands close and then recedes",
    group: "Camera",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
  },
  {
    key: "bloom",
    label: "Bloom",
    description: "The soft halo around the bright plates and rims",
    group: "Post",
    min: 0,
    max: 2,
    step: 0.05,
    default: 0.8,
    auto: { brightness: 0.2 },
  },
];

export const card: SceneCard = {
  id: "shards",
  name: "Shards",
  settings: SETTINGS,
};

export const loadBody = (): Promise<Scene> => import("./index.ts").then((m) => m.shardsScene);
