// Type declarations for workflowStatsLib.mjs, hand-written because tests/*.ts
// is typechecked (tsconfig.json) and a .mjs has no inferred types of its own.
// Keep in sync with the JSDoc in workflowStatsLib.mjs by hand.

export const GRADE_POINTS: Record<string, number>;

export interface StageStats {
  model: string | null;
  effort: string | null;
  turns: number;
  tokens: { input: number; cacheWrite: number; cacheRead: number; output: number };
  minutes: number;
}

export interface Finding {
  severity: string | null;
  origin: string | null;
  kind: string | null;
  fixed: boolean | null;
  file: string | null;
  summary: string;
}

export interface Row {
  runId: string;
  workflow: string | null;
  version: number;
  runStartedAt: string | null;
  recordedAt: string;
  issue: number;
  title: string | null;
  branch: string | null;
  alreadyDone: boolean | null;
  stages: {
    plan: StageStats | null;
    code: (StageStats & { typecheckPassed?: boolean | null; testsPassed?: boolean | null; deviations?: string }) | null;
    review: StageStats | null;
  };
  planGrade: string | null;
  codeGrade: string | null;
  issueResolved: boolean | null;
  readyToShip: boolean | null;
  finalTypecheck: boolean | null;
  finalTests: boolean | null;
  findings: Finding[];
}

export interface StageSummary {
  minutes: number | null;
  turns: number | null;
  contextTokens: number | null;
  outputTokens: number | null;
}

export interface Summary {
  setup: string;
  issues: number;
  runs: number;
  resolved: number;
  readyToShip: number;
  merged: number;
  planGrade: number | null;
  codeGrade: number | null;
  findingsPerIssue: { blocking: number; shouldFix: number; nit: number };
  fromPlanShare: number | null;
  weakTests: number;
  bugs: number;
  stages: { plan: StageSummary; code: StageSummary; review: StageSummary };
}

export function parseGrade(text: unknown): string | null;

export function parseLabel(label: string | null | undefined): { stage: "plan" | "code" | "review"; issue: number } | null;

export function transcriptStats(entries: any[]): StageStats;

export function setupKey(row: Row): string;

export function buildRows(run: {
  record: { runId: string; workflowName?: string; timestamp?: string; script?: string; args?: unknown };
  agents: { label: string; result: any; transcript: StageStats }[];
  recordedAt: string;
}): Row[];

export function summarize(rows: Row[], prState?: Map<string, string>): Summary[];

export function renderReport(
  summaries: Summary[],
  rows: Row[],
  opts?: { listIssues?: boolean; prState?: Map<string, string> },
): string;
