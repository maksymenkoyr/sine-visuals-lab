/**
 * The socket an unpaired TV holds while it shows its pairing QR.
 *
 * The slot is a throwaway room (`createRoomCode`, the same route a host uses)
 * that never gets claimed: the TV sits in it as a plain keyless renderer and
 * listens for exactly one thing, the `adopt` message the room relays when a
 * phone POSTs to the slot (src/net/adopt.ts is the phone's half,
 * server/worker.ts has the route). The slot's code is printed on the TV, so
 * anyone can sit in it too, and the adopt carries the room key: the TV joins
 * presenting the nonce its QR carries (the `adopt` query value), and the room
 * delivers an adopt only to sockets that presented the nonce it names
 * (server/roomRules.ts `adoptTag`). Whether the message is for this TV is still
 * the caller's check (src/tv.ts); this class only turns socket text into a
 * parsed AdoptMessage.
 *
 * Deliberately smaller than a room connection (room.ts): no clock sync and no
 * pings, because nothing here is timed and the slot carries no frames; text
 * only, so anything binary is ignored. It does redial after a drop, with the
 * same backoff as a room connection, since a TV left on its QR screen for an
 * evening will lose the socket at some point. An adopt that lands while it is
 * redialling is lost; the phone is told "no screen" and scans again.
 *
 * A terminal close (the slot code was claimed by someone else's laptop between
 * minting and joining) is reported through `onDenied` instead of retried: the
 * caller swaps in a fresh slot.
 */

import { roomWsUrl } from "./room.ts";
import { parseAdoptMessage, type AdoptMessage } from "./roomMessages.ts";
import { isTerminalClose, reconnectDelayMs } from "./reconnect.ts";

export class PendingSlot {
  private ws: WebSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private closed = false;

  constructor(
    private readonly code: string,
    private readonly deviceId: string,
    /** The nonce in the TV's QR; see the header. */
    private readonly nonce: string,
    private readonly onAdopt: (m: AdoptMessage) => void,
    private readonly onDenied?: () => void,
  ) {
    this.connect();
  }

  close(): void {
    this.closed = true;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close();
    } catch {
      // Already gone.
    }
  }

  private connect(): void {
    if (this.closed) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(roomWsUrl(this.code, "renderer", this.deviceId, { adopt: this.nonce }));
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    // Every handler ignores a socket that is no longer `this.ws`, so a late
    // event from one we closed cannot start a second retry loop.
    ws.addEventListener("open", () => {
      if (this.ws === ws) this.attempt = 0;
    });
    ws.addEventListener("message", (e: MessageEvent) => {
      if (this.ws !== ws || typeof e.data !== "string") return;
      const m = parseAdoptMessage(e.data);
      if (m) this.onAdopt(m);
    });
    ws.addEventListener("close", (e: CloseEvent) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (isTerminalClose(e.code)) {
        this.closed = true;
        this.onDenied?.();
        return;
      }
      this.scheduleRetry();
    });
  }

  private scheduleRetry(): void {
    if (this.closed || this.retryTimer !== null) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, reconnectDelayMs(this.attempt++));
  }
}
