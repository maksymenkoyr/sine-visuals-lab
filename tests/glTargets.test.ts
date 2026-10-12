import { describe, it, expect } from "vitest";
import { createColorTarget, createTargetList, destroyTarget } from "../src/render/gl.ts";

// Distinct numbers, so a wrong constant shows up as a wrong number and not as
// a lucky match. gl.ts only passes these through, so their values don't matter.
const K = {
  TEXTURE_2D: 1,
  FRAMEBUFFER: 2,
  COLOR_ATTACHMENT0: 3,
  RGBA8: 10,
  RGBA: 11,
  UNSIGNED_BYTE: 12,
  RG16F: 20,
  RG: 21,
  HALF_FLOAT: 22,
  LINEAR: 30,
  LINEAR_MIPMAP_LINEAR: 31,
  NEAREST: 32,
  CLAMP_TO_EDGE: 40,
  REPEAT: 41,
  TEXTURE_MIN_FILTER: 50,
  TEXTURE_MAG_FILTER: 51,
  TEXTURE_WRAP_S: 52,
  TEXTURE_WRAP_T: 53,
  FRAMEBUFFER_COMPLETE: 0x8cd5,
} as const;

interface FakeTex {
  kind: "texture";
  id: number;
}
interface FakeFbo {
  kind: "framebuffer";
  id: number;
}

/** A GL stand-in that records what gl.ts asks for. `state.status` is what
 *  checkFramebufferStatus returns, and `state.framebufferFails` makes
 *  createFramebuffer return null. */
function fakeGl() {
  let nextId = 1;
  const state = {
    status: K.FRAMEBUFFER_COMPLETE as number,
    framebufferFails: false,
    texImages: [] as unknown[][],
    texParams: new Map<number, number>(),
    mipmaps: 0,
    createdTextures: [] as FakeTex[],
    createdFramebuffers: [] as FakeFbo[],
    deletedTextures: [] as FakeTex[],
    deletedFramebuffers: [] as FakeFbo[],
    boundFramebuffer: null as FakeFbo | null,
    boundTexture: null as FakeTex | null,
  };
  const gl = {
    ...K,
    createTexture: (): FakeTex => {
      const t: FakeTex = { kind: "texture", id: nextId++ };
      state.createdTextures.push(t);
      return t;
    },
    createFramebuffer: (): FakeFbo | null => {
      if (state.framebufferFails) return null;
      const f: FakeFbo = { kind: "framebuffer", id: nextId++ };
      state.createdFramebuffers.push(f);
      return f;
    },
    bindTexture: (_target: number, t: FakeTex | null) => {
      state.boundTexture = t;
    },
    bindFramebuffer: (_target: number, f: FakeFbo | null) => {
      state.boundFramebuffer = f;
    },
    texImage2D: (...args: unknown[]) => {
      state.texImages.push(args);
    },
    texParameteri: (_target: number, pname: number, value: number) => {
      state.texParams.set(pname, value);
    },
    generateMipmap: () => {
      state.mipmaps++;
    },
    framebufferTexture2D: () => {},
    checkFramebufferStatus: () => state.status,
    deleteTexture: (t: FakeTex) => {
      state.deletedTextures.push(t);
    },
    deleteFramebuffer: (f: FakeFbo) => {
      state.deletedFramebuffers.push(f);
    },
  };
  return { gl: gl as unknown as WebGL2RenderingContext, state };
}

