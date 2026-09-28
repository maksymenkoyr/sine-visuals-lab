import type { Scene } from "./scene.ts";

/**
 * Where a scene's own version — separate from the build's overall
 * MAJOR.MINOR.PATCH (src/version.ts) — lands once computed, and how it's
 * described to a viewer. The counting rules themselves (what bumps which
 * number, how a scene's files are attributed to it, how to raise a scene's
 * own major in `src/render/scenes/sceneMajors.json`) are
 * tools/sceneVersionLib.mjs's header, not here — this module only carries
 * the result from build time into the running page.
 *
 * `setSceneVersions()` is called once per page load by a line
 * vite-scene-versions-plugin.ts appends to `src/render/scenes/index.ts`
 * after transforming it: every registered scene's own binding paired with
 * the version string tools/sceneVersions.mjs computed for its unit (from git
 * history, plus — in a `dev` build — a `+dev` suffix if the scene's own
 * files are dirty). A test that imports a scene module directly, never
 * through that transform (every scene test does), sees an empty map, so
 * `sceneVersionOf` returns null for every id — the same fallback shape
 * src/version.ts's `BUILD_INFO` has under Vitest, and the same one a real
 * build falls back to if git/`origin/production` wasn't available (that
 * module's header).
 *
 * Read in two places, both skipping the scene entirely when this comes back
 * null (an unregistered/private scene, or a build the versions plugin never
 * ran for): the scene view's own version corner next to the build's overall
 * label (src/app.ts) and each gallery tile's caption (src/ui/gallery.ts).
 * `sceneVersionHint()` is the hover/tap hint text either caller hands to
 * src/ui/tooltip.ts's `bindHint`.
 */

const versions = new Map<string, string>();

/** Replaces the whole map with `[scene, version]` pairs, keyed by
 *  `scene.id` — see this file's header for who calls this and when. */
export function setSceneVersions(pairs: readonly (readonly [Scene, string])[]): void {
  versions.clear();
  for (const [scene, version] of pairs) versions.set(scene.id, version);
}

/** A scene's own version, or null if none was computed for it. */
export function sceneVersionOf(sceneId: string): string | null {
  return versions.get(sceneId) ?? null;
}

/** Hover/tap hint lines for a scene's version label — read before the
 *  build's own `versionHint()` lines (src/version.ts) wherever both are
 *  shown together. */
export function sceneVersionHint(sceneName: string, version: string): string[] {
  const lines = [
    `${sceneName} ${version} — this scene's own version`,
    "Each merge that changes it bumps the last number",
    "Each release that ships a change bumps the middle",
  ];
  if (version.endsWith("+dev")) lines.push("+dev = uncommitted changes to it");
  return lines;
}
