// Echoes — one regular outline (a circle, a polygon of a few corners, or a
// 3D or 4D wireframe figure from solids.ts, turned and projected flat)
// drawn into a feedback loop that a drifting noise field warps every frame,
// so the outline sheds a fan of evenly spaced echo lines that peel off along
// the flow, bunch into sheets where the flow stalls, and fade out. Built from
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
// The two passes (glsl.ts): STEP_FRAG writes one generation into the
// ping-pong pair's other half, DISPLAY_FRAG colours it onto the screen.
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
import { buildStepFrag, buildDisplayFrag } from "./glsl.ts";
import { MAX_SOLID_EDGES, projectSolid, SOLIDS, type SolidId } from "./solids.ts";

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
const DEG2RAD = Math.PI / 180;

const SETTINGS: SceneSetting[] = [
  // Form
  {
    key: "shape",
    label: "Shape",
    description:
      "The outline the echoes come from: a flat shape, a 3D solid, or a 4D shape (a tesseract is a 4D cube) turning through the fourth dimension",
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
    description: "How far each echo is pushed from the one before — right spreads the lines further apart",
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
  // One texel per projected edge (solids.ts): x1, y1, x2, y2.
  let edgeTex: WebGLTexture | null = null;
  let stepEdgesLoc: WebGLUniformLocation | null = null;
  const edgeBuf = new Float32Array(MAX_SOLID_EDGES * 4);

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
      stepEdgesLoc = gl.getUniformLocation(stepProg.program, "uEdges");
      quadVao = createFullscreenQuad(gl);
      edgeTex = gl.createTexture();
      if (!edgeTex) throw new Error("echoes: createTexture failed");
      gl.bindTexture(gl.TEXTURE_2D, edgeTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, MAX_SOLID_EDGES, 1, 0, gl.RGBA, gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.bindTexture(gl.TEXTURE_2D, null);
      freeTargets(gl);
      lastTime = null;
      angleDeg = 0;
      fieldPhase = 0;
      solidPhase = 0;
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
      const step = flow * STEP_PER_FLOW * (0.5 + flowReading);

      const pxHH = 2 / targetH;
      const stroke = Math.max(STROKE_HALF_HH, MIN_STROKE_PX * pxHH);
      const shapeSpec = SHAPES[Math.max(0, Math.min(SHAPES.length - 1, shape))];

      let edgeCount = 0;
      let bound = 0;
      if (shapeSpec.solid && edgeTex) {
        const { count, extent } = projectSolid(SOLIDS[shapeSpec.solid], solidPhase, radius, edgeBuf);
        edgeCount = count;
        bound = extent + 2 * stroke + 2 * pxHH;
        gl.bindTexture(gl.TEXTURE_2D, edgeTex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, MAX_SOLID_EDGES, 1, gl.RGBA, gl.FLOAT, edgeBuf);
      }

      const write = 1 - read;
      const writeTarget = targets[write]!;
      const readTarget = targets[read]!;

      gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, writeTarget.fbo);
      gl.viewport(0, 0, targetW, targetH);
      stepProg.use();
      uploadCommonUniforms(stepProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf, drives);
      stepProg.setV2("uResolution", targetW, targetH);
      stepProg.setF("uRadius", radius);
      stepProg.setF("uAngle", angleDeg * DEG2RAD);
      stepProg.setF("uCorners", shapeSpec.corners);
      stepProg.setF("uEdgeCount", edgeCount);
      stepProg.setF("uBound", bound);
      stepProg.setF("uStroke", stroke);
      stepProg.setF("uPx", pxHH);
      stepProg.setF("uStep", step);
      stepProg.setF("uFadeStep", fadeStep);
      stepProg.setF("uFieldFreq", FIELD_FREQ * detail);
      stepProg.setF("uFieldZ", wrapFlow(fieldPhase));
      stepProg.setV2("uFieldOffset", 3.7, 11.3);
      // Bound even for a flat shape, which never reads it, so the sampler
      // always has a complete texture behind it.
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, edgeTex);
      gl.uniform1i(stepEdgesLoc, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, readTarget.tex);
      gl.uniform1i(stepPrevLoc, 0);
      drawFullscreenQuad(gl, quadVao);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0);

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
      if (quadVao) gl.deleteVertexArray(quadVao);
      if (edgeTex) gl.deleteTexture(edgeTex);
      stepProg = null;
      displayProg = null;
      quadVao = null;
      edgeTex = null;
      stepPrevLoc = null;
      stepEdgesLoc = null;
      displayFrameLoc = null;
    },
  };
}

export const echoesScene = createEchoesScene();
