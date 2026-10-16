import { listScenes, registerScene, type Scene, type SceneStage } from "../scene.ts";
import { collectPrivateScenes } from "./privateScenes.ts";
import { collectScenes } from "./sceneModules.ts";

/**
 * The scene registry. A free scene registers itself by being a scene module
 * (sceneModules.ts has the contract: its file or folder under this directory,
 * exporting its scene and a `gallery` record). This file only collects them,
 * so adding a scene, or moving one between gallery sections, never edits it.
 *
 * Registration order is display order within each gallery section
 * (listScenes() keeps Map insertion order; sceneStage(), below, picks the
 * section): newest first, from each scene's own `gallery.added`.
 * Registering is also what lets vite-scene-links-plugin.ts print a scene's
 * link when you start `npm run dev` with its files changed, and what gives it
 * a version: vite-scene-versions-plugin.ts appends a call to this file's
 * transformed source that hands `SCENE_UNITS` the versions it computed.
 */

// Every file of a scene module's shape, loaded eagerly. Helper files that
// match load too (their scenes import them anyway); collectScenes passes
// over anything without a `gallery`.
const freeScenes = collectScenes(import.meta.glob(["./*.ts", "./*/index.ts", "!./index.ts"], { eager: true }));
for (const error of freeScenes.errors) console.warn(`[scenes] ${error}`);

const stages = new Map<string, SceneStage>();
for (const { scene, gallery } of freeScenes.scenes) {
  registerScene(scene);
  stages.set(scene.id, gallery.stage);
}

/** Free scenes by unit (sceneModules.ts's header), the key their versions
 *  are computed under. */
export const SCENE_UNITS: ReadonlyMap<string, Scene> = new Map(freeScenes.scenes.map((s) => [s.unit, s.scene]));

// Paid scenes: whatever is checked out under ./private/ (gitignored here —
// see privateScenes.ts). Nothing matches in the public repo, its CI or the
// deployed site, so they're only ever in a local build. Registered after the
// free ones, so each lands at the end of its gallery group.
const privateScenes = collectPrivateScenes(
  import.meta.glob("./private/*/index.ts", { eager: true }),
  new Set(listScenes().map((s) => s.id)),
);
for (const scene of privateScenes.scenes) {
  registerScene(scene);
  stages.set(scene.id, privateScenes.draftIds.includes(scene.id) ? "draft" : "released");
}
for (const error of privateScenes.errors) console.warn(`[private scenes] ${error}`);

export type { SceneStage };

/** Which gallery section a scene sits in: released (featured), in
 *  development, or draft — its own `gallery.stage`. */
export function sceneStage(id: string): SceneStage {
  return stages.get(id) ?? "released";
}

/** Scenes behind the gallery's "draft" toggle. */
export const DRAFT_SCENE_IDS: ReadonlySet<string> = new Set(
  [...stages].filter(([, stage]) => stage === "draft").map(([id]) => id),
);

// Ids of the scenes collected from ./private/ above — tools/master-sweep.mjs
// skips these by default (--include-paid opts back in): nothing measured
// about a paid scene may land in this public repo.
export const PAID_SCENE_IDS: ReadonlySet<string> = new Set(privateScenes.scenes.map((s) => s.id));
