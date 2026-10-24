/**
 * The invariant this module exists to protect (see src/version.ts's header
 * for the versioning system it's the other half of): **once a page has
 * loaded, every file it later fetches from its own origin must still be
 * there.** Build files get that by being fetched right after load; scene
 * media (below) by living at a path no deploy removes.
 *
 * Every deploy replaces dist/ wholesale — Cloudflare's `[assets]` binding
 * (wrangler.toml) only ever serves the latest deploy's files, under their
 * content-hashed names (`assets/engineWorklet-<hash>.js`, and so on). A tab
 * that's been open since before a deploy still holds the *old* hashes in its
 * loaded JS, and most of those are fine — the module graph that renders the
 * page is already resident in memory, nothing re-fetches it. But a handful of
 * files are fetched separately from the module graph, on their own schedule:
 * the audio engine's AudioWorklet module (only loaded once the mic starts,
 * well after load — src/audio/engineSource.ts) and every font: a `@font-face` file is
 * only requested the first time text
 * in that face is drawn — the @fontsource faces controlsTheme.ts and
 * brandMark.ts import are declared at load but mostly first drawn by the
 * settings panel, and DSEG7's `@font-face` isn't even declared until
 * `ensureControlsStyles()` (src/ui/controlsTheme.ts) injects it, which is why
 * src/app.ts calls that at boot.
 * If a deploy has landed in between a late one of these and the load that
 * kicked it off, that fetch 404s — a visitor who loaded the gallery before a
 * release and starts the mic after it gets an audio engine that silently
 * falls back to the ScriptProcessor tap, its beats a little late, or a panel in the system fallback
 * font. None of that is a crash, which is exactly why it would otherwise go
 * unnoticed.
 *
 * The fix isn't to keep old deploys around (Cloudflare doesn't support that
 * here) or to force a reload when a new version ships (this app explicitly
 * never does that — no service worker, nothing watches for a new deploy and
 * reloads out from under whatever's mid-visualization; see src/version.ts).
 * It's to fetch every lazily-needed build file right after load, while the tab's
 * own dist/ is still the live one, and hold onto the bytes — so that when the
 * feature that actually needs the file finally asks for it, it's served from
 * this module's cache instead of the network. Every page pays for these
 * files, so they have to stay small.
 *
 * **Scene media** (`sceneMedia()`) is the other kind: a scene's videos or
 * data, megabytes most visits never use. They live in public/media/<scene>/,
 * which Vite copies into dist/ unhashed, so every deploy serves the same path
 * and a tab loaded before a deploy can still fetch it — as long as the file
 * never changes: a new version gets a new name (`<name>-v2.<ext>`) and the
 * old file stays for the tabs that still name it. tests/sceneMedia.test.ts
 * holds every file to its sha256 in tests/mediaManifest.ts, and
 * public/_headers lets browsers cache them for good. A scene asks for its
 * media the first time a host mounts it (its gallery tile counts), draws
 * something sensible until the bytes arrive, and keeps them for the session.
 * Nothing sweeps them after load, except for a show: `pinSceneMedia()`
 * fetches every scene's media once the pop-out output opens (src/app.ts, and
 * src/output.ts for its own copy) or this page's room has another device in
 * it (src/app.ts; a TV once it joins a room, src/tv.ts), so a venue's wifi
 * dropping mid-set can't cost a scene its media.
 *
 * **The rule for new code:** any `?url` or `?worker&url` import — anything
 * Vite resolves to a hashed URL string rather than inlining or bundling —
 * must be wrapped in `pinAsset()` at module scope, right next to the import,
 * the same way engineSource.ts does it. Fonts loaded
 * through `@font-face` (declared in a `<style>` this app injects, as
 * controlsTheme.ts does for DSEG7) don't need this: `pinEverything()` sweeps
 * every face already registered in `document.fonts` regardless of how its
 * `src: url(...)` got there. `tests/pinnedAssets.test.ts` statically scans
 * every `?url`/`?worker&url` import under src/ and fails the build if one
 * isn't paired with a `pinAsset()` call in the same file — a new import that
 * forgets this can't pass CI silently. A large file only a scene needs goes
 * to public/media/<scene>/<name>-v1.<ext> instead: add it to
 * tests/mediaManifest.ts, write its path from the site root as one whole
 * string literal (the test checks every one it finds under src/), reach it
 * through `sceneMedia()` at module scope, and fetch it from the scene's
 * init(), never at import.
 */

