import { describe, expect, it, vi } from "vitest";
import { chooseFallback, createSceneGuard, SceneRenderError, type SceneGuard } from "../src/render/sceneGuard.ts";
import type { Scene } from "../src/render/scene.ts";

// A stub scene: `render` counts its calls and throws while `broken`.
function fakeScene(id: string) {
  const stub = { broken: false, renders: 0 };
  const scene = {
    id,
    name: id,
    init() {},
    dispose() {},
    render() {
      stub.renders++;
      if (stub.broken) throw new Error(`${id} is broken`);
    },
  } as unknown as Scene;
  return { scene, stub };
}

const sceneOf = (id: string): Scene => fakeScene(id).scene;

function drawOf(scene: Scene): void {
  (scene as unknown as { render(): void }).render();
}

/** One screen's loop. `view.current` is what it shows; a cut reassigns it.
 *  `cut` overrides the cut to say no (false) or to throw. */
function screen(
  start: Scene,
  builtIn: Scene | undefined,
  o: { canRun?: (s: Scene) => boolean; cut?: (next: Scene) => boolean } = {},
) {
  const view = { current: start };
  const log = vi.fn();
  const notice = vi.fn();
  const dropOutgoing = vi.fn();
  const switchTo = vi.fn((next: Scene) => {
    const ok = o.cut ? o.cut(next) : true;
    if (ok) view.current = next;
    return ok;
  });
  const guard = createSceneGuard({
    switchTo,
    dropOutgoing,
    builtIn: () => builtIn,
    canRun: o.canRun ?? (() => true),
    notice,
    log,
  });
  const frame = () =>
    guard.draw(view.current, () => {
      drawOf(view.current);
      return { governable: true };
    });
  return { guard, view, log, notice, switchTo, dropOutgoing, frame };
}

