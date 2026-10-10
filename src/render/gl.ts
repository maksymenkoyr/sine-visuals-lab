// The WebGL2 plumbing every scene stands on: creating the context and keeping
// it alive through a loss (createGL, watchContextLoss), compiling shaders and
// linking programs (createProgram and the GLProgram setters), the one
// fullscreen triangle every pass draws (createFullscreenQuad,
// drawFullscreenQuad), and sizing a canvas's backing store to its CSS box
// (resizeCanvasToDisplaySize, refreshCssSize).
//
// GLProgram's setters look a uniform up by name once per program and cache
// the answer, a missing uniform included, so a draw never asks the driver for
// the same location twice. setI is the setter for sampler units and any other
// integer uniform; the rest take floats and vectors. The cache belongs to the
// program object, so it lives and dies with that program: a scene never keeps
// location maps of its own and never clears them when it rebuilds a program.

export function createGL(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  overrides: WebGLContextAttributes = {},
): WebGL2RenderingContext {
  const gl = canvas.getContext("webgl2", {
    antialias: false,
    alpha: false,
    // Every fullscreen-shader scene is a single opaque triangle with no
    // occlusion to resolve, so this stayed off historically. meshGrid.ts is
    // the first scene with real overlapping 3D geometry (a terrain whose
    // near ridges must occlude the rows behind them, plus dot sprites
    // depth-tested against it) and needs a true depth test for that
    // hidden-line look; every other scene simply never touches DEPTH_TEST,
    // so the attachment costs them nothing.
    depth: true,
    stencil: false,
    powerPreference: "high-performance",
    ...overrides,
  }) as WebGL2RenderingContext | null;
  if (!gl) throw new Error("WebGL2 is not supported on this device");
  return gl;
}

/**
 * Keeps a page's own canvas alive through a GPU context loss (a driver
 * reset, a backgrounded phone, a TV running out of GPU memory). Without a
 * `preventDefault()` on `webglcontextlost` the browser never restores the
 * context at all, and every GL call after a loss is a silent no-op: the loop
 * keeps running and the picture just freezes or goes black.
 *
 * Scenes hold their programs, VAOs and framebuffers in closures, so the
 * restore handler's job is to rebuild everything, not just the context. The
 * three entry points (app.ts, output.ts, tv.ts) do that by reloading the
 * page: the route lives in the hash and the stores in localStorage, so a
 * reload lands back on the same scene. `onLost` runs first, for a message or
 * for pausing the loop while the context is down. Not for the gallery's
 * shared preview context (previewRenderer.ts remounts its own scenes in
 * place) or quality.ts's benchmark, which is meant to die.
 */
export function watchContextLoss(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  onLost: () => void,
  onRestored: () => void,
): void {
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    onLost();
  });
  canvas.addEventListener("webglcontextrestored", () => onRestored());
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("createShader failed");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${log}\n${source}`);
  }
  return shader;
}

export const FULLSCREEN_VERT = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export interface GLProgram {
  program: WebGLProgram;
  use(): void;
  setF(name: string, v: number): void;
  /** Sets an integer uniform: a sampler's texture unit, or any int. Use it
   *  for samplers, not setF (a float call on a sampler is a GL error). Like
   *  the other setters, call it after use(). */
  setI(name: string, v: number): void;
  setV2(name: string, x: number, y: number): void;
  setV4(name: string, x: number, y: number, z: number, w: number): void;
  setFv(name: string, arr: Float32Array | number[]): void;
  setV3v(name: string, arr: Float32Array | number[]): void;
  setV4v(name: string, arr: Float32Array | number[]): void;
  dispose(): void;
}

export function createProgram(
  gl: WebGL2RenderingContext,
  fragSrc: string,
  vertSrc: string = FULLSCREEN_VERT,
): GLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const program = gl.createProgram();
  if (!program) throw new Error("createProgram failed");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link error: ${log}`);
  }

  const locations = new Map<string, WebGLUniformLocation | null>();
  const loc = (name: string) => {
    let l = locations.get(name);
    if (l === undefined) {
      l = gl.getUniformLocation(program, name);
      locations.set(name, l);
    }
    return l;
  };

  return {
    program,
    use: () => gl.useProgram(program),
    setF: (name, v) => gl.uniform1f(loc(name), v),
    setI: (name, v) => gl.uniform1i(loc(name), v),
    setV2: (name, x, y) => gl.uniform2f(loc(name), x, y),
    setV4: (name, x, y, z, w) => gl.uniform4f(loc(name), x, y, z, w),
    setFv: (name, arr) => gl.uniform1fv(loc(name), arr as Float32Array),
    setV3v: (name, arr) => gl.uniform3fv(loc(name), arr as Float32Array),
    setV4v: (name, arr) => gl.uniform4fv(loc(name), arr as Float32Array),
    dispose: () => gl.deleteProgram(program),
  };
}

