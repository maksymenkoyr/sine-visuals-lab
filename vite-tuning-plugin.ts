import type { Plugin, ViteDevServer } from "vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  locateSceneFile,
  patchSceneDefaults,
  type DefaultEdit,
  type SceneFileCandidate,
} from "./sceneDefaultsPatch.ts";

const root = fileURLToPath(new URL(".", import.meta.url));
const PARAMS_PATH = path.join(root, "tuning", "params.json");
const MARKS_DIR = path.join(root, "tuning", "marks");
const SCENES_DIR = path.join(root, "src", "render", "scenes");

const DEFAULT_PARAMS = { scene: null, autoPin: true, settings: {} };

function readParams(): unknown {
  try {
    return JSON.parse(fs.readFileSync(PARAMS_PATH, "utf8"));
  } catch (err) {
    console.warn("[viz-tuning] failed to read tuning/params.json:", err);
    return null;
  }
}

function broadcast(server: ViteDevServer): void {
  const params = readParams();
  if (params) server.ws.send({ type: "custom", event: "viz:params", data: params });
}

function readBody(req: import("node:http").IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function collectSceneFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectSceneFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const IDENTIFIER_RE = /^[A-Za-z0-9_]+$/;

interface DefaultsBody {
  scene: string;
  edits: DefaultEdit[];
  dryRun: boolean;
}

function parseDefaultsBody(raw: unknown): DefaultsBody {
  if (!isPlainObject(raw)) throw new Error("body must be an object");
  const { scene, edits, dryRun } = raw;
  if (typeof scene !== "string" || scene.length === 0) throw new Error("scene must be a non-empty string");
  if (!Array.isArray(edits) || edits.length === 0) throw new Error("edits must be a non-empty array");
  const parsedEdits: DefaultEdit[] = edits.map((e, i) => {
    if (!isPlainObject(e)) throw new Error(`edits[${i}] must be an object`);
    const { key, from, to } = e;
    if (typeof key !== "string" || !IDENTIFIER_RE.test(key)) throw new Error(`edits[${i}].key invalid`);
    if (typeof from !== "number" || !Number.isFinite(from)) throw new Error(`edits[${i}].from invalid`);
    if (typeof to !== "number" || !Number.isFinite(to)) throw new Error(`edits[${i}].to invalid`);
    return { key, from, to };
  });
  if (dryRun !== undefined && typeof dryRun !== "boolean") throw new Error("dryRun must be a boolean");
  return { scene, edits: parsedEdits, dryRun: dryRun === true };
}

/**
 * Dev-only bridge between tuning/params.json on disk and the running app.
 * Its jobs:
 *  - watches the file and rebroadcasts its contents over Vite's existing
 *    HMR websocket on every change (src/tuning/bus.ts applies it) — this is
 *    the whole live param-update path;
 *  - serves POST /__tuning/mark, which src/tuning/debug.ts's mark hotkey
 *    posts a frame + param snapshot to, since a page can't write files to
 *    disk on its own;
 *  - serves POST /__tuning/defaults, which the same file's Alt+D bake hotkey
 *    posts a scene id and a set of {key, from, to} edits to. It locates the
 *    scene's own source file under src/render/scenes (recursing to reach
 *    dancers/), runs sceneDefaultsPatch.ts's patch, and — unless the request
 *    is a dry run, which returns the same resolved path and per-key results
 *    but skips the write, powering the hotkey's preview step — writes the
 *    result back with fs.writeFileSync. This one writes to files a developer
 *    is expected to `git diff`, review, and commit — the change ships as the
 *    app's default for every user from then on, not just this dev session.
 *    Running `npm run dev:host` puts this on the LAN; /__tuning/mark already
 *    writes files so there's precedent, and the server-derived path plus
 *    numeric-literal-only replacement bound the blast radius to "a scene's
 *    default number changes, and it shows up in git diff".
 *
 * Registered only for `vite dev` (see vite.config.ts's `command === "serve"`
 * guard) — never built, never shipped.
 */
export function tuningPlugin(): Plugin {
  return {
    name: "viz-tuning",
    configureServer(server) {
      fs.mkdirSync(path.dirname(PARAMS_PATH), { recursive: true });
      fs.mkdirSync(MARKS_DIR, { recursive: true });
      if (!fs.existsSync(PARAMS_PATH)) {
        fs.writeFileSync(PARAMS_PATH, JSON.stringify(DEFAULT_PARAMS, null, 2) + "\n");
      }

      server.watcher.add(PARAMS_PATH);
      server.watcher.on("change", (file) => {
        if (path.resolve(file) === PARAMS_PATH) broadcast(server);
      });

      // GET counterpart to the "viz:params" broadcast above — a client that
      // connects *after* an edit (every fresh Playwright page, most of the
      // time) would otherwise only ever see *future* edits, since
      // server.ws.send only reaches sockets open at the moment it's called.
      // src/tuning/bus.ts fetches this once on init to pick up whatever's
      // already on disk, then falls through to the socket for live updates.
      server.middlewares.use("/__tuning/params", (_req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(readParams() ?? DEFAULT_PARAMS));
      });

      server.middlewares.use("/__tuning/mark", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("method not allowed");
          return;
        }
        readBody(req)
          .then((raw) => {
            const body = JSON.parse(raw.toString("utf8")) as { png: string; meta: unknown };
            const ts = Date.now();
            const pngData = body.png.replace(/^data:image\/png;base64,/, "");
            fs.writeFileSync(path.join(MARKS_DIR, `${ts}.png`), Buffer.from(pngData, "base64"));
            fs.writeFileSync(path.join(MARKS_DIR, `${ts}.json`), JSON.stringify(body.meta, null, 2));
            res.statusCode = 200;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true, ts }));
          })
          .catch((err) => {
            console.error("[viz-tuning] mark save failed:", err);
            res.statusCode = 400;
            res.end(String(err));
          });
      });

      server.middlewares.use("/__tuning/defaults", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("method not allowed");
          return;
        }
        readBody(req)
          .then((raw) => {
            const body = parseDefaultsBody(JSON.parse(raw.toString("utf8")));
            const candidates: SceneFileCandidate[] = collectSceneFiles(SCENES_DIR).map((p) => ({
              path: path.relative(root, p),
              text: fs.readFileSync(p, "utf8"),
            }));
            const keys = body.edits.map((e) => e.key);
            const located = locateSceneFile(candidates, body.scene, keys);
            res.setHeader("content-type", "application/json");
            if (!located.ok) {
              res.statusCode = 404;
              res.end(JSON.stringify({ ok: false, error: located.reason, paths: located.paths }));
              return;
            }
            const outcome = patchSceneDefaults(located.text, body.edits);
            if (!outcome.ok) {
              res.statusCode = 409;
              res.end(JSON.stringify({ ok: false, file: located.path, results: outcome.results }));
              return;
            }
            const bakedKeys = outcome.results.filter((r) => r.status === "applied").map((r) => r.key);
            if (body.dryRun) {
              console.info(`[viz-tuning] bake (dry run) ${located.path}:`, bakedKeys.join(", ") || "(nothing to bake)");
            } else {
              if (bakedKeys.length > 0) fs.writeFileSync(path.join(root, located.path), outcome.text);
              console.info(`[viz-tuning] baked ${located.path}:`, bakedKeys.join(", ") || "(nothing to bake)");
            }
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true, file: located.path, results: outcome.results }));
          })
          .catch((err) => {
            console.error("[viz-tuning] bake failed:", err);
            res.statusCode = 400;
            res.end(String(err));
          });
      });

      // Push whatever's already on disk to any client that connects after
      // boot (e.g. opening tv.html once the plugin is already running).
      broadcast(server);
    },
  };
}
