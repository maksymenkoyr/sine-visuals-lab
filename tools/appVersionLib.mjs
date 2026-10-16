/**
 * The version number the site shows — MAJOR.MINOR.PATCH — and the one place
 * that decides how each part moves (src/version.ts owns what the channels
 * are and how the label reads; tools/app-version.mjs reads git and prints
 * the number for CI):
 *
 *  - MAJOR is set by hand: it's the major of package.json's own `version`.
 *    Bump that (to N.0.0) and the next Stable release becomes N.0.0; until
 *    then Insiders keeps counting on the old major. Major 0 is also what
 *    keeps "- beta" on Stable's own label (src/version.ts's versionLabel),
 *    and the first release of major 1 is the one that drops it.
 *  - MINOR counts Stable releases: every merge of main into the `production`
 *    branch (.github/workflows/release.yml) is the previous release's minor
 *    + 1 with PATCH 0, and gets tagged `vX.Y.0`.
 *  - PATCH counts merges to main since the last release: an Insiders build
 *    (.github/workflows/deploy.yml) is the latest release's X.Y, with PATCH =
 *    the number of first-parent commits on main since the commit that
 *    release merged in — one per squash-merged PR.
 *
 * Nothing is written back to the repo: every number is recomputed from git
 * (the release tags on production, main's first-parent history), so two
 * merges landing together can't race over a counter file, and there's no
 * bot commit on main per merge. Only strict `vX.Y.Z` tags count — the older
 * `v0.1.0-beta` tag and anything else shaped differently are ignored.
 */

const STRICT_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

/** `"v0.3.0"` → `{ major: 0, minor: 3, patch: 0 }`; anything else → null. */
export function parseTag(tag) {
  const m = STRICT_TAG.exec(tag.trim());
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) } : null;
}

/** The highest release among `tags` (raw tag names, any order), or null. */
export function latestRelease(tags) {
  let best = null;
  for (const tag of tags) {
    const v = parseTag(tag);
    if (!v) continue;
    if (
      !best ||
      v.major > best.major ||
      (v.major === best.major && (v.minor > best.minor || (v.minor === best.minor && v.patch > best.patch)))
    ) {
      best = v;
    }
  }
  return best;
}

export function formatVersion(v) {
  return `${v.major}.${v.minor}.${v.patch}`;
}

/**
 * The version a new Stable release gets. A new major (package.json's major
 * above the latest release's, or no release yet) starts at N.0.0 — except
 * major 0, whose first release is 0.1.0, since 0.0.0 isn't a release anyone
 * would cut. Otherwise the minor goes up by one and the patch resets.
 */
export function nextStable(latest, pkgMajor) {
  if (!latest || pkgMajor > latest.major) {
    return { major: pkgMajor, minor: pkgMajor === 0 ? 1 : 0, patch: 0 };
  }
  return { major: latest.major, minor: latest.minor + 1, patch: 0 };
}

/** An Insiders build's version: the latest release's X.Y, `patch` merges on. */
export function insiderVersion(latest, patch, pkgMajor) {
  return latest ? { major: latest.major, minor: latest.minor, patch } : { major: pkgMajor, minor: 0, patch };
}
