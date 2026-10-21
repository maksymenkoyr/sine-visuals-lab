// Type declarations for difficultyLib.mjs, hand-written because tests/*.ts
// is typechecked (tsconfig.json) and a .mjs has no inferred types of its own.
// Keep in sync with the JSDoc in difficultyLib.mjs by hand.

export type Level = "low" | "mid" | "high";
export type Verdict = "agree" | "under" | "over";
export type Tok = "100K" | "1M" | "10M" | "10M+";

export const LEVELS: readonly Level[];
export const DIFFICULTY_LABELS: Record<Level, string>;
export const HUMAN_LABEL: string;
export const TOKEN_BUCKETS: readonly { tok: Tok; below: number; label: string }[];
export const RECORD_MARKER: string;
export const RECORD_VERSION: number;
export const TRUSTED_ASSOCIATIONS: string[];

export interface Labeled {
  dif: Level | null;
  tok?: Tok | null;
  human: boolean;
}

export interface Outcome {
  dif: Level;
  tok: Tok | null;
  tokens: number | null;
  human: boolean;
}

export interface DifficultyRecord {
  v: number;
  issue: number;
  predicted: Labeled;
  actual: Outcome;
  pr: number | null;
  why: string;
  at: string;
}

export interface IssueDump {
  number: number;
  title: string;
  body?: string;
  labels?: { name: string }[];
  comments?: { body: string; authorAssociation?: string; author?: { login: string } }[];
}

export interface DatasetRow {
  issue: number;
  title: string;
  body: string;
  predicted: Labeled;
  actual: Outcome;
  verdict: Verdict | null;
  tokVerdict: Verdict | null;
  humanVerdict: "agree" | "missed" | "extra";
  pr: number | null;
  why: string;
  at: string;
  by: string | null;
  records: number;
}

export interface Summary {
  rows: number;
  unlabeled: number;
  agree: number;
  under: number;
  over: number;
  humanMissed: number;
  humanExtra: number;
  matrix: Record<Level, Record<Level, number>>;
  tokens: { judged: number; agree: number; under: number; over: number; matrix: Record<Tok, Record<Tok, number>> };
}

export function readLabels(labels: (string | { name: string })[]): Labeled;
export function bucketOf(tokens: number): Tok;
export function parseTokens(text: string): number;
export function formatTokens(n: number): string;
export function checkNewIssue(labels: string | string[]): { refuse: string } | { remind: string } | null;
export function parseLevel(text: string): Level;
export function verdictOf<T extends string>(predicted: T | null, actual: T | null, order?: readonly T[]): Verdict | null;
export function buildRecord(args: {
  issue: number;
  predicted: Labeled;
  actual: { dif: Level; tokens?: number | null; human: boolean };
  pr?: number | null;
  why?: string;
  at?: string;
}): DifficultyRecord;
export function renderComment(record: DifficultyRecord): string;
export function parseRecords(body: string): DifficultyRecord[];
export function labelEdits(current: Labeled, actual: { dif: Level; tok?: Tok | null; human: boolean }): { add: string[]; remove: string[] };
export function labelsAfter(labels: (string | { name: string })[], actual: { dif: Level; tok?: Tok | null; human: boolean }): string[];
export function datasetRows(issues: IssueDump[], opts?: { trusted?: string[] | null }): DatasetRow[];
export function summarize(rows: DatasetRow[]): Summary;
export function renderSummary(summary: Summary): string;
