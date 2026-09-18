/**
 * Slats — a wall of hundreds of thin translucent white vertical slices,
 * grouped into flat-topped slabs of distinct heights fringed with tall
 * "hair" singletons, seen in shallow perspective and continuously
 * re-forming. Built from `/ref` on the YouTube short qtPi0JvmWbs (its
 * 0:15-0:20 span) — see the plan this shipped from for the frame-by-frame
 * measurements this scene's constants come from.
 *
 * What it syncs to, and why: every sync hypothesis in that plan came from
 * correlating the reference's own picture against its audio, then checking
 * what this app's analyser actually reproduces (hears.json's "ours:"
 * verdicts) — so what drives this scene below is exactly what that check
 * confirmed, not everything the reference merely *looked* like it was
 * doing:
 *  - Every beat kicks slab height and slat brightness (the `pulse` setting)
 *    off `anim.onset` — the render-latched one-shot edge, never
 *    FeatureFrame.onset directly (a render-capped tick can drop a raw
 *    onset; see renderLatch.ts). `layout.ts`'s OnsetEnvelope turns that
 *    edge into the fast-decay kick both the vertex shader's height term and
 *    the fragment's brightness punch read.
 *  - Band thickness (`slabHeight`) and flutter speed/amount (`flutter`)
 *    track `anim.energy`/`anim.high` continuously, not on a trigger.
 *  - The layout reforms continuously (the `morph` crossfade between two
 *    instanced slat buffers) and can also restart early at a bar boundary
 *    (`reshuffle`, gated by `layout.ts`'s shouldReshuffle) — deliberately
 *    NOT locked to beat/bar *phase* the way a bar-synced zoom would be:
 *    AnimFrame carries no phrase counter, and the reference clip's own
 *    tempo never locked when measured, so nothing here assumes a phase
 *    relationship the audio pipeline can't actually promise. A bar wrap is
 *    used only as an occasional gate, not a clock the geometry rides.
 *  - `kickDip` is a small, optional brightness dip against `anim.lowPulse` —
 *    the one hypothesis in the plan that came from a single correlated run,
 *    kept modest for exactly that reason.
 *
 * Geometry (glsl.ts's SLAT_VERT): a wall in the xz-plane, camera at the
 * origin yawed by `vanish` so the perspective's vanishing point sits off
 * centre, a shallow per-slab depth (`layers`) and a right-edge curl
 * (`curve`). Depth spread is kept small next to the wall's own distance
 * from the camera, so size stays close to flat across the wall — the
 * reference measured almost no size-vs-depth falloff. A slat's own
 * thickness is a near-constant screen-pixel width regardless of depth
 * (glsl.ts's SLAT_HALF_WIDTH_PX); only `slabWidth` (read in this file's
 * `currentPartitionOptions`) changes how wide the slabs its slats are
 * grouped into are.
 *
 * Layout (layout.ts): `buildWall` runs one `partitionSlabs` per depth
 * layer — contiguous slabs, each with its own height, vertical offset and
 * translucency, some left empty (GAP_FRACTION) — so slabs on different
 * layers overlap in x and stack toward white; `layoutSlats` spreads this
 * scene's slat budget across them in flat step runs, jitters each slat's
 * alpha so slices read as stripes, and marks a fraction as "hairs" — the
 * reference's tall singleton fringe. Two full slat layouts (A/B) live in real instanced
 * vertex buffers (divisor 1) at once; the vertex shader crossfades between
 * them by `uMorphMix` (named apart from the `morph` setting, which is the
 * crossfade's duration in seconds, not its live progress — the same
 * uniform name would otherwise collide, since sceneCommon.ts's
 * uploadCommonUniforms auto-uploads every setting as u<Key>). When a fade
 * completes, A is replaced by what B was and a fresh B is drawn from the
 * scene's running RNG — so the wall never stops re-forming, exactly like
 * the reference.
 *
 * Rendering: slats draw premultiplied ("over") onto the `ground` clear
 * colour, so overlapping slices saturate toward white the way alpha
 * compositing already does on its own — no extra brightness math needed for
 * that part of the look. Above `quality.bloomPasses` zero, that pass goes
 * to a full-resolution offscreen target so the composite can add a
 * separately blurred, half-resolution glow on top (`glow`) without
 * softening the sharp slat edges the reference's crisp slices need; at
 * zero bloom passes the scene skips the offscreen chain entirely and draws
 * straight to the default framebuffer.
 */
