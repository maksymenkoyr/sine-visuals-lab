// Tessera's card: what every page needs before the scene's code loads (src/render/lazyScene.ts).
import type { Scene, SceneCard } from "../../scene.ts";
import type { SceneSetting } from "../../sceneSettings.ts";

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "draft", added: "2026-09-20" } as const;

export const SETTINGS: SceneSetting[] = [
  {
    key: "pitch",
    label: "Pitch",
    description: "Ring spacing, as a fraction of the ball's own radius -- smaller packs in more, smaller boxes",
    group: "Form",
    min: 0.05,
    max: 0.2,
    step: 0.005,
    // Round 5: finer still for the close-up view -- RING_THETA_MAX/0.07 is
    // comfortably under MAX_RINGS, so the ring cap isn't hit at full
    // quality, and render()'s detailScale thinning still applies on top.
    default: 0.07,
  },
  {
    key: "fold",
    label: "Folds",
    description: "How many scalloped petals the lobe pattern makes around the ball",
    group: "Form",
    min: 2,
    max: 16,
    step: 1,
    default: 8,
  },
  {
    key: "swirl",
    label: "Swirl",
    description: "How far the petals and the colour sectors twist with latitude",
    group: "Form",
    min: -2,
    max: 2,
    step: 0.05,
    default: 0.55,
  },
  {
    key: "fill",
    label: "Fill",
    description: "A box's width and depth, as a fraction of its own ring/meridian spacing -- low reads as fine bare spokes, high as tightly packed boxes with thin dark gaps between",
    group: "Form",
    min: 0.15,
    max: 1,
    step: 0.05,
    // Round 5: lower than it looks like it should be -- at a high Fill,
    // neighbouring boxes' own dark interior faces crowd out and occlude
    // each other's bright rims at oblique viewing angles (most of the
    // mid/far view), measurably dimming those views; 0.48 leaves enough gap
    // between boxes for the depth test to resolve which one actually wins
    // each pixel.
    default: 0.48,
  },
  {
    key: "wall",
    label: "Wall",
    description: "How thick each box's own bright rim reads, as a fraction of its smaller cross-section dimension -- higher narrows the dark mouth to a slit",
    group: "Form",
    min: 0.2,
    max: 0.45,
    step: 0.01,
    // Round 5: the reference's own mouth is a narrow dark SLIT in a bright
    // bar (bursts/003.03, bursts/011.02), not a wide dark hole in a thin
    // frame -- 0.35 leaves an open bore of about 30% of the box's own
    // smaller cross-section dimension (bore fraction = 1 - 2*Wall).
    default: 0.35,
    advanced: true,
  },
  {
    key: "lenBase",
    label: "Base length",
    description: "How far every box stands off the sphere before the spectrum adds to it, as a fraction of the ball's own radius",
    group: "Form",
    min: 0,
    max: 0.4,
    step: 0.01,
    // Round 5: raised so the resting (silent) lobe shells reach roughly
    // 0.2-0.3 R at their own tips -- the reference's dome is visibly 8
    // scalloped shells even without audio (see lattice.ts's LOBE_REST_MIN).
    default: 0.2,
  },
  {
    key: "lenAudio",
    label: "Length reactivity",
    description: "How far a box's length swings with its ring's own frequency band, as a fraction of the ball's own radius",
    group: "Form",
    min: 0,
    max: 0.6,
    step: 0.02,
    default: 0.22,
    auto: { dynamics: 0.3 },
  },
  {
    key: "jitter",
    label: "Jitter",
    description: "Per-frame length flicker at the box ends",
    group: "Form",
    min: 0,
    max: 0.3,
    step: 0.01,
    default: 0.03,
    auto: { density: 0.25 },
  },
  {
    key: "spin",
    label: "Spin",
    description: "Camera roll about its own view axis, degrees/second (negative = clockwise)",
    group: "Motion",
    min: -60,
    max: 60,
    step: 1,
    default: -20,
  },
  {
    key: "drift",
    label: "Drift",
    description: "Runs the camera's out-and-in dolly as a slow, free-running cycle instead of holding still at the Dolly slider",
    group: "Motion",
    type: "boolean",
    min: 0,
    max: 1,
    step: 1,
    default: 1,
  },
  {
    key: "hueRate",
    label: "Hue rate",
    description: "How fast the colour sweeps -- scales with how loud/driven the music is, and locks to one turn per bar once tempo is held",
    group: "Motion",
    min: 0,
    max: 1.2,
    step: 0.05,
    default: 0.4,
    auto: { tempo: 0.25, pulse: 0.2 },
  },
  {
    key: "pastel",
    label: "Pastel",
    description: "Pulls box colour toward a light pearl tone",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.55,
  },
  {
    key: "iridescence",
    label: "Iridescence",
    description: "A per-face hue shimmer, from each wall's own facing direction",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
  },
  {
    key: "rim",
    label: "Rim",
    description: "How far the lit band at each box's open end reaches back along its length, beyond the open end itself (which is always lit)",
    group: "Look",
    min: 0,
    max: 3,
    step: 0.1,
    default: 0.3,
  },
  {
    key: "crossGain",
    label: "Axis cross",
    description: "How much brighter and longer the four axis-aligned spokes of boxes are than the rest",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 0.8,
  },
  {
    key: "shellGain",
    label: "Backdrop shell",
    description: "Brightness of the larger, dim shell of inward-facing boxes behind the ball, visible when the camera is far",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    // Round 5: still the dominant term at mid/far, not brought down to the
    // round-2 "dim background layer" level the brief asked for -- measured
    // (screenshot debug, shellGain forced to 0): the ball's own long-wall
    // faces, not the mouth's own thickness, are what set the mid/far view's
    // brightness ceiling, and the azimuth-facing walls (meant to be the
    // brighter of the two -- WALL_SHADE_AZIMUTH) barely contribute any
    // screen area at all there (their own across-extent collapses toward
    // the view axis near the camera's own horizon, a projection fact of the
    // flat zero-thickness wall quads, not something Wall/Fill can tune
    // away). Fill came down and WALL_SHADE_MERIDIAN went up to claw back
    // what's actually achievable from the ball alone; the shell still has
    // to cover the rest to hit the measured luminance targets.
    default: 0.85,
  },
  {
    key: "dolly",
    label: "Dolly",
    description: "Camera distance -- 0 sits just above the ball for the starburst view, 1 pulls back to the dome view",
    group: "Camera",
    min: 0,
    max: 1,
    step: 0.01,
    default: 0,
  },
  {
    key: "fov",
    label: "Field of view",
    description: "Camera field of view, degrees -- wider makes the near view's walls converge harder",
    group: "Camera",
    min: 40,
    max: 120,
    step: 1,
    default: 90,
  },
  {
    key: "glow",
    label: "Glow",
    description: "Bloom strength",
    group: "Post",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1.2,
  },
];

export const card: SceneCard = {
  id: "tessera",
  name: "Tessera",
  minQuality: "low",
  settings: SETTINGS,
};

export const loadBody = (): Promise<Scene> => import("./index.ts").then((m) => m.tesseraScene);
