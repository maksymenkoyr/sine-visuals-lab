// Types for appVersionLib.mjs (see its header), so tests/appVersion.test.ts
// type-checks against the plain-JS tool the same way docCheckLib.d.mts does.

export interface AppVersion {
  major: number;
  minor: number;
  patch: number;
}

export function parseTag(tag: string): AppVersion | null;
export function latestRelease(tags: Iterable<string>): AppVersion | null;
export function formatVersion(v: AppVersion): string;
export function nextStable(latest: AppVersion | null, pkgMajor: number): AppVersion;
export function insiderVersion(latest: AppVersion | null, patch: number, pkgMajor: number): AppVersion;
