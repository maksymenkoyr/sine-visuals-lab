import { describe, expect, it } from "vitest";
import { createRateLimiter, rateLimitKey } from "../server/rateLimit.ts";

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

  it("filling the table past maxKeys does not reset a limited key", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 2 });
    expect(rl.allow("a", 0)).toBe(true);
    expect(rl.allow("b", 0)).toBe(true);
    expect(rl.allow("a", 10)).toBe(false);
    // Many new keys push the table past maxKeys again and again.
    for (let i = 0; i < 20; i++) {
      expect(rl.allow(`flood${i}`, 20 + i)).toBe(true);
      // `a` keeps knocking, so it stays at the back and keeps its limit.
      expect(rl.allow("a", 20 + i)).toBe(false);
    }
  });

  it("drops one key at a time, the one seen longest ago", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 2 });
    expect(rl.allow("a", 0)).toBe(true);
    expect(rl.allow("b", 0)).toBe(true);
    expect(rl.allow("a", 10)).toBe(false);
    // `b` is now at the front: the third key drops it and only it.
    expect(rl.allow("c", 20)).toBe(true);
    expect(rl.allow("a", 30)).toBe(false);
    expect(rl.allow("c", 30)).toBe(false);
    expect(rl.allow("b", 30)).toBe(true);
  });

  it("drops keys whose hits have expired before older live ones", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 2 });
    expect(rl.allow("a", 0)).toBe(true);
    expect(rl.allow("b", 100)).toBe(true);
    // A refused knock moves `a` behind `b`, but its only hit is from 0.
    expect(rl.allow("a", 900)).toBe(false);
    // At 1050 `a` has expired and `b` (hit at 100) has not: `a` goes, even
    // though `b` is at the front.
    expect(rl.allow("c", 1050)).toBe(true);
    expect(rl.allow("b", 1060)).toBe(false);
  });

  it("defaults to the real clock", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000 });
    expect(rl.allow("a")).toBe(true);
    expect(rl.allow("a")).toBe(false);
  });
});

describe("rateLimitKey", () => {
  it("keeps IPv4 as it is and falls back to unknown", () => {
    expect(rateLimitKey("203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitKey(null)).toBe("unknown");
    expect(rateLimitKey("")).toBe("unknown");
  });

  it("keys IPv6 by its /64, however it is written", () => {
    const key = "2001:db8:0:1::/64";
    expect(rateLimitKey("2001:db8:0:1::1")).toBe(key);
    expect(rateLimitKey("2001:0DB8:0000:0001:ffff:ffff:ffff:ffff")).toBe(key);
    expect(rateLimitKey("2001:db8:0:1:a:b:c:d%eth0")).toBe(key);
    expect(rateLimitKey("2001:db8::")).toBe("2001:db8:0:0::/64");
    expect(rateLimitKey("::1")).toBe("0:0:0:0::/64");
    expect(rateLimitKey("2001:db8:0:2::1")).not.toBe(key);
  });

  it("keeps an unparsable address as it is", () => {
    expect(rateLimitKey("1::2::3")).toBe("1::2::3");
    expect(rateLimitKey("1:2:3")).toBe("1:2:3");
    expect(rateLimitKey("zz::1")).toBe("zz::1");
  });

  it("gives two addresses in one /64 one shared limit", () => {
    const rl = createRateLimiter({ limit: 2, windowMs: 1000 });
    expect(rl.allow(rateLimitKey("2001:db8:0:1::1"), 0)).toBe(true);
    expect(rl.allow(rateLimitKey("2001:db8:0:1::2"), 10)).toBe(true);
    expect(rl.allow(rateLimitKey("2001:db8:0:1:dead:beef:0:3"), 20)).toBe(false);
    expect(rl.allow(rateLimitKey("2001:db8:0:2::1"), 20)).toBe(true);
  });
});
