// Tessera -- a static 3D lattice of hollow instanced boxes standing on a
// sphere, whose lengths change every frame with the spectrum, viewed by a
// camera on the pole axis that dollies between "outside the ball" (a dome
// with scalloped petals) and "right above the pole" (a starburst of box
// walls converging on a white pole box). Rebuilt wholesale (PR #111's
// original flat 2D sprite-and-feedback version was, in the user's words,
// "very far from the original, the physics is just not it") from a rescan
// of youtube.com/shorts/lZaThcqs-dk with the current /ref tools
// (tools/.cache/refs/lZaThcqs-dk/): the mean-projection in
// bursts/011.02/motion.png keeps crisp spokes and a cross on the axes while
// the frame-difference fringes sit only at box ends -- positions are fixed,
// only lengths (and the sweeping hue) change frame to frame. Nothing here
// flows inward, unlike the old draft.
//
// Round 2 (swift-weaving-parnas.md): round 1's lattice held a constant slot
// count per ring, which shrinks boxes to slivers near the pole (the
// sin(theta) azimuthal-pitch factor) and leaves the outer rings sparse --
// "thin wiry radial spokes, a black hole around the pole". The reference's
// own angular box count instead GROWS with radius (constant arc-length
// spacing); lattice.ts's latticeLayout fixes this, and the camera/box sizing
// (CAM_NEAR, lenBase/lenAudio, Fill) shrank to match the now much smaller,
// much more numerous boxes.
//
// lattice.ts owns the geometry/camera/hue-clock math (and mirrors it for
// tests/tessera.test.ts); glsl.ts owns the shaders built from it. This file
// is the render loop, following shards/index.ts's idioms throughout: an
// empty VAO with gl_InstanceID/gl_VertexID doing all the work (no per-
// instance upload -- ambience.ts's DOT_VERT is the other precedent for that
// trick), a full-res sharp target with its own depth renderbuffer plus a
// half-res two-pass blur for the halo, hand-cached sampler locations
// (GLProgram has no integer setter), and the GL-state restore block at the
// end of render() (the gallery renders every scene into one shared context
// each tick).
//
// Sync (see the plan's "Sync hypotheses" -- no rewritten copy here, name the
// mechanism instead): each ring reads a band from uBands every frame (pole =
// lows, limb = highs, via sampleBands on the ring's own theta/RING_THETA_MAX
// fraction) -- continuous, no onset flash, matching the reference's
// continuous activity with no beat-rank preference. The hue clock's rate
// rides anim.sectionIntensity (quiet holds a hue, loud sweeps) and switches
// to following anim.barPhase wraps once anim.tempoLock is high and the rate
// is already in its fast regime -- see lattice.ts's advanceHueClock. The
// camera dolly and the roll are both free-running timers (Drift's
// dollyCycle), never audio-locked -- the reference shows 0 regime changes
// tied to any audio section boundary.

import { NUM_BANDS } from "../../../audio/types.ts";
import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../../gl.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import { resolveSceneSetting } from "../../autoTune.ts";
import type { Scene, SceneContext } from "../../scene.ts";
import { COMMON_UNIFORMS_GLSL, ROOM_UV_GLSL, settingUniformName, uploadCommonUniforms } from "../../sceneCommon.ts";
import {
  BALL_RADIUS,
  MAX_RINGS,
  advanceHueClock,
  cameraBasis,
  camDistanceForDolly,
  createHueClockState,
  effectiveDolly,
  focalFromFovDeg,
  latticeLayout,
  screenBallRadius,
  shellVisibility,
  type HueClockState,
} from "./lattice.ts";
import { BLOOM_THRESHOLD, BLUR_FRAG, BLUR_STRIDE_X, BLUR_STRIDE_Y, bgFrag, boxFrag, boxVert, compositeFrag, BOX_VERTS } from "./glsl.ts";

const ID = "tessera";
/** A middling box length (a fraction of BALL_RADIUS), used only to size the
 *  background dots/rays' gap against the ball's *typical* visual edge --
 *  see its call site in render(). Not the same margin CAM_NEAR uses (that
 *  one has to clear the worst case, this one just the common case). Round 2:
 *  scaled down along with lenBase/lenAudio -- the boxes are much smaller
 *  relative to the sphere now. */
const BG_TYPICAL_LEN = 0.2;

