import { describe, it, expect } from "vitest";
import {
  addedChars,
  buildRow,
  finalText,
  lastModelEffort,
  parseNumstat,
  plannerRequest,
  renderReport,
  replaceRow,
  setupTag,
  summarize,
} from "../tools/handoffStatsLib.mjs";

// The handoff rows these build are what `workflow-stats handoffs` reports, so a
// wrong parse here quietly skews every comparison between setups.

type Usage = { input_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number; output_tokens: number };

function assistant(model: string, effort: string | undefined, requestId: string, content: unknown[], usage?: Usage) {
  return { type: "assistant", requestId, timestamp: "2026-10-08T00:00:00.000Z", effort, message: { id: `msg_${requestId}`, model, usage, content } };
}

const usage = (output: number, cacheRead = 0): Usage => ({ input_tokens: 1, cache_creation_input_tokens: 100, cache_read_input_tokens: cacheRead, output_tokens: output });

describe("setupTag", () => {
  it("names the planner's and the coder's model and effort, without the claude- prefix", () => {
    expect(setupTag({ model: "claude-opus-5-5", effort: "xhigh" }, { model: "claude-haiku-5-5", effort: "high" })).toBe("opus-5-5/xhigh → haiku-5-5/high");
  });

  it("reads a missing model or effort as ?", () => {
    expect(setupTag({ model: null, effort: null }, { model: null, effort: null })).toBe("?/? → ?/?");
  });
});

describe("lastModelEffort", () => {
  it("takes the last real assistant message, skipping user and synthetic ones", () => {
    const entries = [
      assistant("claude-opus-5-5", "xhigh", "a", [{ type: "text", text: "plan" }]),
      { type: "user", message: { content: "go" } },
      assistant("claude-sonnet-5-5", "high", "b", [{ type: "text", text: "ok" }]),
      assistant("<synthetic>", "high", "c", [{ type: "text", text: "No response requested." }]),
    ];
    expect(lastModelEffort(entries)).toEqual({ model: "claude-sonnet-5-5", effort: "high" });
  });
});

describe("plannerRequest", () => {
  const entries = [
    assistant("claude-opus-5-5", "xhigh", "r2", [{ type: "text", text: "thinking" }], usage(40, 5000)),
    assistant("claude-opus-5-5", "xhigh", "r2", [{ type: "tool_use", id: "tu1", name: "Agent", input: {} }], usage(300, 5000)),
    assistant("claude-sonnet-5-5", "high", "r1", [{ type: "text", text: "earlier" }], usage(7000, 9000)),
  ];

  it("sums one request once, across the entries of its requestId", () => {
    const r = plannerRequest(entries, "tu1");
    expect(r?.tokens.outputSeen).toBe(300);
    expect(r?.tokens.cacheRead).toBe(5000);
    expect(r?.model).toBe("claude-opus-5-5");
    expect(r?.effort).toBe("xhigh");
    expect(typeof r?.cost).toBe("number");
    expect(r?.cost ?? 0).toBeGreaterThan(0);
  });

  it("returns null for a tool_use id no entry holds", () => {
    expect(plannerRequest(entries, "nope")).toBeNull();
  });
});

describe("parseNumstat", () => {
  it("counts files, added and removed lines, and reads binary files as zero", () => {
    expect(parseNumstat("3\t1\ta.ts\n-\t-\timg.png\n10\t0\tb.ts\n")).toEqual({
      files: 3, added: 13, removed: 1, paths: ["a.ts", "img.png", "b.ts"],
    });
  });
});

describe("addedChars", () => {
  it("counts the characters of added lines, not the file headers or removed and context lines", () => {
    const diff = ["+++ b/a.ts", "+abc", "+", "-gone", " ctx"].join("\n");
    expect(addedChars(diff)).toBe(3);
  });
});

describe("finalText", () => {
  it("is the text of the last assistant message that has text", () => {
    const entries = [
      assistant("claude-haiku-5-5", "high", "q1", [{ type: "text", text: "first" }]),
      assistant("claude-haiku-5-5", "high", "q2", [{ type: "tool_use", id: "t", name: "Read", input: {} }]),
    ];
    expect(finalText(entries)).toBe("first");
    expect(finalText([])).toBe("");
  });
});

