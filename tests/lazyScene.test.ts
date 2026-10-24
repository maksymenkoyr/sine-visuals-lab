import { describe, expect, it, vi } from "vitest";
import { lazyScene, loadScene, sceneCard, sceneReady } from "../src/render/lazyScene.ts";
import { FULL_VIEWPORT, type Scene, type SceneCard, type SceneContext } from "../src/render/scene.ts";
import { qualitySettings } from "../src/render/quality.ts";
import type { SceneSetting } from "../src/render/sceneSettings.ts";

const ctx: SceneContext = { gl: {} as WebGL2RenderingContext, quality: qualitySettings("mid") };

function setup(opts: { initThrows?: boolean } = {}) {
  const calls = { init: 0, render: 0, dispose: 0, loads: 0 };
  const settings = [{ key: "a", label: "A", group: "Look", min: 0, max: 1, step: 0.1, default: 0.5 }] as unknown as SceneSetting[];
  const panel = [{ widget: "w", title: "T" }] as const;
  const card: SceneCard = { id: "lazy-test", name: "Lazy test", settings, panel };
  const body = {
    ...card,
    probe: () => ({ n: 1 }),
    command: vi.fn(),
    init() {
      calls.init++;
      if (opts.initThrows) throw new Error("boom");
    },
    render() {
      calls.render++;
    },
    dispose() {
      calls.dispose++;
    },
  } as unknown as Scene;
  const loadBody = vi.fn(() => {
    calls.loads++;
    return Promise.resolve(body);
  });
  const proxy = lazyScene(card, loadBody);
  const draw = () => proxy.render(ctx, {} as never, FULL_VIEWPORT, {} as never, {} as never);
  return { proxy, card, body, calls, loadBody, draw };
}

describe("lazyScene", () => {
  it("carries the card's id, name and the identical settings and panel objects", () => {
    const { proxy, card } = setup();
    expect(proxy.id).toBe("lazy-test");
    expect(proxy.name).toBe("Lazy test");
    expect(proxy.settings).toBe(card.settings);
    expect(proxy.panel).toBe(card.panel);
    expect(sceneCard(proxy)).toBe(card);
  });

  it("is ready only once its body has loaded; two loads fetch it once", async () => {
    const { proxy, calls } = setup();
    expect(sceneReady(proxy)).toBe(false);
    await Promise.all([loadScene(proxy), loadScene(proxy)]);
    expect(sceneReady(proxy)).toBe(true);
    await loadScene(proxy);
    expect(calls.loads).toBe(1);
  });

  it("throws on init before the load", () => {
    const { proxy, calls } = setup();
    expect(() => proxy.init(ctx)).toThrow(/hasn't loaded yet/);
    expect(calls.init).toBe(0);
  });

  it("draws nothing before init and draws after it", async () => {
    const { proxy, calls, draw } = setup();
    draw();
    await loadScene(proxy);
    draw();
    expect(calls.render).toBe(0);
    proxy.init(ctx);
    draw();
    expect(calls.render).toBe(1);
    proxy.dispose(ctx);
    draw();
    expect(calls.render).toBe(1);
    expect(calls.dispose).toBe(1);
  });

  it("forwards dispose after an init that threw part-way", async () => {
    const { proxy, calls, draw } = setup({ initThrows: true });
    await loadScene(proxy);
    expect(() => proxy.init(ctx)).toThrow("boom");
    draw();
    expect(calls.render).toBe(0);
    proxy.dispose(ctx);
    expect(calls.dispose).toBe(1);
    proxy.dispose(ctx);
    expect(calls.dispose).toBe(1);
  });

  it("does not dispose a body that never ran init", async () => {
    const { proxy, calls } = setup();
    await loadScene(proxy);
    proxy.dispose(ctx);
    expect(calls.dispose).toBe(0);
  });

  it("rejects a failed load and retries on the next call", async () => {
    const { proxy, body, loadBody } = setup();
    loadBody.mockImplementationOnce(() => Promise.reject(new Error("offline")));
    await expect(loadScene(proxy)).rejects.toThrow("offline");
    expect(sceneReady(proxy)).toBe(false);
    loadBody.mockImplementation(() => Promise.resolve(body));
    await loadScene(proxy);
    expect(sceneReady(proxy)).toBe(true);
    expect(loadBody).toHaveBeenCalledTimes(2);
  });

  it("has a null probe and a no-op command before the load, and forwards after", async () => {
    const { proxy, body } = setup();
    expect(proxy.probe?.()).toBeNull();
    proxy.command?.("x", {});
    expect(body.command).not.toHaveBeenCalled();
    await loadScene(proxy);
    expect(proxy.probe?.()).toEqual({ n: 1 });
    proxy.command?.("x", { v: 1 });
    expect(body.command).toHaveBeenCalledWith("x", { v: 1 });
  });

  it("treats a plain scene as ready", async () => {
    const plain = { id: "plain", name: "Plain", init() {}, render() {}, dispose() {} } as unknown as Scene;
    expect(sceneReady(plain)).toBe(true);
    expect(sceneCard(plain)).toBeUndefined();
    await expect(loadScene(plain)).resolves.toBeUndefined();
  });
});
