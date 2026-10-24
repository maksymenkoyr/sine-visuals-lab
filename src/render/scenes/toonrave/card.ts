// Toon Rave's card: what every page needs before the scene's code loads (src/render/lazyScene.ts).
import type { PanelSection, Scene, SceneCard } from "../../scene.ts";
import type { SceneSetting } from "../../sceneSettings.ts";

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "draft", added: "2026-10-03" } as const;

/** The most energy there is (the speed steps sit below it). */
export const MAX_ENERGY = 1.5;

/** Clock on signal's default mark: the clock runs while its signal reads above
 *  this (the threshold line under its graph, which the viewer can move). On
 *  Level, the default wire, a quiet room's hiss reads about 0 and music well
 *  above this. */
const CLOCK_RUN_MARK = 0.1;

export const SETTINGS: SceneSetting[] = [
  // Motion
  {
    key: "dance",
    label: "Dance",
    description:
      "The cast dances a move learned from this input node: it finds the beat, folds one bar of it over itself and " +
      "dances that loop. Off: the groove's own choreography on the BPM",
    group: "Motion",
    type: "boolean",
    min: 0,
    max: 1,
    step: 1,
    default: 1,
    drive: {
      default: "anim.lowOnset",
      hit: { flatOnly: "The dance only uses when each hit lands, not how big it was, so it can't be sized.", reactionLabel: "beat" },
    },
  },
  {
    key: "energy",
    label: "Energy",
    description: "Where energy settles when the input node is quiet. Energy is how fast they go through the move; 0 = they end up standing still",
    group: "Motion",
    family: "Energy",
    min: 0,
    max: MAX_ENERGY,
    step: 0.05,
    default: 0,
  },
  {
    key: "energyBoost",
    label: "Energy boost",
    description: "Lifts energy while the input node is high",
    group: "Motion",
    family: "Energy",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    drive: { default: "feature.level" },
  },
  {
    key: "energyPump",
    label: "Energy pump",
    description: "Each hit kicks energy up",
    group: "Motion",
    family: "Energy",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    drive: { default: "anim.lowOnset", hit: { reactionLabel: "pump" } },
  },
  {
    key: "energyDrop",
    label: "Energy drop",
    description: "How fast energy drains back. It drains slower the lower it gets",
    group: "Motion",
    family: "Energy",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
  },
  {
    key: "drops",
    label: "Drops",
    description: "How often the big drop comes round: the hero button slam, then the gags, the groove and the build back up",
    group: "Motion",
    type: "enum",
    options: ["Every 32 bars", "Every 16 bars", "Every 8 bars"],
    min: 0,
    max: 2,
    step: 1,
    default: 1,
  },
  {
    key: "dropHits",
    label: "Drop on big hits",
    description: "A big drop in the music's loudness starts the next drop early, once at least eight bars have passed since the last",
    group: "Motion",
    type: "boolean",
    min: 0,
    max: 1,
    step: 1,
    default: 1,
    drive: {
      default: "anim.dropOnset",
      hit: { flatOnly: "A drop either starts or it doesn't, so it can't be sized.", reactionLabel: "drop" },
    },
  },
  {
    key: "clock",
    label: "Clock on input node",
    description:
      "On: the scene's clock (drops, cuts, lights, the cast's script) runs only while the wired input node is above the line " +
      "under its graph, and stops in silence. Off: it always runs on the BPM",
    group: "Motion",
    type: "boolean",
    min: 0,
    max: 1,
    step: 1,
    default: 1,
    drive: {
      default: "feature.level",
      threshold: {
        default: CLOCK_RUN_MARK,
        label: "Runs above",
        hint: "The clock runs while the input node is above this line and stops below it",
      },
    },
  },
  // Look
  {
    key: "lights",
    label: "Lights",
    description: "How bright the lasers, lamps and rays are",
    group: "Look",
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 1,
    drive: { default: "anim.high" },
  },
  // Camera
  {
    key: "cuts",
    label: "Cuts",
    description: "How often the camera cuts to a close shot in the groove; 0 holds the wide shot",
    group: "Camera",
    min: 0,
    max: 3,
    step: 1,
    default: 2,
  },
  {
    key: "shake",
    label: "Shake",
    description: "How hard the camera shakes on the drop",
    group: "Camera",
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 1,
  },
  // Post
  {
    key: "flash",
    label: "Impact flash",
    description: "The two-colour flash frame on the drop",
    group: "Post",
    type: "boolean",
    min: 0,
    max: 1,
    step: 1,
    default: 1,
  },
];

/** The Dance card: the Dance row, the learned move and the Energy rows, in one group
 *  (src/ui/widgets/danceMove.ts). */
const PANEL: readonly PanelSection[] = [
  { widget: "danceMove", title: "Dance", settings: ["dance", "energy", "energyBoost", "energyPump", "energyDrop"] },
];

export const card: SceneCard = {
  id: "toonrave",
  name: "Toon Rave",
  settings: SETTINGS,
  panel: PANEL,
};

export const loadBody = (): Promise<Scene> => import("./index.ts").then((m) => m.toonraveScene);
