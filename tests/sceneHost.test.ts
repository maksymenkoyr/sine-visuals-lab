import { describe, expect, it } from "vitest";
import { createSceneHost } from "../src/render/sceneHost.ts";
import { qualitySettings } from "../src/render/quality.ts";
import type { Scene } from "../src/render/scene.ts";

// sceneHost only passes the GL context through to the scene, so a stub does.
const gl = {} as WebGL2RenderingContext;

function fakeScene(id: string, opts: { initThrows?: boolean; disposeThrows?: boolean } = {}) {
  const calls = { init: 0, dispose: 0 };
  const scene = {
    id,
    name: id,
    init() {
      calls.init++;
      if (opts.initThrows) throw new Error(`${id}: shader compile error`);
    },
    dispose() {
      calls.dispose++;
      if (opts.disposeThrows) throw new Error(`${id}: dead handle`);
    },
    render() {},
  } as unknown as Scene;
  return { scene, calls };
}

describe("sceneHost", () => {
  const host = () => createSceneHost(gl, qualitySettings("mid"));

  it("mounts a scene once and disposes it on unmount", () => {
    const h = host();
    const { scene, calls } = fakeScene("ok-once");
    h.mount(scene);
    h.mount(scene);
    expect(calls.init).toBe(1);
    expect(h.isMounted(scene)).toBe(true);
    h.unmount(scene);
    expect(calls.dispose).toBe(1);
    expect(h.isMounted(scene)).toBe(false);
  });

  it("a throwing init rethrows, disposes its half-built state, and is not counted as mounted", () => {
    const h = host();
    const bad = fakeScene("bad", { initThrows: true });
    expect(() => h.mount(bad.scene)).toThrow(/shader compile error/);
    expect(bad.calls.dispose).toBe(1);
    expect(h.isMounted(bad.scene)).toBe(false);
    // Not owned, so a retry runs init again instead of being skipped.
    expect(() => h.mount(bad.scene)).toThrow();
    expect(bad.calls.init).toBe(2);
  });

  it("reports the init error even when dispose throws too", () => {
    const h = host();
    const bad = fakeScene("bad2", { initThrows: true, disposeThrows: true });
    expect(() => h.mount(bad.scene)).toThrow(/shader compile error/);
  });

  it("a later good mount works, and unmountAll leaves the failed scene alone", () => {
    const h = host();
    const bad = fakeScene("bad3", { initThrows: true });
    const good = fakeScene("good");
    expect(() => h.mount(bad.scene)).toThrow();
    h.mount(good.scene);
    expect(h.isMounted(good.scene)).toBe(true);
    h.unmountAll();
    expect(good.calls.dispose).toBe(1);
    expect(bad.calls.dispose).toBe(1); // only the cleanup inside the failed mount
  });

  it("unmount drops ownership even when dispose throws", () => {
    const h = host();
    const s = fakeScene("dead", { disposeThrows: true });
    h.mount(s.scene);
    expect(() => h.unmount(s.scene)).toThrow(/dead handle/);
    expect(h.isMounted(s.scene)).toBe(false);
  });

  it("mounting on a second host takes the scene from the first", () => {
    const a = host();
    const b = host();
    const s = fakeScene("moves");
    a.mount(s.scene);
    b.mount(s.scene);
    expect(a.isMounted(s.scene)).toBe(false);
    expect(b.isMounted(s.scene)).toBe(true);
    expect(s.calls.dispose).toBe(1);
  });
});
