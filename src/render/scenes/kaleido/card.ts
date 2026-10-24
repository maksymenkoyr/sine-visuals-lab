// Kaleidoscope's card: what every page needs before the scene's code loads (src/render/lazyScene.ts).
import type { Scene, SceneCard } from "../../scene.ts";
import type { SceneSetting } from "../../sceneSettings.ts";

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "draft", added: "2026-09-05" } as const;

const STYLE_NAMES = ["Mandala", "Portal", "Prism", "Burst"] as const;

const SETTINGS: SceneSetting[] = [
  {
    key: "style",
    label: "Style",
    description:
      "Mandala: nested contour bands. Portal: a disc of petalled rings pouring out of the centre. Prism: a mirror kaleidoscope of a rainbow texture. Burst: crystal shards rushing out of a dark star. Every other setting remembers its own value per style",
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
    key: "symmetry",
    label: "Symmetry",
    description: "How many mirrored wedges each mandala folds into, and with it how many child mandalas sit on its ring",
    group: "Form",
    min: 6,
    max: 32,
    step: 2,
    default: 20,
    variantDefaults: { Portal: 16, Prism: 6, Burst: 8 },
    // Framing geometry the user picks to taste, same reasoning as caustics'
    // Caustic density — not something the music profile should redecide.
  },
  {
    key: "spread",
    label: "Nesting",
    description: "How big the child mandalas on each ring are — small beads at the low end, nearly touching at the high end; each is a whole copy of its parent, and the dive goes into one of them",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
  },
  {
    key: "rings",
    label: "Ring density",
    description: "How finely the picture is banded — fewer, fatter bands, rings or colour steps low; a fine lace high",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // A busy, bright mix reads as finer lace; a sparse dark one as bold bands.
    auto: { density: 0.3, brightness: 0.15 },
  },
  {
    key: "spectrum",
    label: "Spectrum rings",
    description: "How much the spectrum shapes the rings — bass lengthens the inner petals, treble the outer ones; in the texture styles it drives the contrast",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    auto: { density: 0.2, dynamics: 0.2 },
  },
  {
    key: "bass",
    label: "Bass swell",
    description: "How far a sustained bass level stretches the centre flower, warps the texture, or grows the core",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { brightness: -0.2, loudness: 0.2 },
    // uLow directly, at every style's own use of it — a plain Bass level default.
    drive: { default: "anim.low" },
  },
  {
    key: "morph",
    label: "Shape drift",
    description: "How fast the petals wander between round lobes, zigzag stars and pointed drops, and the textures churn",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    auto: { tempo: 0.2, dynamics: 0.2 },
  },
  {
    key: "flow",
    label: "Flow",
    description: "How fast the bands, rings, stripes or shards stream out of every centre; bass pushes them faster",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { tempo: 0.3, loudness: 0.2 },
  },
  {
    key: "zoom",
    label: "Zoom",
    description:
      "How fast the camera dives into the top child mandala — it grows into its parent's place, its own children grow into its rings, and so on forever",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.25,
    variantDefaults: { Portal: 0.25, Prism: 0.6, Burst: 0.4 },
    auto: { tempo: 0.2, loudness: 0.15 },
  },
  {
    key: "pulse",
    label: "Beat surge",
    description: "Each beat swells the mandala, pushes the bands along or kicks the zoom, and lifts the brightness; a section drop flips every ring between warm and cool",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { pulse: 0.3, attack: 0.2 },
    // anim.onset directly (advanceBeatSurge's trigger) — a plain Beat
    // default. The section-drop palette flip alongside it is unconditional
    // — independent of this choice, gated only on this setting's own
    // resolved value being nonzero, not on which signal fires it.
    drive: { default: "feature.onset", hit: { reactionLabel: "surge" } },
  },
  {
    key: "ease",
    label: "Surge ease",
    description: "How soft each beat's push and swell are — a quick snap at the low end, a long roll at the high end; the distance travelled per beat stays the same",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // Soft swells suit soft music; sharp hits suit a snap.
    auto: { attack: -0.3 },
  },
  {
    key: "spin",
    label: "Spin",
    description: "How fast alternate rings counter-rotate inside each cell; the mids speed it up",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
    auto: { tempo: 0.2 },
  },
  {
    key: "breathe",
    label: "Bar breathe",
    description: "Once per bar, while the tempo is locked, Mandala's petals split in two and rejoin and the other styles' zoom rocks forward and back",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { pulse: 0.3 },
  },
  {
    key: "twist",
    label: "Twist",
    description: "Shears the bands or texture across each wedge into chevrons and spirals",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.25,
    // Framing, like Symmetry — a look the user picks.
  },
  {
    key: "ink",
    label: "Ink",
    description: "Weight of the dark outlines between bands and of the navy ring that starts each cycle",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    variantDefaults: { Prism: 0.15, Burst: 0.3 },
    auto: { brightness: -0.2 },
  },
  {
    key: "tint",
    label: "Tint drift",
    description: "How far a bright or dull spectrum slides every band's colour along the palette",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
    auto: { brightness: 0.2 },
    // uCentroid directly (tBase0, main()) — a plain Centroid default.
    drive: { default: "anim.centroid" },
  },
];

export const card: SceneCard = {
  id: "kaleidoscope",
  name: "Kaleidoscope",
  settings: SETTINGS,
};

export const loadBody = (): Promise<Scene> => import("./index.ts").then((m) => m.kaleidoscopeScene);
