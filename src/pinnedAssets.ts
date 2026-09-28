/**
 * The invariant this module exists to protect (see src/version.ts's header
 * for the versioning system it's the other half of): **once a page has
 * loaded, it must never need to fetch another file from its own origin for
 * the first time.**
 *
 * Every deploy replaces dist/ wholesale — Cloudflare's `[assets]` binding
 * (wrangler.toml) only ever serves the latest deploy's files, under their
 * content-hashed names (`assets/tempoWorklet-<hash>.js`, and so on). A tab
 * that's been open since before a deploy still holds the *old* hashes in its
 * loaded JS, and most of those are fine — the module graph that renders the
 * page is already resident in memory, nothing re-fetches it. But a handful of
 * files are fetched separately from the module graph, on their own schedule:
 * the tempo AudioWorklet module (only loaded once the mic starts, well after
 * load — src/audio/tempoSource.ts), the Dancers scene's clip library (fetched
 * as soon as its module registers itself, which in practice means at load —
 * see src/render/scenes/dancers/index.ts's own comment for why that's still
 * worth pinning: a fetch racing the rest of page load can lose that race),
 * and every font: a `@font-face` file is only requested the first time text
 * in that face is drawn — the @fontsource faces controlsTheme.ts and
 * brandMark.ts import are declared at load but mostly first drawn by the
 * settings panel, and DSEG7's `@font-face` isn't even declared until
 * `ensureControlsStyles()` (src/ui/controlsTheme.ts) injects it, which is why
 * src/app.ts calls that at boot.
 * If a deploy has landed in between a late one of these and the load that
 * kicked it off, that fetch 404s — a visitor who loaded the gallery before a
 * release and starts the mic after it gets a tempo tracker that silently
 * falls back to the render-tick path, or a panel in the system fallback
 * font. None of that is a crash, which is exactly why it would otherwise go
 * unnoticed.
 *
 * The fix isn't to keep old deploys around (Cloudflare doesn't support that
 * here) or to force a reload when a new version ships (this app explicitly
 * never does that — no service worker, nothing watches for a new deploy and
 * reloads out from under whatever's mid-visualization; see src/version.ts).
 * It's to fetch every lazily-needed file right after load, while the tab's
 * own dist/ is still the live one, and hold onto the bytes — so that when the
 * feature that actually needs the file finally asks for it, it's served from
 * this module's cache instead of the network. As a side effect this also
 * rides out a venue's flaky wifi: once pinned, a mid-set dropout can't cost a
 * scene its clip library either.
 *
 * **The rule for new code:** any `?url` or `?worker&url` import — anything
 * Vite resolves to a hashed URL string rather than inlining or bundling —
 * must be wrapped in `pinAsset()` at module scope, right next to the import,
 * the same way tempoSource.ts and dancers/index.ts do it below. Fonts loaded
 * through `@font-face` (declared in a `<style>` this app injects, as
 * controlsTheme.ts does for DSEG7) don't need this: `pinEverything()` sweeps
 * every face already registered in `document.fonts` regardless of how its
 * `src: url(...)` got there. `tests/pinnedAssets.test.ts` statically scans
 * every `?url`/`?worker&url` import under src/ and fails the build if one
 * isn't paired with a `pinAsset()` call in the same file — a new import that
 * forgets this can't pass CI silently.
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

function scheduleIdle(run: () => void): void {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
    .requestIdleCallback;
  if (typeof ric === "function") ric(run, { timeout: 2000 });
  else setTimeout(run, 0); // Safari has no requestIdleCallback at all
}

/**
 * Called once by each entry point (src/app.ts, src/tv.ts): after the page has
 * fully loaded, at browser idle time, starts fetching every asset registered
 * with `pinAsset()` and loads every not-yet-loaded `document.fonts` face —
 * see this module's header for why "after load, at idle" rather than
 * immediately (nothing here should compete with the page's own first paint
 * or the audio graph spinning up).
 */
export function pinEverything(): void {
  const sweep = (): void => {
    for (const asset of registry.values()) {
      asset.bytes().catch(() => {}); // best-effort; pinAsset's own retry covers a transient failure on the real first use
    }
    document.fonts.forEach((face) => {
      if (face.status === "unloaded") face.load().catch(() => {});
    });
  };
  if (document.readyState === "complete") scheduleIdle(sweep);
  else window.addEventListener("load", () => scheduleIdle(sweep), { once: true });
}
