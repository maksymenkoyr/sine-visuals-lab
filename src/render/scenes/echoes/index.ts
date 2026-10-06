// Echoes — one regular outline (a circle or a polygon of a few corners)
// drawn into a feedback loop that a drifting noise field warps every frame,
// so the outline sheds a fan of evenly spaced echo lines that peel off along
// the flow, bunch into sheets where the flow stalls, and fade out. A 3D or
// 4D wireframe figure instead leaves its echoes in its own space — pushed
// back into depth or through the fourth axis — built and drawn without the
// loop (solids.ts's header has why and how). Built from
// `/ref` on a live-coding set filmed at a venue (r/creativecoding, "Live
// coding generative visuals during our show"; bundle `livecode-wall`, the
// wall projection cropped out of the room) — docs/scenes/echoes.md has the
// reference, the measurements and what it syncs to.
//
// Why a feedback loop and not a drawn stack of copies: the echoes are what a
// loop like this converges to. With the field held still, generation k of
// the outline sits where k steps along the field carry it, every frame, so
// the fan is stationary; it moves only as the field drifts and the outline
// changes size or turns — which is how the reference moves (slow, continuous,
// no cuts). The loop also gives for free what a drawn stack would have to
// fake: echoes bunching into a filled sheet where the flow stalls, and old
// echoes softening as each generation is resampled. The step is a fixed
// distance per frame, not per second, so the picture is the same at any
// frame rate; only how quickly a change ripples down the fan follows it.
//
// The passes (glsl.ts): STEP_FRAG writes one generation into the ping-pong
// pair's other half — or, for a figure, SEGMENT_VERT/SEGMENT_FRAG draw its
// whole trail there fresh — and DISPLAY_FRAG colours it onto the screen.
//
// Sync mapping (drives, see drives.ts's header). The reference itself syncs
// to almost nothing — its size swings on a timer typed into the set's code,
// and its changes of shape are the performer typing — so each reaction here
// is a plain wire the user can move: Breathe swings the size once a bar
// (the reference's timer swung about once every three bars at its tempo),
// Kick pops it outward on a bass hit (a ripple that runs down the fan), and
// Flow spreads the echoes further apart as the mids get louder.
import { NUM_BANDS } from "../../../audio/types.ts";
import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../../gl.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import { resolveSceneSetting } from "../../autoTune.ts";
import type { Scene, SceneContext } from "../../scene.ts";
import { COMMON_UNIFORMS_GLSL, uploadCommonUniforms } from "../../sceneCommon.ts";
import { PASSTHROUGH_DRIVES } from "../../drives.ts";
import { wrapFlow } from "../../noiseHash.ts";
import type { QualityPreset } from "../../quality.ts";
import { buildStepFrag, buildDisplayFrag, SEGMENT_FRAG, SEGMENT_VERT } from "./glsl.ts";
import { buildTrail, MAX_SOLID_EDGES, orbitYaw, SEGMENT_FLOATS, SOLIDS, type SolidId } from "./solids.ts";

const ID = "echoes";

// Offscreen target scale per quality preset, capped — same reasoning as
// Coil's pair: this scene's own output is what the next frame samples.
const TARGET_SCALE: Record<QualityPreset, number> = { high: 1, mid: 0.75, low: 0.6, floor: 0.45 };
const MAX_TARGET_DIM = 1600;

/** What each Shape chip draws, in chip order: a flat outline by corner
 *  count (0 is a circle), or a 3D/4D figure from solids.ts. New entries go
 *  at the end — a saved look stores the chip's index. */
const SHAPES: readonly { name: string; corners: number; solid?: SolidId }[] = [
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
];

/** Half the line's width, in half-heights — the reference's outline against
 *  its circle's radius (docs/scenes/echoes.md). Never thinner than
 *  MIN_STROKE_PX target pixels, or the loop's resampling would wash it out. */
const STROKE_HALF_HH = 0.004;
const MIN_STROKE_PX = 0.75;

