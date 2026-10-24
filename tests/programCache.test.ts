// programCache.ts against a fake WebGL2 context that records what the cache
// asks of it. A shader whose source holds BAD_VERT (vertex) or BAD_FRAG
// (fragment) fails to compile and BAD_LINK fails the link, so the deferred
// status check runs without a GPU.
import { describe, expect, it } from "vitest";
import { acquireProgram, deferProgramChecks, MAX_IDLE_PROGRAMS, type ProgramCheckout } from "../src/render/programCache.ts";
import { createProgram, type GLProgram } from "../src/render/gl.ts";
import { createSceneHost } from "../src/render/sceneHost.ts";
import { qualitySettings } from "../src/render/quality.ts";
import type { Scene } from "../src/render/scene.ts";

const C = {
  VERTEX_SHADER: 0x8b31, FRAGMENT_SHADER: 0x8b30, DELETE_STATUS: 0x8b80, COMPILE_STATUS: 0x8b81,
  LINK_STATUS: 0x8b82, ACTIVE_UNIFORMS: 0x8b86, CURRENT_PROGRAM: 0x8b8d,
  FLOAT: 0x1406, FLOAT_VEC4: 0x8b52, FLOAT_MAT4: 0x8b5c, SAMPLER_2D: 0x8b5e,
};
interface Shader { type: number; source: string }
interface Program { shaders: Shader[]; linked: boolean }
interface Uniform { name: string; type: number; size: number }

function fakeGL(uniforms: Uniform[] = []) {
  const log = { links: 0, statusReads: 0, deleted: [] as Program[], extensions: [] as string[], uploads: [] as { fn: string; name: string; values: number[] }[] };
  const deleted = new Set<Program>();
  const canvas = new EventTarget();
  let current: Program | null = null;
  const compiles = (s: Shader) => !s.source.includes(s.type === C.VERTEX_SHADER ? "BAD_VERT" : "BAD_FRAG");
  const upload = (fn: string) => (loc: { name: string }, ...rest: unknown[]) => {
    log.uploads.push({ fn, name: loc.name, values: Array.from(rest[rest.length - 1] as ArrayLike<number>) });
  };
  const gl = {
    ...C,
    canvas,
    getExtension: (name: string) => { log.extensions.push(name); return null; },
    createShader: (type: number): Shader => ({ type, source: "" }),
    shaderSource: (s: Shader, source: string) => { s.source = source; },
    compileShader: () => {},
    getShaderParameter: (s: Shader) => { log.statusReads++; return compiles(s); },
    getShaderInfoLog: (s: Shader) => (s.type === C.VERTEX_SHADER ? "vertex log" : "fragment log"),
    deleteShader: () => {},
    createProgram: (): Program => ({ shaders: [], linked: false }),
    attachShader: (p: Program, s: Shader) => { p.shaders.push(s); },
    linkProgram: (p: Program) => { log.links++; p.linked = p.shaders.every((s) => compiles(s) && !s.source.includes("BAD_LINK")); },
    getProgramParameter: (p: Program, pname: number) => {
      if (pname === C.DELETE_STATUS) return deleted.has(p) ? null : false;
      if (pname === C.ACTIVE_UNIFORMS) return uniforms.length;
      log.statusReads++;
      return p.linked;
    },
    getProgramInfoLog: () => "link log",
    deleteProgram: (p: Program) => { deleted.add(p); log.deleted.push(p); },
    getActiveUniform: (_p: Program, i: number) => uniforms[i] ?? null,
    getUniformLocation: (_p: Program, name: string) => ({ name }),
    getParameter: (pname: number) => (pname === C.CURRENT_PROGRAM ? current : null),
    useProgram: (p: Program | null) => { current = p; },
    uniform1fv: upload("uniform1fv"),
    uniform4fv: upload("uniform4fv"),
    uniform1iv: upload("uniform1iv"),
    uniformMatrix4fv: upload("uniformMatrix4fv"),
  };
  return { gl: gl as unknown as WebGL2RenderingContext, log, canvas };
}

const VERT = "#version 300 es\nvoid main() {}";
const FRAG = "#version 300 es\nvoid main() {}\n// A";
const OTHER = "#version 300 es\nvoid main() {}\n// B";

