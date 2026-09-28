import { createProgram, type GLProgram } from "./gl.ts";

/**
 * Grabs a small thumbnail of the finished frame straight off the default
 * framebuffer, right after a scene has drawn into it — the raw material
 * `pictureMeter.ts` turns into Brightness/Colour/Motion/Detail/Flashes. This
 * file is the only GL in that path; pictureMeter.ts itself never touches a
 * context.
 *
 * The canvas is created with `antialias: false` (`gl.ts`'s createGL) —
 * deliberately, and this file is why: a multisampled default framebuffer
 * can't be the source of a `blitFramebuffer` call whose destination is a
 * different size, and every blit below resizes. A canvas that ever turned
 * antialiasing on would need to resolve to a plain colour buffer first.
 *
 * The pipeline, in order:
 *
 *   default framebuffer -> halving LINEAR blits -> "ref" (DETAIL_LONG_SIDE)
 *     -> gradient pass -> "half" (ref / 2) -> LINEAR blit -> "thumb" (half / 2)
 *
 * Brightness/Colour/Motion/Flashes only need a coarse thumbnail — a mean
 * comes out the same whether the frame is sampled small or large. Detail
 * doesn't: it's a measure of *fine* structure (a moiré grating a few pixels
 * wide, thin grain), and averaging a frame down to the thumbnail the
 * ordinary way blurs that structure into flat grey before this file ever
 * sees it. When Detail was still read off the thumbnail, Moiré at its
 * default line count measured almost no Detail at all (2026-09-28's
 * tools/master-sweep.mjs run: its lines were about one thumbnail pixel
 * apart). So Detail is measured separately, at a fixed reference resolution
 * (DETAIL_LONG_SIDE) fine enough to still see that kind of texture, and *fixed* rather than following the canvas: a scene's measured
 * Detail must not silently change with the window size or `quality.
 * renderScale`, only with what it actually draws.
 *
 * The measurement itself is a shader pass (see GRADIENT_FRAG below): each
 * output texel is one 2×2 block of the "ref" level box-averaged down for
 * its own rgb, with alpha instead carrying that block's own mean gradient
 * magnitude (horizontal + vertical neighbour luma difference) — the same
 * "how much do neighbours differ" question Detail has always asked, just
 * measured before the rest of the pipeline gets a chance to blur it away.
 * Alpha is free real estate for this: the canvas itself is `alpha: false`
 * (gl.ts), so nothing downstream has ever read a meaningful alpha out of
 * this thumbnail, and RGBA8 already has the channel sitting idle. One more
 * plain LINEAR blit (an exact 2×2 box average, same reasoning as every other
 * halving here) carries both the rgb and the packed Detail alpha down to the
 * actual thumbnail together, so pictureMeter.ts's frameStats only has
 * to unpack a mean alpha rather than run its own gradient scan.
 *
 * Never stalls the GPU pipeline: every blit above is a LINEAR downsampling
 * blit — each halving step is an exact 2×2 box average, since LINEAR-
 * filtered blitting at precisely half size samples each destination texel
 * exactly between four source texels. The final readback goes into a
 * `PIXEL_PACK_BUFFER` via `readPixels` (which only *queues* the copy) plus a
 * `fenceSync`; `poll()` drains it with `clientWaitSync(sync, 0, 0)` — a zero
 * timeout is purely a status check, never a wait — and `getBufferSubData`
 * once the fence says the GPU is done. This is the exact pattern
 * `physarum2.ts`'s territory readback already uses for the same reason
 * (search that file for "PIXEL_PACK_BUFFER" if this needs revisiting).
 *
 * `capture()` must be called in the same task as the render that just
 * happened — the canvas context is created with `preserveDrawingBuffer:
 * false` (the default), so the browser is free to clear or reuse the default
 * framebuffer as soon as this task yields. app.ts's drawScene() is the one
 * caller, right after `scene.render(...)`.
 *
 * The gradient pass draws (drawArrays, not a blit), which touches GL state
 * no blit does — app.ts only calls gl.viewport() on a canvas resize, so
 * anything this pass left dirty would silently corrupt every scene's very
 * next frame, not just this one. saveState()/restoreState() bracket the
 * pass so it can never leak state past its own draw call; see their own
 * comments for exactly what and why. If the pass's program fails to compile
 * or link — a driver quirk this repo has no way to test for in advance —
 * ensureGradientProgram() warns once and permanently disables capture()
 * (returning early, every call, from then on) rather than ever throwing into
 * the render loop.
 */

