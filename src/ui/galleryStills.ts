// The still picture a gallery tile shows at rest (src/ui/gallery.ts plays the
// live preview only under the pointer). A still is a small WebP per free
// scene, made by tools/gallery-stills.mjs (`npm run gallery-stills`) and
// committed in src/ui/stills/; no build makes them.
//
// Stills are deliberately not pinned (src/pinnedAssets.ts's "Gallery stills"
// paragraph): a still that 404s after a deploy just hands its tile to the
// live preview, so a pinned copy would only cost every page the bytes. A paid
// scene has no still here, ever (CLAUDE.md): its tile plays live as it did
// before stills.

// no-inline: without it Vite folds the smallest stills into the entry chunk as
// data URIs, which counts against the first-paint size budget.
const STILLS = import.meta.glob<string>("./stills/*.webp", { eager: true, query: "?url&no-inline", import: "default" });

const URL_BY_SCENE = new Map<string, string>();
for (const [path, url] of Object.entries(STILLS)) {
  const file = path.slice(path.lastIndexOf("/") + 1);
  URL_BY_SCENE.set(file.slice(0, file.lastIndexOf(".")), url);
}

/** The still's URL for a scene, or null when it has none. */
export function stillUrl(sceneId: string): string | null {
  return URL_BY_SCENE.get(sceneId) ?? null;
}
