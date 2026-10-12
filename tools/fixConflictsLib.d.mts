// Types for fixConflictsLib.mjs (see its header), so tests/fixConflicts.test.ts
// type-checks against the plain-JS tool the same way sceneVersionLib.d.mts does.

export interface Conflict {
  ours: string[];
  base: string[];
  theirs: string[];
}

export interface PlainRun {
  lines: string[];
}

export type Segment = Conflict | PlainRun;

export function parseDiff3(text: string): Segment[];
export function settle(conflict: Conflict): string[] | null;
export function resolveSegments(segments: Segment[]): { text: string; settled: number; left: number };
export function autoResolvable(path: string): boolean;
