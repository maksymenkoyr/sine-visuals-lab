import { SOURCE_URL } from "./brand.ts";

/**
 * The one home for "what build is this, and what channel is it on" — the
 * label shown bottom-left of the gallery footer (src/ui/gallery.ts) and in
 * the TV page's own bottom-left source corner (src/tv.ts), and the fact
 * behind `version.json` (emitted by vite-build-info-plugin.ts, so
 * `curl https://www.sinevisualslab.com/version.json` answers "what's live"
 * without opening the page).
 *
 * The channels, and where each is deployed:
 *
 *  - **stable** — the top-level Worker (`audio-viz-room`, wrangler.toml's
 *    top level) on sinevisualslab.com and www. Only changes when someone
 *    runs the release workflow (`.github/workflows/release.yml`, `npm run
 *    release`), which promotes whatever commit the *Next* channel is
 *    currently serving — not necessarily `main`'s tip — tags it, deploys the
 *    top-level Worker, and publishes a GitHub Release. Released every couple
 *    of days, or whenever there's something worth shipping to everyone; a
 *    release is also the only moment a phone/TV paired on stable drops,
 *    since deploying restarts the Room Durable Objects (server/room.ts).
 *  - **next** — `wrangler.toml`'s `[env.next]`, the Worker
 *    `audio-viz-room-next` on next.sinevisualslab.com. Every push to `main`
 *    deploys here (`.github/workflows/deploy.yml`), so it's always current
 *    with the tip of `main` and never needs a person to decide to ship it.
 *  - **preview** — `[env.preview]`, one throwaway Worker per open pull
 *    request (deploy.yml).
 *  - **dev** — `npm run dev` / `npm run build` with no `SVL_CHANNEL` set:
 *    whatever's on disk, dirty or not.
 *
 * The tag scheme is date-based UTC (`vYYYY.MM.DD`, with `.2`, `.3`, … appended
 * if a release already landed that day) — see release.yml's own header for
 * why the *day* is what's meaningful, not a sequence number nobody would
 * recognize.
 *
 * `versionLabel()` below is what actually renders per channel — see its own
 * comment for the exact text each channel gets — and `versionHref()` /
 * `versionTitle()` are its link target and tooltip.
 *
 * The invariant this whole system exists to protect: **a page, once loaded,
 * never needs its own origin's files again.** There's no service worker and
 * this file never triggers a reload — a tab stays on the version it loaded
 * with, for its whole session, however long that is. `src/pinnedAssets.ts`
 * is the other half of that invariant: it makes sure a lazily-fetched file
 * (a worklet, a data blob, a font) that a long-lived tab only requests after
 * a later deploy has replaced dist/ still succeeds, by fetching it into a
 * cache right after load instead of waiting for the moment something actually
 * needs it.
 */
export interface BuildInfo {
  channel: "stable" | "next" | "preview" | "dev";
  /** The release tag (e.g. "v2026.09.28"), only ever set on the stable
   *  channel — see release.yml. Every other channel is null. */
  version: string | null;
  /** Full commit SHA this was built from, or "" if it couldn't be
   *  determined (e.g. a checkout with no `.git`). */
  commit: string;
  /** The pull request this commit landed through, if any — see
   *  vite-build-info-plugin.ts for how a `dev` build infers this without an
   *  env var. */
  pr: number | null;
  /** ISO timestamp of when `vite build` (or the dev server) computed this
   *  info. */
  builtAt: string;
  /** True only for `dev`: the working tree had uncommitted changes at build
   *  time. Every CI-built channel is always a clean checkout of one commit,
   *  so this is meaningless for them and always false. */
  dirty: boolean;
}

// __BUILD_INFO__ is declared globally in src/vite-env.d.ts, injected by
// vite-build-info-plugin.ts's `config()` hook (`define`). Vitest doesn't run
// vite.config.ts's `define`, so a test importing this module (or anything
// that imports it) needs a fallback rather than a ReferenceError.
export const BUILD_INFO: BuildInfo =
  typeof __BUILD_INFO__ !== "undefined"
    ? __BUILD_INFO__
    : { channel: "dev", version: null, commit: "", pr: null, builtAt: "", dirty: false };

const shortSha = (commit: string): string => commit.slice(0, 7);

/**
 * The corner label's text, per channel:
 *
 *  - stable, released: the tag as-is — `"v2026.09.28"`.
 *  - stable, unreleased build (shouldn't normally happen, but a manual
 *    `SVL_CHANNEL=stable` build with no `SVL_VERSION` degrades rather than
 *    lying): `"stable · da38a37"`.
 *  - next: `"next · #183 · da38a37"`, or `"next · da38a37"` when the commit
 *    has no associated PR (a direct push to main).
 *  - preview: `"preview · PR #185 · da38a37"` — spelled out, since a preview
 *    reader doesn't already have "this is a PR" from context the way Next's
 *    reader does.
 *  - dev: `"dev · da38a37"`, with a trailing `"*"` when the tree was dirty at
 *    build time, or just `"dev"` when there's no commit to show at all (a
 *    checkout with no `.git`).
 */
export function versionLabel(info: BuildInfo): string {
  const sha = shortSha(info.commit);
  switch (info.channel) {
    case "stable":
      return info.version ?? (sha ? `stable · ${sha}` : "stable");
    case "next":
      return sha ? `next · ${info.pr ? `#${info.pr} · ` : ""}${sha}` : "next";
    case "preview":
      return sha ? `preview · PR #${info.pr} · ${sha}` : `preview · PR #${info.pr}`;
    case "dev":
      if (!sha) return "dev";
      return `dev · ${sha}${info.dirty ? "*" : ""}`;
  }
}

/**
 * Where the label links to: the GitHub Release for a released stable build,
 * else the commit it was built from, else just the repo (no commit known at
 * all — an unlikely `.git`-less checkout).
 */
export function versionHref(info: BuildInfo): string {
  if (info.channel === "stable" && info.version) return `${SOURCE_URL}/releases/tag/${info.version}`;
  if (info.commit) return `${SOURCE_URL}/commit/${info.commit}`;
  return SOURCE_URL;
}

const formatBuiltAt = (builtAt: string): string | null => {
  if (!builtAt) return null;
  const d = new Date(builtAt);
  if (Number.isNaN(d.getTime())) return null;
  // e.g. "2026-09-28 14:05 UTC" — plain and unambiguous, not a locale string
  // that reads differently depending on the visitor's browser.
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};

/** A readable tooltip for the label — the channel, when it was built, and
 *  from what, spelled out in full rather than the label's abbreviations. */
export function versionTitle(info: BuildInfo): string {
  const built = formatBuiltAt(info.builtAt);
  const from = info.commit ? `built${built ? ` ${built}` : ""} from ${info.commit}` : null;
  // Only next spells the PR out here — preview's own prefix already names it,
  // and stable/dev's PR (the PR that landed the promoted/committed change, if
  // any) isn't the headline fact either of those channels is being asked.
  const prSuffix = info.pr ? ` (#${info.pr})` : "";

  switch (info.channel) {
    case "stable":
      return info.version
        ? `Stable release ${info.version}${from ? ` — ${from}` : ""}`
        : `Stable channel${from ? ` — ${from}` : " — no build info available"}`;
    case "next":
      return `Next channel${from ? ` — ${from}${prSuffix}` : " — no build info available"}`;
    case "preview":
      return `Preview of PR #${info.pr}${from ? ` — ${from}` : ""}`;
    case "dev":
      return from ? `Dev build — ${from}${info.dirty ? ", with uncommitted changes" : ""}` : "Dev build";
  }
}
