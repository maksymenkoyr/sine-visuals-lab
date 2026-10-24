// Neon Gates's card: what every page needs before the scene's code loads (src/render/lazyScene.ts).
import type { Scene, SceneCard } from "../../scene.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import type { SignalLink } from "../../signals.ts";

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "draft", added: "2026-09-25" } as const;

/** What the Lightning on setting listens to — Shards' cutMode/cutSource
 *  pattern (src/render/scenes/shards/index.ts). "High"/"Bar" have no
 *  registered SignalId (beatListener.ts's SOURCE_SIGNAL), so arcSource's own
 *  `reads` below only covers Beat/Bass — no chip for the other two. */
export const ARC_SOURCE_NAMES = ["Beat", "Bass", "High", "Bar"] as const;
export const ARC_SOURCE = { BEAT: 0, BASS: 1, HIGH: 2, BAR: 3 } as const;

export const SETTINGS: SceneSetting[] = [
  {
    key: "symmetry",
    label: "Symmetry",
    description: "How many mirror copies of each gate the tunnel shows — across one axis, both axes, or both plus the diagonals",
    group: "Form",
    type: "enum",
    options: ["2", "4", "8"],
    min: 0,
    max: 2,
    step: 1,
    default: 1,
    // Framing the user picks to taste, like Kaleidoscope's Symmetry.
  },
  {
    key: "density",
    label: "Gate density",
    description: "How many gates are in the tunnel at once — a few big ones at the low end, a crowded corridor at the high end",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { density: 0.3 },
    glide: false,
  },
  {
    key: "shapeMix",
    label: "Shape mix",
    description: "Prisms and frames at the low end, rods and panels at the high end; the middle keeps each look's own mix",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
  },
  {
    key: "speed",
    label: "Speed",
    description: "How fast the camera flies through the tunnel; the bass pushes it further",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { tempo: 0.35, loudness: 0.15 },
  },
  {
    key: "cutRate",
    label: "Change rate",
    description: "How likely each bar is to start morphing into another look; every fourth bar and every drop start one regardless, unless a morph is already running",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { pulse: 0.3, dynamics: 0.2 },
    reads: ["anim.dropOnset"] satisfies readonly SignalLink[],
  },
  {
    key: "spin",
    label: "Spin",
    description: "How fast the tunnel turns, always the same way round",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
    auto: { tempo: 0.2 },
  },
  {
    key: "streaks",
    label: "Streaks",
    description: "How long the shutter stays open — the motion blur that smears the gates as they fly and turn",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { loudness: 0.25 },
  },
  {
    key: "glow",
    label: "Glow",
    description: "How bright the neon burns and how far its bloom spreads",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { brightness: 0.2, loudness: 0.2 },
  },
  {
    key: "beatFlash",
    label: "Beat flash",
    description: "Brightness punch on the nearest gates and the ground on each beat",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    // Same weights as caustics'/chladni's/powder's own Beat flash.
    auto: { attack: 0.3, pulse: 0.2, density: -0.15 },
    reads: ["feature.onset"] satisfies readonly SignalLink[],
  },
  {
    key: "buildGlow",
    label: "Build-up glow",
    description: "Extra bloom as a phrase builds toward its peak, on top of Glow's steady level",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    // fluid.ts's own buildGlow weights.
    auto: { dynamics: 0.2, loudness: 0.15 },
  },
  {
    key: "lightning",
    label: "Lightning",
    description: "On each beat a vivid current crackles through the gate lines, nearest gates first",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    // Same weights as Beat flash's own attack/pulse — both ride the beat.
    auto: { attack: 0.3, pulse: 0.2 },
    // What actually drives a strike is arcSource below (Shards' cutMode
    // pattern) — the chip here follows that choice rather than always
    // claiming the broadband beat.
    reads: [
      { signal: "feature.onset", activeWhen: (get) => get("arcSource") === ARC_SOURCE.BEAT },
      { signal: "anim.lowOnset", activeWhen: (get) => get("arcSource") === ARC_SOURCE.BASS },
    ] satisfies readonly SignalLink[],
  },
  {
    key: "arcSustain",
    label: "Lightning sustain",
    description: "How long the strike's current keeps glowing — a quick snap at the low end, lines that linger at the high end",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    // Sparser music (lower dynamics) sustains the strike longer.
    auto: { dynamics: -0.2 },
  },
  {
    key: "arcThickness",
    label: "Lightning thickness",
    description: "How wide the strike's zigzag reads against the tube it runs through — a thin thread at the low end, a thick rope at the high end",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
  },
  {
    key: "arcCrackle",
    label: "Lightning crackle",
    description: "How wild the strike's zigzag is — a clean pulse straight along the line at the low end, a wide, fast-flickering crackle at the high end",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
  },
  {
    key: "arcSpeed",
    label: "Lightning speed",
    description: "How fast the current runs along the gate lines — a crawl at the low end, a snap at the high end",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
    auto: { tempo: 0.3 },
  },
  {
    key: "arcSource",
    label: "Lightning on",
    description: "What triggers a strike: every beat, bass hits only, high-band hits only, or once a bar",
    group: "Look",
    type: "enum",
    options: [...ARC_SOURCE_NAMES],
    min: 0,
    max: ARC_SOURCE_NAMES.length - 1,
    step: 1,
    default: ARC_SOURCE.BEAT,
    reads: [
      { signal: "feature.onset", activeWhen: (get) => get("arcSource") === ARC_SOURCE.BEAT },
      { signal: "anim.lowOnset", activeWhen: (get) => get("arcSource") === ARC_SOURCE.BASS },
    ] satisfies readonly SignalLink[],
  },
];

export const card: SceneCard = {
  id: "gates",
  name: "Neon Gates",
  minQuality: "low",
  settings: SETTINGS,
};

export const loadBody = (): Promise<Scene> => import("./index.ts").then((m) => m.gatesScene);