/** One oversized clip-space triangle, (-1,-1), (3,-1), (-1,3), that covers the
 *  whole [-1,1] viewport — draw it with drawFullscreenQuad (TRIANGLES, three
 *  vertices), never as a strip. The name is historical. */
export function createFullscreenQuad(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error("createVertexArray failed");
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return vao;
}

export function drawFullscreenQuad(gl: WebGL2RenderingContext, vao: WebGLVertexArrayObject): void {
  gl.bindVertexArray(vao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindVertexArray(null);
}

interface CssSize {
  width: number;
  height: number;
}

// clientWidth/clientHeight force a synchronous style/layout flush, and this
// gets called once per render tick. A ResizeObserver reports the CSS box
// asynchronously (batched by the browser, no forced layout), so we cache the
// last-reported size per canvas and only touch clientWidth/clientHeight
// directly as a fallback on runtimes without ResizeObserver (and in
// refreshCssSize(), below, for a canvas that was just shown again).
const cssSizes = new WeakMap<HTMLCanvasElement, CssSize>();

function getCssSize(canvas: HTMLCanvasElement): CssSize {
  if (typeof ResizeObserver === "undefined") {
    // No RO support — fall back to the direct (layout-forcing) read, which
    // is what every caller did before this change; strictly correct, just
    // not the fast path. Guards very old runtimes (see vite.config.ts's
    // webOS/Tizen target note) that predate ResizeObserver.
    return { width: canvas.clientWidth, height: canvas.clientHeight };
  }

  let size = cssSizes.get(canvas);
  if (!size) {
    // Seed synchronously so the first frame is correct even before the
    // observer's first (async) callback fires.
    size = { width: canvas.clientWidth, height: canvas.clientHeight };
    cssSizes.set(canvas, size);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const box = entry.contentBoxSize?.[0];
        size!.width = box ? box.inlineSize : entry.contentRect.width;
        size!.height = box ? box.blockSize : entry.contentRect.height;
      }
    });
    observer.observe(canvas);
  }
  return size;
}

/**
 * Re-reads a canvas's CSS size once, synchronously. Call it right after
 * un-hiding a canvas (`display: none` -> `block`): while hidden the observer
 * reported a 0x0 box, and its callback for the new box only runs after the
 * next animation frame's callbacks, so without this the first frame back
 * would be sized from the stale 0x0 cache (a 1x1 buffer stretched to the
 * whole screen). It mutates the same object the observer writes to, so the
 * observer stays valid. Does nothing before the first resize (the first
 * getCssSize() seeds itself).
 */
export function refreshCssSize(canvas: HTMLCanvasElement): void {
  const size = cssSizes.get(canvas);
  if (!size) return;
  size.width = canvas.clientWidth;
  size.height = canvas.clientHeight;
}

/**
 * Resizes the canvas backing store to CSS size * devicePixelRatio * renderScale.
 * Returns true if the size actually changed (caller should gl.viewport() then).
 */
export function resizeCanvasToDisplaySize(
  canvas: HTMLCanvasElement,
  renderScale: number,
): boolean {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssSize = getCssSize(canvas);
  const width = Math.max(1, Math.round(cssSize.width * dpr * renderScale));
  const height = Math.max(1, Math.round(cssSize.height * dpr * renderScale));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    return true;
  }
  return false;
}
