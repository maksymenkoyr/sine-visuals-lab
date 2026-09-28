// Coil -- Raup's shell-coiling rule (as in the author's "Museum of all
// Shells") turned into a fractal feedback loop: built from `/ref` on
// "Brush your teeth" by u/matigekunst (r/creativecoding, 2026-09-11, silent
// — tools/.cache/refs/brush-teeth/, docs/scenes/coil/scripts/measure_*.py).
// The picture is two mechanisms:
//
// 1. A recursive tiled background. Every frame is the previous frame
//    scaled by half, rotated 90 degrees, and tiled on a grid whose tile
//    centres sit at the quarter points -- so each tile shows what the whole
//    picture looked like one frame ago, and each of *those* tiles shows the
//    frame before that, and so on: the "fractal" look is nothing but a
//    ping-pong feedback loop read back at a fixed offset every frame. Each
//    generation fades toward the ground by glsl.ts's FEEDBACK_FADE, so the
//    recursion settles back to plain ground after the coil has filled a
//    frame. The tiling lives in screen space (the coil spins, the grid
//    doesn't). glsl.ts's buildSceneFrag background branch has the
//    tile-centre/rotation math; docs/scenes/coil.md's Measurements have
//    where each number came from.
// 2. The coil itself: nested copies of one silhouette G, each copy scaled
//    down and rotated relative to the next (coilMotion.ts's ShapeParams —
//    verm/lobeA/lobeB/wobble/twist), painted smallest-on-top. Per pixel,
//    glsl.ts's findVisibleCopy marches outward through the stack (a fixed
//    step count, then a bisection refine) to find the smallest copy that
//    contains that pixel; its own log-scale, offset by the flow phase F and
//    wrapped into one stripe period, picks the band colour off
//    paletteRamp — the measured red-sharp/blue-sharp two-stop ramp
//    (glsl.ts's own header has the hex sources).
//
// State split: everything about *where the coil's timers are* (flow phase
// F, outer log-size L/Ltarget, the reset morph, global spin) lives in
// coilMotion.ts as a pure, unit-tested module (tests/coil.test.ts) --
// stepCoil() takes plain numbers (already resolved from settings + drives
// down here) and returns the next CoilState, so none of that logic needs a
// GL context to test. This file is everything that DOES need one: the
// ping-pong render target pair, wiring settings/drives into stepCoil's
// inputs, and the two draw calls (glsl.ts's SCENE_FRAG into an offscreen
// target, then BLIT_FRAG copying it to the screen) -- a real two-pass
// scene, unlike most fullscreen scenes in this repo, because this frame's
// own output has to be sampled back as next frame's recursive background
// (see render() below for why that rules out createFullscreenScene).
//
// Sync mapping (drives, not fixed couplings -- see drives.ts's header):
// Flow (the flow-phase rate) reacts to the bass level by default -- the
// ref's own "toothpaste squeezed outward" is a continuous stream, so a
// level rather than a hit. Push shoves the flow forward on any hit -- a
// single instant jump layered on top of the continuous stream. Breathe
// (the partial fall-back) and New shape (the reset to a small fresh
// silhouette) both default to the beat grid rather than raw hits, since the
// reference's own breathing/reset cadence reads as periodic, not onset-
// triggered; New shape's own cadence is a grid tick further divided in JS
// (NEW_SHAPE_GRID_DIVISOR below) since src/audio/beatGrid.ts's coarsest
// stop is two bars, short of the reference's own measured reset spacing.
// Spin (global rotation) rides the treble level by default. Twist and
// Stripes are plain scales (how wound the coil is, how many bands fit one
// span) with nothing to react to; Colours blends toward the app's own
// palette the way Silk's own "App palette" tint does (silk/index.ts).
import { NUM_BANDS } from "../../../audio/types.ts";
import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../../gl.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import { resolveSceneSetting } from "../../autoTune.ts";
import type { Scene, SceneContext } from "../../scene.ts";
import { COMMON_UNIFORMS_GLSL, uploadCommonUniforms } from "../../sceneCommon.ts";
import { PASSTHROUGH_DRIVES } from "../../drives.ts";
import type { QualityPreset } from "../../quality.ts";
import { buildSceneFrag, BLIT_FRAG, GROUND_RGB } from "./glsl.ts";
import { createCoilState, stepCoil, type CoilState } from "./coilMotion.ts";

