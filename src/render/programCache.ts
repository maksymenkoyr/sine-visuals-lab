// Where createProgram (gl.ts) gets its shader programs. Two things happen
// here that a scene never sees: the programs one mount creates compile
// together, and a disposed program is kept for the next mount.
//
// Compiling together. Reading a shader's or a program's status makes the page
// wait until the GPU process has compiled it, and createProgram used to read
// both shaders' and the link's status before returning, so a scene's programs
// compiled one after another. acquireProgram only submits a program (compile
// both shaders, link). deferProgramChecks, which SceneHost.mount and the TV
// page (tv.ts) wrap around a scene's init(), reads every status once init()
// returns, before the first draw, so the GPU process compiles while init()
// goes on with its buffers and textures. A failure throws what createProgram
// threw, from the same mount: the first failing program in creation order,
// as a compile error with that shader's log and source, else a link error
// with the program's log. Outside a mount (a shared pass made at boot or on
// first use, a program made in render()) the status is read at once, as
// before. A uniform lookup or use() waits for that program to compile, so an
// init() should create all its programs before it touches any of them
// (fluidSim.ts looks its passes' uniforms up on their first draw for this
// reason). Each context also gets KHR_parallel_shader_compile where the
// browser has it, and asks again after a restore, since extensions do not
// outlive the context.
//
// Kept for the next mount. Each GL context has its own pool of idle programs,
// keyed by the two shader sources (all createProgram compiles from). A
// released program joins its context's pool, and the next request for the
// same sources there takes it instead of compiling: a revisited scene, or one
// coming back to the gallery's preview context, skips its compile. A program
// is lent to one holder at a time, never to two live ones, because uniform
// values belong to the program: two gallery tiles drawing with one shared
// blur program would see each other's values. For the same reason a program
// taken from the pool has every uniform set back to zero, as a fresh link
// leaves it. The pool keeps at most MAX_IDLE_PROGRAMS and deletes the one
// idle longest past that. A context loss empties it without deleting anything
// (the programs died with the context), and a program released after the
// loss is dropped.
//
// A scene that frees a program with gl.deleteProgram instead of
// GLProgram.dispose() never gives it back, so the pool never sees it. One
// deleted after its dispose() is caught when it is next taken (its
// DELETE_STATUS no longer reads false; WebGL logs a warning for that read)
// and a fresh one is compiled instead.

/** How many idle programs one context keeps; past it the one idle longest is deleted. */
export const MAX_IDLE_PROGRAMS = 64;

/** A program lent to one holder: what createProgram's GLProgram wraps. */
export interface ProgramCheckout {
  readonly program: WebGLProgram;
  /** Gives the program back: kept for the next request with the same sources,
   *  or deleted if it was never checked. A second call does nothing. */
  release(): void;
}

interface Entry {
  readonly gl: WebGL2RenderingContext;
  readonly program: WebGLProgram;
  readonly key: string;
  readonly vertSrc: string;
  readonly fragSrc: string;
  /** Kept until the status check, which reads their logs when it fails. */
  vs: WebGLShader | null;
  fs: WebGLShader | null;
  status: "pending" | "ok" | "failed";
  released: boolean;
  /** The pool's `generation` when this entry was made. */
  readonly generation: number;
}

interface ContextPool {
  /** Released programs, the one idle longest first. */
  idle: { key: string; program: WebGLProgram }[];
  /** Counts context losses: an entry from an earlier one died with its context. */
  generation: number;
}

const pools = new WeakMap<WebGL2RenderingContext, ContextPool>();

/** What the open deferProgramChecks has created so far, in creation order; null when none is open. */
let pending: Entry[] | null = null;

function poolFor(gl: WebGL2RenderingContext): ContextPool {
  const known = pools.get(gl);
  if (known) return known;
  const pool: ContextPool = { idle: [], generation: 0 };
  pools.set(gl, pool);
  // Optional calls: a test's fake context may have neither.
  gl.getExtension?.("KHR_parallel_shader_compile");
  gl.canvas?.addEventListener?.("webglcontextlost", () => {
    pool.idle = [];
    pool.generation++;
  });
  gl.canvas?.addEventListener?.("webglcontextrestored", () => gl.getExtension?.("KHR_parallel_shader_compile"));
  return pool;
}

/** A program for these sources on `gl`: an idle one from the pool with its
 *  uniforms zeroed, or a newly submitted one, checked at once unless a
 *  deferProgramChecks is open. Throws a check's error. */
export function acquireProgram(gl: WebGL2RenderingContext, vertSrc: string, fragSrc: string): ProgramCheckout {
  const pool = poolFor(gl);
  const key = `${vertSrc}\u0000${fragSrc}`;
  const base = { gl, key, vertSrc, fragSrc, released: false, generation: pool.generation };
  const reused = takeIdle(gl, pool, key);
  if (reused) {
    resetUniforms(gl, reused);
    return lend({ ...base, program: reused, vs: null, fs: null, status: "ok" });
  }
  const vs = submitShader(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = submitShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const program = gl.createProgram();
  if (!program) throw new Error("createProgram failed");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  const entry: Entry = { ...base, program, vs, fs, status: "pending" };
  if (pending) pending.push(entry);
  else check(entry);
  return lend(entry);
}

/** Runs `build` (a scene's init()) with status checks held back, then checks
 *  every program it created, in creation order, throwing the first failure.
 *  A nested call (a scene mounting its children) leaves that to the outer one. */
export function deferProgramChecks(build: () => void): void {
  if (pending) {
    build();
    return;
  }
  const batch: Entry[] = [];
  pending = batch;
  try {
    build();
  } finally {
    pending = null;
  }
  for (const entry of batch) {
    // One released during the build (a rebuild inside init()) was deleted unchecked.
    if (!entry.released) check(entry);
  }
}

function submitShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("createShader failed");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

/** One wait for the link; the shaders' logs only when it failed. */
function check(entry: Entry): void {
  const { gl, program, vs, fs } = entry;
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
    entry.status = "ok";
    freeShaders(entry);
    return;
  }
  let message: string;
  if (vs && !gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
    message = `Shader compile error: ${gl.getShaderInfoLog(vs)}\n${entry.vertSrc}`;
  } else if (fs && !gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
    message = `Shader compile error: ${gl.getShaderInfoLog(fs)}\n${entry.fragSrc}`;
  } else {
    message = `Program link error: ${gl.getProgramInfoLog(program)}`;
  }
  entry.status = "failed";
  freeShaders(entry);
  gl.deleteProgram(program);
  throw new Error(message);
}

