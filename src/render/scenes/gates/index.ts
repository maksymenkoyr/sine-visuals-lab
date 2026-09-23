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
import {
  buildLook,
  identityPairs,
  LOOKS,
  MAX_OBJ,
  morphLayout,
  objectCountFor,
  pairLayouts,
  SEG_MAX,
  type LookLayout,
  type MorphPairs,
} from "./layout.ts";
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
// on a fixed timer with one blackout frame per loop. Ours departs from that
// on purpose (at the user's request): a cut is jarring on a real music
// track where the beat, not a fixed timer, should pick the moment, and a
// black frame reads as a glitch rather than a transition. So instead, a bar
// boundary (a wrap of anim.barPhase, the ambience.ts precedent, or a
// free-running timer while there's no tempo lock — barPhase freezes without
// one and a silent room would otherwise never advance) picks *when* to
// start morphing into another look, with the odds set by Change rate, plus
// always on every BARS_PER_PHRASE-th bar and on a drop (anim.dropOnset);
// the morph itself always takes exactly one bar (MORPH_BARS, advanceGates)
// and, once started, is uninterruptible — nothing can cut it short or start
// another one until it settles. Every gate slides and reshapes into its
// place in the next look (layout.ts's pairLayouts/morphLayout/morphSegment
// own the geometry side of that); colours, ground and glow blend
// continuously with it (morphEase(st.morph), an eased 0..1). A Density/
// Shape mix/quality change while holding also morphs in place (st.rebuild)
// rather than snapping. The fly speed rides the low band and an onset
// flashes the nearest gates. Rates scale, positions accumulate (travel,
// spin) — the flowClock lesson.
//
// Rendering: the gates draw additively into a full-resolution RGBA8 target
// (no float targets — chladni.ts's TV constraint), two blur levels at a
// quarter and an eighth of that size make the bloom, and the composite adds
// the ground, the sharp gates and the bloom through a knee. The targets are
// rebuilt when the drawing buffer changes size, since the quality governor
// moves renderScale at runtime. Bloom levels follow quality.bloomPasses.
//
// The scheduler (advanceGates) is pure and exported for tests/gates.test.ts;
// the scene keeps one instance in its closure, alongside the two LookLayout
// slots (fromLayout/toLayout) and the MorphPairs between them that the
// render loop re-pairs whenever st.morphs changes.

const ID = "gates";

/** Looks the scheduler morphs between — the entries of LOOKS. */
export const LOOK_COUNT = LOOKS.length;
/** Every this-many bars: a morph starts regardless of Change rate. */
export const BARS_PER_PHRASE = 4;
/** Bar length while there is no tempo lock (a 120 bpm bar). */
export const FREE_BAR_SEC = 2.0;
/** How many bars a morph takes, start to settled. */
export const MORPH_BARS = 1;
/** Clamp on the bar-phase fraction advanced in one frame, so a tempo
 *  re-lock or a phase jump can't skip a morph past done in a single frame. */
const MAX_BAR_STEP = 0.25;
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
  /** Which look the tunnel is showing, or morphing into. */
  look: number;
  /** The look a running morph started from; equals `look` while holding
   *  (morph === 1). */
  fromLook: number;
  /** Bumped whenever a new look is picked (not on a same-look rebuild);
   *  reseeds the target layout's RNG stream. */
  cutSeed: number;
  /** Bar boundaries seen so far. */
  bars: number;
  lastBarPhase: number;
  /** Free-running bar clock while there is no tempo lock. */
  freeTimer: number;
  /** 0..1 progress of the morph from fromLook to look; 1 = holding/settled. */
  morph: number;
  /** Bumped every time a new morph begins (a look change or a rebuild) —
   *  the render loop's cue to re-pair the two layouts. */
  morphs: number;
  /** Set by the scene to ask for a same-look morph (e.g. Density changed
   *  the object count while holding); consumed here, the next time a morph
   *  can start. */
  rebuild: boolean;
  flash: number;
  /** Accumulated travel in world units (signed by velocity), and spin in
   *  radians. */
  travel: number;
  spinPos: number;
  /** Current fly velocity, world units/s, signed — blended across a morph
   *  so a direction flip decelerates through zero instead of snapping. */
  flyVel: number;
  spinRate: number;
  prevDrop: boolean;
}

