// Tangle -- a sphere of light that a noise field folds into straight lines.
// The sphere is a texture of positions (u round the equator, v pole to
// pole). Every step each texel copies the texture at its own uv plus a
// noise offset, so a texel's position flows along the noise: within a
// second or two whole patches copy one source and sit on one point (the
// bright knots), and the texels on the border between two patches hold
// blends of the two, which lie on the straight line between them. Drawing
// a segment between every pair of neighbouring texels then gives the
// picture: long straight chords and triangles across the sphere, meeting in
// white knots, with a few arcs left where the flow has not settled. The
// knots flare (a separate density pass, glsl.ts's KNOT_VERT), and a colour
// fringe comes from reading red, green and blue from three moments of the
// drawn history, so anything that moves splits into colour and anything
// still stays white. glsl.ts has the shaders, core.ts the pure helpers;
// docs/scenes/tangle.md is the record (the reference it was measured from,
// what was tried).
//
// Sync mapping (drives -- see drives.ts's header). The reference is silent,
// so all of this is ours:
// - Re-inflate: on a hit, every position is pulled part of the way home to
//   the sphere, by the hit's height, over INFLATE_STEPS steps, and the fine
//   octave crinkles them (CRINKLE_TAU) -- the lines swell back toward a
//   crinkled sphere and the fringe flares on the slide, then the warp folds
//   them into lines again.
// - Reset on drop: a drop brings back the whole, freshly crinkled sphere --
//   the reference's own opening -- and it collapses again.
// - Drift: the noise field moves, sliding the lines into new shapes,
//   faster with the mids. Without it, the copies only ever merge: the
//   tangle would thin to a few lines and stop.
//
// Time: the warp steps at a fixed STEP_DT with an accumulator, at most
// MAX_STEPS_PER_FRAME a frame, from the delta of anim.timeSec -- the gallery
// preview hands render() an un-latched anim, so anim.dtSec is not used (same
// as swarm). AMP is per step, tuned so the sphere folds into long lines in
// about the reference's 1.4 s.
//
// Targets: the position texture is two ping-pong pairs of RGBA8 (16 bits an
// axis, packed as in powder.ts); segments add into one R8 slot of a ring of
// RING_SLOTS at the drawing buffer's size (the history the fringe reads);
// the glow is a half-res RGBA8 chain and the flares a quarter-res one. All
// of them are rebuilt when the drawing buffer changes size, which the
// quality governor does at runtime.
import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../../gl.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import { resolveSceneSetting } from "../../autoTune.ts";
import type { Scene, SceneContext } from "../../scene.ts";
import { PASSTHROUGH_DRIVES } from "../../drives.ts";
import { wrapFlow } from "../../noiseHash.ts";
import { SIM_FRAG, SEG_VERT, SEG_FRAG, KNOT_VERT, KNOT_FRAG, GLOW_SRC_FRAG, BLUR_FRAG, COMPOSITE_FRAG } from "./glsl.ts";
import { SIDE_BY_PRESET, pickSlot, cameraRotation, createGlide, startGlide, glideStep } from "./core.ts";

const ID = "tangle";

const STEP_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 4;

/** Noise offset per step at Pull 1 / Wiggle 1, in uv units. */
const AMP = 0.008;
const AMP_FINE = 0.01;
/** The fine octave is a crinkle, not a constant: a reset or a hit sets it
 *  (a hit by CRINKLE_PER_PULL × its pull, a reset fully) and it fades with
 *  this time constant. Held on, its small cells outgrow the coarse ones and
 *  the tangle never thins to long lines; fading, the coarse cells take the
 *  crinkles over within a second or two, as the reference's opening does. */
const CRINKLE_TAU = 0.6;
const CRINKLE_PER_PULL = 4;
/** The fine octave's cells per coarse cell (rounded to a whole count). */
const FINE_PER_COARSE = 6;
/** A hit's pull home is spread over this many steps, so the lines slide
 *  out instead of teleporting -- a one-step jump doubles the whole picture
 *  in the colour fringe. */
