import { describe, it, expect } from "vitest";
import { funnyLookName } from "../src/render/lookNames.ts";

/** A random() that always lands on the same pair. */
const stuck = () => 0;

describe("funnyLookName", () => {
  it("fills every slot and keeps names short", () => {
    for (let i = 0; i < 200; i++) {
      const name = funnyLookName([]);
      expect(name).not.toMatch(/[%~]/);
      expect(name.length).toBeGreaterThan(0);
      expect(name.length).toBeLessThanOrEqual(36);
    }
  });

  it("never returns a taken name", () => {
    const taken: string[] = [];
    for (let i = 0; i < 300; i++) {
      const name = funnyLookName(taken);
      expect(taken).not.toContain(name);
      taken.push(name);
    }
  });

  it("numbers the name once random pairs keep colliding", () => {
    const first = funnyLookName([], stuck);
    expect(funnyLookName([first], stuck)).toBe(`${first} (2)`);
    expect(funnyLookName([first, `${first} (2)`], stuck)).toBe(`${first} (3)`);
  });
});
