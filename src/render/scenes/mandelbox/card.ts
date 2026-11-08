// Mandelbox Flight's card: what every page needs before the scene's code loads (src/render/lazyScene.ts).
import type { Scene, SceneCard } from "../../scene.ts";
import type { SceneSetting } from "../../sceneSettings.ts";

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "development", added: "2026-11-08" } as const;

export const SETTINGS: SceneSetting[] = [
  {
    key: "roundness",
    label: "Roundness",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.6,
    description: "How round the fractal's cells are: low builds boxes and straight walls, high builds arches and bubbles. A change flies on to a new place.",
  },
  {
    key: "mirror",
    label: "Mirror",
    group: "Form",
    type: "enum",
    options: ["Off", "On", "Per place"],
    min: 0,
    max: 2,
    step: 1,
    default: 2,
    description:
      "On flies only along the fractal's own mirror lines, so every view mirrors left to right and some form a kaleidoscope. Off never does. Per place mixes the two. A change flies on to a new place.",
  },
  {
    key: "speed",
    label: "Flight speed",
    group: "Motion",
    min: 0,
    max: 3,
    step: 0.05,
    default: 1,
    description: "How fast the camera flies in. At 1 it closes in about as fast as the video it was measured from.",
  },
  {
    key: "push",
    label: "Push",
    group: "Motion",
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 1,
    description: "How much the music's loudness sets the pace of the flight and the colours: loud stretches push in, quiet ones drift, silence holds still. At 0 they keep a steady pace.",
    drive: { default: "anim.energy" },
  },
  {
    key: "dissolve",
    label: "Dissolve",
    group: "Motion",
    min: 0.2,
    max: 4,
    step: 0.1,
    default: 1.5,
    description: "How many seconds a new place takes to fade in. A drop moves on to a new place, and so does a place the camera has flown deep into.",
    drive: {
      default: "anim.dropOnset",
      hit: { flatOnly: "A new place either comes or it doesn't, so it can't be sized.", reactionLabel: "new place" },
    },
  },
  {
    key: "rims",
    label: "Rims",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    description: "How brightly the edges of the fractal's cells shine white.",
  },
  {
    key: "flash",
    label: "Rim flash",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    description: "How hard the rims flash on each kick and clap.",
    drive: {
      default: {
        mix: "add",
        sources: [
          { choice: "anim.kickOnset", weight: 1 },
          { choice: "anim.clapOnset", weight: 1 },
        ],
      },
      hit: { readout: "sized", reactionLabel: "flash" },
    },
  },
  {
    key: "drift",
    label: "Colour drift",
    group: "Look",
    min: 0,
    max: 4,
    step: 0.05,
    default: 1,
    description: "How fast the colours turn round the colour wheel. At 1 they go round about every half-minute.",
  },
  {
    key: "hue",
    label: "Colour turn",
    group: "Look",
    min: -180,
    max: 180,
    step: 5,
    default: 0,
    description: "Turns every colour around the colour wheel.",
  },
  {
    key: "punch",
    label: "Punch",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.7,
    description: "How hard the colours and contrast are pushed: low is soft, high is crisp and saturated.",
  },
];

export const card: SceneCard = {
  id: "mandelbox",
  name: "Mandelbox Flight",
  settings: SETTINGS,
};

export const loadBody = (): Promise<Scene> => import("./index.ts").then((m) => m.mandelboxScene);
