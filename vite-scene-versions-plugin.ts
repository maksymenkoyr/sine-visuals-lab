import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import { resolveChannel } from "./vite-build-info-plugin.ts";
import { getCachedSceneVersions, clearSceneVersionsCache } from "./tools/sceneVersions.mjs";

const REGISTRY_REL = "src/render/scenes/index.ts";

// src/render/sceneVersions.ts, relative to the registry file
// (src/render/scenes/index.ts) that's the only place this ever gets
// appended to — hardcoded rather than computed, since REGISTRY_REL above is
// itself the one file this plugin ever transforms.
const SCENE_VERSIONS_IMPORT = "../sceneVersions.ts";

/**
 * The "very visible in the dev flow" half of per-scene versions: appends one
 * `setSceneVersions(SCENE_UNITS, { unit: "version", … })` call to
 * `src/render/scenes/index.ts` after Vite transforms it, so every scene
 * carries its own version (src/render/sceneVersions.ts) the instant it's
 * registered — no separate fetch, no flash of "no version" before it loads.
 * tools/sceneVersionLib.mjs's header owns how a scene's version is counted;
 * tools/sceneVersions.mjs does the git/fs work this plugin calls into
 * (`getCachedSceneVersions`, shared with vite-build-info-plugin.ts's
 * `version.json` so the git history is only read once per build).
 *
 * Versions are keyed by unit on both sides: tools/sceneVersions.mjs computes
 * one per unit, and the registry's own `SCENE_UNITS` (in scope in that
 * module, so the appended call can name it) maps each unit to its scene —
 * src/render/scenes/sceneModules.ts's header says what a unit is. The call
 * is appended at the end of the transformed source, after the registry's own
 * top-level code has built `SCENE_UNITS`; ES import hoisting means the
 * `import { setSceneVersions }` line it carries still resolves first. A scene
 * whose unit got no version (private, or git/origin/production unavailable —
 * see tools/sceneVersions.mjs's header) is just missing from the object;
 * `sceneVersionOf` then answers null for it, same as if this plugin had
 * never run.
 *
 * Registered for both `vite dev` and `vite build` (vite.config.ts) — unlike
 * vite-scene-links-plugin.ts, a deployed build needs this as much as local
 * dev does. Dev-only: the file watcher below drops the cached git read
 * whenever anything under `src/` changes and invalidates the registry
 * module, so the *next* load recomputes it — a scene's own dirty files
 * picking up `+dev` (or losing it, once committed) without restarting the
 * server. A build never needs this: it computes once and exits.
 */
export function sceneVersionsPlugin(): Plugin {
  let root = process.cwd();
  let registryAbsPath = path.join(root, REGISTRY_REL);

  return {
    name: "viz-scene-versions",
    configResolved(config) {
      root = config.root;
      registryAbsPath = path.join(root, REGISTRY_REL).split(path.sep).join("/");
    },
    async transform(code, id) {
      if (id !== registryAbsPath) return null;
      const channel = resolveChannel();
      const result = await getCachedSceneVersions({ root, channel });
      if (!result || Object.keys(result.byUnit).length === 0) return null;

      return {
        code:
          `${code}\n` +
          `import { setSceneVersions as __svlSetSceneVersions } from ${JSON.stringify(SCENE_VERSIONS_IMPORT)};\n` +
          `__svlSetSceneVersions(SCENE_UNITS, ${JSON.stringify(result.byUnit)});\n`,
        map: null,
      };
    },
    configureServer(server: ViteDevServer) {
      const srcDir = path.join(root, "src") + path.sep;
      const onFsEvent = (file: string): void => {
        if (!file.startsWith(srcDir)) return;
        clearSceneVersionsCache();
        const mod = server.moduleGraph.getModuleById(registryAbsPath);
        if (mod) server.moduleGraph.invalidateModule(mod);
      };
      server.watcher.on("add", onFsEvent);
      server.watcher.on("change", onFsEvent);
      server.watcher.on("unlink", onFsEvent);
    },
  };
}