describe("buildRow", () => {
  const pending = {
    id: "tu-1", startedAt: "2026-10-08T10:00:00.000Z", session: "s1", transcript: "/t.jsonl", cwd: "/repo",
    branch: "b1", headBefore: "abc", title: "Do the thing", agent: "haiku-coder", plan: "x".repeat(50),
    preTree: "t1", agentId: "a1",
  };

  it("builds the setup, the plan's size, the report and the coder's stats", () => {
    const sessionEntries = [
      assistant("claude-opus-5-5", "xhigh", "rp", [{ type: "tool_use", id: "tu-1", name: "Agent", input: {} }], usage(20)),
    ];
    const agentEntries = [
      assistant("claude-haiku-5-5", "high", "q1", [{ type: "tool_use", id: "t", name: "Edit", input: {} }], usage(30)),
      assistant("claude-haiku-5-5", "high", "q2", [{ type: "text", text: "done: 2 files" }], usage(50, 400)),
    ];
    const change = { files: 2, added: 10, removed: 2, paths: ["a.ts", "b.ts"], addedChars: 120, preTree: "t1", postTree: "t2" };
    const row = buildRow({ pending, sessionEntries, agentEntries, change, status: "completed", toolUses: 5, recordedAt: "2026-10-08T11:00:00.000Z" });
    expect(row.setup).toBe("opus-5-5/xhigh → haiku-5-5/high");
    expect(row.planChars).toBe(50);
    expect(row.report).toBe("done: 2 files");
    expect(row.coderStats.requests).toBe(2);
    expect(row.plannerRequest?.model).toBe("claude-opus-5-5");
    expect(row.fixup).toBeNull();
  });
});

describe("replaceRow", () => {
  it("replaces the row with the same id and keeps the others in order", () => {
    const rows: any[] = [{ id: "a", v: 1 }, { id: "b", v: 2 }, { id: "c", v: 3 }];
    const out: any[] = replaceRow(rows, { id: "b", v: 9 } as any);
    expect(out.map((r) => r.id)).toEqual(["a", "c", "b"]);
    expect(out.find((r) => r.id === "b")?.v).toBe(9);
    expect(out.find((r) => r.id === "a")?.v).toBe(1);
  });
});

describe("summarize", () => {
  const A = "opus-5-5/xhigh → haiku-5-5/high";
  const B = "sonnet-5-5/high → haiku-5-5/medium";
  const rows: any[] = [
    { id: "1", setup: A, planChars: 100, branch: "b1", change: { addedChars: 400, added: 10, removed: 0 }, fixup: null, coderStats: { cost: 0.2 }, plannerRequest: { cost: 0.5 } },
    { id: "2", setup: A, planChars: 300, branch: "b2", change: { addedChars: 300, added: 5, removed: 5 }, fixup: { added: 2, removed: 1 }, coderStats: { cost: 0.4 }, plannerRequest: { cost: 0.7 } },
    { id: "3", setup: B, planChars: 80, branch: "b3", change: null, fixup: null, coderStats: { cost: 0.1 }, plannerRequest: null },
  ];
  const prStates = new Map([["b1", "MERGED"], ["b2", "OPEN"]]);

  it("sums each setup, with the median ratio over the rows that have a change", () => {
    const [a, b] = summarize(rows, prStates);
    expect(a.setup).toBe(A);
    expect(a.n).toBe(2);
    expect(a.medianRatio).toBeCloseTo(0.625);
    expect(a.withFixup).toBe(1);
    expect(a.meanFixupLines).toBe(3);
    expect(a.merged).toBe(1);
    expect(b.setup).toBe(B);
    expect(b.medianRatio).toBeNull();
  });

  it("sorts the setups with the most handoffs first", () => {
    // B first in the input, so insertion order alone would put it first.
    expect(summarize([rows[2], rows[0], rows[1]], prStates).map((s) => s.setup)).toEqual([A, B]);
  });
});

describe("renderReport", () => {
  it("prints each setup and each handoff's title", () => {
    const A = "opus-5-5/xhigh → haiku-5-5/high";
    const B = "sonnet-5-5/high → haiku-5-5/medium";
    const rows: any[] = [
      { id: "1234567890abcdef", startedAt: "2026-10-08T10:00:00.000Z", setup: A, title: "Add the caustics level", planChars: 100, branch: "b1", change: { added: 10, removed: 0, addedChars: 400 }, fixup: null, coderStats: { cost: 0.2 } },
      { id: "fedcba0987654321", startedAt: "2026-10-09T10:00:00.000Z", setup: B, title: "Fix the room join", planChars: 80, branch: "b3", change: null, fixup: null, coderStats: { cost: 0.1 } },
    ];
    const text = renderReport(summarize(rows, new Map()), rows);
    expect(text).toContain(A);
    expect(text).toContain(B);
    expect(text).toContain("Add the caustics level");
    expect(text).toContain("Fix the room join");
  });
});
