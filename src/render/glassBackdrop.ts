import { type ColorTarget, createColorTarget, createProgram, destroyTarget, type GLProgram } from "./gl.ts";

/**
 * The panel's frosted glass, drawn by the renderer instead of the browser:
 * Panel blur's "Fast" look (src/ui/glassPref.ts has the three looks and what
 * the browser's own blur costs). The panel reports where its glass surfaces
 * are (src/ui/glassPanes.ts); after the frame is finished, this draws a
 * blurred, colour-graded copy of it into the canvas under each one, and the
 * surfaces themselves drop their CSS backdrop-filter, so the browser has
 * nothing left to re-filter.
 *
 * It copies the browser's blur, measured in Chrome (2026-10-16, a test page
 * at dpr 2): a Gaussian with the CSS radius as its standard deviation, done
 * on the stored sRGB values, not linear light; each surface blurs only what
 * lies under its own border box, mirrored at the box's edges, so nothing
 * from beside a card bleeds into it; a card half scrolled out of its column
 * still blurs its hidden part, and only the visible part is drawn; then the
 * colour chain (`GlassLook`'s saturate, brightness, contrast, in that order,
 * each clamped) on sRGB values with the CSS filter spec's luma weights.
 *
 * The pipeline, once per frame while there is a surface to draw under:
 *
 *   default framebuffer -> halving LINEAR blits -> "small" (texel ~ blur / MIN_SIGMA_TEXELS)
 *     -> per-surface horizontal pass -> "row" -> per-surface vertical pass + colour -> "blurred"
 *     -> per-surface composite into the default framebuffer
 *
 * The halving blits are pictureReadback.ts's: each is an exact 2×2 box
 * average, so the small copy is a clean average of the frame rather than a
 * sparse sample of it. They stop at the level where the blur still spans
 * MIN_SIGMA_TEXELS texels, because a blur that wide hides how coarse its
 * texels are, and the blur passes then cost next to nothing. Each blur pass
 * draws one instanced quad per surface (its border box plus a texel, so the
 * composite's bilinear sample never reads past what was written), and folds
 * every tap back into that surface's box with a mirror. Where two surfaces
 * overlap, the later one in the list wins in both the blur and the
 * composite; the panel's surfaces overlap only while a card is dragged.
 *
 * The composite draws each surface's visible part (its box cut by its clip),
 * with the box's rounded corners and the surface's opacity as coverage,
 * premultiplied, over the frame. It must run after everything that reads the
 * finished frame (the Picture meter's capture, a Freeze or crossfade
 * capture) and after the overlay text, which the browser's blur also sees;
 * app.ts's drawScene() is the one caller. Anything that records the canvas
 * would record the glass too, which is why app.ts turns this off while a
 * clip records.
 *
 * GL state on return is what scenes expect, as in overlayLayer.ts:
 * framebuffer null (read and draw), the full-canvas viewport, blending off
 * with the default function, texture unit 0 with nothing bound, no program
 * or vertex array, depth, cull and scissor off, all colour channels written.
 * If a program or a target cannot be built here, draw() warns once and
 * returns false from then on, and the caller falls back to the browser's
 * blur. After a lost context app.ts disposes it and makes a new one
 * (render/contextRecovery.ts).
 */

/** How the glass looks: the numbers behind the CSS filter chain. */
export interface GlassLook {
  /** Blur radius in CSS px: the Gaussian's standard deviation. */
  blurCssPx: number;
  saturate: number;
  brightness: number;
  contrast: number;
}

/** One glass surface, in CSS px relative to the canvas's own box, with y
 *  pointing down (the DOM's orientation). */
export interface GlassPane {
  /** The border box. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The part of the box that shows (its scrolling column's clip, the canvas). */
  clipX0: number;
  clipY0: number;
  clipX1: number;
  clipY1: number;
  /** Corner radius, CSS px. */
  radius: number;
  /** The surface's opacity, its ancestors' included. */
  alpha: number;
}

export interface GlassBackdrop {
  /** Draws the glass under the first `count` panes into the default
   *  framebuffer. `cssW`/`cssH` are the canvas box's CSS size, which maps a
   *  pane onto the drawing buffer. False once this GPU has failed to build
   *  what it needs (see the file header); nothing is drawn then. */
  draw(panes: readonly GlassPane[], count: number, cssW: number, cssH: number, look: GlassLook): boolean;
  dispose(): void;
}

/** The fewest small-copy texels the blur's standard deviation may span: the
 *  halving stops before a texel grows past blur / this. See the file header. */
