import type { Scene, SceneContext } from "./scene.ts";
import type { QualitySettings } from "./quality.ts";

export interface SceneHost {
  readonly ctx: SceneContext;
  /** Mounts `scene` onto this host's GL context, first unmounting it from
   *  whichever host currently owns it (if any). Scenes hold their GL program
   *  and VAO in a closure, so a scene may be `init()`-ed on at most one
   *  context at a time — this makes that invariant structural instead of a
   *  call-ordering convention callers have to get right.
   *
   *  Throws if the scene's `init()` does (a shader that won't compile on this
   *  GPU, an unsupported render target). Whatever it half-built is disposed
   *  first and the scene is not counted as mounted, so a retry starts clean;
   *  callers catch it and fall back to another scene. */
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

export function createSceneHost(gl: WebGL2RenderingContext, quality: QualitySettings): SceneHost {
  const ctx: SceneContext = { gl, quality };
  const mounted = new Set<Scene>();

  const host: SceneHost = {
    ctx,
    mount(scene: Scene): void {
      if (owners.get(scene) === host) return;
      owners.get(scene)?.unmount(scene);
      try {
        scene.init(ctx);
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
      owners.set(scene, host);
      mounted.add(scene);
    },
    unmount(scene: Scene): void {
      if (owners.get(scene) !== host) return;
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
