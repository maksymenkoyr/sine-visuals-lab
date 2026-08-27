import type { Plugin, ViteDevServer } from "vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const TUNING_DIR = path.join(root, "tuning");
const MARKS_DIR = path.join(TUNING_DIR, "marks");

const DEFAULT_SLOT = "A";
const SLOT_RE = /^[A-Z0-9]{1,8}$/;
/** Matches both slot filenames: the default slot keeps the original name. */
const PARAMS_FILE_RE = /^params(?:\.([A-Z0-9]{1,8}))?\.json$/i;

const DEFAULT_PARAMS = { scene: null, autoPin: true, settings: {} };

function normalizeSlot(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_SLOT;
  const slot = raw.trim().toUpperCase();
  return SLOT_RE.test(slot) ? slot : DEFAULT_SLOT;
}

/**
 * The default slot keeps `tuning/params.json` — the path every existing doc,
 * tool and habit already points at — so adding slots costs nothing until you
 * actually want a second session. Others get `tuning/params.<slot>.json`.
 */
function paramsPathFor(slot: string): string {
  return slot === DEFAULT_SLOT
    ? path.join(TUNING_DIR, "params.json")
    : path.join(TUNING_DIR, `params.${slot}.json`);
}

function slotOfParamsFile(file: string): string | null {
  if (path.dirname(path.resolve(file)) !== TUNING_DIR) return null;
  const m = PARAMS_FILE_RE.exec(path.basename(file));
  return m ? normalizeSlot(m[1] ?? DEFAULT_SLOT) : null;
}

function readParams(slot: string): Record<string, unknown> | null {
  const file = paramsPathFor(slot);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.warn(`[viz-tuning] failed to read ${path.relative(root, file)}:`, err);
    return null;
  }
}

/**
 * Payloads carry their slot so src/tuning/bus.ts can drop the ones meant for
 * another page. Vite's HMR socket is shared by every connected client, and
 * applying a payload clears all overrides first — without this tag, two
 * sessions in one dev server erase each other's work on every edit.
 */
function broadcast(server: ViteDevServer, slot: string): void {
  const params = readParams(slot);
  if (params) server.ws.send({ type: "custom", event: "viz:params", data: { ...params, slot } });
}

/** Exact bytes of the last write this plugin made per slot, so the watcher
 *  can tell a scrub echoing back from a real edit — see writeParams. */
const lastWritten = new Map<string, string>();

function writeParams(slot: string, params: unknown): void {
  const serialized = JSON.stringify(params, null, 2) + "\n";
  lastWritten.set(slot, serialized);
  fs.writeFileSync(paramsPathFor(slot), serialized);
}

interface ParamsFile {
  scene?: string | null;
  autoPin?: boolean;
  settings?: Record<string, number>;
  focus?: unknown;
}

/**
 * Merge one scrubbed value into a slot's params file. Merges rather than
 * replaces for two reasons: a write-back must not erase the `focus` list that
 * prompted it, and consecutive scrubs of different dials have to accumulate.
 * A scene change is the one case that clears `settings` — values are keyed by
 * setting name alone, so carrying them across scenes would apply one scene's
 * numbers to another's identically-named key.
 */
function mergeScrub(slot: string, scene: string, settings: Record<string, number>): ParamsFile {
  const current = (readParams(slot) as ParamsFile | null) ?? { ...DEFAULT_PARAMS };
  const merged: Record<string, number> = current.scene === scene ? { ...(current.settings ?? {}) } : {};
  for (const [key, value] of Object.entries(settings)) {
    if (typeof value === "number" && Number.isFinite(value)) merged[key] = value;
  }
  return { ...current, scene, settings: merged };
}

/** Slot from a middleware request. `req.url` is the path remaining after the
 *  mount point, so a bare query string is the normal case here. */