const INFLATE_STEPS = 6;

/** Noise-field travel per second at Drift 1 with the mids at rest. */
const DRIFT_RATE = 0.06;
/** Drift's speed-up from the mids: rate × (DRIFT_FLOOR + DRIFT_SPAN × level). */
const DRIFT_FLOOR = 0.25;
const DRIFT_SPAN = 1.5;
const DRIFT_REST = 0.5;
/** The fine octave drifts at this multiple of the coarse one. */
const FINE_DRIFT = 1.7;

/** Camera yaw speed at Spin 1, radians a second, and its fixed tilt. */
const SPIN_RATE = 0.35;
const PITCH = 0.35;
const CAM_DIST = 3.2;
/** The sphere's radius on screen at Size 1, in half-heights (the
 *  reference's opening sphere, measured on its first frame). */
const SPHERE_HALF_HEIGHTS = 0.93;

/** Stroke and glow are in pixels at this room height (the reference's). */
const REF_PX_HEIGHT = 720;
/** Measured stroke width 1.9 px → half of it. */
const STROKE_HALF_PX = 0.95;
/** Glow e-fold 13.6 px measured → a Gaussian sigma of e-fold / √2. */
const GLOW_SIGMA_PX = 13.6 / Math.SQRT2;
/** One segment's brightness at side 256 and Lines 1; scaled by 256 / side
 *  so the opening sphere is equally bright at every quality preset. */
const SEG_GAIN = 0.015;
/** How much of the lines themselves goes into the glow. */
const LINE_GLOW = 0.15;
/** The flares: each texel a faint point in a quarter-res target, its
 *  brightness at side 256 (scaled by (256 / side)², the texel count, so a
 *  knot of the same share of the sphere flares the same at every quality
 *  preset). Two blurs of it: a tight one for the white core and a wide one
 *  of that for the halo (sigmas in reference-height pixels). The
 *  reference's biggest flare is ~130 px across at 720, its core a third of
 *  that. */
const FLARE_DIVISOR = 4;
/** Each texel's point there is this wide (reference-height pixels): wide
 *  enough that a saturated knot holds the light the blurs spread. */
const FLARE_POINT_PX = 24;
const FLARE_POINT_GAIN = 1 / 300;
const FLARE_CORE_SIGMA_PX = 8;
const FLARE_HALO_SIGMA_PX = 30;
const FLARE_CORE_GAIN = 2.5;
const FLARE_HALO_GAIN = 4;
/** Flare density below this is dropped before the blur: the opening
 *  sphere and the lines' own texels stay under it, knots clip past it. */
const FLARE_KNEE = 0.7;
const GLOW_GAIN = 0.9;
/** Ground #060607, measured. */
const GROUND = [6 / 255, 6 / 255, 7 / 255] as const;

/** Frames of segment history kept for the fringe, and the longest delay a
 *  channel gets at Colour fringe 1, in seconds. */
const RING_SLOTS = 7;
const FRINGE_MAX_SEC = 0.05;