export const MIN_SIGMA_TEXELS = 3;
/** Taps each side of a blur pass reach out to this many standard deviations. */
const TAP_SIGMAS = 3;
/** Surfaces drawn per instanced call; more than this take several calls.
 *  Three vec4 arrays of this length must fit the vertex shader's uniforms. */
export const PANES_PER_BATCH = 32;

/** How many halvings the small copy is from a drawing buffer whose blur
 *  standard deviation is `sigmaPx` buffer pixels: the most that still leaves
 *  the blur MIN_SIGMA_TEXELS texels wide, never fewer than none. */
export function halvingsFor(sigmaPx: number): number {
  if (!(sigmaPx > 0)) return 0;
  return Math.max(0, Math.floor(Math.log2(sigmaPx / MIN_SIGMA_TEXELS)));
}

/** The sizes of the halving chain from a `w`×`h` buffer, `n` steps, each
 *  halving floored and never below one pixel (the last is the small copy). */
export function halvingChain(w: number, h: number, n: number): { w: number; h: number }[] {
  const out: { w: number; h: number }[] = [];
  for (let i = 0; i < n; i++) {
    w = Math.max(1, Math.floor(w / 2));
    h = Math.max(1, Math.floor(h / 2));
    out.push({ w, h });
  }
  return out;
}

/** Packs panes `from`..`to` into the shaders' uniform arrays, in drawing-
 *  buffer pixels with GL's origin (bottom left): `rect` the border box,
 *  `quad` the visible part, `misc` the corner radius and alpha. Returns how
 *  many it packed: a pane whose visible part is empty or whose alpha is zero
 *  is left out. */
export function packPanes(
  panes: readonly GlassPane[],
  from: number,
  to: number,
  sx: number,
  sy: number,
  bufH: number,
  rect: Float32Array,
  quad: Float32Array,
  misc: Float32Array,
): number {
  let n = 0;
  for (let i = from; i < to; i++) {
    const p = panes[i];
    if (!(p.alpha > 0) || !(p.w > 0) || !(p.h > 0)) continue;
    const qx0 = Math.max(p.x, p.clipX0);
    const qx1 = Math.min(p.x + p.w, p.clipX1);
    const qy0 = Math.max(p.y, p.clipY0);
    const qy1 = Math.min(p.y + p.h, p.clipY1);
    if (qx1 <= qx0 || qy1 <= qy0) continue;
    const o = n * 4;
    rect[o] = p.x * sx;
    rect[o + 1] = bufH - (p.y + p.h) * sy;
    rect[o + 2] = (p.x + p.w) * sx;
    rect[o + 3] = bufH - p.y * sy;
    quad[o] = qx0 * sx;
    quad[o + 1] = bufH - qy1 * sy;
    quad[o + 2] = qx1 * sx;
    quad[o + 3] = bufH - qy0 * sy;
    misc[o] = p.radius * Math.min(sx, sy);
    misc[o + 1] = Math.min(1, p.alpha);
    misc[o + 2] = 0;
    misc[o + 3] = 0;
    n++;
  }
  return n;
}

const BATCH = String(PANES_PER_BATCH);

// The blur passes: one quad per surface over its box (in small-copy texels)
// plus one texel each side, clamped to the target.
const BLUR_VERT = `#version 300 es
uniform vec4 uRect[${BATCH}];
uniform vec2 uScale;
uniform vec2 uSize;
flat out vec4 vBox;
void main() {
  vec4 b = uRect[gl_InstanceID] * uScale.xyxy;
  vBox = b;
  vec4 q = clamp(b + vec4(-1.0, -1.0, 1.0, 1.0), vec4(0.0), uSize.xyxy);
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  gl_Position = vec4(mix(q.xy, q.zw, c) / uSize * 2.0 - 1.0, 0.0, 1.0);
}`;