describe("sceneGuard", () => {
  it("logs a throwing scene once, skips only its frame, and draws the fallback after", () => {
    const a = fakeScene("a");
    const b = fakeScene("b");
    const s = screen(a.scene, undefined);
    const out: unknown[] = [];
    for (let n = 1; n <= 8; n++) {
      if (n === 2) s.view.current = b.scene;
      if (n === 3) b.stub.broken = true;
      out.push(s.frame());
    }
    expect(out).toHaveLength(8);
    expect(out.filter((r) => r === undefined)).toHaveLength(1);
    expect(out[2]).toBeUndefined();
    expect(s.log).toHaveBeenCalledTimes(1);
    expect(s.log.mock.calls[0][0]).toContain('"b"');
    expect(s.log.mock.calls[0][1]).toBeInstanceOf(Error);
    expect(s.view.current).toBe(a.scene);
    expect(a.stub.renders).toBe(6);
    expect(s.notice).toHaveBeenCalledTimes(1);
    expect(s.notice).toHaveBeenCalledWith(b.scene, a.scene, true);
  });

  it("falls back to the built-in scene when nothing drew before", () => {
    const spectrum = fakeScene("spectrum");
    const b = fakeScene("b");
    const s = screen(b.scene, spectrum.scene);
    b.stub.broken = true;
    s.frame();
    expect(s.switchTo).toHaveBeenCalledWith(spectrum.scene, b.scene);
    expect(s.notice).toHaveBeenCalledWith(b.scene, spectrum.scene, false);
    expect(s.view.current).toBe(spectrum.scene);
  });

  it("chooses nothing with no built-in, and then stops rendering the scene", () => {
    const c = fakeScene("c");
    c.stub.broken = true;
    const s = screen(c.scene, undefined);
    s.frame();
    s.frame();
    s.frame();
    expect(s.switchTo).not.toHaveBeenCalled();
    expect(s.notice).not.toHaveBeenCalled();
    expect(s.log).toHaveBeenCalledTimes(1);
    expect(c.stub.renders).toBe(1);
  });

  it("chooses nothing when the built-in scene has already failed", () => {
    const spectrum = fakeScene("spectrum");
    spectrum.stub.broken = true;
    const d = fakeScene("d");
    const s = screen(spectrum.scene, spectrum.scene);
    s.frame();
    s.view.current = d.scene;
    d.stub.broken = true;
    s.frame();
    s.frame();
    expect(s.switchTo).not.toHaveBeenCalled();
    expect(s.log).toHaveBeenCalledTimes(2);
    expect(d.stub.renders).toBe(1);
  });

  it("drops a crossfade's outgoing scene without cutting the incoming one", () => {
    const a = fakeScene("a");
    const b = fakeScene("b");
    const spectrum = sceneOf("spectrum");
    const s = screen(a.scene, spectrum);
    s.frame();
    s.view.current = b.scene;
    s.frame();
    const out = s.guard.draw(b.scene, () => {
      throw new SceneRenderError(a.scene, new Error("a broke"));
    });
    expect(out).toBeUndefined();
    expect(s.dropOutgoing).toHaveBeenCalledTimes(1);
    expect(s.switchTo).not.toHaveBeenCalled();
    expect(s.notice).not.toHaveBeenCalled();
    expect(s.log).toHaveBeenCalledTimes(1);
    expect(s.log.mock.calls[0][0]).toContain('"a"');
    expect(s.guard.hasFailed(a.scene.id)).toBe(true);
    expect(s.guard.hasFailed(b.scene.id)).toBe(false);
    // The incoming scene is still on screen and still draws.
    expect(s.frame()).toEqual({ governable: true });
    // The dropped scene is no fallback later on.
    b.stub.broken = true;
    s.frame();
    expect(s.switchTo).toHaveBeenCalledTimes(1);
    expect(s.switchTo.mock.calls[0][0]).toBe(spectrum);
  });

  it("lets a stopped scene render again after forgive, and cuts away again on a second throw without a new log", () => {
    const a = fakeScene("a");
    const b = fakeScene("b");
    const s = screen(a.scene, undefined);
    s.frame();
    s.view.current = b.scene;
    s.frame();
    b.stub.broken = true;
    s.frame();
    expect(s.view.current).toBe(a.scene);
    expect(s.guard.hasFailed(b.scene.id)).toBe(true);
    s.frame();
    expect(b.stub.renders).toBe(2);

    s.guard.forgive(b.scene.id);
    s.view.current = b.scene;
    s.frame();
    expect(b.stub.renders).toBe(3);
    expect(s.view.current).toBe(a.scene);
    expect(s.switchTo).toHaveBeenCalledTimes(2);
    expect(s.log).toHaveBeenCalledTimes(1);
  });

  it("ignores a forgive that comes from inside switchTo", () => {
    const a = fakeScene("a");
    const b = fakeScene("b");
    const view = { current: a.scene };
    const guard: SceneGuard = createSceneGuard({
      switchTo(next, failed) {
        guard.forgive(failed.id);
        view.current = next;
        return true;
      },
      dropOutgoing() {},
      builtIn: () => undefined,
      canRun: () => true,
      log() {},
    });
    const frame = () =>
      guard.draw(view.current, () => {
        drawOf(view.current);
        return { governable: true };
      });
    frame();
    view.current = b.scene;
    frame();
    b.stub.broken = true;
    frame();
    expect(view.current).toBe(a.scene);
    expect(guard.hasFailed(b.scene.id)).toBe(true);
    expect(frame()).toEqual({ governable: true });
    expect(b.stub.renders).toBe(2);
  });

  it("tries the next candidate when a cut says no", () => {
    const a = fakeScene("a");
    const c = fakeScene("c");
    const b = fakeScene("b");
    const s = screen(a.scene, undefined, { cut: (next) => next !== c.scene });
    s.frame();
    s.view.current = c.scene;
    s.frame();
    s.view.current = b.scene;
    s.frame();
    b.stub.broken = true;
    s.frame();
    expect(s.switchTo).toHaveBeenCalledTimes(2);
    expect(s.switchTo.mock.calls[0][0]).toBe(c.scene);
    expect(s.switchTo.mock.calls[1][0]).toBe(a.scene);
    expect(s.view.current).toBe(a.scene);
    expect(s.notice).toHaveBeenCalledWith(b.scene, a.scene, true);
  });

  it("tries the next candidate when a cut throws", () => {
    const a = fakeScene("a");
    const c = fakeScene("c");
    const b = fakeScene("b");
    const s = screen(a.scene, undefined, {
      cut: (next) => {
        if (next === c.scene) throw new Error("c cannot start");
        return true;
      },
    });
    s.frame();
    s.view.current = c.scene;
    s.frame();
    s.view.current = b.scene;
    s.frame();
    b.stub.broken = true;
    s.frame();
    expect(s.switchTo).toHaveBeenCalledTimes(2);
    expect(s.view.current).toBe(a.scene);
    expect(s.notice).toHaveBeenCalledWith(b.scene, a.scene, true);
  });

  it("blames a plain Error on the scene that was drawn", () => {
    const b = fakeScene("b");
    const spectrum = sceneOf("spectrum");
    const s = screen(b.scene, spectrum);
    s.guard.draw(b.scene, () => {
      throw new Error("plain");
    });
    expect(s.log).toHaveBeenCalledTimes(1);
    expect(s.log.mock.calls[0][0]).toContain('"b"');
    expect(s.log.mock.calls[0][1]).toEqual(new Error("plain"));
    expect(s.switchTo).toHaveBeenCalledWith(spectrum, b.scene);
  });

  it("names the scene in a SceneRenderError", () => {
    const a = sceneOf("a");
    const cause = new Error("x");
    const err = new SceneRenderError(a, cause);
    expect(err.message).toBe('Scene "a" threw while drawing');
    expect(err.scene).toBe(a);
    expect(err.original).toBe(cause);
  });
});

describe("chooseFallback", () => {
  const a = sceneOf("a");
  const b = sceneOf("b");
  const c = sceneOf("c");
  const d = sceneOf("d");
  const spectrum = sceneOf("spectrum");
  const all = () => true;

  it("returns the newest usable scene from history", () => {
    const r = chooseFallback(d, [a, b, c], new Set(["c"]), spectrum, all);
    expect(r?.scene).toBe(b);
    expect(r?.wasShown).toBe(true);
  });

  it("skips a history scene that cannot run", () => {
    const r = chooseFallback(d, [a, b, c], new Set(), spectrum, (s) => s !== c && s !== b);
    expect(r?.scene).toBe(a);
    expect(r?.wasShown).toBe(true);
  });

  it("never picks the failed scene from history", () => {
    const r = chooseFallback(d, [a, d], new Set(), spectrum, all);
    expect(r?.scene).toBe(a);
  });

  it("falls back to the built-in scene, flagged as not shown", () => {
    const r = chooseFallback(d, [c], new Set(["c"]), spectrum, all);
    expect(r?.scene).toBe(spectrum);
    expect(r?.wasShown).toBe(false);
  });

  it("returns null with no usable history, no built-in, or a built-in that is bad or cannot run", () => {
    expect(chooseFallback(d, [], new Set(), undefined, all)).toBeNull();
    expect(chooseFallback(d, [], new Set(["spectrum"]), spectrum, all)).toBeNull();
    expect(chooseFallback(d, [], new Set(), spectrum, (s) => s !== spectrum)).toBeNull();
  });
});
