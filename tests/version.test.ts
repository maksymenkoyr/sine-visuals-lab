import { describe, it, expect } from "vitest";
import { channelBadge, versionLabel, versionHref, versionTitle, type BuildInfo } from "../src/version.ts";

const SOURCE_URL = "https://github.com/maksymenkoyr/sine-visuals-lab";

const base: BuildInfo = {
  channel: "dev",
  version: null,
  commit: "",
  pr: null,
  builtAt: "",
  dirty: false,
};

const withCommit = (over: Partial<BuildInfo>): BuildInfo => ({
  ...base,
  commit: "da38a37f0000000000000000000000000000000",
  builtAt: "2026-09-28T14:05:12.000Z",
  ...over,
});

describe("versionLabel", () => {
  it("shows the tag as-is on a released stable build", () => {
    expect(versionLabel(withCommit({ channel: "stable", version: "v2026.09.28" }))).toBe("v2026.09.28");
  });

  it("falls back to the commit on an unreleased stable build", () => {
    expect(versionLabel(withCommit({ channel: "stable" }))).toBe("stable · da38a37");
  });

  it("shows the PR and commit on insider", () => {
    expect(versionLabel(withCommit({ channel: "insider", pr: 183 }))).toBe("insider · #183 · da38a37");
  });

  it("drops the PR segment on insider when there is none", () => {
    expect(versionLabel(withCommit({ channel: "insider", pr: null }))).toBe("insider · da38a37");
  });

  it("spells out the PR on preview", () => {
    expect(versionLabel(withCommit({ channel: "preview", pr: 185 }))).toBe("preview · PR #185 · da38a37");
  });

  it("shows the commit on dev, with a dirty marker", () => {
    expect(versionLabel(withCommit({ channel: "dev" }))).toBe("dev · da38a37");
    expect(versionLabel(withCommit({ channel: "dev", dirty: true }))).toBe("dev · da38a37*");
  });

  it("degrades to just 'dev' when there is no commit at all", () => {
    expect(versionLabel(base)).toBe("dev");
  });
});

describe("versionHref", () => {
  it("links to the release tag on a released stable build", () => {
    expect(versionHref(withCommit({ channel: "stable", version: "v2026.09.28" }))).toBe(`${SOURCE_URL}/releases/tag/v2026.09.28`);
  });

  it("links to the commit otherwise, for every channel", () => {
    for (const channel of ["stable", "insider", "preview", "dev"] as const) {
      expect(versionHref(withCommit({ channel }))).toBe(`${SOURCE_URL}/commit/da38a37f0000000000000000000000000000000`);
    }
  });

  it("falls back to the bare repo when there is no commit", () => {
    expect(versionHref(base)).toBe(SOURCE_URL);
  });
});

describe("versionTitle", () => {
  it("names the release on stable", () => {
    expect(versionTitle(withCommit({ channel: "stable", version: "v2026.09.28" }))).toBe(
      "Stable release v2026.09.28 — built 2026-09-28 14:05 UTC from da38a37f0000000000000000000000000000000",
    );
  });

  it("names the channel and PR on insider", () => {
    expect(versionTitle(withCommit({ channel: "insider", pr: 183 }))).toBe(
      "Insider channel — built 2026-09-28 14:05 UTC from da38a37f0000000000000000000000000000000 (#183)",
    );
  });

  it("names the PR on preview", () => {
    expect(versionTitle(withCommit({ channel: "preview", pr: 185 }))).toBe(
      "Preview of PR #185 — built 2026-09-28 14:05 UTC from da38a37f0000000000000000000000000000000",
    );
  });

  it("mentions uncommitted changes on a dirty dev build", () => {
    expect(versionTitle(withCommit({ channel: "dev", dirty: true }))).toBe(
      "Dev build — built 2026-09-28 14:05 UTC from da38a37f0000000000000000000000000000000, with uncommitted changes",
    );
  });

  it("degrades gracefully with no build info at all", () => {
    expect(versionTitle(base)).toBe("Dev build");
  });
});

describe("channelBadge", () => {
  it("badges insider only", () => {
    expect(channelBadge({ ...base, channel: "insider" })?.label).toBe("Insider");
    for (const channel of ["stable", "preview", "dev"] as const) {
      expect(channelBadge({ ...base, channel })).toBeNull();
    }
  });
});
