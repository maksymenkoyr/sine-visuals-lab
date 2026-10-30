// Ember's card: what every page needs before the scene's code loads (src/render/lazyScene.ts).
import type { Scene, SceneCard } from "../../scene.ts";
import type { SceneSetting } from "../../sceneSettings.ts";

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "development", added: "2026-10-21" } as const;

export const SETTINGS: SceneSetting[] = [
  {
    key: "level",
    label: "Fire height",
    group: "Form",
    min: 0.25,
    max: 0.95,
    step: 0.01,
    default: 0.62,
    description: "How far up the screen the fire climbs before it fades into the dark.",
  },
  {
    key: "rise",
    label: "Rise speed",
    group: "Motion",
    min: 0,
    max: 3,
    step: 0.05,
    default: 1,
    description: "How fast the fire moves. Louder music moves it a little faster.",
    drive: { default: "anim.energy" },
  },
  {
    key: "lift",
    label: "Kick lift",
    group: "Motion",
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 1,
    description: "How hard each kick throws the fire up.",
    drive: { default: "anim.kickOnset", hit: { reactionLabel: "lift" } },
  },
  {
    key: "churn",
    label: "Churn",
    group: "Motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    description: "How hard the fire curls over itself. Louder sections curl harder.",
    drive: { default: "anim.sectionIntensity" },
  },
  {
    key: "swellBars",
    label: "Swell length",
    group: "Motion",
    min: 1,
    max: 16,
    step: 1,
    default: 4,
    description: "How many bars the fire takes to swell up the screen and sink back.",
  },
  {
    key: "heat",
    label: "Heat",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    description: "How brightly the fire glows. Follows the bass.",
    drive: { default: "anim.low" },
  },
  {
    key: "ridge",
    label: "Rim glow",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    description: "How bright the edges of the fire burn where they meet the dark.",
  },
  {
    key: "glow",
    label: "Glow",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    description: "How far the fire's light bleeds out into the dark.",
  },
  {
    key: "roomColor",
    label: "Room colours",
    group: "Look",
    type: "boolean",
    min: 0,
    max: 1,
    step: 1,
    default: 0,
    description: "Off: the fire's own red. On: the room palette.",
  },
];

export const card: SceneCard = {
  id: "ember",
  name: "Ember",
  settings: SETTINGS,
};

export const loadBody = (): Promise<Scene> => import("./index.ts").then((m) => m.emberScene);
