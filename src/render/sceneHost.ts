import type { Scene, SceneContext } from "./scene.ts";
import type { TierSettings } from "./tier.ts";

export interface SceneHost {
  readonly ctx: SceneContext;
  /** Mounts `scene` onto this host's GL context, first unmounting it from
   *  whichever host currently owns it (if any). Scenes hold their GL program
   *  and VAO in a closure, so a scene may be `init()`-ed on at most one
   *  context at a time — this makes that invariant structural instead of a
   *  call-ordering convention callers have to get right. */
  mount(scene: Scene): void;
  unmount(scene: Scene): void;
  unmountAll(): void;
}

// Module-level so ownership is tracked across every SceneHost instance, not
// just within one — the whole point is to catch a scene mounted on two
// different hosts (e.g. the gallery's preview context and the main viz
// context) at once.
const owners = new Map<Scene, SceneHost>();

export function createSceneHost(gl: WebGL2RenderingContext, tier: TierSettings): SceneHost {
  const ctx: SceneContext = { gl, tier };
  const mounted = new Set<Scene>();

  const host: SceneHost = {
    ctx,
    mount(scene: Scene): void {
      if (owners.get(scene) === host) return;
      owners.get(scene)?.unmount(scene);
      scene.init(ctx);
      owners.set(scene, host);
      mounted.add(scene);
    },
    unmount(scene: Scene): void {
      if (owners.get(scene) !== host) return;
      scene.dispose(ctx);
      owners.delete(scene);
      mounted.delete(scene);
    },
    unmountAll(): void {
      for (const scene of [...mounted]) host.unmount(scene);
    },
  };

  return host;
}
