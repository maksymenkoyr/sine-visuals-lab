// Nebula's card: what every page needs before the scene's code loads (src/render/lazyScene.ts).
import type { Scene, SceneCard } from "../../scene.ts";
import type { SceneSetting } from "../../sceneSettings.ts";

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "development", added: "2026-10-21" } as const;

export const SETTINGS: SceneSetting[] = [
  {
    key: "gas",
    label: "Gas",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.5,
    description: "How much of the view is cloud. Lower leaves more open space.",
  },
  {
    key: "stars",
    label: "Stars",
    group: "Form",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    description: "How many stars shine between the clouds.",
  },
  {
    key: "speed",
    label: "Flight speed",
    group: "Motion",
    min: 0,
    max: 4,
    step: 0.05,
    default: 1,
    description: "How fast the camera flies through the cloud.",
  },
  {
    key: "spin",
    label: "Roll",
    group: "Motion",
    min: 0,
    max: 3,
    step: 0.05,
    default: 1,
    description: "How far the view rolls from side to side as it flies.",
  },
  {
    key: "surge",
    label: "Surge",
    group: "Motion",
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 1,
    description: "How much faster the flight runs as the music builds.",
    drive: { default: "anim.sectionIntensity" },
  },
  {
    key: "gasDrift",
    label: "Gas drift",
    group: "Motion",
    min: 0,
    max: 8,
    step: 0.1,
    default: 1,
    description: "How fast the clouds stream past and change shape on their own. 0 holds them still.",
  },
  {
    key: "glow",
    label: "Glow",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    description: "How bright the cloud glows. It glows brighter as the music gets louder.",
    drive: { default: "anim.energy" },
  },
  {
    key: "flare",
    label: "Flare",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    description: "How hard the cloud's edges flare white on each hit.",
    drive: { default: "anim.kickOnset" },
  },
  {
    key: "hue",
    label: "Colour turn",
    group: "Look",
    min: -180,
    max: 180,
    step: 5,
    default: 0,
    description: "Turns every colour around the colour wheel. 0 is violet and magenta.",
  },
  {
    key: "drift",
    label: "Colour drift",
    group: "Look",
    min: 0,
    max: 20,
    step: 0.5,
    default: 1,
    description: "How fast the colours wander around the colour wheel on their own. At 1 they take most of an hour.",
  },
];


export const card: SceneCard = {
  id: "nebula",
  name: "Nebula",
  settings: SETTINGS,
};

export const loadBody = (): Promise<Scene> => import("./index.ts").then((m) => m.nebulaScene);
