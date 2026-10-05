// Sweep — one shape drawn as a stack of copies blended from a tail end to a
// head end along a path, each copy coloured by its place in the stack on a
// cyclic palette, outlined, the oldest ones blurred and faded, the head on
// top. Built from `/ref` on Fabio Catapano's "Colorem" generative series
// (r/creativecoding, a silent 20 s reel — bundle `colorem`,
// docs/scenes/sweep.md). Measured, every piece of the reel is this one
// generator at different values, so the scene exposes the generator's own
// knobs rather than a list of looks (the record's Deconstruction).
//
// Files: stack.ts is the pure model (palettes, paths from a seed, the span,
// packing a frame); glsl.ts is the per-pixel composite; this file turns
// settings and drives into stack.ts's Knobs each frame;
// src/ui/widgets/sweepPath.ts is the Path section (the New path trigger row
// and button).
//
// Drives (drives.ts's header). Every continuous knob has a jack. Three start
// on a real wire:
// - Speed moves the head along its path by its level (Level — the input's
//   absolute loudness, 0 in a silent room, where the auto-gained levels lift
//   mic hiss): no signal, no movement.
// - Colour flow scrolls the palette through the stack by the same Level.
// - New path re-rolls the path on the beat grid's coarsest stop, counting
//   NEW_PATH_GRID_DIVISOR ticks per path in JS (beatGrid.ts has no phrase
//   stop) — a phrase at the default amount.
// The rest start unplugged (the user's call, 2026-10-05: wireable, still
// until wired). A wired knob is lifted from its slider toward its right end
// by LIFT × its reading — identity with nothing plugged in, so an empty jack
// is exactly the slider.
//
// The path seed (`path`) is a setting so the New path button reaches the
// pop-out output and a room's TV and is kept in a Look; a New path on the
// wire re-rolls locally on top of it.
import type { SceneSetting } from "../../sceneSettings.ts";
import type { Scene } from "../../scene.ts";
import type { DrivePatch } from "../../drives.ts";
import { createFullscreenScene } from "../../fullscreenScene.ts";
import {
  HEAD_START,
  MAX_COPIES,
  OUTLINE_STYLES,
  PALETTES,
  SHAPES,
  SW,
  headOf,
  newPathDivisor,
  packFrame,
  progressFor,
  rollPath,
  type Knobs,
  type PathRoll,
} from "./stack.ts";
import { SWEEP_FRAG_BODY, SWEEP_UNIFORMS_GLSL } from "./glsl.ts";

const ID = "sweep";

/** Progress per second at Speed 1 with its drive reading 1. At a typical
 *  level of about half, the head is ~80 % along its path after one 120 bpm
 *  phrase (stack.ts's headOf). */
const SPEED_GAIN = 0.4;

/** Palette cycles per second at Colour flow 1 with its drive reading 1. */
const FLOW_GAIN = 0.5;

/** Two-bar grid ticks per path at New path's default amount: a phrase. */
const NEW_PATH_GRID_DIVISOR = 2;

/** How far a full drive reading lifts a knob toward its right end. */
const LIFT = 0.5;

/** A jack that starts unplugged. */
const EMPTY: { default: DrivePatch } = { default: { mix: "add", sources: [] } };

