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
 *    top level) on sinevisualslab.com and www. Only changes when main is
 *    merged into the `production` branch (`npm run release` opens that pull
 *    request; `.github/workflows/release.yml` deploys the merge, tags it and
 *    publishes a GitHub Release). Released every couple of days, or whenever
 *    there's something worth shipping to everyone; a release is also the
 *    only moment a phone/TV paired on stable drops, since deploying restarts
 *    the Room Durable Objects (server/room.ts).
 *  - **insider** (shown to people as "Insiders") — `wrangler.toml`'s
 *    `[env.insider]`, the Worker `audio-viz-room-insider` on
 *    insiders.sinevisualslab.com. Every push to
 *    `main` deploys here (`.github/workflows/deploy.yml`), so it's always
 *    current with the tip of `main` and never needs a person to decide to
 *    ship it. Each build is published as a GitHub pre-release
 *    `vX.Y.Z-beta`, and its version is commented on the PR it shipped.
 *  - **preview** — `[env.preview]`, one throwaway Worker per open pull
 *    request (deploy.yml).
 *  - **dev** — `npm run dev` / `npm run build` with no `SVL_CHANNEL` set:
 *    whatever's on disk, dirty or not.
 *
 * Stable and Insiders carry a MAJOR.MINOR.PATCH version: every merge to main
 * bumps the patch, every Stable release bumps the minor, and the major is
 * set by hand in package.json — tools/appVersionLib.mjs's header owns the
 * rules, and CI passes the result in as `SVL_VERSION`.
 *
 * A picture of how those numbers have actually moved (builds, releases, the
 * commit each release was cut from) is generated from the release and build
 * tags, never written by hand: deploy.yml publishes it at /versions on
 * Insiders on every deploy, and `npm run versions` writes the same page
 * locally. tools/versionMapLib.mjs's header says what it draws.
 *
 * `versionLabel()` below is what actually renders per channel — see its own
 * comment for the exact text each channel gets — and `versionHref()` /
 * `versionHint()` are its link target and hover/tap hint.
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
  channel: "stable" | "insider" | "preview" | "dev";
  /** MAJOR.MINOR.PATCH with no leading "v" (e.g. "0.3.12"), set on the
   *  stable and insider channels (tools/appVersionLib.mjs). Previews and
   *  dev builds have none: null. */
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
 * Whether a version is still in beta: its MAJOR is 0, the pre-1.0 stretch
 * that ends when package.json's major is raised by hand
 * (tools/appVersionLib.mjs). Insiders builds are beta at every major; this
 * is the question only Stable has to ask.
 */
const isBetaVersion = (version: string): boolean => version.split(".")[0] === "0";

/**
 * The corner label's text: the version number and the word the owner uses
 * for a build that can still change under you — `"0.3.0 - beta"` on stable
 * while its major is 0 (isBetaVersion), plain `"1.0.0"` once it isn't, and
 * `"0.3.12 - beta"` on insider at every major. Everything else — the
 * channel, the PR, the commit, when it was built — lives in versionHint().
 * A build with no version shows just its channel: `"preview"`, `"dev"`, or
 * (a manual `SVL_CHANNEL=…` build with no `SVL_VERSION`) `"stable"` /
 * `"beta"`.
 *
 * release.yml titles each Stable GitHub Release with this same label
 * (`node tools/app-version.mjs label stable <version>`), the way deploy.yml
 * titles an Insiders one, so the release list reads like the footer.
 */
export function versionLabel(info: BuildInfo): string {
  switch (info.channel) {
    case "stable":
      if (!info.version) return "stable";
      return isBetaVersion(info.version) ? `${info.version} - beta` : info.version;
    case "insider":
      return info.version ? `${info.version} - beta` : "beta";
    case "preview":
    case "dev":
      return info.channel;
  }
}

/**
 * The masthead badge (src/ui/gallery.ts) that tells a visitor they're not on
 * stable — its text and the lines of its hover/tap hint. Insiders only: a PR
 * preview's own URL and comment already say what it is, and a `dev` badge
 * would sit in every local screenshot.
 */
export function channelBadge(info: BuildInfo): { label: string; hint: readonly string[] } | null {
  if (info.channel !== "insider") return null;
  return {
    label: "Insiders",
    hint: ["Insiders build: every change lands here first.", "Can be rough. Stable is at sinevisualslab.com"],
  };
}

/**
 * Where the label links to: the GitHub Release for a released stable build,
 * or the pre-release `vX.Y.Z-beta` deploy.yml publishes for an insider one,
 * else the commit it was built from, else just the repo (no commit known at
 * all — an unlikely `.git`-less checkout).
 */
export function versionHref(info: BuildInfo): string {
  if (info.channel === "stable" && info.version) return `${SOURCE_URL}/releases/tag/v${info.version}`;
  if (info.channel === "insider" && info.version) return `${SOURCE_URL}/releases/tag/v${info.version}-beta`;
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

/**
 * The label's hover/tap hint, one line per row: what kind of build this is
 * and how often it changes, then what each part of the label means — so
 * nobody has to know that `#183` is a pull request or `da38a37` a commit.
 * Parts the label doesn't show (no PR, no commit) get no line.
 */
export function versionHint(info: BuildInfo): string[] {
  const sha = shortSha(info.commit);
  const built = formatBuiltAt(info.builtAt);
  const lines: string[] = [];
  switch (info.channel) {
    case "stable":
      lines.push("Stable — updates only on a release");
      if (info.version) lines.push("Each release bumps the middle number");
      if (info.version && isBetaVersion(info.version)) lines.push("Beta = the app is still before version 1.0");
      break;
    case "insider":
      lines.push("Beta = Insiders: updates every merge");
      if (info.version) lines.push("Each merge bumps the last number");
      if (info.pr) lines.push(`#${info.pr} — last pull request merged`);
      break;
    case "preview":
      lines.push(`Preview of pull request #${info.pr}`);
      break;
    case "dev":
      lines.push(info.dirty ? "Local dev build, with uncommitted changes" : "Local dev build");
      break;
  }
  if (sha) lines.push(`${sha} — the commit it was built from`);
  if (built) lines.push(`Built ${built}`);
  return lines;
}