describe("createColorTarget", () => {
  it("passes the format, filter and mipmap options through to GL", () => {
    const { gl, state } = fakeGl();
    const t = createColorTarget(gl, 320, 180, {
      internalFormat: K.RG16F,
      format: K.RG,
      type: K.HALF_FLOAT,
      minFilter: K.LINEAR_MIPMAP_LINEAR,
      mipmap: true,
    });
    expect(state.texImages).toEqual([[K.TEXTURE_2D, 0, K.RG16F, 320, 180, 0, K.RG, K.HALF_FLOAT, null]]);
    expect(state.texParams.get(K.TEXTURE_MIN_FILTER)).toBe(K.LINEAR_MIPMAP_LINEAR);
    expect(state.texParams.get(K.TEXTURE_MAG_FILTER)).toBe(K.LINEAR);
    expect(state.mipmaps).toBe(1);
    expect(t.w).toBe(320);
    expect(t.h).toBe(180);
  });

  it("defaults to a linear, clamped colour target with no mip chain", () => {
    const { gl, state } = fakeGl();
    createColorTarget(gl, 64, 32);
    expect(state.texImages).toEqual([[K.TEXTURE_2D, 0, K.RGBA8, 64, 32, 0, K.RGBA, K.UNSIGNED_BYTE, null]]);
    expect(state.texParams.get(K.TEXTURE_MIN_FILTER)).toBe(K.LINEAR);
    expect(state.texParams.get(K.TEXTURE_MAG_FILTER)).toBe(K.LINEAR);
    expect(state.texParams.get(K.TEXTURE_WRAP_S)).toBe(K.CLAMP_TO_EDGE);
    expect(state.texParams.get(K.TEXTURE_WRAP_T)).toBe(K.CLAMP_TO_EDGE);
    expect(state.mipmaps).toBe(0);
  });

  it("applies filter to MIN too when minFilter is unset, and wrap to both axes", () => {
    const { gl, state } = fakeGl();
    createColorTarget(gl, 64, 32, { filter: K.NEAREST, wrap: K.REPEAT });
    expect(state.texParams.get(K.TEXTURE_MIN_FILTER)).toBe(K.NEAREST);
    expect(state.texParams.get(K.TEXTURE_MAG_FILTER)).toBe(K.NEAREST);
    expect(state.texParams.get(K.TEXTURE_WRAP_S)).toBe(K.REPEAT);
    expect(state.texParams.get(K.TEXTURE_WRAP_T)).toBe(K.REPEAT);
  });

  it("frees what it made and throws one message when the framebuffer is incomplete", () => {
    const { gl, state } = fakeGl();
    state.status = 0x8cd6;
    expect(() => createColorTarget(gl, 8, 8, { label: "crystal" })).toThrow(
      "crystal: framebuffer incomplete (0x8cd6)",
    );
    expect(state.deletedTextures).toHaveLength(1);
    expect(state.deletedTextures[0]).toBe(state.createdTextures[0]);
    expect(state.deletedFramebuffers).toHaveLength(1);
    expect(state.deletedFramebuffers[0]).toBe(state.createdFramebuffers[0]);
    expect(state.boundFramebuffer).toBeNull();
  });

  it("frees the texture when no framebuffer can be made", () => {
    const { gl, state } = fakeGl();
    state.framebufferFails = true;
    expect(() => createColorTarget(gl, 8, 8, { label: "crystal" })).toThrow(
      "crystal: createFramebuffer failed",
    );
    expect(state.deletedTextures).toHaveLength(1);
    expect(state.deletedTextures[0]).toBe(state.createdTextures[0]);
    expect(state.deletedFramebuffers).toHaveLength(0);
  });
});

describe("destroyTarget", () => {
  it("frees only the given target, and does nothing for an unset slot", () => {
    const { gl, state } = fakeGl();
    const a = createColorTarget(gl, 4, 4);
    const b = createColorTarget(gl, 4, 4);
    destroyTarget(gl, a);
    expect(state.deletedTextures).toHaveLength(1);
    expect(state.deletedTextures[0]).toBe(a.tex);
    expect(state.deletedFramebuffers).toHaveLength(1);
    expect(state.deletedFramebuffers[0]).toBe(a.fbo);
    expect(state.deletedTextures).not.toContain(b.tex);
    expect(state.deletedFramebuffers).not.toContain(b.fbo);

    destroyTarget(gl, null);
    destroyTarget(gl, undefined);
    expect(state.deletedTextures).toHaveLength(1);
    expect(state.deletedFramebuffers).toHaveLength(1);
  });
});

describe("createTargetList", () => {
  it("frees every target it added, and forgets them so a second freeAll is a no-op", () => {
    const { gl, state } = fakeGl();
    const list = createTargetList();
    const made = [list.add(gl, 100, 50), list.add(gl, 50, 25), list.add(gl, 25, 12)];
    list.freeAll(gl);
    expect(state.deletedTextures).toHaveLength(3);
    expect(state.deletedFramebuffers).toHaveLength(3);
    for (const t of made) {
      expect(state.deletedTextures).toContain(t.tex);
      expect(state.deletedFramebuffers).toContain(t.fbo);
    }

    list.freeAll(gl);
    expect(state.deletedTextures).toHaveLength(3);
    expect(state.deletedFramebuffers).toHaveLength(3);

    const later = list.add(gl, 10, 10);
    list.freeAll(gl);
    expect(state.deletedTextures).toHaveLength(4);
    expect(state.deletedTextures[3]).toBe(later.tex);
    expect(state.deletedFramebuffers).toHaveLength(4);
    expect(state.deletedFramebuffers[3]).toBe(later.fbo);
  });
});
