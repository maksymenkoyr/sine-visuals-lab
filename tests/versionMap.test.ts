import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUILDS_AFTER,
  BUILDS_BEFORE,
  buildVersionMap,
  parseBuildTag,
  parseVersion,
  prFromSubject,
  renderVersionMap,
  type LabelOf,
  type MapInput,
} from "../tools/versionMapLib.mjs";
import { versionLabel } from "../src/version.ts";

// Labels come from src/version.ts in the real tool; most tests use a plain
// stub so they pin the picture's logic and not the label rule.
const labelOf: LabelOf = (channel, version) => `${channel}:${version}`;

// The shape of the real history around the v0.2.0 release: it was cut from
// the 0.1.70 build (#287), and the 0.1.71 build (#289) had already shipped.
const fixture = (over: Partial<MapInput> = {}): MapInput => ({
  releases: ["0.2.0", "0.1.0"],
  builds: [
    { version: "0.2.7", pr: 294 },
    { version: "0.2.6", pr: 296 },
    { version: "0.2.5", pr: 299 },
    { version: "0.2.4", pr: 295 },
    { version: "0.2.3", pr: 293 },
    { version: "0.2.2", pr: 292 },
    { version: "0.1.71", pr: 289 },
    { version: "0.1.70", pr: 287 },
    { version: "0.1.69", pr: 288 },
    { version: "0.1.68", pr: 285 },
    { version: "0.1.67", pr: 286 },
    { version: "0.1.66", pr: 281 },
    // not Insiders builds of the series leading into the release:
    { version: "0.1.0", pr: null }, // the legacy `v0.1.0-beta` tag, patch 0
    { version: "0.0.9", pr: 12 }, // an older series
    { version: "not.a.version", pr: 1 },
  ],
  cutVersion: "0.1.70",
  ghostCounts: { "0.1.71": 1 },
  generatedAt: "2026-10-03T22:32:00.000Z",
  commit: "1020f9b7565e60699f9a0fb35f2d59020b682892",
  repoUrl: "https://github.com/example/repo",
  ...over,
});

describe("parsers", () => {
  it("reads versions and build tags strictly", () => {
    expect(parseVersion("0.2.7")).toEqual({ major: 0, minor: 2, patch: 7 });
    expect(parseVersion("v0.2.7")).toBeNull();
    expect(parseBuildTag("v0.2.7-beta")).toEqual({ major: 0, minor: 2, patch: 7 });
    expect(parseBuildTag("v0.2.0")).toBeNull();
    expect(parseBuildTag("v0.2.7-rc1")).toBeNull();
  });

  it("finds the pull request in a squash or merge subject", () => {
    expect(prFromSubject("Channels: call Insider \"Insiders\" (#289)")).toBe(289);
    expect(prFromSubject("Merge pull request #294 from owner/worktree-swarm-scene")).toBe(294);
    expect(prFromSubject("Fix (#12) then more")).toBeNull();
    expect(prFromSubject("A direct push")).toBeNull();
  });
});