/** Long side, in pixels, of the fixed reference frame the gradient pass
 *  measures Detail from — independent of canvas size or `quality.
 *  renderScale`, so a scene's fine texture is measured at the same real
 *  resolution on every device instead of vanishing into whatever the final
 *  final thumbnail happens to average away. See the file header. Upscales a
 *  canvas smaller than this (acceptable: nothing that small has fine texture
 *  left to lose). */
export const DETAIL_LONG_SIDE = 640;

/** Long side of the thumbnail Brightness/Colour/Motion/Flashes are measured
 *  from; the short side follows the canvas aspect ratio (floored at 1).
 *  Derived, not independently chosen: the gradient pass's own output goes
 *  through exactly two more halvings on its way here (ref -> half -> thumb,
 *  each an exact 2×2 box average — see the file header), so this is always
 *  DETAIL_LONG_SIDE / 4 and the two constants can't drift apart. */
export const PICTURE_LONG_SIDE = DETAIL_LONG_SIDE / 4;

export interface PictureThumb {
  px: Uint8Array;
  w: number;
  h: number;
  atMs: number;
}

export interface PictureReadback {
  /** Right after scene.render(): starts one async readback of the default
   *  framebuffer, unless one is still in flight (then does nothing — one
   *  outstanding readback at a time, same discipline as physarum2.ts's
   *  pollTerritory), or the gradient pass has been permanently disabled (see
   *  the file header). `atMs` is stamped onto the eventual result. Does
   *  nothing on a 0-size canvas. */
  capture(canvasW: number, canvasH: number, atMs: number): void;
  /** The finished thumbnail, once the GPU is done; null otherwise. Never
   *  blocks. Returns a buffer this readback reuses across calls — a caller
   *  must consume it before the next poll(). */
  poll(): PictureThumb | null;
  dispose(): void;
}

interface Level {
  w: number;
  h: number;
  tex: WebGLTexture | null;
  fbo: WebGLFramebuffer | null;
}

/** Target size for the "ref" level's long/short sides — see DETAIL_LONG_SIDE. */
function refSize(canvasW: number, canvasH: number): { w: number; h: number } {
  if (canvasW <= 0 || canvasH <= 0) return { w: 0, h: 0 };
  if (canvasW >= canvasH) {
    return { w: DETAIL_LONG_SIDE, h: Math.max(1, Math.round((DETAIL_LONG_SIDE * canvasH) / canvasW)) };
  }
  return { w: Math.max(1, Math.round((DETAIL_LONG_SIDE * canvasW) / canvasH)), h: DETAIL_LONG_SIDE };
}

/** The halving steps between the canvas size and DETAIL_LONG_SIDE: repeatedly
 *  halve (each an exact 2×2 box average under LINEAR blitting — see the file
 *  header) while the *next* halving's long side would still be at or above
 *  target, so the last step this returns always has a long side in
 *  [target, target×2). The caller's own final blit — not part of this list —
 *  covers whatever ratio is left (and upscales, on a canvas already smaller
 *  than target — see DETAIL_LONG_SIDE's own doc comment). */
function halvingStepsToLongSide(canvasW: number, canvasH: number, targetLong: number): { w: number; h: number }[] {
  const steps: { w: number; h: number }[] = [];
  let w = canvasW;
  let h = canvasH;
  while (Math.floor(Math.max(w, h) / 2) >= targetLong) {
    w = Math.max(1, Math.floor(w / 2));
    h = Math.max(1, Math.floor(h / 2));
    steps.push({ w, h });
  }
  return steps;
}