describe("acquireProgram", () => {
  it("lends a released program, once, to the next request for the same sources", () => {
    const { gl, log } = fakeGL();
    const a = acquireProgram(gl, VERT, FRAG);
    a.release();
    a.release(); // a second release does nothing
    expect(acquireProgram(gl, VERT, FRAG).program).toBe(a.program);
    expect(acquireProgram(gl, VERT, FRAG).program).not.toBe(a.program); // never to two holders
    expect(log.links).toBe(2);
    expect(log.deleted).toEqual([]);
  });

  it("compiles afresh for other sources and on another context", () => {
    const one = fakeGL();
    const two = fakeGL();
    const a = acquireProgram(one.gl, VERT, FRAG);
    a.release();
    expect(acquireProgram(one.gl, VERT, OTHER).program).not.toBe(a.program);
    expect(acquireProgram(two.gl, VERT, FRAG).program).not.toBe(a.program);
  });

  it("asks once per context for KHR_parallel_shader_compile", () => {
    const { gl, log } = fakeGL();
    acquireProgram(gl, VERT, FRAG);
    acquireProgram(gl, VERT, OTHER);
    expect(log.extensions).toEqual(["KHR_parallel_shader_compile"]);
  });

  it("zeroes every uniform of a reused program and keeps the current program", () => {
    const { gl, log } = fakeGL([
      { name: "uTime", type: C.FLOAT, size: 1 },
      { name: "uBands[0]", type: C.FLOAT, size: 4 },
      { name: "uTint", type: C.FLOAT_VEC4, size: 1 },
      { name: "uTex", type: C.SAMPLER_2D, size: 1 },
      { name: "uView", type: C.FLOAT_MAT4, size: 1 },
    ]);
    const other = acquireProgram(gl, VERT, OTHER);
    acquireProgram(gl, VERT, FRAG).release();
    gl.useProgram(other.program);
    acquireProgram(gl, VERT, FRAG);
    expect(log.uploads).toEqual([
      { fn: "uniform1fv", name: "uTime", values: [0] },
      { fn: "uniform1fv", name: "uBands[0]", values: [0, 0, 0, 0] },
      { fn: "uniform4fv", name: "uTint", values: [0, 0, 0, 0] },
      { fn: "uniform1iv", name: "uTex", values: [0] },
      { fn: "uniformMatrix4fv", name: "uView", values: new Array(16).fill(0) },
    ]);
    expect(gl.getParameter(gl.CURRENT_PROGRAM)).toBe(other.program);
  });

  it("compiles afresh rather than lend a program a scene deleted itself", () => {
    const { gl, log } = fakeGL();
    const a = acquireProgram(gl, VERT, FRAG);
    a.release();
    gl.deleteProgram(a.program);
    expect(acquireProgram(gl, VERT, FRAG).program).not.toBe(a.program);
    expect(log.links).toBe(2);
  });

  it("asks for KHR_parallel_shader_compile again after a restore", () => {
    const { gl, log, canvas } = fakeGL();
    acquireProgram(gl, VERT, FRAG);
    canvas.dispatchEvent(new Event("webglcontextlost"));
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(log.extensions).toEqual(["KHR_parallel_shader_compile", "KHR_parallel_shader_compile"]);
  });

  it("forgets its pool on a context loss and drops what is released after it", () => {
    const { gl, log, canvas } = fakeGL();
    const pooled = acquireProgram(gl, VERT, FRAG);
    const held = acquireProgram(gl, VERT, OTHER);
    pooled.release();
    canvas.dispatchEvent(new Event("webglcontextlost"));
    held.release();
    expect(acquireProgram(gl, VERT, FRAG).program).not.toBe(pooled.program);
    expect(acquireProgram(gl, VERT, OTHER).program).not.toBe(held.program);
    expect(log.deleted).toEqual([]);
  });

  it("deletes the program idle longest once more than MAX_IDLE_PROGRAMS wait", () => {
    const { gl, log } = fakeGL();
    const frag = (i: number) => `${FRAG}\n// ${i}`;
    const lent: ProgramCheckout[] = [];
    for (let i = 0; i <= MAX_IDLE_PROGRAMS; i++) lent.push(acquireProgram(gl, VERT, frag(i)));
    for (const l of lent) l.release();
    expect(log.deleted).toEqual([lent[0]!.program]);
    expect(acquireProgram(gl, VERT, frag(MAX_IDLE_PROGRAMS)).program).toBe(lent[MAX_IDLE_PROGRAMS]!.program);
  });

  it("checks at once outside deferProgramChecks, as createProgram always did", () => {
    const { gl } = fakeGL();
    expect(() => acquireProgram(gl, VERT, `${FRAG}\n// BAD_LINK`)).toThrow("Program link error: link log");
  });
});

