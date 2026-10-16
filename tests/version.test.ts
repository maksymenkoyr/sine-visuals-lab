import { describe, it, expect } from "vitest";
import { channelBadge, versionHint, versionLabel, versionHref, type BuildInfo } from "../src/version.ts";

const VERSIONS_URL = "https://insiders.sinevisualslab.com/versions";

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
  it("shows the number plus beta on insider, and on stable while the major is 0", () => {
    expect(versionLabel(withCommit({ channel: "stable", version: "0.3.0" }))).toBe("0.3.0 - beta");
    expect(versionLabel(withCommit({ channel: "insider", version: "0.1.4", pr: 183 }))).toBe("0.1.4 - beta");
  });

  it("drops beta from stable once the major is raised, but never from insider", () => {
    expect(versionLabel(withCommit({ channel: "stable", version: "1.0.0" }))).toBe("1.0.0");
    expect(versionLabel(withCommit({ channel: "stable", version: "10.2.0" }))).toBe("10.2.0");
    expect(versionLabel(withCommit({ channel: "insider", version: "1.0.3" }))).toBe("1.0.3 - beta");
  });

  it("shows just the channel when there is no version", () => {
    expect(versionLabel(withCommit({ channel: "stable" }))).toBe("stable");
    expect(versionLabel(withCommit({ channel: "insider" }))).toBe("beta");
    expect(versionLabel(withCommit({ channel: "preview", pr: 185 }))).toBe("preview");
    expect(versionLabel(withCommit({ channel: "dev", dirty: true }))).toBe("dev");
    expect(versionLabel(base)).toBe("dev");
  });
});

describe("versionHref", () => {
  it("opens Insiders' own version picture on an insider build", () => {
    expect(versionHref(withCommit({ channel: "insider", version: "0.0.11" }))).toBe("/versions");
    expect(versionHref(withCommit({ channel: "insider" }))).toBe("/versions");
  });

  it("opens the Insiders copy from every other channel, which has none of its own", () => {
    for (const channel of ["stable", "preview", "dev"] as const) {
      expect(versionHref(withCommit({ channel, version: channel === "stable" ? "0.3.0" : null }))).toBe(VERSIONS_URL);
    }
    expect(versionHref(base)).toBe(VERSIONS_URL);
  });
});

describe("versionHint", () => {
  it("explains the numbers, beta and commit on stable", () => {
    expect(versionHint(withCommit({ channel: "stable", version: "0.3.0" }))).toEqual([
      "Stable — updates only on a release",
      "Each release bumps the middle number",
      "Beta = the app is still before version 1.0",
      "da38a37 — the commit it was built from",
      "Built 2026-09-28 14:05 UTC",
    ]);
  });

  it("says nothing about beta on a stable build past 1.0", () => {
    expect(versionHint(withCommit({ channel: "stable", version: "1.0.0" })).some((l) => l.includes("Beta"))).toBe(false);
  });

  it("explains the numbers, PR and commit on insider", () => {
    expect(versionHint(withCommit({ channel: "insider", version: "0.3.12", pr: 183 }))).toEqual([
      "Beta = Insiders: updates every merge",
      "Each merge bumps the last number",
      "#183 — last pull request merged",
      "da38a37 — the commit it was built from",
      "Built 2026-09-28 14:05 UTC",
    ]);
  });

  it("skips the PR line when there is no PR", () => {
    const lines = versionHint(withCommit({ channel: "insider", pr: null }));
    expect(lines.some((l) => l.startsWith("#"))).toBe(false);
  });

  it("names the PR on preview", () => {
    expect(versionHint(withCommit({ channel: "preview", pr: 185 }))[0]).toBe("Preview of pull request #185");
  });

  it("mentions uncommitted changes on a dirty dev build", () => {
    expect(versionHint(withCommit({ channel: "dev", dirty: true }))[0]).toBe("Local dev build, with uncommitted changes");
  });

  it("degrades gracefully with no build info at all", () => {
    expect(versionHint(base)).toEqual(["Local dev build"]);
  });
});

describe("channelBadge", () => {
  it("badges insider only", () => {
    expect(channelBadge({ ...base, channel: "insider" })?.label).toBe("Insiders");
    for (const channel of ["stable", "preview", "dev"] as const) {
      expect(channelBadge({ ...base, channel })).toBeNull();
    }
  });
});
