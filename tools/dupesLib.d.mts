// Type declarations for dupesLib.mjs, hand-written because tests/*.ts is
// typechecked (tsconfig.json) and a .mjs has no inferred types of its own.
// Keep in sync with the JSDoc in dupesLib.mjs by hand.

// The parts of jscpd's JSON report that the check reads. jscpd writes more.
export interface JscpdLocation {
  name: string;
  start: number;
}

export interface JscpdClone {
  lines: number;
  firstFile: JscpdLocation;
  secondFile: JscpdLocation;
}

export interface JscpdReport {
  statistics: {
    total: {
      percentage: number;
      lines: number;
      duplicatedLines: number;
      clones: number;
      sources: number;
    };
  };
  duplicates: JscpdClone[];
}

export interface DupesJudgment {
  percent: number;
  lines: number;
  duplicatedLines: number;
  clones: number;
  files: number;
  empty: boolean;
  over: boolean;
}

export interface TopClone {
  lines: number;
  a: string;
  b: string;
}

export interface ScanOptions {
  paths: string[];
  ignore: string[];
  minTokens: number;
  maxSize: string;
}

export function jscpdArgs(options: ScanOptions & { outDir: string }): string[];

export function judge(report: JscpdReport, limit: number): DupesJudgment;

export function topClones(report: JscpdReport, n: number, root: string): TopClone[];

export function runJscpd(options: ScanOptions & { root: string }): JscpdReport;