function slotOfRequest(req: import("node:http").IncomingMessage): string {
  const query = req.url?.slice(req.url.indexOf("?") + 1) ?? "";
  return normalizeSlot(new URLSearchParams(query).get("slot"));
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
 * Dev-only bridge between the tuning/params files on disk and the running
 * app. Three jobs:
 *  - watches those files and rebroadcasts their contents over Vite's existing
 *    HMR websocket on every change (src/tuning/bus.ts applies it) — this is
 *    the whole live param-update path;
 *  - serves POST /__tuning/params, the return leg: a dial scrubbed in the
 *    device menu is merged back into the file, so both directions of a
 *    tuning conversation go through one artifact on disk;
 *  - serves POST /__tuning/mark, which src/tuning/debug.ts's mark hotkey
 *    posts a frame + param snapshot to, since a page can't write files to
 *    disk on its own.
 *
 * Everything is scoped by a `?tune=` slot (see src/tuning/session.ts) so two
 * sessions can run side by side without sharing state.
 *
 * Registered only for `vite dev` (see vite.config.ts's `command === "serve"`
 * guard) — never built, never shipped.
 */
export function tuningPlugin(): Plugin {
  return {
    name: "viz-tuning",
    configureServer(server) {
      fs.mkdirSync(TUNING_DIR, { recursive: true });
      fs.mkdirSync(MARKS_DIR, { recursive: true });
      if (!fs.existsSync(paramsPathFor(DEFAULT_SLOT))) writeParams(DEFAULT_SLOT, DEFAULT_PARAMS);

      // Watching the directory rather than one file: a second slot's file may
      // not exist yet when the server starts, and gets created on first use.
      server.watcher.add(TUNING_DIR);
      server.watcher.on("change", (file) => {
        const slot = slotOfParamsFile(file);
        if (!slot) return;
        // Skip the echo of our own write-back. Without this, a slider scrub
        // POSTs -> we write the file -> the watcher fires -> we broadcast ->
        // bus.ts calls clearAllOverrides() and re-applies, which fights the
        // drag that is still in progress.
        try {
          if (fs.readFileSync(paramsPathFor(slot), "utf8") === lastWritten.get(slot)) return;
        } catch {
          // Unreadable here just means broadcast() reports it a line later.
        }
        lastWritten.delete(slot);
        broadcast(server, slot);
      });

      // GET counterpart to the "viz:params" broadcast above — a client that
      // connects *after* an edit (every fresh Playwright page, most of the
      // time) would otherwise only ever see *future* edits, since
      // server.ws.send only reaches sockets open at the moment it's called.
      // src/tuning/bus.ts fetches this once on init to pick up whatever's
      // already on disk, then falls through to the socket for live updates.
      server.middlewares.use("/__tuning/params", (req, res) => {
        const slot = slotOfRequest(req);
        if (req.method !== "POST") {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ ...(readParams(slot) ?? DEFAULT_PARAMS), slot }));
          return;
        }
        // Write-back — the return leg of the loop. A dial moved in the device
        // menu lands here, so the value you settled on ends up on disk rather
        // than only in your browser. That's what lets a tuning session report
        // its own result instead of you reading numbers off the screen.
        readBody(req)
          .then((raw) => {
            const body = JSON.parse(raw.toString("utf8")) as {
              scene: string;
              settings: Record<string, number>;
            };
            const settings = body.settings ?? {};
            writeParams(slot, mergeScrub(slot, body.scene, settings));
            // Logged, not just written: tools/tune-watch.mjs tails the files,
            // but the dev-server console is where you're already looking.
            for (const [key, value] of Object.entries(settings)) {
              console.log(`[viz-tuning] scrub ${slot} ${body.scene}:${key}=${value}`);
            }
            res.statusCode = 200;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true, slot }));
          })
          .catch((err) => {
            console.error("[viz-tuning] scrub write failed:", err);
            res.statusCode = 400;
            res.end(String(err));
          });
      });

      server.middlewares.use("/__tuning/mark", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("method not allowed");
          return;
        }
        readBody(req)
          .then((raw) => {
            const body = JSON.parse(raw.toString("utf8")) as {
              png: string;
              meta: unknown;
              slot?: string;
            };
            const slot = normalizeSlot(body.slot);
            const ts = Date.now();
            // Slot-prefixed so two sessions' captures stay tellable apart in
            // one directory — a bare timestamp says nothing about which
            // window it came from.
            const stem = path.join(MARKS_DIR, `${slot}-${ts}`);
            const pngData = body.png.replace(/^data:image\/png;base64,/, "");
            fs.writeFileSync(`${stem}.png`, Buffer.from(pngData, "base64"));
            fs.writeFileSync(`${stem}.json`, JSON.stringify(body.meta, null, 2));
            res.statusCode = 200;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true, ts, slot }));
          })
          .catch((err) => {
            console.error("[viz-tuning] mark save failed:", err);
            res.statusCode = 400;
            res.end(String(err));
          });
      });

      // Push whatever's already on disk to any client that connects after
      // boot (e.g. opening tv.html once the plugin is already running).
      for (const filename of fs.readdirSync(TUNING_DIR)) {
        const slot = slotOfParamsFile(path.join(TUNING_DIR, filename));
        if (slot) broadcast(server, slot);
      }
    },
  };
}
