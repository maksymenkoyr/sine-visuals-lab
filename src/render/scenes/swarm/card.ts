// Swarm's card: what every page needs before the scene's code loads (src/render/lazyScene.ts).
import type { Scene, SceneCard } from "../../scene.ts";
import type { SceneSetting } from "../../sceneSettings.ts";

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "development", added: "2026-10-03" } as const;

export const SETTINGS: SceneSetting[] = [
  // Form
  {
    key: "particles",
    label: "Particles",
    description: "How many particles are in the swarm — right is denser and heavier to draw; untouched, it follows the quality preset",
    group: "Form",
    min: 96,
    max: 480,
    step: 8,
    default: 256,
    masterScale: false,
  },
  {
    key: "sync",
    label: "Sync",
    description: "How strongly neighbours pull each other's phase — right locks more of the swarm into the white core, left leaves more drifters",
    group: "Form",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
  },
  {
    key: "drifters",
    label: "Drifters",
    description: "How different the particles' own rhythms are — right makes a thicker, busier rim of out-of-sync drifters",
    group: "Form",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
  },
  // Motion
  {
    key: "breath",
    label: "Breath",
    description: "How far the core swells and contracts — by default once every two beats, with the tempo",
    group: "Motion",
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 1,
    drive: { default: "scene", sceneLabel: "Scene: beat wave, every 2 beats", sceneSources: ["anim.beatWave"] },
  },
  {
    key: "scatter",
    label: "Scatter",
    description: "How many particles a hit knocks out of step — they fly out to the rim, then fall back into the core as they re-sync",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    // Bass hits, not every onset: real music fires onsets several times a
    // beat, and a share flung that often never lets the core re-form
    // (measured 2026-10-03: a uniform disc on a 129 bpm DJ track).
    drive: { default: "anim.lowOnset", hit: { reactionLabel: "scatter" } },
  },
  {
    key: "thump",
    label: "Thump",
    description: "How much the whole swarm swells on a hit, then settles back",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    drive: { default: "anim.lowOnset" },
  },
  {
    key: "heat",
    label: "Heat",
    description: "How much random jitter the phases get — right keeps more of the swarm restless and the core looser",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    drive: { default: "anim.energy" },
  },
  {
    key: "damping",
    label: "Damping",
    description: "How quickly the swarm's motion dies away — right settles the breathing, left lets it ring",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
  },
  {
    key: "collapse",
    label: "Re-collapse",
    description: "How readily a drop throws the swarm back out to a scattered net to collapse again, and how fast it falls in — 0 never re-scatters",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 1,
    drive: { default: "anim.dropOnset", hit: { flatOnly: "A re-collapse either starts or it doesn't, so it can't be sized.", reactionLabel: "re-collapse" } },
  },
  // Look
  {
    key: "lines",
    label: "Lines",
    description: "How bright the connecting lines are",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
  },
  {
    key: "flash",
    label: "Beat flash",
    description: "Brightness punch on each hit — the lines and dots flare, then fade",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    // Bass hits: on Any hit a DJ track fires several times a beat and the
    // flash blurs into flicker (measured 2026-10-03); on the kick it reads
    // as a pulse. Any hit stays a pick in the panel.
    drive: { default: "anim.lowOnset" },
  },
  {
    key: "reach",
    label: "Reach",
    description: "How far apart two particles can be and still draw a line — right weaves a denser net",
    group: "Look",
    min: 0.5,
    max: 1.5,
    step: 0.05,
    default: 1,
  },
  {
    key: "colours",
    label: "Colours",
    description: "How far the lines take on colour with their phase — 0 is all white, right adds the rose, orange and green of the drifters",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 1,
  },
  // Camera
  {
    key: "size",
    label: "Size",
    description: "How large the swarm is on screen",
    group: "Camera",
    min: 0.5,
    max: 1.6,
    step: 0.05,
    default: 1,
  },
];

export const card: SceneCard = {
  id: "swarm",
  name: "Entropic Collapse",
  settings: SETTINGS,
};

export const loadBody = (): Promise<Scene> => import("./index.ts").then((m) => m.swarmScene);