// One direction of the Gaussian (uDir), each tap folded back into the
// surface's box by a mirror; the vertical pass (uGrade) adds the colour chain.
const BLUR_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uSize;
uniform vec2 uDir;
uniform float uSigma;
uniform int uTaps;
uniform int uGrade;
uniform vec3 uChain;
flat in vec4 vBox;
out vec4 o;
float mirrored(float p, float lo, float hi) {
  float w = max(hi - lo, 1e-3);
  float q = mod(p - lo, 2.0 * w);
  return lo + (q < w ? q : 2.0 * w - q);
}
void main() {
  vec2 pos = gl_FragCoord.xy;
  float lo = dot(vBox.xy, uDir);
  float hi = dot(vBox.zw, uDir);
  float at = dot(pos, uDir);
  vec2 across = pos - uDir * at;
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  float k2 = -0.5 / (uSigma * uSigma);
  for (int k = -uTaps; k <= uTaps; k++) {
    float fk = float(k);
    float w = exp(fk * fk * k2);
    vec2 s = across + uDir * mirrored(at + fk, lo, hi);
    sum += texture(uSrc, s / uSize).rgb * w;
    wsum += w;
  }
  vec3 c = sum / wsum;
  if (uGrade == 1) {
    float s = uChain.x;
    // CSS saturate(): the filter spec's matrix, applied on sRGB values.
    mat3 sat = mat3(
      0.213 + 0.787 * s, 0.213 - 0.213 * s, 0.213 - 0.213 * s,
      0.715 - 0.715 * s, 0.715 + 0.285 * s, 0.715 - 0.715 * s,
      0.072 - 0.072 * s, 0.072 - 0.072 * s, 0.072 + 0.928 * s);
    c = clamp(sat * c, 0.0, 1.0);
    c = clamp(c * uChain.y, 0.0, 1.0);
    c = clamp((c - 0.5) * uChain.z + 0.5, 0.0, 1.0);
  }
  o = vec4(c, 1.0);
}`;

// The composite: one quad per surface over its visible part.
const COMP_VERT = `#version 300 es
uniform vec4 uRect[${BATCH}];
uniform vec4 uQuad[${BATCH}];
uniform vec4 uMisc[${BATCH}];
uniform vec2 uCanvas;
flat out vec4 vBox;
flat out vec2 vMisc;
void main() {
  vec4 q = uQuad[gl_InstanceID];
  vBox = uRect[gl_InstanceID];
  vMisc = uMisc[gl_InstanceID].xy;
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  gl_Position = vec4(mix(q.xy, q.zw, c) / uCanvas * 2.0 - 1.0, 0.0, 1.0);
}`;

// Rounded-box coverage times the surface's alpha; the blurred copy is read
// no further out than the box, so a texel the blur passes never wrote is
// never seen.
const COMP_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uBlur;
uniform vec2 uScale;
uniform vec2 uSize;
flat in vec4 vBox;
flat in vec2 vMisc;
out vec4 o;
void main() {
  vec2 p = gl_FragCoord.xy;
  vec2 mid = (vBox.xy + vBox.zw) * 0.5;
  vec2 half_ = (vBox.zw - vBox.xy) * 0.5;
  float r = min(vMisc.x, min(half_.x, half_.y));
  vec2 d = abs(p - mid) - (half_ - r);
  float sd = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
  float a = clamp(0.5 - sd, 0.0, 1.0) * vMisc.y;
  vec4 box = vBox * uScale.xyxy;
  vec2 t = clamp(p * uScale, box.xy, box.zw);
  o = vec4(texture(uBlur, t / uSize).rgb * a, a);
}`;

