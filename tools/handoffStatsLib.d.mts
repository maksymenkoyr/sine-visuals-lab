// Type declarations for handoffStatsLib.mjs, hand-written because tests/*.ts
// is typechecked (tsconfig.json) and a .mjs has no inferred types of its own.
// Keep in sync with the JSDoc in handoffStatsLib.mjs by hand.

import type { Tokens } from "./workflowStatsLib.mjs";

export function shortModel(model: string | null | undefined): string;

export function setupTag(planner: { model: string | null; effort: string | null }, coder: { model: string | null; effort: string | null }): string;

export function lastModelEffort(entries: any[]): { model: string | null; effort: string | null };

export interface PlannerRequest {
  model: string | null;
  effort: string | null;
  tokens: Tokens;
  cost: number | null;
}

export function plannerRequest(entries: any[], toolUseId: string): PlannerRequest | null;

export function finalText(entries: any[]): string;

export interface NumstatSummary {
  files: number;
  added: number;
  removed: number;
  paths: string[];
}

export function parseNumstat(text: string): NumstatSummary;

export function addedChars(diffText: string): number;

export interface HandoffRow {
  id: string;
  recordedAt: string;
  startedAt: string;
  session: string;
  transcript: string | null;
  cwd: string;
  branch: string;
  headBefore: string;
  title: string;
  planner: { model: string | null; effort: string | null };
  coder: { agent: string; model: string | null; effort: string | null };
  setup: string;
  plan: string;
  planChars: number;
  plannerRequest: PlannerRequest | null;
  report: string;
  status: string | null;
  coderStats: {
    requests: number;
    tokens: Tokens;
    longTokens: Tokens;
    peakContext: number;
    minutes: number;
    cost: number | null;
    toolUses: number | null;
  };
  /** The diff the coder made, from the CLI; null when it could not be taken. */
  change: (NumstatSummary & { addedChars: number; preTree: string; postTree: string }) | null;
  /** The planner's review of the coder's diff, set by `handoff-ship`. */
  review: ReviewStage | null;
  shippedAt: string | null;
}

export interface ReviewStage {
  by: "planner";
  model: string | null;
  effort: string | null;
  requests: number;
  tokens: Tokens;
  minutes: number;
  cost: number | null;
  /** What the session changed after the coder. */
  fixes: NumstatSummary;
}

export function reviewStage(span: { sessionEntries: any[]; from: string; to: string; fixes: NumstatSummary }): ReviewStage;

export function buildRow(run: {
  pending: any;
  sessionEntries: any[];
  agentEntries: any[];
  change: any;
  status: string | null;
  toolUses: number | null;
  recordedAt: string;
}): HandoffRow;

export function replaceRow(rows: HandoffRow[], row: HandoffRow): HandoffRow[];

export interface HandoffSummary {
  setup: string;
  n: number;
  medianPlanChars: number | null;
  medianAddedChars: number | null;
  medianRatio: number | null;
  meanCoderCost: number | null;
  meanPlannerCost: number | null;
  reviewed: number;
  withReviewFixes: number;
  meanReviewFixLines: number | null;
  meanReviewCost: number | null;
  merged: number;
}

export function summarize(rows: HandoffRow[], prStates?: Map<string, string>): HandoffSummary[];

export function renderReport(summaries: HandoffSummary[], rows: HandoffRow[]): string;