function freeShaders(entry: Entry): void {
  if (entry.vs) entry.gl.deleteShader(entry.vs);
  if (entry.fs) entry.gl.deleteShader(entry.fs);
  entry.vs = null;
  entry.fs = null;
}

function lend(entry: Entry): ProgramCheckout {
  return {
    program: entry.program,
    release: () => {
      if (entry.released) return;
      entry.released = true;
      if (entry.status === "failed") return; // check() deleted it
      const { gl } = entry;
      const pool = poolFor(gl);
      if (entry.generation !== pool.generation) return; // died with a lost context
      if (entry.status === "pending") {
        // Its init() threw before the check: free it, it may not even link.
        freeShaders(entry);
        gl.deleteProgram(entry.program);
        return;
      }
      pool.idle.push({ key: entry.key, program: entry.program });
      if (pool.idle.length > MAX_IDLE_PROGRAMS) {
        const oldest = pool.idle.shift();
        if (oldest) gl.deleteProgram(oldest.program);
      }
    },
  };
}

/** The most recently released live program with this key, taken out of the pool. */
function takeIdle(gl: WebGL2RenderingContext, pool: ContextPool, key: string): WebGLProgram | null {
  for (let i = pool.idle.length - 1; i >= 0; i--) {
    const { key: idleKey, program } = pool.idle[i];
    if (idleKey !== key) continue;
    pool.idle.splice(i, 1);
    // False only for a live program; one a scene deleted itself reads null
    // (or true while still in use) and is dropped here.
    if (gl.getProgramParameter(program, gl.DELETE_STATUS) === false) return program;
  }
  return null;
}

/** Sets every uniform of a reused program back to zero, keeping the current program. */
function resetUniforms(gl: WebGL2RenderingContext, program: WebGLProgram): void {
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
  const current = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
  gl.useProgram(program);
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    // A uniform inside a uniform block has no location.
    const loc = info ? gl.getUniformLocation(program, info.name) : null;
    if (info && loc) zeroUniform(gl, loc, info.type, info.size);
  }
  gl.useProgram(current);
}

/** Zeros with the setter the uniform's type needs (WebGL rejects a mismatched one). */
function zeroUniform(gl: WebGL2RenderingContext, loc: WebGLUniformLocation, type: number, size: number): void {
  switch (type) {
    case gl.FLOAT: gl.uniform1fv(loc, new Float32Array(size)); return;
    case gl.FLOAT_VEC2: gl.uniform2fv(loc, new Float32Array(2 * size)); return;
    case gl.FLOAT_VEC3: gl.uniform3fv(loc, new Float32Array(3 * size)); return;
    case gl.FLOAT_VEC4: gl.uniform4fv(loc, new Float32Array(4 * size)); return;
    case gl.FLOAT_MAT2: gl.uniformMatrix2fv(loc, false, new Float32Array(4 * size)); return;
    case gl.FLOAT_MAT3: gl.uniformMatrix3fv(loc, false, new Float32Array(9 * size)); return;
    case gl.FLOAT_MAT4: gl.uniformMatrix4fv(loc, false, new Float32Array(16 * size)); return;
    case gl.FLOAT_MAT2x3: gl.uniformMatrix2x3fv(loc, false, new Float32Array(6 * size)); return;
    case gl.FLOAT_MAT2x4: gl.uniformMatrix2x4fv(loc, false, new Float32Array(8 * size)); return;
    case gl.FLOAT_MAT3x2: gl.uniformMatrix3x2fv(loc, false, new Float32Array(6 * size)); return;
    case gl.FLOAT_MAT3x4: gl.uniformMatrix3x4fv(loc, false, new Float32Array(12 * size)); return;
    case gl.FLOAT_MAT4x2: gl.uniformMatrix4x2fv(loc, false, new Float32Array(8 * size)); return;
    case gl.FLOAT_MAT4x3: gl.uniformMatrix4x3fv(loc, false, new Float32Array(12 * size)); return;
    case gl.INT_VEC2: case gl.BOOL_VEC2: gl.uniform2iv(loc, new Int32Array(2 * size)); return;
    case gl.INT_VEC3: case gl.BOOL_VEC3: gl.uniform3iv(loc, new Int32Array(3 * size)); return;
    case gl.INT_VEC4: case gl.BOOL_VEC4: gl.uniform4iv(loc, new Int32Array(4 * size)); return;
    case gl.UNSIGNED_INT: gl.uniform1uiv(loc, new Uint32Array(size)); return;
    case gl.UNSIGNED_INT_VEC2: gl.uniform2uiv(loc, new Uint32Array(2 * size)); return;
    case gl.UNSIGNED_INT_VEC3: gl.uniform3uiv(loc, new Uint32Array(3 * size)); return;
    case gl.UNSIGNED_INT_VEC4: gl.uniform4uiv(loc, new Uint32Array(4 * size)); return;
    default: gl.uniform1iv(loc, new Int32Array(size)); // int, bool and every sampler
  }
}
