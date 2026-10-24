/**
 * The card/body split of a scene, so a page draws its first frame without
 * parsing every scene's shaders and code (the TV and the pop-out output load
 * only the scene they show).
 *
 * A scene is two files. Its **card** is eager: id, name, minQuality, settings,
 * panel and the gallery record, which everything that lists, tunes or labels a
 * scene reads without running it. Its **body** (the scene file: init,
 * render, dispose, probe, command) is imported on demand. `lazyScene` turns a
 * card plus a body loader into a proxy `Scene` that the registry holds, so
 * every synchronous reader of `getScene`/`listScenes` stays unchanged. The
 * proxy's `settings` and `panel` are the card's own objects, and the body
 * spreads the same card, so the registered settings array and the body's are
 * one object.
 *
 * A proxy draws nothing until its body has arrived and been `init`-ed:
 * `render` is dropped before then, `probe` is null and `command` a no-op. A
 * host mounts a scene whose body hasn't arrived through `loadScene` (see
 * sceneHost.ts), and `init` throws if called before the load.
 *
 * Every page loads every body after load, at idle (`preloadScenes` in
 * scenes/index.ts), because src/pinnedAssets.ts's rule forbids a first-time
 * fetch of a build file late in a session: a deploy in between would 404 it.
 */
import type { Scene, SceneCard, SceneContext } from "./scene.ts";

interface LazyEntry {
  card: SceneCard;
  load(): Promise<void>;
  ready(): boolean;
}

const lazy = new WeakMap<Scene, LazyEntry>();

export function lazyScene(card: SceneCard, loadBody: () => Promise<Scene>): Scene {
  let body: Scene | null = null;
  let inflight: Promise<void> | null = null;
  let initCalled = false;
  let live = false;

  const scene: Scene = {
    ...card,
    probe: () => body?.probe?.() ?? null,
    command: (name, args) => body?.command?.(name, args),
    init(ctx: SceneContext) {
      if (!body) throw new Error(`Scene "${card.id}": its code hasn't loaded yet (loadScene first)`);
      initCalled = true;
      body.init(ctx);
      live = true;
    },
    render(...args: Parameters<Scene["render"]>) {
      if (live) body?.render(...args);
    },
    dispose(ctx: SceneContext) {
      if (!initCalled) return;
      // Forwarded even after an init that threw part-way: SceneHost frees what it half-built.
      initCalled = false;
      live = false;
      body?.dispose(ctx);
    },
  };

  lazy.set(scene, {
    card,
    ready: () => body !== null,
    load() {
      if (body) return Promise.resolve();
      inflight ??= loadBody().then(
        (loaded) => {
          body = loaded;
        },
        (err) => {
          inflight = null;
          throw err;
        },
      );
      return inflight;
    },
  });
  return scene;
}

/** True for a plain (non-proxy) scene, or a proxy whose body has arrived. */
export function sceneReady(scene: Scene): boolean {
  return lazy.get(scene)?.ready() ?? true;
}

/** Resolves once `scene` can be `init`-ed. Concurrent calls share one load; a
 *  failed load rejects and the next call tries again. */
export function loadScene(scene: Scene): Promise<void> {
  return lazy.get(scene)?.load() ?? Promise.resolve();
}

/** The card behind a proxy; undefined for a plain scene. */
export function sceneCard(scene: Scene): SceneCard | undefined {
  return lazy.get(scene)?.card;
}