const SETTINGS: SceneSetting[] = [
  {
    key: "pitch",
    label: "Pitch",
    description: "Ring spacing, as a fraction of the ball's own radius -- smaller packs in more, smaller boxes",
    group: "Form",
    min: 0.05,
    max: 0.2,
    step: 0.005,
    default: 0.085,
  },
  {
    key: "fold",
    label: "Folds",
    description: "How many scalloped petals the lobe pattern makes around the ball",
    group: "Form",
    min: 2,
    max: 16,
    step: 1,
    default: 8,
  },
  {
    key: "swirl",
    label: "Swirl",
    description: "How far the petals and the colour sectors twist with latitude",
    group: "Form",
    min: -2,
    max: 2,
    step: 0.05,
    default: 0.55,
  },
  {
    key: "fill",
    label: "Fill",
    description: "A box's width and depth, as a fraction of its own ring/meridian spacing -- low reads as fine bare spokes, high as tightly packed boxes with thin dark gaps between",
    group: "Form",
    min: 0.15,
    max: 1,
    step: 0.05,
    default: 0.8,
  },
  {
    key: "lenBase",
    label: "Base length",
    description: "How far every box stands off the sphere before the spectrum adds to it, as a fraction of the ball's own radius",
    group: "Form",
    min: 0,
    max: 0.4,
    step: 0.01,
    default: 0.12,
  },
  {
    key: "lenAudio",
    label: "Length reactivity",
    description: "How far a box's length swings with its ring's own frequency band, as a fraction of the ball's own radius",
    group: "Form",
    min: 0,
    max: 0.6,
    step: 0.02,
    default: 0.22,
    auto: { dynamics: 0.3 },
  },
  {
    key: "jitter",
    label: "Jitter",
    description: "Per-frame length flicker at the box ends",
    group: "Form",
    min: 0,
    max: 0.3,
    step: 0.01,
    default: 0.03,
    auto: { density: 0.25 },
  },
  {
    key: "spin",
    label: "Spin",
    description: "Camera roll about its own view axis, degrees/second (negative = clockwise)",
    group: "Motion",
    min: -60,
    max: 60,
    step: 1,
    default: -20,
  },
  {
    key: "drift",
    label: "Drift",
    description: "Runs the camera's out-and-in dolly as a slow, free-running cycle instead of holding still at the Dolly slider",
    group: "Motion",
    type: "boolean",
    min: 0,
    max: 1,
    step: 1,
    default: 1,
  },
  {
    key: "hueRate",
    label: "Hue rate",
    description: "How fast the colour sweeps -- scales with how loud/driven the music is, and locks to one turn per bar once tempo is held",
    group: "Motion",
    min: 0,
    max: 1.2,
    step: 0.05,
    default: 0.4,
    auto: { tempo: 0.25, pulse: 0.2 },
  },
  {
    key: "pastel",
    label: "Pastel",
    description: "Pulls box colour toward a light pearl tone",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.55,
  },
  {
    key: "iridescence",
    label: "Iridescence",
    description: "A per-face hue shimmer, from each wall's own facing direction",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
  },
  {
    key: "rim",
    label: "Rim",
    description: "How far the lit band at each box's open end reaches back along its length, beyond the open end itself (which is always lit)",
    group: "Look",
    min: 0,
    max: 3,
    step: 0.1,
    default: 0.3,
  },
  {
    key: "crossGain",
    label: "Axis cross",
    description: "How much brighter and longer the four axis-aligned spokes of boxes are than the rest",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 0.8,
  },
  {
    key: "shellGain",
    label: "Backdrop shell",
    description: "Brightness of the larger, dim shell of inward-facing boxes behind the ball, visible when the camera is far",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    // Round 2: the far view's own dense look leans heavily on the shell
    // filling in beyond the ball's own limb (where a pole-axis camera
    // necessarily forecomes the meridian cross-section near the visible
    // horizon -- see lattice.ts's CAM_FAR comment) -- at less than full gain
    // the dome read as sparse/gappy at its own edge.
    default: 1,
  },
  {
    key: "dolly",
    label: "Dolly",
    description: "Camera distance -- 0 sits just above the ball for the starburst view, 1 pulls back to the dome view",
    group: "Camera",
    min: 0,
    max: 1,
    step: 0.01,
    default: 0,
  },
  {
    key: "fov",
    label: "Field of view",
    description: "Camera field of view, degrees -- wider makes the near view's walls converge harder",
    group: "Camera",
    min: 40,
    max: 120,
    step: 1,
    default: 90,
  },
  {
    key: "glow",
    label: "Glow",
    description: "Bloom strength",
    group: "Post",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1.2,
  },
];

function settingFor(key: string): SceneSetting {
  const spec = SETTINGS.find((s) => s.key === key);
  if (!spec) throw new Error(`tessera: unknown setting "${key}"`);
  return spec;
}

const settingsUniformsGlsl = SETTINGS.map((s) => `uniform float ${settingUniformName(s.key)};`).join("\n");

