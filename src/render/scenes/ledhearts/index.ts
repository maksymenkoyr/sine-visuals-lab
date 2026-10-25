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
import { card } from "./card.ts";
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

export const ledheartsScene = createFullscreenScene(card.id, card.name, FRAG, {
  settings: card.settings,
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
