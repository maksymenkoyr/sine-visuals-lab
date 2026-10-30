// Chladni's card: what every page needs before the scene's code loads (src/render/lazyScene.ts).
import type { Scene, SceneCard } from "../scene.ts";
import type { SceneSetting } from "../sceneSettings.ts";
import { FREEZE_REF, SNAP_REF, ZONE_AXIS_MAX } from "./chladniSand.ts";
import { MODE_TABLE, PLATE_SHAPES, SQUARE } from "./chladniModeTable.ts";

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "released", added: "2026-08-30" } as const;

/** The Loud ↔ New setting's default: the share of each band's running
 *  average the plate subtracts from its excitation (createPlateResponse). */
export const SURPRISE_SHARE = 0.8;

/** Top of the Sand amount slider: the grain pool is this many times the
 *  quality tier's count, allocated once at init. */
export const SAND_AMOUNT_MAX = 5;

/** The grain weight at which every weight factor in SIM_FRAG is 1 and a grain
 *  is drawn at exactly Grain size — the plate as it was before grains had a
 *  weight, and Grain weight's default. See the file header. */
export const WEIGHT_REF = 0.7;

/** Size mix's default: about the ±25% size scatter grains had before they
 *  had a weight. */
export const SIZE_MIX_DEFAULT = 0.45;

/** Thrown to's choices, in value order: where a thrown grain's colour goes
 *  (Thrown colour sets how far). See the file header's sand colour section. */
export const THROWN_TO = ["Toward white", "Second colour", "Through the palette", "Into shadow"] as const;

// Glow's default wires: the slewed treble level and the hats pulse,
// summed with these weights. POINT_VERT's vGlow sum uses the same pair, so
// the default patch draws exactly what the old built-in reaction did.
export const GLOW_LEVEL_WEIGHT = 0.8;
export const GLOW_HIT_WEIGHT = 1.4;

