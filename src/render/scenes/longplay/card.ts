// Long Play's card: what every page needs before the scene's code loads (src/render/lazyScene.ts).
import type { Scene, SceneCard } from "../../scene.ts";
import type { SceneSetting } from "../../sceneSettings.ts";

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "development", added: "2026-10-03" } as const;

/** The views, in tour order. A view's name is its chip in the View row. */
export const VIEW_CHIPS: readonly { name: string; pro?: boolean }[] = [
  { name: "Tunnel" },
  { name: "Reactor" },
  { name: "Ocean" },
  { name: "Bloom", pro: true },
  { name: "Wings", pro: true },
  { name: "Circuit", pro: true },
  { name: "Chip", pro: true },
];

export const LONGPLAY_SETTINGS: SceneSetting[] = [
  // Form
  {
    key: "view",
    label: "View",
    description: "Which look is on screen — picking one mixes to it over two bars",
    group: "Form",
    type: "enum",
    options: VIEW_CHIPS.map((v) => v.name),
    proOptions: VIEW_CHIPS.filter((v) => v.pro).map((v) => v.name),
    min: 0,
    max: VIEW_CHIPS.length - 1,
    step: 1,
    default: 0,
  },
  {
    key: "auto",
    label: "Auto change",
    description: "Moves on to the next view by itself after Hold, mixing in on a phrase start",
    group: "Form",
    type: "boolean",
    min: 0,
    max: 1,
    step: 1,
    default: 1,
  },
  {
    key: "hold",
    label: "Hold",
    description: "Minutes a view stays before Auto change mixes to the next — right holds longer",
    group: "Form",
    min: 0.5,
    max: 10,
    step: 0.5,
    default: 3,
  },
  // Motion
  {
    key: "speed",
    label: "Speed",
    description: "How fast every view drifts, flies and grows",
    group: "Motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
  },
  {
    key: "launch",
    label: "Launch",
    description: "How bright the square or ring a hit sends out from the centre is — 0 sends none",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.8,
    drive: { default: "feature.onset", hit: { reactionLabel: "launch" } },
  },
  // Look
  {
    key: "flash",
    label: "Flash",
    description: "How much a hit brightens the picture (the calm views take less of it)",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    drive: { default: "feature.onset" },
  },
  {
    key: "glow",
    label: "Glow",
    description: "How far the neon halo spreads around each stroke",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
  },
  {
    key: "lift",
    label: "Lift",
    description: "How much the sound brightens the lines, on the views that react to it (Circuit's edges)",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    drive: { default: "anim.high" },
  },
  // Post
  {
    key: "flicker",
    label: "Flicker",
    description: "How much of the picture blinks off for a few frames at a time — the reference's glitch, on its own timer",
    group: "Post",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
  },
];

export const card: SceneCard = {
  id: "longplay",
  name: "Long Play",
  settings: LONGPLAY_SETTINGS,
};

export const loadBody = (): Promise<Scene> => import("./index.ts").then((m) => m.longPlayScene);