/** RGBA8/LINEAR/CLAMP_TO_EDGE render target — every level of the blit chain
 *  (the halving steps, ref, half and thumb) is one of these. Immediately
 *  unbinds the texture it just bound, so the per-frame capture() path below
 *  never has to (see the file header's GL-hygiene note). Unbinds and frees
 *  its own objects before throwing on an incomplete framebuffer, so a caller
 *  that catches this never leaks the half-built texture/FBO. */
function makeLevel(gl: WebGL2RenderingContext, w: number, h: number): Level {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(tex);
    throw new Error(`pictureReadback: framebuffer incomplete (0x${status.toString(16)})`);
  }
  return { w, h, tex, fbo };
}

function freeLevel(gl: WebGL2RenderingContext, level: Level): void {
  if (level.fbo) gl.deleteFramebuffer(level.fbo);
  if (level.tex) gl.deleteTexture(level.tex);
}

// ---------------------------------------------------------------------
// The gradient pass: an attribute-less fullscreen triangle (gl_VertexID —
// no VBO, no bound attribute, just its own empty VAO so drawArrays has
// something legal to draw with) that reads the "ref" level and writes the
// "half" level, rgb = 2×2 box mean, alpha = packed Detail — see the file
// header for the maths and why alpha.
// ---------------------------------------------------------------------

const GRADIENT_VERT = `#version 300 es
void main() {
  // The standard attribute-less "big triangle" trick: for vid 0,1,2 this
  // places vertices at clip-space (-1,-1), (3,-1), (-1,3) — one triangle
  // whose visible portion exactly covers the [-1,1] viewport, with no
  // vertex buffer or attribute involved at all.
  vec2 pos = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`;

const GRADIENT_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uRef;
uniform ivec2 uRefSize;
out vec4 outColor;

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// texelFetch at (x,y), clamped to the ref texture's own bounds — a texel on
// the last column/row has no real right/down neighbour, so this fetches
// itself instead, which is what makes its own gradient term read 0 there
// rather than sampling garbage or wrapping into the next row.
vec4 fetchClamped(ivec2 c) {
  return texelFetch(uRef, clamp(c, ivec2(0), uRefSize - 1), 0);
}

