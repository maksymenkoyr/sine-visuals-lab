import type { Scene } from "../scene.ts";

/**
 * Paid scenes live outside this public repo. This file is the one place that
 * knows how they get in.
 *
 * The contract: a paid scene is a folder `src/render/scenes/private/<id>/`
 * whose `index.ts` exports `scene` (a `Scene`) and, optionally, `draft: true`
 * to put it behind the gallery's draft toggle. `private/` is gitignored here;
 * on a developer's machine it is a checkout of the private scenes repo (which
 * `tools/private-scenes.mjs` clones before `npm run dev` when you have access), so
 * every paid scene registers alongside the free ones: gallery tile, `#/v/<id>`
 * link, settings panel, tuning tools, HMR, all unchanged. `scenes/index.ts`
 * finds those folders with Vite's `import.meta.glob`, which quietly matches
 * nothing where the folder doesn't exist, so the public repo, its CI and the
 * deployed site build without them, and no paid code ever lands in a public
 * bundle.
 *
 * That makes this a build-time hook for development. Getting paid scenes to
 * buyers is a separate, later mechanism: a paid scene built into its own
 * module, served only to entitled users and loaded at runtime with a dynamic
 * `import()`. It would hand its module to `collectPrivateScenes` exactly the
 * way the glob does today — the module contract above is the seam both share.
 *
 * `collectPrivateScenes` is the pure core (tested in
 * `tests/privateScenes.test.ts`). It never throws: a malformed module or an id
 * that collides with a built-in scene is skipped and reported, so one bad
 * private checkout can't take the app down.
 */

/** What a paid scene's `index.ts` exports. */
export interface PrivateSceneModule {
  scene: Scene;
  draft?: boolean;
}

export interface CollectedPrivateScenes {
  /** In module-path order, so the gallery order is stable across reloads. */
  scenes: Scene[];
  /** Ids of the collected scenes that asked to be drafts. */
  draftIds: string[];
  /** One line per module skipped, naming its path and why. */
  errors: string[];
}

function isScene(value: unknown): value is Scene {
  const s = value as Partial<Scene> | null;
  return (
    typeof s === "object" &&
    s !== null &&
    typeof s.id === "string" &&
    s.id.length > 0 &&
    typeof s.name === "string" &&
    typeof s.init === "function" &&
    typeof s.render === "function" &&
    typeof s.dispose === "function"
  );
}

/** Turns the modules `import.meta.glob` found (path → module) into scenes to
 *  register, skipping any that don't follow the contract or whose id is
 *  already taken by a built-in scene or an earlier private one. */
export function collectPrivateScenes(
  modules: Readonly<Record<string, unknown>>,
  takenIds: ReadonlySet<string>,
): CollectedPrivateScenes {
  const scenes: Scene[] = [];
  const draftIds: string[] = [];
  const errors: string[] = [];
  const taken = new Set(takenIds);
  for (const path of Object.keys(modules).sort()) {
    const mod = modules[path] as Partial<PrivateSceneModule> | null | undefined;
    const scene = mod?.scene;
    if (!isScene(scene)) {
      errors.push(`${path}: doesn't export a valid \`scene\` (needs id, name, init, render, dispose)`);
      continue;
    }
    if (taken.has(scene.id)) {
      errors.push(`${path}: scene id "${scene.id}" is already registered`);
      continue;
    }
    taken.add(scene.id);
    scenes.push(scene);
    if (mod?.draft === true) draftIds.push(scene.id);
  }
  return { scenes, draftIds, errors };
}
