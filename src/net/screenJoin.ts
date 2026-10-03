/**
 * What the phone knows about its room before it hands a TV over, and how it
 * tells that TV has arrived (the request itself is net/adopt.ts; the page's
 * words and flow are `adoptScreen` in src/app.ts).
 *
 * Both questions below need the room's roster, and the roster only exists once
 * the connection has delivered one (it opens empty, and the room sends it in
 * answer to the phone's hello):
 *
 * - **Is the room live?** A phone that scans a TV first uses the controller
 *   session it saved earlier, and a session never expires on its own, so the
 *   room may be an old one the laptop has since left. A TV adopted into such a
 *   room would sit on "waiting for laptop" while the phone reports success.
 *   `waitForRoster` with `needHost` answers it: the laptop is in the roster, or
 *   the phone says to scan the laptop and keeps the TV's request instead.
 * - **Who was here already?** "Screen joined" is shown when a renderer the
 *   phone has not seen appears, so the renderers that were there before the
 *   request are taken from the first roster the connection delivered, and the
 *   request goes out only after that roster, so a TV that answers quickly
 *   cannot be part of it. A baseline taken from the empty roster the
 *   connection starts with would count every screen already in the room.
 *
 * The connection is passed as a small interface, and the timer is the global
 * one, so this tests in node with fakes (tests/screenJoin.test.ts).
 */

import type { ConnState, RosterEntry } from "./room.ts";

/** How long the phone gives the room to answer its hello with a roster
 *  (and, when it needs the laptop, one that lists it). A socket opens and the
 *  hello is answered within a round trip or two; this is for a slow network. */
export const ROSTER_WAIT_MS = 5000;

export interface RosterFeed {
  readonly state: ConnState;
  readonly currentRoster: RosterEntry[];
  onRosterChange(cb: (roster: RosterEntry[]) => void): () => void;
  onState(cb: (state: ConnState) => void): () => void;
}

export type RosterWait =
  /** A roster arrived (one with the laptop in it, when that was asked). */
  | { kind: "ready"; roster: RosterEntry[] }
  /** The laptop was asked for and the wait ended without one in the room. */
  | { kind: "no-host" }
  /** The room refused this phone: it is gone, or the key is dead. */
  | { kind: "denied" };

export function hasHost(roster: RosterEntry[]): boolean {
  return roster.some((d) => d.role === "host" && d.online);
}

/** The renderers a roster lists as online, by device id. A claimed room also
 *  lists the screens that left (a TV keeps its record and its device id), and
 *  those must not count as already here: when one comes back it is the one
 *  that arrived. */
export function rendererIds(roster: RosterEntry[]): Set<string> {
  const ids = new Set<string>();
  for (const d of roster) if (d.role === "renderer" && d.online) ids.add(d.deviceId);
  return ids;
}

/** Whether the roster lists an online renderer that is not in `known`. */
export function hasNewRenderer(roster: RosterEntry[], known: ReadonlySet<string>): boolean {
  return roster.some((d) => d.role === "renderer" && d.online && !known.has(d.deviceId));
}

/** Resolves when the connection has delivered a roster (the first one, or the
 *  first that lists the laptop when `needHost`), or the room refuses it, or
 *  `timeoutMs` passes. Call it right after the connection is made, so that
 *  every roster seen is this connection's own. Without `needHost` a timeout
 *  still resolves `ready`, with whatever roster there is (none): the caller's
 *  request will then say what is wrong. */
export function waitForRoster(
  feed: RosterFeed,
  opts: { needHost: boolean; timeoutMs: number },
): Promise<RosterWait> {
  return new Promise<RosterWait>((resolve) => {
    let done = false;
    const stops: Array<() => void> = [];
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (result: RosterWait): void => {
      if (done) return;
      done = true;
      if (timer !== null) clearTimeout(timer);
      for (const stop of stops) stop();
      resolve(result);
    };
    const onRoster = (roster: RosterEntry[]): void => {
      if (!opts.needHost || hasHost(roster)) finish({ kind: "ready", roster });
    };

    if (feed.state === "denied") {
      finish({ kind: "denied" });
      return;
    }
    timer = setTimeout(
      () => finish(opts.needHost ? { kind: "no-host" } : { kind: "ready", roster: feed.currentRoster }),
      opts.timeoutMs,
    );
    stops.push(
      feed.onState((s) => {
        if (s === "denied") finish({ kind: "denied" });
      }),
    );
    stops.push(feed.onRosterChange(onRoster));
    // A roster already in hand counts only from an open socket: the one a
    // dropped connection left behind is not news.
    if (opts.needHost && feed.state === "open") onRoster(feed.currentRoster);
  });
}
