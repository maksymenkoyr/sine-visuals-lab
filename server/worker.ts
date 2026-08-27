import { Room, type Env } from "./room.ts";

export { Room };

// Uppercase letters + digits, minus visually ambiguous ones (0/O, 1/I/L).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const ROOM_PATH_RE = /^\/api\/room\/([A-Z2-9]{4})\/ws$/;

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
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Best-effort per-IP throttle on room creation. State is per-isolate, so a
// determined client can exceed it across edge locations — the real backstop
// for a public URL is a Cloudflare WAF rate-limiting rule on /api/room. This
// just keeps a single misbehaving tab from hammering the endpoint for free.
const ROOM_CREATE_LIMIT = 20;
const ROOM_CREATE_WINDOW_MS = 60_000;
const roomCreateHits = new Map<string, number[]>();

function roomCreateAllowed(ip: string, now = Date.now()): boolean {
  const cutoff = now - ROOM_CREATE_WINDOW_MS;
  const hits = (roomCreateHits.get(ip) ?? []).filter((t) => t > cutoff);
  if (hits.length >= ROOM_CREATE_LIMIT) {
    roomCreateHits.set(ip, hits);
    return false;
  }
  hits.push(now);
  roomCreateHits.set(ip, hits);
  // Keep the map from growing without bound on a long-lived isolate.
  if (roomCreateHits.size > 10_000) roomCreateHits.clear();
  return true;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/room" && request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/api/room" && request.method === "POST") {
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      if (!roomCreateAllowed(ip)) {
        return new Response("too many rooms, slow down", {
          status: 429,
          headers: { ...CORS_HEADERS, "Retry-After": "60" },
        });
      }
      return Response.json({ code: randomRoomCode() }, { headers: CORS_HEADERS });
    }

    const match = url.pathname.match(ROOM_PATH_RE);
    if (match) {
      const stub = env.ROOM.get(env.ROOM.idFromName(match[1]));
      return stub.fetch(request);
    }

    return new Response("not found", { status: 404 });
  },
};
