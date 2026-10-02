import { WORKER_ORIGIN } from "./config.ts";
import { encodeFeatureFrame, decodeFeatureFrame, type EncodableFrame } from "./protocol.ts";
import { ClockSync } from "./clock.ts";
import { JitterBuffer, type TimedFrame } from "./jitterBuffer.ts";
import { SlewLimiter } from "./slewLimiter.ts";
import { WireDecimator } from "./wireDecimator.ts";
import { parseViewport, type RosterEntry } from "../../server/roomWire.ts";
import type { Viewport } from "../render/scene.ts";

/** Fallback target: how far behind the room clock a device without exclusive
 *  local capture renders, so a slow/jittery network path never shows up as
 *  visible desync — it just eats into slack. A host that's alone in the room
 *  targets 0 instead (see HostConnection.targetDelayMs) since there's no one
 *  to desync from and no network hop in its own path. */
export const RENDER_DELAY_MS = 120;

/** Broadcast rate over the wire; local (own-screen) rendering stays at full framerate. */
const BROADCAST_INTERVAL_MS = 1000 / 30;

/** Max fraction of elapsed real time the effective render delay is allowed to
 *  move per sample() call. Keeps a change in target (e.g. a TV joining a
 *  solo host, stepping 0 -> RENDER_DELAY_MS) from visibly rewinding uTime —
 *  instead it drifts, reaching a 120ms swing in ~2.4s. */
const DELAY_SLEW_RATE = 0.05;

// Kept well below float32's ~7 significant digits so a raw epoch-ms time
// never has to touch a shader uniform (which would lose all sub-second
// precision and make animation stutter or freeze).
const TIME_WRAP_SEC = 100_000;
function roomTimeToSeconds(roomTimeMs: number): number {
  return (roomTimeMs / 1000) % TIME_WRAP_SEC;
}

export interface VisualSample {
  bands: Float32Array;
  energy: number;
  bpm: number;
  beatPhase: number;
  /** One-shot: true only on the render tick where an onset first becomes due. */
  onsetFired: boolean;
  /** Same one-shot shape as onsetFired, off the ungated pulse onset instead
   *  — tempo tracking (the beat clock's phase comb, render/animClock.ts)
   *  must read this, never onsetFired, so a host/renderer/TV's own
   *  Metronome isn't starved by whatever silenced onsetFired for visuals.
   *  See src/audio/types.ts's FeatureFrame.pulseOnset for the full story. */
  pulseFired: boolean;
  /** Room-clock time, wrapped to stay small — safe to feed straight into a `uTime` uniform. */
  timeSec: number;
  /** Absolute input loudness [0,1] — see FeatureFrame.level. */
  level: number;
}

// The roster shape and the control-message parsing are shared with the Room
// Durable Object (server/roomWire.ts), so the two ends can't drift apart.
export type { RosterEntry };

export interface DeviceCommand {
  scene?: string;
  palette?: string;
  viewport?: Viewport;
}

/** This page's device id, shared by every connection it opens. Blocked
 *  storage (cookies off, a sandboxed frame, some private modes) throws on
 *  both calls, so it only ever makes the id per-page-load instead of
 *  persistent — never a failure to connect. */
let cachedDeviceId: string | null = null;
function readDeviceId(): string {
  if (cachedDeviceId) return cachedDeviceId;
  const KEY = "vibe.deviceId";
  let id: string | null = null;
  try {
    id = localStorage.getItem(KEY);
  } catch {
    // Unreadable: fall through to a fresh id.
  }
  if (!id) {
    id = crypto.randomUUID();
    try {
      localStorage.setItem(KEY, id);
    } catch {
      // Not persisted; the cache below keeps it stable for this page.
    }
  }
  cachedDeviceId = id;
  return id;
}

