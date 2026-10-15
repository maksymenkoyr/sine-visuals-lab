/**
 * Portal (draft): a neon ring at the end of a dark tunnel of shards. The room
 * is near black between kicks, and the ring is the only steady light. Each
 * kick gets one of three different reactions in turn (flood, blast, accent,
 * then flood again) instead of the same reaction every time; rotation.ts
 * hands each kick to the next look, and glsl.ts draws the picture.
 *
 * The turn-taking was studied from the Vizibeat tutorial reel measured in the
 * `/ref` bundle `reel-1012` (a competitor's Unreal Engine demo). Nothing is
 * copied from it: the look, the shards, the timing constants and every
 * setting are an independent design, and only the idea of rotating the
 * reactions per kick comes from the study. docs/scenes/portal.md has the
 * record: the measurements, the decisions, and what is still to tune.
 *
 * The camera is local to this scene: it flies down the tunnel at a rate set
 * by the Flight speed setting, with the frame's own step clamped so a stalled
 * tab cannot fling it.
 */

import { createFullscreenScene } from "../../fullscreenScene.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import { FRAG } from "./glsl.ts";
import { advanceLooks, blastFlicker, createLookState, lookAge, lookLevel, type LookState } from "./rotation.ts";

/** Camera speed in tunnel units per second, before the Flight speed setting scales it. */
const BASE_FLIGHT = 0.35;
/** The longest frame step that counts as flight; a stalled tab's gap is clamped to this. */
const MAX_DT_SEC = 0.25;
/** A look's age is clamped to this before it reaches the shader, so an idle blast or accent stays at a fixed value. */
const MAX_LOOK_AGE_SEC = 10;
/** The kick seeds reach the shader modulo this, so the shader's trig never sees a large argument; the repeat is far past a viewer's notice. */
const SEED_WRAP = 1024;

const SETTINGS: SceneSetting[] = [
  {
    key: "turns",
    label: "Looks in turn",
    group: "Form",
    min: 0,
    max: 2,
    step: 1,
    default: 2,
    type: "enum",
    options: ["Flood", "Flood, blast", "Flood, blast, accent"],
    description: "How many different looks the kicks take turns between.",
  },
  {
    key: "kick",
    label: "Kick",
    group: "Motion",
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 1,
    description: "How hard each kick hits. Each kick goes to the next look in turn.",
    drive: { default: "anim.lowOnset", hit: { reactionLabel: "look" } },
  },
  {
    key: "speed",
    label: "Flight speed",
    group: "Motion",
    min: 0,
    max: 3,
    step: 0.05,
    default: 1,
    description: "How fast the camera flies down the tunnel.",
  },
  {
    key: "flood",
    label: "Flood",
    group: "Look",
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 1,
    description: "How much red light a flood throws down the tunnel.",
  },
  {
    key: "blast",
    label: "Blast",
    group: "Look",
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 1,
    description: "How hard a blast flares the ring and throws debris.",
  },
  {
    key: "accent",
    label: "Accent",
    group: "Look",
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 1,
    description: "How bright the green lights are that run along the walls.",
  },
  {
    key: "afterglow",
    label: "Afterglow",
    group: "Look",
    min: 0.3,
    max: 2.5,
    step: 0.05,
    default: 1,
    description: "How long each look takes to fade.",
  },
  {
    key: "ringGlow",
    label: "Ring glow",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    description: "How bright the ring burns.",
  },
  {
    key: "rest",
    label: "Rest light",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.15,
    description: "How much of the tunnel you see between kicks. Lower is darker, so kicks hit harder.",
  },
];

// Per-session state: the kick counter that hands out the looks, and the
// camera's distance down the tunnel. onInit starts both over on each mount.
let looks: LookState = createLookState();
let flightZ = 0;

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "draft", added: "2026-10-12" } as const;

export const portalScene = createFullscreenScene("portal", "Portal", FRAG, {
  settings: SETTINGS,
  extraUniformDecls: [
    "uniform float uFloodLvl;",
    "uniform float uBlastLvl;",
    "uniform float uAccentLvl;",
    "uniform float uBlastAge;",
    "uniform float uAccentAge;",
    "uniform float uBlastSeed;",
    "uniform float uAccentSeed;",
    "uniform float uTunnelZ;",
  ].join("\n"),
  onInit: () => {
    looks = createLookState();
    flightZ = 0;
  },
  extraUniforms: (_frame, anim, getSetting, drives) => {
    // Called every frame, unconditionally: fired() must see every frame.
    const fired = drives.fired("kick", anim.lowOnset);
    const size = fired ? drives.hitSize("kick") * getSetting("kick") : 0;
    const t = anim.timeSec;
    advanceLooks(looks, fired, size, t, getSetting("turns") + 1);
    flightZ += Math.min(Math.max(anim.dtSec, 0), MAX_DT_SEC) * BASE_FLIGHT * getSetting("speed");

    const afterglow = getSetting("afterglow");
    const blastAge = lookAge(looks, "blast", t);
    const accentAge = lookAge(looks, "accent", t);
    return {
      uFloodLvl: lookLevel(looks, "flood", t, afterglow),
      uBlastLvl: lookLevel(looks, "blast", t, afterglow) * blastFlicker(blastAge),
      uAccentLvl: lookLevel(looks, "accent", t, afterglow),
      uBlastAge: Math.min(blastAge, MAX_LOOK_AGE_SEC),
      uAccentAge: Math.min(accentAge, MAX_LOOK_AGE_SEC),
      uBlastSeed: looks.seed.blast % SEED_WRAP,
      uAccentSeed: looks.seed.accent % SEED_WRAP,
      uTunnelZ: flightZ,
    };
  },
});
