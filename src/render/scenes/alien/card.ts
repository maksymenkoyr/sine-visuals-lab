// Alien's card: what every page needs before the scene's code loads (src/render/lazyScene.ts).
import type { PanelSection, Scene, SceneCard } from "../../scene.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import {
  CUT_LINE_DEFAULT,
  DANCE_HOLD_SEC,
  DANCE_LONGEST_SEC,
  DANCE_SINK_DEFAULT,
  LOOPS,
  VIEW_HOLD_SEC,
  VIEW_LONGEST_SEC,
  VIEW_SINK_DEFAULT,
  VIEWS,
} from "./reel.ts";

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "development", added: "2026-10-05" } as const;

/** Scales Level (Move's default wire) so a loud song reads about 1: with
 *  Move at its default, every dance at the pace they all keep
 *  (reel.ts's DANCE_PACE_HZ). */
export const MOVE_GAIN = 2;

export const SETTINGS: SceneSetting[] = [
  {
    key: "move",
    label: "Move",
    description:
      "The music pays for every frame of the dance: the wired input node times this sets how fast the loop plays, " +
      "gliding rather than jumping. Every dance keeps the same pace, so a cut never makes him dance faster or slower. " +
      "At 1 a loud song plays that pace; silence buys no frames, so the alien holds still",
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
    description: "Any: each Dance cut picks another dance, and the outlined chip is the one on screen. A dance: he keeps doing that one and Dance cut waits",
    group: "Motion",
    type: "enum",
    options: ["Any", ...LOOPS.map((l) => l.dance)],
    min: 0,
    max: LOOPS.length,
    step: 1,
    default: 0,
    onScreen: true,
  },
  // Keeps the key "cut" from when it was the only cut, so saved looks and
  // wires keep it.
  {
    key: "cut",
    label: "Dance cut",
    description:
      "On: the dance repeats until the wired input node climbs up through the dotted line on its graph, once the dance has been on screen for the line's Shortest, " +
      "then cuts to another dance, seen through the camera it was framed for. It also cuts by itself at the line's Longest. " +
      "Shortest, Longest, Sink and On the beat sit under the line in the wire panel. Off, or while Dance holds one, the dance on screen repeats",
    group: "Motion",
    type: "boolean",
    min: 0,
    max: 1,
    step: 1,
    default: 1,
    drive: {
      default: "anim.dropLevel",
      // Scene-handled: the line is drawn on the graph and read by lineTrigger.ts, whose wait sits under it in the wire panel.
      threshold: {
        default: CUT_LINE_DEFAULT,
        label: "Dance cut line",
        hint: "Moves the dotted line the wired input node has to climb through to cut to another dance. Left: lower, so more cuts. Right: higher, so only big climbs cut. Off: no line, it cuts only at Longest. Shortest, Longest, Sink and On the beat sit right under it.",
      },
      trigger: { shortestSec: DANCE_HOLD_SEC, longestSec: DANCE_LONGEST_SEC, sink: DANCE_SINK_DEFAULT, onBeat: true, reactionLabel: "cut" },
    },
  },
  {
    key: "view",
    label: "View",
    description:
      "Any: each dance opens through the camera it was framed for and Camera cut moves it, and the outlined chip is the one on screen. " +
      "A view: every dance through that camera, and Camera cut waits",
    group: "Camera",
    type: "enum",
    // Saved looks store the chip by index, so Any stays first.
    options: ["Any", ...VIEWS.map((v) => v.name)],
    min: 0,
    max: VIEWS.length,
    step: 1,
    default: 0,
    onScreen: true,
  },
  {
    key: "cameraCut",
    label: "Camera cut",
    description:
      "On: the camera stays until the wired input node climbs up through the dotted line on its graph, once the view has been on screen for the line's Shortest, " +
      "then cuts to another view while the dance goes on. A dance cut starts that wait over. It also cuts by itself at the line's Longest. " +
      "Shortest, Longest, Sink and On the beat sit under the line in the wire panel. Off, or while View holds one, the camera stays",
    group: "Camera",
    type: "boolean",
    min: 0,
    max: 1,
    step: 1,
    default: 1,
    drive: {
      default: "anim.kickOnset",
      threshold: {
        default: CUT_LINE_DEFAULT,
        label: "Camera cut line",
        hint: "Moves the dotted line the wired input node has to climb through to cut to another view. Left: lower, so more cuts. Right: higher, so only big climbs cut. Off: no line, it cuts only at Longest. Shortest, Longest, Sink and On the beat sit right under it.",
      },
      trigger: { shortestSec: VIEW_HOLD_SEC, longestSec: VIEW_LONGEST_SEC, sink: VIEW_SINK_DEFAULT, onBeat: true, reactionLabel: "cut" },
    },
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
];

/** The Motion group as one section: the Move row with a live readout under
 *  it (speed, frames bought per second, the loop's playhead), then Bounce,
 *  its smoothness, Dance and the dance's cut. */
const PANEL: PanelSection[] = [
  { widget: "alienPlay", title: "Motion", settings: ["move", "bounce", "bounceSmooth", "dance", "cut"] },
];

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
