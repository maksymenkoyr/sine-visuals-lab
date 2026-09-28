// Type declarations for docCheckLib.mjs, hand-written because tests/*.ts is
// typechecked (tsconfig.json) and a .mjs has no inferred types of its own.
// Keep in sync with the JSDoc in docCheckLib.mjs by hand.

export interface Paragraph {
  line: number;
  text: string;
}

export interface CandidateParagraph extends Paragraph {
  names: string[];
}

export interface TypeSafeQuestion {
  type: "noul";
  instructions: { paragraph: string; question: string };
  criteria: { true: string; false: string };
}

export interface TypeSafeRequest {
  model: string;
  state: { file: string; diff: string };
  questions: Record<string, TypeSafeQuestion>;
}

export const MAX_QUESTIONS: number;

export function splitParagraphs(text: string): Paragraph[];

export function touchedNames(path: string, diffText: string): string[];

export function candidateParagraphs(paragraphs: Paragraph[], names: string[]): CandidateParagraph[];

export function buildRequest(
  path: string,
  diffText: string,
  candidates: CandidateParagraph[],
  options?: { maxDiffChars?: number },
): TypeSafeRequest;

export function chunk<T>(array: T[], size: number): T[][];

export const JEV_USD_PER_MTOK: number;

export function costUsd(inputTokens: number): number;

export type Verdict = "stale" | "fine" | "missed";

export function parseVerdicts(args: string[]): Record<string, Verdict>;

export interface RequestTrace {
  n: number;
  file: string;
  questions: number;
  inputTokens: number;
  ms: number;
  attempts: number;
  model: string | null;
}

export interface Judgment {
  ref: string;
  doc: string;
  line: number;
  file: string;
  names: string[];
  p: number | null;
  flagged: boolean | null;
  hash: string;
  excerpt: string;
}

export interface RunTotals {
  candidates: number;
  flagged: number;
  inputTokens: number;
  costUsd: number;
  ms: number;
  candidateChars: number;
  flaggedChars: number;
}

export interface Run {
  id: string;
  at: string;
  mode: "judged" | "unjudged";
  branch: string | null;
  head: string | null;
  base: string;
  threshold: number;
  model: string | null;
  files: string[];
  requests: RequestTrace[];
  judgments: Judgment[];
  totals: RunTotals;
  verdicts: Record<string, Verdict>;
}

export interface CalibrationBucket {
  bucket: string;
  count: number;
  staleRate: number | null;
}

export interface RunsSummary {
  runs: { total: number; judged: number; unjudged: number; models: string[] };
  totals: {
    candidates: number;
    flagged: number;
    inputTokens: number;
    costUsd: number;
    costPerRunUsd: number | null;
    meanRequestMs: number | null;
    maxRequestMs: number | null;
    readingSavedPct: number | null;
  };
  effectiveness: {
    hasVerdicts: boolean;
    precision: number | null;
    misses: number;
    staleUnflaggedCount: number;
    truePositiveCount: number;
    falsePositiveCount: number;
  };
  calibration: CalibrationBucket[];
  falsePositives: { ref: string; p: number | null; run: string; excerpt: string }[];
  recentRuns: {
    id: string;
    branch: string | null;
    mode: "judged" | "unjudged";
    candidates: number;
    flagged: number;
    inputTokens: number;
    costUsd: number;
  }[];
}

export function summarizeRuns(runs: Run[]): RunsSummary;
