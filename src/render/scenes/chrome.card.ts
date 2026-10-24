// Liquid Chrome's card: what every page needs before the scene's code loads (src/render/lazyScene.ts).
import type { Scene, SceneCard } from "../scene.ts";
import type { SceneSetting } from "../sceneSettings.ts";

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "draft", added: "2026-10-21" } as const;

const SETTINGS: SceneSetting[] = [
  {
    key: "lines",
    label: "Lines",
    description: "How many contour bands the surface is cut into — fewer gives broad glossy ribbons, more gives fine grooves.",
    group: "Form",
    min: 3,
    max: 24,
    step: 0.5,
    default: 12,
    auto: { density: 0.3, brightness: 0.15 },
  },
  {
    key: "zoom",
    label: "Size",
    description: "How much of the surface fits on screen — further right shows more, smaller eddies.",
    group: "Form",
    min: 0.4,
    max: 2.5,
    step: 0.05,
    default: 1,
  },
  {
    key: "flow",
    label: "Flow",
    description: "How fast the liquid boils and the bands stream in and out of the eddies.",
    group: "Motion",
    min: 0,
    max: 3,
    step: 0.05,
    default: 1,
    auto: { tempo: 0.3, pulse: 0.15 },
  },
  {
    key: "rush",
    label: "Rush",
    description: "How much louder music speeds the flow up.",
    group: "Motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 0.8,
    auto: { loudness: 0.25, dynamics: 0.15 },
    drive: { default: "anim.energy" },
  },
  {
    key: "swirl",
    label: "Swirl",
    description: "How much the bass twists the bands into deeper eddies.",
    group: "Motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 0.6,
    auto: { pulse: 0.25, dynamics: 0.15 },
    drive: { default: "anim.low" },
  },
  {
    key: "gloss",
    label: "Gloss",
    description: "How bright the glints on the bands' flanks are.",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    auto: { brightness: 0.2 },
  },
  {
    key: "shine",
    label: "Shine",
    description: "How hard a hit flashes the glints.",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 0.8,
    auto: { attack: 0.3, pulse: 0.15 },
    drive: { default: "feature.onset", hit: { reactionLabel: "shine" } },
  },
  {
    key: "colors",
    label: "Colour",
    description: "Liquid keeps the green-and-cyan chrome; Room takes the room palette.",
    group: "Look",
    min: 0,
    max: 1,
    step: 1,
    default: 0,
    type: "enum",
    // A taste pick, so no auto table and no drive.
    options: ["Liquid", "Room"],
  },
];

export const card: SceneCard = {
  id: "chrome",
  name: "Liquid Chrome",
  settings: SETTINGS,
};

export const loadBody = (): Promise<Scene> => import("./chrome.ts").then((m) => m.chromeScene);
