import type { Scene, SceneContext, Viewport } from "../../scene.ts";
import type { FeatureFrame } from "../../../audio/types.ts";
import { NUM_BANDS } from "../../../audio/types.ts";
import type { Palette } from "../../palette.ts";
import type { AnimFrame } from "../../animClock.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import type { SignalLink } from "../../signals.ts";
import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../../gl.ts";
import {
  COMMON_UNIFORMS_GLSL,
  ROOM_UV_GLSL,
  settingUniformName,
  uploadCommonUniforms,
} from "../../sceneCommon.ts";
import { resolveSceneSetting } from "../../autoTune.ts";
import { buildLook, LOOKS, objectCountFor, SEG_MAX, type LookLayout } from "./layout.ts";
import {
  BLUR_FRAG,
  BLUR_STRIDE,
  CAMERA_GLSL,
  COMPOSITE_BODY,
  GATE_FRAG_BODY,
  GATE_VERT_BODY,
} from "./glsl.ts";

// A tunnel of neon wireframe gates — hexagonal prisms, box frames, rods
// and panels pointed at the vanishing point — mirrored across the screen
// axes, spinning, flying past the camera with motion blur and bloom, after
// the VJ loop 4PsXO3JsQdg ("Neon Groove Vibes"). Real 3D geometry this
// time: the reference was measured (tools/reflook.py, "Picture, measured"
// in tools/.cache/refs/neon-groove/report.md) and the numbers overturned
// the first, flat draft — the tunnel spins at the rate SPIN_RAD_MAX gives
// at the default Spin in every regime and never reverses; the camera flies
// *backward* in most looks (LOOKS[].dir); the hexagons are prisms seen
// with depth; strokes are a couple of pixels at the centre and several at
// the edge; each look is two hues plus an accent with a bloom-tinted
// ground. layout.ts holds those looks as data, glsl.ts owns the picture.
//
// What the reference does with the music: nothing — it is silent by design
// and a short loop repeated for hours, its hard cuts between looks landing
// on a fixed timer with one blackout frame per loop. So the cuts here are
// ours: on bar boundaries (a wrap of anim.barPhase, the ambience.ts
// precedent) with the odds set by Cut rate, plus half-bar cuts once Cut
// rate is high, never the same look twice in a row; a blackout frame then
// a cut on every BARS_PER_PHRASE-th bar and on a drop (anim.dropOnset);
// a free-running bar timer while there is no tempo lock, because barPhase
// freezes without a tempo and a silent room would otherwise never cut.
// The fly speed rides the low band and an onset flashes the nearest gates.
// Rates scale, positions accumulate (travel, spin) — the flowClock lesson.
//
// Rendering: the gates draw additively into a full-resolution RGBA8 target
// (no float targets — chladni.ts's TV constraint), two blur levels at a
// quarter and an eighth of that size make the bloom, and the composite adds
// the ground, the sharp gates and the bloom through a knee. The targets are
// rebuilt when the drawing buffer changes size, since the quality governor
// moves renderScale at runtime. Bloom levels follow quality.bloomPasses.
//
// The scheduler (advanceGates) is pure and exported for tests/gates.test.ts;
// the scene keeps one instance in its closure.

const ID = "gates";

/** Looks the cut cycles through — the entries of LOOKS. */
export const LOOK_COUNT = LOOKS.length;
/** Every this-many bars: a blackout frame, then the cut. */
export const BARS_PER_PHRASE = 4;
/** Bar length while there is no tempo lock (a 120 bpm bar). */
export const FREE_BAR_SEC = 2.0;
/** Half-bar cuts start once Cut rate passes this, scaled by the gain. */
const HALF_BAR_CUT_FROM = 0.4;
const HALF_BAR_CUT_GAIN = 1.5;
/** Fly speed in world units per second at Speed 0 and 1, and the extra
 *  factor the low band adds. Each look scales it further (LOOKS[].speed). */
const FLY_MIN = 0.6;
const FLY_MAX = 4.0;
const FLY_BASS_GAIN = 0.8;
/** Spin in radians per second at Spin = 1 — the default Spin lands on the
 *  reference's measured rate. Counter-clockwise on screen, never reversed. */
