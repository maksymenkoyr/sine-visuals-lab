import type { Plugin } from "vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

const NOTICES: { urlPath: string; file: string }[] = [
  { urlPath: "/LICENSE.txt", file: "LICENSE" },
  { urlPath: "/THIRD-PARTY-NOTICES.txt", file: "THIRD-PARTY-NOTICES.md" },
  { urlPath: "/PRIVACY.txt", file: "PRIVACY.md" },
];

/**
 * Ships the repo-root LICENSE, THIRD-PARTY-NOTICES.md and PRIVACY.md with the
 * built site, as plain text at /LICENSE.txt, /THIRD-PARTY-NOTICES.txt and
 * /PRIVACY.txt. MIT and the SIL Open Font License (see THIRD-PARTY-NOTICES.md)
 * both require their notices to travel with copies of the software, and the
 * live site (built by Vite into dist/, served by wrangler's `[assets]` —
 * see wrangler.toml) ships no public/ folder to drop static copies into.
 *
 * Reads the three repo files at build/serve time rather than shipping a
 * committed copy under a second path, so the served text can never drift
 * from what's checked in at the repo root.
 *
 * Registered unconditionally in vite.config.ts (unlike tuningPlugin and
 * sceneLinksPlugin, which are dev-only): `generateBundle` emits the three
 * files into dist/ for `vite build`, and `configureServer` serves the same
 * three paths for `vite dev`, so the gallery footer's Licenses/Privacy links
 * (src/ui/gallery.ts) work in both.
 */
export function legalNoticesPlugin(): Plugin {
  return {
    name: "viz-legal-notices",
    generateBundle() {
      for (const { urlPath, file } of NOTICES) {
        this.emitFile({
          type: "asset",
          fileName: urlPath.replace(/^\//, ""),
          source: fs.readFileSync(path.join(root, file), "utf8"),
        });
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0];
        const hit = NOTICES.find((n) => n.urlPath === url);
        if (!hit) return next();
        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.end(fs.readFileSync(path.join(root, hit.file), "utf8"));
      });
    },
  };
}
