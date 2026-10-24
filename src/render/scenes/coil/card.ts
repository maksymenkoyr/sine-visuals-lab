// Coil's card: what every page needs before the scene's code loads (src/render/lazyScene.ts).
import type { Scene, SceneCard } from "../../scene.ts";
import type { SceneSetting } from "../../sceneSettings.ts";

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "development", added: "2026-10-02" } as const;

export const SETTINGS: SceneSetting[] = [
  // Form
  {
    key: "twist",
    label: "Twist",
    description: "How much each nested copy winds relative to the next — 0 leaves plain nested outlines, right winds them into a spiral",
    group: "Form",
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 1,
  },
  {
    key: "stripes",
    label: "Stripes",
    description: "Band density — right packs more red/white/blue rings into the same span",
    group: "Form",
    min: 0.4,
    max: 2.5,
    step: 0.05,
    default: 1,
  },
  // Motion
  {
    key: "flow",
    label: "Flow",
    description: "How fast the bands stream outward from the centre, like toothpaste being squeezed",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    drive: { default: "anim.low" },
  },
  {
    key: "push",
    label: "Push",
    description: "How far a hit shoves the flow forward in one jump, on top of the steady stream",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    drive: { default: "feature.onset", hit: { reactionLabel: "push" } },
  },
  {
    key: "breathe",
    label: "Breathe",
    description: "How far the coil falls back before regrowing on the edge below — 0 leaves it growing without a fall-back",
    group: "Motion",
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 1,
    drive: { default: { source: "beat", grid: 5 }, hit: { reactionLabel: "breathe" } },
  },
  {
    key: "newShape",
    label: "New shape",
    description: "Resets to a small fresh silhouette every few grid ticks, peeling and spinning down over under a second — right resets more often, 0 turns resets off",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.8,
    drive: { default: { source: "beat", grid: 5 }, hit: { flatOnly: "A new shape either starts or it doesn't, so it can't be sized.", reactionLabel: "new shape" } },
  },
  // Look
  {
    key: "colours",
    label: "Colours",
    description: "How far the bands pull toward the app's own colour palette instead of the measured toothpaste red/white/blue",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
  },
  // Camera
  {
    key: "spin",
    label: "Spin",
    description: "How fast the whole picture rotates",
    group: "Camera",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    drive: { default: "anim.high" },
  },
];

export const card: SceneCard = {
  id: "coil",
  name: "Coil",
  settings: SETTINGS,
};

export const loadBody = (): Promise<Scene> => import("./index.ts").then((m) => m.coilScene);
