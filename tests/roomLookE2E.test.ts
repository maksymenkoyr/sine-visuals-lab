import { describe, expect, it } from "vitest";
import { RoomCore, type Attachment, type CoreHost, type CoreSocket } from "../server/roomCore.ts";
import { ROOM_CLOSE_DENIED, hashKey } from "../server/roomRules.ts";
import { LOOK_LIMITS, validLookId, type LookClientMsg, type LookDoc, type LookRejectReason } from "../server/lookDoc.ts";
import { createLookReplica, createLookSync, type LookSync } from "../src/net/lookSync.ts";
import { parseControlMessage, type ControlMessage } from "../src/net/roomMessages.ts";
import { applyRoomStorage, captureRoomStorage, registerSyncedStore } from "../src/net/syncedStores.ts";
import { listScenes } from "../src/render/scene.ts";
// Side-effect import: registers every built-in scene, so the id guard below
// sees the full set (the same arrangement as sceneKeys.test.ts).
import "../src/render/scenes/index.ts";
import { PALETTES } from "../src/render/palette.ts";

// The whole look path with no network and no DOM: phones publish through
// createLookSync, the room is the real RoomCore over fake sockets, and a TV
// follows through createLookReplica + applyRoomStorage into a Map-backed
// storage. Messages cross as JSON text both ways, so the client-side parse
// (parseControlMessage) and the room's own validation both run. The pieces are
// tested alone in lookSync / roomCore / syncedScope; this file is for what only
// shows when they are wired together.

const HK = "h".repeat(22);
const K = "k".repeat(22);
const OTHER_HK = "x".repeat(22);
const OTHER_K = "y".repeat(22);

