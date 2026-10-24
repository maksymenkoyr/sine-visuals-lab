import { listScenes, registerScene, type Scene, type SceneStage } from "../scene.ts";
import { loadScene } from "../lazyScene.ts";
import { afterLoadAtIdle } from "../../pinnedAssets.ts";
import { collectPrivateScenes } from "./privateScenes.ts";
import { collectScenes } from "./sceneModules.ts";

/**
 * The scene registry. A free scene registers itself by having a card (a
 * lightweight file under this directory: its id, settings and `gallery`
 * record, plus the import of its code — sceneModules.ts has the contract,
 * src/render/lazyScene.ts what the split is for). This file only collects
 * them, so adding a scene, or moving one between gallery sections, never
 * edits it. A registered scene is a proxy until its code has loaded;
 * `preloadScenes` loads every body after the page's first paint.
 *
 * Registration order is display order within each gallery section
 * (listScenes() keeps Map insertion order; sceneStage(), below, picks the
 * section): newest first, from each scene's own `gallery.added`.
 * Registering is also what lets vite-scene-links-plugin.ts print a scene's
 * link when you start `npm run dev` with its files changed, and what gives it
 * a version: vite-scene-versions-plugin.ts appends a call to this file's
 * transformed source that hands `SCENE_UNITS` the versions it computed.
 */

// Every card, loaded eagerly. Their scenes' code is not: each card imports its
// body on demand.
const cards = import.meta.glob(["./*.card.ts", "./*/card.ts"], { eager: true });
// Scenes not yet split into a card and a body; this glob goes once all are.
// Helper files that match load too (their scenes import them anyway);
// collectScenes passes over anything without a `gallery`.
const unsplit = import.meta.glob(["./*.ts", "./*/index.ts", "!./index.ts", "!./*.card.ts", "!./*/card.ts"], {
  eager: true,
});
const freeScenes = collectScenes({ ...cards, ...unsplit });
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

/** After load, at idle, loads every scene's code: the released scenes first,
 *  then the rest. A page does this because src/pinnedAssets.ts forbids a
 *  first-time fetch of a build file late in a session, and the scene bodies
 *  are build files. A failed load is warned about and never rejects. */
export function preloadScenes(): Promise<void> {
  return new Promise<void>((resolve) => {
    afterLoadAtIdle(() => {
      const all = listScenes();
      const loadAll = (scenes: Scene[]) =>
        Promise.all(
          scenes.map((scene) =>
            loadScene(scene).catch((err) => console.warn(`[scenes] could not load "${scene.id}":`, err)),
          ),
        );
      const released = all.filter((s) => sceneStage(s.id) === "released");
      const rest = all.filter((s) => sceneStage(s.id) !== "released");
      void loadAll(released)
        .then(() => loadAll(rest))
        .then(() => resolve());
    });
  });
}

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
