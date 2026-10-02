import { DurableObject } from "cloudflare:workers";
import {
  cleanName,
  FULL_VIEWPORT,
  isValidDeviceId,
  MAX_BINARY_BYTES,
  MAX_CONTROL_CHARS,
  MAX_SOCKETS_PER_ROOM,
  parseViewport,
  type RosterEntry,
  type Viewport,
} from "./roomWire.ts";

export interface Env {
  ROOM: DurableObjectNamespace;
  /** The built site (wrangler.toml [assets]); only `/` reaches the Worker first. */
  ASSETS: Fetcher;
  /** Workers Analytics Engine dataset for usage counts (server/usage.ts).
   *  Bound in prod only — absent in previews and `wrangler dev`. */
  USAGE?: AnalyticsEngineDataset;
}

interface SocketAttachment {
  role: "host" | "renderer";
  deviceId: string;
  scene: string;
  palette: string;
  viewport: Viewport;
}

/**
 * One Room per party. Feature-frame bytes are relayed without being parsed
 * — that stays a client-side concern, and keeps the DO trivially cheap
 * (WebSocket Hibernation API means an idle room, e.g. a TV parked on the
 * join screen, costs nothing). The one thing the DO *does* understand is
 * small JSON control messages: clock-sync ping/pong, and a device roster
 * so any device's control panel can see and command every other device.
 * Routing "set device X's scene" reuses the deviceId tag every socket is
 * already registered under — no separate lookup table needed.
 *
 * server/roomWire.ts holds the limits a peer is held to (sockets per room,
 * message sizes, id lengths) and why they are not authentication.
 */
export class Room extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }

    if (this.ctx.getWebSockets().length >= MAX_SOCKETS_PER_ROOM) {
      return new Response("room full", { status: 429 });
    }

    const url = new URL(request.url);
    const role: SocketAttachment["role"] = url.searchParams.get("role") === "host" ? "host" : "renderer";
    // A malformed id is replaced rather than refused, so an odd client still
    // pairs; it just can't be commanded by its own id (it never learns this one).
    const asked = url.searchParams.get("deviceId");
    const deviceId = asked && isValidDeviceId(asked) ? asked : crypto.randomUUID();

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server, [role, deviceId]);
    server.serializeAttachment({
      role,
      deviceId,
      scene: "",
      palette: "",
      viewport: FULL_VIEWPORT,
    } satisfies SocketAttachment);

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    if (typeof message === "string") {
      if (message.length <= MAX_CONTROL_CHARS) this.handleControlMessage(ws, message);
      return;
    }
    if (message.byteLength > MAX_BINARY_BYTES) return;

    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (attachment?.role !== "host") return; // only the host may broadcast frames

    for (const renderer of this.ctx.getWebSockets("renderer")) {
      try {
        renderer.send(message);
      } catch {
        // Socket is mid-close; webSocketClose will clean it up.
      }
    }
  }

  webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    // Hibernation API removes the socket from getWebSockets() automatically.
    this.broadcastRoster();
  }

  webSocketError(_ws: WebSocket, _error: unknown): void {
    this.broadcastRoster();
  }

  private handleControlMessage(ws: WebSocket, raw: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    const m = msg as {
      type?: string;
      t0?: number;
      scene?: string;
      palette?: string;
      viewport?: unknown;
      targetId?: string;
    };

    // Clock sync: echo the client's send time plus this DO's own wall
    // clock, immediately, so the client can estimate offset + RTT.
    if (m.type === "ping" && typeof m.t0 === "number") {
      try {
        ws.send(JSON.stringify({ type: "pong", t0: m.t0, tServer: Date.now() }));
      } catch {
        // Mid-close; webSocketClose will clean it up.
      }
      return;
    }

    // A device announcing itself / an updated local scene+palette(+viewport).
    if (m.type === "hello") {
      const prev = ws.deserializeAttachment() as SocketAttachment | null;
      if (!prev) return;
      ws.serializeAttachment({
        ...prev,
        scene: cleanName(m.scene) ?? prev.scene,
        palette: cleanName(m.palette) ?? prev.palette,
        viewport: parseViewport(m.viewport) ?? prev.viewport,
      } satisfies SocketAttachment);
      this.broadcastRoster();
      return;
    }

    // Any device commanding another (typically from a control panel) to
    // change its scene/palette/viewport. Routed straight to the target's tag.
    if (m.type === "setDevice" && typeof m.targetId === "string") {
      const command = JSON.stringify({
        type: "command",
        scene: cleanName(m.scene),
        palette: cleanName(m.palette),
        viewport: parseViewport(m.viewport),
      });
      // A reconnecting device can have its old socket still closing under the
      // same id: one failed send must not skip the live one.
      for (const target of this.ctx.getWebSockets(m.targetId)) {
        try {
          target.send(command);
        } catch {
          // Mid-close; webSocketClose will clean it up.
        }
      }
    }
  }

  private broadcastRoster(): void {
    const devices: RosterEntry[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as SocketAttachment | null;
      if (a) devices.push({ deviceId: a.deviceId, role: a.role, scene: a.scene, palette: a.palette, viewport: a.viewport });
    }
    const payload = JSON.stringify({ type: "roster", devices });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        // Mid-close; will drop out of the next broadcast.
      }
    }
  }
}
