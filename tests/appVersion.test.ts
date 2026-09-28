import { describe, it, expect } from "vitest";
import { formatVersion, insiderVersion, latestRelease, nextStable, parseTag } from "../tools/appVersionLib.mjs";

describe("parseTag", () => {
  it("reads strict vX.Y.Z tags only", () => {
    expect(parseTag("v0.3.12")).toEqual({ major: 0, minor: 3, patch: 12 });
    expect(parseTag("v0.1.0-beta")).toBeNull();
    expect(parseTag("0.3.0")).toBeNull();
    expect(parseTag("v2026.09.28")).toEqual({ major: 2026, minor: 9, patch: 28 });
  });
});

describe("latestRelease", () => {
  it("picks the highest version, not the last listed", () => {
    expect(latestRelease(["v0.2.0", "v0.10.0", "v0.9.0", "v0.1.0-beta"])).toEqual({ major: 0, minor: 10, patch: 0 });
    expect(latestRelease(["v1.0.0", "v0.12.0"])).toEqual({ major: 1, minor: 0, patch: 0 });
  });

  it("is null when there is no release yet", () => {
    expect(latestRelease([])).toBeNull();
    expect(latestRelease(["v0.1.0-beta"])).toBeNull();
  });
});

describe("nextStable", () => {
  it("bumps the minor and resets the patch", () => {
    expect(formatVersion(nextStable({ major: 0, minor: 3, patch: 0 }, 0))).toBe("0.4.0");
  });

  it("starts major 0 at 0.1.0 and any other major at N.0.0", () => {
    expect(formatVersion(nextStable(null, 0))).toBe("0.1.0");
    expect(formatVersion(nextStable(null, 1))).toBe("1.0.0");
  });

  it("jumps to a hand-set major", () => {
    expect(formatVersion(nextStable({ major: 0, minor: 7, patch: 0 }, 1))).toBe("1.0.0");
  });
});

describe("insiderVersion", () => {
  it("counts merges on top of the latest release", () => {
    expect(formatVersion(insiderVersion({ major: 0, minor: 3, patch: 0 }, 12, 0))).toBe("0.3.12");
  });

  it("keeps the released major until a Stable release takes the new one", () => {
    expect(formatVersion(insiderVersion({ major: 0, minor: 3, patch: 0 }, 2, 1))).toBe("0.3.2");
  });

  it("counts from X.0 before the first release", () => {
    expect(formatVersion(insiderVersion(null, 5, 0))).toBe("0.0.5");
  });
});