describe("deferProgramChecks", () => {
  it("reads no status while the build runs, then each program's link status once", () => {
    const { gl, log } = fakeGL();
    deferProgramChecks(() => {
      deferProgramChecks(() => {
        acquireProgram(gl, VERT, FRAG); // a scene mounting a child: the outer call checks
      });
      acquireProgram(gl, VERT, OTHER);
      expect(log.statusReads).toBe(0);
    });
    expect(log.statusReads).toBe(2);
  });

  it("throws the first failure as createProgram did: vertex, then fragment, then link", () => {
    const { gl, log } = fakeGL();
    const badVert = `${VERT}\n// BAD_VERT`;
    const badFrag = `${FRAG}\n// BAD_FRAG`;
    const lent: ProgramCheckout[] = [];
    expect(() => deferProgramChecks(() => { lent.push(acquireProgram(gl, badVert, badFrag)); })).toThrow(
      `Shader compile error: vertex log\n${badVert}`,
    );
    expect(() => deferProgramChecks(() => { acquireProgram(gl, VERT, badFrag); })).toThrow(
      `Shader compile error: fragment log\n${badFrag}`,
    );
    expect(() => deferProgramChecks(() => { acquireProgram(gl, VERT, `${FRAG}\n// BAD_LINK`); })).toThrow(
      "Program link error: link log",
    );
    expect(log.deleted).toContain(lent[0]!.program);
    const deletedSoFar = log.deleted.length;
    lent[0]!.release(); // the scene's dispose() after the failed mount
    expect(log.deleted).toHaveLength(deletedSoFar);
  });

  it("deletes, never pools, a program its build left unchecked by throwing", () => {
    const { gl, log } = fakeGL();
    const lent: ProgramCheckout[] = [];
    expect(() =>
      deferProgramChecks(() => {
        lent.push(acquireProgram(gl, VERT, FRAG));
        throw new Error("init failed");
      }),
    ).toThrow("init failed");
    expect(log.statusReads).toBe(0);
    lent[0]!.release();
    expect(log.deleted).toEqual([lent[0]!.program]);
    expect(acquireProgram(gl, VERT, FRAG).program).not.toBe(lent[0]!.program);
  });

  it("skips a program released before the check (a rebuild inside init)", () => {
    const { gl, log } = fakeGL();
    deferProgramChecks(() => {
      acquireProgram(gl, VERT, FRAG).release();
      acquireProgram(gl, VERT, FRAG);
    });
    expect(log.statusReads).toBe(1);
  });
});

describe("createProgram and SceneHost.mount", () => {
  it("dispose gives the program back instead of deleting it", () => {
    const { gl, log } = fakeGL();
    const p = createProgram(gl, FRAG, VERT);
    p.dispose();
    expect(log.deleted).toEqual([]);
    expect(createProgram(gl, FRAG, VERT).program).toBe(p.program);
  });

  it("fails a mount on a bad shader only once init() has returned, and disposes the scene", () => {
    const { gl, log } = fakeGL();
    const host = createSceneHost(gl, qualitySettings("mid"));
    const bad = `${FRAG}\n// BAD_FRAG`;
    const steps: string[] = [];
    let prog: GLProgram | null = null;
    const scene = {
      id: "deferred",
      name: "deferred",
      init() {
        prog = createProgram(gl, bad, VERT);
        steps.push(`init returned after ${log.statusReads} status reads`);
      },
      render() {},
      dispose() {
        prog?.dispose();
        steps.push("dispose");
      },
    } as unknown as Scene;
    expect(() => host.mount(scene)).toThrow(`Shader compile error: fragment log\n${bad}`);
    expect(steps).toEqual(["init returned after 0 status reads", "dispose"]);
    expect(host.isMounted(scene)).toBe(false);
  });
});
