import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { tuningPlugin } from "./vite-tuning-plugin.ts";

const root = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig(({ command }) => ({
  // tuningPlugin is dev-only by construction (configureServer never runs
  // during `vite build`), but keeping it out of the plugin list entirely
  // for a build is the belt to import.meta.env.DEV's suspenders.
  plugins: command === "serve" ? [basicSsl(), tuningPlugin()] : [],
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
