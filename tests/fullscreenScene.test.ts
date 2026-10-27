// createFullscreenScene's render path against a fake WebGL2 context that
// records every uniform upload per program, so beforeDraw's `upload` can be
// checked without a GPU: a second pass must get exactly what the scene's own
// program got on the same draw, this frame's extras included.
import { describe, expect, it } from "vitest";
import { createFullscreenScene, sceneUniformsGlsl } from "../src/render/fullscreenScene.ts";
import { createProgram } from "../src/render/gl.ts";
import { createAnimClock } from "../src/render/animClock.ts";
import { PALETTES } from "../src/render/palette.ts";
import { qualitySettings } from "../src/render/quality.ts";
import { FULL_VIEWPORT } from "../src/render/scene.ts";
import type { SceneSetting } from "../src/render/sceneSettings.ts";
import { NUM_BANDS, type FeatureFrame } from "../src/audio/types.ts";

const C = {
  VERTEX_SHADER: 0x8b31, FRAGMENT_SHADER: 0x8b30, DELETE_STATUS: 0x8b80, COMPILE_STATUS: 0x8b81,
  LINK_STATUS: 0x8b82, ACTIVE_UNIFORMS: 0x8b86, CURRENT_PROGRAM: 0x8b8d, ARRAY_BUFFER: 0x8892,
  STATIC_DRAW: 0x88e4, FLOAT: 0x1406, TRIANGLES: 0x0004,
};
interface Shader { type: number; source: string }
interface Program { id: number; shaders: Shader[] }
interface Loc { program: Program; name: string }

function fakeGL() {
  const programs: Program[] = [];
  const uploads = new Map<Program, Map<string, number[]>>();
  const draws: (Program | null)[] = [];
  let current: Program | null = null;
  const put = (loc: Loc | null, values: number[]) => {
    if (!loc) return;
    let byName = uploads.get(loc.program);
    if (!byName) uploads.set(loc.program, (byName = new Map()));
    byName.set(loc.name, values);
  };
  const gl = {
    ...C,
    canvas: new EventTarget(),
    drawingBufferWidth: 64,
    drawingBufferHeight: 36,
    getExtension: () => null,
    createShader: (type: number): Shader => ({ type, source: "" }),
    shaderSource: (s: Shader, source: string) => { s.source = source; },
    compileShader: () => {},
    getShaderParameter: () => true,
    deleteShader: () => {},
    createProgram: (): Program => {
      const p = { id: programs.length, shaders: [] };
      programs.push(p);
      return p;
    },
    attachShader: (p: Program, s: Shader) => { p.shaders.push(s); },
    linkProgram: () => {},
    getProgramParameter: (_p: Program, pname: number) => (pname === C.DELETE_STATUS ? false : pname === C.ACTIVE_UNIFORMS ? 0 : true),
    deleteProgram: () => {},
    useProgram: (p: Program | null) => { current = p; },
    getParameter: (pname: number) => (pname === C.CURRENT_PROGRAM ? current : null),
    getUniformLocation: (program: Program, name: string): Loc => ({ program, name }),
    uniform1f: (loc: Loc | null, v: number) => put(loc, [v]),
    uniform1i: (loc: Loc | null, v: number) => put(loc, [v]),
    uniform2f: (loc: Loc | null, x: number, y: number) => put(loc, [x, y]),
    uniform4f: (loc: Loc | null, x: number, y: number, z: number, w: number) => put(loc, [x, y, z, w]),
    uniform1fv: (loc: Loc | null, a: ArrayLike<number>) => put(loc, Array.from(a)),
    uniform3fv: (loc: Loc | null, a: ArrayLike<number>) => put(loc, Array.from(a)),
    uniform4fv: (loc: Loc | null, a: ArrayLike<number>) => put(loc, Array.from(a)),
    createVertexArray: () => ({}),
    bindVertexArray: () => {},
    deleteVertexArray: () => {},
    createBuffer: () => ({}),
    bindBuffer: () => {},
    bufferData: () => {},
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    drawArrays: () => { draws.push(current); },
  };
  return { gl: gl as unknown as WebGL2RenderingContext, programs, uploads, draws };
}

function frame(): FeatureFrame {
  return {
    time: 0, bands: new Float32Array(NUM_BANDS).fill(0.3), energy: 0.5, level: 0.5, hats: 0, lead: 0,
    onset: false, pulseOnset: false, bpm: 120, onsetPhase: 0, engine: null,
  };
}

const SETTINGS: SceneSetting[] = [{ key: "glow", label: "Glow", min: 0, max: 1, step: 0.05, default: 0.4 }];
const EXTRA_DECLS = "uniform float uSpin;\nuniform float uRing[3];\nuniform vec4 uSpots[2];";
const SECOND_VERT = `#version 300 es\n${sceneUniformsGlsl(SETTINGS, EXTRA_DECLS)}\nvoid main() { gl_Position = vec4(uGlow + uSpin); }`;

describe("createFullscreenScene's beforeDraw upload", () => {
  it("gives a second program every uniform the scene's program got on this draw, extras included", () => {
    const { gl, programs, uploads, draws } = fakeGL();
    const ctx = { gl, quality: qualitySettings("high") };
    const scene = createFullscreenScene("uploadTest", "Upload test", "void main() { outColor = vec4(uGlow * uSpin); }", {
      settings: SETTINGS,
      extraUniformDecls: EXTRA_DECLS,
      extraUniforms: () => ({ uSpin: 0.25, uRing: new Float32Array([1, 2, 3]), uSpots: { vec4: new Float32Array(8).fill(0.5) } }),
      beforeDraw: (c, prog, _viewport, upload) => {
        upload(createProgram(c.gl, "#version 300 es\nprecision highp float;\nout vec4 o;\nvoid main() { o = vec4(1.0); }", SECOND_VERT));
        prog.use();
      },
    });
    scene.init(ctx);
    const anim = createAnimClock().advance(1 / 60, frame());
    scene.render(ctx, frame(), FULL_VIEWPORT, PALETTES[0]!, anim);

    const [own, second] = programs;
    expect(second).toBeDefined();
    const ownUploads = uploads.get(own!)!;
    const secondUploads = uploads.get(second!)!;
    expect(secondUploads).toEqual(ownUploads);
    expect(secondUploads.get("uGlow")).toEqual([0.4]);
    expect(secondUploads.get("uSpin")).toEqual([0.25]);
    expect(secondUploads.get("uRing")).toEqual([1, 2, 3]);
    expect(secondUploads.get("uSpots")).toEqual(new Array(8).fill(0.5));
    expect(draws).toEqual([own]);
  });

  it("declares for a second pass exactly what the scene's own fragment shader declares", () => {
    const { gl, programs } = fakeGL();
    const scene = createFullscreenScene("declTest", "Decl test", "void main() { outColor = vec4(uGlow); }", {
      settings: SETTINGS,
      extraUniformDecls: EXTRA_DECLS,
    });
    scene.init({ gl, quality: qualitySettings("high") });
    const fragSrc = programs[0]!.shaders.find((s) => s.type === C.FRAGMENT_SHADER)!.source;
    expect(fragSrc).toContain(sceneUniformsGlsl(SETTINGS, EXTRA_DECLS));
  });
});
