import { WORKER_ORIGIN } from "./config.ts";
import { encodeFeatureFrame, decodeFeatureFrame, type EncodableFrame } from "./protocol.ts";
import { ClockSync } from "./clock.ts";
import { JitterBuffer, type TimedFrame } from "./jitterBuffer.ts";
import { SlewLimiter } from "./slewLimiter.ts";
import { WireDecimator } from "./wireDecimator.ts";
import { realStorage } from "./realStorage.ts";
import { reconnectDelayMs, isTerminalClose, isSilent, PROBE_TIMEOUT_MS } from "./reconnect.ts";
import { parseControlMessage, type DeviceCommand, type RosterEntry } from "./roomMessages.ts";
import type { Viewport } from "../render/scene.ts";
import type { LookClientMsg, LookServerMsg } from "../../server/lookDoc.ts";
import { ROOM_CLOSE_DENIED, type RoomRole } from "../../server/roomRules.ts";

// The roster and command shapes live with the rest of the JSON vocabulary
// (roomMessages.ts); callers that only want the types keep importing them here.
export type { RosterEntry, DeviceCommand } from "./roomMessages.ts";
export type { RoomRole };

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

/** How often a reconnecting connection checks whether its pings are going
 *  unanswered (reconnect.ts isSilent has the limit). */
const WATCHDOG_CHECK_MS = 1000;

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

/** The room's keys, as the laptop minted them. A host presents both; a phone
 *  or TV presents only the room key. Absent = the old keyless legacy join
 *  (server/roomRules.ts has what that still allows). */
export interface RoomAuth {
  roomKey?: string;
  hostKey?: string;
}

export interface ConnOptions {
  auth?: RoomAuth;
  /** Redial after a drop. Off by default: the legacy phone-as-renderer path
   *  relies on a dropped socket staying dropped (fallBackToSolo in app.ts). */
  reconnect?: boolean;
}

/** `denied` is terminal: the room refused these credentials (reconnect.ts
 *  isTerminalClose). Every other close is `closed`, then `connecting` again if
 *  the connection reconnects. */
export type ConnState = "connecting" | "open" | "closed" | "denied";

/** A random UUID v4. crypto.randomUUID needs a recent Chrome;
 *  getRandomValues is old enough for any TV browser. */
function newDeviceId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  let hex = "";
  for (let i = 0; i < b.length; i++) hex += (b[i] + 0x100).toString(16).slice(1);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Used when storage is blocked (Safari/WebKit private modes, sandboxed
 *  frames): one id per page load, shared by every connection in the page, so a
 *  host and a renderer in the same tab still agree on who "this device" is. */
let sessionDeviceId: string | null = null;

// Read through the real storage, not `localStorage`: on a paired phone or TV
// the global is the in-memory overlay (realStorage.ts), and the device id must
// survive a reload and stay out of the room's look.
function readDeviceId(): string {
  const KEY = "vibe.deviceId";
  try {
    const store = realStorage ?? localStorage;
    let id = store.getItem(KEY);
    if (!id) {
      id = newDeviceId();
      store.setItem(KEY, id);
    }
    return id;
  } catch {
    return (sessionDeviceId ??= newDeviceId());
  }
}

