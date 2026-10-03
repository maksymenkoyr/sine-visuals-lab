/**
 * When a room connection tries again after a drop, and which drops are final.
 *
 * Phones lose their sockets constantly — a locked screen, a Wi-Fi hand-off, a
 * tunnel — so a connection that opted in (room.ts's ConnOptions.reconnect)
 * redials with exponential backoff. The backoff is jittered so a room full of
 * devices that all dropped at once (the router rebooted) does not come back in
 * one synchronized wave.
 *
 * Only one close is final: ROOM_CLOSE_DENIED (server/roomRules.ts), "your
 * credentials are dead". Retrying that would just hammer the room, and the
 * caller needs to hear it as a state of its own (clear the saved session, ask
 * for a fresh scan). Every other close — including a clean 1000 from a room
 * restarting — is a blink and is retried.
 *
 * The other half is noticing a drop the browser has not: a Wi-Fi hand-off or a
 * lost NAT mapping can leave a socket reading OPEN for minutes while nothing
 * crosses it. Clock sync (clock.ts) pings on a fixed rhythm and the room
 * answers each ping at once, so a ping that stays unanswered, with nothing else
 * arriving either, is how a connection tells a dead path from a quiet room.
 * room.ts arms that check only for a connection that reconnects, since closing
 * the zombie is only useful when something dials again.
 *
 * Pure so the schedule is testable with an injected random.
 */

import { ROOM_CLOSE_DENIED } from "../../server/roomRules.ts";

/** Delay before the first retry. */
export const RECONNECT_BASE_MS = 500;
/** The delay stops growing here; jitter is applied around it. */
export const RECONNECT_MAX_MS = 15_000;

/** How long a ping may go unanswered, with nothing else arriving, before an
 *  open socket is given up on. A few of clock sync's resync intervals, so one
 *  slow round trip never recycles a healthy socket. */
export const SILENCE_LIMIT_MS = 10_000;
/** How long the probe sent when the page comes back (unlocked, tab shown,
 *  network restored) waits for any reply before the socket is given up on. A
 *  hand-off during a lock is the commonest cause of a zombie, so this is much
 *  shorter than SILENCE_LIMIT_MS. */
export const PROBE_TIMEOUT_MS = 2000;

/** Fraction either side of the nominal delay that jitter may move it. */
const JITTER = 0.2;

/** Wait before retry number `attempt` (0 for the first retry after a drop):
 *  the nominal delay grows exponentially up to RECONNECT_MAX_MS, then `random`
 *  (in [0, 1)) spreads it either side by up to JITTER of itself. So the cap is
 *  the centre of the last band: a delay may land a little past it. */
export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const n = attempt > 0 ? Math.floor(attempt) : 0;
  const nominal = Math.min(RECONNECT_BASE_MS * Math.pow(2, n), RECONNECT_MAX_MS);
  return Math.round(nominal * (1 - JITTER + 2 * JITTER * random()));
}

/** Whether a WebSocket close code means "do not reconnect". */
export function isTerminalClose(code: number): boolean {
  return code === ROOM_CLOSE_DENIED;
}

/** Whether an open socket has been silent too long. `unansweredSince` is when
 *  the oldest ping with no reply since was sent, 0 when none is outstanding —
 *  so a connection that is not pinging, or whose timers a background tab has
 *  throttled, is never judged dead for pings it never sent. */
export function isSilent(unansweredSince: number, now: number, limitMs: number = SILENCE_LIMIT_MS): boolean {
  return unansweredSince !== 0 && now - unansweredSince >= limitMs;
}
