import type { FeatureFrame } from "../audio/types.ts";
import type { AnimFrame } from "./animClock.ts";
import { createCrossfade, type Crossfade, type CrossfadeOptions, type CrossfadeView } from "./crossfade.ts";
import type { SceneDrives } from "./drives.ts";
import { createFullscreenQuad, createProgram, drawFullscreenQuad, type GLProgram } from "./gl.ts";
import { effectLook, NO_EFFECTS, stepFade, strobeBeatPhase, type EffectLook, type HeldEffects } from "./heldEffects.ts";
import type { Palette } from "./palette.ts";
import type { Scene, SceneContext, Viewport } from "./scene.ts";

/**
 * "Draw this frame": the one place app.ts, output.ts and tv.ts call instead of
 * a bare `scene.render(...)`. It adds two things on top of a scene — a
 * crossfade from the scene that was on screen to the one that replaced it
 * (timing: crossfade.ts), and the held effects (heldEffects.ts) — and when
 * neither is in play it IS a bare `scene.render(...)`: no viewport call, no
 * texture, no pass, nothing extra on the GPU, the same pixels as before.
 *
 * Scenes draw straight into the default framebuffer, and many bind
 * framebuffer null at the end of their own passes, so their target cannot be
 * redirected. Capturing is done with blits instead: render a scene, blit the
 * default framebuffer into a texture (legal because the canvas is not
 * multisampled — see pictureReadback.ts's header), render the next, then draw
 * a tiny pass of our own into the default framebuffer that mixes the two
 * captures and applies the effects (heldEffects.ts's EffectLook).
 * The default framebuffer is cleared before each scene of a pair, since a
 * scene that does not clear would otherwise paint over the other one's picture.
 *
 * Crossfade. The caller mounts the new scene next to the old one and calls
 * `begin(outgoing)`; the outgoing scene stays mounted and is drawn (with its
 * own drives, `drivesFor`) until the blend is done, when `onOutgoingDone`
 * tells the caller to unmount it. Until the beat the blend waits for, only the
 * outgoing scene is drawn. A scene never crossfades with itself, so the caller
 * only begins one for a different scene. `cancel()` drops the outgoing scene
 * at once (a new scene change mid-blend, leaving for the gallery, a remount).
 * A frame with two scenes is the expensive one: `render` says so
 * (`governable: false`) and the caller skips the quality governor for it, or
 * the doubled cost would step quality down for good.
 *
 * Freeze. Engaging it captures the finished picture (crossfade included, other
 * effects not) once; while held, that texture is presented and the scene is not
 * rendered at all, so the scene carries on from where it was on release.
 *
 * Afterwards the GL state is what scenes expect: framebuffer null, BLEND,
 * DEPTH_TEST, SCISSOR_TEST and CULL_FACE off, texture unit 0 active with
 * nothing of ours bound, the viewport the full canvas. Capture textures follow
 * the canvas size (the freeze texture keeps the size it was taken at). If our
 * own program or a texture cannot be built on this GPU, effects switch off and
 * a crossfade becomes a cut, instead of throwing into the render loop.
 * A lost GL context is handled by the page reload gl.ts's watchContextLoss
 * arranges, so nothing here tries to rebuild.
 */

export interface CompositorFrame {
  ctx: SceneContext;
  /** The scene that should be on screen now (the incoming one during a crossfade). */
  scene: Scene;
  frame: FeatureFrame;
  viewport: Viewport;
  palette: Palette;
  /** The latched AnimFrame the scene gets — its metronomeBeat edge is what a crossfade waits for. */
  anim: AnimFrame;
  /** `scene`'s own drives. */
  drives: SceneDrives;
  /** The drives of any other scene (the outgoing one), built on demand. */
  drivesFor(scene: Scene): SceneDrives;
  nowMs: number;
}

export interface RenderOutcome {
  /** False for a frame the quality governor must not count: two scenes drawn,
   *  or none (frozen). */
  governable: boolean;
}

