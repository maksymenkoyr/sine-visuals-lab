import { Room, type Env } from "./room.ts";
import { createRateLimiter } from "./rateLimit.ts";
import { isBotUserAgent, parseUsageEvent, usageDataPoint } from "./usage.ts";

export { Room };

// Uppercase letters + digits, minus visually ambiguous ones (0/O, 1/I/L).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const APEX_HOST = "sinevisualslab.com";
const ROOM_PATH_RE = /^\/api\/room\/([A-Z2-9]{4})\/ws$/;
const ADOPT_PATH_RE = /^\/api\/room\/([A-Z2-9]{4})\/adopt$/;

function randomRoomCode(): string {
  let code = "";
  for (const b of crypto.getRandomValues(new Uint8Array(4))) {
    code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  }
  return code;
}

// Permissive CORS: room codes carry no auth/secrets, and in local dev the
// static site (Vite) and this Worker are necessarily different origins.
// In prod, when both are deployed same-origin, these headers are no-ops.
// Room keys are secrets, but they only ever travel in request URLs and bodies,
// never in a response a cross-origin page could read.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Best-effort per-IP throttles (server/rateLimit.ts says why they are only
// best-effort: the real backstop for a public URL is a Cloudflare WAF
// rate-limiting rule). Room creation and TV adopt each get their own, so a
// phone retrying an adopt can't use up the laptop's room creation.
const roomCreateLimiter = createRateLimiter({ limit: 20, windowMs: 60_000 });
const adoptLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // The bare domain serves the same site as www, so without this Google
    // sees two copies of the homepage. Only `/` is routed here ahead of the
    // assets (run_worker_first in wrangler.toml) — it's the one page that
    // gets indexed, and every asset request stays off the Worker.
    if (url.pathname === "/") {
      // The Host header, not url.hostname: `wrangler dev` rewrites request.url
      // to the first route in wrangler.toml, which is the apex.
      if (request.headers.get("Host") === APEX_HOST) {
        return Response.redirect(`https://www.${APEX_HOST}/${url.search}`, 301);
      }
      return env.ASSETS.fetch(request);
    }

    // The preflight for both POST routes: a JSON content type forces one, and
    // in dev Vite and `wrangler dev` are different origins.
    if ((url.pathname === "/api/room" || ADOPT_PATH_RE.test(url.pathname)) && request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/api/room" && request.method === "POST") {
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      if (!roomCreateLimiter.allow(ip)) {
        return new Response("too many rooms, slow down", {
          status: 429,
          headers: { ...CORS_HEADERS, "Retry-After": "60" },
        });
      }
      return Response.json({ code: randomRoomCode() }, { headers: CORS_HEADERS });
    }

    // A phone telling the TV waiting in slot {code} which room to join. The
    // slot's Durable Object relays it to the TV (server/roomCore.ts `adopt`);
    // the Worker only throttles it and adds CORS to whatever comes back.
    const adopt = url.pathname.match(ADOPT_PATH_RE);
    if (adopt && request.method === "POST") {
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      if (!adoptLimiter.allow(ip)) {
        return new Response("too many requests, slow down", {
          status: 429,
          headers: { ...CORS_HEADERS, "Retry-After": "60" },
        });
      }
      const res = await env.ROOM.get(env.ROOM.idFromName(adopt[1])).fetch(request);
      const headers = new Headers(res.headers);
      for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value);
      return new Response(res.body, { status: res.status, headers });
    }

    // Fire-and-forget beacon from src/net/usage.ts; always 204 so a bad or
    // unrecorded event is indistinguishable from a counted one to the client.
    if (url.pathname === "/api/usage" && request.method === "POST") {
      const ua = request.headers.get("User-Agent") ?? "";
      const ev = parseUsageEvent(await request.json().catch(() => null));
      if (ev && env.USAGE && !isBotUserAgent(ua)) {
        const country = typeof request.cf?.country === "string" ? request.cf.country : "XX";
        env.USAGE.writeDataPoint(usageDataPoint(ev, country, ua));
      }
      return new Response(null, { status: 204 });
    }

    const match = url.pathname.match(ROOM_PATH_RE);
    if (match) {
      // Answer a plain GET here: the Room's own Upgrade check would run only
      // after a Durable Object was instantiated or woken for it.
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected websocket", { status: 426 });
      }
      const stub = env.ROOM.get(env.ROOM.idFromName(match[1]));
      return stub.fetch(request);
    }

    return new Response("not found", { status: 404 });
  },
};
