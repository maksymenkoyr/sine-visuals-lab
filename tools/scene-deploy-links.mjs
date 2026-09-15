// Resolves the scene(s) a PR touches to their {id, name}, for the "Post
// preview URL" step in .github/workflows/deploy.yml to turn into a direct
// link on the preview Worker — same "hand over a link to the scene, not the
// gallery root" convention CLAUDE.md asks for locally
// (vite-scene-links-plugin.ts), extended to the PR preview comment.
//
//   node tools/scene-deploy-links.mjs <base-sha> <head-sha>
//
// Prints a JSON array (possibly empty) to stdout, e.g. [{"id":"caustics","name":"Caustics"}].
//
// Loads each touched scene's entry module through Vite's own SSR module
// loader (no browser, no dev server listening) so id/name come from the
// registered Scene object itself rather than being parsed back out of
// source — scene files use several different shapes (createFullscreenScene(...),
// factory functions, IIFEs), so a symbol lookup is the only thing that can't
// drift out of sync with them. Prints `[]` (exit 0) if there's nothing to
// diff or no scene changed — this is a nice-to-have on top of the preview
// comment, never a gate.
import { execFileSync } from "node:child_process";
import { createServer } from "vite";

const [baseSha, headSha] = process.argv.slice(2);
const SCENES_DIR = "src/render/scenes/";

function changedScenePaths() {
  if (!baseSha || !headSha) return [];
  try {
    const out = execFileSync("git", ["diff", "--name-only", baseSha, headSha], {
      encoding: "utf8",
    });
    return out.split("\n").filter((p) => p.startsWith(SCENES_DIR) && p.endsWith(".ts"));
  } catch {
    // Most likely `baseSha`/`headSha` aren't reachable locally — skip rather
    // than fail a deploy over a nice-to-have link.
    return [];
  }
}

// A changed file directly under scenes/ is its own entry module
// (scenes/caustics.ts); a file inside a scene's own folder belongs to that
// folder's index.ts (scenes/dancers/rig.ts -> scenes/dancers/index.ts), which
// is the file actually registered in scenes/index.ts.
function sceneEntryFor(path) {
  const rest = path.slice(SCENES_DIR.length);
  const slash = rest.indexOf("/");
  if (slash === -1) return rest === "index.ts" ? null : `/${SCENES_DIR}${rest}`;
  return `/${SCENES_DIR}${rest.slice(0, slash)}/index.ts`;
}

const entries = [...new Set(changedScenePaths().map(sceneEntryFor).filter(Boolean))];
if (entries.length === 0) {
  console.log("[]");
  process.exit(0);
}

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: "custom",
});

try {
  const scenes = [];
  for (const entry of entries) {
    const mod = await server.ssrLoadModule(entry);
    const scene = Object.values(mod).find(
      (v) => v && typeof v === "object" && typeof v.id === "string" && typeof v.name === "string",
    );
    if (scene) scenes.push({ id: scene.id, name: scene.name });
  }
  console.log(JSON.stringify(scenes));
} finally {
  await server.close();
}