function wsUrl(code: string, role: "host" | "renderer", ownDeviceId: string): string {
  const proto = WORKER_ORIGIN.startsWith("https") ? "wss" : "ws";
  const host = WORKER_ORIGIN.replace(/^https?:\/\//, "");
  return `${proto}://${host}/api/room/${code}/ws?role=${role}&deviceId=${encodeURIComponent(ownDeviceId)}`;
}

export async function createRoomCode(): Promise<string> {
  const res = await fetch(`${WORKER_ORIGIN}/api/room`, { method: "POST" });
  if (!res.ok) throw new Error(`room create failed: ${res.status}`);
  const body = (await res.json()) as { code: string };
  return body.code;
}

type ControlMessage =
  | { type: "pong"; t0: number; tServer: number }
  | { type: "roster"; devices: RosterEntry[] }
  | { type: "command"; scene?: string; palette?: string; viewport?: Viewport };

function parseControlMessage(data: unknown): ControlMessage | null {
  if (typeof data !== "string") return null;
  let msg: unknown;
  try {
    msg = JSON.parse(data);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== "object") return null;
  const m = msg as Record<string, unknown>;

  if (m.type === "pong" && typeof m.t0 === "number" && typeof m.tServer === "number") {
    return { type: "pong", t0: m.t0, tServer: m.tServer };
  }
  if (m.type === "roster" && Array.isArray(m.devices)) {
    return { type: "roster", devices: m.devices as RosterEntry[] };
  }
  if (m.type === "command") {
    return {
      type: "command",
      scene: typeof m.scene === "string" ? m.scene : undefined,
      palette: typeof m.palette === "string" ? m.palette : undefined,
      viewport: parseViewport(m.viewport),
    };
  }
  return null;
}

abstract class RoomConnectionBase {
  readonly deviceId = readDeviceId();
  protected ws: WebSocket;
  protected clock: ClockSync;
  protected buffer = new JitterBuffer();
  private delaySlew = new SlewLimiter(DELAY_SLEW_RATE);
  private _connected = false;
  private lastFrameAt = 0;
  private roster: RosterEntry[] = [];
  private rosterListeners: Array<(r: RosterEntry[]) => void> = [];
  private commandListeners: Array<(c: DeviceCommand) => void> = [];
  // Announcing a device is a "last write wins" fire-once call made right at
  // startup, often before the handshake finishes (e.g. while detectQuality()'s
  // benchmark is still running) — queue it and flush on open rather than
  // silently dropping it, or the device would never appear in anyone's roster.
  private pendingHello: { scene: string; palette: string; viewport?: Viewport } | null = null;

  constructor(code: string, role: "host" | "renderer") {
    this.ws = new WebSocket(wsUrl(code, role, this.deviceId));
    this.ws.binaryType = "arraybuffer";
    this.clock = new ClockSync((t0) => {
      if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "ping", t0 }));
    });

    this.ws.addEventListener("open", () => {
      this._connected = true;
      this.clock.start();
      if (this.pendingHello) this.ws.send(JSON.stringify({ type: "hello", ...this.pendingHello }));
    });
    this.ws.addEventListener("close", () => {
      this._connected = false;
      this.clock.stop();
    });
    this.ws.addEventListener("message", (e: MessageEvent) => this.onMessage(e.data));
  }

  get connected(): boolean {
    return this._connected;
  }

  get currentRoster(): RosterEntry[] {
    return this.roster;
  }

  /** Time since a frame last actually arrived in the buffer — distinct from
   *  socket state, since the DO relay leaves the renderer's own socket open
   *  even after the host it was relaying from disappears. */
  get msSinceLastFrame(): number {
    return this.lastFrameAt === 0 ? Infinity : Date.now() - this.lastFrameAt;
  }

  onRosterChange(cb: (r: RosterEntry[]) => void): () => void {
    this.rosterListeners.push(cb);
    return () => {
      this.rosterListeners = this.rosterListeners.filter((f) => f !== cb);
    };
  }

  /** Fires when another device (typically a control panel) commands this one. */
  onCommand(cb: (c: DeviceCommand) => void): () => void {
    this.commandListeners.push(cb);
    return () => {
      this.commandListeners = this.commandListeners.filter((f) => f !== cb);
    };
  }

  /** Announce (or update) this device's own scene/palette(+viewport) so the roster stays current.
   *  `viewport` is optional — omit it to leave the room's idea of this device's slice untouched. */
  sendHello(scene: string, palette: string, viewport?: Viewport): void {
    this.pendingHello = { scene, palette, viewport };
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "hello", scene, palette, viewport }));
      this.pendingHello = null;
    }
  }

  /** Ask another device (by id, from the roster) to change its scene/palette. */
  sendSetDevice(targetId: string, cmd: DeviceCommand): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "setDevice", targetId, ...cmd }));
    }
  }

  close(): void {
    this.clock.stop();
    this.ws.close();
  }

  protected pushFrame(frame: TimedFrame): void {
    this.buffer.push(frame);
    this.lastFrameAt = Date.now();
  }

  protected onMessage(data: unknown): void {
    const msg = parseControlMessage(data);
    if (!msg) return;
    if (msg.type === "pong") {
      this.clock.onPong(msg.t0, msg.tServer);
    } else if (msg.type === "roster") {
      this.roster = msg.devices;
      for (const cb of this.rosterListeners) cb(this.roster);
    } else if (msg.type === "command") {
      for (const cb of this.commandListeners) cb({ scene: msg.scene, palette: msg.palette, viewport: msg.viewport });
    }
  }

  /** How far behind the room clock this device targets right now. Overridden
   *  by HostConnection to go to 0 when it's alone in the room; every other
   *  case (renderers always, a host once someone else joins) uses the fixed
   *  network-jitter fallback. */
  protected targetDelayMs(): number {
    return RENDER_DELAY_MS;
  }

  /** The shared visual state every device — host or renderer — renders this instant. */
  sample(): VisualSample | null {
    const delayMs = this.delaySlew.next(this.targetDelayMs(), Date.now());
    const targetMs = this.clock.roomNow() - delayMs;
    const s = this.buffer.sampleAt(targetMs);
    if (!s) return null;
    return {
      bands: s.bands,
      energy: s.energy,
      bpm: s.bpm,
      beatPhase: this.buffer.beatPhaseAt(targetMs),
      onsetFired: this.buffer.consumeOnsetIfDue(targetMs),
      pulseFired: this.buffer.consumePulseIfDue(targetMs),
      timeSec: roomTimeToSeconds(targetMs),
      level: s.level,
    };
  }
}

