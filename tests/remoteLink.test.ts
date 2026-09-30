import { describe, it, expect } from "vitest";
import {
  applyOps,
  createModelSync,
  diffModel,
  isModelKey,
  toModel,
  MODEL_SCENE,
  type Model,
  type Op,
} from "../src/net/remoteSync.ts";
import { createHostLink, createRemoteLink, type LinkConn, type ModelPort, type OutputPanel } from "../src/net/remoteLink.ts";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("model diff / apply", () => {
  it("round-trips: applying diff(a, b) to a gives b", () => {
    const a: Model = { "vibe.x": { s1: { k: 1, j: 2 }, s2: { k: 3 } }, "vibe.y": "5", [MODEL_SCENE]: "caustics" };
    const b: Model = { "vibe.x": { s1: { k: 9, j: 2 }, s3: { k: 4 } }, "vibe.y": "6", [MODEL_SCENE]: "slats" };
    const c = clone(a);
    applyOps(c, diffModel(a, b));
    expect(c).toEqual(b);
  });

  it("sends only the changed leaf, not the store", () => {
    const a: Model = { "vibe.sceneSettings": { caustics: { a: 1, b: 2, c: 3 } } };
    const b: Model = { "vibe.sceneSettings": { caustics: { a: 1, b: 5, c: 3 } } };
    expect(diffModel(a, b)).toEqual([{ p: ["vibe.sceneSettings", "caustics", "b"], v: 5 }]);
  });

  it("merges edits to different leaves of the same store", () => {
    const base: Model = { "vibe.s": { a: 1, b: 1 } };
    const mine: Model = { "vibe.s": { a: 2, b: 1 } };
    const theirs: Op[] = [{ p: ["vibe.s", "b"], v: 7 }];
    const merged = clone(mine);
    applyOps(merged, theirs);
    expect(merged).toEqual({ "vibe.s": { a: 2, b: 7 } });
    expect(diffModel(base, mine)).toEqual([{ p: ["vibe.s", "a"], v: 2 }]);
  });

  it("refuses device-local, private and prototype-polluting paths", () => {
    expect(isModelKey("vibe.quality")).toBe(false);
    expect(isModelKey("vibe.silenceGateOpen")).toBe(false);
    expect(isModelKey("vibe.deviceId")).toBe(false);
    expect(isModelKey("vibe.sceneSettings")).toBe(true);
    expect(isModelKey(MODEL_SCENE)).toBe(true);
    const m: Model = {};
    applyOps(m, [
      { p: ["vibe.a", "__proto__", "polluted"], v: 1 },
      { p: ["vibe.quality"], v: "low" },
    ]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(m).toEqual({});
  });

  it("toModel parses object-shaped stores and leaves plain text alone", () => {
    const m = toModel({ "vibe.a": '{"x":{"y":1}}', "vibe.b": "1.4", "vibe.deviceId": "z", "vibe.c": "{broken" });
    expect(m).toEqual({ "vibe.a": { x: { y: 1 } }, "vibe.b": "1.4", "vibe.c": "{broken" });
  });

  it("ModelSync does not echo what it received", () => {
    const s = createModelSync();
    const cur: Model = { "vibe.s": { a: 1 } };
    expect(s.poll(cur)).toEqual([]); // first poll only records
    const incoming: Op[] = [{ p: ["vibe.s", "a"], v: 2 }];
    applyOps(cur, incoming);
    s.received(incoming);
    expect(s.poll(cur)).toEqual([]);
    cur["vibe.s"] = { a: 2, b: 3 };
    expect(s.poll(cur)).toEqual([{ p: ["vibe.s", "b"], v: 3 }]);
  });
});

// ---- Links over a fake room ---------------------------------------------

interface Sock {
  conn: FakeConn;
  role: "host" | "renderer";
}
class Hub {
  socks: Sock[] = [];
  down = new Set<FakeConn>();
  join(role: "host" | "renderer", id: string): FakeConn {
    const c = new FakeConn(this, role, id);
    this.socks.push({ conn: c, role });
    return c;
  }
  route(from: FakeConn, body: unknown, to?: string): void {
    const targets = this.socks.filter((s) =>
      to !== undefined ? s.conn.deviceId === to : s.role === (from.role === "host" ? "renderer" : "host"),
    );
    for (const t of targets) if (t.conn !== from && !this.down.has(t.conn)) t.conn.ctl.forEach((cb) => cb(clone(body), from.deviceId));
  }
  roster(): void {
    const r = this.socks.map((s) => ({ deviceId: s.conn.deviceId, role: s.role }));
    for (const s of this.socks) s.conn.rosterCbs.forEach((cb) => cb(r));
  }
}
class FakeConn implements LinkConn {
  ctl: Array<(b: unknown, f: string | undefined) => void> = [];
  opens: Array<() => void> = [];
  rosterCbs: Array<(r: Array<{ deviceId: string; role: string }>) => void> = [];
  connected = true;
  constructor(
    private hub: Hub,
    readonly role: "host" | "renderer",
    readonly deviceId: string,
  ) {}
  onCtl(cb: (b: unknown, f: string | undefined) => void): void {
    this.ctl.push(cb);
  }
  onOpen(cb: () => void): void {
    this.opens.push(cb);
  }
  onRosterChange(cb: (r: Array<{ deviceId: string; role: string }>) => void): void {
    this.rosterCbs.push(cb);
  }
  sendCtl(body: unknown, to?: string): boolean {
    if (!this.connected) return false;
    this.hub.route(this, body, to);
    return true;
  }
  open(): void {
    this.connected = true;
    this.opens.forEach((cb) => cb());
  }
}

function port(model: Model): ModelPort & { model: Model } {
  return {
    model,
    capture: () => clone(model),
    apply(ops) {
      applyOps(model, ops);
    },
    adopt(m) {
      for (const k of Object.keys(model)) delete model[k];
      Object.assign(model, clone(m));
    },
  };
}

function fakeOutput() {
  const calls: string[] = [];
  const listeners: Array<(s: { open: boolean; cue: boolean; differs: boolean }) => void> = [];
  const out: OutputPanel = {
    status: () => ({ open: true, cue: false, differs: false }),
    onStatus: (cb) => listeners.push(cb),
    setCue: (on) => void calls.push(`cue:${on}`),
    go: () => void calls.push("go"),
    open: () => undefined,
  };
  return { out, calls, listeners };
}

let clockMs = 1000;
const step = (...links: Array<{ tick(n: number): void }>): void => {
  clockMs += 200;
  for (const l of links) l.tick(clockMs);
};

function setup(armed = true) {
  const hub = new Hub();
  const hostConn = hub.join("host", "H");
  const remoteConn = hub.join("renderer", "R1");
  const hostModel: Model = { "vibe.sceneSettings": { caustics: { a: 1, b: 2 } }, [MODEL_SCENE]: "caustics" };
  const remoteModel: Model = { "vibe.sceneSettings": {}, [MODEL_SCENE]: "spectrum" };
  const hp = port(hostModel);
  const rp = port(remoteModel);
  const fo = fakeOutput();
  const state = { armed };
  const host = createHostLink({ conn: hostConn, port: hp, output: fo.out, isArmed: () => state.armed });
  const remote = createRemoteLink({ conn: remoteConn, port: rp });
  hub.roster();
  return { hub, hostConn, remoteConn, hostModel, remoteModel, host, remote, fo, state };
}

describe("host and remote links", () => {
  it("a joining remote adopts the host's model", () => {
    const t = setup();
    t.remoteConn.open();
    expect(t.remote.state()).toBe("linked");
    expect(t.remoteModel).toEqual(t.hostModel);
    expect(t.host.remotes()).toBe(1);
  });

  it("edits on either side reach the other, on different leaves both survive", () => {
    const t = setup();
    t.remoteConn.open();
    step(t.host, t.remote); // establish bases
    (t.remoteModel["vibe.sceneSettings"] as Record<string, Record<string, number>>).caustics.a = 10;
    t.remoteModel[MODEL_SCENE] = "slats";
    (t.hostModel["vibe.sceneSettings"] as Record<string, Record<string, number>>).caustics.b = 20;
    step(t.host, t.remote);
    step(t.host, t.remote);
    expect(t.hostModel[MODEL_SCENE]).toBe("slats");
    expect(t.hostModel["vibe.sceneSettings"]).toEqual({ caustics: { a: 10, b: 20 } });
    expect(t.remoteModel["vibe.sceneSettings"]).toEqual({ caustics: { a: 10, b: 20 } });
  });

  it("an unarmed host denies the join and ignores edits until armed", () => {
    const t = setup(false);
    t.remoteConn.open();
    expect(t.remote.state()).toBe("denied");
    t.remoteModel[MODEL_SCENE] = "slats";
    step(t.host, t.remote);
    expect(t.hostModel[MODEL_SCENE]).toBe("caustics");
    t.state.armed = true;
    clockMs += 4000; // past the join retry
    step(t.host, t.remote);
    expect(t.remote.state()).toBe("linked");
    expect(t.remoteModel[MODEL_SCENE]).toBe("caustics"); // host is the source of truth on join
  });

  it("edits made while the link was down are sent on reconnect", () => {
    const t = setup();
    t.remoteConn.open();
    step(t.host, t.remote);
    t.remoteConn.connected = false;
    (t.remoteModel["vibe.sceneSettings"] as Record<string, Record<string, number>>).caustics.a = 77;
    step(t.host, t.remote);
    expect(t.remote.state()).toBe("offline");
    expect((t.hostModel["vibe.sceneSettings"] as Record<string, Record<string, number>>).caustics.a).toBe(1);
    t.remoteConn.open(); // reconnect: join carries the offline edit, host replies with the merge
    expect((t.hostModel["vibe.sceneSettings"] as Record<string, Record<string, number>>).caustics.a).toBe(77);
    expect(t.remote.state()).toBe("linked");
  });

  it("a host that restarted relinks a remote from its first edit", () => {
    const t = setup();
    t.remoteConn.open();
    step(t.host, t.remote);
    // New host link, empty memory, same room.
    const fresh = createHostLink({ conn: t.hostConn, port: port(t.hostModel), output: t.fo.out, isArmed: () => true });
    t.hostConn.ctl.splice(0, 1); // the old link's listener goes away with the old page
    t.hostConn.open(); // announces hostup
    expect(t.remote.state()).toBe("linked");
    expect(fresh.remotes()).toBe(1);
  });

  it("Cue and Go from the remote drive the host's output; status comes back", () => {
    const t = setup();
    t.remoteConn.open();
    t.remote.output.setCue(true);
    t.remote.output.go();
    expect(t.fo.calls).toEqual(["cue:true", "go"]);
    t.fo.listeners.forEach((cb) => cb({ open: true, cue: true, differs: true }));
    expect(t.remote.output.status()).toEqual({ open: true, cue: true, differs: true });
  });

  it("relays one remote's edits to the other remote but not back to the sender", () => {
    const t = setup();
    const r2Conn = t.hub.join("renderer", "R2");
    const r2Model: Model = {};
    const r2 = createRemoteLink({ conn: r2Conn, port: port(r2Model) });
    t.hub.roster();
    t.remoteConn.open();
    r2Conn.open();
    step(t.host, t.remote, r2);
    t.remoteModel[MODEL_SCENE] = "slats";
    step(t.host, t.remote, r2);
    step(t.host, t.remote, r2);
    expect(r2Model[MODEL_SCENE]).toBe("slats");
    expect(t.hostModel[MODEL_SCENE]).toBe("slats");
  });
});