export const SETTINGS: SceneSetting[] = [
  {
    key: "complexity",
    label: "Pattern complexity",
    description: "In effect the plate's size: a bigger plate's resonances sit lower, so the music reaches finer figures",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // Bright, busy mixes reach the plate's finer modes.
    auto: { brightness: 0.35, density: 0.2 },
  },
  {
    key: "resonance",
    label: "Resonance",
    description: "How sharply the plate picks one figure: high = one clean mode wins, low = a damped plate blurs neighbouring modes together",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    // A dense mix needs a sharper plate to stay legible.
    auto: { density: 0.2, pulse: 0.15 },
  },
  {
    key: "ring",
    label: "Ring",
    description: "How long a figure keeps ringing after its tone stops",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    // Fast, percussive music wants a quicker-decaying plate.
    auto: { tempo: -0.25, attack: -0.15 },
  },
  {
    key: "figureHold",
    label: "Figure hold",
    description: "How firmly the plate keeps its figure: 0, the figure follows whichever part of the music is busiest right now; higher, a new figure must ring clearly stronger than the one on the plate to take over",
    // Manual — how restless the plate should look is a taste call, not a
    // property of the track.
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
  },
  {
    key: "newness",
    label: "Loud ↔ New",
    description: "Which part of the music takes the plate: toward Loud, whichever part is loudest right now; toward New, whichever part just got louder than usual",
    // Manual, like Figure hold: how the plate should listen is a taste call,
    // not a property of the track.
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: SURPRISE_SHARE,
  },
  {
    key: "lockFigure",
    label: "Locked figure",
    description: "The figure the plate holds whatever the music does, picked in the Mode ladder; 0 lets the music choose",
    // Drawn as the Mode ladder (modeLadder widget), not a row. A table index
    // plus one on whichever plate is on screen, so neither Auto nor the
    // Master card's Scale may move it.
    group: "Form",
    min: 0,
    max: MODE_TABLE.length,
    step: 1,
    default: 0,
    masterScale: false,
  },
  {
    key: "plateShape",
    label: "Plate",
    description: "The plate the sand lies on; each shape rings its own figures. Clamped is the square held at its edges",
    // Manual, like every enum: which plate is a choice, not a property of the track.
    group: "Form",
    min: 0,
    max: PLATE_SHAPES.length - 1,
    step: 1,
    default: SQUARE,
    type: "enum",
    options: PLATE_SHAPES,
  },
  {
    // The key predates the other plates; saved looks and share codes carry it.
    key: "squarePlate",
    label: "True shape",
    description: "For the square plate only. On, it keeps its square shape in the middle of the screen; off, it stretches to fill the screen. The other plates always keep their shape",
    group: "Form",
    min: 0,
    max: 1,
    step: 1,
    default: 0,
    type: "boolean",
  },
  {
    key: "plateZoom",
    label: "Zoom",
    description: "How big the plate is: 1 fits it on screen, higher looks closer into its middle, lower shrinks it",
    // Manual: framing is taste.
    group: "Form",
    min: 0.5,
    max: 3,
    step: 0.05,
    default: 1,
    // Framing, not an amount: the Master dial must not crop the plate.
    masterScale: false,
  },
  {
    key: "grainSize",
    label: "Grain size",
    description: "Size of each sand grain on screen",
    group: "Form",
    min: 0.5,
    max: 3,
    step: 0.1,
    default: 1.8,
  },
  {
    key: "sandAmount",
    label: "Sand amount",
    description: "How much sand lies on the plate — 0 leaves it bare, 1 is the classic bed, more piles thicker lines; per-grain brightness is unchanged",
    // Manual like Grain size — a taste dial, not something to retune per track.
    group: "Form",
    min: 0,
    max: SAND_AMOUNT_MAX,
    step: 0.05,
    default: 1,
  },
  {
    key: "grainWeight",
    label: "Grain weight",
    description: "Left fine powder, right heavy grit: heavy grains bounce to the still lines, light ones drift with the air into heaps where the plate moves most",
    // Manual like Grain size — what the plate is sprinkled with, a taste dial.
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: WEIGHT_REF,
  },
  {
    key: "sizeMix",
    label: "Size mix",
    description: "Left every grain alike, right a mix from dust to grit, which the plate sorts: grit draws the lines, dust gathers between them",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: SIZE_MIX_DEFAULT,
  },
  {
    key: "shake",
    label: "Vibration",
    description: "How hard the music shakes the plate — a quiet plate shimmers its sand, a loud one throws it",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // A loud, dynamic room drives the plate harder.
    auto: { loudness: 0.3, dynamics: 0.15 },
    // uEnergy directly (inside the shake*(0.25+2.4*...) formula, SIM_FRAG) — a plain All level default.
    drive: { default: "anim.energy" },
  },
  {
    key: "kick",
    label: "Bass kick",
    description: "A kick throws the sand off its lines; the figure re-forms as it settles",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // Dark, bass-heavy mixes carry more kick presence to throw on.
    auto: { brightness: -0.3, attack: 0.25 },
    // uKickPulse directly — a plain Kick default.
    drive: { default: "anim.kickOnset" },
  },
  {
    key: "toss",
    label: "Toss",
    description: "On a drop the bed is thrown up and lands scattered; higher throws it higher and wider; 0 never tosses",
    // Manual — how hard a drop throws the sand is taste, not a property of
    // the track. The jack's edge starts a toss (nextToss); the slider is its power.
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    drive: { default: "anim.dropOnset", hit: { reactionLabel: "toss" } },
  },
  {
    key: "zoomOut",
    label: "Zoom out",
    description: "Square plate only: the plate pulls back for ever, its figure shrinking as a bigger one grows in; higher is faster, 0 is off. While on, the plate fills the screen unstretched, so True shape does nothing",
    // Manual: how fast to drift is taste. Speed is the slider times its jack
    // (zoomPhaseStep), so silence stops the zoom as it freezes the figure.
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
    drive: { default: "anim.energy" },
  },
  {
    key: "freezeEdge",
    label: "Freeze edge",
    description: "Plate drive below which the sand holds still and the figure stays put",
    // Drawn as a handle on the Sand zones gauge (sandZones widget), not a row.
    // Manual: the gauge shows stored edges, so Auto would make it lie.
    group: "Motion",
    min: 0.05,
    max: ZONE_AXIS_MAX - 0.2,
    step: 0.05,
    default: FREEZE_REF,
  },
  {
    key: "snapEdge",
    label: "Snap edge",
    description: "Plate drive above which the sand jumps onto a new figure within a beat or two",
    group: "Motion",
    min: 0.15,
    max: ZONE_AXIS_MAX,
    step: 0.05,
    default: SNAP_REF,
  },
  {
    key: "fieldGlow",
    label: "Plate glow",
    description: "A faint glow where the plate is moving, under the sand",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.25,
    // A louder room lights the plate a little more.
    auto: { loudness: 0.2 },
    // uEnergy directly (BG_FRAG) — a plain All level default.
    drive: { default: "anim.energy" },
  },
  {
    key: "grainGlow",
    label: "Grain brightness",
    description: "How bright the sand is; piles on the lines add up",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    auto: { loudness: 0.15 },
  },
  {
    key: "powderColour",
    label: "Powder colour",
    description: "Draws the light grains, which the air heaps between the lines, in a second colour. Shows only when the bed has light grains: move Grain weight left and Size mix right",
    // Manual like Grain weight: which colours the sand comes in is taste.
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
  },
  {
    key: "thrownColour",
    label: "Thrown colour",
    description: "How far a grain's colour moves while it is thrown: 0 keeps its resting colour, 1 is the usual, 2 moves it at the lightest hop. Thrown to picks where it goes",
    // Manual like Powder colour: how the sand is coloured is taste.
    group: "Look",
    family: "thrown",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
  },
  {
    key: "thrownTo",
    label: "Thrown to",
    description: "Where a thrown grain's colour goes: up the palette to white, to the second colour, through the palette's colours, or dark",
    group: "Look",
    family: "thrown",
    min: 0,
    max: THROWN_TO.length - 1,
    step: 1,
    default: 0,
    type: "enum",
    options: THROWN_TO,
  },
  {
    key: "twoSides",
    label: "Two sides",
    description: "Colours each grain by its side of the still line it lies by: the plate moves up on one side while the other goes down. One side keeps the sand colour, the other takes the second colour, and the plate's glow shows the same checkerboard",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
  },
  {
    key: "embers",
    label: "Embers",
    description: "Hops heat the sand and rest cools it: hot sand glows in pure colour like neon, with a halo, and sand that has rested goes nearly dark. 0 is off",
    group: "Look",
    family: "embers",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
  },
  {
    key: "emberFade",
    label: "Ember fade",
    description: "Seconds hot sand takes to cool: short, only the sand being thrown right now glows; long, the lines a loud part left behind keep glowing",
    group: "Look",
    family: "embers",
    min: 0.25,
    max: 8,
    step: 0.25,
    default: 2,
    // A time, not an amount: the Master dial must not change it.
    masterScale: false,
  },
  {
    key: "spectrumRings",
    label: "Spectrum rings",
    description: "Colours the sand with the music's spectrum flowing out from the centre in rings: around the plate is pitch, bass at the top and treble at the bottom; further out is longer ago",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
  },
  {
    key: "beatWaves",
    label: "Beat waves",
    description: "On each beat a wave runs out from the centre and dyes the sand it passes in the next palette colour; the sand carries the dye as it moves, until the next wave",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
    // The jack's edge starts a wave (advanceWave); the slider is how much of the dye shows.
    drive: { default: "feature.onset", hit: { flatOnly: "A wave either runs or it doesn't, so it can't be sized.", reactionLabel: "wave" } },
  },
  {
    key: "glitter",
    label: "Glitter",
    description: "Each grain is a flat shard: a light circles the plate once a bar, and the grains facing it flash in the palette's colours. Thrown grains tumble and twinkle",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
  },
  {
    key: "highGlow",
    label: "Glow",
    description: "Each grain blooms with a soft halo when its wires light up — the treble (hats and cymbals) to start",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // Directly the hats/cymbals dial, as caustics' sparkle.
    auto: { brightness: 0.35, attack: 0.15 },
    // Two real wires (the slewed high level and its onset pulse), weighted
    // as POINT_VERT's vGlow sum — never a built-in, so nothing shows as a
    // ghost wire: it's either plugged in or not.
    drive: {
      default: {
        mix: "add",
        sources: [
          { choice: "anim.high", weight: GLOW_LEVEL_WEIGHT },
          { choice: "anim.hats", weight: GLOW_HIT_WEIGHT },
        ],
      },
    },
  },
  {
    key: "beatFlash",
    label: "Flash",
    description: "Brightness punch on each beat — the sand and the plate both flare",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // Same reasoning as caustics' flash: punches read on punchy, uncluttered material.
    auto: { attack: 0.3, pulse: 0.2, density: -0.15 },
    // uBeatPulse directly, at both sites it's used (BG_FRAG's plate flash
    // and POINT_FRAG's grain brightness) — a plain Beat default.
    drive: { default: "feature.onset" },
  },
];

export const card: SceneCard = {
  id: "chladni",
  name: "Chladni",
  settings: SETTINGS,
  panel: [
    {
      widget: "sandZones",
      title: "Sand zones",
      hint: "How the sand answers the plate's drive: still, drifting to a new figure, or snapping onto it. Drag an edge to move it.",
      settings: ["freezeEdge", "snapEdge"],
    },
    {
      widget: "modeLadder",
      title: "Mode ladder",
      hint: "Each figure rings at its own note; the plate draws the strongest few. Click a figure to lock the plate on it, again to let the music choose.",
      settings: ["lockFigure"],
      card: true,
    },
  ],
};

export const loadBody = (): Promise<Scene> => import("./chladni.ts").then((m) => m.chladniScene);