import { NUM_BANDS } from "../../../audio/types.ts";
import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../../gl.ts";
import type { Scene, SceneContext } from "../../scene.ts";
import { uploadCommonUniforms } from "../../sceneCommon.ts";
import { resolveSceneSetting } from "../../autoTune.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import { SETTINGS, SLAT_VERT, SLAT_FRAG, BLUR_FRAG, COMPOSITE_FRAG, BLUR_STRIDE } from "./glsl.ts";
import {
  createRng,
  buildWall,
  packSlats,
  SLAT_STRIDE,
  createOnsetEnvelope,
  advanceOnsetEnvelope,
  shouldReshuffle,
  type Rng,
  type PartitionOptions,
} from "./layout.ts";

const ID = "slats";

const SETTINGS_BY_KEY = new Map<string, SceneSetting>(SETTINGS.map((s) => [s.key, s]));
function settingFor(key: string): SceneSetting {
  const spec = SETTINGS_BY_KEY.get(key);
  if (!spec) throw new Error(`slats: unknown setting "${key}"`);
  return spec;
}

// Slat budget: within the plan's ~2000-3000 range at full quality, scaled
// down (never below a floor that still reads as a wall) at lower detail.
const BASE_SLAT_COUNT = 2600;
const MIN_SLAT_COUNT = 300;
// The wall's own x spans exactly [-1, 1] — WALL_HALF_WIDTH (glsl.ts) is
// what turns that into world units, so partitionSlabs never needs to know
// the camera's scale.
const WORLD_WIDTH = 2.0;
// Slab width bounds (as a fraction of WORLD_WIDTH) at the `slabWidth`
// setting's own default (0.5, so WIDTH_SCALE_AT_DEFAULT below is 1).
const MIN_WIDTH_FRAC_BASE = 0.02;
const MAX_WIDTH_FRAC_BASE = 0.1;
const WIDTH_SCALE_AT_DEFAULT = 0.5;
// Hair generation is baked at layout time from fixed constants — not the
// `hair` setting, which instead scales the baked result live in the
// fragment/vertex shaders (glsl.ts), so dragging it responds within a
// frame rather than waiting for the next reform.
const HAIR_FRACTION = 0.18;
const HAIR_SCALE = 0.25;
const HAIR_MAX = 0.6;
// Share of each layer's slabs left empty (layout.ts's gapFraction).
const GAP_FRACTION = 0.2;
// Step runs inside a slab (layout.ts's LayoutOptions): a few flat steps per
// slab, each a modest fraction above or below the slab's own height.
const STEP_MIN = 4;
const STEP_MAX = 18;
const STEP_SPAN = 0.18;
const ALPHA_JITTER = 0.35;
const RNG_SEED = 0x5a17;

function slatCountForQuality(detail: number): number {
  const d = Number.isFinite(detail) ? Math.max(0, Math.min(1, detail)) : 1;
  return Math.max(MIN_SLAT_COUNT, Math.round(BASE_SLAT_COUNT * d));
}

function currentPartitionOptions(): PartitionOptions {
  const slabWidth = resolveSceneSetting(ID, settingFor("slabWidth"));
  const layers = resolveSceneSetting(ID, settingFor("layers"));
  const widthScale = (WIDTH_SCALE_AT_DEFAULT + slabWidth) / (2 * WIDTH_SCALE_AT_DEFAULT);
  return {
    minWidthFrac: MIN_WIDTH_FRAC_BASE * widthScale,
    maxWidthFrac: MAX_WIDTH_FRAC_BASE * widthScale,
    layers,
    gapFraction: GAP_FRACTION,
  };
}

