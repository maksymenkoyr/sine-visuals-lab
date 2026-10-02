// Types for releaseNotesLib.mjs (see its header), so tests/releaseNotes.test.ts
// type-checks against the plain-JS tool the same way appVersionLib.d.mts does.

export type CategoryKey = "newScene" | "scenes" | "sound" | "output" | "app" | "other";

export const CATEGORIES: ReadonlyArray<{ key: CategoryKey; title: string }>;

export interface NoteEntry {
  subject: string;
  pr: number | null;
  author: string | null;
  sha?: string;
  category: CategoryKey;
}

export interface SceneVersionNote {
  unit: string;
  name?: string;
  version: string;
}

export function prNumberFromSubject(subject: string): number | null;
export function stripPrSuffix(subject: string): string;
export function extractHighlights(body: string | null | undefined): string;
export function addedSceneUnits(registryDiff: string | null | undefined): string[];
export function sceneNameFromSource(source: string | null | undefined): string | null;
export function areaOfFile(path: string): Exclude<CategoryKey, "newScene"> | null;
export function categorize(change: {
  subject: string;
  files: string[];
  newScenes?: string[];
  sceneNames?: string[];
}): CategoryKey;
export function formatEntry(entry: Pick<NoteEntry, "subject" | "pr" | "author" | "sha">): string;
export function renderNotes(input: {
  highlights?: string;
  entries: NoteEntry[];
  sceneVersions?: SceneVersionNote[];
  repo?: string | null;
  prevTag?: string | null;
  tag?: string | null;
  siteUrl?: string | null;
}): string;
