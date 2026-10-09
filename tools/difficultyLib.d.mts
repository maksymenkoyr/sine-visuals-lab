// Type declarations for difficultyLib.mjs, hand-written because tests/*.ts
// is typechecked (tsconfig.json) and a .mjs has no inferred types of its own.
// Keep in sync with the JSDoc in difficultyLib.mjs by hand.

export type Level = "low" | "mid" | "high";
export type Verdict = "agree" | "under" | "over";

export const LEVELS: readonly Level[];
export const DIFFICULTY_LABELS: Record<Level, string>;
export const HUMAN_LABEL: string;
export const RECORD_MARKER: string;
export const RECORD_VERSION: number;
export const TRUSTED_ASSOCIATIONS: string[];

export interface Labeled {
  dif: Level | null;
  human: boolean;
}

export interface DifficultyRecord {
  v: number;
  issue: number;
  predicted: Labeled;
  actual: { dif: Level; human: boolean };
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
  actual: { dif: Level; human: boolean };
  verdict: Verdict | null;
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
}

export function readLabels(labels: (string | { name: string })[]): Labeled;
export function checkNewIssue(labels: string | string[]): { refuse: string } | { remind: string } | null;
export function parseLevel(text: string): Level;
export function verdictOf(predicted: Level | null, actual: Level): Verdict | null;
export function buildRecord(args: {
  issue: number;
  predicted: Labeled;
  actual: { dif: Level; human: boolean };
  pr?: number | null;
  why?: string;
  at?: string;
}): DifficultyRecord;
export function renderComment(record: DifficultyRecord): string;
export function parseRecords(body: string): DifficultyRecord[];
export function labelEdits(current: Labeled, actual: { dif: Level; human: boolean }): { add: string[]; remove: string[] };
export function labelsAfter(labels: (string | { name: string })[], actual: { dif: Level; human: boolean }): string[];
export function datasetRows(issues: IssueDump[], opts?: { trusted?: string[] | null }): DatasetRow[];
export function summarize(rows: DatasetRow[]): Summary;
export function renderSummary(summary: Summary): string;