export function roomWsUrl(code: string, role: RoomRole, deviceId: string, extra?: Record<string, string>): string {
  const proto = WORKER_ORIGIN.startsWith("https") ? "wss" : "ws";
  const host = WORKER_ORIGIN.replace(/^https?:\/\//, "");
  let url = `${proto}://${host}/api/room/${encodeURIComponent(code)}/ws?role=${role}&deviceId=${encodeURIComponent(deviceId)}`;
  if (extra) {
    for (const name of Object.keys(extra)) url += `&${encodeURIComponent(name)}=${encodeURIComponent(extra[name])}`;
  }
  return url;
}

/** Asks the Worker for a fresh room. Gives up after `timeoutMs`, because the
 *  callers (boot, the TV page) wait on it before showing anything and a
 *  stalled request — a captive portal, a cold or black-holed Worker — neither
 *  resolves nor rejects; a timeout rejects, and boot's catch runs solo.
 *  AbortController + setTimeout rather than AbortSignal.timeout, which older
 *  Safari and TV browsers lack. */
export async function createRoomCode(timeoutMs = 4000): Promise<string> {
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${WORKER_ORIGIN}/api/room`, { method: "POST", signal: ctl.signal });
    if (!res.ok) throw new Error(`room create failed: ${res.status}`);
    const body = (await res.json()) as { code: string };
    return body.code;
  } finally {
    window.clearTimeout(timer);
  }
}

/** The query parameters a join carries beyond role and device id: the keys it
 *  holds, and `frames` for a controller (a phone that wants the live frames
 *  for its own preview, and is otherwise hidden from the room). */
function joinQuery(role: RoomRole, auth: RoomAuth | undefined): Record<string, string> {
  const q: Record<string, string> = {};
  if (role === "host" && auth?.hostKey) q.hk = auth.hostKey;
  if (auth?.roomKey) q.k = auth.roomKey;
  if (role === "controller") q.frames = "1";
  return q;
}

abstract class RoomConnectionBase {
  readonly deviceId = readDeviceId();
  protected ws: WebSocket | null = null;
  protected clock: ClockSync;
  protected buffer = new JitterBuffer();
  private delaySlew = new SlewLimiter(DELAY_SLEW_RATE);
  private _connected = false;
  private _state: ConnState = "connecting";
  private lastFrameAt = 0;
  private roster: RosterEntry[] = [];
  private rosterListeners: Array<(r: RosterEntry[]) => void> = [];
  private commandListeners: Array<(c: DeviceCommand) => void> = [];
  private stateListeners: Array<(s: ConnState) => void> = [];
  private lookListeners: Array<(m: LookServerMsg) => void> = [];
  // Announcing a device is a "last write wins" call made right at startup,
  // often before the handshake finishes (e.g. while detectQuality()'s
  // benchmark is still running) — keep it and send it on every open, rather
  // than silently dropping it, or the device would never appear in anyone's
  // roster. Kept after sending too: a reconnect is a new socket the room has
  // never heard from, so it needs the same hello again.
  private lastHello: { scene: string; palette: string; viewport?: Viewport } | null = null;

  private readonly code: string;
  private readonly role: RoomRole;
  private readonly query: Record<string, string>;
  private readonly reconnect: boolean;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;
  // When the oldest ping with no reply since was sent, 0 when none is
  // outstanding; any message from the room clears it (reconnect.ts isSilent).
  private unansweredSince = 0;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private probeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(code: string, role: RoomRole, opts: ConnOptions = {}) {
    this.code = code;
    this.role = role;
    this.query = joinQuery(role, opts.auth);
    this.reconnect = opts.reconnect === true;
    this.clock = new ClockSync((t0) => {
      this.sendPing(t0);
    });
    if (this.reconnect) {
      document.addEventListener("visibilitychange", this.onVisibility);
      window.addEventListener("pageshow", this.onWake);
      window.addEventListener("online", this.onWake);
    }
    this.connect();
  }

  get connected(): boolean {
    return this._connected;
  }

  get state(): ConnState {
    return this._state;
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

  /** Fires on every connection state change; `denied` is the last one. Does
   *  not fire for the current state when you subscribe — read `state`. */
  onState(cb: (s: ConnState) => void): () => void {
    this.stateListeners.push(cb);
    return () => {
      this.stateListeners = this.stateListeners.filter((f) => f !== cb);
    };
  }

  /** The room's look messages: the snapshot, other controllers' patches, and
   *  the replies to this device's own (src/net/lookSync.ts consumes them). */
  onLook(cb: (m: LookServerMsg) => void): () => void {
    this.lookListeners.push(cb);
    return () => {
      this.lookListeners = this.lookListeners.filter((f) => f !== cb);
    };
  }

  /** Announce (or update) this device's own scene/palette(+viewport) so the roster stays current.
   *  `viewport` is optional — omit it to leave the room's idea of this device's slice untouched. */
  sendHello(scene: string, palette: string, viewport?: Viewport): void {
    // A later hello that omits the viewport must not forget an earlier one
    // when it is replayed to a fresh socket.
    this.lastHello = { scene, palette, viewport: viewport ?? this.lastHello?.viewport };
    this.sendRaw(JSON.stringify({ type: "hello", scene, palette, viewport }));
  }

  /** Ask another device (by id, from the roster) to change its scene/palette. */
  sendSetDevice(targetId: string, cmd: DeviceCommand): void {
    this.sendRaw(JSON.stringify({ type: "setDevice", targetId, ...cmd }));
  }

  /** Send a look message. False when the socket is not open, so the caller
   *  can tell a message that went out from one that must be tried again. */
  sendLook(msg: LookClientMsg): boolean {
    return this.sendRaw(JSON.stringify(msg));
  }

  /** Ask the room for the current look; it answers with a `look` message. */
  requestLook(): void {
    this.sendLook({ type: "lookGet" });
  }

  close(): void {
    this.closedByUser = true;
    this.cancelRetry();
    this.stopLiveness();
    if (this.reconnect) {
      document.removeEventListener("visibilitychange", this.onVisibility);
      window.removeEventListener("pageshow", this.onWake);
      window.removeEventListener("online", this.onWake);
    }
    this.clock.stop();
    this._connected = false;
    this.ws?.close();
    this.setState("closed");
  }

  /** A clock-sync ping. False when it did not go out; otherwise it starts the
   *  silence count if none is running. */
  private sendPing(t0: number): boolean {
    if (!this.sendRaw(JSON.stringify({ type: "ping", t0 }))) return false;
    if (this.unansweredSince === 0) this.unansweredSince = Date.now();
    return true;
  }

  /** False rather than a throw when the socket is not open: every send here
   *  is fire-and-forget, and a dropped one is the caller's to resend. */
  protected sendRaw(data: string | ArrayBuffer): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(data);
      return true;
    } catch {
      return false;
    }
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
    } else if (msg.type === "ended") {
      this.roomEnded();
    } else {
      for (const cb of this.lookListeners) cb(msg);
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

  private setState(s: ConnState): void {
    if (this._state === s || this._state === "denied") return;
    this._state = s;
    for (const cb of this.stateListeners) cb(s);
  }

  /** Opens a socket. Every handler ignores a socket that is no longer
   *  `this.ws`, so a late event from one we gave up on (an immediate retry
   *  while the old one was still closing) cannot flip the state of its
   *  replacement. */
  private connect(): void {
    if (this.closedByUser || this._state === "denied") return;
    this.setState("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(roomWsUrl(this.code, this.role, this.deviceId, this.query));
    } catch (e) {
      if (!this.reconnect) throw e;
      this.setState("closed");
      this.scheduleRetry();
      return;
    }
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.addEventListener("open", () => {
      if (this.ws !== ws) return;
      this._connected = true;
      this.attempt = 0;
      this.unansweredSince = 0;
      // start() does not clear the previous burst's timers, so stop first.
      this.clock.stop();
      this.clock.start();
      if (this.reconnect) this.startWatchdog();
      if (this.lastHello) this.sendRaw(JSON.stringify({ type: "hello", ...this.lastHello }));
      this.setState("open");
    });
    ws.addEventListener("close", (e: CloseEvent) => {
      if (this.ws !== ws) return;
      this.socketGone(e.code);
    });
    ws.addEventListener("message", (e: MessageEvent) => {
      if (this.ws !== ws) return;
      this.unansweredSince = 0;
      this.onMessage(e.data);
    });
  }

  /** The current socket is over, by its own close or because we gave up on it. */
  private socketGone(code: number): void {
    this._connected = false;
    this.stopLiveness();
    this.clock.stop();
    if (isTerminalClose(code)) {
      this.setState("denied");
      return;
    }
    this.setState("closed");
    this.scheduleRetry();
  }

  /** The room has ended (roomMessages.ts `ended`): a denial, taken now rather
   *  than from the close that follows, which may never finish arriving. The
   *  socket is let go of first, like a recycled one, so its late close is
   *  ignored. */
  private roomEnded(): void {
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close();
    } catch {
      // Already going down.
    }
    this.socketGone(ROOM_CLOSE_DENIED);
  }

  /** Gives up on an open socket that has stopped answering. A socket whose path
   *  is dead may take a long while to report its own close, so it is dropped
   *  from `this.ws` first and the close is handled here: whatever the old
   *  socket says later is ignored, like any other replaced one. */
  private recycle(): void {
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    try {
      ws.close();
    } catch {
      // Already going down; the retry below is what matters.
    }
    this.socketGone(1006);
  }

  /** Reconnecting connections only: a dead path leaves the socket OPEN, and
   *  nothing else would ever notice (reconnect.ts says why). */
  private startWatchdog(): void {
    this.stopLiveness();
    this.watchdogTimer = setInterval(() => {
      if (isSilent(this.unansweredSince, Date.now())) this.recycle();
    }, WATCHDOG_CHECK_MS);
  }

  private stopLiveness(): void {
    if (this.watchdogTimer !== null) clearInterval(this.watchdogTimer);
    this.watchdogTimer = null;
    if (this.probeTimer !== null) clearTimeout(this.probeTimer);
    this.probeTimer = null;
    this.unansweredSince = 0;
  }

  /** The page came back and the socket still reads open: ask it something now
   *  rather than waiting out the watchdog, and give up on it if nothing at all
   *  comes back in PROBE_TIMEOUT_MS. */
  private probe(): void {
    const ws = this.ws;
    if (!ws || this.probeTimer !== null) return;
    const sentAt = Date.now();
    if (!this.sendPing(sentAt)) return;
    this.probeTimer = setTimeout(() => {
      this.probeTimer = null;
      // Still unanswered since before the probe went out: nothing has arrived
      // in between (a message clears the count, a later ping only restarts it).
      if (this.ws === ws && this.unansweredSince !== 0 && this.unansweredSince <= sentAt) this.recycle();
    }, PROBE_TIMEOUT_MS);
  }

  private scheduleRetry(): void {
    if (!this.reconnect || this.closedByUser || this._state === "denied" || this.retryTimer !== null) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, reconnectDelayMs(this.attempt++));
  }

  private cancelRetry(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /** The page came back (unlocked, tab shown, network restored): skip the
   *  rest of the backoff when waiting to retry, or test an open socket that
   *  may have died while the page was away. An attempt already in flight is
   *  left alone. `attempt` is not reset, so a room that keeps refusing still
   *  backs off. */
  private readonly onWake = (): void => {
    if (this.closedByUser) return;
    if (this._state === "open") {
      this.probe();
      return;
    }
    if (this._state !== "closed") return;
    this.cancelRetry();
    this.connect();
  };

  private readonly onVisibility = (): void => {
    if (document.visibilityState === "visible") this.onWake();
  };
}

export class HostConnection extends RoomConnectionBase {
  private decimator = new WireDecimator(BROADCAST_INTERVAL_MS);

  constructor(code: string, opts?: ConnOptions) {
    super(code, "host", opts);
  }

  /** Alone in the room (roster is empty pre-hello, or just this device's own
   *  socket) -> render fresh, since there's nobody to desync from and no
   *  network hop in this device's own path. Once anyone else joins, fall
   *  back to the same delay everyone else uses. A phone controller doesn't
   *  count — the room leaves it off the roster already; skipping it here is
   *  a guard against an older or looser room listing one. */
  protected override targetDelayMs(): number {
    let devices = 0;
    for (const d of this.currentRoster) if (d.role !== "controller") devices++;
    return devices <= 1 ? 0 : RENDER_DELAY_MS;
  }

  /** Call every local render tick; internally decimates the wire send to ~30Hz
   *  while feeding the full-rate local buffer so this device's own visuals stay smooth. */
  sendFrame(frame: EncodableFrame): void {
    const roomTimeMs = this.clock.roomNow();
    this.pushFrame({ ...frame, roomTimeMs });

    const d = this.decimator.offer(roomTimeMs, frame.onset, frame.pulseOnset);
    if (!d.send) return;
    // The latches are cleared even if the socket isn't open, so a stale hit
    // isn't replayed on reconnect.
    this.sendRaw(encodeFeatureFrame({ ...frame, onset: d.onset, pulseOnset: d.pulseOnset }, roomTimeMs));
  }

  /** Ends a claimed room for everyone (roomMessages.ts `endRoom`); the room
   *  closes this socket as denied too. False when the socket isn't open, so
   *  nothing was sent. */
  endRoom(): boolean {
    return this.sendRaw(JSON.stringify({ type: "endRoom" }));
  }
}

export class RendererConnection extends RoomConnectionBase {
  /** `role` is ControllerConnection's hook; everything else passes (code, opts). */
  constructor(code: string, opts?: ConnOptions, role: "renderer" | "controller" = "renderer") {
    super(code, role, opts);
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

/** A phone that edits the room's look. It decodes frames like a renderer (it
 *  asks the room for them, for its own preview) but the room never lists it,
 *  so the host and the Room panel don't see a second screen. */
export class ControllerConnection extends RendererConnection {
  constructor(code: string, opts?: ConnOptions) {
    super(code, opts, "controller");
  }
}
