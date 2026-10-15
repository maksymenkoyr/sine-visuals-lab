// Type declarations for checkLib.mjs, hand-written because tests/*.ts is
// typechecked (tsconfig.json) and a .mjs has no inferred types of its own.
// Keep in sync with checkLib.mjs by hand.

export interface Finding {
  tool: string;
  rule: string;
  file: string;
  line: number;
  text: string;
  message: string;
}

export interface LicenseException {
  name: string;
  reason: string;
}

export interface LicenseProblem {
  name: string;
  version: string;
  license: string;
}

export interface AddedLine {
  file: string;
  line: number;
  text: string;
}

export const PERMISSIVE: Set<string>;
export const LICENSE_EXCEPTIONS: LicenseException[];

export function isPermissive(expr: unknown): boolean;
export function licenseProblems(
  lock: { packages?: Record<string, { version?: string; license?: unknown; link?: boolean }> },
  exceptions?: LicenseException[],
): LicenseProblem[];
export function missingNotices(pkg: { dependencies?: Record<string, string> }, noticesText: string): string[];
export function testFilesDone(output: string): number;

export function finding(tool: string, rule: string, file: string, line: number, text: unknown, message: string): Finding;
export function fingerprint(f: Finding): string;
export function compareToBaseline(findings: Finding[], baseline: string[]): { fresh: Finding[]; gone: string[] };

export function astGrepFindings(
  matches: Array<{ ruleId: string; file: string; lines: string; message: string; range: { start: { line: number } } }>,
): Finding[];
export function biomeFindings(
  report: {
    diagnostics?: Array<{ category?: string; message: string; location?: { path?: string; start?: { line: number } } }>;
  },
  lineOf: (path: string, line: number) => string,
): Finding[];
export function knipFindings(report: { issues?: Array<Record<string, unknown> & { file: string }> }): Finding[];

export function addedLines(diffText: string): AddedLine[];

export type BuildManifest = Record<string, { file: string; isEntry?: boolean; imports?: string[]; [key: string]: unknown }>;

export function firstPaintChunks(manifest: BuildManifest, page: string): string[];
export function pinnedFiles(
  sources: Array<{ path: string; text: string }>,
  manifest: BuildManifest,
  assetPaths: string[],
): { files: string[]; problems: string[] };
export function compareSizes(
  measured: { pages: Record<string, number>; pinned: number },
  budget: { pages?: Record<string, number>; pinned?: number },
): { ok: boolean; summary: string; detail: string };
