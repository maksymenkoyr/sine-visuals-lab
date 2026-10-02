/**
 * A best-effort sliding-window limiter, one per Worker route that needs one
 * (room creation, TV adopt in server/worker.ts).
 *
 * State lives in the isolate, so a determined client can exceed the limit
 * across edge locations — the real backstop for a public URL is a Cloudflare
 * WAF rate-limiting rule. This just keeps a single misbehaving tab from
 * hammering an endpoint for free. Plain TS so tests can drive it with an
 * injected clock.
 */

export interface RateLimiter {
  /** Records a hit for `key` and says whether it is within the limit. A
   *  refused hit is not recorded, so waiting out the window always recovers. */
  allow(key: string, now?: number): boolean;
}

export function createRateLimiter(o: { limit: number; windowMs: number; maxKeys?: number }): RateLimiter {
  const maxKeys = o.maxKeys ?? 10_000;
  const hitsByKey = new Map<string, number[]>();

  return {
    allow(key, now = Date.now()) {
      const cutoff = now - o.windowMs;
      const hits = (hitsByKey.get(key) ?? []).filter((t) => t > cutoff);
      if (hits.length >= o.limit) {
        hitsByKey.set(key, hits);
        return false;
      }
      hits.push(now);
      hitsByKey.set(key, hits);
      // Keep the map from growing without bound on a long-lived isolate.
      if (hitsByKey.size > maxKeys) hitsByKey.clear();
      return true;
    },
  };
}