export function createGlassBackdrop(gl: WebGL2RenderingContext): GlassBackdrop {
  let blurProgram: GLProgram | null = null;
  let compProgram: GLProgram | null = null;
  /** The halving chain; its last level is the small copy. */
  let levels: ColorTarget[] = [];
  let row: ColorTarget | null = null;
  let blurred: ColorTarget | null = null;
  /** What the targets were made for. */
  let builtW = 0;
  let builtH = 0;
  let builtHalvings = -1;
  let broken = false;

  const rect = new Float32Array(PANES_PER_BATCH * 4);
  const quad = new Float32Array(PANES_PER_BATCH * 4);
  const misc = new Float32Array(PANES_PER_BATCH * 4);
  const gradeUniform = new Float32Array(3);

  function freeTargets(): void {
    for (const t of levels) destroyTarget(gl, t);
    levels = [];
    destroyTarget(gl, row);
    destroyTarget(gl, blurred);
    row = null;
    blurred = null;
    builtHalvings = -1;
  }

  function fail(err: unknown): void {
    if (!broken) console.warn("Panel blur (Fast) is off on this GPU; the browser's blur takes over:", err);
    broken = true;
    freeTargets();
  }

  function ensure(w: number, h: number, halvings: number): void {
    if (!blurProgram) {
      blurProgram = createProgram(gl, BLUR_FRAG, BLUR_VERT);
      blurProgram.use();
      blurProgram.setI("uSrc", 0);
    }
    if (!compProgram) {
      compProgram = createProgram(gl, COMP_FRAG, COMP_VERT);
      compProgram.use();
      compProgram.setI("uBlur", 0);
    }
    if (w === builtW && h === builtH && halvings === builtHalvings) return;
    freeTargets();
    builtW = w;
    builtH = h;
    // A frame too small to halve still needs one level to blur from.
    const chain = halvingChain(w, h, Math.max(1, halvings));
    for (const s of chain) levels.push(createColorTarget(gl, s.w, s.h, { label: "glassBackdrop" }));
    const small = chain[chain.length - 1];
    row = createColorTarget(gl, small.w, small.h, { label: "glassBackdrop" });
    blurred = createColorTarget(gl, small.w, small.h, { label: "glassBackdrop" });
    builtHalvings = halvings;
  }

  /** Blits the default framebuffer down the halving chain. */
  function downsample(w: number, h: number): void {
    let srcFbo: WebGLFramebuffer | null = null;
    let sw = w;
    let sh = h;
    for (const t of levels) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, srcFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.fbo);
      gl.blitFramebuffer(0, 0, sw, sh, 0, 0, t.w, t.h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      srcFbo = t.fbo;
      sw = t.w;
      sh = t.h;
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }

  return {
    draw(panes, count, cssW, cssH, look): boolean {
      if (broken) return false;
      if (count <= 0 || !(cssW > 0) || !(cssH > 0)) return true;
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      if (w <= 0 || h <= 0) return true;
      const sx = w / cssW;
      const sy = h / cssH;
      const sigmaPx = look.blurCssPx * Math.min(sx, sy);
      try {
        ensure(w, h, halvingsFor(sigmaPx));
      } catch (err) {
        fail(err);
        return false;
      }
      const small = levels[levels.length - 1];
      const scaleX = small.w / w;
      const scaleY = small.h / h;
      const sigma = Math.max(0.5, sigmaPx * Math.min(scaleX, scaleY));
      const taps = Math.ceil(sigma * TAP_SIGMAS);

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.BLEND);
      gl.colorMask(true, true, true, true);
      downsample(w, h);
      gl.bindVertexArray(null);
      gl.activeTexture(gl.TEXTURE0);

      for (let from = 0; from < count; from += PANES_PER_BATCH) {
        const n = packPanes(panes, from, Math.min(count, from + PANES_PER_BATCH), sx, sy, h, rect, quad, misc);
        if (n === 0) continue;
        const bp = blurProgram!;
        bp.use();
        bp.setV4v("uRect", rect);
        bp.setV2("uScale", scaleX, scaleY);
        bp.setV2("uSize", small.w, small.h);
        bp.setF("uSigma", sigma);
        bp.setI("uTaps", taps);
        gradeUniform[0] = look.saturate;
        gradeUniform[1] = look.brightness;
        gradeUniform[2] = look.contrast;
        bp.setV3v("uChain", gradeUniform);
        gl.viewport(0, 0, small.w, small.h);
        // Across: small copy -> row.
        gl.bindFramebuffer(gl.FRAMEBUFFER, row!.fbo);
        gl.bindTexture(gl.TEXTURE_2D, small.tex);
        bp.setV2("uDir", 1, 0);
        bp.setI("uGrade", 0);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
        // Down, then the colour chain: row -> blurred.
        gl.bindFramebuffer(gl.FRAMEBUFFER, blurred!.fbo);
        gl.bindTexture(gl.TEXTURE_2D, row!.tex);
        bp.setV2("uDir", 0, 1);
        bp.setI("uGrade", 1);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);

        // Under the surfaces, over the frame.
        const cp = compProgram!;
        cp.use();
        cp.setV4v("uRect", rect);
        cp.setV4v("uQuad", quad);
        cp.setV4v("uMisc", misc);
        cp.setV2("uCanvas", w, h);
        cp.setV2("uScale", scaleX, scaleY);
        cp.setV2("uSize", small.w, small.h);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, w, h);
        gl.bindTexture(gl.TEXTURE_2D, blurred!.tex);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
        gl.blendFunc(gl.ONE, gl.ZERO);
        gl.disable(gl.BLEND);
      }

      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.useProgram(null);
      return true;
    },
    dispose(): void {
      freeTargets();
      blurProgram?.dispose();
      compProgram?.dispose();
      blurProgram = null;
      compProgram = null;
      builtW = 0;
      builtH = 0;
    },
  };
}