export const SPIN_RAD_MAX = 1.8;
/** Onset flash: the jump per onset, its cap, and its decay per second. */
const FLASH_HIT = 1.0;
const FLASH_CAP = 1.5;
const FLASH_DECAY = 5.0;
/** Shutter length in seconds at Streaks = 1: how far a gate smears. */
const SHUTTER_MAX = 0.09;
/** Mirror copies per Symmetry option (the enum index picks one). */
const COPIES_BY_SYMMETRY = [2, 4, 8];

export interface GateState {
  /** Which look the tunnel is showing. */
  look: number;
  /** Bumped on every cut; reseeds the look's layout. */
  cutSeed: number;
  /** Bar boundaries seen so far. */
  bars: number;
  lastBarPhase: number;
  /** Free-running bar clock while there is no tempo lock. */
  freeTimer: number;
  /** This frame is black; the pending cut lands on the frame after it. */
  blackFrame: 0 | 1;
  pendingCut: boolean;
  flash: number;
  /** Fly direction of the current look: +1 toward the camera, -1 away. */
  dir: 1 | -1;
  /** Accumulated travel in world units (signed by dir), and spin in radians. */
  travel: number;
  spinPos: number;
  /** Last frame's fly speed (world units/s, unsigned) and spin rate. */
  flyRate: number;
  spinRate: number;
  prevDrop: boolean;
}

export function createGateState(): GateState {
  return {
    look: 0,
    cutSeed: 0,
    bars: 0,
    lastBarPhase: 0,
    freeTimer: 0,
    blackFrame: 0,
    pendingCut: false,
    flash: 0,
    dir: LOOKS[0].dir,
    travel: 0,
    spinPos: 0,
    flyRate: FLY_MIN,
    spinRate: 0,
    prevDrop: false,
  };
}

/** The slice of AnimFrame the scheduler reads — tests build just this. */
export type GateAnim = Pick<AnimFrame, "dtSec" | "barPhase" | "tempoLock" | "onset" | "dropOnset" | "low">;

export interface GateOpts {
  speed: number;
  cutRate: number;
  spin: number;
  blackouts: boolean;
}

/** A look other than `prev`, uniform over the rest. */
export function pickLook(prev: number, rng: () => number): number {
  return (prev + 1 + Math.floor(rng() * (LOOK_COUNT - 1))) % LOOK_COUNT;
}

/** Advances the scheduler by one rendered frame, in place. */
export function advanceGates(st: GateState, anim: GateAnim, opts: GateOpts, rng: () => number = Math.random): void {
  const dt = Number.isFinite(anim.dtSec) ? Math.max(0, anim.dtSec) : 0;

  const cut = () => {
    st.look = pickLook(st.look, rng);
    st.cutSeed += 1;
    st.dir = LOOKS[st.look].dir;
  };
  const blackoutThenCut = () => {
    if (opts.blackouts) {
      st.blackFrame = 1;
      st.pendingCut = true;
    } else {
      cut();
    }
  };

  // Last frame was black: the cut it announced lands now.
  if (st.blackFrame) {
    st.blackFrame = 0;
    if (st.pendingCut) {
      cut();
      st.pendingCut = false;
    }
  }

  let boundary = false;
  let half = false;
  if (anim.tempoLock > 0.5) {
    boundary = anim.barPhase < st.lastBarPhase - 0.5;
    half = st.lastBarPhase < 0.5 && anim.barPhase >= 0.5;
    st.freeTimer = 0;
  } else {
    st.freeTimer += dt;
    if (st.freeTimer >= FREE_BAR_SEC) {
      boundary = true;
      st.freeTimer = 0;
    }
  }
  st.lastBarPhase = anim.barPhase;

  if (boundary) {
    st.bars += 1;
    if (st.bars % BARS_PER_PHRASE === 0) blackoutThenCut();
    else if (rng() < opts.cutRate) cut();
  } else if (half && rng() < Math.max(0, opts.cutRate - HALF_BAR_CUT_FROM) * HALF_BAR_CUT_GAIN) {
    cut();
  }

  const drop = anim.dropOnset && !st.prevDrop;
  st.prevDrop = anim.dropOnset;
  if (drop) blackoutThenCut();

  if (anim.onset) st.flash = Math.min(FLASH_CAP, st.flash + FLASH_HIT);
  st.flash *= Math.exp(-dt * FLASH_DECAY);

  st.flyRate = (FLY_MIN + (FLY_MAX - FLY_MIN) * opts.speed) * (1 + FLY_BASS_GAIN * anim.low) * LOOKS[st.look].speed;
  st.spinRate = SPIN_RAD_MAX * opts.spin;
  st.travel += st.dir * st.flyRate * dt;
  st.spinPos += st.spinRate * dt;
}

