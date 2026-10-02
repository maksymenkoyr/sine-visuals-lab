import { describe, expect, it } from "vitest";
import { createRateLimiter } from "../server/rateLimit.ts";

describe("createRateLimiter", () => {
  it("allows up to the limit inside the window and refuses the next", () => {
    const rl = createRateLimiter({ limit: 3, windowMs: 1000 });
    expect(rl.allow("a", 0)).toBe(true);
    expect(rl.allow("a", 100)).toBe(true);
    expect(rl.allow("a", 200)).toBe(true);
    expect(rl.allow("a", 300)).toBe(false);
  });

  it("slides: an old hit leaves the window and frees a slot", () => {
    const rl = createRateLimiter({ limit: 2, windowMs: 1000 });
    expect(rl.allow("a", 0)).toBe(true);
    expect(rl.allow("a", 500)).toBe(true);
    expect(rl.allow("a", 900)).toBe(false);
    // The hit at 0 is exactly one window old: out. The one at 500 is still in.
    expect(rl.allow("a", 1000)).toBe(true);
    expect(rl.allow("a", 1100)).toBe(false);
    expect(rl.allow("a", 1500)).toBe(true);
  });

  it("does not record refused hits, so waiting out the window recovers", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(rl.allow("a", 0)).toBe(true);
    for (let t = 100; t < 1000; t += 100) expect(rl.allow("a", t)).toBe(false);
    expect(rl.allow("a", 1000)).toBe(true);
  });

  it("keeps keys independent", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(rl.allow("a", 0)).toBe(true);
    expect(rl.allow("b", 0)).toBe(true);
    expect(rl.allow("a", 10)).toBe(false);
    expect(rl.allow("b", 10)).toBe(false);
  });

  it("clears everything once the table passes maxKeys", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 2 });
    expect(rl.allow("a", 0)).toBe(true);
    expect(rl.allow("b", 0)).toBe(true);
    expect(rl.allow("a", 10)).toBe(false);
    // Third key takes the table past maxKeys: all history is dropped.
    expect(rl.allow("c", 20)).toBe(true);
    expect(rl.allow("a", 30)).toBe(true);
    expect(rl.allow("b", 30)).toBe(true);
  });

  it("defaults to the real clock", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000 });
    expect(rl.allow("a")).toBe(true);
    expect(rl.allow("a")).toBe(false);
  });
});
