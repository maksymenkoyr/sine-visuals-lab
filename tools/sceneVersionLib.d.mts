// Types for sceneVersionLib.mjs (see its header), so tests/sceneVersion.test.ts
// and vite-scene-versions-plugin.ts type-check against the plain-JS tool the
// same way appVersionLib.d.mts does for appVersionLib.mjs.

export interface SceneVersionNumber {
  major: number;
  minor: number;
  patch: number;
}

/** One Stable release, as far as one scene's history cares: did it change
 *  the scene's territory, and what was the scene's own major then. */
export interface SceneReleaseEntry {
  changed: boolean;
  major: number;
}

/** One `import { binding } from "path"` line of the scene registry. */
export interface RegistryImportEntry {
  binding: string;
  unit: string;
  path: string;
}

export interface FileClosureOptions {
  stopAt?: ReadonlySet<string>;
}

export function parseImportSpecifiers(source: string): string[];
export function parseRegistryImports(source: string): RegistryImportEntry[];
export function unitNameFromImportPath(specifier: string): string;

export function resolveImport(
  fromFile: string,
  specifier: string,
  exists: (path: string) => boolean,
): string | null;

export function fileClosure(
  entryFiles: string | readonly string[],
  readFile: (path: string) => string | null,
  exists: (path: string) => boolean,
  opts?: FileClosureOptions,
): Set<string>;

export function ownedFiles(closures: ReadonlyMap<string, ReadonlySet<string>>): Map<string, Set<string>>;

export function intersects(files: Iterable<string>, territory: ReadonlySet<string>): boolean;

export function parseSceneMajors(text: string | null | undefined): Record<string, unknown>;
export function majorOf(sceneMajors: Record<string, unknown>, unit: string): number;

export function sceneVersion(
  releases: readonly SceneReleaseEntry[],
  currentMajor: number,
  patch: number,
): SceneVersionNumber;

export function formatSceneVersion(v: SceneVersionNumber, dirty?: boolean): string;
