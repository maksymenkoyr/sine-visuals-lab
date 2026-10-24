// Moiré's card: what every page needs before the scene's code loads (src/render/lazyScene.ts).
import type { Scene, SceneCard } from "../scene.ts";
import type { SceneSetting } from "../sceneSettings.ts";

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "draft", added: "2026-09-18" } as const;

const SETTINGS: SceneSetting[] = [
  {
    key: "lines",
    label: "Lines",
    description: "How many grating lines fit down the frame's height",
    group: "Form",
    min: 40,
    max: 180,
    step: 1,
    default: 90,
    // A busy mix reads better with a finer grid — no single line dominates.
    auto: { density: 0.2 },
  },
  {
    key: "scale",
    label: "Cloud detail",
    description: "How many, and how small, the dark clouds read against the frame",
    group: "Form",
    min: 0.4,
    max: 3,
    step: 0.05,
    default: 1,
    // Dense, busy music reads better with several small clouds than one dominant one.
    // (uScale multiplies the noise frequency, so higher = smaller clouds.)
    auto: { density: 0.2 },
  },
  {
    key: "depth",
    label: "Warp depth",
    description: "How far the second grating displaces from the first, in periods",
    group: "Form",
    min: 0,
    max: 6,
    step: 0.05,
    // Several periods, not one: the phase has to wrap across a cloud for
    // broad anti-phase (dark) regions to form — at about one period the dark
    // state is only reached along thin contours and the picture stays pale.
    default: 2.6,
    // Loud, dynamic passages warrant deeper, more contrasty clouds.
    auto: { loudness: 0.3, dynamics: 0.2 },
  },
  {
    key: "stretch",
    label: "Streak",
    description: "Ceiling on how far the wandering field can elongate into a streak",
    group: "Form",
    min: 1,
    max: 4,
    step: 0.1,
    default: 3,
    // A brighter, more treble-forward mix reads as more streaked.
    auto: { brightness: 0.2 },
  },
  {
    key: "duty",
    label: "Ink width",
    description: "Fraction of each period drawn as ink",
    group: "Form",
    min: 0.3,
    max: 0.8,
    step: 0.05,
    default: 0.5,
    // A real, tunable constant most people will only ever leave alone.
    advanced: true,
  },
  {
    key: "flicker",
    label: "Re-roll rate",
    description: "How often the noise field re-rolls, in Hz — 0 drifts smoothly instead of stepping",
    group: "Motion",
    min: 0,
    max: 60,
    step: 1,
    default: 30,
    // A locked tempo reads as a faster shimmer; without one this sits at its default.
    auto: { tempo: 0.3 },
  },
  {
    key: "drift",
    label: "Drift speed",
    description: "Speed of the field's slow, persistent component — and of the smooth glide when Re-roll rate is 0",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.2,
    auto: { tempo: 0.2 },
  },
  {
    key: "wander",
    label: "Wander",
    description: "How briskly the streak's stretch, orientation and tilt re-pick and ease to a new target — 0 freezes it",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // A faster, more dynamic track re-picks and turns sooner.
    auto: { tempo: 0.15, dynamics: 0.2 },
  },
  {
    key: "beatDip",
    label: "Beat dip",
    description: "Each beat briefly dips the warp depth, then recovers",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { pulse: 0.3 },
    // anim.beatPulse directly (the depthEnv dip term, render()) — a plain
    // Beat default.
    drive: { default: "feature.onset" },
  },
  {
    key: "blackout",
    label: "Blackout chance",
    description: "How often a bass hit flips the whole field to its opposite phase; a section drop always does",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    auto: { attack: 0.2 },
    // Gates only the chance-rolled bass-hit flip (advanceBlackout) — a
    // plain Bass hit default. The section-drop flip alongside it is
    // unconditional, independent of this choice.
    drive: { default: "anim.lowOnset", hit: { flatOnly: "A flip either happens or it doesn't, so it can't be sized.", reactionLabel: "flip" } },
  },
  {
    key: "curtain",
    label: "Curtain",
    description: "How readily a sustained quiet passage lifts the grating off the bottom of the frame; 0 = never",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { dynamics: 0.2 },
    // anim.sectionIntensity directly (the quiet-threshold comparison,
    // advanceCurtain) — a plain Section default.
    drive: { default: "anim.sectionIntensity" },
  },
  {
    key: "tint",
    label: "Tint",
    description: "Mixes the ink toward the palette color instead of flat black",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
  },
  {
    key: "ground",
    label: "Ground",
    description: "Brightness of the paper the lines sit on",
    group: "Look",
    min: 0.7,
    max: 1,
    step: 0.01,
    default: 0.91,
    advanced: true,
  },
];

export const card: SceneCard = {
  id: "moire",
  name: "Moiré",
  settings: SETTINGS,
};

export const loadBody = (): Promise<Scene> => import("./moire.ts").then((m) => m.moireScene);
