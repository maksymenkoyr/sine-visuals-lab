import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { Connect, Plugin } from "vite";
import {
  collectScenePages,
  FONT_FILE,
  FONT_PATH,
  neighboursOf,
  renderSceneNav,
  renderScenePage,
  renderSitemap,
  type ScenePage,
} from "./tools/scenePagesLib.mjs";

/**
 * Builds the public scene pages, /scenes/<id>/, and the sitemap that lists
 * them, from the free scenes' records and media (tools/scenePagesLib.mjs's
 * header says what makes a page). The home page gets a crawlable list of
 * them next to its sr-only h1.
 *
 * `vite build` emits each page as `scenes/<id>/index.html` beside its media
 * (Vite copies public/scenes/ into dist/ as it is), the label font, and
 * sitemap.xml; the Worker serves them straight from dist/ (wrangler.toml
 * `[assets]`), so a page needs no server code. `vite dev` serves the same pages from the same
 * code, read fresh on every request, for checking copy and look.
 */
export function scenePagesPlugin(): Plugin {
  let root = process.cwd();
  const fontFile = (): string =>
    path.join(path.dirname(createRequire(path.join(root, "package.json")).resolve("@fontsource/chakra-petch/package.json")), "files", FONT_FILE);

  const collect = (): { pages: ScenePage[]; errors: string[] } => {
    const recordsDir = path.join(root, "docs/scenes");
    const records = fs
      .readdirSync(recordsDir)
      .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
      .map((file) => ({ file, text: fs.readFileSync(path.join(recordsDir, file), "utf8") }));
    const mediaOf = (id: string): string[] => {
      const dir = path.join(root, "public/scenes", id);
      return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    };
    return collectScenePages(records, mediaOf);
  };
  const pageHtml = (pages: ScenePage[], i: number): string => renderScenePage(pages[i], neighboursOf(pages, i));

  return {
    name: "viz-scene-pages",
    configResolved(config) {
      root = config.root;
    },
    transformIndexHtml(html, ctx) {
      if (ctx.path !== "/index.html") return html;
      const nav = renderSceneNav(collect().pages);
      const anchor = '<canvas id="gl">';
      if (!html.includes(anchor)) throw new Error(`scene pages: index.html has no ${anchor} to put the scene list before`);
      return html.replace(anchor, `${nav}\n    ${anchor}`);
    },
    generateBundle() {
      const { pages, errors } = collect();
      // A warning, not an error: tools/scene-page-media.mjs films a build, so
      // one has to succeed before a page's media exists. tests/scenePages.test.ts
      // fails on the same list.
      if (errors.length) this.warn(`scene pages skipped:\n  ${errors.join("\n  ")}`);
      pages.forEach((page, i) => {
        this.emitFile({ type: "asset", fileName: `scenes/${page.id}/index.html`, source: pageHtml(pages, i) });
      });
      this.emitFile({ type: "asset", fileName: FONT_PATH.slice(1), source: fs.readFileSync(fontFile()) });
      this.emitFile({ type: "asset", fileName: "sitemap.xml", source: renderSitemap(pages) });
    },
    configureServer(server) {
      const serve: Connect.NextHandleFunction = (req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        if (url === FONT_PATH) {
          res.setHeader("Content-Type", "font/woff2");
          res.end(fs.readFileSync(fontFile()));
          return;
        }
        if (url === "/sitemap.xml") {
          res.setHeader("Content-Type", "application/xml");
          res.end(renderSitemap(collect().pages));
          return;
        }
        const m = /^\/scenes\/([a-z0-9-]+)(\/(index\.html)?)?$/.exec(url);
        if (!m) return next();
        const { pages, errors } = collect();
        const i = pages.findIndex((p) => p.id === m[1]);
        if (i === -1) {
          res.statusCode = 404;
          res.end(`No page for "${m[1]}".${errors.length ? `\n\n${errors.join("\n")}` : ""}`);
          return;
        }
        if (!m[2]) {
          res.statusCode = 301;
          res.setHeader("Location", `/scenes/${m[1]}/`);
          res.end();
          return;
        }
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(pageHtml(pages, i));
      };
      server.middlewares.use(serve);
    },
  };
}