function generateLayout(rng: Rng, n: number): Float32Array {
  const slats = buildWall(rng, WORLD_WIDTH, currentPartitionOptions(), n, {
    hairFraction: HAIR_FRACTION,
    hairScale: HAIR_SCALE,
    hairMax: HAIR_MAX,
    stepMin: STEP_MIN,
    stepMax: STEP_MAX,
    stepSpan: STEP_SPAN,
    alphaJitter: ALPHA_JITTER,
  });
  return packSlats(slats);
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function smoothstep01(x: number): number {
  return x * x * (3 - 2 * x);
}

export const slatsScene: Scene = (() => {
  let slatProg: GLProgram | null = null;
  let blurProg: GLProgram | null = null;
  let compositeProg: GLProgram | null = null;
  let slatVao: WebGLVertexArrayObject | null = null;
  let quadVao: WebGLVertexArrayObject | null = null;
  let bufA: WebGLBuffer | null = null;
  let bufB: WebGLBuffer | null = null;

  // Full-resolution "sharp" target plus a half-resolution separable-blur
  // ping-pong pair — same shape as powder.ts's bloom chain, guarded by
  // quality.bloomPasses (file header).
  let fullTex: WebGLTexture | null = null;
  let fullFbo: WebGLFramebuffer | null = null;
  let halfTexA: WebGLTexture | null = null;
  let halfFboA: WebGLFramebuffer | null = null;
  let halfTexB: WebGLTexture | null = null;
  let halfFboB: WebGLFramebuffer | null = null;
  let fullW = 0;
  let fullH = 0;
  let halfW = 0;
  let halfH = 0;

  const samplerLocs = new Map<string, WebGLUniformLocation | null>();
  const bandsBuf = new Float32Array(NUM_BANDS);

  let rng: Rng = createRng(RNG_SEED);
  let slatCount = 0;
  let packedB: Float32Array = new Float32Array(0);
  let morphT = 0;
  let lastTime: number | null = null;
  let prevBarPhase = 0;
  const onsetEnv = createOnsetEnvelope();

  function samplerLoc(gl: WebGL2RenderingContext, prog: GLProgram, key: string, name: string): WebGLUniformLocation | null {
    let l = samplerLocs.get(key);
    if (l === undefined) {
      l = gl.getUniformLocation(prog.program, name);
      samplerLocs.set(key, l);
    }
    return l;
  }

  function uploadInstanceBuffer(gl: WebGL2RenderingContext, buf: WebGLBuffer, data: Float32Array): void {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  }

  function regenerateB(gl: WebGL2RenderingContext): void {
    packedB = generateLayout(rng, slatCount);
    uploadInstanceBuffer(gl, bufB!, packedB);
  }

  /** A completed the fade: it becomes what B was (re-upload, no new draw —
   *  B's own array is already the source of truth), and a fresh B starts
   *  its own fade in from morphT = 0. */
  function swapAtoB(gl: WebGL2RenderingContext): void {
    uploadInstanceBuffer(gl, bufA!, packedB);
  }

  function makeHalfColourTexture(gl: WebGL2RenderingContext, w: number, h: number): WebGLTexture | null {
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
      throw new Error(`slats: framebuffer incomplete (0x${status.toString(16)})`);
    }
    return f;
  }

  function freeGlowTargets(gl: WebGL2RenderingContext): void {
    if (fullFbo) gl.deleteFramebuffer(fullFbo);
    if (halfFboA) gl.deleteFramebuffer(halfFboA);
    if (halfFboB) gl.deleteFramebuffer(halfFboB);
    if (fullTex) gl.deleteTexture(fullTex);
    if (halfTexA) gl.deleteTexture(halfTexA);
    if (halfTexB) gl.deleteTexture(halfTexB);
    fullFbo = halfFboA = halfFboB = null;
    fullTex = halfTexA = halfTexB = null;
    fullW = fullH = halfW = halfH = 0;
  }

  function ensureGlowTargets(gl: WebGL2RenderingContext): void {
    const w = Math.max(1, gl.drawingBufferWidth);
    const h = Math.max(1, gl.drawingBufferHeight);
    if (w === fullW && h === fullH && fullFbo) return;
    freeGlowTargets(gl);
    fullW = w;
    fullH = h;
    halfW = Math.max(1, w >> 1);
    halfH = Math.max(1, h >> 1);
    fullTex = makeHalfColourTexture(gl, fullW, fullH);
    halfTexA = makeHalfColourTexture(gl, halfW, halfH);
    halfTexB = makeHalfColourTexture(gl, halfW, halfH);
    fullFbo = attachColour(gl, fullTex);
    halfFboA = attachColour(gl, halfTexA);
    halfFboB = attachColour(gl, halfTexB);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  return {
    id: ID,
    name: "Slats",
    settings: SETTINGS,

    init(ctx: SceneContext) {
      const { gl } = ctx;
      slatProg = createProgram(gl, SLAT_FRAG, SLAT_VERT);
      blurProg = createProgram(gl, BLUR_FRAG);
      compositeProg = createProgram(gl, COMPOSITE_FRAG);
      samplerLocs.clear();
      quadVao = createFullscreenQuad(gl);

      slatCount = slatCountForQuality(ctx.quality.detail);
      rng = createRng(RNG_SEED);

      bufA = gl.createBuffer();
      bufB = gl.createBuffer();
      slatVao = gl.createVertexArray();
      gl.bindVertexArray(slatVao);
      const stride = SLAT_STRIDE * 4; // bytes
      gl.bindBuffer(gl.ARRAY_BUFFER, bufA);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, stride, 0);
      gl.vertexAttribDivisor(0, 1);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 16);
      gl.vertexAttribDivisor(1, 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufB);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 0);
      gl.vertexAttribDivisor(2, 1);
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, 16);
      gl.vertexAttribDivisor(3, 1);
      gl.bindVertexArray(null);

      uploadInstanceBuffer(gl, bufA, generateLayout(rng, slatCount));
      regenerateB(gl);

      morphT = 0;
      lastTime = null;
      prevBarPhase = 0;
      onsetEnv.value = 0;
    },

    render(ctx, frame, viewport, palette, anim) {
      if (!slatProg || !blurProg || !compositeProg || !slatVao || !quadVao || !bufA || !bufB) return;
      const { gl } = ctx;

      // Own delta from anim.timeSec rather than anim.dtSec: the gallery
      // preview hands render() an un-latched anim, and this form behaves in
      // both hosts — same reasoning as ambience.ts/powder.ts/caustics.ts.
      const dt = lastTime === null ? 1 / 60 : Math.max(0, Math.min(0.25, anim.timeSec - lastTime));
      lastTime = anim.timeSec;

      advanceOnsetEnvelope(onsetEnv, dt, anim.onset);

      const morphSeconds = resolveSceneSetting(ID, settingFor("morph"));
      const reshuffleProb = resolveSceneSetting(ID, settingFor("reshuffle"));

      if (shouldReshuffle(prevBarPhase, anim.barPhase, anim.tempoLock, reshuffleProb, rng)) {
        regenerateB(gl);
        morphT = 0;
      }
      prevBarPhase = anim.barPhase;

      morphT += dt / Math.max(0.05, morphSeconds);
      if (morphT >= 1) {
        swapAtoB(gl);
        regenerateB(gl);
        morphT = 0;
      }
      const morphMix = smoothstep01(clamp01(morphT));
      const ground = resolveSceneSetting(ID, settingFor("ground"));
      const useGlow = ctx.quality.bloomPasses > 0;

      const drawSlats = (prog: GLProgram) => {
        prog.use();
        uploadCommonUniforms(prog, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
        prog.setF("uMorphMix", morphMix);
        prog.setF("uOnsetEnv", onsetEnv.value);
        gl.bindVertexArray(slatVao);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, slatCount);
        gl.bindVertexArray(null);
        gl.disable(gl.BLEND);
      };

      if (useGlow) {
        ensureGlowTargets(gl);

        gl.bindFramebuffer(gl.FRAMEBUFFER, fullFbo);
        gl.viewport(0, 0, fullW, fullH);
        gl.disable(gl.BLEND);
        gl.clearColor(ground, ground, ground, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        drawSlats(slatProg);

        blurProg.use();
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(samplerLoc(gl, blurProg, "blur.uTex", "uTex"), 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, halfFboA);
        gl.viewport(0, 0, halfW, halfH);
        gl.bindTexture(gl.TEXTURE_2D, fullTex);
        blurProg.setV2("uBlurStep", BLUR_STRIDE / halfW, 0);
        blurProg.setF("uSubtract", ground);
        drawFullscreenQuad(gl, quadVao);
        gl.bindFramebuffer(gl.FRAMEBUFFER, halfFboB);
        gl.bindTexture(gl.TEXTURE_2D, halfTexA);
        blurProg.setV2("uBlurStep", 0, BLUR_STRIDE / halfH);
        blurProg.setF("uSubtract", 0);
        drawFullscreenQuad(gl, quadVao);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        compositeProg.use();
        uploadCommonUniforms(compositeProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, fullTex);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, halfTexB);
        gl.uniform1i(samplerLoc(gl, compositeProg, "comp.uSharpTex", "uSharpTex"), 0);
        gl.uniform1i(samplerLoc(gl, compositeProg, "comp.uBlurTex", "uBlurTex"), 1);
        drawFullscreenQuad(gl, quadVao);

        // The gallery renders every scene into one shared context each tick
        // — must not leak a bound texture or a non-default active unit.
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, null);
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.disable(gl.BLEND);
        gl.clearColor(ground, ground, ground, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        drawSlats(slatProg);
      }

      gl.disable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ZERO);
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      slatProg?.dispose();
      blurProg?.dispose();
      compositeProg?.dispose();
      if (slatVao) gl.deleteVertexArray(slatVao);
      if (quadVao) gl.deleteVertexArray(quadVao);
      if (bufA) gl.deleteBuffer(bufA);
      if (bufB) gl.deleteBuffer(bufB);
      freeGlowTargets(gl);
      samplerLocs.clear();
      slatProg = null;
      blurProg = null;
      compositeProg = null;
      slatVao = null;
      quadVao = null;
      bufA = null;
      bufB = null;
      slatCount = 0;
      packedB = new Float32Array(0);
      morphT = 0;
      lastTime = null;
      prevBarPhase = 0;
      onsetEnv.value = 0;
    },
  };
})();