const SETTINGS: SceneSetting[] = [
  // Form
  {
    key: "detail",
    label: "Detail",
    description: "How many cells the noise has round the sphere — left folds it into a few long lines, right into many short ones",
    group: "Form",
    min: 2,
    max: 12,
    step: 1,
    default: 14,
    masterScale: false,
  },
  {
    key: "pull",
    label: "Pull",
    description: "How hard the noise drags the sphere into lines — left lingers as a crinkled sphere, right snaps straight",
    group: "Form",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
  },
  {
    key: "wiggle",
    label: "Wiggle",
    description: "How much fine zigzag a drop or a hit crinkles the lines into before they settle — left keeps smooth arcs",
    group: "Form",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
  },
  // Motion
  {
    key: "inflate",
    label: "Re-inflate",
    description: "How far a hit pulls the lines back out toward the sphere before they fold up again",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.15,
    // Bass hits, not every onset: a DJ track fires onsets several times a
    // beat, and the lines would never get to fold (swarm measured the same).
    drive: { default: "anim.lowOnset" },
  },
  {
    key: "reset",
    label: "Reset on drop",
    description: "How much of the sphere a drop brings back — 1 starts over from the whole sphere, 0 ignores drops",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 1,
    drive: { default: "anim.dropOnset" },
  },
  {
    key: "drift",
    label: "Drift",
    description: "How fast the noise moves, sliding the lines into new shapes — by default faster when the mids are loud",
    group: "Motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    drive: { default: "anim.mid" },
  },
  // Look
  {
    key: "lines",
    label: "Lines",
    description: "How bright the lines are",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
  },
  {
    key: "glow",
    label: "Glow",
    description: "How far light spreads round the lines and the bright knots",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
  },
  {
    key: "fringe",
    label: "Colour fringe",
    description: "How far red, green and blue lag behind each other on whatever moves — 0 is pure white",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
  },
  // Camera
  {
    key: "spin",
    label: "Spin",
    description: "How fast the camera circles the tangle — left of the middle turns the other way",
    group: "Camera",
    min: -1,
    max: 1,
    step: 0.05,
    default: 0.25,
  },
  {
    key: "size",
    label: "Size",
    description: "How large the sphere is on screen",
    group: "Camera",
    min: 0.5,
    max: 1.6,
    step: 0.05,
    default: 1,
  },
];

function settingFor(key: string): SceneSetting {
  const s = SETTINGS.find((x) => x.key === key);
  if (!s) throw new Error(`tangle: unknown setting ${key}`);
  return s;
}

function value(key: string): number {
  return resolveSceneSetting(ID, settingFor(key));
}

