// Types for versionMapLib.mjs (see its header), so tests/versionMap.test.ts
// type-checks against the plain-JS tool the same way appVersionLib.d.mts does.

export const BUILDS_BEFORE: number;
export const BUILDS_AFTER: number;

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

export interface MapBuildInput {
  version: string;
  pr?: number | null;
}

export interface MapInput {
  /** Strict release versions (`"0.2.0"`), any order. */
  releases: string[];
  /** Every shipped Insiders build, any order. */
  builds: MapBuildInput[];
  /** The Insiders build the latest release was cut from, if known. */
  cutVersion?: string | null;
  /** Builds that shipped after the cut but before the release: their patch in the restarted count. */
  ghostCounts?: Record<string, number>;
  /** The build being deployed right now, which has no tag yet. */
  current?: MapBuildInput | null;
  generatedAt: string;
  commit?: string | null;
  repoUrl: string;
}

export type LabelOf = (channel: "stable" | "insider", version: string) => string;

export interface MapColumn {
  version: string;
  pr: number | null;
  cut: boolean;
  ghost: boolean;
  counted: number | null;
  live: boolean;
}

export interface MapGhost {
  version: string;
  pr: number | null;
  counted: number;
}

export interface VersionMap {
  generatedAt: string;
  commit: string | null;
  repoUrl: string;
  latest: string | null;
  prev: string | null;
  cutVersion: string | null;
  cutPr: number | null;
  ghosts: MapGhost[];
  old: { builds: MapColumn[]; skipped: string | null };
  fresh: { builds: MapColumn[]; omitted: number };
  newest: string | null;
  next: { merge: string; release: string; afterRelease: string; afterMajor: string };
  example: SemVer;
  labels: {
    insidersNow: string | null;
    stableNow: string | null;
    insidersNextMerge: string;
    stableNextRelease: string;
    insidersAfterRelease: string;
    stableAfterMajor: string;
    insidersAfterMajor: string;
  };
}

export function parseVersion(version: string): SemVer | null;
export function parseBuildTag(tag: string): SemVer | null;
export function prFromSubject(subject: string): number | null;
export function buildVersionMap(input: MapInput, labelOf: LabelOf): VersionMap;
export function renderVersionMap(map: VersionMap): string;