/** How far one generation moves along the field at Flow = 1 and a mid level
 *  reading of 0.5, in half-heights per unit of field. At the default Flow
 *  the typical step lands on the reference's echo spacing (Measurements). */
const STEP_PER_FLOW = 0.28;
/** Noise cells per half-height at Detail = 1 — fine enough that the field
 *  turns across an outline of Size's default, so each part of it peels off
 *  its own way. Half this drew every echo as the same circle shifted: a
 *  tube, not the reference's fans. */
const FIELD_FREQ = 2.2;
/** Drift phase per second at Drift = 1, in noise cells. */
const DRIFT_PER_SEC = 0.5;
// A 3D/4D figure's trail (solids.ts): how far each echo moves from the one
// before at Flow = 1 and a mid reading of 0.5, in circumradii; the flow's
// waves per circumradius at Detail = 1; and how fast the flow changes per
// unit of the drift phase the flat shapes' noise also runs on.
const TRAIL_STEP_PER_FLOW = 0.45;
const TRAIL_FREQ = 1.2;
const TRAIL_TIME_PER_PHASE = 3;
const DEG2RAD = Math.PI / 180;

const SETTINGS: SceneSetting[] = [
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
    drive: { default: "anim.lowOnset" },
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
];

function settingFor(key: string): SceneSetting {
  const s = SETTINGS.find((x) => x.key === key);
  if (!s) throw new Error(`echoes: unknown setting ${key}`);
  return s;
}

/** The most echoes a figure's trail can have (the Echoes setting's own
 *  max), and how many frames of the figure's turn and size are kept for it. */
const MAX_ECHOES = settingFor("echoes").max;
const HISTORY_FRAMES = MAX_ECHOES + 1;

const STEP_FRAG = buildStepFrag(SETTINGS, COMMON_UNIFORMS_GLSL);
const DISPLAY_FRAG = buildDisplayFrag(SETTINGS, COMMON_UNIFORMS_GLSL);

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
}

