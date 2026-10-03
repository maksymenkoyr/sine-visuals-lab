import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ROSTER_WAIT_MS,
  hasHost,
  hasNewRenderer,
  rendererIds,
  waitForRoster,
  type RosterFeed,
  type RosterWait,
} from "../src/net/screenJoin.ts";
import type { ConnState, RosterEntry } from "../src/net/room.ts";

const entry = (deviceId: string, role: RosterEntry["role"]): RosterEntry => ({
  deviceId,
  role,
  scene: "mesh",
  palette: "neon",
  viewport: { x: 0, y: 0, w: 1, h: 1 },
  kind: role === "renderer" ? "tv" : "laptop",
  name: role === "renderer" ? "TV" : "Laptop",
  hasMic: role !== "renderer",
  ears: role === "host" ? "own" : "follow",
  follow: null,
  screen: "main",
  online: true,
  owner: role === "host",
});
const HOST = entry("laptop", "host");
const TV1 = entry("tv-1", "renderer");
const TV2 = entry("tv-2", "renderer");

class FakeFeed implements RosterFeed {
  state: ConnState = "connecting";
  currentRoster: RosterEntry[] = [];
  private rosterCbs: Array<(r: RosterEntry[]) => void> = [];
  private stateCbs: Array<(s: ConnState) => void> = [];

  onRosterChange(cb: (r: RosterEntry[]) => void): () => void {
    this.rosterCbs.push(cb);
    return () => {
      this.rosterCbs = this.rosterCbs.filter((f) => f !== cb);
    };
  }
  onState(cb: (s: ConnState) => void): () => void {
    this.stateCbs.push(cb);
    return () => {
      this.stateCbs = this.stateCbs.filter((f) => f !== cb);
    };
  }
  open(): void {
    this.state = "open";
    for (const cb of this.stateCbs) cb("open");
  }
  deny(): void {
    this.state = "denied";
    for (const cb of this.stateCbs) cb("denied");
  }
  deliver(roster: RosterEntry[]): void {
    this.currentRoster = roster;
    for (const cb of this.rosterCbs) cb(roster);
  }
  listeners(): number {
    return this.rosterCbs.length + this.stateCbs.length;
  }
}

/** Starts a wait and keeps what it resolved to. */
function start(feed: FakeFeed, needHost: boolean): { result: () => RosterWait | null } {
  let got: RosterWait | null = null;
  void waitForRoster(feed, { needHost, timeoutMs: ROSTER_WAIT_MS }).then((r) => {
    got = r;
  });
  return { result: () => got };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("roster helpers", () => {
  it("hasHost looks for the laptop", () => {
    expect(hasHost([])).toBe(false);
    expect(hasHost([TV1])).toBe(false);
    expect(hasHost([TV1, HOST])).toBe(true);
  });

  it("rendererIds lists screens only", () => {
    expect(rendererIds([HOST, TV1, TV2])).toEqual(new Set(["tv-1", "tv-2"]));
  });

  it("hasNewRenderer ignores the screens that were known", () => {
    const known = rendererIds([HOST, TV1]);
    expect(hasNewRenderer([HOST, TV1], known)).toBe(false);
    expect(hasNewRenderer([HOST], known)).toBe(false);
    expect(hasNewRenderer([HOST, TV1, TV2], known)).toBe(true);
  });

  it("a baseline of nothing counts every screen as new (the bug the first roster avoids)", () => {
    expect(hasNewRenderer([HOST, TV1], rendererIds([]))).toBe(true);
  });
});

describe("waitForRoster without the laptop", () => {
  it("resolves with the first roster, whoever is in it", async () => {
    const feed = new FakeFeed();
    const w = start(feed, false);
    feed.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(w.result()).toBeNull();

    feed.deliver([TV1]);
    await vi.advanceTimersByTimeAsync(0);
    expect(w.result()).toEqual({ kind: "ready", roster: [TV1] });
  });

  it("an empty first roster counts: a room with nobody in it is a roster too", async () => {
    const feed = new FakeFeed();
    const w = start(feed, false);
    feed.deliver([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(w.result()).toEqual({ kind: "ready", roster: [] });
  });

  it("goes on without a roster once the wait is up", async () => {
    const feed = new FakeFeed();
    const w = start(feed, false);
    await vi.advanceTimersByTimeAsync(ROSTER_WAIT_MS - 1);
    expect(w.result()).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(w.result()).toEqual({ kind: "ready", roster: [] });
  });
});

describe("waitForRoster for the laptop", () => {
  it("ignores a roster without the laptop and resolves on the one with it", async () => {
    const feed = new FakeFeed();
    const w = start(feed, true);
    feed.open();
    feed.deliver([TV1]);
    await vi.advanceTimersByTimeAsync(0);
    expect(w.result()).toBeNull();

    feed.deliver([TV1, HOST]);
    await vi.advanceTimersByTimeAsync(0);
    expect(w.result()).toEqual({ kind: "ready", roster: [TV1, HOST] });
  });

  it("says no-host when the wait is up and the laptop never showed", async () => {
    const feed = new FakeFeed();
    const w = start(feed, true);
    feed.open();
    feed.deliver([TV1]);
    await vi.advanceTimersByTimeAsync(ROSTER_WAIT_MS);
    expect(w.result()).toEqual({ kind: "no-host" });
  });

  it("says no-host when no roster ever arrived", async () => {
    const feed = new FakeFeed();
    const w = start(feed, true);
    await vi.advanceTimersByTimeAsync(ROSTER_WAIT_MS);
    expect(w.result()).toEqual({ kind: "no-host" });
  });

  it("takes a roster that is already in hand on an open socket", async () => {
    const feed = new FakeFeed();
    feed.state = "open";
    feed.currentRoster = [HOST];
    const w = start(feed, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(w.result()).toEqual({ kind: "ready", roster: [HOST] });
  });

  it("does not take the roster a dropped connection left behind", async () => {
    const feed = new FakeFeed();
    feed.state = "closed";
    feed.currentRoster = [HOST];
    const w = start(feed, true);
    await vi.advanceTimersByTimeAsync(ROSTER_WAIT_MS);
    expect(w.result()).toEqual({ kind: "no-host" });
  });
});

describe("waitForRoster when the room refuses the phone", () => {
  it("resolves denied at once, with or without the laptop asked for", async () => {
    for (const needHost of [false, true]) {
      const feed = new FakeFeed();
      const w = start(feed, needHost);
      feed.deny();
      await vi.advanceTimersByTimeAsync(0);
      expect(w.result()).toEqual({ kind: "denied" });
    }
  });

  it("resolves denied if the socket was refused before the wait began", async () => {
    const feed = new FakeFeed();
    feed.state = "denied";
    const w = start(feed, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(w.result()).toEqual({ kind: "denied" });
  });
});

describe("waitForRoster cleanup", () => {
  it("lets go of the connection and the timer once it has answered", async () => {
    const feed = new FakeFeed();
    const w = start(feed, true);
    expect(feed.listeners()).toBeGreaterThan(0);
    feed.deliver([HOST]);
    await vi.advanceTimersByTimeAsync(0);
    expect(w.result()).toMatchObject({ kind: "ready" });
    expect(feed.listeners()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("answers once: a later roster or the timeout changes nothing", async () => {
    const feed = new FakeFeed();
    const w = start(feed, true);
    feed.deliver([HOST]);
    await vi.advanceTimersByTimeAsync(0);
    feed.deliver([HOST, TV1]);
    await vi.advanceTimersByTimeAsync(ROSTER_WAIT_MS * 2);
    expect(w.result()).toEqual({ kind: "ready", roster: [HOST] });
  });
});
