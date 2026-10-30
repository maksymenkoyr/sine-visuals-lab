// Alien's card: what every page needs before the scene's code loads (src/render/lazyScene.ts).
import type { PanelSection, Scene, SceneCard } from "../../scene.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import { STANDOUT_THRESHOLD_DEFAULT } from "../../standout.ts";
import { LOOPS, VIEWS } from "./reel.ts";

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
    drive: { default: "anim.kickOnset" },
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
    key: "dance",
    label: "Dance",
    description: "Any: each cut picks another dance. A dance: he keeps doing that one and Cut waits",
    group: "Motion",
    type: "enum",
    options: ["Any", ...LOOPS.map((l) => l.dance)],
    min: 0,
    max: LOOPS.length,
    step: 1,
    default: 0,
  },
  {
    key: "view",
    label: "View",
    description: "Own: each dance through the camera it was framed for. A view: every dance through that camera",
    group: "Camera",
    type: "enum",
    options: ["Own", ...VIEWS.map((v) => v.name)],
    min: 0,
    max: VIEWS.length,
    step: 1,
    default: 0,
  },
  // The camera by hand, on top of the view (camera.ts). Master Scale leaves
  // them alone: scaled, the camera would move whenever someone turned it.
  {
    key: "orbit",
    label: "Orbit",
    description: "Walks the camera round him from the view, in degrees: the ← → keys do the same. Left: the camera walks left. Right: it walks right",
    group: "Camera",
    min: -180,
    max: 180,
    step: 1,
    default: 0,
    masterScale: false,
  },
  {
    key: "tilt",
    label: "Tilt",
    description: "Swings the camera under or over him from the view, in degrees: the ↑ ↓ keys do the same. Left: from below. Right: from above",
    group: "Camera",
    min: -60,
    max: 60,
    step: 1,
    default: 0,
    masterScale: false,
  },
  {
    key: "distance",
    label: "Distance",
    description: "How far the camera stands from him, times the view's own: Shift with ↑ (closer) or ↓ (further) does the same. Left: closer. Right: further",
    group: "Camera",
    min: 0.3,
    max: 3,
    step: 0.01,
    default: 1,
    masterScale: false,
  },
  {
    key: "height",
    label: "Height",
    description: "Raises or lowers the camera and where it looks together, in metres, so the frame slides. Left: lower. Right: higher",
    group: "Camera",
    min: -1.5,
    max: 1.5,
    step: 0.01,
    default: 0,
    masterScale: false,
  },
  {
    key: "zoom",
    label: "Zoom",
    description: "The lens, times the view's own. Left: wider. Right: tighter",
    group: "Camera",
    min: 0.4,
    max: 2.5,
    step: 0.01,
    default: 1,
    masterScale: false,
  },
  {
    key: "cut",
    label: "Cut",
    description:
      "On: the loop repeats until the wired input node jumps out from its everyday ones, over the dotted line on its graph, " +
      "then cuts to another dance (never twice within a couple of seconds). Off, or while Dance holds one, the dance on screen repeats",
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
 *  it (speed, frames bought per second, the loop's playhead), then Bounce,
 *  its smoothness and Dance. */
const PANEL: PanelSection[] = [{ widget: "alienPlay", title: "Motion", settings: ["move", "bounce", "bounceSmooth", "dance"] }];

export const card: SceneCard = {
  id: "alien",
  name: "Alien",
  settings: SETTINGS,
  panel: PANEL,
  // One press: a few degrees round or over him, a twentieth of the way in.
  arrows: {
    leftRight: { setting: "orbit", by: 5 },
    upDown: { setting: "tilt", by: 3 },
    shiftUpDown: { setting: "distance", by: -0.05 },
  },
};

export const loadBody = (): Promise<Scene> => import("./index.ts").then((m) => m.alienScene);