const SETTINGS: SceneSetting[] = [
  {
    key: "symmetry",
    label: "Symmetry",
    description: "How many mirror copies of each gate the tunnel shows — across one axis, both axes, or both plus the diagonals",
    group: "Form",
    type: "enum",
    options: ["2", "4", "8"],
    min: 0,
    max: 2,
    step: 1,
    default: 1,
    // Framing the user picks to taste, like Kaleidoscope's Symmetry.
  },
  {
    key: "density",
    label: "Gate density",
    description: "How many gates are in the tunnel at once — a few big ones at the low end, a crowded corridor at the high end",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { density: 0.3 },
  },
  {
    key: "shapeMix",
    label: "Shape mix",
    description: "Prisms and frames at the low end, rods and panels at the high end; the middle keeps each look's own mix",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
  },
  {
    key: "speed",
    label: "Speed",
    description: "How fast the camera flies through the tunnel; the bass pushes it further",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { tempo: 0.35, loudness: 0.15 },
  },
  {
    key: "cutRate",
    label: "Cut rate",
    description: "How often a bar boundary hard-cuts to another look; past the middle, half-bars can cut too. Every fourth bar and every drop cut regardless",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { pulse: 0.3, dynamics: 0.2 },
    reads: ["anim.dropOnset"] satisfies readonly SignalLink[],
  },
  {
    key: "spin",
    label: "Spin",
    description: "How fast the tunnel turns, always the same way round",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
    auto: { tempo: 0.2 },
  },
  {
    key: "streaks",
    label: "Streaks",
    description: "How long the shutter stays open — the motion blur that smears the gates as they fly and turn",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { loudness: 0.25 },
  },
  {
    key: "glow",
    label: "Glow",
    description: "How bright the neon burns and how far its bloom spreads; a beat flashes the nearest gates",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { brightness: 0.2, loudness: 0.2 },
    reads: ["feature.onset"] satisfies readonly SignalLink[],
  },
  {
    key: "blackouts",
    label: "Blackouts",
    description: "A single black frame before the cut on every fourth bar and on a drop, the way the reference loop drops out",
    group: "Look",
    type: "boolean",
    min: 0,
    max: 1,
    step: 1,
    default: 1,
    reads: ["anim.dropOnset"] satisfies readonly SignalLink[],
  },
];

const SETTING_BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));
const SETTINGS_UNIFORMS_GLSL = SETTINGS.map((s) => `uniform float ${settingUniformName(s.key)};`).join("\n");

const GATE_VERT = `#version 300 es
precision highp float;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
${CAMERA_GLSL}
${GATE_VERT_BODY}
`;

const GATE_FRAG = `#version 300 es
precision highp float;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${GATE_FRAG_BODY}
`;

