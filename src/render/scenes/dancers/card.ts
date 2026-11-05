// Dancers' card: what every page needs before the scene's code loads (src/render/lazyScene.ts).
import type { Scene, SceneCard } from "../../scene.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import type { BlendMode } from "./player.ts";

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "draft", added: "2026-08-30" } as const;

/** The `skin` setting's options, in value order; the first entry is the default.
 *  index.ts's SKIN_SHADERS holds each skin's shader at the same index, so a new
 *  skin goes in both. */
export const SKIN_NAMES: readonly string[] = ["Skeleton", "Stick"];

/** The `style` setting's options, in value order: a clip family to dance
 *  (clipFormat.ts's ClipMeta.family), or null for the whole library. */
export const STYLES: readonly { name: string; family: string | null }[] = [
  { name: "Mix", family: null },
  { name: "Street", family: "street" },
  { name: "Party", family: "party" },
  { name: "Swing", family: "swing" },
  { name: "Modern", family: "modern" },
];

/** The `renderer` setting's options, in value order — see fastRenderers.ts. */
export const RENDERERS: readonly string[] = ["Raymarch", "Capsules", "Flat"];
/** The `blend` setting's options, in value order — player.ts's BlendMode. */
export const BLENDS: readonly { name: string; mode: BlendMode }[] = [
  { name: "Crossfade", mode: "crossfade" },
  { name: "Inertial", mode: "inertial" },
];
export const SETTINGS: SceneSetting[] = [
  {
    key: "style",
    label: "Style",
    description: "Which family of moves to dance, or a mix of everything.",
    // Form, not Motion — picks a repertoire to dance from, the same kind of
    // categorical choice as Skin below, not a movement in itself.
    group: "Form",
    type: "enum",
    options: STYLES.map((s) => s.name),
    min: 0,
    max: STYLES.length - 1,
    step: 1,
    default: 0,
  },
  {
    key: "motion",
    label: "Move energy",
    description: "How much of each move comes through — all the way up is as it was captured.",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    auto: { pulse: 0.25, loudness: 0.2, dynamics: 0.15 },
  },
  {
    key: "groove",
    label: "Groove",
    description: "How eagerly the dancer reaches for the big moves as a track builds.",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { pulse: 0.3, attack: 0.15 },
  },
  {
    key: "blend",
    label: "Handover",
    description: "How one move hands over to the next: slide between them, or stop dead and settle into the new one.",
    group: "Motion",
    type: "enum",
    options: BLENDS.map((b) => b.name),
    min: 0,
    max: BLENDS.length - 1,
    step: 1,
    default: 0,
    advanced: true,
  },
  {
    key: "jaw",
    label: "Jaw chatter",
    description: "How far kicks open the jaw.",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    advanced: true,
    auto: { brightness: -0.25, attack: 0.2 },
    // clocks.kickPulse directly (choreo.ts's mulBoneEuler jaw term) — a
    // plain Kick default.
    drive: { default: "anim.kickOnset" },
  },
  {
    key: "skin",
    label: "Skin",
    description: "What the dancer is made of. Every skin dances the same moves.",
    group: "Look",
    type: "enum",
    options: SKIN_NAMES,
    min: 0,
    max: SKIN_NAMES.length - 1,
    step: 1,
    default: 0,
  },
  {
    key: "renderer",
    label: "Renderer",
    description:
      "Raymarch is the full look; Capsules and Flat draw the same dance for a fraction of the cost. Below the Mid quality preset, Raymarch hands over to Capsules.",
    // Look, not Post — it picks which draw path renders the figure, not a
    // filter applied to an already-drawn image.
    group: "Look",
    type: "enum",
    options: RENDERERS,
    min: 0,
    max: RENDERERS.length - 1,
    step: 1,
    default: 0,
  },
  {
    key: "fastMarch",
    label: "Fast march",
    description: "Trim the raymarcher: fewer steps, a looser surface, no ambient occlusion, coarser bone detail.",
    group: "Look",
    type: "boolean",
    min: 0,
    max: 1,
    step: 1,
    default: 0,
    advanced: true,
  },
  {
    key: "glow",
    label: "Rim glow",
    description: "Palette-coloured light catching the figure's edges.",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { brightness: 0.3 },
  },
  {
    key: "bob",
    label: "Camera bob",
    description: "How much the camera nudges in on each beat.",
    group: "Camera",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    auto: { attack: 0.3, pulse: 0.15, tempo: -0.2 },
    // Two different signals at two different sites — dolly/tilt read the
    // beat, roll reads the kick — so the default is Scene.
    drive: {
      default: "scene",
      sceneLabel: "Scene: beat (dolly/tilt) and kick (roll)",
      sceneSources: ["feature.onset", "anim.kickOnset"],
    },
  },
];

export const card: SceneCard = {
  id: "dancers",
  name: "Dancers",
  minQuality: "floor",
  settings: SETTINGS,
};

export const loadBody = (): Promise<Scene> => import("./index.ts").then((m) => m.dancersScene);
