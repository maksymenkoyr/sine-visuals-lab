import {
  applyOps,
  createModelSync,
  isModelKey,
  type CtlMessage,
  type Model,
  type Op,
  type OutStatus,
} from "./remoteSync.ts";

/**
 * Remote control, the glue half (the pure merge and the message types are
 * net/remoteSync.ts): a HOST link and a REMOTE link over the room connection.
 * Each is driven by the app's render loop (`tick`), talks through `LinkConn`
 * (net/room.ts's connection, or a fake in tests/remoteLink.test.ts), and
 * reads and writes the app through a `ModelPort` (app.ts's binding to the
 * stores, the scene and the panel).
 *
 * The host only listens once it is *armed* — someone opened its Remote control
 * card this session — because a room code is four characters with no auth:
 * an unarmed host answers a join with `denied` and ignores every other
 * message. The remote keeps asking (JOIN_RETRY_MS) until the host arms, and
 * sends a fresh join on every reconnect.
 */

/** How often each side looks for a local change to send. */
export const LINK_POLL_MS = 120;
/** How often an unlinked remote re-sends its join (host not armed yet, or a lost message). */
export const JOIN_RETRY_MS = 3000;

export interface LinkConn {
  readonly deviceId: string;
  readonly connected: boolean;
  onCtl(cb: (body: unknown, from: string | undefined) => void): void;
  onOpen(cb: () => void): void;
  sendCtl(body: unknown, to?: string): boolean;
  onRosterChange(cb: (r: Array<{ deviceId: string; role: string }>) => void): unknown;
}

/** The app as a link sees it. */
export interface ModelPort {
  /** The current model: synced stores plus scene/palette. */
  capture(): Model;
  /** Write these ops into the app (already limited to isModelKey keys). */
  apply(ops: Op[]): void;
  /** Make the app equal this whole model (a remote adopting the host's). */
  adopt(model: Model): void;
}

/** What the remote's Cue/Go controls drive — the same shape ui/outputControls.ts
 *  takes for the host's own output window. */
export interface OutputPanel {
  status(): OutStatus;
  onStatus(cb: (s: OutStatus) => void): void;
  setCue(on: boolean): void;
  go(): void;
  open(): void;
}

function asMessage(body: unknown): CtlMessage | null {
  if (!body || typeof body !== "object") return null;
  const t = (body as { t?: unknown }).t;
  return typeof t === "string" ? (body as CtlMessage) : null;
}

function safeOps(ops: unknown): Op[] {
  return Array.isArray(ops) ? (ops as Op[]) : [];
}

// ---- Host ----------------------------------------------------------------

export interface HostLink {
  tick(nowMs: number): void;
  /** Remotes currently linked. */
  remotes(): number;
}

export interface HostLinkOptions {
  conn: LinkConn;
  port: ModelPort;
  /** The host's own output window, if the app has one. */
  output: OutputPanel | null;
  isArmed: () => boolean;
  onRemotes?: (n: number) => void;
}

export function createHostLink(o: HostLinkOptions): HostLink {
  const { conn, port } = o;
  const sync = createModelSync();
  const linked = new Set<string>();
  let lastPoll = -Infinity;

  function changed(): void {
    o.onRemotes?.(linked.size);
  }

  function applyRemote(ops: Op[], from: string | undefined): void {
    const ok = ops.filter((op) => Array.isArray(op?.p) && op.p.length > 0 && isModelKey(String(op.p[0])));
    if (ok.length === 0) return;
    port.apply(ok);
    sync.received(ok);
    // The other remotes hear it too; the sender ignores its own `src`.
    if (linked.size > 1) conn.sendCtl({ t: "ops", ops: ok, src: from } satisfies CtlMessage);
  }

  conn.onCtl((body, from) => {
    const m = asMessage(body);
    if (!m || !from) return;
    if (!o.isArmed()) {
      if (m.t === "join") conn.sendCtl({ t: "denied" } satisfies CtlMessage, from);
      return;
    }
    // An `ops` from a remote the host does not know (the host reloaded and
    // lost its list) is treated as a join, so it gets a snap and re-links.
    if (m.t === "join" || (m.t === "ops" && !linked.has(from))) {
      applyRemote(safeOps(m.ops), from);
      if (!linked.has(from)) {
        linked.add(from);
        changed();
      }
      const snap: CtlMessage = { t: "snap", model: port.capture(), out: o.output?.status() ?? { open: false, cue: false, differs: false } };
      conn.sendCtl(snap, from);
    } else if (m.t === "ops") {
      applyRemote(safeOps(m.ops), from);
    } else if (m.t === "cue") {
      o.output?.setCue(m.on === true);
    } else if (m.t === "go") {
      o.output?.go();
    }
  });

  conn.onOpen(() => {
    if (o.isArmed()) conn.sendCtl({ t: "hostup" } satisfies CtlMessage);
  });

  conn.onRosterChange((roster) => {
    const present = new Set(roster.map((d) => d.deviceId));
    let dropped = false;
    for (const id of [...linked]) {
      if (!present.has(id)) {
        linked.delete(id);
        dropped = true;
      }
    }
    if (dropped) changed();
  });

  o.output?.onStatus((status) => {
    if (linked.size > 0) conn.sendCtl({ t: "out", status } satisfies CtlMessage);
  });

  return {
    tick(nowMs) {
      if (nowMs - lastPoll < LINK_POLL_MS) return;
      lastPoll = nowMs;
      if (!o.isArmed() || !conn.connected) return;
      const ops = sync.poll(port.capture());
      if (ops.length > 0 && linked.size > 0) conn.sendCtl({ t: "ops", ops } satisfies CtlMessage);
    },
    remotes: () => linked.size,
  };
}

