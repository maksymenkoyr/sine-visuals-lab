import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeFeatureFrame } from "../src/net/protocol.ts";
import { NUM_BANDS } from "../src/audio/types.ts";
import { PROBE_TIMEOUT_MS, RECONNECT_MAX_MS, SILENCE_LIMIT_MS } from "../src/net/reconnect.ts";

// src/net/room.ts reads `location` (config.ts), `window`, `document`, `WebSocket`
// and `localStorage` at import or construction, and the suite runs under
// environment: "node". So each test stubs just those, with a socket it can
// open, feed and drop by hand, and imports room.ts fresh afterwards.

class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeSocket[] = [];

  readyState = 0;
  binaryType = "blob";
  sent: Array<string | ArrayBuffer> = [];
  private handlers: Record<string, Array<(e: unknown) => void>> = {};

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, cb: (e: unknown) => void): void {
    (this.handlers[type] ??= []).push(cb);
  }

  send(data: string | ArrayBuffer): void {
    if (this.readyState !== FakeSocket.OPEN) throw new Error("send on a socket that is not open");
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    this.emit("close", { code: 1005 });
  }

  // --- test controls
  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.emit("open", {});
  }
  receive(data: string | ArrayBuffer): void {
    this.emit("message", { data });
  }
  drop(code = 1006): void {
    this.readyState = FakeSocket.CLOSED;
    this.emit("close", { code });
  }
  texts(): Array<Record<string, unknown>> {
    return this.sent.filter((d): d is string => typeof d === "string").map((d) => JSON.parse(d));
  }
  private emit(type: string, e: unknown): void {
    for (const cb of this.handlers[type] ?? []) cb(e);
  }
}

class FakeTarget {
  private handlers: Record<string, Array<() => void>> = {};
  visibilityState = "visible";
  addEventListener(type: string, cb: () => void): void {
    (this.handlers[type] ??= []).push(cb);
  }
  removeEventListener(type: string, cb: () => void): void {
    this.handlers[type] = (this.handlers[type] ?? []).filter((f) => f !== cb);
  }
  dispatch(type: string): void {
    for (const cb of this.handlers[type] ?? []) cb();
  }
  count(type: string): number {
    return (this.handlers[type] ?? []).length;
  }
}

function memoryStorage(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  };
}

let win: FakeTarget & { localStorage?: Storage };
let doc: FakeTarget;
let realStore: ReturnType<typeof memoryStorage>;

async function loadRoom() {
  return await import("../src/net/room.ts");
}

const KEY = "K".repeat(22);
const HOST_KEY = "H".repeat(22);

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  FakeSocket.instances = [];
  realStore = memoryStorage();
  win = Object.assign(new FakeTarget(), { localStorage: realStore as Storage });
  doc = new FakeTarget();
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("location", { hostname: "localhost", origin: "https://localhost:5173" });
  vi.stubGlobal("localStorage", realStore);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function last(): FakeSocket {
  return FakeSocket.instances[FakeSocket.instances.length - 1];
}

describe("join URL", () => {
  it("is the old URL for a connection with no options", async () => {
    const { RendererConnection } = await loadRoom();
    const conn = new RendererConnection("ABCD");
    expect(FakeSocket.instances).toHaveLength(1);
    expect(last().url).toBe(`wss://localhost:8787/api/room/ABCD/ws?role=renderer&deviceId=${conn.deviceId}`);
    expect(last().binaryType).toBe("arraybuffer");
  });

  it("carries both keys for a host and only the room key for a renderer", async () => {
    const { HostConnection, RendererConnection } = await loadRoom();
    new HostConnection("ABCD", { auth: { hostKey: HOST_KEY, roomKey: KEY } });
    expect(last().url).toContain(`role=host`);
    expect(last().url).toContain(`&hk=${HOST_KEY}&k=${KEY}`);
    new RendererConnection("ABCD", { auth: { hostKey: HOST_KEY, roomKey: KEY } });
    expect(last().url).toContain(`&k=${KEY}`);
    expect(last().url).not.toContain("hk=");
  });

  it("asks for nothing beyond the room key as a controller (no frames flag)", async () => {
    const { ControllerConnection } = await loadRoom();
    new ControllerConnection("ABCD", { auth: { roomKey: KEY } });
    expect(last().url).toContain("role=controller");
    expect(last().url.endsWith(`&k=${KEY}`)).toBe(true);
    expect(last().url).not.toContain("frames");
  });

  it("carries what the device says it is: kind, mic and name, after the keys", async () => {
    const { ControllerConnection } = await loadRoom();
    new ControllerConnection("ABCD", {
      auth: { roomKey: KEY },
      device: { kind: "tablet", hasMic: true, name: "Living room iPad" },
    });
    expect(last().url).toContain(`&k=${KEY}&kind=tablet&mic=1&name=Living%20room%20iPad`);
    expect(last().url).not.toContain("frames");
  });

  it("says mic=0 for a device without a microphone, and encodes the name", async () => {
    const { RendererConnection } = await loadRoom();
    new RendererConnection("ABCD", { device: { kind: "tv", hasMic: false, name: "TV & co" } });
    expect(last().url).toContain("&kind=tv&mic=0&name=TV%20%26%20co");
    expect(last().url).not.toContain("hk=");
  });

  it("a host with a device carries its keys and its device", async () => {
    const { HostConnection } = await loadRoom();
    new HostConnection("ABCD", {
      auth: { hostKey: HOST_KEY, roomKey: KEY },
      device: { kind: "laptop", hasMic: true, name: "Mac" },
    });
    expect(last().url).toContain(`role=host`);
    expect(last().url).toContain(`&hk=${HOST_KEY}&k=${KEY}&kind=laptop&mic=1&name=Mac`);
  });

  it("roomWsUrl appends extras after role and device id", async () => {
    const { roomWsUrl } = await loadRoom();
    expect(roomWsUrl("WXYZ", "renderer", "dev 1", { k: "a&b" })).toBe(
      "wss://localhost:8787/api/room/WXYZ/ws?role=renderer&deviceId=dev%201&k=a%26b",
    );
  });
});

