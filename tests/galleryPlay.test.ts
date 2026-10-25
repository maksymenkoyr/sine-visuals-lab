import { describe, expect, it } from "vitest";
import { playingTile } from "../src/ui/galleryPlay.ts";

const A = { name: "a" };
const B = { name: "b" };
const C = { name: "c" };
const candidates = [
  { tile: A, centerDist: 300 },
  { tile: B, centerDist: 40 },
  { tile: C, centerDist: 120 },
];

describe("playingTile with hover", () => {
  it("plays the hovered tile", () => {
    expect(playingTile({ canHover: true, hovered: A, focused: C, candidates })).toBe(A);
  });

  it("falls back to the keyboard-focused tile", () => {
    expect(playingTile({ canHover: true, hovered: null, focused: C, candidates })).toBe(C);
  });

  it("plays nothing at rest, whatever sits near the middle", () => {
    expect(playingTile({ canHover: true, hovered: null, focused: null, candidates })).toBeNull();
  });

  it("plays nothing when the hovered tile is not a candidate (disabled, off screen)", () => {
    const stray = { name: "stray" };
    expect(playingTile({ canHover: true, hovered: stray, focused: null, candidates })).toBeNull();
  });
});

describe("playingTile without hover", () => {
  it("plays the candidate nearest the middle, ignoring hover and focus", () => {
    expect(playingTile({ canHover: false, hovered: A, focused: C, candidates })).toBe(B);
  });

  it("plays nothing with no candidates", () => {
    expect(playingTile({ canHover: false, hovered: null, focused: null, candidates: [] })).toBeNull();
    expect(playingTile({ canHover: true, hovered: A, focused: null, candidates: [] })).toBeNull();
  });
});