const SETTINGS: SceneSetting[] = [
  // Form
  {
    key: "shape",
    label: "Shape",
    description: "The shape every copy is",
    group: "Form",
    family: "Shape",
    min: 0,
    max: SHAPES.length - 1,
    step: 1,
    default: SHAPES.indexOf("Drop"),
    type: "enum",
    options: SHAPES,
  },
  {
    key: "stretch",
    label: "Stretch",
    description: "Left squeezes the shape narrow, right pulls it wide",
    group: "Form",
    family: "Shape",
    min: 0.4,
    max: 2.5,
    step: 0.05,
    default: 1,
    drive: EMPTY,
  },
  {
    key: "copies",
    label: "Copies",
    description: "How many copies the stack has — few read as separate outlines, many melt into smooth bands",
    group: "Form",
    family: "Stack",
    min: 2,
    max: MAX_COPIES,
    step: 1,
    default: 40,
    drive: EMPTY,
  },
  {
    key: "size",
    label: "Size",
    description: "How big the copies are, in the middle of the stack",
    group: "Form",
    family: "Stack",
    min: 0.03,
    max: 1.2,
    step: 0.01,
    default: 0.17,
    drive: EMPTY,
  },
  {
    key: "taper",
    label: "Taper",
    description: "Left the copies shrink toward the head, right they grow toward it",
    group: "Form",
    family: "Stack",
    min: -2,
    max: 2,
    step: 0.05,
    default: -0.9,
    drive: EMPTY,
  },
  {
    key: "twist",
    label: "Twist",
    description: "How far the copies turn from the tail to the head, in degrees — left clockwise, right anticlockwise",
    group: "Form",
    family: "Stack",
    min: -360,
    max: 360,
    step: 5,
    default: 0,
    drive: EMPTY,
  },
  {
    key: "pair",
    label: "Pair",
    description: "Adds a second stack heading the other way, its colours a step round the palette",
    group: "Form",
    family: "Stack",
    min: 0,
    max: 1,
    step: 1,
    default: 0,
    type: "boolean",
  },
  // Motion
  {
    key: "travel",
    label: "Travel",
    description: "How long the path is — how far the head gets from where the stack started",
    group: "Motion",
    family: "Path",
    min: 0,
    max: 2,
    step: 0.05,
    default: 0.85,
    drive: EMPTY,
  },
  {
    key: "bend",
    label: "Bend",
    description: "How much the path curves — the middle is straight, either end curves it one way or the other",
    group: "Motion",
    family: "Path",
    min: -1,
    max: 1,
    step: 0.05,
    default: 0.3,
    drive: EMPTY,
  },
  {
    key: "aim",
    label: "Aim",
    description: "Left the heads arrive at the middle of the frame, right they leave from it",
    group: "Motion",
    family: "Path",
    min: -1,
    max: 1,
    step: 0.05,
    default: 0,
    drive: EMPTY,
  },
  {
    key: "spread",
    label: "Spread",
    description: "Left the stack grows from one end, right it starts in the middle and spreads both ways",
    group: "Motion",
    family: "Path",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
    drive: EMPTY,
  },
  {
    key: "trail",
    label: "Trail",
    description: "How much of the stack behind the head stays drawn — left leaves a short comet",
    group: "Motion",
    family: "Path",
    min: 0.05,
    max: 1,
    step: 0.05,
    default: 1,
    drive: EMPTY,
  },
  {
    key: "speed",
    label: "Speed",
    description: "How fast the head travels along the path — still in silence, faster the louder it gets",
    group: "Motion",
    family: "Pace",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    drive: { default: "feature.level" },
  },
  {
    key: "colourFlow",
    label: "Colour flow",
    description: "How fast the colours scroll through the stack while the shapes stay put",
    group: "Motion",
    family: "Pace",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.2,
    drive: { default: "feature.level" },
  },
  {
    key: "newPath",
    label: "New path",
    description: "Re-rolls the path every few grid ticks — right re-rolls more often, 0 keeps one path",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    drive: { default: { source: "beat", grid: 5 } },
  },
  {
    key: "path",
    label: "Path",
    description: "Which path the stack takes — the New path button picks another",
    group: "Motion",
    min: 0,
    max: 9999,
    step: 1,
    default: 1,
  },
  // Look
  {
    key: "palette",
    label: "Palette",
    description: "The colours — one set per piece of the series, or the app's own palette",
    group: "Look",
    family: "Colour",
    min: 0,
    max: PALETTES.length,
    step: 1,
    default: PALETTES.findIndex((p) => p.name === "Lilac"),
    type: "enum",
    options: [...PALETTES.map((p) => p.name), "Room"],
  },
  {
    key: "shift",
    label: "Shift",
    description: "Where on the palette the head starts — moving it rolls every copy's colour along",
    group: "Look",
    family: "Colour",
    min: 0,
    max: 1,
    step: 0.01,
    default: 0,
    drive: EMPTY,
  },
  {
    key: "bandCount",
    label: "Bands",
    description: "How many times the palette repeats from the head to the tail — left runs it backwards",
    group: "Look",
    family: "Colour",
    min: -8,
    max: 8,
    step: 0.05,
    default: 1.5,
    drive: EMPTY,
  },
  {
    key: "head",
    label: "Head",
    description: "How much the head copy takes the palette's own accent colour and stands solid",
    group: "Look",
    family: "Colour",
    min: 0,
    max: 1,
    step: 0.05,
    default: 1,
    drive: EMPTY,
  },
  {
    key: "rim",
    label: "Rim",
    description: "How far the colour shifts from each copy's edge toward its middle",
    group: "Look",
    family: "Colour",
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 0.3,
    drive: EMPTY,
  },
  {
    key: "opacity",
    label: "Opacity",
    description: "How solid each copy is — left shows the copies behind through it",
    group: "Look",
    family: "Edges",
    min: 0.05,
    max: 1,
    step: 0.05,
    default: 1,
    drive: EMPTY,
  },
  {
    key: "multiply",
    label: "Multiply",
    description: "Left the front stack paints over what's behind it, right it darkens it like ink — a Pair's overlap goes deeper than either",
    group: "Look",
    family: "Edges",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
    drive: EMPTY,
  },
  {
    key: "outline",
    label: "Outline",
    description: "How thick each copy's outline is — 0 draws fills only",
    group: "Look",
    family: "Edges",
    min: 0,
    max: 0.03,
    step: 0.001,
    default: 0.008,
    drive: EMPTY,
  },
  {
    key: "outlineStyle",
    label: "Outline style",
    description: "Ink: one dark line. Bevel: a dark line with a light band outside it. Alternate: dark and light copy by copy. Palette: the palette's opposite colour",
    group: "Look",
    family: "Edges",
    min: 0,
    max: OUTLINE_STYLES.length - 1,
    step: 1,
    default: OUTLINE_STYLES.indexOf("Bevel"),
    type: "enum",
    options: OUTLINE_STYLES,
  },
  {
    key: "blur",
    label: "Blur",
    description: "How soft the oldest copies get at the tail end",
    group: "Look",
    family: "Softness",
    min: 0,
    max: 0.6,
    step: 0.01,
    default: 0,
    drive: EMPTY,
  },
  {
    key: "fade",
    label: "Fade",
    description: "How far the oldest copies fade out at the tail end",
    group: "Look",
    family: "Softness",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
    drive: EMPTY,
  },
  {
    key: "steps",
    label: "Steps",
    description: "Draws the stack in flat horizontal steps — right makes the steps taller",
    group: "Look",
    family: "Softness",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
    drive: EMPTY,
  },
  {
    key: "sheen",
    label: "Sheen",
    description: "A colour shift across each copy, like light falling from one side",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
    drive: EMPTY,
    advanced: true,
  },
  {
    key: "faces",
    label: "Faces",
    description: "How differently lit a Cube's three faces are",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 1,
    drive: EMPTY,
    advanced: true,
  },
  {
    key: "outlineReach",
    label: "Outline reach",
    description: "How far down the stack the outlines stay — left only the head is outlined",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 1,
    drive: EMPTY,
    advanced: true,
  },
  {
    key: "headBlur",
    label: "Head blur",
    description: "How much of that softness reaches the head too",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
    drive: EMPTY,
    advanced: true,
  },
];

const BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));
function settingFor(key: string): SceneSetting {
  const s = BY_KEY.get(key);
  if (!s) throw new Error(`sweep: unknown setting ${key}`);
  return s;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

const DEG2RAD = Math.PI / 180;

let progress = progressFor(HEAD_START);
let phase = 0;
let ticks = 0;
let storedSeed = -1;
let localRolls = 0;
let roll: PathRoll = rollPath(1);
let lastTime: number | null = null;
const packed = new Float32Array(SW.LEN * 4);

function restartPath(seed: number): void {
  roll = rollPath(seed);
  progress = progressFor(HEAD_START);
}

const base = createFullscreenScene(ID, "Sweep", SWEEP_FRAG_BODY, {
  settings: SETTINGS,
  extraUniformDecls: SWEEP_UNIFORMS_GLSL,
  onInit() {
    storedSeed = -1;
    localRolls = 0;
    ticks = 0;
    phase = 0;
    lastTime = null;
  },
  extraUniforms(frame, anim, get, drives) {
    // Own delta from anim.timeSec rather than anim.dtSec: the gallery
    // preview hands render() an un-latched anim (same as coil/slats).
    const dt = lastTime === null ? 1 / 60 : Math.max(0, Math.min(0.25, anim.timeSec - lastTime));
    lastTime = anim.timeSec;

    const knob = (key: string): number => {
      const spec = settingFor(key);
      const v = get(key);
      if (!spec.drive) return v;
      return v + (spec.max - v) * LIFT * clamp01(drives.value(key, 0, 0));
    };

    // The path: the stored seed (the button), plus local re-rolls (the wire).
    const seed = Math.round(get("path"));
    if (seed !== storedSeed) {
      storedSeed = seed;
      localRolls = 0;
      ticks = 0;
      restartPath(seed);
    } else if (drives.fired("newPath", anim.metronomeBar)) {
      const every = newPathDivisor(get("newPath"), settingFor("newPath").default, NEW_PATH_GRID_DIVISOR);
      if (every > 0 && ++ticks >= every) {
        ticks = 0;
        localRolls++;
        restartPath(seed + 7919 * localRolls);
      }
    }

    progress += SPEED_GAIN * get("speed") * clamp01(drives.value("speed", frame.level, 0)) * dt;
    phase += FLOW_GAIN * get("colourFlow") * clamp01(drives.value("colourFlow", frame.level, 0)) * dt;
    phase -= Math.floor(phase);

    const k: Knobs = {
      shape: get("shape"),
      stretch: knob("stretch"),
      copies: knob("copies"),
      size: knob("size"),
      taper: knob("taper"),
      twist: knob("twist") * DEG2RAD,
      pair: get("pair") >= 0.5,
      travel: knob("travel"),
      bend: knob("bend"),
      aim: knob("aim"),
      spread: knob("spread"),
      trail: knob("trail"),
      palette: get("palette"),
      bands: knob("bandCount"),
      head: knob("head"),
      rim: knob("rim"),
      sheen: knob("sheen"),
      faces: knob("faces"),
      opacity: knob("opacity"),
      multiply: knob("multiply"),
      outline: knob("outline"),
      outlineStyle: get("outlineStyle"),
      outlineReach: knob("outlineReach"),
      blur: knob("blur"),
      headBlur: knob("headBlur"),
      fade: knob("fade"),
      steps: knob("steps"),
    };
    packFrame({ roll, head: headOf(progress), phase: phase + knob("shift") }, k, packed);
    return { uSw: { vec4: packed } };
  },
});

export const sweepScene: Scene = {
  ...base,
  panel: [{ widget: "sweepPath", title: "Path", settings: ["newPath", "path"] }],
};
