import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { formatVersion, insiderVersion, latestRelease, nextStable, parseTag } from "../tools/appVersionLib.mjs";

// release.yml titles each Stable GitHub Release with this command's output, so
// the glue itself is under test: a version.ts that Node's type stripping can no
// longer load would otherwise only fail at release time.
describe("app-version.mjs label", () => {
  const cli = fileURLToPath(new URL("../tools/app-version.mjs", import.meta.url));
  const label = (...args: string[]): string =>
    // stderr piped, so the usage line a refused call prints stays out of the test output
    execFileSync(process.execPath, [cli, "label", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

  it("prints the footer label for a version", () => {
    expect(label("stable", "0.2.0")).toBe("0.2.0 - beta");
    expect(label("stable", "1.0.0")).toBe("1.0.0");
    expect(label("insider", "0.1.71")).toBe("0.1.71 - beta");
  });

  it("refuses an unknown channel or a malformed version", () => {
    expect(() => label("stable", "v0.2.0")).toThrow();
    expect(() => label("preview", "0.2.0")).toThrow();
  });
});

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
