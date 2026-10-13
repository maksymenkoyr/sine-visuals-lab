import { describe, expect, it } from "vitest";
import { type Box, type HintSlot, placeRowHint } from "../src/ui/rowHints";

const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom });
const slotBox = (s: HintSlot, height: number): Box => box(s.left, s.top, s.left + s.width, s.top + height);
const overlaps = (a: Box, b: Box): boolean =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

// A wide screen in the panel's wide layout: the meters column docked
// top-left, Power and the settings column top-right.
const VIEW = { width: 1600, height: 900 };
const METERS = box(16, 60, 393, 860);
const POWER = box(1066, 16, 1266, 300);
const SETTINGS = box(1270, 16, 1584, 860);
const HEIGHT = 60;
const fixedHeight = (): number => HEIGHT;

describe("placeRowHint", () => {
  it("puts a left column's hint on its right, level with the row", () => {
    const row = box(26, 200, 383, 240);
    const s = placeRowHint(row, METERS, [POWER, SETTINGS], VIEW, fixedHeight);
    expect(s.beside).toBe(true);
    expect(s.left).toBeGreaterThan(METERS.right);
    expect(s.left - METERS.right).toBeLessThan(20);
    expect(s.top).toBe(row.top);
  });

  it("puts a right column's hint on its left", () => {
    const row = box(1280, 500, 1574, 540);
    const s = placeRowHint(row, SETTINGS, [POWER, METERS], VIEW, fixedHeight);
    expect(s.beside).toBe(true);
    expect(s.left + s.width).toBeLessThan(SETTINGS.left);
    expect(SETTINGS.left - (s.left + s.width)).toBeLessThan(20);
  });

  it("steps past Power rather than covering it", () => {
    const row = box(1280, 100, 1574, 140);
    const s = placeRowHint(row, SETTINGS, [POWER, METERS], VIEW, fixedHeight);
    expect(s.beside).toBe(true);
    expect(overlaps(slotBox(s, HEIGHT), POWER)).toBe(false);
    expect(s.left + s.width).toBeLessThan(POWER.left);
  });

  it("measures at the width it places, and never wider than the room", () => {
    const widths: number[] = [];
    const tall = (w: number): number => {
      widths.push(w);
      return Math.ceil(3000 / w) * 16;
    };
    const narrowView = { width: 620, height: 900 };
    const col = box(16, 60, 393, 860);
    const s = placeRowHint(box(26, 200, 383, 240), col, [], narrowView, tall);
    expect(s.beside).toBe(true);
    expect(widths.at(-1)).toBe(s.width);
    expect(s.left + s.width).toBeLessThanOrEqual(narrowView.width);
  });

  it("keeps the hint on screen near the bottom", () => {
    const row = box(26, 840, 383, 880);
    const s = placeRowHint(row, METERS, [], VIEW, fixedHeight);
    expect(s.top + HEIGHT).toBeLessThanOrEqual(VIEW.height);
    expect(s.top).toBeLessThan(row.top);
  });

  it("floats over the rows below when there's no room beside (stacked layout)", () => {
    const phone = { width: 400, height: 800 };
    const col = box(0, 0, 400, 800);
    const row = box(8, 100, 392, 140);
    const s = placeRowHint(row, col, [], phone, fixedHeight);
    expect(s.beside).toBe(false);
    expect(s.left).toBe(row.left);
    expect(s.width).toBe(row.right - row.left);
    expect(s.top).toBeGreaterThanOrEqual(row.bottom);
  });

  it("with no column box at all, floats over the rows too", () => {
    const row = box(8, 100, 392, 140);
    const s = placeRowHint(row, null, [], { width: 1600, height: 900 }, fixedHeight);
    expect(s.beside).toBe(false);
  });

  it("floats above the row when there's no room below it", () => {
    const phone = { width: 400, height: 800 };
    const row = box(8, 740, 392, 780);
    const s = placeRowHint(row, box(0, 0, 400, 800), [], phone, fixedHeight);
    expect(s.beside).toBe(false);
    expect(s.top + HEIGHT).toBeLessThanOrEqual(row.top);
  });
});
