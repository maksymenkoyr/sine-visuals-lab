import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";

/**
 * Dev-only: right after Vite's own URLs, prints a direct link to the scene
 * you're working on — and nothing else. "Working on" means git says so: a
 * scene counts when a file that only it imports (under `src/render/scenes/`)
 * is modified or untracked in the working tree, or differs from the merge
 * base with `origin/main` (i.e. was touched by this branch). Usually that is
 * exactly one scene; if several qualify they all print, in gallery order; if
 * none do, nothing prints — the gallery is one click away and a full listing
 * is what this replaced.
 *
 * Files are mapped to scenes through Vite's SSR module graph, not by filename:
 * `src/render/scenes/index.ts` is loaded, each scene module it imports is
 * matched to the scene object it exports (by the registered `id`), and every
 * module reachable from that entry is that scene's territory. A file two scenes
 * share belongs to neither, so editing a helper doesn't nominate every scene
 * that uses it. This can't drift from the registry — a scene that isn't
 * registered isn't in the gallery, and won't be printed either.
 *
 * `scenesInFlight` is the pure core (tested in `tests/sceneLinks.test.ts`);
 * the git and module-graph plumbing around it is best-effort. A scene module
 * that refuses to import under SSR, or a checkout without git, degrades to a
 * warning — this is a convenience, never something a dev server should die for.
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

/** Which scenes the changed files nominate: a changed file counts for the one
 *  scene whose module closure contains it, and for no scene if it's shared.
 *  Returns ids in the order `closures` iterates (the registry's, i.e. gallery
 *  order), each at most once. */
export function scenesInFlight(
  changedFiles: Iterable<string>,
  closures: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
  const owners = new Map<string, string | null>();
  for (const [id, files] of closures) {
    for (const f of files) owners.set(f, owners.has(f) ? null : id);
  }
  const hit = new Set<string>();
  for (const f of changedFiles) {
    const id = owners.get(f);
    if (id) hit.add(id);
  }
  return [...closures.keys()].filter((id) => hit.has(id));
}

const SCENES_DIR = "src/render/scenes";
const REGISTRY = `/${SCENES_DIR}/index.ts`;

async function printSceneLinks(server: ViteDevServer): Promise<void> {
  const origin = server.resolvedUrls?.local[0];
  if (!origin) return;
  try {
    const [closures, changed] = await Promise.all([
      sceneClosures(server),
      changedSceneFiles(server.config.root),
    ]);
    const ids = scenesInFlight(changed, closures);
    if (ids.length === 0) return;
    const { DRAFT_SCENE_IDS } = (await server.ssrLoadModule(REGISTRY)) as {
      DRAFT_SCENE_IDS: ReadonlySet<string>;
    };
    const { getScene } = (await server.ssrLoadModule("/src/render/scene.ts")) as {
      getScene: (id: string) => { id: string; name: string } | undefined;
    };
    const base = origin.replace(/\/$/, "");
    const lines = ids.map((id) => {
      const name = getScene(id)?.name ?? id;
      return `  ${name}  ${base}/#/v/${id}${DRAFT_SCENE_IDS.has(id) ? "  (draft)" : ""}`;
    });
    // A query — ?audio=synthetic&bpm=…, ?quality=… — goes *before* the hash:
    // app.ts reads location.search, so one placed after it lands on the gallery.
    server.config.logger.info(
      ["", `  Working on (put any ?query before the #):`, ...lines, ""].join("\n"),
    );
  } catch (err) {
    server.config.logger.warn(`[viz-scene-links] could not find the scene in flight: ${String(err)}`);
  }
}

/** Scene id → absolute paths of every module reachable from that scene's
 *  entry (the module `src/render/scenes/index.ts` imports it from), in
 *  registry order. */
async function sceneClosures(server: ViteDevServer): Promise<Map<string, Set<string>>> {
  const { listScenes } = (await server.ssrLoadModule("/src/render/scene.ts")) as {
    listScenes: () => { id: string }[];
  };
  await server.ssrLoadModule(REGISTRY);
  const graph = server.environments.ssr.moduleGraph;
  const registryFile = path.join(server.config.root, SCENES_DIR, "index.ts");
  const registry = [...(graph.getModulesByFile(registryFile) ?? [])][0];
  if (!registry) throw new Error(`${REGISTRY} is not in the SSR module graph`);

  // Entry module → the scene it exports, matched by registered id.
  const entryOf = new Map<string, (typeof registry)>();
  for (const mod of registry.importedModules) {
    for (const value of Object.values(mod.ssrModule ?? {})) {
      const id = (value as { id?: unknown } | null)?.id;
      if (typeof id === "string" && !entryOf.has(id)) entryOf.set(id, mod);
    }
  }

  const closures = new Map<string, Set<string>>();
  for (const { id } of listScenes()) {
    const entry = entryOf.get(id);
    if (!entry) continue;
    const files = new Set<string>();
    const stack = [entry];
    const seen = new Set<typeof entry>();
    while (stack.length) {
      const mod = stack.pop()!;
      if (seen.has(mod)) continue;
      seen.add(mod);
      if (mod.file) files.add(mod.file);
      for (const dep of mod.importedModules) stack.push(dep);
    }
    closures.set(id, files);
  }
  return closures;
}

const exec = promisify(execFile);

/** Absolute paths under the scenes dir that the working tree or this branch
 *  has touched. Working-tree state comes from `git status` (untracked files
 *  included — a scene being born counts); branch state is the diff against the
 *  merge base with `origin/main`, falling back to `main`, then to nothing. */
async function changedSceneFiles(root: string): Promise<Set<string>> {
  const git = async (...args: string[]) =>
    (await exec("git", args, { cwd: root, encoding: "utf8" })).stdout;
  const files = new Set<string>();
  const add = (rel: string) => {
    if (rel.startsWith(`${SCENES_DIR}/`)) files.add(path.join(root, rel));
  };
  // Porcelain v1 -z: "XY path\0", renames as "XY new\0old\0" — the old path is
  // skipped because it no longer exists.
  const status = await git("status", "--porcelain", "-z", "--untracked-files=all");
  const entries = status.split("\0");
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e) continue;
    add(e.slice(3));
    if (e[0] === "R" || e[0] === "C") i++;
  }
  for (const ref of ["origin/main", "main"]) {
    let base: string;
    try {
      base = (await git("merge-base", "HEAD", ref)).trim();
    } catch {
      continue;
    }
    const diff = await git("diff", "--name-only", "-z", base, "HEAD");
    for (const rel of diff.split("\0")) if (rel) add(rel);
    break;
  }
  return files;
}