export class HostConnection extends RoomConnectionBase {
  private decimator = new WireDecimator(BROADCAST_INTERVAL_MS);

  constructor(code: string) {
    super(code, "host");
  }

  /** Alone in the room (roster is empty pre-hello, or just this device's own
   *  socket) -> render fresh, since there's nobody to desync from and no
   *  network hop in this device's own path. Once anyone else joins, fall
   *  back to the same delay everyone else uses. */
  protected override targetDelayMs(): number {
    return this.currentRoster.length <= 1 ? 0 : RENDER_DELAY_MS;
  }

  /** Call every local render tick; internally decimates the wire send to ~30Hz
   *  while feeding the full-rate local buffer so this device's own visuals stay smooth.
   *  The one-tick onset flags raised on skipped ticks ride the next send
   *  (wireDecimator.ts) — the local buffer sees every one directly. */
  sendFrame(frame: EncodableFrame): void {
    const roomTimeMs = this.clock.roomNow();
    this.pushFrame({ ...frame, roomTimeMs });

    const d = this.decimator.offer(roomTimeMs, frame.onset, frame.pulseOnset);
    if (!d.send) return;
    // The latches are cleared even if the socket isn't open, so a stale hit
    // isn't replayed on reconnect.
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encodeFeatureFrame({ ...frame, onset: d.onset, pulseOnset: d.pulseOnset }, roomTimeMs));
    }
  }
}

export class RendererConnection extends RoomConnectionBase {
  constructor(code: string) {
    super(code, "renderer");
  }

  protected override onMessage(data: unknown): void {
    if (typeof data === "string") {
      super.onMessage(data);
      return;
    }
    const decoded = decodeFeatureFrame(data as ArrayBuffer);
    if (decoded) this.pushFrame(decoded);
  }
}
