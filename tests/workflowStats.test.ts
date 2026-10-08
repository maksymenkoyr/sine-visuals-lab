import { describe, it, expect } from "vitest";
import {
  buildRows,
  parseGrade,
  parseLabel,
  renderReport,
  setupKey,
  summarize,
  transcriptStats,
} from "../tools/workflowStatsLib.mjs";

// The rows these build are what tools/workflow-stats.mjs stores and sums, so a
// wrong parse here quietly skews every comparison between setups.

function assistant(model: string, effort: string, at: string, usage: Record<string, number>) {
  return { type: "assistant", effort, timestamp: at, message: { model, usage } };
}

function stage(model: string, effort: string, minutes: number) {
  const end = new Date(Date.UTC(2026, 9, 8, 0, minutes)).toISOString();
  return transcriptStats([
    { type: "user", timestamp: "2026-10-08T00:00:00.000Z" },
    assistant(model, effort, "2026-10-08T00:00:10.000Z", { input_tokens: 5, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 40 }),
    assistant(model, effort, end, { input_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 2000, output_tokens: 60 }),
  ]);
}

const SCRIPT_V2 = "export const meta = {}\nconst WORKFLOW_VERSION = 2\n";

function run(runId: string, script: string, review: Record<string, unknown>, coder = "claude-haiku-5-5") {
  return buildRows({
    record: { runId, workflowName: "plan-code-review", script, args: { issues: [7] } },
    recordedAt: "2026-10-08T01:00:00.000Z",
    agents: [
      { label: "plan #7", result: { title: "Seven", already_done: false, branch: "b7", plan: "…" }, transcript: stage("claude-sonnet-5-5", "high", 2) },
      { label: "code #7", result: { branch: "b7", typecheck_passed: true, tests_passed: false, deviations: "" }, transcript: stage(coder, "medium", 4) },
      { label: "review #7", result: review, transcript: stage("claude-opus-5-5", "high", 6) },
    ],
  });
}

describe("parseGrade", () => {
  it("reads a bare letter and the version-1 'letter: reason' text", () => {
    expect(parseGrade("A-")).toBe("A-");
    expect(parseGrade("B+: thorough but one slip")).toBe("B+");
    expect(parseGrade("B: followed the plan")).toBe("B");
  });

  it("refuses words that only start with a grade letter", () => {
    expect(parseGrade("Bad plan")).toBeNull();
    expect(parseGrade("E")).toBeNull();
    expect(parseGrade(undefined)).toBeNull();
  });
});

describe("parseLabel", () => {
  it("splits a stage label into stage and issue", () => {
    expect(parseLabel("review #355")).toEqual({ stage: "review", issue: 355 });
    expect(parseLabel("verify #1")).toBeNull();
  });
});

describe("transcriptStats", () => {
  it("sums every assistant turn's tokens and spans first to last timestamp", () => {
    const s = stage("claude-haiku-5-5", "medium", 3);
    expect(s).toMatchObject({ model: "claude-haiku-5-5", effort: "medium", turns: 2, minutes: 3 });
    expect(s.tokens).toEqual({ input: 10, cacheWrite: 100, cacheRead: 3000, output: 100 });
  });
});

describe("buildRows", () => {
  it("joins plan, code and review into one row per issue", () => {
    const [row] = run("wf_a", SCRIPT_V2, {
      issue_resolved: true, ready_to_ship: true, plan_grade: "A-", code_grade: "B",
      typecheck_passed: true, tests_passed: true,
      findings: [{ severity: "should-fix", origin: "plan", kind: "weak-test", file: "t.ts", summary: "could not fail", fixed: true }],
    });
    expect(row).toMatchObject({
      runId: "wf_a", version: 2, issue: 7, title: "Seven", branch: "b7",
      planGrade: "A-", codeGrade: "B", issueResolved: true, readyToShip: true,
    });
    expect(row.stages.code).toMatchObject({ testsPassed: false, minutes: 4 });
    expect(row.findings[0]).toMatchObject({ origin: "plan", kind: "weak-test", fixed: true });
  });

  it("treats a script without WORKFLOW_VERSION as version 1 and reads its haiku_grade", () => {
    const [row] = run("wf_old", "export const meta = {}", {
      plan_grade: "B-: one false fact", haiku_grade: "B+: solid", findings: [{ severity: "nit", file: "x", summary: "s", fixed: false }],
    });
    expect(row.version).toBe(1);
    expect(row.planGrade).toBe("B-");
    expect(row.codeGrade).toBe("B+");
    expect(row.findings[0].origin).toBeNull();
  });
});

describe("summarize", () => {
  it("keeps setups apart and averages within one", () => {
    const review = (code: string) => ({
      issue_resolved: true, plan_grade: "A", code_grade: code,
      findings: [
        { severity: "should-fix", origin: "plan", kind: "weak-test", file: "a", summary: "", fixed: true },
        { severity: "nit", origin: "code", kind: "style", file: "b", summary: "", fixed: false },
      ],
    });
    const rows = [
      ...run("wf_1", SCRIPT_V2, review("B")),
      ...run("wf_2", SCRIPT_V2, review("A")),
      ...run("wf_3", SCRIPT_V2, review("C"), "claude-sonnet-5-5"),
    ];
    expect(setupKey(rows[0])).toBe("v2 · plan sonnet-5-5/high · code haiku-5-5/medium · review opus-5-5/high");
    const summaries = summarize(rows, new Map([["b7", "MERGED"]]));
    expect(summaries).toHaveLength(2);
    const haiku = summaries.find((s) => s.setup.includes("code haiku"))!;
    expect(haiku).toMatchObject({ issues: 2, runs: 2, resolved: 2, merged: 2, codeGrade: 3.5, weakTests: 2, fromPlanShare: 0.5 });
    expect(haiku.findingsPerIssue).toEqual({ blocking: 0, shouldFix: 1, nit: 1 });
    expect(haiku.stages.code).toMatchObject({ minutes: 4, turns: 2, contextTokens: 3110 });
    expect(renderReport(summaries, rows)).toContain("grades (A = 4): plan 4.00 · code 3.50");
  });

  it("leaves issues the planner found already done out of the sums", () => {
    const [row] = run("wf_x", SCRIPT_V2, { plan_grade: "A", code_grade: "A", findings: [] });
    expect(summarize([{ ...row, alreadyDone: true }])).toEqual([]);
  });
});
