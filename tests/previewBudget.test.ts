import { describe, it, expect } from "vitest";
import { createPreviewBudgetController } from "../src/render/previewBudget.ts";

describe("createPreviewBudgetController", () => {
  it("starts at the given initial level, clamped by the ceiling", () => {
    const c = createPreviewBudgetController(5);
    expect(c.budgetFor(10)).toBe(5);
    expect(c.budgetFor(3)).toBe(3); // ceiling below level
  });

  it("never starts below 1 even if asked to", () => {
    const c = createPreviewBudgetController(0);
    expect(c.budgetFor(10)).toBe(1);
  });

  it("does not step down on a short over-budget streak", () => {
    const c = createPreviewBudgetController(4);
    // 4 tiles at 3ms each = 12ms/tick, well past a 4ms*1.5 target at level 4
    // — but only two ticks, nowhere near STEP_DOWN_TICKS.
    c.recordTick(12, 4);
    c.recordTick(12, 4);
    expect(c.budgetFor(10)).toBe(4);
  });

  it("steps down once a genuine overload streak runs long enough", () => {
    const c = createPreviewBudgetController(4);
    for (let i = 0; i < 10; i++) c.recordTick(12, 4);
    expect(c.budgetFor(10)).toBeLessThan(4);
  });

  it("keeps stepping down under sustained overload, never below 1", () => {
    const c = createPreviewBudgetController(4);
    for (let i = 0; i < 200; i++) c.recordTick(50, 4);
    expect(c.budgetFor(10)).toBe(1);
  });

  it("does not step up on a short comfortable streak", () => {
    const c = createPreviewBudgetController(2);
    // 2 tiles at 0.2ms each = 0.4ms/tick, well under a 4ms*0.6 target — but
    // only 10 ticks, nowhere near STEP_UP_TICKS once the EWMA settles.
    for (let i = 0; i < 10; i++) c.recordTick(0.4, 2);
    expect(c.budgetFor(10)).toBe(2);
  });

  it("steps up once a comfortable streak runs long enough", () => {
    const c = createPreviewBudgetController(2);
    for (let i = 0; i < 60; i++) c.recordTick(0.4, 2);
    expect(c.budgetFor(10)).toBeGreaterThan(2);
  });

  it("ignores idle ticks (nothing drawn) as evidence of either direction", () => {
    const c = createPreviewBudgetController(4);
    for (let i = 0; i < 100; i++) c.recordTick(0, 0);
    expect(c.budgetFor(10)).toBe(4);
  });

  it("clamps a stepped-up level to whatever smaller ceiling is asked for later", () => {
    const c = createPreviewBudgetController(2);
    for (let i = 0; i < 60; i++) c.recordTick(0.4, 2);
    expect(c.budgetFor(1)).toBe(1); // e.g. eligible.length shrank to 1
  });
});
