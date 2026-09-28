import { execFileSync } from "node:child_process";
import type { Plugin } from "vite";
import type { BuildInfo } from "./src/version.ts";
import { getCachedSceneVersions } from "./tools/sceneVersions.mjs";

/**
 * Stamps every build with where it came from and where it's going — the data
 * behind `src/version.ts` (the owning doc for what a channel is and what its
 * version label reads like; read that file's header before this one).
 *
 * The channel and the two identifying fields (commit, pr) come from the CI
 * job that invokes `vite build`, not from anything this plugin can discover
 * on its own:
 *
 *  - `SVL_CHANNEL` — set by .github/workflows/deploy.yml ("insider" on a push to
 *    main, "preview" on a pull request) and release.yml ("stable"). Anything
 *    else, including unset (a local `npm run dev` or `npm run build`), is
 *    "dev" — there's no CI job for it to be anything else.
 *  - `SVL_VERSION` — MAJOR.MINOR.PATCH from tools/app-version.mjs, set by
 *    release.yml (stable) and deploy.yml (insider); tools/appVersionLib.mjs
 *    owns how the numbers move. Previews and dev builds ship with no
 *    version, and versionLabel() in src/version.ts shows the commit instead.
 *  - `SVL_COMMIT` / `SVL_PR` — CI passes these explicitly because the commit
 *    actually being built (deploy.yml's PR build checks out a merge of the
 *    PR branch) isn't always `git
 *    rev-parse HEAD` in the checkout doing the building. Locally, falling
 *    back to HEAD and to parsing the last commit subject for a trailing
 *    `(#123)` (how GitHub writes a squash-merge subject) gives a `dev` build
 *    a real commit and PR number without any env vars at all.
 *
 * Computed once at plugin-creation time (not per request/build), so every
 * request in a `vite dev` session and every asset in a `vite build` reports
 * the same info.
 */
const CHANNELS = new Set(["stable", "insider", "preview"]);

/** `SVL_CHANNEL`, defaulted to `"dev"` — the one place this decision gets
 *  made. vite-scene-versions-plugin.ts imports this rather than re-reading
 *  the env var, so a scene's `+dev` suffix and the build's own channel badge
 *  can never disagree about whether this is a real CI build. */
export function resolveChannel(): BuildInfo["channel"] {
  const envChannel = process.env.SVL_CHANNEL;
  return (CHANNELS.has(envChannel ?? "") ? envChannel : "dev") as BuildInfo["channel"];
}

function computeBuildInfo(): BuildInfo {
  const channel = resolveChannel();

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
  // checkout of a specific commit (insider/preview/stable) is never dirty by
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
 * build `noindex` so Insider and PR previews never compete with www in search
 * (index.html's canonical already points at www — see that file's own
 * comment; this just makes it explicit for a host that isn't canonical at
 * all). `version.json` also carries `scenes` (every registered scene's own
 * version — tools/sceneVersionLib.mjs owns how it's counted) and, on stable,
 * `scenesChanged` (release.yml reads this for its Release notes) — computed
 * once via tools/sceneVersions.mjs and shared with vite-scene-versions-plugin.ts,
 * which is what actually shows a scene's version on the page. Registered
 * unconditionally in vite.config.ts, like legalNoticesPlugin.
 */
export function buildInfoPlugin(): Plugin {
  const info = computeBuildInfo();
  let root = process.cwd();

  return {
    name: "viz-build-info",
    configResolved(config) {
      root = config.root;
    },
    config() {
      return { define: { __BUILD_INFO__: JSON.stringify(info) } };
    },
    async generateBundle() {
      // Shares one git read with vite-scene-versions-plugin.ts
      // (getCachedSceneVersions's own memoization) rather than computing the
      // scene territory and history twice per build. `scenes` is every
      // registered scene's own version (tools/sceneVersionLib.mjs); `scenesChanged`
      // — stable only — is which of them this release actually ships a
      // change to, for release.yml's Release notes. Both are omitted
      // (version.json keeps its plain BuildInfo shape) if git/origin/production
      // wasn't available — see that module's header for why that's not a
      // build failure.
      const scenes = await getCachedSceneVersions({ root, channel: info.channel });
      const payload: BuildInfo & { scenes?: Record<string, string>; scenesChanged?: string[] } = { ...info };
      if (scenes) {
        payload.scenes = scenes.byUnit;
        if (info.channel === "stable") payload.scenesChanged = scenes.changedUnits;
      }
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify(payload, null, 2) + "\n",
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
