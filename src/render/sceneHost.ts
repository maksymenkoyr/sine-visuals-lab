import type { Scene, SceneContext } from "./scene.ts";
import type { QualitySettings } from "./quality.ts";
import { deferProgramChecks } from "./programCache.ts";
import { loadScene, sceneReady } from "./lazyScene.ts";

export interface SceneHostOptions {
  /** A mount that was accepted before the scene's code arrived and then failed
   *  (the load, or the init that followed it). The scene is no longer mounted.
   *  Default: console.error. */
  onLateMountError?(scene: Scene, err: unknown): void;
}

export interface SceneHost {
  readonly ctx: SceneContext;
  /** Mounts `scene` onto this host's GL context, first unmounting it from
   *  whichever host currently owns it (if any). Scenes hold their GL program
   *  and VAO in a closure, so a scene may be `init()`-ed on at most one
   *  context at a time — this makes that invariant structural instead of a
   *  call-ordering convention callers have to get right.
   *
   *  Throws if the scene's `init()` does (an unsupported render target), or
   *  if a program it created won't compile or link on this GPU: init() only
   *  submits its programs, and deferProgramChecks (programCache.ts) checks
   *  them all once it returns. Whatever it half-built is disposed first and
   *  the scene is not counted as mounted, so a retry starts clean; callers
   *  catch it and fall back to another scene.
   *
   *  A scene whose code hasn't arrived yet (lazyScene.ts) is claimed at once,
   *  its load is started, and `init` runs when the code lands; until then it
   *  draws nothing and `isMounted` is true. It never throws: a failure of the
   *  load or of that late init unmounts the scene and goes to the host's
   *  `onLateMountError`. */
  mount(scene: Scene): void;
  unmount(scene: Scene): void;
  unmountAll(): void;
  /** Whether `scene` is currently init()-ed on THIS host (not on another). */
  isMounted(scene: Scene): boolean;
}

// Module-level so ownership is tracked across every SceneHost instance, not
// just within one — the whole point is to catch a scene mounted on two
// different hosts (e.g. the gallery's preview context and the main viz
// context) at once.
const owners = new Map<Scene, SceneHost>();

export function createSceneHost(
  gl: WebGL2RenderingContext,
  quality: QualitySettings,
  options: SceneHostOptions = {},
): SceneHost {
  const ctx: SceneContext = { gl, quality };
  const mounted = new Set<Scene>();
  // Claimed scenes whose code is still on its way.
  const pending = new Set<Scene>();
  const onLateMountError = options.onLateMountError ?? ((_scene: Scene, err: unknown) => console.error(err));

  function initOn(scene: Scene): void {
    try {
      deferProgramChecks(() => scene.init(ctx));
    } catch (err) {
      // init() assigns its programs/FBOs to closure variables as it goes, so
      // a throw part-way leaves live GL objects only dispose() can free. A
      // second throw (dispose reaching for a handle init never made) must
      // not mask the original error.
      try {
        scene.dispose(ctx);
      } catch {
        // The first failure is the one worth reporting.
      }
      throw err;
    }
  }

  function forget(scene: Scene): void {
    owners.delete(scene);
    mounted.delete(scene);
  }

  const host: SceneHost = {
    ctx,
    mount(scene: Scene): void {
      if (owners.get(scene) === host) return;
      owners.get(scene)?.unmount(scene);
      if (!sceneReady(scene)) {
        owners.set(scene, host);
        mounted.add(scene);
        pending.add(scene);
        loadScene(scene).then(
          () => {
            if (!pending.delete(scene)) return;
            try {
              initOn(scene);
            } catch (err) {
              forget(scene);
              onLateMountError(scene, err);
            }
          },
          (err) => {
            if (!pending.delete(scene)) return;
            forget(scene);
            onLateMountError(scene, err);
          },
        );
        return;
      }
      initOn(scene);
      owners.set(scene, host);
      mounted.add(scene);
    },
    unmount(scene: Scene): void {
      if (owners.get(scene) !== host) return;
      if (pending.delete(scene)) {
        forget(scene);
        return;
      }
      try {
        scene.dispose(ctx);
      } finally {
        // Even if dispose() throws (after a context loss its handles are all
        // dead), the scene stops counting as mounted here.
        owners.delete(scene);
        mounted.delete(scene);
      }
    },
    isMounted(scene: Scene): boolean {
      return owners.get(scene) === host;
    },
    unmountAll(): void {
      for (const scene of [...mounted]) host.unmount(scene);
    },
  };

  return host;
}