describe("device id", () => {
  it("is minted once, stored in the real storage and reused", async () => {
    const { RendererConnection } = await loadRoom();
    const a = new RendererConnection("ABCD");
    expect(a.deviceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(realStore.data.get("vibe.deviceId")).toBe(a.deviceId);
    expect(new RendererConnection("ABCD").deviceId).toBe(a.deviceId);
  });

  it("is read from the real storage even when the global has been replaced", async () => {
    realStore.setItem("vibe.deviceId", "saved-device");
    const overlay = memoryStorage();
    vi.stubGlobal("localStorage", overlay);
    const { RendererConnection } = await loadRoom();
    expect(new RendererConnection("ABCD").deviceId).toBe("saved-device");
    expect(overlay.data.size).toBe(0);
  });

  it("still gets an id when storage throws", async () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    win.localStorage = broken as unknown as Storage;
    vi.stubGlobal("localStorage", broken);
    const { RendererConnection } = await loadRoom();
    expect(new RendererConnection("ABCD").deviceId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("a connection with no reconnect option", () => {
  it("stays down after a drop", async () => {
    const { RendererConnection } = await loadRoom();
    const conn = new RendererConnection("ABCD");
    const states: string[] = [];
    conn.onState((s) => states.push(s));
    last().open();
    expect(conn.connected).toBe(true);
    last().drop(1006);
    expect(conn.connected).toBe(false);
    vi.advanceTimersByTime(RECONNECT_MAX_MS * 3);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(states).toEqual(["open", "closed"]);
    expect(win.count("online")).toBe(0);
  });

  it("sends the hello it was given before the handshake finished, once open", async () => {
    const { RendererConnection } = await loadRoom();
    const conn = new RendererConnection("ABCD");
    conn.sendHello("mesh", "neon");
    expect(last().sent).toHaveLength(0);
    last().open();
    expect(last().texts()).toContainEqual({ type: "hello", scene: "mesh", palette: "neon" });
  });
});

describe("a reconnecting connection", () => {
  it("redials after a drop, backing off, and says so through onState", async () => {
    const { ControllerConnection } = await loadRoom();
    const conn = new ControllerConnection("ABCD", { auth: { roomKey: KEY }, reconnect: true });
    const states: string[] = [];
    conn.onState((s) => states.push(s));
    expect(conn.state).toBe("connecting");
    last().open();
    expect(conn.state).toBe("open");

    last().drop(1006);
    expect(conn.state).toBe("closed");
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(RECONNECT_MAX_MS * 1.3);
    expect(FakeSocket.instances).toHaveLength(2);
    expect(conn.state).toBe("connecting");
    expect(last().url).toBe(FakeSocket.instances[0].url);

    last().open();
    expect(conn.state).toBe("open");
    expect(states).toEqual(["open", "closed", "connecting", "open"]);
  });

  it("backs off further while the room keeps refusing to open, and starts over once open", async () => {
    const { RendererConnection } = await loadRoom();
    new RendererConnection("ABCD", { auth: { roomKey: KEY }, reconnect: true });
    last().drop(1006);
    const gaps: number[] = [];
    for (let i = 0; i < 4; i++) {
      const before = FakeSocket.instances.length;
      let waited = 0;
      while (FakeSocket.instances.length === before) {
        vi.advanceTimersByTime(50);
        waited += 50;
      }
      gaps.push(waited);
      if (i < 3) last().drop(1006);
    }
    // Each wait is about twice the one before, within jitter and the 50 ms step.
    expect(gaps[3]).toBeGreaterThan(gaps[0] * 2);
    last().open();
    last().drop(1006);
    const before = FakeSocket.instances.length;
    vi.advanceTimersByTime(gaps[0] * 1.5 + 100);
    expect(FakeSocket.instances.length).toBe(before + 1);
  });

  it("sends the last hello again on every new socket, keeping an earlier viewport", async () => {
    const { RendererConnection } = await loadRoom();
    const conn = new RendererConnection("ABCD", { reconnect: true });
    last().open();
    conn.sendHello("mesh", "neon", { x: 0.5, y: 0, w: 0.5, h: 1 });
    conn.sendHello("fluid", "ember");
    expect(last().texts().filter((m) => m.type === "hello")).toEqual([
      { type: "hello", scene: "mesh", palette: "neon", viewport: { x: 0.5, y: 0, w: 0.5, h: 1 } },
      { type: "hello", scene: "fluid", palette: "ember" },
    ]);

    last().drop();
    vi.advanceTimersByTime(RECONNECT_MAX_MS * 1.3);
    last().open();
    expect(last().texts().filter((m) => m.type === "hello")).toEqual([
      { type: "hello", scene: "fluid", palette: "ember", viewport: { x: 0.5, y: 0, w: 0.5, h: 1 } },
    ]);
  });

  it("restarts clock sync on each open without stacking pings", async () => {
    const { RendererConnection } = await loadRoom();
    new RendererConnection("ABCD", { reconnect: true });
    last().open();
    vi.advanceTimersByTime(1000);
    const pings = (s: FakeSocket) => s.texts().filter((m) => m.type === "ping").length;
    expect(pings(FakeSocket.instances[0])).toBeGreaterThanOrEqual(5);

    last().drop();
    vi.advanceTimersByTime(RECONNECT_MAX_MS * 1.3);
    last().open();
    vi.advanceTimersByTime(1000);
    // A burst of the same size as the first socket got, not a doubled one.
    expect(pings(last())).toBe(pings(FakeSocket.instances[0]));
  });

  it("goes to denied on the room's refusal and never dials again", async () => {
    const { ControllerConnection } = await loadRoom();
    const conn = new ControllerConnection("ABCD", { auth: { roomKey: KEY }, reconnect: true });
    const states: string[] = [];
    conn.onState((s) => states.push(s));
    last().open();
    last().drop(4003);
    expect(conn.state).toBe("denied");
    vi.advanceTimersByTime(RECONNECT_MAX_MS * 5);
    doc.dispatch("visibilitychange");
    win.dispatch("online");
    expect(FakeSocket.instances).toHaveLength(1);
    expect(states).toEqual(["open", "denied"]);
    conn.close();
    expect(conn.state).toBe("denied");
  });

  it("takes the room's `ended` as a denial at once, without waiting for the close", async () => {
    const { RendererConnection } = await loadRoom();
    const conn = new RendererConnection("ABCD", { auth: { roomKey: KEY }, reconnect: true });
    const states: string[] = [];
    conn.onState((s) => states.push(s));
    last().open();
    last().receive(JSON.stringify({ type: "ended" }));
    expect(conn.state).toBe("denied");
    expect(last().readyState).toBe(FakeSocket.CLOSED);
    vi.advanceTimersByTime(RECONNECT_MAX_MS * 5);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(states).toEqual(["open", "denied"]);
  });

  it("denied also surfaces on a connection without reconnect", async () => {
    const { RendererConnection } = await loadRoom();
    const conn = new RendererConnection("ABCD");
    last().drop(4003);
    expect(conn.state).toBe("denied");
  });

  it("skips the wait when the page comes back or the network returns, only if waiting", async () => {
    const { RendererConnection } = await loadRoom();
    const conn = new RendererConnection("ABCD", { reconnect: true });
    last().open();

    // Open: nothing to retry.
    doc.dispatch("visibilitychange");
    win.dispatch("pageshow");
    win.dispatch("online");
    expect(FakeSocket.instances).toHaveLength(1);

    last().drop();
    doc.visibilityState = "hidden";
    doc.dispatch("visibilitychange");
    expect(FakeSocket.instances).toHaveLength(1);
    doc.visibilityState = "visible";
    doc.dispatch("visibilitychange");
    expect(FakeSocket.instances).toHaveLength(2);
    expect(conn.state).toBe("connecting");

    // The second attempt is in flight: more events don't start a third.
    win.dispatch("online");
    win.dispatch("pageshow");
    expect(FakeSocket.instances).toHaveLength(2);

    // And the timer that was waiting was cancelled, not left to fire a third.
    vi.advanceTimersByTime(RECONNECT_MAX_MS * 2);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("ignores a late event from a socket it has already replaced", async () => {
    const { RendererConnection } = await loadRoom();
    const conn = new RendererConnection("ABCD", { reconnect: true });
    const first = last();
    first.open();
    first.drop();
    win.dispatch("online");
    expect(FakeSocket.instances).toHaveLength(2);
    expect(conn.state).toBe("connecting");

    first.drop(1006);
    first.receive(JSON.stringify({ type: "roster", devices: [{ deviceId: "x", role: "host" }] }));
    expect(conn.state).toBe("connecting");
    expect(conn.currentRoster).toEqual([]);
    vi.advanceTimersByTime(RECONNECT_MAX_MS * 2);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("close() stops everything: no redial, no page listeners", async () => {
    const { RendererConnection } = await loadRoom();
    const conn = new RendererConnection("ABCD", { reconnect: true });
    last().open();
    expect(doc.count("visibilitychange")).toBe(1);
    conn.close();
    expect(conn.state).toBe("closed");
    expect(conn.connected).toBe(false);
    expect(doc.count("visibilitychange")).toBe(0);
    expect(win.count("online")).toBe(0);
    expect(win.count("pageshow")).toBe(0);
    vi.advanceTimersByTime(RECONNECT_MAX_MS * 5);
    win.dispatch("online");
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("close() while waiting to retry cancels the retry", async () => {
    const { RendererConnection } = await loadRoom();
    const conn = new RendererConnection("ABCD", { reconnect: true });
    last().drop();
    conn.close();
    vi.advanceTimersByTime(RECONNECT_MAX_MS * 5);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("a socket that cannot even be created is retried, not thrown", async () => {
    const { RendererConnection } = await loadRoom();
    let fail = false;
    class Flaky extends FakeSocket {
      constructor(url: string) {
        if (fail) throw new Error("SecurityError");
        super(url);
      }
    }
    vi.stubGlobal("WebSocket", Flaky);
    const conn = new RendererConnection("ABCD", { reconnect: true });
    last().open();
    fail = true;
    last().drop();
    vi.advanceTimersByTime(RECONNECT_MAX_MS * 1.3);
    expect(conn.state).toBe("closed");
    fail = false;
    vi.advanceTimersByTime(RECONNECT_MAX_MS * 1.3);
    expect(conn.state).toBe("connecting");
  });
});

// A socket can read OPEN long after its path died (a Wi-Fi hand-off, a lost NAT
// mapping): nothing fires, so the connection has to notice that its pings
// stopped coming back.
describe("a reconnecting connection whose open socket goes silent", () => {
  const pings = (s: FakeSocket) => s.texts().filter((m) => m.type === "ping");

  /** Answers every ping the socket has sent that has not been answered yet. */
  function answerPings(s: FakeSocket, answered: { n: number }): void {
    const all = pings(s);
    for (; answered.n < all.length; answered.n++) {
      s.receive(JSON.stringify({ type: "pong", t0: all[answered.n].t0, tServer: Date.now() }));
    }
  }

  /** Runs time forward in small steps until `until` holds; returns how long that took. */
  function elapsedUntil(until: () => boolean, stepMs = 250, limitMs = SILENCE_LIMIT_MS * 3): number {
    let waited = 0;
    while (!until() && waited < limitMs) {
      vi.advanceTimersByTime(stepMs);
      waited += stepMs;
    }
    return waited;
  }

  it("gives up on pings that never come back and dials again", async () => {
    const { RendererConnection } = await loadRoom();
    const conn = new RendererConnection("ABCD", { auth: { roomKey: KEY }, reconnect: true });
    const first = last();
    first.open();
    const states: string[] = [];
    conn.onState((s) => states.push(s));

    const waited = elapsedUntil(() => conn.state !== "open");
    expect(conn.state).toBe("closed");
    expect(waited).toBeGreaterThanOrEqual(SILENCE_LIMIT_MS);
    expect(waited).toBeLessThan(SILENCE_LIMIT_MS + 2000);
    expect(conn.connected).toBe(false);
    expect(first.readyState).toBe(FakeSocket.CLOSED);

    vi.advanceTimersByTime(RECONNECT_MAX_MS * 1.3);
    expect(FakeSocket.instances).toHaveLength(2);
    last().open();
    expect(states).toEqual(["closed", "connecting", "open"]);
  });

  it("does not wait for the old socket to report its own close", async () => {
    const { RendererConnection } = await loadRoom();
    const conn = new RendererConnection("ABCD", { auth: { roomKey: KEY }, reconnect: true });
    const first = last();
    first.open();
    // A zombie that takes its time closing: close() is accepted but silent.
    first.close = () => {};
    elapsedUntil(() => conn.state !== "open");
    expect(conn.state).toBe("closed");
    vi.advanceTimersByTime(RECONNECT_MAX_MS * 1.3);
    expect(FakeSocket.instances).toHaveLength(2);
    last().open();

    // The old socket finally reports in: it must not take the new one down.
    first.drop(1006);
    expect(conn.state).toBe("open");
    vi.advanceTimersByTime(SILENCE_LIMIT_MS / 2);
    expect(conn.state).toBe("open");
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("keeps a socket that answers, however long it runs", async () => {
    const { ControllerConnection } = await loadRoom();
    const conn = new ControllerConnection("ABCD", { auth: { roomKey: KEY }, reconnect: true });
    last().open();
    const answered = { n: 0 };
    for (let t = 0; t < SILENCE_LIMIT_MS * 8; t += 250) {
      vi.advanceTimersByTime(250);
      answerPings(last(), answered);
    }
    expect(conn.state).toBe("open");
    expect(FakeSocket.instances).toHaveLength(1);
    expect(answered.n).toBeGreaterThan(10);
  });

  it("counts any message from the room as a sign of life, not only a pong", async () => {
    const { ControllerConnection } = await loadRoom();
    const conn = new ControllerConnection("ABCD", { auth: { roomKey: KEY }, reconnect: true });
    last().open();
    for (let t = 0; t < SILENCE_LIMIT_MS * 4; t += 250) {
      vi.advanceTimersByTime(250);
      if (t % 4000 === 0) last().receive(JSON.stringify({ type: "roster", devices: [] }));
    }
    expect(conn.state).toBe("open");
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("judges only the pings it sent: a socket nobody pinged is not silent", async () => {
    const { RendererConnection } = await loadRoom();
    const conn = new RendererConnection("ABCD", { auth: { roomKey: KEY }, reconnect: true });
    last().open();
    // Only a ping that went out starts the count; one that could not be sent
    // (or none at all, from a throttled background tab) leaves nothing to judge.
    last().send = () => {
      throw new Error("closing");
    };
    vi.advanceTimersByTime(SILENCE_LIMIT_MS * 3);
    expect(conn.state).toBe("open");
  });

  it("leaves a connection without the reconnect option alone", async () => {
    const { RendererConnection } = await loadRoom();
    const conn = new RendererConnection("ABCD");
    last().open();
    vi.advanceTimersByTime(SILENCE_LIMIT_MS * 10);
    expect(conn.state).toBe("open");
    expect(FakeSocket.instances).toHaveLength(1);
    expect(last().readyState).toBe(FakeSocket.OPEN);
  });

  it("tests an open socket when the page comes back, and recycles it if nothing answers", async () => {
    for (const wake of [() => win.dispatch("online"), () => win.dispatch("pageshow"), () => doc.dispatch("visibilitychange")]) {
      FakeSocket.instances = [];
      vi.resetModules();
      const { RendererConnection } = await loadRoom();
      const conn = new RendererConnection("ABCD", { auth: { roomKey: KEY }, reconnect: true });
      const answered = { n: 0 };
      last().open();
      vi.advanceTimersByTime(1000);
      answerPings(last(), answered);

      const before = pings(last()).length;
      wake();
      expect(pings(last()).length).toBe(before + 1);
      expect(conn.state).toBe("open");
      vi.advanceTimersByTime(PROBE_TIMEOUT_MS - 1);
      expect(conn.state).toBe("open");
      vi.advanceTimersByTime(2);
      expect(conn.state).toBe("closed");
      vi.advanceTimersByTime(RECONNECT_MAX_MS * 1.3);
      expect(FakeSocket.instances).toHaveLength(2);
      conn.close();
    }
  });

  it("keeps the socket when the probe is answered, and sends only one probe at a time", async () => {
    const { RendererConnection } = await loadRoom();
    const conn = new RendererConnection("ABCD", { auth: { roomKey: KEY }, reconnect: true });
    const answered = { n: 0 };
    last().open();
    vi.advanceTimersByTime(1000);
    answerPings(last(), answered);

    const before = pings(last()).length;
    win.dispatch("online");
    win.dispatch("pageshow");
    doc.dispatch("visibilitychange");
    expect(pings(last()).length).toBe(before + 1);
    answerPings(last(), answered);
    vi.advanceTimersByTime(PROBE_TIMEOUT_MS + 100);
    expect(conn.state).toBe("open");
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("does not probe on a page that was hidden rather than shown", async () => {
    const { RendererConnection } = await loadRoom();
    new RendererConnection("ABCD", { auth: { roomKey: KEY }, reconnect: true });
    last().open();
    vi.advanceTimersByTime(1000);
    const before = pings(last()).length;
    doc.visibilityState = "hidden";
    doc.dispatch("visibilitychange");
    expect(pings(last()).length).toBe(before);
  });

  it("leaves no timer running once the socket is gone or the connection closed", async () => {
    const { RendererConnection } = await loadRoom();
    const conn = new RendererConnection("ABCD", { auth: { roomKey: KEY }, reconnect: true });
    last().open();
    win.dispatch("online");
    last().drop();
    // Only the retry is left: neither the watchdog, the probe nor the clock sync.
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(RECONNECT_MAX_MS * 1.3);
    last().open();
    win.dispatch("online");
    conn.close();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("messages", () => {
  it("routes look messages to onLook and keeps the rest on their own listeners", async () => {
    const { ControllerConnection } = await loadRoom();
    const conn = new ControllerConnection("ABCD", { reconnect: true });
    last().open();
    const looks: unknown[] = [];
    const rosters: unknown[] = [];
    const rejects: unknown[] = [];
    const off = conn.onLook((m) => looks.push(m));
    conn.onRosterChange((r) => rosters.push(r));
    conn.onDeviceReject((m) => rejects.push(m));

    last().receive(JSON.stringify({ type: "look", rev: 0, doc: null }));
    last().receive(JSON.stringify({ type: "lookPatch", rev: 1, scene: "mesh" }));
    last().receive(JSON.stringify({ type: "lookAck", n: 1, rev: 1 }));
    last().receive(JSON.stringify({ type: "lookReject", n: 2, reason: "size" }));
    last().receive(JSON.stringify({ type: "roster", devices: [] }));
    last().receive(JSON.stringify({ type: "deviceReject", targetId: "d1", reason: "no-mic" }));
    // The old command message is gone: nobody is told to change by it any more.
    last().receive(JSON.stringify({ type: "command", scene: "fluid" }));
    expect(looks).toEqual([
      { type: "look", rev: 0, doc: null },
      { type: "lookPatch", rev: 1, scene: "mesh" },
      { type: "lookAck", n: 1, rev: 1 },
      { type: "lookReject", n: 2, reason: "size" },
    ]);
    expect(rosters).toEqual([[]]);
    expect(rejects).toEqual([{ type: "deviceReject", targetId: "d1", reason: "no-mic" }]);

    off();
    last().receive(JSON.stringify({ type: "look", rev: 1, doc: null }));
    expect(looks).toHaveLength(4);
  });

  it("ignores garbage, an invalid look and a message that is not for it", async () => {
    const { ControllerConnection } = await loadRoom();
    const conn = new ControllerConnection("ABCD");
    last().open();
    const looks: unknown[] = [];
    conn.onLook((m) => looks.push(m));
    last().receive("not json");
    last().receive(JSON.stringify({ type: "look", rev: "x", doc: null }));
    last().receive(JSON.stringify({ type: "lookPatch", rev: 1, set: { "svl.tvSession": "x" } }));
    last().receive(JSON.stringify({ type: "adopt", room: "ABCD", k: KEY, n: KEY }));
    expect(looks).toEqual([]);
  });

  it("sendLook reports whether the message actually went out", async () => {
    const { ControllerConnection } = await loadRoom();
    const conn = new ControllerConnection("ABCD", { reconnect: true });
    expect(conn.sendLook({ type: "lookPatch", n: 1, scene: "mesh" })).toBe(false);
    last().open();
    expect(conn.sendLook({ type: "lookPatch", n: 1, scene: "mesh" })).toBe(true);
    conn.requestLook();
    expect(last().texts()).toContainEqual({ type: "lookPatch", n: 1, scene: "mesh" });
    expect(last().texts()).toContainEqual({ type: "lookGet" });
    last().drop();
    expect(conn.sendLook({ type: "lookGet" })).toBe(false);
  });

  it("sendLook is false rather than a throw when the socket dies under it", async () => {
    const { ControllerConnection } = await loadRoom();
    const conn = new ControllerConnection("ABCD");
    last().open();
    last().send = () => {
      throw new Error("closing");
    };
    expect(conn.sendLook({ type: "lookGet" })).toBe(false);
  });

  it("a controller decodes binary frames like a renderer", async () => {
    const { ControllerConnection } = await loadRoom();
    const conn = new ControllerConnection("ABCD");
    last().open();
    expect(conn.msSinceLastFrame).toBe(Infinity);
    const frame = {
      bands: new Float32Array(NUM_BANDS).fill(0.5),
      energy: 0.4,
      onset: false,
      pulseOnset: false,
      bpm: 120,
      onsetPhase: 0,
      level: 0.3,
    };
    last().receive(encodeFeatureFrame(frame, Date.now()));
    expect(conn.msSinceLastFrame).toBeLessThan(1000);
  });
});

const FRAME = {
  bands: new Float32Array(NUM_BANDS),
  energy: 0,
  onset: false,
  pulseOnset: false,
  bpm: 0,
  onsetPhase: 0,
  level: 0,
};

function binaries(sock: FakeSocket): ArrayBuffer[] {
  return sock.sent.filter((d): d is ArrayBuffer => typeof d !== "string");
}

/** A roster entry as a claimed room sends it. */
function member(deviceId: string, over: Record<string, unknown> = {}) {
  return {
    deviceId,
    role: "controller",
    scene: "",
    palette: "",
    viewport: { x: 0, y: 0, w: 1, h: 1 },
    kind: "phone",
    name: "Phone",
    hasMic: true,
    ears: "follow",
    follow: null,
    screen: "off",
    online: true,
    owner: false,
    ...over,
  };
}

function roster(sock: FakeSocket, devices: unknown[]): void {
  sock.receive(JSON.stringify({ type: "roster", devices }));
}

describe("render delay", () => {
  it("a host alone, or with only a legacy-listed controller, targets 0; with a TV it waits", async () => {
    const { HostConnection, RENDER_DELAY_MS } = await loadRoom();
    class Probe extends HostConnection {
      delay(): number {
        return this.targetDelayMs();
      }
    }
    const host = new Probe("ABCD", { auth: { hostKey: HOST_KEY, roomKey: KEY } });
    last().open();
    expect(host.delay()).toBe(0);
    // A legacy room: old-shape entries, none of them this device.
    const old = (deviceId: string, role: string) => ({ deviceId, role, scene: "", palette: "" });
    roster(last(), [old("someone", "host")]);
    expect(host.delay()).toBe(0);
    roster(last(), [old("someone", "host"), old("phone", "controller")]);
    expect(host.delay()).toBe(0);
    roster(last(), [old("someone", "host"), old("tv", "renderer")]);
    expect(host.delay()).toBe(RENDER_DELAY_MS);
  });

  it("a legacy room's defaulted roster does not switch a host to the records' rule", async () => {
    const { HostConnection, RENDER_DELAY_MS } = await loadRoom();
    class Probe extends HostConnection {
      delay(): number {
        return this.targetDelayMs();
      }
    }
    const host = new Probe("ABCD");
    last().open();
    roster(last(), [{ deviceId: host.deviceId, role: "host", scene: "", palette: "" }]);
    expect(host.delay()).toBe(0);
    roster(last(), [
      { deviceId: host.deviceId, role: "host", scene: "", palette: "" },
      { deviceId: "tv", role: "renderer", scene: "", palette: "" },
    ]);
    expect(host.delay()).toBe(RENDER_DELAY_MS);
  });

  it("a renderer always waits the fixed delay until the roster lists it", async () => {
    const { RendererConnection, RENDER_DELAY_MS } = await loadRoom();
    class Probe extends RendererConnection {
      delay(): number {
        return this.targetDelayMs();
      }
    }
    const tv = new Probe("ABCD");
    expect(tv.delay()).toBe(RENDER_DELAY_MS);
    last().open();
    roster(last(), [{ deviceId: "h", role: "host", scene: "", palette: "" }]);
    expect(tv.delay()).toBe(RENDER_DELAY_MS);
  });

  it("follows the room's pictureDelayMs once the roster has a record for this device", async () => {
    const { HostConnection, RENDER_DELAY_MS } = await loadRoom();
    class Probe extends HostConnection {
      delay(): number {
        return this.targetDelayMs();
      }
    }
    const host = new Probe("ABCD", { auth: { hostKey: HOST_KEY, roomKey: KEY } });
    last().open();
    const me = host.deviceId;
    const mine = (over: Record<string, unknown> = {}) =>
      member(me, { role: "host", kind: "laptop", name: "Mac", ears: "own", screen: "main", owner: true, ...over });

    // Own input, nobody else: no wait.
    roster(last(), [mine()]);
    expect(host.delay()).toBe(0);
    // A phone following the laptop with no picture of its own: still no wait.
    roster(last(), [mine(), member("phone", { screen: "off" })]);
    expect(host.delay()).toBe(0);
    // A TV that shows Main and follows: the laptop waits as long as it does.
    roster(last(), [mine(), member("tv", { role: "renderer", kind: "tv", screen: "main" })]);
    expect(host.delay()).toBe(RENDER_DELAY_MS);
    // The same TV offline does not count.
    roster(last(), [mine(), member("tv", { role: "renderer", kind: "tv", screen: "main", online: false })]);
    expect(host.delay()).toBe(0);
    // This device's own screen off or own: no wait whatever the others do.
    roster(last(), [mine({ screen: "own" }), member("tv", { role: "renderer", kind: "tv", screen: "main" })]);
    expect(host.delay()).toBe(0);
    // Following a feed: the fixed delay.
    roster(last(), [member("a", { role: "host", ears: "own", screen: "main", owner: true }), mine({ role: "controller", ears: "follow", owner: false })]);
    expect(host.delay()).toBe(RENDER_DELAY_MS);
  });
});

describe("pictureDelayMs", () => {
  it("reports the delay the connection is heading for", async () => {
    const { HostConnection, ControllerConnection, RENDER_DELAY_MS } = await loadRoom();
    const host = new HostConnection("ABCD", { auth: { hostKey: HOST_KEY, roomKey: KEY } });
    last().open();
    expect(host.pictureDelayMs()).toBe(0);
    roster(last(), [
      member(host.deviceId, { role: "host", kind: "laptop", ears: "own", screen: "main", owner: true }),
      member("tv", { role: "renderer", kind: "tv", screen: "main" }),
    ]);
    expect(host.pictureDelayMs()).toBe(RENDER_DELAY_MS);
    const ctl = new ControllerConnection("ABCD", { auth: { roomKey: KEY } });
    last().open();
    expect(ctl.pictureDelayMs()).toBe(RENDER_DELAY_MS);
  });
});

describe("sendFrame", () => {
  it("is on the base: a controller and a renderer have it too", async () => {
    const { ControllerConnection, RendererConnection } = await loadRoom();
    const c = new ControllerConnection("ABCD");
    const r = new RendererConnection("ABCD");
    expect(typeof c.sendFrame).toBe("function");
    expect(typeof r.sendFrame).toBe("function");
  });

  it("goes out only when open, and always feeds the local buffer", async () => {
    const { HostConnection } = await loadRoom();
    const host = new HostConnection("ABCD");
    host.sendFrame(FRAME);
    expect(last().sent).toHaveLength(0);
    expect(host.msSinceLastFrame).toBeLessThan(1000);
    last().open();
    vi.advanceTimersByTime(100);
    host.sendFrame(FRAME);
    expect(binaries(last())).toHaveLength(1);
  });

  it("puts nothing on the wire in a claimed room until the roster shows a follower", async () => {
    const { HostConnection } = await loadRoom();
    const host = new HostConnection("ABCD", { auth: { hostKey: HOST_KEY, roomKey: KEY } });
    last().open();
    const me = host.deviceId;
    const mine = member(me, { role: "host", kind: "laptop", ears: "own", screen: "main", owner: true });

    roster(last(), [mine]);
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(40);
      host.sendFrame(FRAME);
    }
    expect(binaries(last())).toHaveLength(0);
    // The local buffer still got every frame.
    expect(host.msSinceLastFrame).toBeLessThan(1000);

    // An offline follower is still a follower in the records; an own-input device is not.
    roster(last(), [mine, member("phone", { ears: "own" })]);
    vi.advanceTimersByTime(40);
    host.sendFrame(FRAME);
    expect(binaries(last())).toHaveLength(0);

    roster(last(), [mine, member("tv", { role: "renderer", kind: "tv", screen: "main" })]);
    vi.advanceTimersByTime(40);
    host.sendFrame(FRAME);
    expect(binaries(last())).toHaveLength(1);

    // The follower goes away: quiet again.
    roster(last(), [mine]);
    vi.advanceTimersByTime(40);
    host.sendFrame(FRAME);
    expect(binaries(last())).toHaveLength(1);
  });

  it("a member that is a feed (own input) sends to its followers, whatever its role", async () => {
    const { ControllerConnection } = await loadRoom();
    const ipad = new ControllerConnection("ABCD", { auth: { roomKey: KEY } });
    last().open();
    const me = ipad.deviceId;
    roster(last(), [
      member("laptop", { role: "host", kind: "laptop", ears: "own", screen: "main", owner: true }),
      member(me, { kind: "tablet", ears: "own", screen: "main" }),
      member("tv", { role: "renderer", kind: "tv", ears: "follow", follow: me, screen: "main" }),
    ]);
    vi.advanceTimersByTime(40);
    ipad.sendFrame(FRAME);
    expect(binaries(last())).toHaveLength(1);
  });

  it("sends as it always did when the roster has no record of this device (legacy room)", async () => {
    const { HostConnection } = await loadRoom();
    const host = new HostConnection("ABCD");
    last().open();
    roster(last(), [{ deviceId: "other", role: "renderer", scene: "", palette: "" }]);
    vi.advanceTimersByTime(40);
    host.sendFrame(FRAME);
    expect(binaries(last())).toHaveLength(1);
  });

  it("sends in a legacy room even when its roster lists this device (defaults are not records)", async () => {
    const { HostConnection } = await loadRoom();
    const host = new HostConnection("ABCD");
    last().open();
    roster(last(), [
      { deviceId: "first", role: "host", scene: "", palette: "" },
      { deviceId: host.deviceId, role: "host", scene: "", palette: "" },
    ]);
    vi.advanceTimersByTime(40);
    host.sendFrame(FRAME);
    expect(binaries(last())).toHaveLength(1);
  });

  it("keeps the latch: a hit seen while nobody follows is not replayed when a follower arrives", async () => {
    const { HostConnection } = await loadRoom();
    const host = new HostConnection("ABCD", { auth: { hostKey: HOST_KEY, roomKey: KEY } });
    last().open();
    const mine = member(host.deviceId, { role: "host", kind: "laptop", ears: "own", screen: "main", owner: true });
    roster(last(), [mine]);
    vi.advanceTimersByTime(40);
    host.sendFrame({ ...FRAME, onset: true });
    expect(binaries(last())).toHaveLength(0);

    roster(last(), [mine, member("tv", { role: "renderer", kind: "tv", screen: "main" })]);
    vi.advanceTimersByTime(40);
    host.sendFrame(FRAME);
    const sent = binaries(last());
    expect(sent).toHaveLength(1);
    const { decodeFeatureFrame } = await import("../src/net/protocol.ts");
    expect(decodeFeatureFrame(sent[0])?.onset).toBe(false);
  });

  it("latches a hit on a skipped tick and sends it with the next frame that goes out", async () => {
    const { HostConnection } = await loadRoom();
    const host = new HostConnection("ABCD");
    last().open();
    vi.advanceTimersByTime(100);
    host.sendFrame(FRAME);
    // 10 ms later is inside the wire interval: skipped, but its hit is latched.
    vi.advanceTimersByTime(10);
    host.sendFrame({ ...FRAME, onset: true });
    expect(binaries(last())).toHaveLength(1);
    vi.advanceTimersByTime(30);
    host.sendFrame(FRAME);
    const sent = binaries(last());
    expect(sent).toHaveLength(2);
    const { decodeFeatureFrame } = await import("../src/net/protocol.ts");
    expect(decodeFeatureFrame(sent[1])?.onset).toBe(true);
  });
});

describe("binary frames", () => {
  it("every role decodes them: host, renderer and controller", async () => {
    const { HostConnection, RendererConnection, ControllerConnection } = await loadRoom();
    for (const make of [() => new HostConnection("ABCD"), () => new RendererConnection("ABCD"), () => new ControllerConnection("ABCD")]) {
      const conn = make();
      last().open();
      expect(conn.msSinceLastFrame).toBe(Infinity);
      last().receive(encodeFeatureFrame({ ...FRAME, bands: new Float32Array(NUM_BANDS).fill(0.5), energy: 0.4, bpm: 120, level: 0.3 }, Date.now()));
      expect(conn.msSinceLastFrame).toBeLessThan(1000);
      conn.close();
    }
  });

  it("resetFrames forgets the buffered frames and starts the wire pacing over", async () => {
    const { HostConnection } = await loadRoom();
    const host = new HostConnection("ABCD");
    last().open();
    vi.advanceTimersByTime(100);
    host.sendFrame(FRAME);
    expect(binaries(last())).toHaveLength(1);
    expect(host.msSinceLastFrame).toBeLessThan(1000);
    expect(host.sample()).not.toBeNull();
    // Inside the wire interval the next frame would be held back...
    host.sendFrame(FRAME);
    expect(binaries(last())).toHaveLength(1);

    host.resetFrames();
    expect(host.msSinceLastFrame).toBe(Infinity);
    expect(host.sample()).toBeNull();
    // ...but a fresh pacer lets the first frame after a switch straight out.
    host.sendFrame(FRAME);
    expect(binaries(last())).toHaveLength(2);
    expect(host.msSinceLastFrame).toBeLessThan(1000);
  });

  it("drops incoming frames while the page listens to its own input", async () => {
    const { ControllerConnection } = await loadRoom();
    const conn = new ControllerConnection("ABCD");
    last().open();
    conn.setAcceptFrames(false);
    last().receive(encodeFeatureFrame({ ...FRAME, energy: 0.4 }, Date.now()));
    expect(conn.msSinceLastFrame).toBe(Infinity);
    expect(conn.sample()).toBeNull();
    conn.setAcceptFrames(true);
    last().receive(encodeFeatureFrame({ ...FRAME, energy: 0.4 }, Date.now()));
    expect(conn.msSinceLastFrame).toBeLessThan(1000);
  });

  it("ignores a binary message that is not a frame", async () => {
    const { RendererConnection } = await loadRoom();
    const conn = new RendererConnection("ABCD");
    last().open();
    last().receive(new ArrayBuffer(3));
    expect(conn.msSinceLastFrame).toBe(Infinity);
  });
});

describe("device messages", () => {
  it("sendDeviceSet sends the patch as a deviceSet and reports whether it went out", async () => {
    const { ControllerConnection } = await loadRoom();
    const conn = new ControllerConnection("ABCD", { auth: { roomKey: KEY } });
    expect(conn.sendDeviceSet("tv-1", { name: "Stage TV" })).toBe(false);
    last().open();
    expect(conn.sendDeviceSet("tv-1", { name: "Stage TV" })).toBe(true);
    expect(conn.sendDeviceSet("tv-1", { ears: "follow", follow: null })).toBe(true);
    expect(conn.sendDeviceSet("tv-1", { screen: "own", follow: "d2" })).toBe(true);
    const sets = last().texts().filter((m) => m.type === "deviceSet");
    expect(sets).toEqual([
      { type: "deviceSet", targetId: "tv-1", name: "Stage TV" },
      { type: "deviceSet", targetId: "tv-1", ears: "follow", follow: null },
      { type: "deviceSet", targetId: "tv-1", screen: "own", follow: "d2" },
    ]);
  });

  it("forgetDevice sends a deviceForget and reports whether it went out", async () => {
    const { HostConnection } = await loadRoom();
    const host = new HostConnection("ABCD", { auth: { hostKey: HOST_KEY, roomKey: KEY } });
    expect(host.forgetDevice("phone-1")).toBe(false);
    last().open();
    expect(host.forgetDevice("phone-1")).toBe(true);
    expect(last().texts()).toContainEqual({ type: "deviceForget", targetId: "phone-1" });
    last().drop();
    expect(host.forgetDevice("phone-1")).toBe(false);
  });

  it("sendDeviceSet is false rather than a throw when the socket dies under it", async () => {
    const { ControllerConnection } = await loadRoom();
    const conn = new ControllerConnection("ABCD");
    last().open();
    last().send = () => {
      throw new Error("closing");
    };
    expect(conn.sendDeviceSet("x", { name: "y" })).toBe(false);
    expect(conn.forgetDevice("x")).toBe(false);
  });

  it("onDeviceReject delivers each refusal and stops after the unsubscribe", async () => {
    const { ControllerConnection } = await loadRoom();
    const conn = new ControllerConnection("ABCD");
    last().open();
    const seen: unknown[] = [];
    const off = conn.onDeviceReject((m) => seen.push(m));
    last().receive(JSON.stringify({ type: "deviceReject", targetId: "a", reason: "tv-off" }));
    last().receive(JSON.stringify({ type: "deviceReject", targetId: null, reason: "rate" }));
    last().receive(JSON.stringify({ type: "deviceReject", targetId: "a", reason: "bogus" }));
    expect(seen).toEqual([
      { type: "deviceReject", targetId: "a", reason: "tv-off" },
      { type: "deviceReject", targetId: null, reason: "rate" },
    ]);
    off();
    last().receive(JSON.stringify({ type: "deviceReject", targetId: "a", reason: "rate" }));
    expect(seen).toHaveLength(2);
  });

  it("self is this device's own roster entry, null until the room lists it", async () => {
    const { ControllerConnection } = await loadRoom();
    const conn = new ControllerConnection("ABCD");
    last().open();
    expect(conn.self).toBeNull();
    roster(last(), [member("someone"), member(conn.deviceId, { name: "Kitchen iPad", kind: "tablet" })]);
    expect(conn.self).toMatchObject({ deviceId: conn.deviceId, name: "Kitchen iPad", kind: "tablet" });
    roster(last(), [member("someone")]);
    expect(conn.self).toBeNull();
  });
});

describe("endedReason", () => {
  it("is null until the room says otherwise", async () => {
    const { ControllerConnection } = await loadRoom();
    const conn = new ControllerConnection("ABCD", { auth: { roomKey: KEY }, reconnect: true });
    expect(conn.endedReason).toBeNull();
    last().open();
    expect(conn.endedReason).toBeNull();
  });

  it("is `removed` when the owner forgot this device, and the connection is denied at once", async () => {
    const { ControllerConnection } = await loadRoom();
    const conn = new ControllerConnection("ABCD", { auth: { roomKey: KEY }, reconnect: true });
    last().open();
    last().receive(JSON.stringify({ type: "ended", reason: "removed" }));
    expect(conn.endedReason).toBe("removed");
    expect(conn.state).toBe("denied");
    vi.advanceTimersByTime(RECONNECT_MAX_MS * 5);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("stays null when the whole room ended (a plain `ended`)", async () => {
    const { ControllerConnection } = await loadRoom();
    const conn = new ControllerConnection("ABCD", { auth: { roomKey: KEY }, reconnect: true });
    last().open();
    last().receive(JSON.stringify({ type: "ended" }));
    expect(conn.endedReason).toBeNull();
    expect(conn.state).toBe("denied");
  });

  it("is set before the state change reaches a listener", async () => {
    const { ControllerConnection } = await loadRoom();
    const conn = new ControllerConnection("ABCD", { auth: { roomKey: KEY }, reconnect: true });
    last().open();
    let atDenied: string | null | undefined;
    conn.onState((s) => {
      if (s === "denied") atDenied = conn.endedReason;
    });
    last().receive(JSON.stringify({ type: "ended", reason: "removed" }));
    expect(atDenied).toBe("removed");
  });
});

describe("RENDER_DELAY_MS", () => {
  it("is re-exported from the room's own rules, not redefined", async () => {
    const { RENDER_DELAY_MS } = await loadRoom();
    const rules = await import("../server/roomDevices.ts");
    expect(RENDER_DELAY_MS).toBe(rules.RENDER_DELAY_MS);
  });
});