// ---- Remote --------------------------------------------------------------

export type RemoteState = "connecting" | "denied" | "linked" | "offline";

export interface RemoteLink {
  tick(nowMs: number): void;
  state(): RemoteState;
  /** Cue/Go for the host's output window, as an OutputPanel. */
  output: OutputPanel;
  onState(cb: (s: RemoteState) => void): void;
}

export interface RemoteLinkOptions {
  conn: LinkConn;
  port: ModelPort;
}

export function createRemoteLink(o: RemoteLinkOptions): RemoteLink {
  const { conn, port } = o;
  const sync = createModelSync();
  let state: RemoteState = "connecting";
  let lastPoll = -Infinity;
  let lastJoin = -Infinity;
  let out: OutStatus = { open: false, cue: false, differs: false };
  const stateListeners: Array<(s: RemoteState) => void> = [];
  const outListeners: Array<(s: OutStatus) => void> = [];

  function setState(next: RemoteState): void {
    if (next === state) return;
    state = next;
    for (const cb of stateListeners) cb(next);
  }
  function setOut(next: OutStatus): void {
    out = next;
    for (const cb of outListeners) cb(next);
  }

  function join(nowMs: number): void {
    lastJoin = nowMs;
    // Edits made while unlinked ride along; `peek` so a denied join loses none.
    const ops = sync.hasBase() ? sync.peek(port.capture()) : [];
    conn.sendCtl({ t: "join", ops } satisfies CtlMessage);
  }

  conn.onOpen(() => {
    setState("connecting");
    join(performance.now());
  });

  conn.onCtl((body, from) => {
    const m = asMessage(body);
    if (!m) return;
    if (m.t === "snap") {
      const model = m.model && typeof m.model === "object" ? m.model : {};
      port.adopt(model);
      sync.adopt(model);
      if (m.out) setOut(m.out);
      setState("linked");
    } else if (m.t === "ops") {
      if (state !== "linked" || (m.src !== undefined && m.src === conn.deviceId)) return;
      const ok = safeOps(m.ops).filter((op) => Array.isArray(op?.p) && op.p.length > 0 && isModelKey(String(op.p[0])));
      if (ok.length === 0) return;
      port.apply(ok);
      sync.received(ok);
    } else if (m.t === "denied") {
      setState("denied");
    } else if (m.t === "hostup") {
      setState("connecting");
      join(performance.now());
    } else if (m.t === "out") {
      if (m.status) setOut(m.status);
    }
    void from;
  });

  return {
    tick(nowMs) {
      if (!conn.connected) {
        setState("offline");
        return;
      }
      if (state === "offline") setState("connecting");
      if (state !== "linked") {
        if (nowMs - lastJoin >= JOIN_RETRY_MS) join(nowMs);
        return;
      }
      if (nowMs - lastPoll < LINK_POLL_MS) return;
      lastPoll = nowMs;
      const ops = sync.poll(port.capture());
      if (ops.length > 0) conn.sendCtl({ t: "ops", ops } satisfies CtlMessage);
    },
    state: () => state,
    onState: (cb) => stateListeners.push(cb),
    output: {
      status: () => out,
      onStatus: (cb) => outListeners.push(cb),
      setCue: (on) => void conn.sendCtl({ t: "cue", on } satisfies CtlMessage),
      go: () => void conn.sendCtl({ t: "go" } satisfies CtlMessage),
      open: () => undefined,
    },
  };
}

/** Applies ops to a whole model copy — the storage binding's helper, exported
 *  so app.ts and the tests share one implementation. */
export function applyToModel(model: Model, ops: readonly Op[]): Model {
  const copy = JSON.parse(JSON.stringify(model)) as Model;
  applyOps(copy, ops);
  return copy;
}
