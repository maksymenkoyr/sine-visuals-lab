/**
 * Nebula (draft): a slow flight through a glowing violet gas cloud, with
 * hot white-blue rims on the gas's edges, a red fringe outside them, and
 * sparse stars. flight.ts moves the camera, glsl.ts draws the picture.
 *
 * The look and the motion were measured from a silent Blender screensaver
 * (the `/ref` bundle `violet-filament`); nothing in it reacts to sound, so
 * every reaction here is this scene's own design: the cloud glows brighter
 * with the music's loudness (Glow), its rims flare on hits (Flare), and the
 * flight speeds up and turns faster as a section builds (Surge).
 * docs/scenes/nebula.md has the record: the measurements, the decisions,
 * and what is still to tune.
 */

import { createFullscreenScene } from "../../fullscreenScene.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import { advanceFlight, createFlight, layerUniforms, LAYERS, type Flight } from "./flight.ts";
import { FRAG } from "./glsl.ts";

/** Planes per second at Flight speed 1: one plane lives LAYERS / this seconds, slow like the reference's drift. */
const BASE_FLIGHT = LAYERS / 45;
/** The view's turn at Turn 1, in radians per second; negative is clockwise, as measured (docs/scenes/nebula.md). */
const BASE_TURN = (-1.2 * Math.PI) / 180;
/** How fast the gas churns on its own, in radians per second of its churn clock. */
const CHURN_RATE = 0.06;
/** How much faster the flight and the turn run at full drive at Surge 1. */
const SURGE_GAIN = 2.5;
/** The longest frame step that counts as flight; a stalled tab's gap is clamped to this. */
const MAX_DT_SEC = 0.25;

const SETTINGS: SceneSetting[] = [
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
    description: "How fast the camera flies into the cloud.",
  },
  {
    key: "spin",
    label: "Turn",
    group: "Motion",
    min: 0,
    max: 4,
    step: 0.05,
    default: 1,
    description: "How fast the view turns, clockwise.",
  },
  {
    key: "surge",
    label: "Surge",
    group: "Motion",
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 1,
    description: "How much faster the flight and the turn run as the music builds.",
    drive: { default: "anim.sectionIntensity" },
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
    description: "How hard the cloud's edges flare on each hit.",
    drive: { default: "anim.lowOnset" },
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
];

// Per-session state: onInit starts the flight over on each mount.
let flight: Flight = createFlight();
const layers = new Float32Array(LAYERS * 4);

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "draft", added: "2026-10-21" } as const;

export const nebulaScene = createFullscreenScene("nebula", "Nebula", FRAG, {
  settings: SETTINGS,
  extraUniformDecls: [`uniform vec4 uLayer[${LAYERS}];`, "uniform float uTurn;", "uniform float uChurn;"].join("\n"),
  onInit: () => {
    flight = createFlight();
  },
  extraUniforms: (_frame, anim, getSetting, drives) => {
    const dt = Math.min(Math.max(anim.dtSec, 0), MAX_DT_SEC);
    const surge = 1 + SURGE_GAIN * getSetting("surge") * drives.value("surge", anim.sectionIntensity);
    advanceFlight(flight, dt, BASE_FLIGHT * getSetting("speed") * surge, BASE_TURN * getSetting("spin") * surge, CHURN_RATE);
    return {
      uLayer: { vec4: layerUniforms(flight, layers) },
      uTurn: flight.turn,
      uChurn: flight.churn,
    };
  },
});