const BG_FRAG = bgFrag(COMMON_UNIFORMS_GLSL, settingsUniformsGlsl, ROOM_UV_GLSL);
const BOX_VERT = boxVert(COMMON_UNIFORMS_GLSL, settingsUniformsGlsl);
const BOX_FRAG = boxFrag(COMMON_UNIFORMS_GLSL, settingsUniformsGlsl);
const COMPOSITE_FRAG = compositeFrag(COMMON_UNIFORMS_GLSL, settingsUniformsGlsl);

export const tesseraScene: Scene = (() => {
  let bgProg: GLProgram | null = null;
  let boxProg: GLProgram | null = null;
  let blurProg: GLProgram | null = null;
  let compositeProg: GLProgram | null = null;
  let quadVao: WebGLVertexArrayObject | null = null;
  let emptyVao: WebGLVertexArrayObject | null = null;
  // Full-res sharp target with depth, half-res blur pair -- shards.ts's shape.
  let sharpTex: WebGLTexture | null = null;
  let sharpFbo: WebGLFramebuffer | null = null;
  let depthRb: WebGLRenderbuffer | null = null;
  let blurTexA: WebGLTexture | null = null;
  let blurTexB: WebGLTexture | null = null;
  let blurFboA: WebGLFramebuffer | null = null;
  let blurFboB: WebGLFramebuffer | null = null;
  let sharpW = 0;
  let sharpH = 0;
  const samplerLocs = new Map<string, WebGLUniformLocation | null>();
  let rollRad = 0;
  let hueClock: HueClockState = createHueClockState();
  const bandsBuf = new Float32Array(NUM_BANDS);
  // A ring's length reads this, not frame.bands directly (uploadCommonUniforms
  // already puts the raw array in uBands for anything else that wants it).
  // uBands is fresh every tick, and its swing over even one real render frame
  // is large enough that the length formula would resize a box's whole
  // visible length rather than just flicker its tip -- see glsl.ts's
  // sampleSmoothBands. BAND_SMOOTH_TAU is chosen to still track the music's
  // envelope over the course of a second or so (matching "continuous
  // activity, no beat flash" in the file header) while damping the noise a
  // single tick-to-tick jump would otherwise show.
  const smoothBands = new Float32Array(NUM_BANDS);
  const BAND_SMOOTH_TAU = 0.4;
  // The lattice layout's uniform arrays, sized once to MAX_RINGS(+1) and
  // refilled from latticeLayout() every frame (glsl.ts's boxVert reads
  // uRingStart/uRingSlots/uRingCount) -- module-level so a live Pitch/Fold
  // change never allocates mid-render.
  const ringStartBuf = new Float32Array(MAX_RINGS + 1);
  const ringSlotsBuf = new Float32Array(MAX_RINGS);

  /** GLProgram has no integer setter; samplers need one (shards.ts/powder.ts idiom). */
  function samplerLoc(gl: WebGL2RenderingContext, prog: GLProgram, key: string, name: string) {
    let l = samplerLocs.get(key);
    if (l === undefined) {
      l = gl.getUniformLocation(prog.program, name);
      samplerLocs.set(key, l);
    }
    return l;
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

  function attachColour(gl: WebGL2RenderingContext, tex: WebGLTexture | null, depth: WebGLRenderbuffer | null) {
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (depth) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`tessera: framebuffer incomplete (0x${status.toString(16)})`);
    }
    return f;
  }

  function freeTargets(gl: WebGL2RenderingContext): void {
    if (sharpFbo) gl.deleteFramebuffer(sharpFbo);
    if (blurFboA) gl.deleteFramebuffer(blurFboA);
    if (blurFboB) gl.deleteFramebuffer(blurFboB);
    if (sharpTex) gl.deleteTexture(sharpTex);
    if (blurTexA) gl.deleteTexture(blurTexA);
    if (blurTexB) gl.deleteTexture(blurTexB);
    if (depthRb) gl.deleteRenderbuffer(depthRb);
    sharpFbo = blurFboA = blurFboB = null;
    sharpTex = blurTexA = blurTexB = null;
    depthRb = null;
    sharpW = sharpH = 0;
  }

  /** Rebuilt whenever the drawing buffer changes size (the governor moves
   *  renderScale at runtime, so this can't be decided once at init). */
  function ensureTargets(gl: WebGL2RenderingContext): void {
    const w = Math.max(1, gl.drawingBufferWidth);
    const h = Math.max(1, gl.drawingBufferHeight);
    if (w === sharpW && h === sharpH && sharpFbo) return;
    freeTargets(gl);
    sharpW = w;
    sharpH = h;
    sharpTex = makeTexture(gl, w, h);
    depthRb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthRb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    sharpFbo = attachColour(gl, sharpTex, depthRb);
    const hw = Math.max(1, w >> 1);
    const hh = Math.max(1, h >> 1);
    blurTexA = makeTexture(gl, hw, hh);
    blurTexB = makeTexture(gl, hw, hh);
    blurFboA = attachColour(gl, blurTexA, null);
    blurFboB = attachColour(gl, blurTexB, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  return {
    id: ID,
    name: "Tessera",
    minQuality: "low",
    settings: SETTINGS,

    init(ctx: SceneContext) {
      const { gl } = ctx;
      bgProg = createProgram(gl, BG_FRAG);
      boxProg = createProgram(gl, BOX_FRAG, BOX_VERT);
      blurProg = createProgram(gl, BLUR_FRAG);
      compositeProg = createProgram(gl, COMPOSITE_FRAG);
      quadVao = createFullscreenQuad(gl);
      // No vertex attributes at all -- corner from gl_VertexID, ring/slot
      // from gl_InstanceID -- so the boxes draw from an empty VAO
      // (ambience.ts's DOT_VERT, shards.ts's prisms).
      emptyVao = gl.createVertexArray();
      samplerLocs.clear();
      rollRad = 0;
      hueClock = createHueClockState();
      smoothBands.fill(0);
    },

    render(ctx, frame, viewport, palette, anim) {
      if (!bgProg || !boxProg || !blurProg || !compositeProg || !quadVao || !emptyVao) return;
      const { gl } = ctx;

      // resolveSceneSetting (not getSceneSetting) everywhere -- a raw read
      // would re-stomp an auto-tuned slider back to manual (autoTune.ts).
      const pitchRaw = resolveSceneSetting(ID, settingFor("pitch"));
      const fold = resolveSceneSetting(ID, settingFor("fold"));
      // Lower quality tiers thin the lattice by widening its effective pitch
      // (fewer, bigger rings) rather than touching the Pitch setting itself
      // -- ctx.quality.detail runs 0.25 (floor) .. 1 (high), same shape the
      // old rings-count scaling used.
      const detailScale = 0.5 + 0.5 * ctx.quality.detail;
      const pitch = pitchRaw / Math.max(0.3, detailScale);
      const layout = latticeLayout(pitch, fold);
      for (let i = 0; i <= MAX_RINGS; i++) ringStartBuf[i] = i <= layout.ringCount ? layout.ringStart[i] : layout.ringStart[layout.ringCount];
      for (let i = 0; i < MAX_RINGS; i++) ringSlotsBuf[i] = i < layout.ringCount ? layout.slots[i] : 1;
      const ringInstances = layout.ringStart[layout.ringCount];

      const spin = resolveSceneSetting(ID, settingFor("spin"));
      const driftOn = resolveSceneSetting(ID, settingFor("drift")) > 0.5;
      const hueRate = resolveSceneSetting(ID, settingFor("hueRate"));
      const dollySetting = resolveSceneSetting(ID, settingFor("dolly"));
      const fov = resolveSceneSetting(ID, settingFor("fov"));
      const glow = resolveSceneSetting(ID, settingFor("glow"));

      rollRad += ((spin * Math.PI) / 180) * anim.dtSec;
      const hueValue = advanceHueClock(hueClock, anim.dtSec, anim.sectionIntensity, anim.tempoLock, anim.barPhase, hueRate);

      const bandK = 1 - Math.exp(-Math.max(0, anim.dtSec) / BAND_SMOOTH_TAU);
      for (let i = 0; i < NUM_BANDS; i++) smoothBands[i] += (frame.bands[i] - smoothBands[i]) * bandK;

      const dolly = effectiveDolly(dollySetting, driftOn, anim.timeSec);
      const camDist = camDistanceForDolly(dolly);
      const focal = focalFromFovDeg(fov);
      const cam = cameraBasis(camDist, rollRad);
      // The background's dots/rays gate on the ball's own screen radius, but
      // screenBallRadius() only measures the bare BALL_RADIUS sphere -- with
      // the boxes' own length extending past it, the picture's real edge
      // sits a bit further out than that, so BG_TYPICAL_LEN pads the gate by
      // a middling (not worst-case) box length -- the gap only has to clear
      // the *typical* picture, not every loud-beat outlier.
      const ballScreenR = screenBallRadius(camDist, BALL_RADIUS + BG_TYPICAL_LEN, focal);
      const shellVis = shellVisibility(camDist);

      const useBloom = ctx.quality.bloomPasses > 0 && glow > 0.01;
      if (useBloom) ensureTargets(gl);
      gl.bindFramebuffer(gl.FRAMEBUFFER, useBloom ? sharpFbo : null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

      // 1. Background: opaque, covers the frame (previewRenderer.ts -- the
      // gallery never clears). Sparse dots and axis rays, held in the ball's
      // own rotating frame.
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      bgProg.use();
      uploadCommonUniforms(bgProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      bgProg.setF("uRoll", rollRad);
      bgProg.setF("uBallScreenR", ballScreenR);
      drawFullscreenQuad(gl, quadVao);

      // 2. Boxes, depth-tested. This scene owns clearing its own depth each
      // frame (gl.ts docs no one else clears it); back-face culling stays
      // off (the default) so the open tube interiors show through.
      gl.depthMask(true);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.bindVertexArray(emptyVao);
      boxProg.use();
      uploadCommonUniforms(boxProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      boxProg.setFv("uSmoothBands", smoothBands);
      boxProg.setFv("uRingStart", ringStartBuf);
      boxProg.setFv("uRingSlots", ringSlotsBuf);
      boxProg.setF("uRingCount", layout.ringCount);
      boxProg.setV3v("uCamPos", cam.pos);
      boxProg.setV3v("uCamRight", cam.right);
      boxProg.setV3v("uCamUp", cam.up);
      boxProg.setV3v("uCamFwd", cam.fwd);
      boxProg.setF("uFocal", focal);
      boxProg.setF("uHueClock", hueValue);

      // 2a. The dim backdrop shell first (further out, inward-facing) --
      // skipped entirely once it's shaded fully invisible (shellVis ~= 0,
      // close dolly). Round 2: SHELL_RADIUS shrank a great deal to match the
      // new, much closer CAM_FAR, so at near dolly the shell sphere can sit
      // *closer* to the camera than the ball's own boxes -- still drawing it
      // would write real depth with a black (shade=0) colour, silently
      // occluding the ball behind it even though nothing visible is there.
      if (shellVis > 0.01) {
        boxProg.setF("uShell", 1);
        boxProg.setF("uShellVis", shellVis);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, BOX_VERTS, ringInstances);
      }

      // 2b. The ball itself, plus its trailing white pole instance.
      boxProg.setF("uShell", 0);
      boxProg.setF("uShellVis", 0);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, BOX_VERTS, layout.total);

      gl.bindVertexArray(null);
      gl.disable(gl.DEPTH_TEST);

      if (useBloom) {
        // 3. Halo: full-res sharp -> half-res A (horizontal) -> B (vertical).
        const hw = Math.max(1, sharpW >> 1);
        const hh = Math.max(1, sharpH >> 1);
        blurProg.use();
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(samplerLoc(gl, blurProg, "blur.uTex", "uTex"), 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, blurFboA);
        gl.viewport(0, 0, hw, hh);
        gl.bindTexture(gl.TEXTURE_2D, sharpTex);
        blurProg.setV2("uBlurStep", BLUR_STRIDE_X / sharpW, 0);
        blurProg.setF("uThreshold", BLOOM_THRESHOLD);
        drawFullscreenQuad(gl, quadVao);
        gl.bindFramebuffer(gl.FRAMEBUFFER, blurFboB);
        gl.bindTexture(gl.TEXTURE_2D, blurTexA);
        blurProg.setV2("uBlurStep", 0, BLUR_STRIDE_Y / hh);
        blurProg.setF("uThreshold", 0);
        drawFullscreenQuad(gl, quadVao);

        // 4. Composite on the default framebuffer.
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        compositeProg.use();
        uploadCommonUniforms(compositeProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sharpTex);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, blurTexB);
        gl.uniform1i(samplerLoc(gl, compositeProg, "comp.uSharpTex", "uSharpTex"), 0);
        gl.uniform1i(samplerLoc(gl, compositeProg, "comp.uBlurTex", "uBlurTex"), 1);
        drawFullscreenQuad(gl, quadVao);
        gl.activeTexture(gl.TEXTURE0);
      }

      // The gallery renders every scene into one shared context each tick --
      // must not leak depth, blend or a bound VAO onto the next tile.
      gl.bindVertexArray(null);
      gl.depthMask(true);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ZERO);
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      bgProg?.dispose();
      boxProg?.dispose();
      blurProg?.dispose();
      compositeProg?.dispose();
      if (quadVao) gl.deleteVertexArray(quadVao);
      if (emptyVao) gl.deleteVertexArray(emptyVao);
      freeTargets(gl);
      bgProg = boxProg = blurProg = compositeProg = null;
      quadVao = emptyVao = null;
      samplerLocs.clear();
    },
  };
})();
