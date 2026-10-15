import type { Scene, SceneGallery } from "../scene.ts";
import { isScene } from "./privateScenes.ts";

/**
 * How a free scene gets into the app without anyone editing a shared list.
 *
 * The contract: a scene module is `src/render/scenes/<unit>.ts` or
 * `src/render/scenes/<unit>/index.ts`, and it exports its `Scene` (under any
 * name) and `gallery` — a `SceneGallery`: which gallery section it sits in
 * and the day it was added. `scenes/index.ts` loads every file of those two
 * shapes with Vite's `import.meta.glob` and hands them to `collectScenes`; a
 * file that exports neither (a helper such as `fluidSim.ts`) is passed over.
 * So adding a scene is adding its file or folder, and moving it between
 * gallery sections edits only that scene's own file: parallel branches never
 * meet in a shared registry.
 *
 * The build tools find scene modules the same way without running any code
 * (tools/sceneVersionLib.mjs's `sceneEntries`: a file of either shape whose
 * source has a line starting `export const gallery`), so write the record
 * exactly that way. tests/sceneModules.test.ts checks the two readings agree.
 *
 * `<unit>` (the file's basename, or the folder's name) is the key per-scene
 * versions use (`sceneMajors.json`, tools/sceneVersionLib.mjs's header); it
 * can differ from the scene's `id` (`kaleido` holds `kaleidoscope`).
 *
 * Order: newest `added` first, ties by id. The gallery keeps registration
 * order within each section, so that is the order a section shows. Paid
 * scenes come from ./private/ under their own contract (privateScenes.ts) and
 * register after these.
 *
 * `collectScenes` never throws: a module that breaks the contract is skipped
 * and reported, the way `collectPrivateScenes` treats a private one.
 */

export interface CollectedScene {
  unit: string;
  scene: Scene;
  gallery: SceneGallery;
}

export interface CollectedScenes {
  /** Newest `added` first, ties by scene id. */
  scenes: CollectedScene[];
  /** One line per module skipped, naming its path and why. */
  errors: string[];
}

const STAGES: ReadonlySet<string> = new Set(["released", "development", "draft"]);

function isGallery(value: unknown): value is SceneGallery {
  const g = value as Partial<SceneGallery> | null;
  return (
    typeof g === "object" &&
    g !== null &&
    typeof g.stage === "string" &&
    STAGES.has(g.stage) &&
    typeof g.added === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(g.added)
  );
}

/** A scene module's unit from its glob path: the folder of a `…/<unit>/index.ts`,
 *  else the file's own basename. */
export function unitOfPath(path: string): string {
  const parts = path.split("/");
  const file = parts[parts.length - 1];
  if (file === "index.ts" && parts.length >= 2) return parts[parts.length - 2];
  return file.replace(/\.ts$/, "");
}

/** Turns the modules `import.meta.glob` found (path → module) into the free
 *  scenes to register, in gallery order — see this file's header. */
export function collectScenes(modules: Readonly<Record<string, unknown>>): CollectedScenes {
  const found: CollectedScene[] = [];
  const errors: string[] = [];
  const taken = new Set<string>();
  for (const path of Object.keys(modules).sort()) {
    const mod = (modules[path] ?? {}) as Record<string, unknown>;
    const scenes = [...new Set(Object.values(mod).filter(isScene))];
    if (!("gallery" in mod)) {
      if (scenes.length > 0) errors.push(`${path}: exports a scene but no \`gallery\``);
      continue;
    }
    if (!isGallery(mod.gallery)) {
      errors.push(`${path}: \`gallery\` needs a stage (released, development or draft) and added (YYYY-MM-DD)`);
      continue;
    }
    if (scenes.length !== 1) {
      errors.push(`${path}: exports ${scenes.length} scenes; a scene module exports exactly one`);
      continue;
    }
    const scene = scenes[0];
    if (taken.has(scene.id)) {
      errors.push(`${path}: scene id "${scene.id}" is already registered`);
      continue;
    }
    taken.add(scene.id);
    found.push({ unit: unitOfPath(path), scene, gallery: mod.gallery });
  }
  found.sort((a, b) => b.gallery.added.localeCompare(a.gallery.added) || a.scene.id.localeCompare(b.scene.id));
  return { scenes: found, errors };
}
