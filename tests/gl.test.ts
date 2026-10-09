// Tests for GLProgram's integer setter (setI) in src/render/gl.ts. A fake
// WebGL2 context records two things: each getUniformLocation lookup by name,
// and each uniform1i/uniform1f call as [fnName, locationName, value]. Every
// other GL call is a no-op, which is enough because createProgram touches
// nothing else on the context.
import { describe, expect, it } from "vitest";
import { createProgram } from "../src/render/gl.ts";

interface Fake {
  gl: WebGL2RenderingContext;
  lookups: string[];
  calls: unknown[][];
}

function fakeGL(): Fake {
  const lookups: string[] = [];
  const calls: unknown[][] = [];
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    createShader: () => ({}),
    shaderSource: () => {},
    compileShader: () => {},
    deleteShader: () => {},
    attachShader: () => {},
    linkProgram: () => {},
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    createProgram: () => ({}),
    useProgram: () => {},
    getUniformLocation: (_program: unknown, name: string) => {
      lookups.push(name);
      return { name };
    },
    uniform1i: (l: { name: string } | null, v: number) => calls.push(["uniform1i", l?.name, v]),
    uniform1f: (l: { name: string } | null, v: number) => calls.push(["uniform1f", l?.name, v]),
  };
  return { gl: gl as unknown as WebGL2RenderingContext, lookups, calls };
}

describe("GLProgram.setI", () => {
  it("calls uniform1i with the named location and the value", () => {
    const { gl, calls } = fakeGL();
    const p = createProgram(gl, "void main() {}");
    p.setI("uGlowTex", 3);
    expect(calls).toEqual([["uniform1i", "uGlowTex", 3]]);
  });

  it("shares the location cache with setF, so a name is looked up once", () => {
    // Breaks if setI goes to gl.getUniformLocation directly, or keeps its own
    // map: the lookups list would then grow past the single "uMix".
    const { gl, lookups, calls } = fakeGL();
    const p = createProgram(gl, "void main() {}");
    p.setF("uMix", 0.25);
    p.setI("uMix", 2);
    p.setI("uMix", 5);
    expect(lookups).toEqual(["uMix"]);
    expect(calls).toEqual([
      ["uniform1f", "uMix", 0.25],
      ["uniform1i", "uMix", 2],
      ["uniform1i", "uMix", 5],
    ]);
  });

  it("keeps the location cache per program", () => {
    // Breaks if the cache is hoisted to module scope: program b would reuse
    // the location program a looked up, and a location from one program is
    // not valid on another.
    const { gl, lookups } = fakeGL();
    const a = createProgram(gl, "void main() {}");
    const b = createProgram(gl, "void main() {}");
    a.setI("uTex", 1);
    b.setI("uTex", 2);
    expect(lookups).toEqual(["uTex", "uTex"]);
  });
});
