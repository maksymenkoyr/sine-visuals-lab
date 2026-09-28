import { execFileSync } from "node:child_process";
import type { Plugin } from "vite";
import type { BuildInfo } from "./src/version.ts";

/**
 * Stamps every build with where it came from and where it's going — the data
 * behind `src/version.ts` (the owning doc for what a channel is and what its
 * version label reads like; read that file's header before this one).
 *
 * The channel and the two identifying fields (commit, pr) come from the CI
 * job that invokes `vite build`, not from anything this plugin can discover
 * on its own:
 *
 *  - `SVL_CHANNEL` — set by .github/workflows/deploy.yml ("next" on a push to
 *    main, "preview" on a pull request) and release.yml ("stable"). Anything
 *    else, including unset (a local `npm run dev` or `npm run build`), is
 *    "dev" — there's no CI job for it to be anything else.
 *  - `SVL_VERSION` — only release.yml sets this, to the tag it just picked
 *    (see that workflow's header for the date-based scheme). Every other
 *    channel ships with no version, and versionLabel() in src/version.ts
 *    falls back to the commit for them.
 *  - `SVL_COMMIT` / `SVL_PR` — CI passes these explicitly because the commit
 *    actually being built (release.yml checks out a past commit; deploy.yml's
 *    PR build checks out a merge of the PR branch) isn't always `git
 *    rev-parse HEAD` in the checkout doing the building. Locally, falling
 *    back to HEAD and to parsing the last commit subject for a trailing
 *    `(#123)` (how GitHub writes a squash-merge subject) gives a `dev` build
 *    a real commit and PR number without any env vars at all.
 *
 * Computed once at plugin-creation time (not per request/build), so every
 * request in a `vite dev` session and every asset in a `vite build` reports
 * the same info.
 */
const CHANNELS = new Set(["stable", "next", "preview"]);

function computeBuildInfo(): BuildInfo {
  const envChannel = process.env.SVL_CHANNEL;
  const channel = (CHANNELS.has(envChannel ?? "") ? envChannel : "dev") as BuildInfo["channel"];

  const git = (...args: string[]): string => {
    try {
      return execFileSync("git", args, { encoding: "utf8" }).trim();
    } catch {
      return "";
    }
  };

  const commit = process.env.SVL_COMMIT || git("rev-parse", "HEAD");

  let pr: number | null = null;
  if (process.env.SVL_PR) {
    const n = Number(process.env.SVL_PR);
    pr = Number.isFinite(n) ? n : null;
  } else {
    // Squash-merge subjects end with "(#123)" — GitHub's own format, and the
    // only way a `dev` build (no PR-scoped env var) can know it.
    const subject = git("log", "-1", "--format=%s");
    const m = /\(#(\d+)\)\s*$/.exec(subject);
    pr = m ? Number(m[1]) : null;
  }

  // "dirty" only means anything for a `dev` build's own working tree — a CI
  // checkout of a specific commit (next/preview/stable) is never dirty by
  // construction, so there's no reason to pay for the `git status` call there.
  const dirty = channel === "dev" && git("status", "--porcelain") !== "";

  return {
    channel,
    version: process.env.SVL_VERSION || null,
    commit,
    pr,
    builtAt: new Date().toISOString(),
    dirty,
  };
}

const ROBOTS_META_RE = /<meta[^>]+name\s*=\s*["']robots["']/i;

/**
 * Defines `__BUILD_INFO__` (declared in src/vite-env.d.ts, read by
 * src/version.ts) for both `vite dev` and `vite build`, emits `version.json`
 * into a build's dist/ so `curl https://www.sinevisualslab.com/version.json`
 * answers "what's live" without opening the page, and marks every non-stable
 * build `noindex` so Next and PR previews never compete with www in search
 * (index.html's canonical already points at www — see that file's own
 * comment; this just makes it explicit for a host that isn't canonical at
 * all). Registered unconditionally in vite.config.ts, like legalNoticesPlugin.
 */
export function buildInfoPlugin(): Plugin {
  const info = computeBuildInfo();

  return {
    name: "viz-build-info",
    config() {
      return { define: { __BUILD_INFO__: JSON.stringify(info) } };
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify(info, null, 2) + "\n",
      });
    },
    transformIndexHtml(html) {
      if (info.channel === "stable" || ROBOTS_META_RE.test(html)) return html;
      return {
        html,
        tags: [{ tag: "meta", attrs: { name: "robots", content: "noindex" }, injectTo: "head-prepend" as const }],
      };
    },
  };
}
