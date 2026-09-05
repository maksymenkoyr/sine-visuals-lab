import type { Plugin, ViteDevServer } from "vite";

/**
 * Dev-only: prints a direct link per scene right after Vite's own URLs, so the
 * scene you're working on is one paste away instead of a click through the
 * gallery. Links come out in gallery order — which is registration order in
 * `src/render/scenes/index.ts`, newest scene first within each section — so the
 * scene under construction sits at the top of the drafts.
 *
 * The list is read out of the registry itself (`listScenes()`, once
 * `src/render/scenes/index.ts` has run its `registerScene` calls) rather than
 * parsed out of the sources, so it can't drift from what the gallery shows. A
 * scene module that refuses to import under SSR would take the listing down
 * with it, so a failure is warned about and otherwise ignored — this is a
 * convenience, never something a dev server should die for.
 *
 * Registered only for `vite dev` (see vite.config.ts's `command === "serve"`
 * guard) — never built, never shipped.
 */
export function sceneLinksPlugin(): Plugin {
  return {
    name: "viz-scene-links",
    configureServer(server) {
      const printViteUrls = server.printUrls.bind(server);
      server.printUrls = () => {
        printViteUrls();
        void printSceneLinks(server);
      };
    },
  };
}

async function printSceneLinks(server: ViteDevServer): Promise<void> {
  const origin = server.resolvedUrls?.local[0];
  if (!origin) return;
  try {
    const { DRAFT_SCENE_IDS } = (await server.ssrLoadModule("/src/render/scenes/index.ts")) as {
      DRAFT_SCENE_IDS: ReadonlySet<string>;
    };
    const { listScenes } = (await server.ssrLoadModule("/src/render/scene.ts")) as {
      listScenes: () => { id: string; name: string }[];
    };
    const scenes = listScenes();
    if (scenes.length === 0) return;
    const base = origin.replace(/\/$/, "");
    const pad = Math.max(...scenes.map((s) => s.name.length));
    const lines = scenes.map(
      (s) => `  ${s.name.padEnd(pad)}  ${base}/#/v/${s.id}${DRAFT_SCENE_IDS.has(s.id) ? "  (draft)" : ""}`,
    );
    // A query — ?audio=synthetic&bpm=…, ?quality=… — goes *before* the hash:
    // app.ts reads location.search, so one placed after it lands on the gallery.
    server.config.logger.info(
      ["", "  Scenes (gallery order; put any ?query before the #):", ...lines, ""].join("\n"),
    );
  } catch (err) {
    server.config.logger.warn(`[viz-scene-links] could not list scenes: ${String(err)}`);
  }
}
