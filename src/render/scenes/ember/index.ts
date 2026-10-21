/**
 * Ember (draft): red fire fronts rising out of black, each crest drawn as a
 * thin glowing line, the body below it swelling from bare crests to a full
 * red glow and back over a few bars. Kicks throw the fronts upward, the bass
 * heats the body, and louder sections make the fire curl harder.
 *
 * The look was measured from a silent ambient loop (the `/ref` bundle
 * `vg2cB1EeJpo`); nothing in it syncs to music, so every reaction here is
 * our own design. docs/scenes/ember.md has the record: the measurements, the
 * reactions we chose, and what is still to tune. motion.ts owns the swell
 * and the kick lift; glsl.ts draws the picture.
 */

import { createScaledPhase, type ScaledPhase } from "../../flowClock.ts";
import { wrapFlow } from "../../noiseHash.ts";
import { createFullscreenScene } from "../../fullscreenScene.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import { FRAG, MAX_LAYERS, WARP_SCALE } from "./glsl.ts";
import { advanceLift, createLiftState, swellAt, swellRate, type LiftState } from "./motion.ts";

/** Screen heights per second the fronts' texture climbs at Rise speed 1 —
 *  the reference's measured flow (docs/scenes/ember.md, Measurements). */
const RISE_PER_SEC = 0.04;
/** Extra climb, in screen heights per second, at a full kick lift. */
const LIFT_RISE_PER_SEC = 0.35;
/** How fast the crests change shape, in noise cells per second of climb. */
const MORPH_PER_RISE = 0.35;
/** The longest frame step that counts as motion; a stalled tab's gap is clamped to this. */
const MAX_DT_SEC = 0.25;

const SETTINGS: SceneSetting[] = [
  {
    key: "level",
    label: "Fire height",
    group: "Form",
    min: 0.25,
    max: 0.9,
    step: 0.01,
    default: 0.62,
    description: "Where the top of the fire sits, from the bottom of the screen.",
  },
  {
    key: "layers",
    label: "Layers",
    group: "Form",
    min: 1,
    max: MAX_LAYERS,
    step: 1,
    default: 3,
    description: "How many fronts are stacked: the deeper ones show as fainter crests inside the fire.",
  },
  {
    key: "tips",
    label: "Sharp tips",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
    description: "Rounded waves on the left, flames rising into sharp tips on the right.",
  },
  {
    key: "rise",
    label: "Rise speed",
    group: "Motion",
    min: 0,
    max: 3,
    step: 0.05,
    default: 1,
    description: "How fast the fire climbs. Louder music climbs a little faster.",
  },
  {
    key: "lift",
    label: "Kick lift",
    group: "Motion",
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 1,
    description: "How far each kick throws the fire up.",
    drive: { default: "anim.lowOnset", hit: { reactionLabel: "lift" } },
  },
  {
    key: "churn",
    label: "Churn",
    group: "Motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    description: "How hard the fire curls over itself. Louder sections curl harder.",
    drive: { default: "anim.sectionIntensity" },
  },
  {
    key: "swellBars",
    label: "Swell length",
    group: "Motion",
    min: 1,
    max: 16,
    step: 1,
    default: 4,
    description: "How many bars the fire takes to swell from bare crests to a full glow and back.",
  },
  {
    key: "heat",
    label: "Heat",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    description: "How brightly the body of the fire glows. Follows the bass.",
    drive: { default: "anim.low" },
  },
  {
    key: "ridge",
    label: "Crest glow",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    description: "How bright the thin line along each crest burns.",
  },
  {
    key: "roomColor",
    label: "Room colours",
    group: "Look",
    type: "boolean",
    min: 0,
    max: 1,
    step: 1,
    default: 0,
    description: "Off: the fire's own red. On: the room palette.",
  },
];

// Per-session state; onInit starts it over on each mount.
let lift: LiftState = createLiftState();
let rise: ScaledPhase = createScaledPhase();
let liftClimb = 0;
let swellPhase = 0;

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "draft", added: "2026-10-21" } as const;

export const emberScene = createFullscreenScene("ember", "Ember", FRAG, {
  settings: SETTINGS,
  extraUniformDecls: ["uniform float uLiftLvl;", "uniform float uSwell;", "uniform float uRisePh;", "uniform float uMorphPh;"].join("\n"),
  onInit: () => {
    lift = createLiftState();
    rise = createScaledPhase();
    liftClimb = 0;
    swellPhase = 0;
  },
  extraUniforms: (_frame, anim, getSetting, drives) => {
    // Called every frame, unconditionally: fired() must see every frame.
    const fired = drives.fired("lift", anim.lowOnset);
    const dt = Math.min(Math.max(anim.dtSec, 0), MAX_DT_SEC);
    const lvl = advanceLift(lift, dt, fired ? drives.hitSize("lift") * getSetting("lift") : 0);
    liftClimb += dt * lvl * LIFT_RISE_PER_SEC;
    swellPhase = (swellPhase + dt * swellRate(getSetting("swellBars"), anim.tempoBpm, anim.tempoLock)) % 1;
    const climb = rise.advance(anim.flowPhase, getSetting("rise")) * RISE_PER_SEC + liftClimb;
    return {
      uLiftLvl: lvl,
      uSwell: swellAt(swellPhase),
      uRisePh: wrapFlow(climb * WARP_SCALE),
      uMorphPh: wrapFlow(climb * WARP_SCALE * MORPH_PER_RISE),
    };
  },
});
