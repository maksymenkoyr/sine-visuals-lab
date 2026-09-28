import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { tuningPlugin } from "./vite-tuning-plugin.ts";
import { sceneLinksPlugin } from "./vite-scene-links-plugin.ts";
import { legalNoticesPlugin } from "./vite-legal-notices-plugin.ts";
import { buildInfoPlugin } from "./vite-build-info-plugin.ts";

const root = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig(({ command }) => ({
  // tuningPlugin and sceneLinksPlugin are dev-only by construction
  // (configureServer never runs during `vite build`), but keeping them out of
  // the plugin list entirely for a build is the belt to import.meta.env.DEV's
  // suspenders. legalNoticesPlugin and buildInfoPlugin are the exception:
  // legalNoticesPlugin ships LICENSE.txt / THIRD-PARTY-NOTICES.txt /
  // PRIVACY.txt with both the dev server and the build (see its header), and
  // buildInfoPlugin defines __BUILD_INFO__ (src/version.ts) for both too —
  // `npm run dev` needs a real channel/commit behind the version label just
  // as much as a build does, even though only a build gets version.json and
  // the noindex meta (see that plugin's header).
  plugins:
    command === "serve"
      ? [basicSsl(), tuningPlugin(), sceneLinksPlugin(), legalNoticesPlugin(), buildInfoPlugin()]
      : [legalNoticesPlugin(), buildInfoPlugin()],
  build: {
    // Global, not per-entry: webOS 5.x/6.x and Tizen 2018-2020 predate
    // optional chaining / nullish coalescing (Chrome 80). There's no
    // upside to targeting higher just for the phone/laptop entry, so one
    // safe target for the whole build is simpler than a split pipeline.
    target: "es2017",
    rollupOptions: {
      input: {
        main: root("index.html"),
        tv: root("tv.html"),
      },
    },
  },
}));
