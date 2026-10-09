import { describe, it, expect } from "vitest";
import {
  buildRecord,
  checkNewIssue,
  datasetRows,
  labelEdits,
  labelsAfter,
  parseLevel,
  parseRecords,
  readLabels,
  renderComment,
  summarize,
} from "../tools/difficultyLib.mjs";

// The records these parse are the dataset a future label corrector learns
// from, and the issue comments are the only copy, so a format slip here loses
// data quietly.

const AT = "2026-10-09T12:00:00.000Z";

function comment(body: string, authorAssociation = "OWNER") {
  return { body, authorAssociation, author: { login: "me" } };
}

describe("readLabels", () => {
  it("reads the difficulty and human, hardest difficulty winning", () => {
    expect(readLabels(["bug", "low dif"])).toEqual({ dif: "low", human: false });
    expect(readLabels([{ name: "high dif" }, { name: "low dif" }, { name: "human" }])).toEqual({ dif: "high", human: true });
    expect(readLabels(["bug"])).toEqual({ dif: null, human: false });
  });
});

describe("checkNewIssue", () => {
  it("refuses without a difficulty, reminds without human", () => {
    expect(checkNewIssue('gh issue create --title x --label bug')).toHaveProperty("refuse");
    expect(checkNewIssue('gh issue create --title x --label "mid dif"')).toHaveProperty("remind");
    expect(checkNewIssue(["mid dif", "human"])).toBeNull();
    expect(checkNewIssue([])).toHaveProperty("refuse");
  });
});

describe("parseLevel", () => {
  it("takes the level or the label", () => {
    expect(parseLevel("mid")).toBe("mid");
    expect(parseLevel("high dif")).toBe("high");
    expect(() => parseLevel("hard")).toThrow();
  });
});

describe("records", () => {
  it("round-trip through a comment, even with -- in the reason", () => {
    const rec = buildRecord({
      issue: 412,
      predicted: { dif: "low", human: false },
      actual: { dif: "mid", human: true },
      pr: 450,
      why: "needed a plan -- and a listen on the phone",
      at: AT,
    });
    const body = renderComment(rec);
    expect(body).toContain("`mid dif` (filed as `low dif`)");
    expect(body.split("<!--")[1]).not.toMatch(/--(?!>)/);
    expect(parseRecords(body)).toEqual([rec]);
  });

  it("skip a malformed record", () => {
    expect(parseRecords("<!-- difficulty-record {not json} -->")).toEqual([]);
    expect(parseRecords('<!-- difficulty-record {"v":1,"actual":{"dif":"huge"}} -->')).toEqual([]);
  });
});

describe("label edits", () => {
  it("swap the difficulty and follow human", () => {
    expect(labelEdits({ dif: "low", human: true }, { dif: "mid", human: false })).toEqual({ add: ["mid dif"], remove: ["low dif", "human"] });
    expect(labelEdits({ dif: "mid", human: false }, { dif: "mid", human: false })).toEqual({ add: [], remove: [] });
    expect(labelEdits({ dif: null, human: false }, { dif: "high", human: true })).toEqual({ add: ["high dif", "human"], remove: [] });
  });

  it("give the full list for a replacing write", () => {
    expect(labelsAfter(["bug", "low dif", "high dif"], { dif: "mid", human: true })).toEqual(["bug", "mid dif", "human"]);
  });
});

describe("datasetRows", () => {
  const first = buildRecord({ issue: 7, predicted: { dif: "low", human: false }, actual: { dif: "mid", human: false }, at: "2026-10-01T00:00:00Z" });
  const second = buildRecord({ issue: 7, predicted: { dif: "mid", human: false }, actual: { dif: "high", human: true }, why: "by eye", at: "2026-10-05T00:00:00Z" });

  it("take the first prediction and the last outcome", () => {
    const rows = datasetRows([{ number: 7, title: "t", body: "b", comments: [comment(renderComment(second)), comment(renderComment(first))] }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ issue: 7, predicted: { dif: "low" }, actual: { dif: "high", human: true }, verdict: "under", humanVerdict: "missed", why: "by eye", records: 2 });
  });

  it("ignore records from untrusted authors unless asked", () => {
    const issues = [{ number: 7, title: "t", comments: [comment(renderComment(first), "NONE")] }];
    expect(datasetRows(issues)).toEqual([]);
    expect(datasetRows(issues, { trusted: null })).toHaveLength(1);
  });

  it("sum into agreement and a filed-by-actual matrix", () => {
    const agree = buildRecord({ issue: 8, predicted: { dif: "mid", human: true }, actual: { dif: "mid", human: false }, at: AT });
    const unlabeled = buildRecord({ issue: 9, predicted: { dif: null, human: false }, actual: { dif: "low", human: false }, at: AT });
    const rows = datasetRows([
      { number: 7, title: "a", comments: [comment(renderComment(first))] },
      { number: 8, title: "b", comments: [comment(renderComment(agree))] },
      { number: 9, title: "c", comments: [comment(renderComment(unlabeled))] },
    ]);
    const s = summarize(rows);
    expect(s).toMatchObject({ rows: 3, unlabeled: 1, agree: 1, under: 1, over: 0, humanMissed: 0, humanExtra: 1 });
    expect(s.matrix.low.mid).toBe(1);
    expect(s.matrix.mid.mid).toBe(1);
  });
});