export interface Compositor {
  /** Replaces the engaged held effects (ui/effectControls.ts on the main
   *  window, the `effects` message on the output). */
  setEffects(effects: HeldEffects): void;
  /** Starts a crossfade from `outgoing` to the scene `render` is given. Ends
   *  any crossfade already running first (see cancel). */
  begin(outgoing: Scene, opts?: CrossfadeOptions): void;
  /** Ends a crossfade at once, dropping the outgoing scene (onOutgoingDone). */
  cancel(): void;
  transitioning(): boolean;
  render(f: CompositorFrame): RenderOutcome;
  dispose(): void;
}

export interface CompositorOptions {
  /** A crossfade ended (or was cancelled): the caller unmounts this scene. */
  onOutgoingDone(scene: Scene): void;
}

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}

const PASS_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uB;
uniform sampler2D uA;
uniform float uMix;
uniform float uInvert;
uniform float uFlash;
uniform float uBlack;
out vec4 o;
void main() {
  vec3 c = mix(texture(uA, vUv).rgb, texture(uB, vUv).rgb, uMix);
  if (uInvert > 0.5) c = 1.0 - c;
  c = mix(c, vec3(1.0), uFlash);
  c *= 1.0 - uBlack;
  o = vec4(c, 1.0);
}`;

const NO_LOOK: EffectLook = { invert: false, flash: 0, black: 0 };
/** A frame gap longer than this is a stall, not time passing for a fade. */
const MAX_FADE_STEP_MS = 100;

function makeTarget(gl: WebGL2RenderingContext, w: number, h: number): Target {
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  if (!tex || !fbo) throw new Error("compositor: could not create a capture target");
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(tex);
    throw new Error(`compositor: capture framebuffer incomplete (0x${status.toString(16)})`);
  }
  return { tex, fbo, w, h };
}

function freeTarget(gl: WebGL2RenderingContext, t: Target | null): null {
  if (t) {
    gl.deleteFramebuffer(t.fbo);
    gl.deleteTexture(t.tex);
  }
  return null;
}

export function createCompositor(gl: WebGL2RenderingContext, opts: CompositorOptions): Compositor {
  let transition: { crossfade: Crossfade; outgoing: Scene } | null = null;
  let effects: HeldEffects = NO_EFFECTS;
  let blackLevel = 0;
  let lastNowMs: number | null = null;
  /** The outgoing capture (only during a blend), the live picture, and the frozen one. */
  let capA: Target | null = null;
  let capB: Target | null = null;
  let frozen: Target | null = null;
  let program: GLProgram | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  /** Our own GL objects could not be built here: effects off, crossfade a cut. */
  let broken = false;

  function fail(err: unknown): void {
    if (!broken) console.warn("Compositor: effects and crossfades are off on this GPU:", err);
    broken = true;
    capA = freeTarget(gl, capA);
    capB = freeTarget(gl, capB);
    frozen = freeTarget(gl, frozen);
  }

  function ensureProgram(): void {
    if (program) return;
    program = createProgram(gl, PASS_FRAG);
    program.use();
    gl.uniform1i(gl.getUniformLocation(program.program, "uB"), 0);
    gl.uniform1i(gl.getUniformLocation(program.program, "uA"), 1);
    gl.useProgram(null);
    vao = createFullscreenQuad(gl);
  }

  /** `t`, sized to the canvas (re-made on a resize). */
  function sized(t: Target | null): Target {
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    if (t && t.w === w && t.h === h) return t;
    freeTarget(gl, t);
    return makeTarget(gl, w, h);
  }

  /** Renders `scene` onto a cleared canvas and blits what it drew into `into`. */
  function drawSceneInto(f: CompositorFrame, scene: Scene, into: Target): void {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    scene.render(f.ctx, f.frame, f.viewport, f.palette, f.anim, scene === f.scene ? f.drives : f.drivesFor(scene));
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, into.fbo);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, into.w, into.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Mixes `a` -> `b` by `mix` (1 = only `b`) with `look`'s effects into
   *  `into` (null = the canvas), then puts the GL state back for the scenes. */
  function pass(into: Target | null, a: Target, b: Target, mix: number, look: EffectLook): void {
    gl.bindFramebuffer(gl.FRAMEBUFFER, into ? into.fbo : null);
    gl.viewport(0, 0, into ? into.w : gl.drawingBufferWidth, into ? into.h : gl.drawingBufferHeight);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.CULL_FACE);
    gl.colorMask(true, true, true, true);
    const p = program!;
    p.use();
    p.setF("uMix", mix);
    p.setF("uInvert", look.invert ? 1 : 0);
    p.setF("uFlash", look.flash);
    p.setF("uBlack", look.black);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, a.tex);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, b.tex);
    drawFullscreenQuad(gl, vao!);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.useProgram(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  }

  function finish(): void {
    const t = transition;
    if (!t) return;
    transition = null;
    capA = freeTarget(gl, capA);
    opts.onOutgoingDone(t.outgoing);
  }

  const compositor: Compositor = {
    setEffects(next) {
      if (effects.freeze && !next.freeze) frozen = freeTarget(gl, frozen);
      effects = next;
    },
    begin(outgoing, o) {
      finish();
      transition = { crossfade: createCrossfade(o), outgoing };
    },
    cancel: finish,
    transitioning: () => transition !== null,

    render(f) {
      const dtMs = lastNowMs === null ? 0 : Math.min(MAX_FADE_STEP_MS, Math.max(0, f.nowMs - lastNowMs));
      lastNowMs = f.nowMs;
      blackLevel = stepFade(blackLevel, effects.blackout, dtMs);

      let view: CrossfadeView | null = null;
      if (transition) {
        view = transition.crossfade.step(f.nowMs, { tempoOn: f.anim.metronomeOn, bpm: f.anim.metronomeBpm, beat: f.anim.metronomeBeat });
        if (view.stage === "done") {
          finish();
          view = null;
        }
      }
      // Without our own program a crossfade is a cut: the outgoing scene goes
      // as soon as it would have started to blend.
      if (broken && transition && view && view.stage === "blend") {
        finish();
        view = null;
      }
      const blend = !broken && view !== null && view.stage === "blend";
      const fx = broken ? NO_EFFECTS : effects;
      const needsPass = blend || fx.invert || fx.strobe || fx.freeze || blackLevel > 0;

      if (!needsPass) {
        // The outgoing scene alone while a blend waits for its beat, else the scene.
        const only = transition && view ? transition.outgoing : f.scene;
        only.render(f.ctx, f.frame, f.viewport, f.palette, f.anim, only === f.scene ? f.drives : f.drivesFor(only));
        return { governable: true };
      }

      try {
        ensureProgram();
        const look = effectLook(
          fx,
          blackLevel,
          strobeBeatPhase({ tempoOn: f.anim.metronomeOn, metronomePhase: f.anim.metronomePhase, timeSec: f.anim.timeSec }),
        );
        if (fx.freeze && frozen) {
          pass(null, frozen, frozen, 1, look);
          return { governable: false };
        }
        capB = sized(capB);
        let mix = 1;
        let a = capB;
        if (blend && transition && view) {
          capA = sized(capA);
          drawSceneInto(f, transition.outgoing, capA);
          a = capA;
          mix = view.mix;
        } else {
          capA = freeTarget(gl, capA);
        }
        // While a blend waits for its beat the picture is the outgoing scene alone.
        const shown = !blend && transition && view ? transition.outgoing : f.scene;
        drawSceneInto(f, shown, capB);
        if (fx.freeze) {
          frozen = makeTarget(gl, capB.w, capB.h);
          pass(frozen, a, capB, mix, NO_LOOK);
        }
        pass(null, a, capB, mix, look);
        return { governable: !blend };
      } catch (err) {
        fail(err);
        // Whatever the failure left half-drawn is replaced by a plain frame.
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        f.scene.render(f.ctx, f.frame, f.viewport, f.palette, f.anim, f.drives);
        return { governable: false };
      }
    },

    dispose() {
      finish();
      capA = freeTarget(gl, capA);
      capB = freeTarget(gl, capB);
      frozen = freeTarget(gl, frozen);
      program?.dispose();
      program = null;
      if (vao) gl.deleteVertexArray(vao);
      vao = null;
    },
  };
  return compositor;
}
