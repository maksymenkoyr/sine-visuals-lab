// GLProgram's uniform setters against a recording fake WebGL2 context, with no GPU.
import { describe, expect, it } from "vitest";
import { createProgram } from "../src/render/gl.ts";

interface Recorder {
  gl: WebGL2RenderingContext;
  lookups: [unknown, string][];
  uniform1i: [unknown, number][];
  uniform1f: [unknown, number][];
}

function fakeGL(): Recorder {
  let n = 0;
  const lookups: [unknown, string][] = [];
  const uniform1i: [unknown, number][] = [];
  const uniform1f: [unknown, number][] = [];
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    createShader: () => ({}),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true,
    createProgram: () => ({ id: ++n }),
    attachShader: () => {},
    linkProgram: () => {},
    deleteShader: () => {},
    getProgramParameter: () => true,
    useProgram: () => {},
    deleteProgram: () => {},
    getUniformLocation: (p: unknown, name: string) => {
      lookups.push([p, name]);
      return { prog: p, name };
    },
    uniform1i: (l: unknown, v: number) => {
      uniform1i.push([l, v]);
    },
    uniform1f: (l: unknown, v: number) => {
      uniform1f.push([l, v]);
    },
  };
  return { gl: gl as unknown as WebGL2RenderingContext, lookups, uniform1i, uniform1f };
}

describe("GLProgram.setI", () => {
  it("sets an int uniform through its own location", () => {
    const { gl, uniform1i, uniform1f } = fakeGL();
    const p = createProgram(gl, "frag");
    p.setI("uGlowBTex", 2);
    expect(uniform1i).toEqual([[{ prog: p.program, name: "uGlowBTex" }, 2]]);
    expect(uniform1f).toHaveLength(0);
  });

  it("reuses the program's cached location for a repeated name", () => {
    const { gl, lookups, uniform1i } = fakeGL();
    const p = createProgram(gl, "frag");
    p.setI("uTex", 3);
    p.setI("uTex", 1);
    expect(lookups.filter(([, n]) => n === "uTex")).toHaveLength(1);
    expect(uniform1i[0]![0]).toBe(uniform1i[1]![0]);
    expect(uniform1i.map(([, v]) => v)).toEqual([3, 1]);
  });

  it("keeps separate locations for the same name in two programs", () => {
    const { gl, uniform1i } = fakeGL();
    const a = createProgram(gl, "frag");
    const b = createProgram(gl, "frag");
    a.setI("uAgentPos", 1);
    b.setI("uAgentPos", 4);
    expect((uniform1i[0]![0] as { prog: unknown }).prog).toBe(a.program);
    expect(uniform1i[0]![1]).toBe(1);
    expect((uniform1i[1]![0] as { prog: unknown }).prog).toBe(b.program);
    expect(uniform1i[1]![1]).toBe(4);
  });
});
