/**
 * A best-effort sliding-window limiter, one per Worker route that needs one
 * (room creation, TV adopt in server/worker.ts).
 *
 * State lives in the isolate, so a determined client can exceed the limit
 * across edge locations, and a hit refused here has already cost a Worker
 * request against the free plan's daily quota (past it, the site fails for
 * everyone until 00:00 UTC). This just keeps a single misbehaving tab from
 * hammering an endpoint for free. Plain TS so tests can drive it with an
 * injected clock.
 *
 * The backstop that stops a flood before the Worker is the zone's one Free
 * plan WAF rate-limiting rule (dashboard: Security → WAF → Rate limiting
 * rules; it lives only there, not in wrangler.toml). It blocks any IP for
 * 10 s once it sends more than 100 requests to a path starting `/api/` within
 * 10 s, counted per data center. Free allows only that window and block, and
 * only the path to match on. 100 sits well above a busy room behind one home
 * IP: each device redials a dropped socket (src/net/reconnect.ts) about five
 * times in 10 s, plus room creation, adopts and usage beacons. Lower it only
 * once nothing real has tripped it. Only a socket's connect is an HTTP request
 * it sees, never its messages. It caps bursts, not a day's total: 100 per 10 s
 * from one IP can still use up the daily quota in a few hours (#529).
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
