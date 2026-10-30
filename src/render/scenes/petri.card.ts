// Petri's card: what every page needs before the scene's code loads (src/render/lazyScene.ts).
import type { Scene, SceneCard } from "../scene.ts";
import type { SceneSetting } from "../sceneSettings.ts";

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "draft", added: "2026-09-18" } as const;

const STYLE_NAMES = ["Clay", "Beads", "Spectrum", "Ember", "Neon"] as const;

export const SETTINGS: SceneSetting[] = [
  // Form
  {
    key: "style",
    label: "Style",
    description:
      "Clay: light clay ground, the colony carved into it as a lit relief — the grayscale references. Beads: the same relief as a glossy floor flown over in perspective. Spectrum: a jet LUT, blue substrate through green to red cores. Ember: bone-and-copper on black with a hot rim. Neon: only the colony's outline, as glowing lines whose hue follows the music. Every other setting remembers its own value per style",
    group: "Form",
    type: "enum",
    options: STYLE_NAMES,
    min: 0,
    max: STYLE_NAMES.length - 1,
    step: 1,
    default: 0,
    variant: true,
  },
  {
    key: "feed",
    label: "Feed",
    description: "How fast the reagent refills — low holds spots and worms, high pushes toward chaos",
    group: "Form",
    min: 0.02,
    max: 0.09,
    step: 0.001,
    default: 0.037,
    variantDefaults: { Beads: 0.03, Spectrum: 0.032, Ember: 0.0545, Neon: 0.039 },
    auto: { density: 0.3, brightness: 0.15 },
  },
  {
    key: "kill",
    label: "Kill",
    description: "How fast the pattern is consumed — rising through this crosses spots into worms into waves",
    group: "Form",
    min: 0.03,
    max: 0.07,
    step: 0.0005,
    default: 0.06,
    variantDefaults: { Beads: 0.062, Spectrum: 0.058, Ember: 0.062, Neon: 0.058 },
    auto: { dynamics: 0.2, tempo: -0.15 },
  },
  {
    key: "scale",
    label: "Cell size",
    description:
      "Zooms the pattern — a finer weave at the low end, bigger cells at the high end (Beads: bigger floor tiles)",
    group: "Form",
    min: 0.5,
    max: 2.5,
    step: 0.05,
    default: 1.2,
    variantDefaults: { Clay: 1.0, Spectrum: 0.8 },
  },
  {
    key: "dish",
    label: "Dish",
    description:
      "Confines the colony to a round dish of this size with bare ground around it — 0 lets it fill the whole (wrapping) field",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
    variantDefaults: { Clay: 0.9 },
  },
  // Motion
  {
    key: "speed",
    label: "Growth speed",
    description: "Simulation steps per rendered frame — how fast the pattern grows and spreads",
    group: "Motion",
    min: 1,
    max: 6,
    step: 1,
    default: 3,
    auto: { pulse: 0.25, attack: 0.15 },
  },
  {
    key: "throb",
    label: "Beat growth",
    description:
      "Extra growth steps squeezed in on each beat, so the colony grows in jerks with the music instead of at one steady pace",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { pulse: 0.2 },
    // anim.beatPulse directly (the extra-iterations term below) — a plain
    // Beat default.
    drive: { default: "feature.onset" },
  },
  {
    key: "reseed",
    label: "Reseed",
    description: "How hard a beat stamps fresh nucleation points into the field — 0 leaves it to grow on its own",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
    auto: { pulse: 0.2 },
    // anim.onset gates the stamp below — a plain Beat default. The stamp's
    // own strength still rides anim.beatPulse's graded hit shape, untouched.
    drive: { default: "feature.onset", hit: { reactionLabel: "reseed" } },
  },
  {
    key: "wipe",
    label: "Kick wipe",
    description: "A kick clears a round hole in the colony, which then regrows from its rim — size follows the hit",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    auto: { dynamics: 0.2 },
    // anim.song.kickOnset gates the stamp below — a plain Kick default. The
    // hole's own radius still rides anim.song.kickPulse's graded hit shape, untouched.
    drive: { default: "anim.kickOnset", hit: { reactionLabel: "wipe" } },
  },
  {
    key: "regime",
    label: "Regime cuts",
    description:
      "Jumps Feed/Kill to another named pattern regime and reseeds — the references are montages cutting between regimes. Drop: only on a section drop. Phrase: every four bars (and drops). Bar: every bar (and drops). Feed/Kill then shift the current regime rather than set it",
    group: "Motion",
    type: "enum",
    options: ["Off", "Drop", "Phrase", "Bar"],
    min: 0,
    max: 3,
    step: 1,
    default: 2,
    reads: ["anim.dropOnset"],
  },
  // Look
  {
    key: "glow",
    label: "Front glow",
    description: "Brightens the growth front where the pattern is changing fastest",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    auto: { brightness: 0.2 },
    // uBeatPulse directly (DISPLAY_FRAG's glowEff) — a plain Beat default.
    drive: { default: "feature.onset" },
  },
  {
    key: "relief",
    label: "Relief",
    description:
      "How tall the colony stands off the ground in Clay and Beads (a kick makes it swell); a lighter shading in Spectrum and Ember; nothing in Neon",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    auto: { dynamics: 0.2 },
    // uKickPulse directly (DISPLAY_FRAG's reliefEff) — a plain Kick default.
    drive: { default: "anim.kickOnset" },
  },
  {
    key: "shaping",
    label: "Band shaping",
    description:
      "Lets the spectrum reshape the colony by radius — each band's level bends the kill rate at its own distance from the centre, bass in the middle, treble at the rim, so kicks go spotty in the centre while hats send the edge wormy",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { density: 0.2 },
  },
  {
    key: "tint",
    label: "Hue follow",
    description:
      "How far the live spectral centroid pushes the palette hue in Spectrum, Ember and Neon — Clay and Beads stay gray",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // uCentroid directly (DISPLAY_FRAG's hueShift) — a plain Centroid default.
    drive: { default: "anim.centroid" },
  },
  // Camera
  {
    key: "drift",
    label: "Drift",
    description: "A slow continuous spin over the pattern (Beads: flies forward over the floor instead)",
    group: "Camera",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
    auto: { dynamics: 0.2 },
  },
  {
    key: "punch",
    label: "Beat zoom",
    description: "Punches the view in on each beat; a regime cut kicks it harder",
    group: "Camera",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    auto: { pulse: 0.2 },
    // uBeatPulse directly (DISPLAY_FRAG's zoom) — a plain Beat default. The
    // regime-cut kick (uCutKick) is a separate additive term, untouched.
    drive: { default: "feature.onset" },
  },
  // Post
  {
    key: "symmetry",
    label: "Symmetry",
    description: "Folds the picture into this many mirrored wedges — 0 leaves the pattern's own asymmetric growth alone",
    group: "Post",
    min: 0,
    max: 8,
    step: 1,
    default: 0,
  },
];

export const card: SceneCard = {
  id: "petri",
  name: "Petri",
  settings: SETTINGS,
};

export const loadBody = (): Promise<Scene> => import("./petri.ts").then((m) => m.petriScene);