const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
${ROOM_UV_GLSL}
${CAMERA_GLSL}
${COMPOSITE_BODY}
`;

export const gatesScene: Scene = (() => {
  let gateProg: GLProgram | null = null;
  let blurProg: GLProgram | null = null;
  let compProg: GLProgram | null = null;
  let quadVao: WebGLVertexArrayObject | null = null;
  let emptyVao: WebGLVertexArrayObject | null = null;
  const intLocs = new Map<string, WebGLUniformLocation | null>();

  // Render targets: the sharp gates at full size, two blur levels below it.
  let sharpTex: WebGLTexture | null = null;
  let sharpFbo: WebGLFramebuffer | null = null;
  const levelTex: (WebGLTexture | null)[] = [null, null, null, null];
  const levelFbo: (WebGLFramebuffer | null)[] = [null, null, null, null];
  let sharpW = 0;
  let sharpH = 0;
  const levelW = [0, 0];
  const levelH = [0, 0];

  const st = createGateState();
  let layout: LookLayout | null = null;
  let layoutKey = "";
  const bandsBuf = new Float32Array(NUM_BANDS);

  const get = (key: string): number => resolveSceneSetting(ID, SETTING_BY_KEY.get(key)!);

  function intLoc(gl: WebGL2RenderingContext, prog: GLProgram, tag: string, name: string): WebGLUniformLocation | null {
    const k = `${tag}.${name}`;
    if (!intLocs.has(k)) intLocs.set(k, gl.getUniformLocation(prog.program, name));
    return intLocs.get(k) ?? null;
  }

  function makeTexture(gl: WebGL2RenderingContext, w: number, h: number): WebGLTexture | null {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  function attachColour(gl: WebGL2RenderingContext, tex: WebGLTexture | null): WebGLFramebuffer | null {
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`gates: framebuffer incomplete (0x${status.toString(16)})`);
    }
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return f;
  }

  function freeTargets(gl: WebGL2RenderingContext): void {
    if (sharpFbo) gl.deleteFramebuffer(sharpFbo);
    if (sharpTex) gl.deleteTexture(sharpTex);
    sharpFbo = null;
    sharpTex = null;
    for (let i = 0; i < 4; i++) {
      if (levelFbo[i]) gl.deleteFramebuffer(levelFbo[i]);
      if (levelTex[i]) gl.deleteTexture(levelTex[i]);
      levelFbo[i] = null;
      levelTex[i] = null;
    }
    sharpW = 0;
    sharpH = 0;
  }

  /** Rebuilds the targets when the drawing buffer changes size. */
  function ensureTargets(gl: WebGL2RenderingContext): void {
    const w = Math.max(1, gl.drawingBufferWidth);
    const h = Math.max(1, gl.drawingBufferHeight);
    if (w === sharpW && h === sharpH && sharpFbo) return;
    freeTargets(gl);
    sharpTex = makeTexture(gl, w, h);
    sharpFbo = attachColour(gl, sharpTex);
    for (let level = 0; level < 2; level++) {
      const shift = level + 2;
      levelW[level] = Math.max(1, w >> shift);
      levelH[level] = Math.max(1, h >> shift);
      for (let j = 0; j < 2; j++) {
        const i = level * 2 + j;
        levelTex[i] = makeTexture(gl, levelW[level], levelH[level]);
        levelFbo[i] = attachColour(gl, levelTex[i]);
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    sharpW = w;
    sharpH = h;
  }

  /** One separable blur: src -> level's A (horizontal) -> level's B. */
  function blurLevel(gl: WebGL2RenderingContext, level: number, src: WebGLTexture | null): void {
    const prog = blurProg!;
    const w = levelW[level];
    const h = levelH[level];
    gl.viewport(0, 0, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, levelFbo[level * 2]);
    gl.bindTexture(gl.TEXTURE_2D, src);
    prog.setV2("uBlurStep", BLUR_STRIDE / w, 0);
    drawFullscreenQuad(gl, quadVao!);
    gl.bindFramebuffer(gl.FRAMEBUFFER, levelFbo[level * 2 + 1]);
    gl.bindTexture(gl.TEXTURE_2D, levelTex[level * 2]);
    prog.setV2("uBlurStep", 0, BLUR_STRIDE / h);
    drawFullscreenQuad(gl, quadVao!);
  }

  return {
    id: ID,
    name: "Neon Gates",
    minQuality: "low",
    settings: SETTINGS,

    init(ctx: SceneContext) {
      const { gl } = ctx;
      gateProg = createProgram(gl, GATE_FRAG, GATE_VERT);
      blurProg = createProgram(gl, BLUR_FRAG);
      compProg = createProgram(gl, COMPOSITE_FRAG);
      intLocs.clear();
      quadVao = createFullscreenQuad(gl);
      // The gate pass has no vertex attributes — corner from gl_VertexID,
      // (object, copy, segment) from gl_InstanceID — so it draws from an
      // empty VAO (ambience.ts's precedent).
      emptyVao = gl.createVertexArray();
      ensureTargets(gl);
      layout = null;
      layoutKey = "";
    },

    render(ctx: SceneContext, frame: FeatureFrame, viewport: Viewport, palette: Palette, anim: AnimFrame) {
      const { gl } = ctx;
      if (!gateProg || !blurProg || !compProg || !quadVao || !emptyVao) return;
      ensureTargets(gl);

      // anim.onset / anim.dropOnset, not frame.onset: the render cap can skip
      // the tick the feature fired on (renderLatch.ts).
      const speed = get("speed");
      const spin = get("spin");
      advanceGates(st, anim, {
        speed,
        cutRate: get("cutRate"),
        spin,
        blackouts: get("blackouts") > 0.5,
      });
      const look = LOOKS[st.look];
      const density = get("density");
      const shapeMix = get("shapeMix");
      const count = objectCountFor(st.look, density, ctx.quality.detail);
      const key = `${st.look}:${st.cutSeed}:${count}:${shapeMix.toFixed(2)}`;
      if (!layout || key !== layoutKey) {
        layout = buildLook(st.look, st.cutSeed, count, shapeMix);
        layoutKey = key;
      }
      const copies = COPIES_BY_SYMMETRY[Math.max(0, Math.min(2, Math.round(get("symmetry"))))];
      const shutter = SHUTTER_MAX * get("streaks");
      const glow = get("glow");

      // 1. Gates, additive into the sharp target.
      gl.bindFramebuffer(gl.FRAMEBUFFER, sharpFbo);
      gl.viewport(0, 0, sharpW, sharpH);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gateProg.use();
      uploadCommonUniforms(gateProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      gateProg.setV4v("uObjA", layout.objA);
      gateProg.setV4v("uObjB", layout.objB);
      gl.uniform1i(intLoc(gl, gateProg, "gate", "uObjCount"), layout.count);
      gl.uniform1i(intLoc(gl, gateProg, "gate", "uCopies"), copies);
      gateProg.setF("uTravel", st.travel);
      gateProg.setF("uTravelDelta", st.dir * st.flyRate * shutter);
      gateProg.setF("uSpinPos", st.spinPos);
      gateProg.setF("uSpinDelta", st.spinRate * shutter);
      gateProg.setV3v("uPrimary", [...look.primary]);
      gateProg.setV3v("uSecondary", [...look.secondary]);
      gateProg.setV3v("uAccent", [...look.accent]);
      gateProg.setF("uFlash", st.flash);
      gateProg.setF("uCoreGain", 0.55 + 0.8 * glow);
      gl.bindVertexArray(emptyVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, layout.count * copies * SEG_MAX);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);

      // 2. Bloom levels, as many as the quality allows.
      const passes = ctx.quality.bloomPasses;
      gl.activeTexture(gl.TEXTURE0);
      if (passes >= 1) {
        blurProg.use();
        gl.uniform1i(intLoc(gl, blurProg, "blur", "uTex"), 0);
        blurLevel(gl, 0, sharpTex);
        if (passes >= 2) blurLevel(gl, 1, levelTex[1]);
      }

      // 3. Composite, opaque, to the drawing buffer.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      compProg.use();
      uploadCommonUniforms(compProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sharpTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, levelTex[1]);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, levelTex[3]);
      gl.uniform1i(intLoc(gl, compProg, "comp", "uSharpTex"), 0);
      gl.uniform1i(intLoc(gl, compProg, "comp", "uGlowATex"), 1);
      gl.uniform1i(intLoc(gl, compProg, "comp", "uGlowBTex"), 2);
      const glowScale = 0.8 + 1.4 * glow;
      compProg.setF("uGlowAGain", passes >= 1 ? look.glowA * glowScale : 0);
      compProg.setF("uGlowBGain", passes >= 2 ? look.glowB * glowScale : 0);
      compProg.setV3v("uGround", [...look.ground]);
      compProg.setF("uVignette", look.vignette);
      compProg.setF("uBlackFrame", st.blackFrame);
      compProg.setF("uFlash", st.flash);
      drawFullscreenQuad(gl, quadVao);

      // 4. The gallery renders every scene into one shared context each tick
      // — leak no blend state, bound texture or active unit onto the next tile.
      gl.blendFunc(gl.ONE, gl.ZERO);
      for (let unit = 2; unit >= 0; unit--) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      gateProg?.dispose();
      blurProg?.dispose();
      compProg?.dispose();
      if (quadVao) gl.deleteVertexArray(quadVao);
      if (emptyVao) gl.deleteVertexArray(emptyVao);
      freeTargets(gl);
      gateProg = null;
      blurProg = null;
      compProg = null;
      quadVao = null;
      emptyVao = null;
      intLocs.clear();
      layout = null;
      layoutKey = "";
    },
  };
})();
