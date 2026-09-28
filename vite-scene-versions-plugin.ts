import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import { resolveChannel } from "./vite-build-info-plugin.ts";
import { parseRegistryImports } from "./tools/sceneVersionLib.mjs";
import { getCachedSceneVersions, clearSceneVersionsCache } from "./tools/sceneVersions.mjs";

const REGISTRY_REL = "src/render/scenes/index.ts";

// src/render/sceneVersions.ts, relative to the registry file
// (src/render/scenes/index.ts) that's the only place this ever gets
// appended to — hardcoded rather than computed, since REGISTRY_REL above is
// itself the one file this plugin ever transforms.
const SCENE_VERSIONS_IMPORT = "../sceneVersions.ts";

/**
 * The "very visible in the dev flow" half of per-scene versions: appends one
 * `setSceneVersions([[binding, "version"], …])` call to
 * `src/render/scenes/index.ts` after Vite transforms it, so every scene
 * carries its own version (src/render/sceneVersions.ts) the instant it's
 * registered — no separate fetch, no flash of "no version" before it loads.
 * tools/sceneVersionLib.mjs's header owns how a scene's version is counted;
 * tools/sceneVersions.mjs does the git/fs work this plugin calls into
 * (`getCachedSceneVersions`, shared with vite-build-info-plugin.ts's
 * `version.json` so the git history is only read once per build).
 *
 * `transform()` re-parses the registry's own `import { binding } from
 * "./path"` lines (tools/sceneVersionLib.mjs's `parseRegistryImports` — the
 * same parser tools/sceneVersions.mjs uses to build each scene's territory,
 * so the binding-to-unit mapping can't drift between "what got a version
 * computed" and "what gets that version injected") to know which binding —
 * already in scope in that module, imported normally a few lines up — gets
 * which computed version. The call is appended at the end of the transformed
 * source; ES import hoisting means the `import { setSceneVersions }` line it
 * carries still resolves before any of the module's own top-level code runs.
 * A scene whose unit got no version (private, or git/origin/production
 * unavailable — see tools/sceneVersions.mjs's header) is just left out of the
 * call's array; `sceneVersionOf` then answers null for it, same as if this
 * plugin had never run.
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
      if (!result) return null;

      const pairs: [string, string][] = [];
      for (const { binding, unit } of parseRegistryImports(code)) {
        const version = result.byUnit[unit];
        if (version !== undefined) pairs.push([binding, version]);
      }
      if (pairs.length === 0) return null;

      const call = pairs.map(([binding, version]) => `[${binding}, ${JSON.stringify(version)}]`).join(", ");
      return {
        code:
          `${code}\n` +
          `import { setSceneVersions as __svlSetSceneVersions } from ${JSON.stringify(SCENE_VERSIONS_IMPORT)};\n` +
          `__svlSetSceneVersions([${call}]);\n`,
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
