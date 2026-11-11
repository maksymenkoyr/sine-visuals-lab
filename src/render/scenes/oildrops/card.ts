// Oil Drops' card: what every page needs before the scene's code loads (src/render/lazyScene.ts).
import type { Scene, SceneCard } from "../../scene.ts";
import type { SceneSetting } from "../../sceneSettings.ts";

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "development", added: "2026-11-10" } as const;

/** The `paint` setting's options, in value order: which drop and paint
 *  colours the scene mixes (drops.ts's FAMILY_MIX picks the drop families
 *  per option). */
export const PAINTS: readonly string[] = ["Red on blue", "Candy on navy"];

// Every table below reproduces its plain `default` when all dials sit at
// NEUTRAL (musicProfile.ts) — nothing is hand-biased.
const SETTINGS: SceneSetting[] = [
  {
    key: "drops",
    label: "Drops",
    description: "How many drops float on the paint.",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { density: 0.25 },
  },
  {
    key: "size",
    label: "Size",
    description: "How big the drops run — the mix of tiny beads and wide pools keeps its shape.",
    group: "Form",
    min: 0.5,
    max: 2,
    step: 0.05,
    default: 1,
    auto: { density: -0.2 },
  },
  {
    key: "nested",
    label: "Inner drops",
    description: "How often a big drop carries a smaller drop inside it.",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    advanced: true,
  },
  {
    key: "pour",
    label: "Pour",
    description: "How many new drops a drop in the music pours onto the paint, pushing the others aside as they grow.",
    group: "Form",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    auto: { dynamics: 0.3 },
    drive: { default: "anim.dropOnset", hit: { reactionLabel: "pour" } },
  },
  {
    key: "drift",
    label: "Drift",
    description: "How fast the paint and its drops slide, turn and spread with no music.",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
    auto: { tempo: 0.2 },
  },
  {
    key: "rush",
    label: "Rush",
    description: "How much louder music speeds the drift up — a quiet room creeps, a loud one sweeps.",
    group: "Motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    auto: { loudness: 0.25, dynamics: 0.15 },
    drive: { default: "anim.energy" },
  },
  {
    key: "swirl",
    label: "Swirl",
    description: "How hard the bass stirs eddies into the drift, so neighbouring drops part and circle.",
    group: "Motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    auto: { pulse: 0.2, dynamics: 0.15 },
    drive: { default: "anim.low" },
  },
  {
    key: "shove",
    label: "Shove",
    description: "How far a kick jolts every drop — small beads jump, wide pools barely move.",
    group: "Motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    auto: { attack: 0.3 },
    drive: { default: "anim.kickOnset", hit: { reactionLabel: "shove" } },
  },
  {
    key: "paint",
    label: "Paint",
    description: "Red on blue is red, magenta and orange drops on blue glitter paint; Candy on navy is pink, orange, yellow and purple drops packed on dark blue.",
    group: "Look",
    type: "enum",
    options: PAINTS,
    min: 0,
    max: PAINTS.length - 1,
    step: 1,
    default: 0,
  },
  {
    key: "colors",
    label: "Colour",
    description: "Own keeps the paint's own colours; Room takes the room palette.",
    group: "Look",
    type: "enum",
    options: ["Own", "Room"],
    min: 0,
    max: 1,
    step: 1,
    default: 0,
  },
  {
    key: "glitter",
    label: "Glitter",
    description: "How brightly the flakes in the paint flash, and how much the treble sets them off.",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    auto: { brightness: 0.3 },
    drive: { default: "anim.high" },
  },
  {
    key: "gloss",
    label: "Gloss",
    description: "How strongly the light from the upper left shades each drop: its lit side, highlight and shadow.",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    auto: { brightness: 0.15 },
  },
];

export const card: SceneCard = {
  id: "oildrops",
  name: "Oil Drops",
  settings: SETTINGS,
};

export const loadBody = (): Promise<Scene> => import("./index.ts").then((m) => m.oilDropsScene);
