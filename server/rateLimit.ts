/**
 * A best-effort sliding-window limiter, one per Worker route that needs one
 * (room creation, TV adopt and room connections in server/worker.ts), and
 * `rateLimitKey`, the one place those routes turn a visitor's address into a
 * limiter key.
 *
 * State lives in the isolate, so a determined client can exceed the limit
 * across edge locations — the real backstop for a public URL is a Cloudflare
 * WAF rate-limiting rule. This just keeps a single misbehaving tab from
 * hammering an endpoint for free. Plain TS so tests can drive it with an
 * injected clock.
 *
 * The key table is capped at `maxKeys` so a long-lived isolate can't grow it
 * without bound. Every call moves its key to the back of the table (a `Map`
 * keeps insertion order), so the front is whoever was seen longest ago. Past
 * the cap, keys whose hits have all left the window go first, then keys from
 * the front, one at a time. The table is never cleared whole: that would let
 * anyone with enough addresses reset the limit for everyone, themselves
 * included. A limited key that keeps knocking stays at the back.
 *
 * IPv6 addresses are keyed by their /64 prefix, since one connection usually
 * holds a whole /64 and could otherwise rotate through it for fresh limits.
 */

export interface RateLimiter {
  /** Records a hit for `key` and says whether it is within the limit. A
   *  refused hit is not recorded, so waiting out the window always recovers. */
  allow(key: string, now?: number): boolean;
}

export function createRateLimiter(o: { limit: number; windowMs: number; maxKeys?: number }): RateLimiter {
  const maxKeys = o.maxKeys ?? 10_000;
  const hitsByKey = new Map<string, number[]>();

  // `keep` is the key being served, which has just moved to the back.
  function evict(cutoff: number, keep: string): void {
    // Hits are pushed in time order, so the last one is the newest.
    for (const [key, hits] of hitsByKey) {
      if (hitsByKey.size <= maxKeys) return;
      if (key !== keep && (hits.length === 0 || hits[hits.length - 1] <= cutoff)) hitsByKey.delete(key);
    }
    for (const key of hitsByKey.keys()) {
      if (hitsByKey.size <= maxKeys || key === keep) return;
      hitsByKey.delete(key);
    }
  }

  return {
    allow(key, now = Date.now()) {
      const cutoff = now - o.windowMs;
      const hits = (hitsByKey.get(key) ?? []).filter((t) => t > cutoff);
      const allowed = hits.length < o.limit;
      if (allowed) hits.push(now);
      // Delete then set, so this key moves to the back of the table.
      hitsByKey.delete(key);
      hitsByKey.set(key, hits);
      if (hitsByKey.size > maxKeys) evict(cutoff, key);
      return allowed;
    },
  };
}

/** The limiter key for a request's `CF-Connecting-IP` value: an IPv4 address
 *  as it is, an IPv6 address as its /64 prefix, and "unknown" when the header
 *  is missing. Anything that doesn't parse as IPv6 is kept as it is. */
export function rateLimitKey(ip: string | null): string {
  if (ip === null || ip === "") return "unknown";
  if (!ip.includes(":") || ip.includes(".")) return ip;
  const addr = ip.split("%")[0].toLowerCase();
  const halves = addr.split("::");
  if (halves.length > 2) return ip;
  const head = halves[0] === "" ? [] : halves[0].split(":");
  const tail = halves.length === 2 && halves[1] !== "" ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return ip;
  const groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return ip;
  return `${groups
    .slice(0, 4)
    .map((g) => Number.parseInt(g, 16).toString(16))
    .join(":")}::/64`;
}
