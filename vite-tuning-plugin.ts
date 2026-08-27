import type { Plugin, ViteDevServer } from "vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const PARAMS_PATH = path.join(root, "tuning", "params.json");
const MARKS_DIR = path.join(root, "tuning", "marks");

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

/**
 * Dev-only bridge between tuning/params.json on disk and the running app.
 * Two jobs:
 *  - watches the file and rebroadcasts its contents over Vite's existing
 *    HMR websocket on every change (src/tuning/bus.ts applies it) — this is
 *    the whole live param-update path;
 *  - serves POST /__tuning/mark, which src/tuning/debug.ts's mark hotkey
 *    posts a frame + param snapshot to, since a page can't write files to
 *    disk on its own.
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

      // Push whatever's already on disk to any client that connects after
      // boot (e.g. opening tv.html once the plugin is already running).
      broadcast(server);
    },
  };
}
