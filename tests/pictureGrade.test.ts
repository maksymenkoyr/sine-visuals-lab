import { describe, expect, it } from "vitest";
import {
  clampGrade,
  GRADE_COLOUR_MAX,
  GRADE_FLOOR_MAX,
  GRADE_MIDS_MAX,
  gradeUniform,
  isNeutralGrade,
  NEUTRAL_GRADE,
} from "../src/render/pictureGrade.ts";

describe("pictureGrade", () => {
  it("reads anything that is not a grade as neutral", () => {
    for (const junk of [undefined, null, 3, "x", [], {}]) expect(clampGrade(junk)).toEqual(NEUTRAL_GRADE);
  });

  it("keeps the readable fields of a partial grade", () => {
    // An older main window, or a field lost in storage, must not reset the rest.
    expect(clampGrade({ floor: 0.1, mids: "up" })).toEqual({ ...NEUTRAL_GRADE, floor: 0.1 });
    expect(clampGrade({ colour: Number.NaN, mids: 0.5 })).toEqual({ ...NEUTRAL_GRADE, mids: 0.5 });
  });

  it("clamps each field into its range", () => {
    expect(clampGrade({ floor: -1, mids: -9, colour: -1 })).toEqual({ floor: 0, mids: -GRADE_MIDS_MAX, colour: 0 });
    expect(clampGrade({ floor: 9, mids: 9, colour: 9 })).toEqual({ floor: GRADE_FLOOR_MAX, mids: GRADE_MIDS_MAX, colour: GRADE_COLOUR_MAX });
  });

  it("is neutral only at the neutral grade", () => {
    expect(isNeutralGrade(NEUTRAL_GRADE)).toBe(true);
    expect(isNeutralGrade(clampGrade({}))).toBe(true);
    expect(isNeutralGrade({ ...NEUTRAL_GRADE, floor: 0.01 })).toBe(false);
    expect(isNeutralGrade({ ...NEUTRAL_GRADE, mids: -0.05 })).toBe(false);
    expect(isNeutralGrade({ ...NEUTRAL_GRADE, colour: 1.05 })).toBe(false);
  });

  it("hands the pass an identity at neutral and a brightening exponent for positive mids", () => {
    expect(gradeUniform(NEUTRAL_GRADE)).toEqual([0, 1, 1]);
    const [, up] = gradeUniform({ ...NEUTRAL_GRADE, mids: GRADE_MIDS_MAX });
    const [, down] = gradeUniform({ ...NEUTRAL_GRADE, mids: -GRADE_MIDS_MAX });
    expect(up).toBeLessThan(1);
    expect(down).toBeGreaterThan(1);
    expect(up * down).toBeCloseTo(1);
  });

  it("leaves the floor short of white, where the pass would divide by zero", () => {
    expect(GRADE_FLOOR_MAX).toBeLessThan(1);
  });
});
