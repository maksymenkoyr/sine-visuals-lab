// Tangle's card: what every page needs before the scene's code loads (src/render/lazyScene.ts).
import type { Scene, SceneCard } from "../../scene.ts";
import type { SceneSetting } from "../../sceneSettings.ts";

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "development", added: "2026-10-05" } as const;

export const SETTINGS: SceneSetting[] = [
  // Form
  {
    key: "detail",
    label: "Detail",
    description: "How many cells the noise has round the sphere — left folds it into a few long lines, right into many short ones",
    group: "Form",
    min: 2,
    max: 12,
    step: 1,
    default: 14,
    masterScale: false,
  },
  {
    key: "pull",
    label: "Pull",
    description: "How hard the noise drags the sphere into lines — left lingers as a crinkled sphere, right snaps straight",
    group: "Form",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
  },
  {
    key: "wiggle",
    label: "Wiggle",
    description: "How much fine zigzag a drop or a hit crinkles the lines into before they settle — left keeps smooth arcs",
    group: "Form",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
  },
  // Motion
  {
    key: "inflate",
    label: "Re-inflate",
    description: "How far a hit pulls the lines back out toward the sphere before they fold up again",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.15,
    // Bass hits, not every onset: a DJ track fires onsets several times a
    // beat, and the lines would never get to fold (swarm measured the same).
    drive: { default: "anim.lowOnset", hit: { reactionLabel: "inflate" } },
  },
  {
    key: "reset",
    label: "Reset on drop",
    description: "How much of the sphere a drop brings back — 1 starts over from the whole sphere, 0 ignores drops",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 1,
    drive: { default: "anim.dropOnset", hit: { reactionLabel: "reset" } },
  },
  {
    key: "drift",
    label: "Drift",
    description: "How fast the noise moves, sliding the lines into new shapes — by default faster when the mids are loud",
    group: "Motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    drive: { default: "anim.mid" },
  },
  // Look
  {
    key: "lines",
    label: "Lines",
    description: "How bright the lines are",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
  },
  {
    key: "glow",
    label: "Glow",
    description: "How far light spreads round the lines and the bright knots",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
  },
  {
    key: "fringe",
    label: "Colour fringe",
    description: "How far red, green and blue lag behind each other on whatever moves — 0 is pure white",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
  },
  // Camera
  {
    key: "spin",
    label: "Spin",
    description: "How fast the camera circles the tangle — left of the middle turns the other way",
    group: "Camera",
    min: -1,
    max: 1,
    step: 0.05,
    default: 0.25,
  },
  {
    key: "size",
    label: "Size",
    description: "How large the sphere is on screen",
    group: "Camera",
    min: 0.5,
    max: 1.6,
    step: 0.05,
    default: 1,
  },
];

export const card: SceneCard = {
  id: "tangle",
  name: "Tangle",
  settings: SETTINGS,
};

export const loadBody = (): Promise<Scene> => import("./index.ts").then((m) => m.tangleScene);
