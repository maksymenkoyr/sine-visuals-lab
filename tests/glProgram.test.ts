// GLProgram's uniform setters, checked against a fake WebGL2 context. The fake
// records every getUniformLocation lookup and every uniform upload, so the
// tests can see whether a location was looked up once per program and name,
// and which location each upload went to. No GPU is needed.
import { describe, it, expect } from "vitest";
import { createProgram } from "../src/render/gl.ts";

interface FakeLoc {
  program: object;
  name: string;
}

interface Upload {
  loc: FakeLoc | null;
  v: number;
}

const FRAG = "#version 300 es\nvoid main() {}";

function fakeGL() {
  const lookups: FakeLoc[] = [];
  const ints: Upload[] = [];
  const floats: Upload[] = [];
  const gl = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    createShader: () => ({}),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true,
    deleteShader: () => {},
    createProgram: () => ({}),
    attachShader: () => {},
    linkProgram: () => {},
    getProgramParameter: () => true,
    // "uGone" stands for a uniform the driver optimized out.
    getUniformLocation: (program: object, name: string): FakeLoc | null => {
      const loc = { program, name };
      lookups.push(loc);
      return name === "uGone" ? null : loc;
    },
    uniform1i: (loc: FakeLoc | null, v: number) => {
      ints.push({ loc, v });
    },
    uniform1f: (loc: FakeLoc | null, v: number) => {
      floats.push({ loc, v });
    },
  };
  return { gl: gl as unknown as WebGL2RenderingContext, lookups, ints, floats };
}

describe("GLProgram.setI", () => {
  it("looks a uniform up once and reuses the location on later calls", () => {
    const { gl, lookups, ints } = fakeGL();
    const p = createProgram(gl, FRAG);
    p.setI("uTex", 3);
    p.setI("uTex", 5);
    expect(lookups).toHaveLength(1);
    expect(ints).toHaveLength(2);
    const L = ints[0]!.loc;
    expect(L).not.toBeNull();
    expect(ints[1]!.loc).toBe(L);
    expect(L!.name).toBe("uTex");
    expect(ints).toEqual([
      { loc: L, v: 3 },
      { loc: L, v: 5 },
    ]);
  });

  it("keeps a separate location cache for each program", () => {
    const { gl, lookups, ints } = fakeGL();
    const a = createProgram(gl, FRAG);
    const b = createProgram(gl, FRAG);
    a.setI("uTex", 2);
    b.setI("uTex", 2);
    expect(lookups).toHaveLength(2);
    expect(ints).toHaveLength(2);
    expect(ints[0]!.loc).not.toBe(ints[1]!.loc);
    expect(ints[0]!.loc!.program).toBe(a.program);
    expect(ints[1]!.loc!.program).toBe(b.program);
  });

  it("caches a missing uniform too, and still forwards the call", () => {
    const { gl, lookups, ints } = fakeGL();
    const p = createProgram(gl, FRAG);
    p.setI("uGone", 7);
    p.setI("uGone", 7);
    expect(lookups).toHaveLength(1);
    expect(ints).toEqual([
      { loc: null, v: 7 },
      { loc: null, v: 7 },
    ]);
  });

  it("shares one location cache with setF for the same name", () => {
    const { gl, lookups, ints, floats } = fakeGL();
    const p = createProgram(gl, FRAG);
    p.setF("uA", 0.25);
    p.setI("uA", 4);
    expect(lookups).toHaveLength(1);
    expect(floats).toHaveLength(1);
    expect(ints).toHaveLength(1);
    expect(floats[0]!.v).toBe(0.25);
    expect(ints[0]!.v).toBe(4);
    expect(ints[0]!.loc).toBe(floats[0]!.loc);
  });
});