function createEchoesScene(): Scene {
  let stepProg: GLProgram | null = null;
  let displayProg: GLProgram | null = null;
  let quadVao: WebGLVertexArrayObject | null = null;
  let stepPrevLoc: WebGLUniformLocation | null = null;
  let displayFrameLoc: WebGLUniformLocation | null = null;

  const targets: (Target | null)[] = [null, null];
  let targetW = 0;
  let targetH = 0;
  let read = 0;

  const bandsBuf = new Float32Array(NUM_BANDS);
  let lastTime: number | null = null;
  let angleDeg = 0;
  let fieldPhase = 0;
  // A 3D/4D figure's turn phase, in radians and never wrapped: solids.ts
  // turns each plane at a different multiple of it, so wrapping it would
  // jump every plane but the first.
  let solidPhase = 0;
  // The figure's turn phase and size over the last HISTORY_FRAMES frames,
  // newest at `historyHead` — echo k of a figure's trail is the figure as it
  // was k frames ago (solids.ts's buildTrail), so a Kick pop ripples down
  // the trail the way it runs down a flat shape's echoes.
  const phaseHistory = new Float64Array(HISTORY_FRAMES);
  const radiusHistory = new Float64Array(HISTORY_FRAMES);
  let historyHead = 0;
  let historyLen = 0;
  // The trail's segments for the segment pass, and the instanced VAO that
  // reads them (a static quad corner buffer plus this, per instance).
  const segBuf = new Float32Array(MAX_SOLID_EDGES * MAX_ECHOES * SEGMENT_FLOATS);
  let segProg: GLProgram | null = null;
  let segVao: WebGLVertexArrayObject | null = null;
  let segCornerVbo: WebGLBuffer | null = null;
  let segInstVbo: WebGLBuffer | null = null;

  function historyAt(buf: Float64Array, k: number): number {
    const back = Math.min(k, Math.max(historyLen - 1, 0));
    return buf[(historyHead - back + HISTORY_FRAMES) % HISTORY_FRAMES];
  }

  function createSegmentVao(gl: WebGL2RenderingContext): void {
    segVao = gl.createVertexArray();
    segCornerVbo = gl.createBuffer();
    segInstVbo = gl.createBuffer();
    if (!segVao || !segCornerVbo || !segInstVbo) throw new Error("echoes: segment buffers failed");
    gl.bindVertexArray(segVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, segCornerVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, segInstVbo);
    gl.bufferData(gl.ARRAY_BUFFER, segBuf.byteLength, gl.DYNAMIC_DRAW);
    const stride = SEGMENT_FLOATS * 4;
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

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
    if (!tex) throw new Error("echoes: createTexture failed");
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error("echoes: createFramebuffer failed");
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`echoes: framebuffer incomplete (0x${status.toString(16)})`);
    }
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, fbo };
  }

  function ensureTargets(gl: WebGL2RenderingContext, preset: QualityPreset): void {
    const scale = TARGET_SCALE[preset];
    const big = Math.max(gl.drawingBufferWidth, gl.drawingBufferHeight) * scale;
    const fit = big > MAX_TARGET_DIM ? MAX_TARGET_DIM / big : 1;
    const w = Math.max(1, Math.round(gl.drawingBufferWidth * scale * fit));
    const h = Math.max(1, Math.round(gl.drawingBufferHeight * scale * fit));
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
    name: "Echoes",
    settings: SETTINGS,

    init(ctx: SceneContext) {
      const { gl } = ctx;
      stepProg = createProgram(gl, STEP_FRAG);
      displayProg = createProgram(gl, DISPLAY_FRAG);
      stepPrevLoc = gl.getUniformLocation(stepProg.program, "uPrev");
      displayFrameLoc = gl.getUniformLocation(displayProg.program, "uFrame");
      segProg = createProgram(gl, SEGMENT_FRAG, SEGMENT_VERT);
      quadVao = createFullscreenQuad(gl);
      createSegmentVao(gl);
      freeTargets(gl);
      lastTime = null;
      angleDeg = 0;
      fieldPhase = 0;
      solidPhase = 0;
      historyHead = 0;
      historyLen = 0;
    },

    render(ctx, frame, viewport, palette, anim, drives = PASSTHROUGH_DRIVES) {
      if (!stepProg || !displayProg || !quadVao) return;
      const { gl } = ctx;
      ensureTargets(gl, ctx.quality.preset);
      if (!targets[0] || !targets[1]) return;

      // Own delta from anim.timeSec, not anim.dtSec: the gallery preview
      // hands render() an un-latched anim (same as Coil).
      const dt = lastTime === null ? 1 / 60 : Math.max(0, Math.min(0.25, anim.timeSec - lastTime));
      lastTime = anim.timeSec;

      const shape = Math.round(resolveSceneSetting(ID, settingFor("shape")));
      const size = resolveSceneSetting(ID, settingFor("size"));
      const echoes = resolveSceneSetting(ID, settingFor("echoes"));
      const detail = resolveSceneSetting(ID, settingFor("flowDetail"));
      const flow = resolveSceneSetting(ID, settingFor("flow"));
      const drift = resolveSceneSetting(ID, settingFor("drift"));
      const breathe = resolveSceneSetting(ID, settingFor("breathe"));
      const kick = resolveSceneSetting(ID, settingFor("kick"));
      const spin = resolveSceneSetting(ID, settingFor("spin"));

      // Nothing plugged in reads as the wire's own resting value: no swing,
      // no pop, and Flow as if the mids sat at their middle.
      const wave = drives.value("breathe", 0, 0);
      const pop = drives.value("kick", 0, 0);
      const flowReading = drives.value("flow", 0.5, 0.5);

      const radius = size * (1 + breathe * wave + kick * pop);
      angleDeg = (angleDeg + spin * dt) % 360;
      solidPhase += spin * DEG2RAD * dt;
      fieldPhase += drift * DRIFT_PER_SEC * dt;
      const fadeStep = 1 / Math.max(echoes, 1);
      const flowAmount = flow * (0.5 + flowReading);

      historyHead = (historyHead + 1) % HISTORY_FRAMES;
      historyLen = Math.min(historyLen + 1, HISTORY_FRAMES);
      phaseHistory[historyHead] = solidPhase;
      radiusHistory[historyHead] = radius;

      const pxHH = 2 / targetH;
      const stroke = Math.max(STROKE_HALF_HH, MIN_STROKE_PX * pxHH);
      const shapeSpec = SHAPES[Math.max(0, Math.min(SHAPES.length - 1, shape))];

      const write = 1 - read;
      const writeTarget = targets[write]!;
      const readTarget = targets[read]!;

      gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, writeTarget.fbo);
      gl.viewport(0, 0, targetW, targetH);

      if (shapeSpec.solid && segProg && segVao && segInstVbo) {
        // A figure's echoes live in its own space (solids.ts's header): the
        // whole trail is rebuilt each frame and drawn fresh, no feedback.
        const count = buildTrail(
          SOLIDS[shapeSpec.solid],
          {
            echoes: Math.max(1, Math.min(MAX_ECHOES, Math.round(echoes))),
            step: flowAmount * TRAIL_STEP_PER_FLOW,
            freq: TRAIL_FREQ * detail,
            time: fieldPhase * TRAIL_TIME_PER_PHASE,
            yaw: orbitYaw(solidPhase),
            radius,
            phaseAt: (k) => historyAt(phaseHistory, k),
            radiusAt: (k) => historyAt(radiusHistory, k),
          },
          segBuf,
        );
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.BLEND);
        gl.blendEquation(gl.MAX);
        segProg.use();
        segProg.setV4("uViewport", viewport.x, viewport.y, viewport.w, viewport.h);
        segProg.setF("uAspect", targetW / targetH);
        segProg.setF("uStroke", stroke);
        segProg.setF("uPx", pxHH);
        gl.bindVertexArray(segVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, segInstVbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, segBuf, 0, count * SEGMENT_FLOATS);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        // Back to the defaults the gallery's other scenes expect.
        gl.blendEquation(gl.FUNC_ADD);
        gl.disable(gl.BLEND);
      } else {
        stepProg.use();
        uploadCommonUniforms(stepProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf, drives);
        stepProg.setV2("uResolution", targetW, targetH);
        stepProg.setF("uRadius", radius);
        stepProg.setF("uAngle", angleDeg * DEG2RAD);
        stepProg.setF("uCorners", shapeSpec.corners);
        stepProg.setF("uStroke", stroke);
        stepProg.setF("uPx", pxHH);
        stepProg.setF("uStep", flowAmount * STEP_PER_FLOW);
        stepProg.setF("uFadeStep", fadeStep);
        stepProg.setF("uFieldFreq", FIELD_FREQ * detail);
        stepProg.setF("uFieldZ", wrapFlow(fieldPhase));
        stepProg.setV2("uFieldOffset", 3.7, 11.3);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, readTarget.tex);
        gl.uniform1i(stepPrevLoc, 0);
        drawFullscreenQuad(gl, quadVao);
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      displayProg.use();
      uploadCommonUniforms(displayProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf, drives);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, writeTarget.tex);
      gl.uniform1i(displayFrameLoc, 0);
      drawFullscreenQuad(gl, quadVao);

      // The gallery renders every scene into one shared context each tick —
      // don't leak a bound texture onto the next scene's draws.
      gl.bindTexture(gl.TEXTURE_2D, null);

      read = write;
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      freeTargets(gl);
      stepProg?.dispose();
      displayProg?.dispose();
      segProg?.dispose();
      if (quadVao) gl.deleteVertexArray(quadVao);
      if (segVao) gl.deleteVertexArray(segVao);
      if (segCornerVbo) gl.deleteBuffer(segCornerVbo);
      if (segInstVbo) gl.deleteBuffer(segInstVbo);
      stepProg = null;
      displayProg = null;
      segProg = null;
      quadVao = null;
      segVao = null;
      segCornerVbo = null;
      segInstVbo = null;
      stepPrevLoc = null;
      displayFrameLoc = null;
    },
  };
}

export const echoesScene = createEchoesScene();
