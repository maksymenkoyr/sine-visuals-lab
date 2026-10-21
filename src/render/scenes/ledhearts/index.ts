/**
 * LED Hearts (draft): glowing magenta hearts on a wall of round LEDs, zooming
 * out from the centre forever and turning about their vertical axes. Near
 * hearts swell, soften to dim red and fade. glsl.ts draws the picture,
 * motion.ts owns the zoom layers and the envelopes.
 *
 * The look was measured from a silent one-hour VJ loop (the `/ref` bundle
 * `-TaRL--y9Xc`): its LED pitch, dot size, haze, heart sizes, colours and its
 * zoom rate. The loop has no audio, so every reaction here is this scene's
 * own: the level speeds the zoom and lifts the glow, a kick pushes the zoom,
 * a hit sets the hearts spinning, and a drop sends a wave of light outward.
 * docs/scenes/ledhearts.md has the record.
 */

import { createFullscreenScene } from "../../fullscreenScene.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import { FRAG } from "./glsl.ts";
import { decay, LAYERS, layerAt, wrapSpin } from "./motion.ts";

/** Zoom rate at Zoom speed 1, in log-scale per second: the reference zooms
 *  ×1.35–1.40 a second (0.30–0.335 measured two ways). */
const BASE_ZOOM = 0.32;
/** The spin clock's rate at Spin 1, radians per second; each heart turns at
 *  a whole multiple of motion.ts's SPIN_RATE_UNIT of it. */
const BASE_SPIN = 2;
/** Zoom rate a full kick adds, and how fast that push dies away. */
const PUSH_KICK = 0.7;
const PUSH_TAU_SEC = 0.22;
/** Spin rate a full hit adds, and how fast it dies away. */
const SPIN_KICK = 9;
const SPIN_TAU_SEC = 0.45;
/** Zoom rate a drop adds on top of its wave of light. */
const WAVE_PUSH = 1.2;
/** The drop wave's life; its age is clamped here so an idle wave stays dark. */
const WAVE_LIFE_SEC = 1.6;
/** The longest frame step that counts; a stalled tab's gap is clamped to this. */
const MAX_DT_SEC = 0.25;

const SETTINGS: SceneSetting[] = [
  {
    key: "hearts",
    label: "Hearts",
    group: "Form",
    min: 0.1,
    max: 1,
    step: 0.05,
    default: 0.3,
    description: "How many hearts fill the wall.",
  },
  {
    key: "zoom",
    label: "Zoom speed",
    group: "Motion",
    min: 0,
    max: 3,
    step: 0.05,
    default: 1,
    description: "How fast the hearts fly out from the centre when the music is quiet.",
  },
  {
    key: "rush",
    label: "Level rush",
    group: "Motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 0.6,
    description: "How much faster the hearts fly as the music gets louder.",
    drive: { default: "anim.energy" },
  },
  {
    key: "push",
    label: "Kick push",
    group: "Motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    description: "How far each kick throws the hearts outward.",
    drive: { default: "anim.lowOnset", hit: { reactionLabel: "push" } },
  },
  {
    key: "spin",
    label: "Spin",
    group: "Motion",
    min: 0,
    max: 3,
    step: 0.05,
    default: 1,
    description: "How fast the hearts turn on their own.",
  },
  {
    key: "flip",
    label: "Hit spin",
    group: "Motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    description: "How hard each hit sets the hearts spinning.",
    drive: { default: "anim.midOnset", hit: { reactionLabel: "spin" } },
  },
  {
    key: "wave",
    label: "Drop wave",
    group: "Motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    description: "How bright the wave of light is that runs out from the centre on a drop.",
    drive: { default: "anim.dropOnset", hit: { reactionLabel: "wave" } },
  },
  {
    key: "glow",
    label: "Level glow",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    description: "How much brighter the LEDs burn as the music gets louder.",
    drive: { default: "anim.energy" },
  },
  {
    key: "ledRows",
    label: "LED rows",
    group: "Look",
    min: 40,
    max: 200,
    step: 2,
    default: 108,
    description: "How many rows of LEDs fill the height. Fewer rows, bigger dots.",
  },
  {
    key: "haze",
    label: "Haze",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    description: "How much light spills between the LEDs and past each heart.",
  },
  {
    key: "hue",
    label: "Hue",
    group: "Look",
    min: -180,
    max: 180,
    step: 1,
    default: 0,
    description: "Turns every colour around the colour wheel. 0 is magenta.",
  },
];

// Per-session state, started over on each mount.
let zoomLog = 0;
let pushVel = 0;
let spinPhase = 0;
let spinVel = 0;
let waveAge = WAVE_LIFE_SEC;
let waveLvl = 0;

const layerScale = new Float32Array(LAYERS);
const layerSeed = new Float32Array(LAYERS);
const layerFade = new Float32Array(LAYERS);
const layerNear = new Float32Array(LAYERS);

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "draft", added: "2026-10-21" } as const;

export const ledheartsScene = createFullscreenScene("ledhearts", "LED Hearts", FRAG, {
  settings: SETTINGS,
  extraUniformDecls: [
    `uniform float uLayerScale[${LAYERS}];`,
    `uniform float uLayerSeed[${LAYERS}];`,
    `uniform float uLayerFade[${LAYERS}];`,
    `uniform float uLayerNear[${LAYERS}];`,
    "uniform float uSpinPhase;",
    "uniform float uWaveAge;",
    "uniform float uWaveLvl;",
  ].join("\n"),
  onInit: () => {
    zoomLog = 0;
    pushVel = 0;
    spinPhase = 0;
    spinVel = 0;
    waveAge = WAVE_LIFE_SEC;
    waveLvl = 0;
  },
  extraUniforms: (frame, anim, getSetting, drives) => {
    const dt = Math.min(Math.max(anim.dtSec, 0), MAX_DT_SEC);
    // Called every frame, unconditionally: fired() must see every frame.
    const kick = drives.fired("push", anim.lowOnset);
    const hit = drives.fired("flip", anim.midOnset);
    const drop = drives.fired("wave", anim.dropOnset);

    pushVel = decay(pushVel, dt, PUSH_TAU_SEC);
    if (kick) pushVel += PUSH_KICK * drives.hitSize("push") * getSetting("push");
    spinVel = decay(spinVel, dt, SPIN_TAU_SEC);
    if (hit) spinVel += SPIN_KICK * drives.hitSize("flip") * getSetting("flip");
    waveAge = Math.min(waveAge + dt, WAVE_LIFE_SEC);
    if (drop) {
      waveAge = 0;
      waveLvl = drives.hitSize("wave");
      pushVel += WAVE_PUSH * waveLvl * getSetting("wave");
    }

    const rush = getSetting("rush") * Math.max(0, drives.value("rush", frame.energy));
    zoomLog += dt * (BASE_ZOOM * getSetting("zoom") * (1 + rush) + pushVel);
    spinPhase = wrapSpin(spinPhase + dt * (BASE_SPIN * getSetting("spin") + spinVel));

    for (let k = 0; k < LAYERS; k++) {
      const l = layerAt(zoomLog, k);
      layerScale[k] = l.scale;
      layerSeed[k] = l.seed;
      layerFade[k] = l.fade;
      layerNear[k] = l.near;
    }
    return {
      uLayerScale: layerScale,
      uLayerSeed: layerSeed,
      uLayerFade: layerFade,
      uLayerNear: layerNear,
      uSpinPhase: spinPhase,
      uWaveAge: waveAge,
      uWaveLvl: waveLvl * (1 - waveAge / WAVE_LIFE_SEC),
    };
  },
});
