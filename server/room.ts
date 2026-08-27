import { DurableObject } from "cloudflare:workers";

export interface Env {
  ROOM: DurableObjectNamespace;
}

interface Viewport {
  x: number;
  y: number;
  w: number;
  h: number;
}

const FULL_VIEWPORT: Viewport = { x: 0, y: 0, w: 1, h: 1 };

interface SocketAttachment {
  role: "host" | "renderer";
  deviceId: string;
  scene: string;
  palette: string;
  viewport: Viewport;
}

interface RosterEntry {
  deviceId: string;
  role: "host" | "renderer";
  scene: string;
  palette: string;
  viewport: Viewport;
}

function parseViewport(v: unknown): Viewport | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const { x, y, w, h } = o;
  if (typeof x === "number" && typeof y === "number" && typeof w === "number" && typeof h === "number") {
    return { x, y, w, h };
  }
  return undefined;
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
 */
export class Room extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }

    const url = new URL(request.url);
    const role: SocketAttachment["role"] = url.searchParams.get("role") === "host" ? "host" : "renderer";
    const deviceId = url.searchParams.get("deviceId") || crypto.randomUUID();

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
      this.handleControlMessage(ws, message);
      return;
    }

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
      ws.send(JSON.stringify({ type: "pong", t0: m.t0, tServer: Date.now() }));
      return;
    }

    // A device announcing itself / an updated local scene+palette(+viewport).
    if (m.type === "hello") {
      const prev = ws.deserializeAttachment() as SocketAttachment | null;
      if (!prev) return;
      ws.serializeAttachment({
        ...prev,
        scene: typeof m.scene === "string" ? m.scene : prev.scene,
        palette: typeof m.palette === "string" ? m.palette : prev.palette,
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
        scene: m.scene,
        palette: m.palette,
        viewport: parseViewport(m.viewport),
      });
      for (const target of this.ctx.getWebSockets(m.targetId)) target.send(command);
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
