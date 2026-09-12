import { describe, it, expect } from "vitest";
import { selectDueTiles, type ScheduleCandidate } from "../src/render/previewSchedule.ts";

describe("selectDueTiles", () => {
  it("draws a never-drawn tile before anything else", () => {
    const candidates: ScheduleCandidate[] = [
      { lastDrawMs: 900, targetIntervalMs: 100 }, // barely due
      { lastDrawMs: 0, targetIntervalMs: 100 }, // never drawn
    ];
    expect(selectDueTiles(candidates, 1000, 1)).toEqual([1]);
  });

  it("orders by how overdue each tile is relative to its own target", () => {
    const candidates: ScheduleCandidate[] = [
      { lastDrawMs: 800, targetIntervalMs: 100 }, // 2x overdue
      { lastDrawMs: 500, targetIntervalMs: 100 }, // 5x overdue
      { lastDrawMs: 990, targetIntervalMs: 100 }, // not due yet
    ];
    expect(selectDueTiles(candidates, 1000, 3)).toEqual([1, 0]);
  });

  it("returns nothing when nothing is due, regardless of budget", () => {
    const candidates: ScheduleCandidate[] = [
      { lastDrawMs: 950, targetIntervalMs: 100 },
      { lastDrawMs: 980, targetIntervalMs: 100 },
    ];
    expect(selectDueTiles(candidates, 1000, 5)).toEqual([]);
  });

  it("leaves budget unspent when fewer tiles are due than the budget allows", () => {
    const candidates: ScheduleCandidate[] = [
      { lastDrawMs: 0, targetIntervalMs: 100 },
      { lastDrawMs: 950, targetIntervalMs: 100 },
    ];
    expect(selectDueTiles(candidates, 1000, 5)).toEqual([0]);
  });

  it("caps the result at the budget even when more tiles are due", () => {
    const candidates: ScheduleCandidate[] = [
      { lastDrawMs: 500, targetIntervalMs: 100 },
      { lastDrawMs: 600, targetIntervalMs: 100 },
      { lastDrawMs: 700, targetIntervalMs: 100 },
    ];
    expect(selectDueTiles(candidates, 1000, 2)).toEqual([0, 1]);
  });

  it("degenerates to 'draw everything' when the budget covers every due tile", () => {
    const candidates: ScheduleCandidate[] = [
      { lastDrawMs: 0, targetIntervalMs: 33 },
      { lastDrawMs: 0, targetIntervalMs: 33 },
      { lastDrawMs: 0, targetIntervalMs: 33 },
    ];
    expect(selectDueTiles(candidates, 1000, 3).sort()).toEqual([0, 1, 2]);
  });

  it("a slow-target tile eventually outranks a fast-target one that was just served", () => {
    // The fast tile (target 50ms) was drawn recently; the slow tile (target
    // 500ms) hasn't drawn in a while and is now several multiples overdue —
    // it should win the single slot despite the fast tile's smaller target.
    const candidates: ScheduleCandidate[] = [
      { lastDrawMs: 980, targetIntervalMs: 50 }, // 0.4x overdue
      { lastDrawMs: 0, targetIntervalMs: 500 },
    ];
    expect(selectDueTiles(candidates, 1000, 1)).toEqual([1]);
  });

  it("keeps candidate order on ties", () => {
    const candidates: ScheduleCandidate[] = [
      { lastDrawMs: 500, targetIntervalMs: 100 },
      { lastDrawMs: 500, targetIntervalMs: 100 },
    ];
    expect(selectDueTiles(candidates, 1000, 2)).toEqual([0, 1]);
  });

  it("returns nothing for an empty candidate list", () => {
    expect(selectDueTiles([], 1000, 5)).toEqual([]);
  });
});
