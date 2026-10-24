import type { Scene, SceneCard, SceneGallery } from "../scene.ts";
import { lazyScene } from "../lazyScene.ts";

/**
 * How a free scene gets into the app without anyone editing a shared list.
 *
 * The contract: a scene is a **card** file, `src/render/scenes/<unit>.card.ts`
 * or `src/render/scenes/<unit>/card.ts`, and a **body** next to it, `<unit>.ts`
 * or `<unit>/index.ts` (src/render/lazyScene.ts has what the split is for).
 * The card exports `gallery` — a `SceneGallery`: which gallery section it sits
 * in and the day it was added — `card` (a `SceneCard`: id, name, minQuality,
 * settings, panel) and `loadBody` (`() => Promise<Scene>`, a dynamic `import()`
 * of the body). The body exports the `Scene` (under any name) and spreads the
 * card into it, so the settings the registry holds and the ones the body
 * draws with are the same objects. A card never imports a body statically:
 * that would put the body back in the page's first-load JS
 * (tests/sceneCards.test.ts checks it).
 * `scenes/index.ts` loads every card with Vite's `import.meta.glob` and hands
 * them to `collectScenes`, which registers a proxy per card. A file that
 * exports no card (a body, or a helper such as `fluidSim.ts`) is passed over.
 * So adding a scene is adding its files, and moving it between gallery
 * sections edits only that scene's own card: parallel branches never meet in
 * a shared registry.
 *
 * The build tools find scene modules the same way without running any code
 * (tools/sceneVersionLib.mjs's `sceneEntries`: a card file whose source has a
 * line starting `export const gallery`), so write the record exactly that
 * way. tests/sceneModules.test.ts checks the two readings agree.
 *
 * A scene in the older one-file shape (the scene and `gallery` in `<unit>.ts`
 * or `<unit>/index.ts`) is no longer collected and would never show;
 * `sceneEntries` still finds that shape, so tests/sceneModules.test.ts fails on one.
 *
 * `<unit>` (the file's basename without `.card`, or the folder's name) is the
 * key per-scene versions use (`sceneMajors.json`, tools/sceneVersionLib.mjs's
 * header); it can differ from the scene's `id` (`kaleido` holds `kaleidoscope`).
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

/** A scene module's unit from its glob path: the folder of a `…/<unit>/card.ts`
 *  or `…/<unit>/index.ts`, else the file's basename without `.card`. */
export function unitOfPath(path: string): string {
  const parts = path.split("/");
  const file = parts[parts.length - 1];
  if ((file === "card.ts" || file === "index.ts") && parts.length >= 2) return parts[parts.length - 2];
  return file.replace(/(\.card)?\.ts$/, "");
}

/** The body module a card's `loadBody` imports, by convention: `…/<unit>.card.ts`
 *  → `…/<unit>.ts`, `…/<unit>/card.ts` → `…/<unit>/index.ts`. */
export function bodyPathOfCard(path: string): string {
  if (path.endsWith(".card.ts")) return `${path.slice(0, -".card.ts".length)}.ts`;
  if (path.endsWith("/card.ts")) return `${path.slice(0, -"card.ts".length)}index.ts`;
  return path;
}

function isCard(value: unknown): value is SceneCard {
  const c = value as Partial<SceneCard> | null;
  return typeof c === "object" && c !== null && typeof c.id === "string" && c.id.length > 0 && typeof c.name === "string";
}

/** Turns the modules `import.meta.glob` found (path → module) into the free
 *  scenes to register, in gallery order — see this file's header. */
export function collectScenes(modules: Readonly<Record<string, unknown>>): CollectedScenes {
  const found: CollectedScene[] = [];
  const errors: string[] = [];
  const taken = new Set<string>();
  for (const path of Object.keys(modules).sort()) {
    const mod = (modules[path] ?? {}) as Record<string, unknown>;
    if (!("card" in mod)) continue;
    if (!("gallery" in mod) || !isGallery(mod.gallery)) {
      errors.push(`${path}: \`gallery\` needs a stage (released, development or draft) and added (YYYY-MM-DD)`);
      continue;
    }
    if (!isCard(mod.card)) {
      errors.push(`${path}: \`card\` needs an id (non-empty string) and a name (string)`);
      continue;
    }
    if (typeof mod.loadBody !== "function") {
      errors.push(`${path}: exports a \`card\` but no \`loadBody\` function`);
      continue;
    }
    if (taken.has(mod.card.id)) {
      errors.push(`${path}: scene id "${mod.card.id}" is already registered`);
      continue;
    }
    taken.add(mod.card.id);
    found.push({
      unit: unitOfPath(path),
      scene: lazyScene(mod.card, mod.loadBody as () => Promise<Scene>),
      gallery: mod.gallery,
    });
  }
  found.sort((a, b) => b.gallery.added.localeCompare(a.gallery.added) || a.scene.id.localeCompare(b.scene.id));
  return { scenes: found, errors };
}