describe("buildVersionMap", () => {
  it("keeps the builds around the cut and everything after it", () => {
    const m = buildVersionMap(fixture(), labelOf);
    expect(m.latest).toBe("0.2.0");
    expect(m.prev).toBe("0.1.0");
    expect(m.old.builds.map((b) => b.version)).toEqual(["0.1.69", "0.1.70", "0.1.71"]);
    expect(m.old.builds.map((b) => b.cut)).toEqual([false, true, false]);
    expect(m.old.skipped).toBe("0.1.66 … 0.1.68");
    expect(m.fresh.builds.map((b) => b.version)).toEqual(["0.2.2", "0.2.3", "0.2.4", "0.2.5", "0.2.6", "0.2.7"]);
    expect(m.fresh.builds.map((b) => b.live)).toEqual([false, false, false, false, false, true]);
    expect(m.fresh.omitted).toBe(0);
    expect(m.newest).toBe("0.2.7");
  });

  it("counts a build that shipped after the cut again from the cut", () => {
    const m = buildVersionMap(fixture(), labelOf);
    expect(m.cutVersion).toBe("0.1.70");
    expect(m.cutPr).toBe(287);
    expect(m.ghosts).toEqual([{ version: "0.1.71", pr: 289, counted: 1 }]);
    expect(m.old.builds.at(-1)).toMatchObject({ ghost: true, counted: 1 });
    expect(m.fresh.builds[0]).toMatchObject({ version: "0.2.2", counted: 2 });
  });

  it("takes every label from labelOf and names what comes next", () => {
    const m = buildVersionMap(fixture(), labelOf);
    expect(m.next).toEqual({ merge: "0.2.8", release: "0.3.0", afterRelease: "0.3.1", afterMajor: "1.0.0" });
    expect(m.labels).toEqual({
      insidersNow: "insider:0.2.7",
      stableNow: "stable:0.2.0",
      insidersNextMerge: "insider:0.2.8",
      stableNextRelease: "stable:0.3.0",
      insidersAfterRelease: "insider:0.3.1",
      stableAfterMajor: "stable:1.0.0",
      insidersAfterMajor: "insider:1.0.1",
    });
    expect(m.example).toEqual({ major: 0, minor: 2, patch: 7 });
  });

  it("ignores patch-0 tags, older series and malformed versions", () => {
    const m = buildVersionMap(fixture(), labelOf);
    const all = [...m.old.builds, ...m.fresh.builds].map((b) => b.version);
    expect(all).not.toContain("0.1.0");
    expect(all).not.toContain("0.0.9");
    expect(all).not.toContain("not.a.version");
  });

  it("draws a release cut at the tip with no ghosts", () => {
    const m = buildVersionMap(fixture({ builds: fixture().builds.filter((b) => b.version !== "0.1.71"), ghostCounts: {} }), labelOf);
    expect(m.ghosts).toEqual([]);
    expect(m.old.builds.at(-1)).toMatchObject({ version: "0.1.70", cut: true, ghost: false });
    const html = renderVersionMap(m);
    expect(html).toContain("The release was cut at the tip");
    expect(html).not.toContain("would be");
  });

  it("adds the build being deployed, which has no tag yet", () => {
    const m = buildVersionMap(fixture({ current: { version: "0.2.8", pr: 301 } }), labelOf);
    expect(m.fresh.builds.at(-1)).toMatchObject({ version: "0.2.8", pr: 301, live: true });
    expect(m.fresh.builds.filter((b) => b.live)).toHaveLength(1);
    expect(m.next.merge).toBe("0.2.9");
    // a tag that already exists is not added twice
    const again = buildVersionMap(fixture({ current: { version: "0.2.7", pr: 294 } }), labelOf);
    expect(again.fresh.builds.filter((b) => b.version === "0.2.7")).toHaveLength(1);
  });

  it("collapses a long run after the release to the newest builds", () => {
    const many = Array.from({ length: BUILDS_AFTER + 5 }, (_, i) => ({ version: `0.2.${i + 1}`, pr: 400 + i }));
    const m = buildVersionMap(fixture({ builds: [...fixture().builds.filter((b) => !b.version.startsWith("0.2.")), ...many] }), labelOf);
    expect(m.fresh.builds).toHaveLength(BUILDS_AFTER);
    expect(m.fresh.omitted).toBe(5);
    expect(m.fresh.builds.at(-1)?.version).toBe(`0.2.${BUILDS_AFTER + 5}`);
  });

  it("widens the old side to reach a cut that is far behind", () => {
    const series = Array.from({ length: 20 }, (_, i) => ({ version: `0.1.${i + 1}`, pr: 100 + i }));
    const m = buildVersionMap(fixture({ builds: series, cutVersion: "0.1.10", ghostCounts: {} }), labelOf);
    expect(m.old.builds[0].version).toBe("0.1.9"); // one build of context before the cut
    expect(m.ghosts).toHaveLength(10);
    expect(m.ghosts.map((g) => g.counted)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(BUILDS_BEFORE).toBeLessThan(11); // so this test really exercises the widening
  });

  it("copes with no release at all", () => {
    const m = buildVersionMap(fixture({ releases: [], cutVersion: null }), labelOf);
    expect(m.latest).toBeNull();
    expect(m.labels.stableNow).toBeNull();
    const html = renderVersionMap(m);
    expect(html).toContain("<title>Sine Visuals Versioning</title>");
    expect(html).not.toContain("PRODUCTION");
  });

  it("copes with nothing at all", () => {
    const m = buildVersionMap(fixture({ releases: [], builds: [], cutVersion: null }), labelOf);
    expect(() => renderVersionMap(m)).not.toThrow();
  });
});

describe("renderVersionMap", () => {
  it("draws the cut, the ghost and the live build", () => {
    const html = renderVersionMap(buildVersionMap(fixture(), labelOf));
    expect(html).toContain("v0.2.0 released");
    expect(html).toContain("release cut");
    expect(html).toContain("LIVE NOW");
    expect(html).toContain("#289 would be 0.2.1, but it had already shipped as 0.1.71");
    expect(html).toContain("insider:0.2.7");
    expect(html).toContain("stable:0.3.0");
    expect(html).toContain("v0.2.0 was cut from #287.");
  });

  it("is one self-contained page: no script, no request, nothing indexed", () => {
    const html = renderVersionMap(buildVersionMap(fixture(), labelOf));
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\ssrc=/i);
    expect(html).not.toMatch(/<link/i);
    expect(html).toContain('<meta name="robots" content="noindex">');
    // the only URL is the one link out to the releases list
    expect([...html.matchAll(/https?:\/\/[^"'<>\s]+/g)].map((x) => x[0])).toEqual(["https://github.com/example/repo/releases"]);
  });

  it("escapes what it is given", () => {
    const html = renderVersionMap(buildVersionMap(fixture({ repoUrl: 'https://x.test/"><script>alert(1)</script>' }), labelOf));
    expect(html).not.toContain("<script>alert(1)");
  });

  it("reads like the footer when given the real label rule", () => {
    const real: LabelOf = (channel, version) => versionLabel({ channel, version, commit: "", pr: null, builtAt: "", dirty: false });
    const html = renderVersionMap(buildVersionMap(fixture(), real));
    expect(html).toContain("0.2.7 - beta");
  });
});

// Node loads src/version.ts and src/brand.ts straight from the tool (its type
// stripping), so a change that stops that fails here and not at deploy time.
describe("tools/version-map.mjs", () => {
  it("writes a page from whatever tags this checkout has", () => {
    const dir = mkdtempSync(join(tmpdir(), "version-map-"));
    try {
      const cli = fileURLToPath(new URL("../tools/version-map.mjs", import.meta.url));
      const out = join(dir, "versions.html");
      execFileSync(process.execPath, [cli, "--out", out], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      const html = readFileSync(out, "utf8");
      expect(html).toContain("<title>Sine Visuals Versioning</title>");
      expect(html).not.toMatch(/<script/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
