// Powder's card: what every page needs before the scene's code loads (src/render/lazyScene.ts).
import type { Scene, SceneCard } from "../scene.ts";
import type { SceneSetting } from "../sceneSettings.ts";

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "draft", added: "2026-09-04" } as const;

export const SETTINGS: SceneSetting[] = [
  {
    key: "size",
    label: "Cloud size",
    description: "How far each burst throws the powder — how much of the room it fills",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // A loud, busy room fills the frame.
    auto: { loudness: 0.3, density: 0.15 },
  },
  {
    key: "breathe",
    label: "Quiet gather",
    description: "How strongly a quiet passage gathers the powder back into one turning blob",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    // Quiet-verse / loud-chorus tracks are the ones worth breathing on.
    auto: { dynamics: 0.35 },
    // Scales this scene's own quiet-time `calm` signal (render()) — a slow
    // slewed composite of section intensity and bass level, not a catalogue
    // signal — so the default is Scene.
    drive: {
      default: "scene",
      sceneLabel: "Scene: this scene's own quiet-time calm signal",
      sceneSources: ["anim.sectionIntensity", "anim.low"],
    },
  },
  {
    key: "turbulence",
    label: "Turbulence",
    description: "How hard the air churns the powder — swirls, tendrils and wisps peeling off the mass",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // Busy, fast mixes churn more.
    auto: { density: 0.25, tempo: 0.2 },
    // uEnergy directly (turbAmp, the wind-force term) — a plain All level default.
    drive: { default: "anim.energy" },
  },
  {
    key: "swirl",
    label: "Swirl",
    description: "How fast the whole mass turns on its axis",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
    // The turn follows the tempo.
    auto: { tempo: 0.3 },
  },
  {
    key: "kick",
    label: "Bass kick",
    description: "Every bass hit throws a directed plume of powder out of the mass; it coasts, then falls",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    // Dark, bass-heavy mixes carry more kick presence to throw on.
    auto: { attack: 0.3, brightness: -0.2 },
    // Gates the ordinary plume (render()) and scales the point-size grow
    // term (POINT_VERT) — both anim.lowPulse/lowOnset directly, a plain
    // Bass hit default. A drop's own opposed-pair plume is unconditional,
    // independent of this choice, the same as caustics' drop ring.
    drive: { default: "anim.lowOnset", hit: { reactionLabel: "plume" } },
  },
  {
    key: "chunks",
    label: "Chunk burst",
    description: "The hardest hits throw a spray of chunky red cubes along the plume",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // Cubes read best on punchy, dynamic music.
    auto: { attack: 0.25, dynamics: 0.2 },
    // Gated and scaled by this scene's own hit-strength detector (bigHit,
    // render()) — a bespoke composite of level, pulse, section intensity
    // and both rise flags — so the default is Scene.
    drive: {
      default: "scene",
      sceneLabel: "Scene: this scene's own hit-strength detector",
      sceneSources: ["anim.low", "anim.lowOnset", "anim.sectionIntensity", "anim.dropOnset"],
      hit: { reactionLabel: "burst" },
    },
  },
  {
    key: "heat",
    label: "Red heat",
    description: "How readily fast-moving powder glows hot red instead of ice blue",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    // The red fraction grows with loud, dark mixes.
    auto: { loudness: 0.2, brightness: -0.2 },
  },
  {
    key: "glow",
    label: "Glow",
    description: "How bright each speck of powder is; overlapping specks add up",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // As chladni's grain brightness.
    auto: { loudness: 0.2 },
  },
  {
    key: "grain",
    label: "Grain size",
    description: "Size of each speck on screen — fine dust or coarse chalk",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
  },
  {
    key: "room",
    label: "Room",
    description: "How visible the dark box room behind the powder is",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
  },
  {
    key: "sparkle",
    label: "Sparkle",
    description: "A scattering of grains twinkling white on the hats and the highs",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.45,
    // Bright, snappy material is what has hats worth twinkling on.
    auto: { brightness: 0.4, attack: 0.15 },
    // Two signals across two layers (a treble hit, or the sustained treble
    // level too), not one — same reasoning as caustics' Sparkle —
    // so the default is Scene.
    drive: { default: "scene", sceneLabel: "Scene: treble level + hits", sceneSources: ["anim.high", "anim.highOnset"] },
  },
  {
    key: "hueDrift",
    label: "Hue drift",
    description: "How far the blue/red pair walks around the colour wheel as the track goes on",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // A track that goes somewhere gets a palette that goes somewhere.
    auto: { dynamics: 0.2 },
  },
  {
    key: "paletteMix",
    label: "Palette tint",
    description: "0 keeps the powder's own ice-blue and coral; 1 recolours it with the app palette",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
    advanced: true,
  },
  {
    key: "camera",
    label: "Camera move",
    description: "Push-in on the kick, how fast the view orbits, and the shake on a drop",
    group: "Camera",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // Move the camera on music that has hits and a tempo to move to.
    auto: { pulse: 0.25, tempo: 0.15 },
    // Two different signals at two different sites — the push-in reads a
    // bass hit, the drop shake reads the drop pulse — so the default is Scene.
    drive: {
      default: "scene",
      sceneLabel: "Scene: bass hit (push-in) and drop (shake)",
      sceneSources: ["anim.lowOnset", "anim.dropOnset"],
    },
  },
  {
    key: "flash",
    label: "Beat flash",
    description: "Brightness punch on each beat, and the white flash on a drop",
    group: "Post",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
    // Same reasoning as chladni's and caustics' flash: punches read on
    // punchy, uncluttered material.
    auto: { attack: 0.3, pulse: 0.2, density: -0.15 },
    // Every site mixes a different weighted blend of bass hit/beat hit/
    // drop (or, at two sites, just one of them alone) — no single catalogue
    // pick reproduces all five, so the default is Scene.
    drive: {
      default: "scene",
      sceneLabel: "Scene: bass, beat and drop hits, weighted per site",
      sceneSources: ["anim.lowOnset", "feature.onset", "anim.dropOnset"],
    },
  },
  {
    key: "bloom",
    label: "Bloom",
    description: "Soft halo around the powder — how much the cloud lights the room up",
    group: "Post",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    // A loud room wants more haze in the air.
    auto: { loudness: 0.2 },
  },
];

export const card: SceneCard = {
  id: "powder",
  name: "Powder",
  settings: SETTINGS,
};

export const loadBody = (): Promise<Scene> => import("./powder.ts").then((m) => m.powderScene);
