// Portal's card: what every page needs before the scene's code loads (src/render/lazyScene.ts).
import type { Scene, SceneCard } from "../../scene.ts";
import type { SceneSetting } from "../../sceneSettings.ts";

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "draft", added: "2026-10-12" } as const;

const SETTINGS: SceneSetting[] = [
  {
    key: "turns",
    label: "Looks in turn",
    group: "Form",
    min: 0,
    max: 2,
    step: 1,
    default: 2,
    type: "enum",
    options: ["Flood", "Flood, blast", "Flood, blast, accent"],
    description: "How many different looks the kicks take turns between.",
  },
  {
    key: "kick",
    label: "Kick",
    group: "Motion",
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 1,
    description: "How hard each kick hits. Each kick goes to the next look in turn.",
    drive: { default: "anim.kickOnset", hit: { reactionLabel: "look" } },
  },
  {
    key: "speed",
    label: "Flight speed",
    group: "Motion",
    min: 0,
    max: 3,
    step: 0.05,
    default: 1,
    description: "How fast the camera flies down the tunnel.",
  },
  {
    key: "flood",
    label: "Flood",
    group: "Look",
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 1,
    description: "How much red light a flood throws down the tunnel.",
  },
  {
    key: "blast",
    label: "Blast",
    group: "Look",
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 1,
    description: "How hard a blast flares the ring and throws debris.",
  },
  {
    key: "accent",
    label: "Accent",
    group: "Look",
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 1,
    description: "How bright the green lights are that run along the walls.",
  },
  {
    key: "afterglow",
    label: "Afterglow",
    group: "Look",
    min: 0.3,
    max: 2.5,
    step: 0.05,
    default: 1,
    description: "How long each look takes to fade.",
  },
  {
    key: "ringGlow",
    label: "Ring glow",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    description: "How bright the ring burns.",
  },
  {
    key: "rest",
    label: "Rest light",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.15,
    description: "How much of the tunnel you see between kicks. Lower is darker, so kicks hit harder.",
  },
];

export const card: SceneCard = {
  id: "portal",
  name: "Portal",
  settings: SETTINGS,
};

export const loadBody = (): Promise<Scene> => import("./index.ts").then((m) => m.portalScene);