const ID = "coil";

// Offscreen render-target scale per quality preset -- the ping-pong pair is
// sized off the canvas (capped here) rather than a fixed grid the way
// petri.ts's sim is, because this scene's own output *is* the picture the
// next frame samples back, not a decoupled simulation lattice.
const TARGET_SCALE: Record<QualityPreset, number> = { high: 1, mid: 0.75, low: 0.55, floor: 0.4 };
const MAX_TARGET_DIM = 1400;

const DEG2RAD = Math.PI / 180;

// Flow-rate shaping (index.ts's own authored constants -- the reference is
// silent, so only the *streaming* look is measured, never a rate): floors
// so the paste never fully freezes even with Flow low and no bass, scales
// so Flow's own default plus a typical bass level land near the flow-phase
// header's ~0.5 e-fold/s.
const FLOW_FLOOR_PER_SEC = 0.15;
const FLOW_GAIN = 1.2;
const PUSH_JUMP_PER_UNIT = 0.35; // e-folds at Push = 1, a full-strength hit
const BREATHE_DROP_PER_UNIT = Math.log(1.6 / 0.45); // Breathe = 1 falls back from L_BIG to a ~0.45 half-height coil, the ref's part-way fall-backs
const SPIN_BASE_DEG_PER_SEC = 10; // matches the ref's measured global rotation at Spin = 1, no drive
const SPIN_DRIVE_DEG_PER_SEC = 10; // extra at a full-strength drive reading

// src/audio/beatGrid.ts's coarsest stop is two bars (BEAT_GRIDS' own
// "twoBars"); New shape's own reference cadence is close to four times
// that, so this file counts grid pulses itself rather than adding a scene-
// only grid stop nothing else could reuse.
const NEW_SHAPE_GRID_DIVISOR = 4;

const SETTINGS: SceneSetting[] = [
  // Form
  {
    key: "twist",
    label: "Twist",
    description: "How much each nested copy winds relative to the next — 0 leaves plain nested outlines, right winds them into a spiral",
    group: "Form",
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 1,
  },
  {
    key: "stripes",
    label: "Stripes",
    description: "Band density — right packs more red/white/blue rings into the same span",
    group: "Form",
    min: 0.4,
    max: 2.5,
    step: 0.05,
    default: 1,
  },
  // Motion
  {
    key: "flow",
    label: "Flow",
    description: "How fast the bands stream outward from the centre, like toothpaste being squeezed",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    drive: { default: "anim.low" },
  },
  {
    key: "push",
    label: "Push",
    description: "How far a hit shoves the flow forward in one jump, on top of the steady stream",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    drive: { default: "feature.onset" },
  },
  {
    key: "breathe",
    label: "Breathe",
    description: "How far the coil falls back before regrowing on the edge below — 0 leaves it growing without a fall-back",
    group: "Motion",
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 1,
    drive: { default: { source: "beat", grid: 5 } },
  },
  {
    key: "newShape",
    label: "New shape",
    description: "Resets to a small fresh silhouette every few grid ticks, peeling and spinning down over under a second — 0 turns resets off",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.8,
    drive: { default: { source: "beat", grid: 5 } },
  },
  // Look
  {
    key: "colours",
    label: "Colours",
    description: "How far the bands pull toward the app's own colour palette instead of the measured toothpaste red/white/blue",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
  },
  // Camera
  {
    key: "spin",
    label: "Spin",
    description: "How fast the whole picture rotates",
    group: "Camera",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    drive: { default: "anim.high" },
  },
];

function settingFor(key: string): SceneSetting {
  const s = SETTINGS.find((x) => x.key === key);
  if (!s) throw new Error(`coil: unknown setting ${key}`);
  return s;
}

const SCENE_FRAG = buildSceneFrag(SETTINGS, COMMON_UNIFORMS_GLSL);

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
}

