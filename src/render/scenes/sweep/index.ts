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
// packing a frame); glsl.ts is the per-pixel composite; pieces.ts holds the
// reel's pieces as knob values, the Presets row at the top of the Scene card
// (src/ui/widgets/presetPills.ts); this file turns settings and drives into
// stack.ts's Knobs each frame; src/ui/widgets/sweepPath.ts is the Path
// section (the New path trigger row and button).
//
// Drives (drives.ts's header). Every continuous knob has a jack. These start
// on a real wire:
// - Speed moves the head along its path by its level (Level — the input's
//   absolute loudness, 0 in a silent room, where the auto-gained levels lift
//   mic hiss): no signal, no movement.
// - Colour flow scrolls the palette through the stack by the same Level.
// - Morph moves every copy on through the shapes by Kick's decaying
//   pulse, so each kick pushes the shapes on and they coast between kicks.
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
import { createFullscreenScene } from "../../fullscreenScene.ts";
import { GROUP_TUNING } from "../../bandEnergy.ts";
import {
  HEAD_START,
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
import { card, SETTINGS } from "./card.ts";

/** Progress per second at Speed 1 with its drive reading 1. At a typical
 *  level of about half, the head is ~80 % along its path after one 120 bpm
 *  phrase (stack.ts's headOf). */
const SPEED_GAIN = 0.4;

/** Palette cycles per second at Colour flow 1 with its drive reading 1. */
const FLOW_GAIN = 0.5;

/** Shapes per second at Morph 1 with its drive reading 1: Kick's own
 *  pulse decay rate, so one full-height kick integrates to one shape. */
const MORPH_GAIN = GROUP_TUNING.low.pulseDecayRate;

/** Two-bar grid ticks per path at New path's default amount: a phrase. */
const NEW_PATH_GRID_DIVISOR = 2;

/** How far a full drive reading lifts a knob toward its right end. */
const LIFT = 0.5;

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
let morphPhase = 0;
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

const base = createFullscreenScene(card.id, card.name, SWEEP_FRAG_BODY, {
  settings: card.settings,
  panel: card.panel,
  extraUniformDecls: SWEEP_UNIFORMS_GLSL,
  onInit() {
    storedSeed = -1;
    localRolls = 0;
    ticks = 0;
    phase = 0;
    morphPhase = 0;
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
    const newPathFired = drives.fired("newPath", anim.metronomeBar);
    if (seed !== storedSeed) {
      storedSeed = seed;
      localRolls = 0;
      ticks = 0;
      restartPath(seed);
    } else if (newPathFired) {
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
    morphPhase += MORPH_GAIN * get("morph") * clamp01(drives.value("morph", anim.song.kickPulse, 0)) * dt;
    morphPhase %= SHAPES.length;

    const k: Knobs = {
      shape: get("shape"),
      shapeDrift: knob("shapeDrift"),
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
    packFrame({ roll, head: headOf(progress), phase: phase + knob("shift"), morph: morphPhase }, k, packed);
    return { uSw: { vec4: packed } };
  },
});

export const sweepScene: Scene = base;
