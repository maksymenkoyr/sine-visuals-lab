// Sweep — a shape swept along a curve, stamped as a trail of copies from
// where it started to where its head is now: each copy coloured a step
// further along an iridescent palette, outlined, and the oldest ones blurred
// and faded, on a light ground. Built from `/ref` on Fabio Catapano's
// "Colorem" generative series (r/creativecoding, a silent 20 s reel — bundle
// `colorem`, docs/scenes/sweep.md), measured piece by piece rather than
// copied: pieces.ts's RECIPES each come from one piece of the reel.
//
// Files: pieces.ts is the pure model (recipes, rolling a piece, the head's
// eased motion, packing the piece into the shader's one vec4 array);
// glsl.ts is the per-pixel front-to-back composite of every copy; this file
// resolves settings and drives into pieces.ts's inputs each frame.
//
// Sync mapping (drives, not fixed couplings — see drives.ts's header). The
// reel is silent and cuts to a new piece on a fixed 2 s timer, so nothing
// here is a measured sync; the mapping was the user's pick (record,
// Decisions):
// - New piece cuts to a fresh piece on a phrase. It defaults to the beat
//   grid's coarsest stop and counts NEW_PIECE_GRID_DIVISOR of its ticks per
//   piece in JS (beatGrid.ts has no phrase stop), the way coil's New shape
//   does. With no tempo locked the grid falls back to hits.
// - Speed moves the head along its path, scaled by its drive's level — so
//   the trail grows faster in loud passages and stands still in silence.
//   There is no floor: no signal, no movement.
// Copies, Trail, Size, Blur, Outlines and Colours are plain scales with
// nothing to react to; Look pins one recipe or mixes them all.
import type { SceneSetting } from "../../sceneSettings.ts";
import { createFullscreenScene } from "../../fullscreenScene.ts";
import { resolveSceneSetting } from "../../autoTune.ts";
import {
  RECIPES,
  SW,
  createRng,
  createSweepState,
  headOf,
  newPieceDivisor,
  packPiece,
  stepSweep,
  type SweepState,
} from "./pieces.ts";
import { SWEEP_FRAG_BODY, SWEEP_UNIFORMS_GLSL } from "./glsl.ts";

const ID = "sweep";

/** Progress per second at Speed 1 with its drive reading 1. At a typical
 *  level of about half, the head is ~80 % of the way along its path after
 *  one 120 bpm phrase (pieces.ts's headOf). */
const SPEED_GAIN = 0.4;

/** Two-bar grid ticks per piece at New piece's default amount: four bars,
 *  a phrase. */
const NEW_PIECE_GRID_DIVISOR = 2;

const SETTINGS: SceneSetting[] = [
  // Form
  {
    key: "look",
    label: "Look",
    description: "Which piece of the series to draw — Mix picks a different one each time",
    group: "Form",
    min: 0,
    max: RECIPES.length,
    step: 1,
    default: 0,
    type: "enum",
    options: ["Mix", ...RECIPES.map((r) => r.name)],
  },
  {
    key: "copies",
    label: "Copies",
    description: "How many copies the trail stamps — left shows them as separate outlines, right melts them into one smooth smear",
    group: "Form",
    min: 0.25,
    max: 2,
    step: 0.05,
    default: 1,
  },
  {
    key: "trail",
    label: "Trail",
    description: "How much of the path behind the head stays drawn — right keeps it all the way back to where the piece started",
    group: "Form",
    min: 0.1,
    max: 1,
    step: 0.05,
    default: 1,
  },
  {
    key: "size",
    label: "Size",
    description: "How large the whole piece is drawn",
    group: "Form",
    min: 0.5,
    max: 1.6,
    step: 0.05,
    default: 1,
  },
  // Motion
  {
    key: "speed",
    label: "Speed",
    description: "How fast the head travels along its path — still in silence, faster the louder it gets",
    group: "Motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    drive: { default: "anim.energy" },
  },
  {
    key: "newPiece",
    label: "New piece",
    description: "Cuts to a fresh piece every few grid ticks — right cuts more often, 0 keeps one piece",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    drive: { default: { source: "beat", grid: 5 } },
  },
  // Look
  {
    key: "blur",
    label: "Blur",
    description: "How soft the oldest copies get at the tail end",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
  },
  {
    key: "outlines",
    label: "Outlines",
    description: "How thick the copies' outlines are — 0 draws fills only",
    group: "Look",
    min: 0,
    max: 3,
    step: 0.05,
    default: 1,
  },
  {
    key: "colours",
    label: "Colours",
    description: "How far the copies pull toward the app's own palette instead of the series' colours",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
  },
];

function settingFor(key: string): SceneSetting {
  const s = SETTINGS.find((x) => x.key === key);
  if (!s) throw new Error(`sweep: unknown setting ${key}`);
  return s;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

let rng = createRng((Math.random() * 2 ** 32) >>> 0);
let state: SweepState = createSweepState(rng);
let lastTime: number | null = null;
const packed = new Float32Array(SW.LEN * 4);

export const sweepScene = createFullscreenScene(ID, "Sweep", SWEEP_FRAG_BODY, {
  settings: SETTINGS,
  extraUniformDecls: SWEEP_UNIFORMS_GLSL,
  onInit() {
    rng = createRng((Math.random() * 2 ** 32) >>> 0);
    state = createSweepState(rng, Math.round(resolveSceneSetting(ID, settingFor("look"))) - 1);
    lastTime = null;
  },
  extraUniforms(frame, anim, get, drives) {
    // Own delta from anim.timeSec rather than anim.dtSec: the gallery
    // preview hands render() an un-latched anim (same as coil/slats).
    const dt = lastTime === null ? 1 / 60 : Math.max(0, Math.min(0.25, anim.timeSec - lastTime));
    lastTime = anim.timeSec;

    const level = clamp01(drives.value("speed", frame.energy));
    const newPieceAmount = get("newPiece");
    state = stepSweep(
      state,
      {
        dt,
        rate: SPEED_GAIN * get("speed") * level,
        tick: drives.fired("newPiece", anim.metronomeBar),
        ticksPerPiece: newPieceDivisor(newPieceAmount, settingFor("newPiece").default, NEW_PIECE_GRID_DIVISOR),
        pick: Math.round(get("look")) - 1,
      },
      rng,
    );

    packPiece(
      state.piece,
      {
        head: headOf(state.progress),
        trail: get("trail"),
        copies: get("copies"),
        blur: get("blur"),
        outlines: get("outlines"),
      },
      packed,
    );
    return { uSw: { vec4: packed } };
  },
});