export function createGateState(): GateState {
  return {
    look: 0,
    fromLook: 0,
    cutSeed: 0,
    bars: 0,
    lastBarPhase: 0,
    freeTimer: 0,
    morph: 1,
    morphs: 0,
    rebuild: false,
    flash: 0,
    travel: 0,
    spinPos: 0,
    flyVel: 0,
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
}

/** A look other than `prev`, uniform over the rest. */
export function pickLook(prev: number, rng: () => number): number {
  return (prev + 1 + Math.floor(rng() * (LOOK_COUNT - 1))) % LOOK_COUNT;
}

/** Smoothstep: eases a morph's start and end instead of moving through the
 *  whole bar at a constant rate. */
export function morphEase(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/** Advances the scheduler by one rendered frame, in place. */
export function advanceGates(st: GateState, anim: GateAnim, opts: GateOpts, rng: () => number = Math.random): void {
  const dt = Number.isFinite(anim.dtSec) ? Math.max(0, anim.dtSec) : 0;

  // Bar clock, and dBar: the fraction of a bar that elapsed this frame —
  // clamped so a tempo re-lock or a phase jump can't skip a morph past done
  // in one frame.
  let boundary = false;
  let dBar: number;
  if (anim.tempoLock > 0.5) {
    let step = anim.barPhase - st.lastBarPhase;
    if (step < 0) step += 1; // wrapped past 1 back toward 0
    dBar = Math.min(MAX_BAR_STEP, step);
    boundary = anim.barPhase < st.lastBarPhase - 0.5;
    st.freeTimer = 0;
  } else {
    st.freeTimer += dt;
    dBar = dt / FREE_BAR_SEC;
    if (st.freeTimer >= FREE_BAR_SEC) {
      boundary = true;
      st.freeTimer = 0;
    }
  }
  st.lastBarPhase = anim.barPhase;

  // Advance a running morph — this can settle it (morph hits 1) the same
  // frame a trigger below asks to begin another. Once settled, fromLook
  // tracks look again (the "equals look while holding" invariant) — it
  // only diverges for the duration of a morph.
  if (st.morph < 1) st.morph = Math.min(1, st.morph + dBar / MORPH_BARS);
  if (st.morph >= 1) st.fromLook = st.look;

  // Triggers. begin() is a no-op whenever a morph is still running (morph <
  // 1) — this is the uninterruptibility: nothing here can cut a running
  // morph short or start a second one on top of it. Called with no
  // argument, it starts a same-look rebuild instead of picking a new look.
  const begin = (nextLook?: number): void => {
    if (st.morph < 1) return;
    st.fromLook = st.look;
    if (nextLook !== undefined) {
      st.look = nextLook;
      st.cutSeed += 1;
    }
    st.morph = 0;
    st.morphs += 1;
    st.rebuild = false;
  };

  if (boundary) {
    st.bars += 1;
    if (st.bars % BARS_PER_PHRASE === 0) begin(pickLook(st.look, rng));
    else if (rng() < opts.cutRate) begin(pickLook(st.look, rng));
  }

  const drop = anim.dropOnset && !st.prevDrop;
  st.prevDrop = anim.dropOnset;
  if (drop) begin(pickLook(st.look, rng));

  // Only once nothing else has claimed this frame's morph slot (begin() is
  // still a no-op above whenever one did).
  if (st.rebuild) begin();

  if (anim.onset) st.flash = Math.min(FLASH_CAP, st.flash + FLASH_HIT);
  st.flash *= Math.exp(-dt * FLASH_DECAY);

  const e = morphEase(st.morph);
  const vel = (look: number): number =>
    (FLY_MIN + (FLY_MAX - FLY_MIN) * opts.speed) * (1 + FLY_BASS_GAIN * anim.low) * LOOKS[look].speed * LOOKS[look].dir;
  const velFrom = vel(st.fromLook);
  st.flyVel = velFrom + (vel(st.look) - velFrom) * e;
  st.spinRate = SPIN_RAD_MAX * opts.spin;
  st.travel += st.flyVel * dt;
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
    label: "Change rate",
    description: "How likely each bar is to start morphing into another look; every fourth bar and every drop start one regardless, unless a morph is already running",
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
  // The look being left and the look being entered; morphLayout blends
  // between them every frame. Re-paired only when st.morphs changes (a new
  // morph began) — see render()'s pairing block.
  let fromLayout: LookLayout | null = null;
  let toLayout: LookLayout | null = null;
  let pairs: MorphPairs | null = null;
  /** The st.morphs value `pairs` was built for. */
  let pairedMorphs = -1;
  /** The count:shapeMix signature `toLayout` was built with, so a Density/
   *  Shape mix/quality change while holding can ask for a rebuild instead
   *  of silently going stale. */
  let toLayoutKey = "";
  const outA = new Float32Array(MAX_OBJ * 4);
  const outB = new Float32Array(MAX_OBJ * 4);
  const outC = new Float32Array(MAX_OBJ * 4);
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
      const initialCount = objectCountFor(st.look, 0.5, ctx.quality.detail);
      toLayout = buildLook(st.look, st.cutSeed, initialCount, 0.5);
      fromLayout = toLayout;
      pairs = identityPairs(toLayout);
      pairedMorphs = st.morphs;
      toLayoutKey = `${initialCount}:0.50`;
    },

    render(ctx: SceneContext, frame: FeatureFrame, viewport: Viewport, palette: Palette, anim: AnimFrame) {
      const { gl } = ctx;
      if (!gateProg || !blurProg || !compProg || !quadVao || !emptyVao) return;
      ensureTargets(gl);

      // anim.onset / anim.dropOnset, not frame.onset: the render cap can skip
      // the tick the feature fired on (renderLatch.ts).
      const speed = get("speed");
      const spin = get("spin");
      advanceGates(st, anim, { speed, cutRate: get("cutRate"), spin });

      const density = get("density");
      const shapeMix = get("shapeMix");
      const count = objectCountFor(st.look, density, ctx.quality.detail);
      const wantKey = `${count}:${shapeMix.toFixed(2)}`;

      if (st.morphs !== pairedMorphs) {
        // A new morph just began: the just-finished target becomes the new
        // source — morphs never overlap, so the current toLayout is always
        // exactly what st.fromLook/its pre-increment cutSeed was built
        // with. The `??` only guards a theoretical null right after init().
        fromLayout = toLayout ?? buildLook(st.fromLook, Math.max(0, st.cutSeed - 1), count, shapeMix);
        toLayout = buildLook(st.look, st.cutSeed, count, shapeMix);
        toLayoutKey = wantKey;
        pairs = pairLayouts(fromLayout, toLayout);
        pairedMorphs = st.morphs;
      } else if (st.morph >= 1 && wantKey !== toLayoutKey) {
        // Holding, but Density/Shape mix/quality moved the object count or
        // mix: ask the scheduler to morph in place next frame rather than
        // rebuilding (and snapping) immediately.
        st.rebuild = true;
      }
      // Else: mid-morph and the key changed underneath it — let the running
      // morph finish; if the mismatch persists once it settles, the branch
      // above picks it up as a rebuild.

      const n = morphLayout(fromLayout!, toLayout!, pairs!, morphEase(st.morph), outA, outB, outC);
      const copies = COPIES_BY_SYMMETRY[Math.max(0, Math.min(2, Math.round(get("symmetry"))))];
      const shutter = SHUTTER_MAX * get("streaks");
      const glow = get("glow");
      const e = morphEase(st.morph);
      const lookFrom = LOOKS[st.fromLook];
      const lookTo = LOOKS[st.look];

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
      gateProg.setV4v("uObjA", outA);
      gateProg.setV4v("uObjB", outB);
      gateProg.setV4v("uObjC", outC);
      gl.uniform1i(intLoc(gl, gateProg, "gate", "uObjCount"), n);
      gl.uniform1i(intLoc(gl, gateProg, "gate", "uCopies"), copies);
      gateProg.setF("uTravel", st.travel);
      gateProg.setF("uTravelDelta", st.flyVel * shutter);
      gateProg.setF("uSpinPos", st.spinPos);
      gateProg.setF("uSpinDelta", st.spinRate * shutter);
      gateProg.setV3v("uColFrom", [...lookFrom.primary, ...lookFrom.secondary, ...lookFrom.accent]);
      gateProg.setV3v("uColTo", [...lookTo.primary, ...lookTo.secondary, ...lookTo.accent]);
      gateProg.setF("uMorph", e);
      gateProg.setF("uFlash", st.flash);
      gateProg.setF("uCoreGain", 0.55 + 0.8 * glow);
      gl.bindVertexArray(emptyVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n * copies * SEG_MAX);
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
      const glowA = lookFrom.glowA + (lookTo.glowA - lookFrom.glowA) * e;
      const glowB = lookFrom.glowB + (lookTo.glowB - lookFrom.glowB) * e;
      const vignette = lookFrom.vignette + (lookTo.vignette - lookFrom.vignette) * e;
      const ground: [number, number, number] = [0, 1, 2].map(
        (i) => lookFrom.ground[i] + (lookTo.ground[i] - lookFrom.ground[i]) * e,
      ) as [number, number, number];
      compProg.setF("uGlowAGain", passes >= 1 ? glowA * glowScale : 0);
      compProg.setF("uGlowBGain", passes >= 2 ? glowB * glowScale : 0);
      compProg.setV3v("uGround", ground);
      compProg.setF("uVignette", vignette);
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
      fromLayout = null;
      toLayout = null;
      pairs = null;
      pairedMorphs = -1;
      toLayoutKey = "";
    },
  };
})();
