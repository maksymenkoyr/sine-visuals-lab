import { DurableObject } from "cloudflare:workers";
import { LOOK_LIMITS } from "./lookDoc.ts";
import { RoomCore, readAttachment, type CoreHost, type CoreSocket } from "./roomCore.ts";
import { MAX_SOCKETS_PER_ROOM, ROOM_CLOSE_DENIED, hashKey, validKey } from "./roomRules.ts";

export interface Env {
  ROOM: DurableObjectNamespace;
  /** The built site (wrangler.toml [assets]); only `/` reaches the Worker first. */
  ASSETS: Fetcher;
  /** Workers Analytics Engine dataset for usage counts (server/usage.ts).
   *  Bound in prod only — absent in previews and `wrangler dev`. */
  USAGE?: AnalyticsEngineDataset;
}

/**
 * One Room per party, as a Cloudflare adapter: this file owns the
 * WebSocketPair, the hibernation calls and `ctx.storage`, and hands every
 * decision to RoomCore (server/roomCore.ts), whose rules are in
 * server/roomRules.ts (who may join and send) and server/lookDoc.ts (the look
 * document).
 *
 * Feature-frame bytes are still relayed without being parsed — that stays a
 * client-side concern, and keeps the DO trivially cheap (WebSocket Hibernation
 * API means an idle room, e.g. a TV parked on the join screen, costs nothing).
 * What the room understands is small JSON: clock-sync ping/pong, the device
 * roster, the device records of a claimed room (`deviceSet`, `deviceForget`,
 * server/roomDevices.ts) that decide which member's frames go to which, and
 * the look of a claimed room. A device says what it is in the connect URL
 * (`kind`, `mic`, `name`), which only seeds its record.
 *
 * A refused join is not an HTTP error: a browser WebSocket can't read the
 * status, so the socket is opened and closed at once with ROOM_CLOSE_DENIED,
 * which is how the client tells "these credentials are dead" from "the
 * network blinked". A full room (MAX_SOCKETS_PER_ROOM) is the exception: it is
 * not a verdict on the credentials, so it is a plain 429 and the client's
 * reconnect treats it like any other drop. The one HTTP route handled here is
 * the TV adopt relay.
 */
export class Room extends DurableObject<Env> {
  private core!: RoomCore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Hibernation drops every instance field, so the room's state is rebuilt
    // from its storage rows before any event is delivered.
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.list<string>();
      this.core = new RoomCore(this.coreHost(), stored);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname.endsWith("/adopt")) return this.handleAdopt(request);
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS_PER_ROOM) {
      return new Response("room full", { status: 429 });
    }

    const params = url.searchParams;
    const k = params.get("k");
    const hk = params.get("hk");
    // A key that is present but malformed is refused before it is hashed.
    if ((k !== null && !validKey(k)) || (hk !== null && !validKey(hk))) return denyUpgrade();
    const hashes = {
      k: k === null ? null : await hashKey(k),
      hk: hk === null ? null : await hashKey(hk),
    };

    // No await from here to acceptWebSocket: join decides and claims in one
    // synchronous step.
    const result = this.core.join(
      {
        role: params.get("role"),
        deviceId: params.get("deviceId"),
        kind: params.get("kind"),
        mic: params.get("mic") === "1",
        name: params.get("name"),
        adopt: params.get("adopt"),
      },
      hashes,
      crypto.randomUUID(),
    );
    if (!result.ok) return denyUpgrade();

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, result.tags);
    server.serializeAttachment(result.attachment);
    this.core.opened(wrapSocket(server));
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    this.core.message(wrapSocket(ws), message);
  }

  webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    // Hibernation API removes the socket from getWebSockets() automatically.
    this.core.closed(wrapSocket(ws));
  }

  webSocketError(ws: WebSocket, _error: unknown): void {
    this.core.closed(wrapSocket(ws));
  }

  alarm(): void {
    this.core.alarm();
  }

  private async handleAdopt(request: Request): Promise<Response> {
    const text = await readCappedText(request, LOOK_LIMITS.maxAdoptBodyBytes);
    if (text === null) return Response.json({ error: "too-large" }, { status: 413 });
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return Response.json({ error: "bad-request" }, { status: 400 });
    }
    const result = this.core.adopt(body);
    return Response.json(result.body, { status: result.status });
  }

  private coreHost(): CoreHost {
    const { ctx } = this;
    return {
      sockets: (tag) => ctx.getWebSockets(tag).map(wrapSocket),
      now: () => Date.now(),
      setAlarm: (atMs) => settle(ctx.storage.setAlarm(atMs)),
      deleteAlarm: () => settle(ctx.storage.deleteAlarm()),
      put: (key, value) => settle(ctx.storage.put(key, value)),
      remove: (key) => settle(ctx.storage.delete(key)),
      removeAll: () => {
        // Both issued in this one step: deleteAll does not clear the alarm.
        settle(ctx.storage.deleteAlarm());
        settle(ctx.storage.deleteAll());
      },
    };
  }
}

/** The core's view of a socket. The attachment is decoded on every access, so
 *  a `hello` is visible to the next reader without any bookkeeping here. */
function wrapSocket(ws: WebSocket): CoreSocket {
  return {
    get attachment() {
      let raw: unknown = null;
      try {
        raw = ws.deserializeAttachment();
      } catch {
        // A socket that is already gone: readAttachment falls back to defaults.
      }
      return readAttachment(raw);
    },
    send: (data) => ws.send(data),
    close: (code, reason) => ws.close(code, reason),
    setAttachment: (a) => ws.serializeAttachment(a),
  };
}

function denyUpgrade(): Response {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  server.close(ROOM_CLOSE_DENIED, "denied");
  return new Response(null, { status: 101, webSocket: client });
}

/** Storage calls are fire-and-forget: the platform holds a message back until
 *  the writes before it have landed, and a failed write already resets the
 *  object, so the rejection carries nothing more. */
function settle(p: Promise<unknown>): void {
  p.catch(() => {});
}

/** The body as text, or null if it is longer than `maxBytes` — read as a
 *  stream so an oversized body is never held whole in the room's memory. */
async function readCappedText(request: Request, maxBytes: number): Promise<string | null> {
  if (Number(request.headers.get("Content-Length")) > maxBytes) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
