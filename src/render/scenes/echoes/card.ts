// Echoes' card: what every page needs before the scene's code loads (src/render/lazyScene.ts).
import type { Scene, SceneCard } from "../../scene.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import type { SolidId } from "./solids.ts";

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "development", added: "2026-10-05" } as const;

/** What each Shape chip draws, in chip order: a flat outline by corner
 *  count (0 is a circle), or a 3D/4D figure from solids.ts. New entries go
 *  at the end — a saved look stores the chip's index. */
export const SHAPES: readonly { name: string; corners: number; solid?: SolidId }[] = [
  { name: "Circle", corners: 0 },
  { name: "Triangle", corners: 3 },
  { name: "Square", corners: 4 },
  { name: "Pentagon", corners: 5 },
  { name: "Hexagon", corners: 6 },
  { name: "Tetrahedron", corners: 0, solid: "tetrahedron" },
  { name: "Cube", corners: 0, solid: "cube" },
  { name: "Octahedron", corners: 0, solid: "octahedron" },
  { name: "Icosahedron", corners: 0, solid: "icosahedron" },
  { name: "Tesseract", corners: 0, solid: "tesseract" },
  { name: "16-cell", corners: 0, solid: "cell16" },
  { name: "24-cell", corners: 0, solid: "cell24" },
  { name: "Dodecahedron", corners: 0, solid: "dodecahedron" },
  { name: "Cuboctahedron", corners: 0, solid: "cuboctahedron" },
  { name: "5-cell", corners: 0, solid: "cell5" },
];

export const SETTINGS: SceneSetting[] = [
  // Form
  {
    key: "shape",
    label: "Shape",
    description:
      "The outline the echoes come from: a flat shape, a 3D solid whose echoes trail back into depth, or a 4D shape (a tesseract is a 4D cube) whose echoes trail through the fourth dimension",
    group: "Form",
    min: 0,
    max: SHAPES.length - 1,
    step: 1,
    default: 0,
    type: "enum",
    options: SHAPES.map((s) => s.name),
  },
  {
    key: "mirror",
    label: "Mirror",
    description:
      "Folds a flat shape's flow into this many mirrored arms, so the echoes fan out in a kaleidoscope — 0 leaves it free (3D and 4D shapes ignore it)",
    group: "Form",
    min: 0,
    max: 8,
    step: 1,
    default: 0,
  },
  {
    key: "size",
    label: "Size",
    description: "How big the outline is",
    group: "Form",
    min: 0.1,
    max: 0.8,
    step: 0.01,
    default: 0.35,
  },
  {
    key: "echoes",
    label: "Echoes",
    description: "How many echo lines trail behind the outline before they're gone — right keeps more",
    group: "Form",
    min: 2,
    max: 40,
    step: 1,
    default: 10,
  },
  {
    // Not "detail": uDetail is a common uniform (sceneCommon.ts).
    key: "flowDetail",
    label: "Detail",
    description: "How tight the flow's bends are — right makes smaller, busier swirls",
    group: "Form",
    min: 0.3,
    max: 3,
    step: 0.05,
    default: 1,
  },
  // Motion
  {
    key: "flow",
    label: "Flow",
    description:
      "How far each echo is pushed from the one before — right spreads the lines further apart; a 3D or 4D shape's echoes go back into depth",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    drive: { default: "anim.mid" },
  },
  {
    key: "drift",
    label: "Drift",
    description: "How fast the flow's pattern changes",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
  },
  {
    key: "breathe",
    label: "Breathe",
    description: "How much the outline grows on the wave it's plugged into",
    group: "Motion",
    min: 0,
    max: 0.6,
    step: 0.02,
    default: 0.2,
    drive: { default: "anim.barWave" },
  },
  {
    key: "kick",
    label: "Kick",
    description: "How far a hit pops the outline outward — the pop runs down the echoes as a ripple",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.15,
    drive: { default: "anim.kickOnset" },
  },
  {
    key: "shock",
    label: "Shockwave",
    description: "How bright the ring is that a hit sends down the echoes, from the outline to the last one — 0 sends none",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    drive: { default: "anim.kickOnset", hit: { reactionLabel: "ring" } },
  },
  {
    key: "spin",
    label: "Spin",
    description: "How fast the outline turns, in degrees a second — 3D and 4D shapes tumble at this pace",
    group: "Motion",
    min: 0,
    max: 60,
    step: 1,
    default: 6,
  },
  // Look
  {
    key: "colours",
    label: "Colours",
    description: "How far the lines pull toward the app's own palette instead of the measured warm white on black",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
  },
  {
    key: "ageTint",
    label: "Age tint",
    description: "How far the echoes change colour as they get older — the newest keep the base colour",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
  },
];

export const card: SceneCard = {
  id: "echoes",
  name: "Echoes",
  settings: SETTINGS,
};

export const loadBody = (): Promise<Scene> => import("./index.ts").then((m) => m.echoesScene);
