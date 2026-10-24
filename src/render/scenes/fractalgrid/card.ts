// Fractal Grid's card: what every page needs before the scene's code loads (src/render/lazyScene.ts).
import type { Scene, SceneCard } from "../../scene.ts";
import type { SceneSetting } from "../../sceneSettings.ts";

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "draft", added: "2026-10-05" } as const;

/** Iterations at uDetail = 1; the quality proxy scales it down. */
export const ITER_CAP = 1200;

/** The depth every target dives to at Dive depth's default, e-folds. */
export const TARGET_DEPTH = 45;

/** The deepest any dive may go, e-folds. Two limits meet here: the GPU's
 *  32-bit offsets from the reference reach their smallest normal value a
 *  little past this, and the double-double reference orbit has to stay a
 *  few thousand times finer than a pixel. */
export const MAX_DEPTH = 55;

export const SETTINGS: SceneSetting[] = [
  // Form
  {
    key: "density",
    label: "Grid lines",
    description: "How many grid lines cross each bulb — right packs them closer",
    group: "Form",
    min: 8,
    max: 80,
    step: 1,
    default: 32,
  },
  {
    key: "iterations",
    label: "Iterations",
    description:
      "How many times the formula repeats before the grid is drawn — left leaves the grids warped and half-formed, right settles them and sharpens the edges",
    group: "Form",
    min: 12,
    max: ITER_CAP,
    step: 1,
    default: 160,
  },
  // Motion
  {
    key: "step",
    label: "Step",
    description: "How far the grid lines jump on each hit, as a share of a cell",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.25,
    drive: { default: "anim.lowOnset", hit: { reactionLabel: "step" } },
  },
  {
    key: "fold",
    label: "Fold",
    description:
      "How far each tick moves every bulb's grid on to the next point of its cycle — 1 is one whole step, 0 turns folding off",
    group: "Motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    drive: { default: { source: "beat", grid: 4 }, hit: { reactionLabel: "fold" } },
  },
  // Look
  {
    key: "weight",
    label: "Line weight",
    description: "How thick the lines are, as a share of a cell",
    group: "Look",
    min: 0.04,
    max: 0.5,
    step: 0.01,
    default: 0.2,
    drive: { default: "feature.onset" },
  },
  {
    key: "invert",
    label: "Invert",
    description: "How far a drop swaps black and white, for a few bars — 0 never inverts",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 1,
    drive: { default: "anim.dropOnset", hit: { reactionLabel: "invert" } },
  },
  {
    key: "colours",
    label: "Colours",
    description: "How far black and white pull toward the app's colour palette",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
  },
  // Camera
  {
    key: "dive",
    label: "Dive speed",
    description: "How fast the camera zooms into a bulb and back out to the whole set",
    group: "Camera",
    min: 0,
    max: 3,
    step: 0.05,
    default: 1,
    drive: { default: "anim.low" },
  },
  {
    key: "depth",
    label: "Dive depth",
    description: "How far each dive zooms in before cutting back to the whole set — right goes deeper",
    group: "Camera",
    min: 0.25,
    max: Math.floor((MAX_DEPTH / TARGET_DEPTH) * 20) / 20,
    step: 0.05,
    default: 1,
  },
];

export const card: SceneCard = {
  id: "fractalgrid",
  name: "Fractal Grid",
  settings: SETTINGS,
};

export const loadBody = (): Promise<Scene> => import("./index.ts").then((m) => m.fractalGridScene);