function flareSize(px: number): number {
  return Math.max(1, Math.ceil(px / FLARE_DIVISOR));
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function createTangleScene(): Scene {
  let simProg: GLProgram | null = null;
  let segProg: GLProgram | null = null;
  let knotProg: GLProgram | null = null;
  let glowSrcProg: GLProgram | null = null;
  let blurProg: GLProgram | null = null;
  let compositeProg: GLProgram | null = null;
  let quadVao: WebGLVertexArrayObject | null = null;
  let emptyVao: WebGLVertexArrayObject | null = null;

  // Position state: two ping-pong slots, each two RGBA8 attachments.
  const posA: (WebGLTexture | null)[] = [null, null];
  const posB: (WebGLTexture | null)[] = [null, null];
  const simFbo: (WebGLFramebuffer | null)[] = [null, null];
  let read = 0;
  let side = 0;

  // Segment history (R8) and the half-res glow chain.
  const ring: (WebGLTexture | null)[] = [];
  const ringFbo: (WebGLFramebuffer | null)[] = [];
  const ringTimes = new Float64Array(RING_SLOTS).fill(-Infinity);
  let head = 0;
  let glowTex: (WebGLTexture | null)[] = [null, null];
  let glowFbo: (WebGLFramebuffer | null)[] = [null, null];
  // Flares: [0] the points (then the halo), [1] scratch, [2] the core.
  let flareTex: (WebGLTexture | null)[] = [null, null, null];
  let flareFbo: (WebGLFramebuffer | null)[] = [null, null, null];
  let targetW = 0;
  let targetH = 0;

  const locs = new Map<GLProgram, Map<string, WebGLUniformLocation | null>>();
  const rot = new Float32Array(9);

  let lastTime: number | null = null;
  let accumulator = 0;
  let phase = 0;
  let yaw = 0;
  /** The pull home in flight (hits, drops, the start). */
  const glide = createGlide();
  /** The fine octave's envelope, 0..1 -- see CRINKLE_TAU. */
  let crinkle = 1;

  function loc(gl: WebGL2RenderingContext, prog: GLProgram, name: string): WebGLUniformLocation | null {
    let byName = locs.get(prog);
    if (!byName) {
      byName = new Map();
      locs.set(prog, byName);
    }
    let l = byName.get(name);
    if (l === undefined) {
      l = gl.getUniformLocation(prog.program, name);
      byName.set(name, l);
    }
    return l;
  }

  function sampler(gl: WebGL2RenderingContext, prog: GLProgram, name: string, unit: number, tex: WebGLTexture | null): void {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const l = loc(gl, prog, name);
    if (l) gl.uniform1i(l, unit);
  }

  function makeTexture(
    gl: WebGL2RenderingContext,
    internal: number,
    format: number,
    w: number,
    h: number,
    filter: number,
  ): WebGLTexture | null {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  function attach(gl: WebGL2RenderingContext, textures: (WebGLTexture | null)[], what: string): WebGLFramebuffer | null {
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    textures.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
    if (textures.length > 1) gl.drawBuffers(textures.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`tangle: ${what} framebuffer incomplete (0x${status.toString(16)})`);
    }
    return f;
  }

  function freeState(gl: WebGL2RenderingContext): void {
    for (let i = 0; i < 2; i++) {
      if (simFbo[i]) gl.deleteFramebuffer(simFbo[i]);
      if (posA[i]) gl.deleteTexture(posA[i]);
      if (posB[i]) gl.deleteTexture(posB[i]);
      simFbo[i] = posA[i] = posB[i] = null;
    }
  }

  function buildState(gl: WebGL2RenderingContext, n: number): void {
    freeState(gl);
    for (let i = 0; i < 2; i++) {
      posA[i] = makeTexture(gl, gl.RGBA8, gl.RGBA, n, n, gl.NEAREST);
      posB[i] = makeTexture(gl, gl.RGBA8, gl.RGBA, n, n, gl.NEAREST);
      simFbo[i] = attach(gl, [posA[i], posB[i]], "sim");
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    side = n;
    read = 0;
    startGlide(glide, 1, 1);
    crinkle = 1;
  }

  function freeTargets(gl: WebGL2RenderingContext): void {
    for (const f of ringFbo) if (f) gl.deleteFramebuffer(f);
    for (const t of ring) if (t) gl.deleteTexture(t);
    ring.length = 0;
    ringFbo.length = 0;
    for (let i = 0; i < 2; i++) {
      if (glowFbo[i]) gl.deleteFramebuffer(glowFbo[i]);
      if (glowTex[i]) gl.deleteTexture(glowTex[i]);
    }
    for (let i = 0; i < 3; i++) {
      if (flareFbo[i]) gl.deleteFramebuffer(flareFbo[i]);
      if (flareTex[i]) gl.deleteTexture(flareTex[i]);
    }
    glowTex = [null, null];
    glowFbo = [null, null];
    flareTex = [null, null, null];
    flareFbo = [null, null, null];
    targetW = targetH = 0;
  }

  /** Rebuilds the history ring and the glow chain when the drawing buffer
   *  changes size — compared every frame, since the quality governor moves
   *  renderScale at runtime. */
  function ensureTargets(gl: WebGL2RenderingContext): void {
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    if (w === targetW && h === targetH && ring.length === RING_SLOTS) return;
    freeTargets(gl);
    for (let i = 0; i < RING_SLOTS; i++) {
      const t = makeTexture(gl, gl.R8, gl.RED, w, h, gl.LINEAR);
      ring.push(t);
      ringFbo.push(attach(gl, [t], "history"));
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    const gw = Math.max(1, w >> 1);
    const gh = Math.max(1, h >> 1);
    for (let i = 0; i < 2; i++) {
      glowTex[i] = makeTexture(gl, gl.RGBA8, gl.RGBA, gw, gh, gl.LINEAR);
      glowFbo[i] = attach(gl, [glowTex[i]], "glow");
    }
    for (let i = 0; i < 3; i++) {
      flareTex[i] = makeTexture(gl, gl.RGBA8, gl.RGBA, flareSize(w), flareSize(h), gl.LINEAR);
      flareFbo[i] = attach(gl, [flareTex[i]], "flare");
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    ringTimes.fill(-Infinity);
    targetW = w;
    targetH = h;
  }

  return {
    id: ID,
    name: "Tangle",
    settings: SETTINGS,

    init(ctx: SceneContext) {
      const { gl } = ctx;
      simProg = createProgram(gl, SIM_FRAG);
      segProg = createProgram(gl, SEG_FRAG, SEG_VERT);
      knotProg = createProgram(gl, KNOT_FRAG, KNOT_VERT);
      glowSrcProg = createProgram(gl, GLOW_SRC_FRAG);
      blurProg = createProgram(gl, BLUR_FRAG);
      compositeProg = createProgram(gl, COMPOSITE_FRAG);
      locs.clear();
      quadVao = createFullscreenQuad(gl);
      // The segment pass addresses everything by gl_InstanceID/gl_VertexID
      // and has no attributes, so it draws from an empty VAO.
      emptyVao = gl.createVertexArray();
      buildState(gl, SIDE_BY_PRESET[ctx.quality.preset]);
      freeTargets(gl);
      ensureTargets(gl);
      head = 0;
      lastTime = null;
      accumulator = 0;
      phase = 0;
      yaw = 0;
    },

    render(ctx, _frame, viewport, _palette, anim, drives = PASSTHROUGH_DRIVES) {
      if (!simProg || !segProg || !knotProg || !glowSrcProg || !blurProg || !compositeProg || !quadVao || !emptyVao) return;
      const { gl } = ctx;
      ensureTargets(gl);

      const now = anim.timeSec;
      const dt = lastTime === null ? STEP_DT : Math.max(0, Math.min(0.25, now - lastTime));
      lastTime = now;

      const detail = Math.round(value("detail"));
      const pull = value("pull");
      const wiggle = value("wiggle");
      const inflate = value("inflate");
      const reset = value("reset");
      const drift = value("drift");
      const lines = value("lines");
      const glow = value("glow");
      const fringe = value("fringe");
      const spin = value("spin");
      const size = value("size");

      // Edges are consumed once a render, not once a step; the pull they
      // ask for runs over the next INFLATE_STEPS steps.
      if (inflate > 0.02 && drives.fired("inflate", anim.lowOnset)) {
        const pullHome = clamp01(inflate * drives.value("inflate", anim.lowPulse));
        startGlide(glide, pullHome, INFLATE_STEPS);
        crinkle = Math.max(crinkle, clamp01(pullHome * CRINKLE_PER_PULL));
      }
      if (reset > 0.02 && drives.fired("reset", anim.dropOnset)) {
        startGlide(glide, clamp01(reset), INFLATE_STEPS);
        crinkle = Math.max(crinkle, clamp01(reset));
      }

      const mids = clamp01(drives.value("drift", anim.mid, DRIFT_REST));
      phase += dt * DRIFT_RATE * drift * (DRIFT_FLOOR + DRIFT_SPAN * mids);
      yaw += dt * SPIN_RATE * spin;

      // --- warp steps ---
      const freq = Math.max(1, detail);
      const freqFine = Math.max(2, Math.round(detail * FINE_PER_COARSE));
      accumulator += dt;
      let steps = 0;
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      while (accumulator >= STEP_DT && steps < MAX_STEPS_PER_FRAME) {
        const write = 1 - read;
        gl.bindFramebuffer(gl.FRAMEBUFFER, simFbo[write]);
        gl.viewport(0, 0, side, side);
        simProg.use();
        sampler(gl, simProg, "uPosA", 0, posA[read]);
        sampler(gl, simProg, "uPosB", 1, posB[read]);
        simProg.setF("uSide", side);
        simProg.setF("uAmp", AMP * pull);
        simProg.setF("uFreq", freq);
        simProg.setF("uAmpFine", AMP_FINE * wiggle * crinkle);
        simProg.setF("uFreqFine", freqFine);
        simProg.setF("uPhase", wrapFlow(phase));
        simProg.setF("uPhaseFine", wrapFlow(phase * FINE_DRIFT + 11.3));
        simProg.setF("uBlend", glideStep(glide));
        drawFullscreenQuad(gl, quadVao);
        read = write;
        crinkle *= Math.exp(-STEP_DT / CRINKLE_TAU);
        accumulator -= STEP_DT;
        steps++;
      }
      if (accumulator >= STEP_DT) accumulator = 0; // a stall: drop the remainder

      // --- segments into the next history slot ---
      const resW = gl.drawingBufferWidth;
      const resH = gl.drawingBufferHeight;
      const roomW = resW / Math.max(viewport.w, 1e-4);
      const roomH = resH / Math.max(viewport.h, 1e-4);
      const pxScale = roomH / REF_PX_HEIGHT;
      head = (head + 1) % RING_SLOTS;
      ringTimes[head] = now;

      gl.bindFramebuffer(gl.FRAMEBUFFER, ringFbo[head]);
      gl.viewport(0, 0, resW, resH);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      segProg.use();
      cameraRotation(yaw, PITCH, rot);
      const camera = (prog: GLProgram): void => {
        sampler(gl, prog, "uPosA", 0, posA[read]);
        sampler(gl, prog, "uPosB", 1, posB[read]);
        prog.setF("uSide", side);
        gl.uniformMatrix3fv(loc(gl, prog, "uRot"), false, rot);
        prog.setF("uCamDist", CAM_DIST);
        prog.setF("uFocal", SPHERE_HALF_HEIGHTS * size * Math.sqrt(CAM_DIST * CAM_DIST - 1));
        prog.setV2("uRoomPx", roomW, roomH);
        prog.setV4("uViewport", viewport.x, viewport.y, viewport.w, viewport.h);
      };
      camera(segProg);
      segProg.setF("uHalfW", Math.max(0.5, STROKE_HALF_PX * pxScale));
      segProg.setF("uGain", SEG_GAIN * (256 / side) * lines);
      gl.bindVertexArray(emptyVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, side * side * 2);
      gl.disable(gl.BLEND);

      // --- the fringe: which history slot each channel reads ---
      const delay = FRINGE_MAX_SEC * clamp01(fringe);
      const slotG = pickSlot(ringTimes, head, now, delay);
      const slotB = pickSlot(ringTimes, head, now, 2 * delay);
      const bindFringe = (prog: GLProgram): void => {
        sampler(gl, prog, "uSegR", 0, ring[head]);
        sampler(gl, prog, "uSegG", 1, ring[slotG]);
        sampler(gl, prog, "uSegB", 2, ring[slotB]);
      };

      // --- glow: the fringed picture at half res, blurred twice ---
      const gw = Math.max(1, resW >> 1);
      const gh = Math.max(1, resH >> 1);
      gl.viewport(0, 0, gw, gh);
      gl.bindFramebuffer(gl.FRAMEBUFFER, glowFbo[0]);
      glowSrcProg.use();
      bindFringe(glowSrcProg);
      glowSrcProg.setF("uLineGlow", LINE_GLOW);
      drawFullscreenQuad(gl, quadVao);
      // Sigma in half-res pixels; the blur's own sigma is two taps.
      const tap = Math.max(0.5, (GLOW_SIGMA_PX * pxScale) / 2 / 2);
      blurProg.use();
      gl.bindFramebuffer(gl.FRAMEBUFFER, glowFbo[1]);
      sampler(gl, blurProg, "uSrc", 0, glowTex[0]);
      blurProg.setF("uKnee", 0);
      blurProg.setV2("uStep", tap / gw, 0);
      drawFullscreenQuad(gl, quadVao);
      gl.bindFramebuffer(gl.FRAMEBUFFER, glowFbo[0]);
      sampler(gl, blurProg, "uSrc", 0, glowTex[1]);
      blurProg.setV2("uStep", 0, tap / gh);
      drawFullscreenQuad(gl, quadVao);

      // --- flares: every texel a faint point at a quarter of the room's
      // pixels; only knots add up to anything, and the blurs spread them ---
      const fw = flareSize(resW);
      const fh = flareSize(resH);
      gl.viewport(0, 0, fw, fh);
      gl.bindFramebuffer(gl.FRAMEBUFFER, flareFbo[0]);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      knotProg.use();
      camera(knotProg);
      knotProg.setF("uPointPx", Math.max(1, (FLARE_POINT_PX * pxScale) / FLARE_DIVISOR));
      knotProg.setF("uGain", FLARE_POINT_GAIN * (256 / side) * (256 / side));
      gl.bindVertexArray(emptyVao);
      gl.drawArrays(gl.POINTS, 0, side * side);
      gl.disable(gl.BLEND);
      // The blur's own sigma is two taps: a tap is sigma / 2 target pixels.
      const coreTap = Math.max(0.5, (FLARE_CORE_SIGMA_PX * pxScale) / FLARE_DIVISOR / 2);
      const haloTap = Math.max(0.5, (FLARE_HALO_SIGMA_PX * pxScale) / FLARE_DIVISOR / 2);
      const blur = blurProg;
      const quad = quadVao;
      const flareBlur = (from: number, to: number, knee: number, sx: number, sy: number): void => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, flareFbo[to]);
        sampler(gl, blur, "uSrc", 0, flareTex[from]);
        blur.setF("uKnee", knee);
        blur.setV2("uStep", sx / fw, sy / fh);
        drawFullscreenQuad(gl, quad);
      };
      blurProg.use();
      flareBlur(0, 1, FLARE_KNEE, coreTap, 0);
      flareBlur(1, 2, 0, 0, coreTap);
      flareBlur(2, 1, 0, haloTap, 0);
      flareBlur(1, 0, 0, 0, haloTap);

      // --- composite ---
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, resW, resH);
      compositeProg.use();
      bindFringe(compositeProg);
      sampler(gl, compositeProg, "uGlow", 3, glowTex[0]);
      sampler(gl, compositeProg, "uFlareCore", 4, flareTex[2]);
      sampler(gl, compositeProg, "uFlareHalo", 5, flareTex[0]);
      compositeProg.setF("uCoreGain", FLARE_CORE_GAIN * glow);
      compositeProg.setF("uHaloGain", FLARE_HALO_GAIN * glow);
      compositeProg.setF("uLine", 1);
      compositeProg.setF("uGlowGain", GLOW_GAIN * glow);
      gl.uniform3f(loc(gl, compositeProg, "uGround"), GROUND[0], GROUND[1], GROUND[2]);
      drawFullscreenQuad(gl, quadVao);

      // The gallery renders every scene into one shared context each tick:
      // leave no blend state, VAO or texture binding behind.
      gl.bindVertexArray(null);
      for (let u = 5; u >= 0; u--) {
        gl.activeTexture(gl.TEXTURE0 + u);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }
      gl.disable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ZERO);
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      freeState(gl);
      freeTargets(gl);
      if (quadVao) gl.deleteVertexArray(quadVao);
      if (emptyVao) gl.deleteVertexArray(emptyVao);
      quadVao = emptyVao = null;
      for (const p of [simProg, segProg, knotProg, glowSrcProg, blurProg, compositeProg]) p?.dispose();
      simProg = segProg = knotProg = glowSrcProg = blurProg = compositeProg = null;
      locs.clear();
    },
  };
}

export const tangleScene = createTangleScene();