/** The Storage subset the room-look functions use, over a Map. */
class MapStorage {
  private readonly items = new Map<string, string>();
  constructor(init: Record<string, string> = {}) {
    for (const k of Object.keys(init)) this.items.set(k, init[k]);
  }
  get length(): number {
    return this.items.size;
  }
  key(i: number): string | null {
    return Array.from(this.items.keys())[i] ?? null;
  }
  getItem(k: string): string | null {
    return this.items.has(k) ? (this.items.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.items.set(k, v);
  }
  removeItem(k: string): void {
    this.items.delete(k);
  }
  /** Everything stored, room keys or not. */
  all(): Record<string, string> {
    const out: Record<string, string> = {};
    this.items.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
}

/** What a hook-registered store would do on an apply: count it. */
let reloads = 0;
registerSyncedStore("vibe.e2e", () => {
  reloads++;
});

// ---- the room: the real core over sockets that just collect what they are sent ----

class WireSocket implements CoreSocket {
  inbox: Array<string | ArrayBuffer> = [];
  closedWith: { code: number; reason: string } | null = null;
  constructor(
    public attachment: Attachment,
    readonly tags: string[],
  ) {}
  send(data: string | ArrayBuffer): void {
    this.inbox.push(data);
  }
  close(code: number, reason: string): void {
    this.closedWith = { code, reason };
  }
  setAttachment(a: Attachment): void {
    this.attachment = a;
  }
}

interface Presented {
  role: string;
  deviceId?: string;
  frames?: boolean;
  k?: string;
  hk?: string;
}

class Server {
  live: WireSocket[] = [];
  readonly store = new Map<string, string>();
  readonly core: RoomCore;
  private sids = 0;

  constructor(stored: ReadonlyMap<string, string> = new Map()) {
    const host: CoreHost = {
      sockets: (tag) => this.live.filter((s) => tag === undefined || s.tags.includes(tag)),
      now: () => 1_000_000,
      setAlarm: () => undefined,
      deleteAlarm: () => undefined,
      put: (key, value) => void this.store.set(key, value),
      remove: (key) => void this.store.delete(key),
      removeAll: () => this.store.clear(),
    };
    this.core = new RoomCore(host, stored);
  }

  /** What server/room.ts does for an upgrade; null when the room denies it. */
  async connect(p: Presented): Promise<WireSocket | null> {
    const hashes = {
      k: p.k === undefined ? null : await hashKey(p.k),
      hk: p.hk === undefined ? null : await hashKey(p.hk),
    };
    const result = this.core.join(
      { role: p.role, deviceId: p.deviceId ?? null, frames: p.frames ?? false },
      hashes,
      `sid${++this.sids}`,
    );
    if (!result.ok) return null;
    const ws = new WireSocket(result.attachment, result.tags);
    this.live.push(ws);
    this.core.opened(ws);
    return ws;
  }

  async need(p: Presented): Promise<WireSocket> {
    const ws = await this.connect(p);
    if (!ws) throw new Error(`join was denied: ${JSON.stringify(p)}`);
    return ws;
  }

  say(ws: WireSocket, msg: unknown): void {
    this.core.message(ws, JSON.stringify(msg));
  }

  leave(ws: WireSocket): void {
    this.live = this.live.filter((s) => s !== ws);
    this.core.closed(ws);
  }

  /** The room's revision and document, asked the way a client asks: join as a
   *  controller and read the snapshot the room pushes. */
  async look(): Promise<{ rev: number; doc: LookDoc | null }> {
    const ws = await this.need({ role: "controller", deviceId: "probe", k: K });
    const first = parseControlMessage(ws.inbox[0] as string);
    this.leave(ws);
    if (!first || first.type !== "look") throw new Error("the room pushed no snapshot");
    return { rev: first.rev, doc: first.doc };
  }

  /** The laptop claiming the room. */
  claim(): Promise<WireSocket> {
    return this.need({ role: "host", deviceId: "laptop", hk: HK, k: K });
  }
}

// ---- devices ----

abstract class Endpoint {
  socket: WireSocket | null = null;
  /** Server-to-device message types to lose in transit, once each. */
  lose: string[] = [];
  /** Every message that reached the device, parsed. */
  log: ControlMessage[] = [];
  protected abstract readonly role: "controller" | "renderer";

  constructor(
    protected readonly server: Server,
    readonly deviceId: string,
  ) {}

  async join(k: string = K, frames = false): Promise<void> {
    this.socket = await this.server.need({ role: this.role, deviceId: this.deviceId, k, frames });
  }

  leave(): void {
    if (this.socket) this.server.leave(this.socket);
    this.socket = null;
    this.onLeave();
  }

  say(msg: unknown): void {
    if (this.socket) this.server.say(this.socket, msg);
  }

  /** Delivers what is waiting; returns how many messages were. */
  pump(): number {
    const ws = this.socket;
    if (!ws) return 0;
    let n = 0;
    while (ws.inbox.length > 0) {
      const raw = ws.inbox.shift() as string | ArrayBuffer;
      n++;
      if (typeof raw !== "string") continue;
      const m = parseControlMessage(raw);
      if (!m) continue;
      const lost = this.lose.indexOf(m.type);
      if (lost >= 0) {
        this.lose.splice(lost, 1);
        continue;
      }
      this.log.push(m);
      this.receive(m);
    }
    return n;
  }

  /** Messages of one type that reached the device. */
  count(type: string): number {
    return this.log.filter((m) => m.type === type).length;
  }

  /** Publishes anything pending; returns how many messages that sent. */
  tick(): number {
    return 0;
  }

  protected abstract receive(m: ControlMessage): void;
  protected onLeave(): void {}
}

class Phone extends Endpoint {
  protected readonly role = "controller" as const;
  readonly storage: MapStorage;
  scene: string;
  palette: string;
  readonly sync: LookSync;
  readonly sent: LookClientMsg[] = [];
  readonly rejects: LookRejectReason[] = [];
  /** While true a send reports success but the room never hears it. */
  blackhole = false;

  constructor(server: Server, deviceId: string, seed: Record<string, string>, scene = "", palette = "") {
    super(server, deviceId);
    this.storage = new MapStorage(seed);
    this.scene = scene;
    this.palette = palette;
    this.sync = createLookSync({
      read: () => ({ scene: this.scene, palette: this.palette, storage: captureRoomStorage(this.storage) }),
      write: (doc) => {
        applyRoomStorage(doc.storage, this.storage);
        if (doc.scene) this.scene = doc.scene;
        if (doc.palette) this.palette = doc.palette;
      },
      send: (m) => this.send(m),
      onReject: (r) => void this.rejects.push(r),
    });
  }

  private send(m: LookClientMsg): boolean {
    if (!this.socket) return false;
    this.sent.push(m);
    if (!this.blackhole) this.server.say(this.socket, m);
    return true;
  }

  set(key: string, value: string): void {
    this.storage.setItem(key, value);
  }

  unset(key: string): void {
    this.storage.removeItem(key);
  }

  room(): Record<string, string> {
    return captureRoomStorage(this.storage);
  }

  override tick(): number {
    const before = this.sent.length;
    this.sync.tick();
    return this.sent.length - before;
  }

  protected receive(m: ControlMessage): void {
    switch (m.type) {
      case "look":
        this.sync.onSnapshot(m.rev, m.doc);
        break;
      case "lookPatch":
        this.sync.onPatch(m.rev, m);
        break;
      case "lookAck":
        this.sync.onAck(m.n, m.rev);
        break;
      case "lookReject":
        this.sync.onReject(m.n, m.reason);
        break;
    }
  }

  protected override onLeave(): void {
    this.sync.onDisconnect();
  }
}

/** The TV as src/tv.ts runs it: a replica of the room's look, applied whole
 *  into a storage that also holds the device's own keys. */
class Tv extends Endpoint {
  protected readonly role = "renderer" as const;
  readonly storage = new MapStorage({ "vibe.deviceId": "tv-own-id", "vibe.quality": "low" });
  readonly replica = createLookReplica();
  scene = "";
  palette = "";
  lookGets = 0;

  room(): Record<string, string> {
    return captureRoomStorage(this.storage);
  }

  protected receive(m: ControlMessage): void {
    if (m.type === "look") {
      this.replica.onSnapshot(m.rev, m.doc);
      this.apply(this.replica.doc());
    } else if (m.type === "lookPatch") {
      const r = this.replica.onPatch(m.rev, m);
      if (r.status === "applied") this.apply(r.doc);
      else if (r.status === "gap") {
        this.lookGets++;
        this.say({ type: "lookGet" });
      }
    }
  }

  private apply(doc: LookDoc | null): void {
    applyRoomStorage(doc ? doc.storage : {}, this.storage);
    if (doc && doc.scene) this.scene = doc.scene;
    if (doc && doc.palette) this.palette = doc.palette;
  }
}

/** Delivers and publishes until nothing moves. */
function settle(...devices: Endpoint[]): void {
  for (let round = 0; round < 50; round++) {
    let moved = 0;
    for (const d of devices) moved += d.pump();
    for (const d of devices) moved += d.tick();
    for (const d of devices) moved += d.pump();
    if (moved === 0) return;
  }
  throw new Error("did not settle");
}

/** What a phone starts with: room-look stores, and keys that are the device's own. */
function seed(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "vibe.sceneSettings": '{"plume":{"scale":3}}',
    "vibe.sensitivity": '{"plume":1.5}',
    "vibe.drives": '{"plume":{"glow":"beat"}}',
    ...DEVICE_LOCAL,
    ...extra,
  };
}

/** Keys that must never leave the device they live on. */
const DEVICE_LOCAL: Record<string, string> = {
  "vibe.deviceId": "phone-own-id",
  "vibe.looks": '[{"name":"saved"}]',
  "vibe.panelFolds": '{"bands":true}',
  "vibe.output.quality": "high",
  "vibe.silenceGateLo": "0.2",
  "svl.controllerSession": '{"room":"ABCD"}',
};

async function roomWith(...phones: Array<[string, Record<string, string>, string, string]>): Promise<{ server: Server; phones: Phone[] }> {
  const server = new Server();
  await server.claim();
  const made: Phone[] = [];
  for (const [id, s, scene, palette] of phones) {
    const p = new Phone(server, id, s, scene, palette);
    await p.join(K, true);
    made.push(p);
    settle(...made);
  }
  return { server, phones: made };
}

describe("a phone seeding and a TV joining", () => {
  it("the first phone seeds an empty room with its own room-scope look", async () => {
    const { server, phones } = await roomWith(["phoneA", seed(), "plume", "neon"]);
    const { rev, doc } = await server.look();
    expect(rev).toBe(1);
    expect(doc).toEqual({ scene: "plume", palette: "neon", storage: phones[0].room() });
    expect(Object.keys(doc?.storage ?? {}).sort()).toEqual(["vibe.drives", "vibe.sceneSettings", "vibe.sensitivity"]);
  });

  it("an empty room tells a TV there is no look yet, and leaves its own keys alone", async () => {
    const server = new Server();
    await server.claim();
    const tv = new Tv(server, "tv");
    await tv.join();
    settle(tv);
    expect(tv.replica.doc()).toBeNull();
    expect(tv.count("look")).toBe(1);
    expect(tv.storage.all()).toEqual({ "vibe.deviceId": "tv-own-id", "vibe.quality": "low" });
  });

  it("a late TV gets the snapshot, runs the store hooks, and keeps its own keys", async () => {
    const { server, phones } = await roomWith(["phoneA", seed(), "plume", "neon"]);
    const tv = new Tv(server, "tv");
    const before = reloads;
    await tv.join();
    settle(...phones, tv);
    expect(tv.room()).toEqual(phones[0].room());
    expect(tv.scene).toBe("plume");
    expect(tv.palette).toBe("neon");
    expect(reloads).toBeGreaterThan(before);
    expect(tv.storage.getItem("vibe.deviceId")).toBe("tv-own-id");
    expect(tv.storage.getItem("vibe.quality")).toBe("low");
  });

  it("a second phone joining a populated room takes the room's look and keeps its own saved looks", async () => {
    const { server, phones } = await roomWith(["phoneA", seed(), "plume", "neon"]);
    const b = new Phone(server, "phoneB", seed({ "vibe.sceneSettings": '{"storm":{"scale":9}}', "vibe.hitAmount": "5" }), "storm", "ice");
    await b.join(K, true);
    settle(...phones, b);
    expect(b.room()).toEqual(phones[0].room());
    expect(b.scene).toBe("plume");
    expect(b.palette).toBe("neon");
    expect(b.storage.getItem("vibe.looks")).toBe(DEVICE_LOCAL["vibe.looks"]);
    expect((await server.look()).rev).toBe(1);
  });
});

describe("edits reaching the TV", () => {
  it("a phone's edits, removals, scene and palette reach the TV as the phone's room-scope storage", async () => {
    const { server, phones } = await roomWith(["phoneA", seed(), "plume", "neon"]);
    const [a] = phones;
    const tv = new Tv(server, "tv");
    await tv.join();
    settle(a, tv);

    a.set("vibe.sceneSettings", '{"plume":{"scale":8}}');
    a.set("vibe.hitAmount", "4");
    a.unset("vibe.drives");
    a.scene = "storm";
    a.palette = "ice";
    settle(a, tv);

    expect(tv.room()).toEqual(a.room());
    expect(tv.room()["vibe.drives"]).toBeUndefined();
    expect(tv.room()["vibe.hitAmount"]).toBe("4");
    expect(tv.scene).toBe("storm");
    expect(tv.palette).toBe("ice");
    expect((await server.look()).doc).toEqual({ scene: "storm", palette: "ice", storage: a.room() });
  });

  it("never carries a device's own keys, in either direction", async () => {
    const { server, phones } = await roomWith(["phoneA", seed(), "plume", "neon"]);
    const [a] = phones;
    const tv = new Tv(server, "tv");
    await tv.join();
    settle(a, tv);
    a.set("vibe.hitAmount", "4");
    settle(a, tv);

    const inRoom = Object.keys((await server.look()).doc?.storage ?? {});
    for (const k of Object.keys(DEVICE_LOCAL)) {
      expect(inRoom, k).not.toContain(k);
      // The TV never receives the phone's value (it may have a key of its own by that name)...
      expect(tv.storage.getItem(k), k).not.toBe(DEVICE_LOCAL[k]);
      // ...and the phone keeps its own through every apply.
      expect(a.storage.getItem(k), k).toBe(DEVICE_LOCAL[k]);
    }
    expect(tv.storage.getItem("vibe.deviceId")).toBe("tv-own-id");
  });

  it("two phones converge, per key, by arrival order", async () => {
    const { server, phones } = await roomWith(["phoneA", seed(), "plume", "neon"], ["phoneB", seed(), "plume", "neon"]);
    const [a, b] = phones;
    const tv = new Tv(server, "tv");
    await tv.join();
    settle(a, b, tv);

    a.set("vibe.hitAmount", "1");
    a.set("vibe.drives", '{"by":"A"}');
    b.set("vibe.hitDecay", "2");
    b.set("vibe.drives", '{"by":"B"}');
    settle(a, b, tv);

    const doc = (await server.look()).doc;
    expect(a.room()).toEqual(doc?.storage);
    expect(b.room()).toEqual(doc?.storage);
    expect(tv.room()).toEqual(doc?.storage);
    expect(doc?.storage["vibe.hitAmount"]).toBe("1");
    expect(doc?.storage["vibe.hitDecay"]).toBe("2");
    // B's patch reached the room second.
    expect(doc?.storage["vibe.drives"]).toBe('{"by":"B"}');
  });
});

describe("a flaky link", () => {
  it("a lost ack does not apply the edit twice: the snapshot on reconnect already has it", async () => {
    const { server, phones } = await roomWith(["phoneA", seed(), "plume", "neon"]);
    const [a] = phones;
    const tv = new Tv(server, "tv");
    await tv.join();
    settle(a, tv);
    const rev = (await server.look()).rev;
    const patches = tv.count("lookPatch");

    a.set("vibe.drives", '{"v":2}');
    a.lose.push("lookAck");
    settle(a, tv);
    expect((await server.look()).rev).toBe(rev + 1);
    expect(tv.count("lookPatch")).toBe(patches + 1);

    a.leave();
    await a.join(K, true);
    settle(a, tv);
    expect((await server.look()).rev).toBe(rev + 1);
    expect(tv.count("lookPatch")).toBe(patches + 1);
    expect(a.room()).toEqual(tv.room());
  });

  it("a patch lost on the way is sent again after reconnect, exactly once", async () => {
    const { server, phones } = await roomWith(["phoneA", seed(), "plume", "neon"]);
    const [a] = phones;
    const tv = new Tv(server, "tv");
    await tv.join();
    settle(a, tv);
    const rev = (await server.look()).rev;
    const patches = tv.count("lookPatch");

    a.set("vibe.drives", '{"v":3}');
    a.blackhole = true;
    settle(a, tv);
    expect((await server.look()).rev).toBe(rev);

    a.blackhole = false;
    a.leave();
    await a.join(K, true);
    settle(a, tv);
    expect((await server.look()).rev).toBe(rev + 1);
    expect(tv.count("lookPatch")).toBe(patches + 1);
    expect(tv.room()["vibe.drives"]).toBe('{"v":3}');
  });

  it("a patch the room has already applied is acked at the same revision and goes no further", async () => {
    const { server, phones } = await roomWith(["phoneA", seed(), "plume", "neon"]);
    const [a] = phones;
    const tv = new Tv(server, "tv");
    await tv.join();
    settle(a, tv);
    a.set("vibe.drives", '{"v":4}');
    settle(a, tv);
    const { rev } = await server.look();
    const patches = tv.count("lookPatch");

    a.say(a.sent[a.sent.length - 1]); // the same message again, as a retransmit would
    settle(a, tv);
    const acks = a.log.filter((m) => m.type === "lookAck");
    expect(acks[acks.length - 1]).toMatchObject({ type: "lookAck", rev });
    expect((await server.look()).rev).toBe(rev);
    expect(tv.count("lookPatch")).toBe(patches);
  });

  it("a TV that missed a patch asks for the look and catches up", async () => {
    const { server, phones } = await roomWith(["phoneA", seed(), "plume", "neon"]);
    const [a] = phones;
    const tv = new Tv(server, "tv");
    await tv.join();
    settle(a, tv);

    tv.lose.push("lookPatch");
    a.set("vibe.hitAmount", "1");
    settle(a, tv);
    expect(tv.room()["vibe.hitAmount"]).toBeUndefined();
    expect(tv.lookGets).toBe(0);

    a.set("vibe.hitDecay", "2");
    settle(a, tv);
    expect(tv.lookGets).toBe(1);
    expect(tv.room()).toEqual(a.room());
    expect(tv.replica.rev()).toBe((await server.look()).rev);
  });

  it("a phone that missed a patch asks for the look and catches up", async () => {
    const { server, phones } = await roomWith(["phoneA", seed(), "plume", "neon"], ["phoneB", seed(), "plume", "neon"]);
    const [a, b] = phones;

    b.lose.push("lookPatch");
    a.set("vibe.hitAmount", "1");
    settle(a, b);
    expect(b.room()["vibe.hitAmount"]).toBeUndefined();

    a.set("vibe.hitDecay", "2");
    settle(a, b);
    expect(b.sent.filter((m) => m.type === "lookGet")).toHaveLength(1);
    expect(b.room()).toEqual(a.room());
    expect(b.sync.rev).toBe((await server.look()).rev);
  });

  it("a phone that was offline keeps its unsent edits and takes the room's changes on return", async () => {
    const { server, phones } = await roomWith(["phoneA", seed(), "plume", "neon"], ["phoneB", seed(), "plume", "neon"]);
    const [a, b] = phones;
    const tv = new Tv(server, "tv");
    await tv.join();
    settle(a, b, tv);

    b.leave();
    a.set("vibe.hitAmount", "1");
    settle(a, tv);
    b.set("vibe.hitDecay", "2"); // edited while offline: nothing can be sent
    settle(a, b, tv);
    expect((await server.look()).doc?.storage["vibe.hitDecay"]).toBeUndefined();

    await b.join(K, true);
    settle(a, b, tv);
    const doc = (await server.look()).doc;
    expect(doc?.storage["vibe.hitAmount"]).toBe("1");
    expect(doc?.storage["vibe.hitDecay"]).toBe("2");
    expect(a.room()).toEqual(doc?.storage);
    expect(b.room()).toEqual(doc?.storage);
    expect(tv.room()).toEqual(doc?.storage);
  });

  it("a room that was asleep wakes with the same claim, revision and look", async () => {
    const { server, phones } = await roomWith(["phoneA", seed(), "plume", "neon"]);
    const before = await server.look();
    const woken = new Server(new Map(server.store));

    const tv = new Tv(woken, "tv");
    await tv.join();
    settle(tv);
    expect(tv.replica.rev()).toBe(before.rev);
    expect(tv.room()).toEqual(phones[0].room());
    expect(await woken.connect({ role: "renderer", deviceId: "stranger" })).toBeNull();
    expect(await woken.connect({ role: "host", hk: OTHER_HK, k: OTHER_K })).toBeNull();
  });
});

describe("refusals", () => {
  it("a TV cannot edit the look: its patch is rejected for its role and nothing changes", async () => {
    const { server, phones } = await roomWith(["phoneA", seed(), "plume", "neon"]);
    const [a] = phones;
    const tv = new Tv(server, "tv");
    await tv.join();
    settle(a, tv);
    const before = await server.look();
    const patches = a.count("lookPatch");

    tv.say({ type: "lookPatch", n: 1, set: { "vibe.hitAmount": "9" } });
    settle(a, tv);
    expect(tv.log.filter((m) => m.type === "lookReject")).toEqual([{ type: "lookReject", n: 1, reason: "role" }]);
    expect(await server.look()).toEqual(before);
    expect(a.count("lookPatch")).toBe(patches);
  });

  it("a value past the size limit is rejected, leaves the room alone, and is not resent", async () => {
    const { server, phones } = await roomWith(["phoneA", seed(), "plume", "neon"]);
    const [a] = phones;
    const tv = new Tv(server, "tv");
    await tv.join();
    settle(a, tv);
    const before = await server.look();

    a.set("vibe.sceneSettings", "x".repeat(LOOK_LIMITS.maxValueBytes + 1));
    settle(a, tv);
    expect(a.rejects).toEqual(["size"]);
    expect(await server.look()).toEqual(before);

    const sent = a.sent.length;
    for (let i = 0; i < 5; i++) settle(a, tv);
    expect(a.sent.length).toBe(sent);
    expect(tv.room()).toEqual(before.doc?.storage);
  });

  it("a document that would grow past the limit is rejected as a whole", async () => {
    const { server, phones } = await roomWith(["phoneA", seed(), "plume", "neon"]);
    const [a] = phones;
    const before = await server.look();

    // Each value is within its own limit and the message within the message
    // limit; only the sum is too much.
    const each = Math.floor(LOOK_LIMITS.maxDocBytes / 2) + 1;
    expect(each).toBeLessThanOrEqual(LOOK_LIMITS.maxValueBytes);
    expect(each * 2 + 1000).toBeLessThan(LOOK_LIMITS.maxMessageChars);
    a.set("vibe.bigOne", "a".repeat(each));
    a.set("vibe.bigTwo", "b".repeat(each));
    settle(a);
    expect(a.rejects).toEqual(["size"]);
    expect(await server.look()).toEqual(before);
  });
});

describe("who may join", () => {
  it("the first host with both keys claims; only holders of the right key get in after", async () => {
    const s = new Server();
    expect(await s.connect({ role: "controller", k: K })).toBeNull(); // nobody to control yet
    expect(await s.connect({ role: "renderer", k: K })).toBeNull(); // a key on an unclaimed room
    expect(await s.connect({ role: "host", hk: HK })).toBeNull(); // half a claim
    expect(await s.connect({ role: "host", k: K })).toBeNull();

    const host = await s.claim();
    expect(host.attachment.keyed).toBe(true);
    expect(JSON.parse(s.store.get("meta") ?? "null")).toMatchObject({ v: 1 });
    expect(s.store.get("meta")).not.toContain(HK);
    expect(s.store.get("meta")).not.toContain(K);

    expect(await s.connect({ role: "host", hk: OTHER_HK, k: OTHER_K })).toBeNull(); // a second claimant
    expect(await s.connect({ role: "host", hk: OTHER_HK, k: K })).toBeNull(); // the room key is not the host key
    expect(await s.connect({ role: "host", k: K })).toBeNull();
    expect(await s.connect({ role: "host", hk: HK })).not.toBeNull(); // the laptop coming back

    expect(await s.connect({ role: "controller", k: K })).not.toBeNull();
    expect(await s.connect({ role: "renderer", k: K })).not.toBeNull();
    expect(await s.connect({ role: "controller", k: OTHER_K })).toBeNull();
    expect(await s.connect({ role: "renderer", k: OTHER_K })).toBeNull();
    expect(await s.connect({ role: "controller", k: HK })).toBeNull(); // the host key is not a room key
    expect(await s.connect({ role: "renderer" })).toBeNull(); // keyless
    expect(await s.connect({ role: "controller" })).toBeNull();
    expect(await s.connect({ role: "admin", k: K })).toBeNull();
  });

  it("a keyless host and renderer still relay in a room nobody claimed, with no look", async () => {
    const s = new Server();
    const host = await s.need({ role: "host", deviceId: "phone-host" });
    const tv = await s.need({ role: "renderer", deviceId: "old-tv" });
    expect(host.attachment.keyed).toBe(false);
    expect(tv.attachment.keyed).toBe(false);

    s.core.message(host, new Uint8Array(40).fill(1).buffer);
    expect(tv.inbox.filter((d) => typeof d !== "string")).toHaveLength(1);

    s.say(tv, { type: "lookGet" });
    s.say(host, { type: "lookPatch", n: 1, set: { "vibe.x": "1" } });
    const texts = tv.inbox.filter((d): d is string => typeof d === "string").map((d) => JSON.parse(d).type);
    expect(texts).not.toContain("look");
    expect(texts).not.toContain("lookPatch");
  });

  it("claiming a room shuts out a keyless socket that was already in it", async () => {
    const s = new Server();
    const legacy = await s.need({ role: "renderer", deviceId: "old-tv" });
    expect(legacy.closedWith).toBeNull();
    await s.claim();
    expect(legacy.closedWith).toEqual({ code: ROOM_CLOSE_DENIED, reason: "denied" });
  });
});

describe("what can travel in a look", () => {
  it("every registered scene id and palette id is a valid look id", () => {
    expect(listScenes().length).toBeGreaterThan(0);
    for (const s of listScenes()) expect(validLookId(s.id), `scene ${s.id}`).toBe(true);
    for (const p of PALETTES) expect(validLookId(p.id), `palette ${p.id}`).toBe(true);
  });
});