void main() {
  // This output texel's 2×2 source block in "ref" — A top-left, B top-right,
  // C bottom-left, D bottom-right (matching the file header's maths) — plus
  // the three extra texels A/B/C/D's own right/down neighbours reach outside
  // the block itself (B's right, C's down, D's right and down).
  ivec2 base = ivec2(gl_FragCoord.xy) * 2;
  vec4 tA = fetchClamped(base);
  vec4 tB = fetchClamped(base + ivec2(1, 0));
  vec4 tC = fetchClamped(base + ivec2(0, 1));
  vec4 tD = fetchClamped(base + ivec2(1, 1));
  vec4 rB = fetchClamped(base + ivec2(2, 0)); // B's right
  vec4 rD = fetchClamped(base + ivec2(2, 1)); // D's right
  vec4 dC = fetchClamped(base + ivec2(0, 2)); // C's down
  vec4 dD = fetchClamped(base + ivec2(1, 2)); // D's down

  float yA = luma(tA.rgb), yB = luma(tB.rgb), yC = luma(tC.rgb), yD = luma(tD.rgb);
  float yRB = luma(rB.rgb), yRD = luma(rD.rgb), yDC = luma(dC.rgb), yDD = luma(dD.rgb);

  // Each of the 2×2 block's four texels' own |right - self| + |down - self|.
  float gA = abs(yB - yA) + abs(yC - yA);
  float gB = abs(yRB - yB) + abs(yD - yB);
  float gC = abs(yD - yC) + abs(yDC - yC);
  float gD = abs(yRD - yD) + abs(yDD - yD);

  vec3 rgb = (tA.rgb + tB.rgb + tC.rgb + tD.rgb) * 0.25;
  // Mean over the four texels, then × 0.5 so the packed value fits an 8-bit
  // channel (each g is at most 2, so the mean is at most 2 too) — undone by
  // pictureMeter.ts's frameStats.
  float detail = (gA + gB + gC + gD) * 0.25 * 0.5;
  outColor = vec4(rgb, detail);
}`;

/** True once ensureGradientProgram() has given up for good — see the file
 *  header. Module scope, not per-instance, since a compile/link failure is a
 *  property of the driver, not of any one canvas: every createPictureReadback
 *  instance the app ever makes would fail the exact same way. */
let gradientDisabled = false;

function setEnabled(gl: WebGL2RenderingContext, cap: number, on: boolean): void {
  if (on) gl.enable(cap);
  else gl.disable(cap);
}

interface SavedGLState {
  viewport: Int32Array;
  program: WebGLProgram | null;
  vao: WebGLVertexArrayObject | null;
  activeTexture: number;
  texture0: WebGLTexture | null;
  sampler0: WebGLSampler | null;
  blend: boolean;
  depthTest: boolean;
  cullFace: boolean;
  stencilTest: boolean;
  scissorTest: boolean;
  rasterizerDiscard: boolean;
  colorMask: [boolean, boolean, boolean, boolean];
}

/** Everything runGradientPass()'s own drawArrays call could disturb that a
 *  blit never touches — see the file header for why leaving any of this
 *  dirty would corrupt whatever scene renders next, not just this pass. */
function saveState(gl: WebGL2RenderingContext): SavedGLState {
  const activeTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
  // TEXTURE_BINDING_2D/SAMPLER_BINDING are properties of whichever texture
  // unit is currently active, not addressable directly by unit number — so
  // the only way to read unit 0's own binding (the unit uRef uses) is to
  // switch to it first, exactly as the pass itself is about to.
  gl.activeTexture(gl.TEXTURE0);
  const texture0 = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
  const sampler0 = gl.getParameter(gl.SAMPLER_BINDING) as WebGLSampler | null;
  return {
    viewport: gl.getParameter(gl.VIEWPORT) as Int32Array,
    program: gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null,
    vao: gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null,
    activeTexture,
    texture0,
    sampler0,
    blend: gl.isEnabled(gl.BLEND),
    depthTest: gl.isEnabled(gl.DEPTH_TEST),
    cullFace: gl.isEnabled(gl.CULL_FACE),
    stencilTest: gl.isEnabled(gl.STENCIL_TEST),
    scissorTest: gl.isEnabled(gl.SCISSOR_TEST),
    rasterizerDiscard: gl.isEnabled(gl.RASTERIZER_DISCARD),
    colorMask: gl.getParameter(gl.COLOR_WRITEMASK) as [boolean, boolean, boolean, boolean],
  };
}

/** Puts back exactly what saveState() captured. Framebuffer bindings are
 *  deliberately not part of this pair — capture()'s own blit sequence always
 *  ends with both bound to null regardless of this pass, same as before. */
function restoreState(gl: WebGL2RenderingContext, s: SavedGLState): void {
  gl.viewport(s.viewport[0]!, s.viewport[1]!, s.viewport[2]!, s.viewport[3]!);
  gl.useProgram(s.program);
  gl.bindVertexArray(s.vao);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, s.texture0);
  gl.bindSampler(0, s.sampler0);
  gl.activeTexture(s.activeTexture);
  setEnabled(gl, gl.BLEND, s.blend);
  setEnabled(gl, gl.DEPTH_TEST, s.depthTest);
  setEnabled(gl, gl.CULL_FACE, s.cullFace);
  setEnabled(gl, gl.STENCIL_TEST, s.stencilTest);
  setEnabled(gl, gl.SCISSOR_TEST, s.scissorTest);
  setEnabled(gl, gl.RASTERIZER_DISCARD, s.rasterizerDiscard);
  gl.colorMask(s.colorMask[0], s.colorMask[1], s.colorMask[2], s.colorMask[3]);
}

export function createPictureReadback(gl: WebGL2RenderingContext): PictureReadback {
  let lastCanvasW = -1;
  let lastCanvasH = -1;
  let thumbW = 0;
  let thumbH = 0;
  // The halving chain toward "ref", then ref/half/thumb themselves — see
  // ensureTargets(). Rebuilt from scratch on every canvas size change; a
  // resize mid-flight drops whatever readback was pending (below), so the
  // old levels are never blitted into after they're freed.
  let levels: Level[] = [];
  let refLevel: Level | null = null;
  let halfLevel: Level | null = null;
  let thumbLevel: Level | null = null;
  let pbo: WebGLBuffer | null = null;
  let sync: WebGLSync | null = null;
  let pendingAtMs = 0;
  // Reused across polls — see poll()'s own doc comment on why a caller must
  // consume it before the next one.
  let resultPx: Uint8Array | null = null;

  // Lazily compiled once per instance — see ensureGradientProgram(). Kept
  // per instance (unlike the module-scope gradientDisabled flag) since the
  // program/VAO are real GL objects tied to this instance's own context.
  let gradientProgram: GLProgram | null = null;
  let gradientVao: WebGLVertexArrayObject | null = null;
  let gradientURef: WebGLUniformLocation | null = null;
  let gradientURefSize: WebGLUniformLocation | null = null;

  function freeTargets(): void {
    for (const level of levels) freeLevel(gl, level);
    levels = [];
    if (refLevel) freeLevel(gl, refLevel);
    refLevel = null;
    if (halfLevel) freeLevel(gl, halfLevel);
    halfLevel = null;
    if (thumbLevel) freeLevel(gl, thumbLevel);
    thumbLevel = null;
    if (pbo) gl.deleteBuffer(pbo);
    pbo = null;
    // A pending readback pointed at the targets just freed — its fence can
    // never usefully resolve into them now, and clientWaitSync on a deleted
    // buffer's fence is still legal but pointless, so just drop it.
    if (sync) gl.deleteSync(sync);
    sync = null;
  }

  /** Compiles/links the gradient program and its empty VAO the first time
   *  it's actually needed. On failure — a driver quirk, not something this
   *  repo can test for in advance — warns once and sets the module-scope
   *  gradientDisabled flag so every capture() from now on (this instance and
   *  any other) no-ops instead of ever throwing into the render loop. */
  function ensureGradientProgram(): boolean {
    if (gradientDisabled) return false;
    if (gradientProgram) return true;
    try {
      gradientProgram = createProgram(gl, GRADIENT_FRAG, GRADIENT_VERT);
      gradientURef = gl.getUniformLocation(gradientProgram.program, "uRef");
      gradientURefSize = gl.getUniformLocation(gradientProgram.program, "uRefSize");
      gradientVao = gl.createVertexArray();
      return true;
    } catch (err) {
      console.warn("pictureReadback: gradient pass failed to compile/link — Detail readback disabled", err);
      gradientProgram?.dispose();
      gradientProgram = null;
      gradientVao = null;
      gradientDisabled = true;
      return false;
    }
  }

  /** ref -> half: the shader pass itself. Brackets its own draw call in
   *  saveState()/restoreState() — see those functions' own comments. */
  function runGradientPass(ref: Level, half: Level): void {
    const saved = saveState(gl);
    setEnabled(gl, gl.BLEND, false);
    setEnabled(gl, gl.DEPTH_TEST, false);
    setEnabled(gl, gl.CULL_FACE, false);
    setEnabled(gl, gl.STENCIL_TEST, false);
    setEnabled(gl, gl.SCISSOR_TEST, false);
    setEnabled(gl, gl.RASTERIZER_DISCARD, false);
    gl.colorMask(true, true, true, true);

    gl.bindFramebuffer(gl.FRAMEBUFFER, half.fbo);
    gl.viewport(0, 0, half.w, half.h);
    gl.useProgram(gradientProgram!.program);
    gl.bindVertexArray(gradientVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ref.tex);
    gl.bindSampler(0, null); // texelFetch ignores a sampler anyway; null it regardless, on principle
    gl.uniform1i(gradientURef, 0);
    gl.uniform2i(gradientURefSize, ref.w, ref.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    restoreState(gl, saved);
  }

  /** (Re)allocates the whole blit chain only when the canvas size actually
   *  changed — see the file header's GL-hygiene note. */
  function ensureTargets(canvasW: number, canvasH: number): void {
    if (canvasW === lastCanvasW && canvasH === lastCanvasH) return;
    lastCanvasW = canvasW;
    lastCanvasH = canvasH;
    freeTargets();
    const ref = refSize(canvasW, canvasH);
    if (ref.w <= 0 || ref.h <= 0) return;
    const halfW = Math.max(1, Math.floor(ref.w / 2));
    const halfH = Math.max(1, Math.floor(ref.h / 2));
    thumbW = Math.max(1, Math.floor(halfW / 2));
    thumbH = Math.max(1, Math.floor(halfH / 2));
    // This runs inside the render loop, so a driver that refuses a level
    // must cost the meter, never the frame: warn once, leave every level
    // null (capture() then does nothing) until the canvas size changes again.
    try {
      for (const { w, h } of halvingStepsToLongSide(canvasW, canvasH, DETAIL_LONG_SIDE)) levels.push(makeLevel(gl, w, h));
      refLevel = makeLevel(gl, ref.w, ref.h);
      halfLevel = makeLevel(gl, halfW, halfH);
      thumbLevel = makeLevel(gl, thumbW, thumbH);
    } catch (err) {
      console.warn(err);
      freeTargets();
      return;
    }
    pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, thumbW * thumbH * 4, gl.STREAM_READ);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    resultPx = new Uint8Array(thumbW * thumbH * 4);
  }

  return {
    capture(canvasW, canvasH, atMs) {
      if (sync) return; // one readback in flight at a time
      if (canvasW <= 0 || canvasH <= 0) return; // 0-size canvas: nothing to read
      if (!ensureGradientProgram()) return; // permanently disabled — see the file header
      ensureTargets(canvasW, canvasH);
      if (!refLevel || !halfLevel || !thumbLevel || !pbo || thumbW <= 0 || thumbH <= 0) return;

      // Blits are scissored — a scissor left on from the scene's own render
      // would crop every level down to whatever rectangle it last drew,
      // instead of the whole frame.
      const scissorWasOn = gl.isEnabled(gl.SCISSOR_TEST);
      if (scissorWasOn) gl.disable(gl.SCISSOR_TEST);

      // null (the default framebuffer) is where the scene just rendered;
      // each step below reads the previous level (or the canvas, for the
      // first) and writes the next, ending at the exact "ref" size.
      let srcFbo: WebGLFramebuffer | null = null;
      let srcW = canvasW;
      let srcH = canvasH;
      for (const level of [...levels, refLevel]) {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, srcFbo);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, level.fbo);
        gl.blitFramebuffer(0, 0, srcW, srcH, 0, 0, level.w, level.h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
        srcFbo = level.fbo;
        srcW = level.w;
        srcH = level.h;
      }
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);

      // ref -> half: the gradient pass (rgb box mean, alpha packed Detail).
      runGradientPass(refLevel, halfLevel);

      // half -> thumb: one more exact 2×2 box average, carrying rgb and the
      // packed Detail alpha down together.
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, halfLevel.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, thumbLevel.fbo);
      gl.blitFramebuffer(0, 0, halfLevel.w, halfLevel.h, 0, 0, thumbLevel.w, thumbLevel.h, gl.COLOR_BUFFER_BIT, gl.LINEAR);

      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, thumbLevel.fbo);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.readPixels(0, 0, thumbW, thumbH, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      pendingAtMs = atMs;

      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      if (scissorWasOn) gl.enable(gl.SCISSOR_TEST);
    },
    poll() {
      if (!sync) return null;
      const status = gl.clientWaitSync(sync, 0, 0);
      if (status === gl.TIMEOUT_EXPIRED) return null;
      gl.deleteSync(sync);
      sync = null;
      if (status === gl.WAIT_FAILED) return null; // drop this readback, try again next capture()
      if (!pbo || !resultPx) return null;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, resultPx);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      return { px: resultPx, w: thumbW, h: thumbH, atMs: pendingAtMs };
    },
    dispose() {
      freeTargets();
      gradientProgram?.dispose();
      gradientProgram = null;
      if (gradientVao) gl.deleteVertexArray(gradientVao);
      gradientVao = null;
    },
  };
}