function createCoilScene(): Scene {
  let sceneProg: GLProgram | null = null;
  let blitProg: GLProgram | null = null;
  let quadVao: WebGLVertexArrayObject | null = null;
  let scenePrevLoc: WebGLUniformLocation | null = null;
  let blitFrameLoc: WebGLUniformLocation | null = null;

  const targets: (Target | null)[] = [null, null];
  let targetW = 0;
  let targetH = 0;
  let read = 0;

  const bandsBuf = new Float32Array(NUM_BANDS);
  let state: CoilState = createCoilState();
  let lastTime: number | null = null;
  let newShapePulses = 0;

  function freeTargets(gl: WebGL2RenderingContext): void {
    for (const t of targets) {
      if (t) {
        gl.deleteFramebuffer(t.fbo);
        gl.deleteTexture(t.tex);
      }
    }
    targets[0] = null;
    targets[1] = null;
    targetW = 0;
    targetH = 0;
  }

  function makeTarget(gl: WebGL2RenderingContext, w: number, h: number): Target {
    const tex = gl.createTexture();
    if (!tex) throw new Error("coil: createTexture failed");
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    // Always mip-filtered (unlike petri's Beads-only toggle): the tiled
    // background is always a 2x minification onto itself (see glsl.ts's
    // header), every frame, at every quality.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error("coil: createFramebuffer failed");
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`coil: framebuffer incomplete (0x${status.toString(16)})`);
    }
    // Init/resize: clear to the ground colour, then seed a full mip chain
    // so the very first frame's background sample (LINEAR_MIPMAP_LINEAR at
    // lod 1.0 — see glsl.ts) doesn't hit an incomplete texture.
    gl.clearColor(GROUND_RGB[0], GROUND_RGB[1], GROUND_RGB[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.generateMipmap(gl.TEXTURE_2D);
    return { tex, fbo };
  }

  function ensureTargets(gl: WebGL2RenderingContext, preset: QualityPreset): void {
    const scale = TARGET_SCALE[preset];
    const w = Math.max(1, Math.min(MAX_TARGET_DIM, Math.round(gl.drawingBufferWidth * scale)));
    const h = Math.max(1, Math.min(MAX_TARGET_DIM, Math.round(gl.drawingBufferHeight * scale)));
    if (w === targetW && h === targetH && targets[0] && targets[1]) return;
    freeTargets(gl);
    targetW = w;
    targetH = h;
    targets[0] = makeTarget(gl, w, h);
    targets[1] = makeTarget(gl, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    read = 0;
  }

  return {
    id: ID,
    name: "Coil",
    settings: SETTINGS,

    init(ctx: SceneContext) {
      const { gl } = ctx;
      sceneProg = createProgram(gl, SCENE_FRAG);
      blitProg = createProgram(gl, BLIT_FRAG);
      scenePrevLoc = gl.getUniformLocation(sceneProg.program, "uPrevB");
      blitFrameLoc = gl.getUniformLocation(blitProg.program, "uFrame");
      quadVao = createFullscreenQuad(gl);
      freeTargets(gl);
      state = createCoilState();
      lastTime = null;
      newShapePulses = 0;
    },

    render(ctx, frame, viewport, palette, anim, drives = PASSTHROUGH_DRIVES) {
      if (!sceneProg || !blitProg || !quadVao) return;
      const { gl } = ctx;
      ensureTargets(gl, ctx.quality.preset);
      const a = targets[0];
      const b = targets[1];
      if (!a || !b) return;

      // Own delta from anim.timeSec rather than anim.dtSec: the gallery
      // preview hands render() an un-latched anim, same reasoning as
      // slats/ambience/powder/caustics.
      const dt = lastTime === null ? 1 / 60 : Math.max(0, Math.min(0.25, anim.timeSec - lastTime));
      lastTime = anim.timeSec;

      const flowAmount = resolveSceneSetting(ID, settingFor("flow"));
      const pushAmount = resolveSceneSetting(ID, settingFor("push"));
      const breatheAmount = resolveSceneSetting(ID, settingFor("breathe"));
      const newShapeAmount = resolveSceneSetting(ID, settingFor("newShape"));
      const spinAmount = resolveSceneSetting(ID, settingFor("spin"));
      const twistAmount = resolveSceneSetting(ID, settingFor("twist"));

      const flowLevel = drives.value("flow", anim.low);
      const flowRatePerSec = FLOW_FLOOR_PER_SEC + flowAmount * FLOW_GAIN * (0.3 + 0.7 * clamp01(flowLevel));

      const pushFired = drives.fired("push", anim.onset) && pushAmount > 0.02;
      const pushJump = pushAmount * PUSH_JUMP_PER_UNIT * drives.value("push", anim.beatPulse);

      const breatheGridFired = drives.fired("breathe", anim.onset) && breatheAmount > 0.02;

      // New shape's own reference cadence (~4x a two-bar grid tick — see
      // this file's header) divides the grid pulse itself down in JS,
      // since beatGrid.ts's own stops top out at two bars.
      let newShapeFired = false;
      if (newShapeAmount > 0.02 && drives.fired("newShape", anim.onset)) {
        newShapePulses++;
        if (newShapePulses >= NEW_SHAPE_GRID_DIVISOR) {
          newShapePulses = 0;
          newShapeFired = true;
        }
      }

      const spinLevel = drives.value("spin", anim.high);
      const spinRateDegPerSec = spinAmount * (SPIN_BASE_DEG_PER_SEC + SPIN_DRIVE_DEG_PER_SEC * spinLevel);

      state = stepCoil(state, {
        dt,
        flowRatePerSec,
        pushFired,
        pushJump,
        breatheFired: breatheGridFired,
        breatheDrop: BREATHE_DROP_PER_UNIT * breatheAmount,
        newShapeFired,
        spinRateDegPerSec,
      });

      const effectiveTwist = state.shape.twist * twistAmount;

      const write = 1 - read;
      const writeTarget = targets[write]!;
      const readTarget = targets[read]!;

      gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, writeTarget.fbo);
      gl.viewport(0, 0, targetW, targetH);
      sceneProg.use();
      uploadCommonUniforms(sceneProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf, drives);
      // Override to the offscreen target's own pixel size — this pass's
      // per-pixel math (lMin, aspect) needs the texture it's actually
      // writing, not the canvas uploadCommonUniforms assumed.
      sceneProg.setV2("uResolution", targetW, targetH);
      sceneProg.setF("uF", state.F);
      sceneProg.setF("uL", state.L);
      sceneProg.setF("uSpinAngle", state.spinDeg * DEG2RAD);
      sceneProg.setF("uShapeBaseAngle", state.shape.baseAngle);
      sceneProg.setF("uShapeVerm", state.shape.verm);
      sceneProg.setF("uShapeLobeA", state.shape.lobeA);
      sceneProg.setF("uShapeLobeB", state.shape.lobeB);
      sceneProg.setF("uShapeWobble", state.shape.wobble);
      sceneProg.setF("uShapeTwist", effectiveTwist);
      sceneProg.setF("uShapeArmsBlend", state.shape.armsBlend);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, readTarget.tex);
      gl.uniform1i(scenePrevLoc, 0);
      drawFullscreenQuad(gl, quadVao);

      // This frame's finished picture becomes next frame's "previous frame"
      // — generate its mip chain now while it's fresh (glsl.ts's header:
      // the tile sample is always a 2x minification).
      gl.bindTexture(gl.TEXTURE_2D, writeTarget.tex);
      gl.generateMipmap(gl.TEXTURE_2D);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      blitProg.use();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, writeTarget.tex);
      gl.uniform1i(blitFrameLoc, 0);
      drawFullscreenQuad(gl, quadVao);

      // The gallery renders every scene into one shared context each tick
      // — must not leak a bound texture onto the next scene's own draws.
      gl.bindTexture(gl.TEXTURE_2D, null);

      read = write;
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      freeTargets(gl);
      sceneProg?.dispose();
      blitProg?.dispose();
      if (quadVao) gl.deleteVertexArray(quadVao);
      sceneProg = null;
      blitProg = null;
      quadVao = null;
      scenePrevLoc = null;
      blitFrameLoc = null;
    },
  };
}

export const coilScene = createCoilScene();
