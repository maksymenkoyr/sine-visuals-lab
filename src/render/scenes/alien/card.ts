// Alien's card: what every page needs before the scene's code loads (src/render/lazyScene.ts).
import type { PanelSection, Scene, SceneCard } from "../../scene.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import { STANDOUT_THRESHOLD_DEFAULT } from "../../standout.ts";

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "development", added: "2026-10-05" } as const;

/** Scales Level (Move's default wire) so a loud song reads about 1 — the
 *  dance at its captured speed with Move at its default. */
export const MOVE_GAIN = 2;

export const SETTINGS: SceneSetting[] = [
  {
    key: "move",
    label: "Move",
    description:
      "The music pays for every frame of the dance: the wired input node times this sets how fast the loop plays, " +
      "gliding rather than jumping. At 1 a loud song plays it as it was danced; silence buys no frames, so the alien holds still",
    group: "Motion",
    min: 0,
    max: 3,
    step: 0.05,
    default: 1,
    drive: { default: "feature.level", gain: MOVE_GAIN },
  },
  {
    key: "bounce",
    label: "Bounce",
    description: "How deep the alien squashes toward the floor and springs back each time the wired input node hits, on top of the dance",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    drive: { default: "anim.lowOnset" },
  },
  {
    key: "bounceSmooth",
    label: "Bounce smoothness",
    description:
      "How Bounce moves. Left: a quick snap down and a springy wobble back. Right: a slow ease down and a glide back to rest. " +
      "A single hit squashes as deep either way; on fast kicks a smooth bounce doesn't fully come back up between hits",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
  },
  {
    key: "cut",
    label: "Cut",
    description:
      "On: the loop repeats until the wired input node jumps out from its everyday ones, over the dotted line on its graph, " +
      "then cuts to another dance, each seen from its own angle (never twice within a couple of seconds). Off: the loop on screen repeats",
    group: "Camera",
    type: "boolean",
    min: 0,
    max: 1,
    step: 1,
    default: 1,
    drive: {
      default: "anim.dropOnset",
      // A cut has no size, so its Reaction row stays on Flat.
      hit: { ownDetector: true, flatOnly: "A cut either happens or it doesn't, so it can't be sized." },
      // Scene-handled: the same standout as Physarum 2's Dose threshold
      // (standout.ts's header has how one is wired).
      threshold: {
        default: STANDOUT_THRESHOLD_DEFAULT,
        label: "Cut threshold",
        hint: "Moves the dotted line: how far a sound has to stand out from the everyday ones to cut to another angle. Left: more cuts, even from quiet sounds. Right: only clear standouts.",
      },
    },
  },
];

/** The Motion group as one section: the Move row with a live readout under
 *  it (speed, frames bought per second, the loop's playhead), then Bounce
 *  and its smoothness. */
const PANEL: PanelSection[] = [{ widget: "alienPlay", title: "Motion", settings: ["move", "bounce", "bounceSmooth"] }];

export const card: SceneCard = {
  id: "alien",
  name: "Alien",
  settings: SETTINGS,
  panel: PANEL,
};

export const loadBody = (): Promise<Scene> => import("./index.ts").then((m) => m.alienScene);