export interface PinnedAsset {
  /** The file's bytes: the copy fetched after load, or fetched now if the
   *  sweep hasn't reached it yet. Rejects if the fetch fails (next call
   *  retries — the fetch is not cached as a permanent failure). */
  bytes(): Promise<ArrayBuffer>;
  /** A blob: URL of those bytes, for APIs that only take a URL
   *  (audioWorklet.addModule). Falls back to the original URL if the fetch
   *  fails, and always returns the original URL in DEV (a dev-server module
   *  imports siblings by relative URL, which a blob can't resolve). */
  url(type: string): Promise<string>;
}

const registry = new Map<string, PinnedAsset>();
/** The paths sceneMedia() registered: scene media, which pinEverything()'s
 *  sweep leaves to pinSceneMedia() (this module's header). */
const mediaPaths = new Set<string>();
let mediaPinned = false;

/**
 * Registers `assetUrl` for the sweep and returns a handle onto it. Safe to
 * call at module scope — it only records the url in a map; nothing fetches
 * until `pinEverything()`'s sweep reaches it or a caller awaits `bytes()`/
 * `url()` directly, so importing a scene module under Node (as the test
 * suite does for every scene) never triggers a network call.
 */
export function pinAsset(assetUrl: string): PinnedAsset {
  const existing = registry.get(assetUrl);
  if (existing) return existing;

  let bytesPromise: Promise<ArrayBuffer> | null = null;
  let blobUrlPromise: Promise<string> | null = null;

  const fetchBytes = (): Promise<ArrayBuffer> => {
    if (!bytesPromise) {
      bytesPromise = fetch(assetUrl)
        .then((res) => {
          if (!res.ok) throw new Error(`pinAsset: ${assetUrl} responded ${res.status}`);
          return res.arrayBuffer();
        })
        .catch((err: unknown) => {
          bytesPromise = null; // let the next call retry rather than remembering this as a permanent failure
          throw err;
        });
    }
    return bytesPromise;
  };

  const asset: PinnedAsset = {
    bytes: fetchBytes,
    async url(type: string): Promise<string> {
      if (import.meta.env.DEV) return assetUrl;
      if (!blobUrlPromise) {
        blobUrlPromise = fetchBytes()
          .then((buf) => URL.createObjectURL(new Blob([buf], { type })))
          .catch(() => {
            blobUrlPromise = null; // same retry-next-time reasoning as fetchBytes
            return assetUrl;
          });
      }
      return blobUrlPromise;
    },
  };
  registry.set(assetUrl, asset);
  return asset;
}

/**
 * Registers `path` — a file under public/media/, written from the site root —
 * as scene media and returns a handle onto it: the same handle for every
 * caller that names the path, so two scenes share one copy. Safe at module
 * scope: nothing fetches until the scene awaits `bytes()`/`url()` or
 * `pinSceneMedia()` runs; `pinEverything()` leaves it alone.
 */
export function sceneMedia(path: string): PinnedAsset {
  mediaPaths.add(path);
  return pinAsset(path);
}

function scheduleIdle(run: () => void): void {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
    .requestIdleCallback;
  if (typeof ric === "function") ric(run, { timeout: 2000 });
  else setTimeout(run, 0); // Safari has no requestIdleCallback at all
}

/** Runs `run` after the page has fully loaded, at browser idle time: nothing
 *  fetched here should compete with the page's own first paint or the audio
 *  graph spinning up. */
function afterLoadAtIdle(run: () => void): void {
  if (document.readyState === "complete") scheduleIdle(run);
  else window.addEventListener("load", () => scheduleIdle(run), { once: true });
}

/**
 * Called once by each entry point (src/app.ts, src/tv.ts, src/output.ts):
 * after load, at idle, starts fetching every asset registered with
 * `pinAsset()` (scene media aside) and loads every not-yet-loaded
 * `document.fonts` face — see this module's header for why.
 */
export function pinEverything(): void {
  afterLoadAtIdle(() => {
    for (const [assetUrl, asset] of registry) {
      if (mediaPaths.has(assetUrl)) continue; // scene media waits for its scene, or for pinSceneMedia()
      asset.bytes().catch(() => {}); // best-effort; pinAsset's own retry covers a transient failure on the real first use
    }
    document.fonts.forEach((face) => {
      if (face.status === "unloaded") face.load().catch(() => {});
    });
  });
}

/**
 * For a show (this module's header says when): after load, at idle, starts
 * fetching every file registered with `sceneMedia()`. Only the first call
 * does anything; a fetch that fails is tried again when its scene asks.
 */
export function pinSceneMedia(): void {
  if (mediaPinned) return;
  mediaPinned = true;
  afterLoadAtIdle(() => {
    for (const path of mediaPaths) pinAsset(path).bytes().catch(() => {});
  });
}
