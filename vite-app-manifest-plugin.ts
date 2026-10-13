import type { Plugin } from "vite";
import { PRODUCT_INITIALS, PRODUCT_NAME, PRODUCT_SHORT_NAME } from "./src/brand.ts";
import type { BuildInfo } from "./src/version.ts";
import { resolveChannel } from "./vite-build-info-plugin.ts";

/**
 * Makes the site installable: emits `manifest.webmanifest` into a build's
 * dist/ and links it from index.html, so Chrome and Edge offer Install,
 * Android adds the site as an app, and a home-screen icon on iOS opens it
 * without the browser bars.
 *
 * No service worker: browsers no longer need one to install a site, and
 * src/version.ts's header says why this app never has one (a tab keeps the
 * version it loaded). So an installed app is the same page in its own
 * window: it still needs the network, and opens whatever version is live.
 *
 * Each channel lives on its own origin (src/version.ts says where each one
 * deploys), so each installs as its own app; `channelNames()` gives every
 * channel but Stable a suffix so an Insiders icon can't pass for Stable's.
 *
 * Build-only (vite.config.ts registers it for `vite build` alone): `npm run
 * dev` serves no manifest. Only index.html links it — tv.html is opened by a
 * TV's browser and output.html is a pop-out of the main page, neither a page
 * to install from. The icons are the committed PNGs in public/ that
 * tools/make-icons.mjs renders.
 */

const MANIFEST_FILE = "manifest.webmanifest";

/** The app's name, and the shorter label under its home-screen icon. */
function channelNames(channel: BuildInfo["channel"]): { name: string; short_name: string } {
  switch (channel) {
    case "stable":
      return { name: PRODUCT_NAME, short_name: PRODUCT_SHORT_NAME };
    case "insider":
      return { name: `${PRODUCT_NAME} Insiders`, short_name: `${PRODUCT_INITIALS} Insiders` };
    case "preview":
      return { name: `${PRODUCT_NAME} Preview`, short_name: `${PRODUCT_INITIALS} Preview` };
    case "dev":
      return { name: `${PRODUCT_NAME} Dev`, short_name: `${PRODUCT_INITIALS} Dev` };
  }
}

/** The manifest a build on `channel` ships. Colors match index.html's
 *  theme-color and the mark's own black. */
export function appManifest(channel: BuildInfo["channel"]) {
  return {
    id: "/",
    ...channelNames(channel),
    description:
      "Real-time music visualizer: WebGL scenes that follow the beat, tempo and tone of your microphone or screen audio.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

export function appManifestPlugin(): Plugin {
  const manifest = appManifest(resolveChannel());
  return {
    name: "viz-app-manifest",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: MANIFEST_FILE,
        source: JSON.stringify(manifest, null, 2) + "\n",
      });
    },
    transformIndexHtml(html, ctx) {
      if (ctx.path !== "/index.html") return html;
      return {
        html,
        tags: [{ tag: "link", attrs: { rel: "manifest", href: `/${MANIFEST_FILE}` }, injectTo: "head" as const }],
      };
    },
  };
}
