import { describe, expect, it } from "vitest";
import {
  FULL_VIEWPORT,
  RoomCore,
  readAttachment,
  type Attachment,
  type CoreHost,
  type CoreSocket,
} from "../server/roomCore.ts";
import { LOOK_LIMITS } from "../server/lookDoc.ts";
import { DEVICE_LIMITS } from "../server/roomDevices.ts";
import { ROOM_CLOSE_DENIED, ROOM_IDLE_TTL_MS, ADOPT_ANY_TAG, adoptTag, hashKey } from "../server/roomRules.ts";

/** How often the old live publisher sent a patch while a control was being dragged.
 *  Nothing sends at that pace any more (a device sends on Play), but the room's
 *  patch budget is still sized to let it through, and that is what these pin. */
const LOOK_PUBLISH_MS = 120;

// A fake room: sockets that record what they were sent, a Map for storage and
// an alarm slot, driven through the same calls server/room.ts makes.

const HK = "h".repeat(22);
const K = "k".repeat(22);
const OTHER_HK = "x".repeat(22);
const OTHER_K = "y".repeat(22);

class FakeSocket implements CoreSocket {
  sent: Array<string | ArrayBuffer> = [];
  closedWith: { code: number; reason: string } | null = null;
  throwOnSend = false;
  constructor(
    public attachment: Attachment,
    readonly tags: string[],
  ) {}
  send(data: string | ArrayBuffer): void {
    if (this.throwOnSend) throw new Error("mid-close");
    this.sent.push(data);
  }
  close(code: number, reason: string): void {
    this.closedWith = { code, reason };
  }
  setAttachment(a: Attachment): void {
    this.attachment = a;
  }
  /** Parsed JSON messages received, optionally of one type. */
  msgs(type?: string): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = [];
    for (const d of this.sent) {
      if (typeof d !== "string") continue;
      const m = JSON.parse(d) as Record<string, unknown>;
      if (type === undefined || m.type === type) out.push(m);
    }
    return out;
  }
  frames(): ArrayBuffer[] {
    return this.sent.filter((d): d is ArrayBuffer => typeof d !== "string");
  }
  clear(): void {
    this.sent = [];
  }
}

class FakeHost implements CoreHost {
  live: FakeSocket[] = [];
  store = new Map<string, string>();
  time = 1_000_000;
  alarmAt: number | null = null;
  alarmSets = 0;
  alarmDeletes = 0;
  removeAlls = 0;
  puts: string[] = [];
  sockets(tag?: string): CoreSocket[] {
    return this.live.filter((s) => tag === undefined || s.tags.includes(tag));
  }
  now(): number {
    return this.time;
  }
  setAlarm(atMs: number): void {
    this.alarmAt = atMs;
    this.alarmSets++;
  }
  deleteAlarm(): void {
    this.alarmAt = null;
    this.alarmDeletes++;
  }
  put(key: string, value: string): void {
    this.store.set(key, value);
    this.puts.push(key);
  }
  remove(key: string): void {
    this.store.delete(key);
  }
  removeAll(): void {
    this.store.clear();
    this.alarmAt = null;
    this.removeAlls++;
  }
}

interface Presented {
  role?: string | null;
  deviceId?: string | null;
  /** What the device says it is: the `kind`, `mic` and `name` query values. */
  kind?: string | null;
  mic?: boolean;
  name?: string | null;
  k?: string;
  hk?: string;
  /** The nonce a TV waiting in a pairing slot presents. */
  adopt?: string;
}

class Room {
  readonly host = new FakeHost();
  core: RoomCore;
  private sids = 0;

  constructor(stored: ReadonlyMap<string, string> = new Map()) {
    this.core = new RoomCore(this.host, stored);
  }

  /** What server/room.ts does for an upgrade; null when the room denies it. */
  async connect(p: Presented): Promise<FakeSocket | null> {
    const hashes = {
      k: p.k === undefined ? null : await hashKey(p.k),
      hk: p.hk === undefined ? null : await hashKey(p.hk),
    };
    const result = this.core.join(
      {
        role: p.role === undefined ? null : p.role,
        deviceId: p.deviceId ?? null,
        kind: p.kind ?? null,
        mic: p.mic ?? false,
        name: p.name ?? null,
        adopt: p.adopt ?? null,
      },
      hashes,
      `sid${++this.sids}`,
    );
    if (!result.ok) return null;
    const ws = new FakeSocket(result.attachment, result.tags);
    this.host.live.push(ws);
    this.core.opened(ws);
    return ws;
  }

  async need(p: Presented): Promise<FakeSocket> {
    const ws = await this.connect(p);
    if (!ws) throw new Error(`join was denied: ${JSON.stringify(p)}`);
    return ws;
  }

  /** The laptop claiming a room with both keys. */
  claimed(): Promise<FakeSocket> {
    return this.need({ role: "host", deviceId: "laptop", hk: HK, k: K, mic: true });
  }
  controller(deviceId = "phone", extra: Presented = {}): Promise<FakeSocket> {
    return this.need({ role: "controller", deviceId, k: K, ...extra });
  }
  /** A controller the owner has let Play: connects it, then the live owner
   *  grants `canPlay` with a `deviceSet`. The owner must already be connected. */
  async player(deviceId = "phone", extra: Presented = {}): Promise<FakeSocket> {
    const ws = await this.controller(deviceId, extra);
    const owner = this.host.live.find((s) => s.attachment.keyed && s.attachment.role === "host");
    if (!owner) throw new Error("player() needs the owner connected first");
    this.say(owner, { type: "deviceSet", targetId: deviceId, canPlay: true });
    return ws;
  }
  renderer(deviceId = "tv", extra: Presented = {}): Promise<FakeSocket> {
    return this.need({ role: "renderer", deviceId, k: K, kind: "tv", ...extra });
  }

  say(ws: FakeSocket, msg: unknown): void {
    this.core.message(ws, typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  bytes(ws: FakeSocket, n = 40): void {
    this.core.message(ws, new Uint8Array(n).fill(7).buffer);
  }
  close(ws: FakeSocket, removeFromLive = true): void {
    if (removeFromLive) this.host.live = this.host.live.filter((s) => s !== ws);
    this.core.closed(ws);
  }
  /** A new core over what the first one persisted: the room after hibernation. */
  reborn(): Room {
    const next = new Room(new Map(this.host.store));
    return next;
  }
}

/** The device list of the last roster a socket received. */
function roster(ws: FakeSocket): Array<Record<string, unknown>> {
  const last = ws.msgs("roster").pop();
  return (last?.devices ?? []) as Array<Record<string, unknown>>;
}

describe("join", () => {
  it("lets keyless hosts and renderers into an unclaimed room as legacy", async () => {
    const room = new Room();
    const host = await room.need({ role: "host", deviceId: "laptop" });
    const tv = await room.need({ role: "renderer", deviceId: "tv" });
    expect(host.attachment.keyed).toBe(false);
    expect(tv.attachment.keyed).toBe(false);
    expect(host.tags).toEqual(["host", "laptop"]);
    expect(tv.tags).toEqual(["renderer", "tv"]);
    expect(room.host.store.size).toBe(0);
  });

  it("treats a missing or empty role as renderer", async () => {
    const room = new Room();
    expect((await room.need({ role: null, deviceId: "a" })).attachment.role).toBe("renderer");
    expect((await room.need({ role: "", deviceId: "b" })).attachment.role).toBe("renderer");
  });

  it("denies an unknown role", async () => {
    const room = new Room();
    expect(await room.connect({ role: "admin", deviceId: "a" })).toBeNull();
    expect(await room.connect({ role: "HOST", deviceId: "a" })).toBeNull();
  });

  it("starts every socket with empty strings and the full viewport", async () => {
    const room = new Room();
    const tv = await room.need({ role: "renderer", deviceId: "tv" });
    expect(tv.attachment).toMatchObject({ scene: "", palette: "", viewport: FULL_VIEWPORT, role: "renderer" });
    expect(tv.attachment.viewport).not.toBe(FULL_VIEWPORT);
  });

  it("claims for a host with both keys and persists only hashes", async () => {
    const room = new Room();
    const host = await room.claimed();
    expect(host.attachment.keyed).toBe(true);
    const meta = JSON.parse(room.host.store.get("meta") ?? "null");
    expect(meta).toEqual({
      v: 1,
      hostKeyHash: await hashKey(HK),
      roomKeyHash: await hashKey(K),
      claimedAt: room.host.time,
    });
    expect(room.host.store.get("meta")).not.toContain(HK);
    expect(room.host.store.get("meta")).not.toContain(K);
  });

  it("denies a host presenting only one of the keys on an unclaimed room", async () => {
    const room = new Room();
    expect(await room.connect({ role: "host", hk: HK })).toBeNull();
    expect(await room.connect({ role: "host", k: K })).toBeNull();
    expect(room.host.store.size).toBe(0);
  });

  it("denies a keyed renderer and any controller on an unclaimed room", async () => {
    const room = new Room();
    expect(await room.connect({ role: "renderer", k: K })).toBeNull();
    expect(await room.connect({ role: "controller", k: K })).toBeNull();
    expect(await room.connect({ role: "controller" })).toBeNull();
    expect(await room.connect({ role: "controller", k: K, hk: HK })).toBeNull();
  });

  it("denies a second claimant with other keys, and the original host still gets back in", async () => {
    const room = new Room();
    await room.claimed();
    expect(await room.connect({ role: "host", hk: OTHER_HK, k: OTHER_K })).toBeNull();
    expect(await room.connect({ role: "host", hk: OTHER_HK, k: K })).toBeNull();
    const again = await room.need({ role: "host", deviceId: "laptop2", hk: HK, k: K });
    expect(again.attachment.keyed).toBe(true);
    expect(JSON.parse(room.host.store.get("meta") ?? "{}").roomKeyHash).toBe(await hashKey(K));
  });

  it("on a claimed room takes the room key for controllers and renderers, and only that", async () => {
    const room = new Room();
    await room.claimed();
    expect((await room.controller()).attachment.keyed).toBe(true);
    expect((await room.renderer()).attachment.keyed).toBe(true);
    expect(await room.connect({ role: "renderer" })).toBeNull();
    expect(await room.connect({ role: "controller" })).toBeNull();
    expect(await room.connect({ role: "renderer", k: OTHER_K })).toBeNull();
    expect(await room.connect({ role: "controller", k: OTHER_K })).toBeNull();
    expect(await room.connect({ role: "controller", hk: HK })).toBeNull();
    expect(await room.connect({ role: "host", k: K })).toBeNull();
    expect(await room.connect({ role: "host" })).toBeNull();
  });

  it("tags a socket by its role and its device id, and by nothing else", async () => {
    const room = new Room();
    await room.claimed();
    expect((await room.controller("p1")).tags).toEqual(["controller", "p1"]);
    expect((await room.renderer("tv")).tags).toEqual(["renderer", "tv"]);
  });

  it("takes a socket's kind, microphone and name from what it presented, with defaults from its role", async () => {
    const room = new Room();
    await room.claimed();
    const pad = await room.controller("pad", { kind: "tablet", mic: true, name: "Studio iPad" });
    expect(pad.attachment).toMatchObject({ kind: "tablet", hasMic: true, joinName: "Studio iPad" });
    const plain = await room.controller("plain");
    expect(plain.attachment).toMatchObject({ kind: "phone", hasMic: false });
    expect(plain.attachment.joinName).toBeUndefined();
    const odd = await room.controller("odd", { kind: "fridge", name: "  \u0000  " });
    expect(odd.attachment.kind).toBe("phone");
    expect(odd.attachment.joinName).toBeUndefined();
    const tv = await room.renderer("tv", { mic: true });
    expect(tv.attachment).toMatchObject({ kind: "tv", hasMic: false });
    const long = await room.controller("long", { name: "n".repeat(100) });
    expect(long.attachment.joinName).toBe("n".repeat(32));
  });

  it("replaces a device id that is missing, malformed, over-long or reserved", async () => {
    const room = new Room();
    const bad = [null, "", "has space", "semi;colon", "a".repeat(LOOK_LIMITS.maxDeviceIdChars + 1), "host", "renderer", "controller", "frames"];
    for (const deviceId of bad) {
      const ws = await room.need({ role: "renderer", deviceId });
      expect(ws.attachment.deviceId).toBe(ws.attachment.sid);
      expect(ws.tags).toEqual(["renderer", ws.attachment.sid]);
    }
    const ok = await room.need({ role: "renderer", deviceId: "ok-id_1" });
    expect(ok.attachment.deviceId).toBe("ok-id_1");
  });

  it("closes a keyless socket that was already there when the room is claimed", async () => {
    const room = new Room();
    const squatter = await room.need({ role: "renderer", deviceId: "squat" });
    await room.claimed();
    expect(squatter.closedWith).toEqual({ code: ROOM_CLOSE_DENIED, reason: "denied" });
  });

  it("ignores everything a keyless socket says once the room is claimed", async () => {
    const room = new Room();
    const squatter = await room.need({ role: "renderer", deviceId: "squat" });
    const host = await room.claimed();
    const tv = await room.renderer("tv");
    tv.clear();
    room.say(squatter, { type: "deviceSet", targetId: "tv", name: "Hijacked" });
    room.say(squatter, { type: "deviceForget", targetId: "tv" });
    room.say(squatter, { type: "hello", scene: "x" });
    room.say(squatter, { type: "ping", t0: 1 });
    expect(tv.sent).toEqual([]);
    expect(squatter.sent).toEqual([]);
    room.bytes(host);
    expect(squatter.frames()).toEqual([]);
  });
});

describe("message gating", () => {
  it("relays binary only from a device on its own input: the host's, not a follower's", async () => {
    const room = new Room();
    const host = await room.claimed();
    const phone = await room.controller("phone");
    const tv = await room.renderer();
    room.bytes(phone);
    room.bytes(tv);
    expect(tv.frames()).toEqual([]);
    expect(host.frames()).toEqual([]);
    room.bytes(host);
    expect(tv.frames().length).toBe(1);
    expect(phone.frames().length).toBe(1);
  });

  it("answers a ping with the room's clock", async () => {
    const room = new Room();
    const tv = await room.need({ role: "renderer", deviceId: "tv" });
    room.say(tv, { type: "ping", t0: 42 });
    expect(tv.msgs("pong")).toEqual([{ type: "pong", t0: 42, tServer: room.host.time }]);
    room.say(tv, { type: "ping", t0: "nope" });
    expect(tv.msgs("pong").length).toBe(1);
  });

  it("ignores deviceSet and deviceForget in a room nobody has claimed, and the old setDevice everywhere", async () => {
    const legacy = new Room();
    const host = await legacy.need({ role: "host", deviceId: "laptop" });
    const tv = await legacy.need({ role: "renderer", deviceId: "tv" });
    host.clear();
    tv.clear();
    legacy.say(host, { type: "deviceSet", targetId: "tv", name: "X" });
    legacy.say(tv, { type: "deviceSet", targetId: "tv", name: "X" });
    legacy.say(host, { type: "deviceForget", targetId: "tv" });
    legacy.say(host, { type: "setDevice", targetId: "tv", scene: "mesh" });
    expect(tv.sent).toEqual([]);
    expect(host.sent).toEqual([]);
    expect(tv.closedWith).toBeNull();

    const keyed = new Room();
    const keyedHost = await keyed.claimed();
    const keyedTv = await keyed.renderer("tv");
    keyedTv.clear();
    keyed.say(keyedHost, { type: "setDevice", targetId: "tv", scene: "mesh" });
    expect(keyedTv.sent).toEqual([]);
  });

  it("keeps delivering when one socket's send throws", async () => {
    const room = new Room();
    const host = await room.need({ role: "host", deviceId: "laptop" });
    const tvA = await room.need({ role: "renderer", deviceId: "a" });
    const tvB = await room.need({ role: "renderer", deviceId: "b" });
    tvA.throwOnSend = true;
    room.bytes(host);
    expect(tvB.frames().length).toBe(1);
    room.say(host, { type: "hello", scene: "mesh" });
    expect(tvB.msgs("roster").length).toBeGreaterThan(0);

    const claimed = new Room();
    const owner = await claimed.claimed();
    const bad = await claimed.renderer("bad");
    const good = await claimed.renderer("good");
    bad.throwOnSend = true;
    claimed.bytes(owner);
    expect(good.frames().length).toBe(1);
    claimed.say(owner, { type: "hello", scene: "mesh" });
    expect(good.msgs("roster").length).toBeGreaterThan(0);
  });

  it("drops text over the message cap before parsing, and binary over the frame cap", async () => {
    const room = new Room();
    const host = await room.need({ role: "host", deviceId: "laptop" });
    const tv = await room.need({ role: "renderer", deviceId: "tv" });
    const pad = " ".repeat(LOOK_LIMITS.maxMessageChars);
    room.say(tv, `{"type":"ping","t0":1}${pad}`);
    expect(tv.msgs("pong")).toEqual([]);
    room.say(tv, `{"type":"ping","t0":1}`);
    expect(tv.msgs("pong").length).toBe(1);

    room.bytes(host, LOOK_LIMITS.maxBinaryBytes + 1);
    expect(tv.frames()).toEqual([]);
    room.bytes(host, LOOK_LIMITS.maxBinaryBytes);
    expect(tv.frames().length).toBe(1);
  });

  it("ignores text that isn't a JSON object or has an unknown type", async () => {
    const room = new Room();
    const tv = await room.need({ role: "renderer", deviceId: "tv" });
    for (const raw of ["", "not json", "null", "[1,2]", "7", '"ping"', '{"type":"mystery"}', "{}"]) room.say(tv, raw);
    expect(tv.sent).toEqual([]);
  });

  it("answers lookPatch from a renderer with lookReject role, and lookGet from the host with the look", async () => {
    const room = new Room();
    const host = await room.claimed();
    const tv = await room.renderer();
    room.say(tv, { type: "lookPatch", n: 3, set: { "vibe.x": "1" } });
    expect(tv.msgs("lookReject")).toEqual([{ type: "lookReject", n: 3, reason: "role" }]);
    host.clear();
    room.say(host, { type: "lookGet" });
    expect(host.msgs("look")).toEqual([{ type: "look", rev: 0, doc: null }]);
    const phone = await room.controller();
    expect(phone.msgs("look")[0].doc).toBeNull();
  });

  it("ignores look messages silently in a room nobody has claimed", async () => {
    const room = new Room();
    const host = await room.need({ role: "host", deviceId: "laptop" });
    const tv = await room.need({ role: "renderer", deviceId: "tv" });
    room.say(tv, { type: "lookGet" });
    room.say(tv, { type: "lookPatch", n: 1, set: { "vibe.x": "1" } });
    room.say(host, { type: "lookPatch", n: 2, set: { "vibe.x": "1" } });
    expect(tv.sent).toEqual([]);
    expect(host.sent).toEqual([]);
    expect(room.host.store.size).toBe(0);
  });
});

describe("the host's look", () => {
  it("is applied, acked to the laptop and relayed to a TV and a phone, glide and sender beside it", async () => {
    const room = new Room();
    const host = await room.claimed();
    const tv = await room.renderer();
    const phone = await room.controller();
    room.say(host, { type: "lookPatch", n: 1, scene: "mesh", set: { "vibe.a": "1" }, glideMs: 4000 });
    expect(host.msgs("lookAck")).toEqual([{ type: "lookAck", n: 1, rev: 1 }]);
    const expected = { type: "lookPatch", rev: 1, by: "laptop", scene: "mesh", set: { "vibe.a": "1" }, glideMs: 4000 };
    expect(tv.msgs("lookPatch")).toEqual([expected]);
    expect(phone.msgs("lookPatch")).toEqual([expected]);
    expect(host.msgs("lookPatch")).toEqual([]);
  });

  it("never stores a glide: a TV that joins later gets the look, no glide", async () => {
    const room = new Room();
    const host = await room.claimed();
    room.say(host, { type: "lookPatch", n: 1, scene: "mesh", glideMs: 4000 });
    const tv = await room.renderer();
    expect(tv.msgs("look")[0].doc).toEqual({ scene: "mesh", palette: "", storage: {} });
  });

  it("drops a glide that is not a positive number, and caps a long one", async () => {
    const room = new Room();
    const host = await room.claimed();
    const tv = await room.renderer();
    room.say(host, { type: "lookPatch", n: 1, set: { "vibe.a": "1" }, glideMs: -5 });
    room.say(host, { type: "lookPatch", n: 2, set: { "vibe.a": "2" }, glideMs: "soon" });
    room.say(host, { type: "lookPatch", n: 3, set: { "vibe.a": "3" }, glideMs: 9e9 });
    expect(tv.msgs("lookPatch")).toEqual([
      { type: "lookPatch", rev: 1, by: "laptop", set: { "vibe.a": "1" } },
      { type: "lookPatch", rev: 2, by: "laptop", set: { "vibe.a": "2" } },
      { type: "lookPatch", rev: 3, by: "laptop", set: { "vibe.a": "3" }, glideMs: 30_000 },
    ]);
  });
});

describe("relay", () => {
  /** laptop (owner, own input), tv and phone follow it; pad is a tablet with a mic that follows too. */
  async function party(): Promise<{ room: Room; host: FakeSocket; tv: FakeSocket; pad: FakeSocket; phone: FakeSocket }> {
    const room = new Room();
    const host = await room.claimed();
    const tv = await room.renderer("tv");
    const pad = await room.controller("pad", { kind: "tablet", mic: true });
    const phone = await room.controller("phone", { kind: "phone", mic: true });
    return { room, host, tv, pad, phone };
  }

  it("sends a host frame to every device that follows it, once each, never back to the sender", async () => {
    const { room, host, tv, pad, phone } = await party();
    room.bytes(host);
    for (const ws of [tv, pad, phone]) expect(ws.frames().length).toBe(1);
    expect(host.frames()).toEqual([]);
  });

  it("does not send a host frame to a device on its own input, nor to one following another feed", async () => {
    const { room, host, tv, pad, phone } = await party();
    room.say(pad, { type: "deviceSet", targetId: "pad", ears: "own" });
    room.say(phone, { type: "deviceSet", targetId: "phone", follow: "pad" });
    room.bytes(host);
    expect(tv.frames().length).toBe(1);
    expect(pad.frames()).toEqual([]);
    expect(phone.frames()).toEqual([]);
  });

  it("relays a controller on its own input to its followers only", async () => {
    const { room, host, tv, pad, phone } = await party();
    room.say(pad, { type: "deviceSet", targetId: "pad", ears: "own" });
    room.say(phone, { type: "deviceSet", targetId: "phone", follow: "pad" });
    room.bytes(pad);
    expect(phone.frames().length).toBe(1);
    for (const ws of [host, tv, pad]) expect(ws.frames()).toEqual([]);
  });

  it("follows a change at once: the cached followers are not stale", async () => {
    const { room, host, tv, phone } = await party();
    room.bytes(host);
    expect(phone.frames().length).toBe(1);
    room.say(tv, { type: "deviceSet", targetId: "phone", ears: "own" });
    room.bytes(host);
    expect(phone.frames().length).toBe(1);
    expect(tv.frames().length).toBe(2);
    room.say(tv, { type: "deviceSet", targetId: "phone", ears: "follow" });
    room.bytes(host);
    expect(phone.frames().length).toBe(2);
  });

  it("sends to every socket of a following device, and still not to the sender", async () => {
    const { room, host, tv } = await party();
    const tvAgain = await room.renderer("tv");
    room.bytes(host);
    expect(tv.frames().length).toBe(1);
    expect(tvAgain.frames().length).toBe(1);
  });

  it("drops binary from a device that is not a feed, and from one the room has no record of", async () => {
    const { room, host, tv, pad, phone } = await party();
    room.bytes(tv);
    room.bytes(phone);
    for (const ws of [host, tv, pad, phone]) expect(ws.frames()).toEqual([]);
    // A device that said it has no mic can never be a feed: the room refuses the change.
    room.say(tv, { type: "deviceSet", targetId: "tv", ears: "own" });
    expect(tv.msgs("deviceReject")).toEqual([{ type: "deviceReject", targetId: "tv", reason: "no-mic" }]);
    room.bytes(tv);
    expect(host.frames()).toEqual([]);
  });

  it("keeps the frame cap in a claimed room", async () => {
    const { room, host, tv } = await party();
    room.bytes(host, LOOK_LIMITS.maxBinaryBytes + 1);
    expect(tv.frames()).toEqual([]);
    room.bytes(host, LOOK_LIMITS.maxBinaryBytes);
    expect(tv.frames().length).toBe(1);
  });

  it("relays the same bytes it was given, unparsed", async () => {
    const room = new Room();
    const host = await room.need({ role: "host", deviceId: "laptop" });
    const tv = await room.need({ role: "renderer", deviceId: "tv" });
    const frame = new Uint8Array(40).map((_, i) => i).buffer;
    room.core.message(host, frame);
    expect(tv.frames()[0]).toBe(frame);
  });

  it("relays frames in a legacy room as before: the host's to every renderer, nobody else's", async () => {
    const room = new Room();
    const host = await room.need({ role: "host", deviceId: "laptop" });
    const tv = await room.need({ role: "renderer", deviceId: "tv" });
    const tv2 = await room.need({ role: "renderer", deviceId: "tv2" });
    room.bytes(host, 39);
    expect(tv.frames().length).toBe(1);
    expect(tv2.frames().length).toBe(1);
    room.bytes(tv);
    expect(host.frames()).toEqual([]);
    expect(tv2.frames().length).toBe(1);
  });
});

describe("adopt", () => {
  const N = "n".repeat(22);
  const body = { room: "ABCD", k: K, n: N };
  const expected = { type: "adopt", room: "ABCD", k: K, n: N };

  it("delivers to the screen that presented the nonce, and to nothing else", async () => {
    const room = new Room();
    const tv = await room.need({ role: "renderer", deviceId: "tv", adopt: N });
    const host = await room.need({ role: "host", deviceId: "laptop" });
    expect(tv.tags).toEqual(["renderer", "tv", adoptTag(N), ADOPT_ANY_TAG]);
    expect(room.core.adopt(body)).toEqual({ status: 200, body: { delivered: 1 } });
    expect(tv.msgs("adopt")).toEqual([expected]);
    expect(host.sent).toEqual([]);
  });

  it("a body without a nonce (a laptop's typed code) reaches every screen waiting in the slot", async () => {
    const room = new Room();
    const tv = await room.need({ role: "renderer", deviceId: "tv", adopt: N });
    const plain = await room.need({ role: "renderer", deviceId: "plain" });
    expect(room.core.adopt({ room: "ABCD", k: K })).toEqual({ status: 200, body: { delivered: 1 } });
    expect(tv.msgs("adopt")).toEqual([{ type: "adopt", room: "ABCD", k: K }]);
    expect(plain.sent).toEqual([]);
    expect(room.core.adopt({ room: "ABCD", k: K, n: "short" }).status).toBe(400);
  });

  it("a body without a nonce is refused, delivering nothing, when a second socket waits in the slot", async () => {
    const room = new Room();
    const tv = await room.need({ role: "renderer", deviceId: "tv", adopt: N });
    const bystander = await room.need({ role: "renderer", deviceId: "bystander", adopt: "g".repeat(22) });
    expect(room.core.adopt({ room: "ABCD", k: K })).toEqual({ status: 409, body: { delivered: 0 } });
    expect(tv.sent).toEqual([]);
    expect(bystander.sent).toEqual([]);
  });

  it("never reaches a bystander sitting in the slot, whatever they present", async () => {
    // The slot's code is printed on the TV, so anyone can join it as a keyless renderer.
    const room = new Room();
    const bystander = await room.need({ role: "renderer", deviceId: "bystander" });
    const guesser = await room.need({ role: "renderer", deviceId: "guesser", adopt: "g".repeat(22) });
    const tv = await room.need({ role: "renderer", deviceId: "tv", adopt: N });
    // Even a bystander who reads the TV's device id off the roster gets nothing.
    const copycat = await room.need({ role: "renderer", deviceId: "tv" });
    room.say(bystander, { type: "hello", scene: "x" });
    expect(bystander.msgs("roster").length).toBeGreaterThan(0);
    for (const ws of [bystander, guesser, tv, copycat]) ws.clear();

    expect(room.core.adopt(body)).toEqual({ status: 200, body: { delivered: 1 } });
    expect(tv.msgs("adopt")).toEqual([expected]);
    for (const ws of [bystander, guesser, copycat]) expect(ws.sent).toEqual([]);
  });

  it("keeps the nonce out of the roster", async () => {
    const room = new Room();
    const tv = await room.need({ role: "renderer", deviceId: "tv", adopt: N });
    const other = await room.need({ role: "renderer", deviceId: "other" });
    room.say(other, { type: "hello" });
    expect(JSON.stringify(other.sent)).not.toContain(N);
    expect(JSON.stringify(tv.sent)).not.toContain(N);
  });

  it("delivers to every socket that presented the nonce", async () => {
    const room = new Room();
    const a = await room.need({ role: "renderer", deviceId: "a", adopt: N });
    const b = await room.need({ role: "renderer", deviceId: "b", adopt: N });
    expect(room.core.adopt(body)).toEqual({ status: 200, body: { delivered: 2 } });
    expect(a.msgs("adopt")).toEqual([expected]);
    expect(b.msgs("adopt")).toEqual([expected]);
  });

  it("gives a nonce tag only to a keyless renderer with a well-formed nonce", async () => {
    const room = new Room();
    const host = await room.need({ role: "host", deviceId: "laptop", adopt: N });
    expect(host.tags).toEqual(["host", "laptop"]);
    const malformed = await room.need({ role: "renderer", deviceId: "tv", adopt: "not a nonce!" });
    expect(malformed.tags).toEqual(["renderer", "tv"]);
    const claimed = new Room();
    await claimed.claimed();
    const keyed = await claimed.need({ role: "renderer", deviceId: "tv", k: K, adopt: N });
    expect(keyed.tags).toEqual(["renderer", "tv"]);
  });

  it("answers 404 when no screen holds the nonce, and counts only sends that landed", async () => {
    const room = new Room();
    expect(room.core.adopt(body)).toEqual({ status: 404, body: { delivered: 0 } });
    await room.need({ role: "renderer", deviceId: "other", adopt: "o".repeat(22) });
    expect(room.core.adopt(body)).toEqual({ status: 404, body: { delivered: 0 } });
    const gone = await room.need({ role: "renderer", deviceId: "gone", adopt: N });
    gone.throwOnSend = true;
    expect(room.core.adopt(body)).toEqual({ status: 404, body: { delivered: 0 } });
    const live = await room.need({ role: "renderer", deviceId: "live", adopt: N });
    expect(room.core.adopt(body)).toEqual({ status: 200, body: { delivered: 1 } });
    expect(live.msgs("adopt").length).toBe(1);
  });

  it("answers 404 in a claimed room, whoever is connected", async () => {
    const room = new Room();
    await room.claimed();
    const phone = await room.controller();
    const tv = await room.renderer();
    tv.tags.push(adoptTag(N)); // even a socket that somehow carries the tag
    phone.clear();
    tv.clear();
    expect(room.core.adopt(body)).toEqual({ status: 404, body: { delivered: 0 } });
    expect(phone.sent).toEqual([]);
    expect(tv.sent).toEqual([]);
  });

  it("stops answering once a laptop claims the slot", async () => {
    const room = new Room();
    const tv = await room.need({ role: "renderer", deviceId: "tv", adopt: N });
    await room.claimed(); // closes the keyless socket, which the platform then drops
    expect(tv.closedWith?.code).toBe(ROOM_CLOSE_DENIED);
    room.host.live = room.host.live.filter((s) => s !== tv);
    expect(room.core.adopt(body).status).toBe(404);
  });

  it("answers 400 to a malformed body", async () => {
    const room = new Room();
    const tv = await room.need({ role: "renderer", deviceId: "tv", adopt: N });
    const bad: unknown[] = [
      null,
      "ABCD",
      [],
      {},
      { ...body, room: "abcd" },
      { ...body, room: "ABC" },
      { ...body, room: "AB0D" },
      { ...body, room: 1234 },
      { ...body, k: "short" },
      { ...body, k: 12 },
      { ...body, n: "bad nonce bad nonce!!" },
    ];
    for (const b of bad) expect(room.core.adopt(b)).toEqual({ status: 400, body: { error: "bad-request" } });
    expect(tv.sent).toEqual([]);
  });

  it("forwards only the known fields", async () => {
    const room = new Room();
    const tv = await room.need({ role: "renderer", deviceId: "tv", adopt: N });
    room.core.adopt({ ...body, extra: "x".repeat(50) });
    expect(Object.keys(tv.msgs("adopt")[0]).sort()).toEqual(["k", "n", "room", "type"]);
  });
});

describe("the look", () => {
  it("opens with a null document at revision 0 for every keyed socket, the host's included", async () => {
    const room = new Room();
    const host = await room.claimed();
    const phone = await room.player();
    const tv = await room.renderer();
    expect(host.msgs("look")).toEqual([{ type: "look", rev: 0, doc: null }]);
    expect(phone.msgs("look")).toEqual([{ type: "look", rev: 0, doc: null }]);
    expect(tv.msgs("look")).toEqual([{ type: "look", rev: 0, doc: null }]);
  });

  it("pushes no look to a legacy room's sockets", async () => {
    const room = new Room();
    const tv = await room.need({ role: "renderer", deviceId: "tv" });
    expect(tv.sent).toEqual([]);
  });

  it("applies a patch: ack, one revision, broadcast to everyone but the sender, the host included, naming the sender", async () => {
    const room = new Room();
    const host = await room.claimed();
    const phone = await room.player("phone");
    const phone2 = await room.player("phone2");
    const tv = await room.renderer();
    [host, phone, phone2, tv].forEach((s) => s.clear());

    room.say(phone, { type: "lookPatch", n: 1, scene: "mesh", palette: "ember", set: { "vibe.a": "1", "vibe.b": "2" } });

    expect(phone.msgs()).toEqual([{ type: "lookAck", n: 1, rev: 1 }]);
    const expected = { type: "lookPatch", rev: 1, by: "phone", scene: "mesh", palette: "ember", set: { "vibe.a": "1", "vibe.b": "2" } };
    expect(tv.msgs()).toEqual([expected]);
    expect(phone2.msgs()).toEqual([expected]);
    expect(host.msgs()).toEqual([expected]);
  });

  it("broadcasts only the entries that changed", async () => {
    const room = new Room();
    await room.claimed();
    const phone = await room.player();
    const tv = await room.renderer();
    room.say(phone, { type: "lookPatch", n: 1, scene: "mesh", set: { "vibe.a": "1", "vibe.b": "2" } });
    tv.clear();
    room.say(phone, { type: "lookPatch", n: 2, scene: "mesh", set: { "vibe.a": "1", "vibe.b": "3" }, del: ["vibe.gone"] });
    expect(tv.msgs()).toEqual([{ type: "lookPatch", rev: 2, by: "phone", set: { "vibe.b": "3" } }]);
  });

  it("treats a no-op patch as acked with the same revision: no bump, no write, no broadcast", async () => {
    const room = new Room();
    await room.claimed();
    const phone = await room.player();
    const tv = await room.renderer();
    room.say(phone, { type: "lookPatch", n: 1, scene: "mesh", set: { "vibe.a": "1" } });
    phone.clear();
    tv.clear();
    room.host.puts = [];

    room.say(phone, { type: "lookPatch", n: 2, scene: "mesh", set: { "vibe.a": "1" } });
    room.say(phone, { type: "lookPatch", n: 3 });
    room.say(phone, { type: "lookPatch", n: 4, del: ["vibe.never-there"] });

    expect(phone.msgs()).toEqual([
      { type: "lookAck", n: 2, rev: 1 },
      { type: "lookAck", n: 3, rev: 1 },
      { type: "lookAck", n: 4, rev: 1 },
    ]);
    expect(tv.sent).toEqual([]);
    expect(room.host.puts).toEqual([]);
  });

  it("applies a delete and removes its row", async () => {
    const room = new Room();
    await room.claimed();
    const phone = await room.player();
    const tv = await room.renderer();
    room.say(phone, { type: "lookPatch", n: 1, set: { "vibe.a": "1", "vibe.b": "2" } });
    tv.clear();
    room.say(phone, { type: "lookPatch", n: 2, del: ["vibe.a"] });
    expect(tv.msgs()).toEqual([{ type: "lookPatch", rev: 2, by: "phone", del: ["vibe.a"] }]);
    expect(room.host.store.has("k:vibe.a")).toBe(false);
    expect(room.host.store.get("k:vibe.b")).toBe("2");
  });

  it("replies to lookGet with the current document, and a late joiner gets the same", async () => {
    const room = new Room();
    await room.claimed();
    const phone = await room.player();
    room.say(phone, { type: "lookPatch", n: 1, scene: "mesh", palette: "ember", set: { "vibe.a": "1" } });
    const doc = { scene: "mesh", palette: "ember", storage: { "vibe.a": "1" } };
    phone.clear();
    room.say(phone, { type: "lookGet" });
    expect(phone.msgs()).toEqual([{ type: "look", rev: 1, doc }]);
    const late = await room.renderer("late");
    expect(late.msgs("look")).toEqual([{ type: "look", rev: 1, doc }]);
  });

  it("rejects bad patches without touching state", async () => {
    const room = new Room();
    await room.claimed();
    const phone = await room.player();
    const tv = await room.renderer();
    room.say(phone, { type: "lookPatch", n: 1, set: { "vibe.keep": "1" } });
    const rowsBefore = new Map(room.host.store);
    phone.clear();
    tv.clear();
    room.host.puts = [];

    const cases: Array<[Record<string, unknown>, string]> = [
      [{ n: 10, set: { __proto__x: "1" } }, "shape"],
      [{ n: 11, set: { "vibe.": "1" } }, "shape"],
      [{ n: 12, set: { constructor: "1" } }, "shape"],
      [{ n: 13, set: { "vibe.a": 5 } }, "shape"],
      [{ n: 14, del: ["prototype"] }, "shape"],
      [{ n: 15, set: { "vibe.a": "1" }, del: ["vibe.a"] }, "shape"],
      [{ n: 16, scene: "bad scene id" }, "shape"],
      [{ n: 17, set: { "vibe.big": "x".repeat(LOOK_LIMITS.maxValueBytes + 1) } }, "size"],
    ];
    for (const [patch, reason] of cases) {
      room.say(phone, { type: "lookPatch", ...patch });
      expect(phone.msgs("lookReject").pop()).toEqual({ type: "lookReject", n: patch.n, reason });
    }
    // An own "__proto__" key, which JSON.parse produces and an object literal doesn't.
    room.say(phone, `{"type":"lookPatch","n":18,"set":{"__proto__":"1"}}`);
    expect(phone.msgs("lookReject").pop()).toEqual({ type: "lookReject", n: 18, reason: "shape" });

    expect(phone.msgs("lookAck")).toEqual([]);
    expect(tv.sent).toEqual([]);
    expect(room.host.puts).toEqual([]);
    expect(room.host.store).toEqual(rowsBefore);
    phone.clear();
    room.say(phone, { type: "lookGet" });
    expect(phone.msgs("look")[0].rev).toBe(1);
  });

  it("rejects a patch with no integer n as a shape error addressed to nobody", async () => {
    const room = new Room();
    await room.claimed();
    const phone = await room.player();
    phone.clear();
    for (const n of [undefined, "1", 1.5, null, Infinity]) {
      room.say(phone, `{"type":"lookPatch","n":${JSON.stringify(n) ?? "null"},"set":{"vibe.a":"1"}}`);
    }
    room.say(phone, { type: "lookPatch", set: { "vibe.a": "1" } });
    const rejects = phone.msgs("lookReject");
    expect(rejects.length).toBe(6);
    for (const r of rejects) expect(r).toEqual({ type: "lookReject", n: null, reason: "shape" });
  });

  it("rejects a patch that would take the document past the key or size limit", async () => {
    const room = new Room();
    await room.claimed();
    const phone = await room.player();

    const many: Record<string, string> = {};
    for (let i = 0; i < LOOK_LIMITS.maxKeys; i++) many[`vibe.k${i}`] = "v";
    room.say(phone, { type: "lookPatch", n: 1, set: many });
    expect(phone.msgs("lookAck").pop()).toEqual({ type: "lookAck", n: 1, rev: 1 });
    room.say(phone, { type: "lookPatch", n: 2, set: { "vibe.one-too-many": "v" } });
    expect(phone.msgs("lookReject").pop()).toEqual({ type: "lookReject", n: 2, reason: "size" });
    expect(room.host.store.has("k:vibe.one-too-many")).toBe(false);

    const room2 = new Room();
    await room2.claimed();
    const phone2 = await room2.player();
    const chunk = "x".repeat(LOOK_LIMITS.maxValueBytes);
    room2.say(phone2, { type: "lookPatch", n: 1, set: { "vibe.a": chunk } });
    room2.say(phone2, { type: "lookPatch", n: 2, set: { "vibe.b": chunk } });
    expect(phone2.msgs("lookAck").map((m) => m.n)).toEqual([1]);
    expect(phone2.msgs("lookReject").pop()).toEqual({ type: "lookReject", n: 2, reason: "size" });
    expect(room2.host.store.has("k:vibe.b")).toBe(false);
  });

  it("persists rows that equal the in-memory document", async () => {
    const room = new Room();
    await room.claimed();
    const phone = await room.player();
    room.say(phone, { type: "lookPatch", n: 1, scene: "mesh", palette: "ember", set: { "vibe.a": "1", "vibe.b": "2" } });
    room.say(phone, { type: "lookPatch", n: 2, del: ["vibe.a"], set: { "vibe.c": "3" } });
    expect(JSON.parse(room.host.store.get("look") ?? "null")).toEqual({ rev: 2, scene: "mesh", palette: "ember" });
    const keyRows = [...room.host.store.keys()].filter((k) => k.startsWith("k:")).sort();
    expect(keyRows).toEqual(["k:vibe.b", "k:vibe.c"]);
    room.say(phone, { type: "lookGet" });
    expect(phone.msgs("look").pop()).toEqual({
      type: "look",
      rev: 2,
      doc: { scene: "mesh", palette: "ember", storage: { "vibe.b": "2", "vibe.c": "3" } },
    });
  });

  it("writes only the rows a patch changed", async () => {
    const room = new Room();
    await room.claimed();
    const phone = await room.player();
    room.say(phone, { type: "lookPatch", n: 1, set: { "vibe.a": "1", "vibe.b": "2" } });
    room.host.puts = [];
    room.say(phone, { type: "lookPatch", n: 2, set: { "vibe.a": "1", "vibe.b": "3" } });
    expect(room.host.puts.sort()).toEqual(["k:vibe.b", "look"]);
  });
});

describe("the patch budget", () => {
  /** A patch that always changes something: alternates one key between two values. */
  const flip = (n: number): Record<string, unknown> => ({
    type: "lookPatch",
    n,
    set: { "vibe.a": n % 2 === 0 ? "1" : "2" },
  });

  it("lets a controller through at the publisher's pace for as long as it likes", async () => {
    const room = new Room();
    await room.claimed();
    const phone = await room.player();
    phone.clear();
    // Stop-and-wait at its cadence is the most a real phone sends; an hour of dragging.
    const sends = Math.ceil((60 * 60 * 1000) / LOOK_PUBLISH_MS);
    for (let n = 1; n <= sends; n++) {
      room.say(phone, flip(n));
      room.host.time += LOOK_PUBLISH_MS;
    }
    expect(phone.msgs("lookReject")).toEqual([]);
    expect(phone.msgs("lookAck").length).toBe(sends);
  });

  it("outpaces the publisher with room to spare", () => {
    expect(LOOK_LIMITS.patchesPerSec).toBeGreaterThanOrEqual((2 * 1000) / LOOK_PUBLISH_MS);
    expect(LOOK_LIMITS.patchBurst).toBeGreaterThanOrEqual(LOOK_LIMITS.patchesPerSec);
  });

  it("answers a flood with lookReject, writes nothing for the excess, and tells the others nothing", async () => {
    const room = new Room();
    await room.claimed();
    const phone = await room.player();
    const tv = await room.renderer();
    phone.clear();
    tv.clear();
    room.host.puts = [];

    const flood = LOOK_LIMITS.patchBurst * 3;
    for (let n = 1; n <= flood; n++) room.say(phone, flip(n)); // the clock never moves

    expect(phone.msgs("lookAck").length).toBe(LOOK_LIMITS.patchBurst);
    const rejects = phone.msgs("lookReject");
    expect(rejects.length).toBe(flood - LOOK_LIMITS.patchBurst);
    expect(rejects[0]).toEqual({ type: "lookReject", n: LOOK_LIMITS.patchBurst + 1, reason: "size" });
    expect(tv.msgs("lookPatch").length).toBe(LOOK_LIMITS.patchBurst);
    // Two rows per accepted patch (the look row and the key), none for the rest.
    expect(room.host.puts.length).toBe(LOOK_LIMITS.patchBurst * 2);
  });

  it("refills as time passes, and never beyond the burst", async () => {
    const room = new Room();
    await room.claimed();
    const phone = await room.player();
    for (let n = 1; n <= LOOK_LIMITS.patchBurst; n++) room.say(phone, flip(n));
    phone.clear();
    room.say(phone, flip(1000));
    expect(phone.msgs("lookReject").length).toBe(1);

    room.host.time += 1000 / LOOK_LIMITS.patchesPerSec; // one token's worth
    phone.clear();
    room.say(phone, flip(1001));
    room.say(phone, flip(1002));
    expect(phone.msgs("lookAck").length).toBe(1);
    expect(phone.msgs("lookReject").length).toBe(1);

    room.host.time += 24 * 60 * 60 * 1000; // a day idle banks no more than the burst
    phone.clear();
    for (let n = 2000; n < 2000 + LOOK_LIMITS.patchBurst + 5; n++) room.say(phone, flip(n));
    expect(phone.msgs("lookAck").length).toBe(LOOK_LIMITS.patchBurst);
    expect(phone.msgs("lookReject").length).toBe(5);
  });

  it("keeps one budget per socket", async () => {
    const room = new Room();
    await room.claimed();
    const noisy = await room.player("noisy");
    const calm = await room.player("calm");
    for (let n = 1; n <= LOOK_LIMITS.patchBurst + 1; n++) room.say(noisy, flip(n));
    calm.clear();
    room.say(calm, flip(1));
    expect(calm.msgs("lookAck").length).toBe(1);
  });

  it("gives a reconnecting socket a fresh budget", async () => {
    const room = new Room();
    await room.claimed();
    const first = await room.player("phone");
    for (let n = 1; n <= LOOK_LIMITS.patchBurst; n++) room.say(first, flip(n));
    room.close(first);
    const second = await room.player("phone");
    second.clear();
    room.say(second, flip(1));
    expect(second.msgs("lookAck").length).toBe(1);
  });

  it("charges a patch whether or not it changes anything", async () => {
    const room = new Room();
    await room.claimed();
    const phone = await room.player();
    room.say(phone, flip(1));
    phone.clear();
    for (let n = 2; n <= LOOK_LIMITS.patchBurst + 2; n++) room.say(phone, { type: "lookPatch", n }); // all no-ops
    expect(phone.msgs("lookReject").length).toBe(2);
  });

  it("still answers a socket that may not patch with role, not with the budget", async () => {
    const room = new Room();
    await room.claimed();
    const tv = await room.renderer();
    tv.clear();
    for (let n = 1; n <= LOOK_LIMITS.patchBurst + 5; n++) room.say(tv, flip(n));
    expect(tv.msgs("lookReject").every((m) => m.reason === "role")).toBe(true);
  });
});

describe("a cold start", () => {
  it("rebuilds the claim, the revision and the document from the persisted rows", async () => {
    const room = new Room();
    await room.claimed();
    const phone = await room.player();
    room.say(phone, { type: "lookPatch", n: 1, scene: "mesh", set: { "vibe.a": "1", "vibe.b": "2" } });
    room.say(phone, { type: "lookPatch", n: 2, palette: "ember", set: { "vibe.a": "one" }, del: ["vibe.b"] });
    room.say(phone, { type: "lookGet" });
    const before = phone.msgs("look").pop();

    const again = room.reborn();
    // Same keys are accepted, others are not.
    expect(await again.connect({ role: "host", hk: OTHER_HK, k: OTHER_K })).toBeNull();
    expect(await again.connect({ role: "renderer" })).toBeNull();
    const host = await again.need({ role: "host", deviceId: "laptop", hk: HK, k: K });
    expect(host.attachment.keyed).toBe(true);
    const tv = await again.renderer();
    expect(tv.msgs("look")).toEqual([before]);

    // And revisions go on from where they were.
    const phone2 = await again.player("phone");
    tv.clear();
    again.say(phone2, { type: "lookPatch", n: 1, set: { "vibe.z": "9" } });
    expect(phone2.msgs("lookAck").pop()).toEqual({ type: "lookAck", n: 1, rev: 3 });
    expect(tv.msgs()).toEqual([{ type: "lookPatch", rev: 3, by: "phone", set: { "vibe.z": "9" } }]);
  });

  it("starts unclaimed from empty storage, and from a claim it can't read", async () => {
    const room = new Room(new Map([["meta", "{not json"], ["look", '{"rev":3}'], ["k:vibe.a", "1"]]));
    const tv = await room.need({ role: "renderer", deviceId: "tv" });
    expect(tv.attachment.keyed).toBe(false);
    expect(await room.connect({ role: "controller", k: K })).toBeNull();
    const host = await room.claimed();
    expect(host.attachment.keyed).toBe(true);
    const phone = await room.player();
    expect(phone.msgs("look")).toEqual([{ type: "look", rev: 0, doc: null }]);
  });

  it("ignores rows that don't belong to a valid look", async () => {
    const first = new Room();
    await first.claimed();
    const rows = new Map(first.host.store);
    rows.set("look", JSON.stringify({ rev: 2, scene: "mesh", palette: "bad palette" }));
    rows.set("k:vibe.ok", "1");
    rows.set("k:__proto__", "x");
    rows.set("k:notvibe", "x");
    rows.set("unrelated", "x");
    const room = new Room(rows);
    const phone = await room.controller();
    expect(phone.msgs("look")).toEqual([
      { type: "look", rev: 2, doc: { scene: "mesh", palette: "", storage: { "vibe.ok": "1" } } },
    ]);
  });
});

describe("expiry", () => {
  it("schedules the wipe when the last socket of a claimed room leaves", async () => {
    const room = new Room();
    const host = await room.claimed();
    const phone = await room.player();
    room.close(phone);
    expect(room.host.alarmAt).toBeNull();
    room.close(host);
    expect(room.host.alarmAt).toBe(room.host.time + ROOM_IDLE_TTL_MS);
  });

  it("counts the closing socket out even if the platform still lists it", async () => {
    const room = new Room();
    const host = await room.claimed();
    room.close(host, false);
    expect(room.host.alarmAt).toBe(room.host.time + ROOM_IDLE_TTL_MS);
  });

  it("does not wait on a room nobody claimed", async () => {
    const room = new Room();
    const tv = await room.need({ role: "renderer", deviceId: "tv" });
    room.close(tv);
    expect(room.host.alarmAt).toBeNull();
    expect(room.host.alarmSets).toBe(0);
  });

  it("cancels the countdown when a socket is accepted into a claimed room", async () => {
    const room = new Room();
    const host = await room.claimed();
    room.close(host);
    expect(room.host.alarmAt).not.toBeNull();
    await room.need({ role: "host", deviceId: "laptop", hk: HK, k: K });
    expect(room.host.alarmAt).toBeNull();
  });

  it("does nothing when the alarm fires while a socket is connected", async () => {
    const room = new Room();
    await room.claimed();
    const phone = await room.player();
    room.say(phone, { type: "lookPatch", n: 1, set: { "vibe.a": "1" } });
    room.core.alarm();
    expect(room.host.removeAlls).toBe(0);
    expect(room.host.store.size).toBeGreaterThan(0);
    expect(await room.connect({ role: "renderer" })).toBeNull();
  });

  it("wipes an empty claimed room when the alarm fires, leaving the code unclaimed", async () => {
    const room = new Room();
    const host = await room.claimed();
    const phone = await room.player();
    room.say(phone, { type: "lookPatch", n: 1, scene: "mesh", set: { "vibe.a": "1" } });
    room.close(phone);
    room.close(host);

    room.core.alarm();
    expect(room.host.removeAlls).toBe(1);
    expect(room.host.store.size).toBe(0);

    // Unclaimed again: a keyless renderer is a legacy join, a controller is denied,
    // the old keys no longer open anything, and another laptop can claim it.
    expect((await room.need({ role: "renderer", deviceId: "tv" })).attachment.keyed).toBe(false);
    expect(await room.connect({ role: "controller", k: K })).toBeNull();
    room.host.live = [];
    const next = await room.need({ role: "host", deviceId: "laptop", hk: OTHER_HK, k: OTHER_K });
    expect(next.attachment.keyed).toBe(true);
    const viewer = await room.need({ role: "controller", deviceId: "phone", k: OTHER_K });
    expect(viewer.msgs("look")).toEqual([{ type: "look", rev: 0, doc: null }]);
  });

  it("ignores an alarm on a room nobody claimed", async () => {
    const room = new Room();
    room.core.alarm();
    expect(room.host.removeAlls).toBe(0);
  });
});

describe("the roster", () => {
  it("in a claimed room lists every member, controllers included, with its settings, and goes to everyone", async () => {
    const room = new Room();
    const host = await room.claimed();
    const phone = await room.controller("phone", { name: "Ann's phone", mic: true });
    const tv = await room.renderer();
    room.say(tv, { type: "hello", scene: "mesh", palette: "ember", viewport: { x: 0, y: 0, w: 0.5, h: 1 }, autoQuality: "mid" });
    room.say(phone, { type: "hello", scene: "phone-scene", palette: "ice", autoQuality: "ultra" });

    const devices = [
      {
        deviceId: "laptop", role: "host", scene: "", palette: "", viewport: { x: 0, y: 0, w: 1, h: 1 },
        kind: "laptop", name: "Laptop", hasMic: true, ears: "own", follow: null, screen: "main", quality: "auto", canPlay: true, autoQuality: null, online: true, owner: true,
      },
      {
        deviceId: "phone", role: "controller", scene: "phone-scene", palette: "ice", viewport: { x: 0, y: 0, w: 1, h: 1 },
        kind: "phone", name: "Ann's phone", hasMic: true, ears: "follow", follow: null, screen: "off", quality: "auto", canPlay: false, autoQuality: null, online: true, owner: false,
      },
      {
        deviceId: "tv", role: "renderer", scene: "mesh", palette: "ember", viewport: { x: 0, y: 0, w: 0.5, h: 1 },
        kind: "tv", name: "TV", hasMic: false, ears: "follow", follow: null, screen: "main", quality: "auto", canPlay: false, autoQuality: "mid", online: true, owner: false,
      },
    ];
    for (const ws of [host, phone, tv]) expect(ws.msgs("roster").pop()).toEqual({ type: "roster", devices });
  });

  it("stores a TV's quality from any member, and lists what its own benchmark picks only while it is online", async () => {
    const room = new Room();
    const host = await room.claimed();
    const phone = await room.controller("phone");
    const tv = await room.renderer();
    room.say(tv, { type: "hello", scene: "mesh", autoQuality: "high" });
    room.say(phone, { type: "deviceSet", targetId: "tv", quality: "low" });
    const listed = (ws: typeof host) => roster(ws).find((d) => d.deviceId === "tv");
    for (const ws of [host, phone, tv]) expect(listed(ws)).toMatchObject({ quality: "low", autoQuality: "high" });
    room.close(tv);
    expect(listed(host)).toMatchObject({ quality: "low", autoQuality: null, online: false });
  });

  it("is sent to every socket when one opens, and when one leaves, which leaves its device listed but offline", async () => {
    const room = new Room();
    const host = await room.claimed();
    host.clear();
    const phone = await room.controller("phone");
    expect(roster(host).map((d) => d.deviceId)).toEqual(["laptop", "phone"]);
    expect(roster(phone).map((d) => d.deviceId)).toEqual(["laptop", "phone"]);
    room.say(phone, { type: "hello", scene: "mesh" });
    room.close(phone);
    const after = roster(host);
    expect(after.map((d) => [d.deviceId, d.online])).toEqual([["laptop", true], ["phone", false]]);
    expect(after[1]).toMatchObject({ scene: "", palette: "", viewport: FULL_VIEWPORT });
    expect(phone.msgs("roster").length).toBe(2); // its own open, and its hello; none after it left
  });

  it("keeps a device online while another socket of it is still connected", async () => {
    const room = new Room();
    const host = await room.claimed();
    const first = await room.controller("phone");
    await room.controller("phone");
    room.close(first);
    expect(roster(host).find((d) => d.deviceId === "phone")?.online).toBe(true);
  });

  it("lists the owner first, then the others in the order they were added", async () => {
    const first = new Room();
    await first.claimed();
    await first.controller("a");
    await first.controller("b");
    const rows = new Map(first.host.store);
    const laptop = JSON.parse(rows.get("d:laptop") ?? "{}");
    const a = JSON.parse(rows.get("d:a") ?? "{}");
    const b = JSON.parse(rows.get("d:b") ?? "{}");
    rows.set("d:laptop", JSON.stringify({ ...laptop, added: 300 }));
    rows.set("d:a", JSON.stringify({ ...a, added: 200 }));
    rows.set("d:b", JSON.stringify({ ...b, added: 100 }));
    const room = new Room(rows);
    const host = await room.need({ role: "host", deviceId: "laptop", hk: HK, k: K });
    expect(roster(host).map((d) => d.deviceId)).toEqual(["laptop", "b", "a"]);
  });

  it("keeps the shape an old client expects in a legacy room", async () => {
    const room = new Room();
    const host = await room.need({ role: "host", deviceId: "laptop" });
    const tv = await room.need({ role: "renderer", deviceId: "tv" });
    room.say(tv, { type: "hello", scene: "mesh", palette: "ember" });
    expect(host.msgs("roster").pop()).toEqual({
      type: "roster",
      devices: [
        { deviceId: "laptop", role: "host", scene: "", palette: "", viewport: { x: 0, y: 0, w: 1, h: 1 } },
        { deviceId: "tv", role: "renderer", scene: "mesh", palette: "ember", viewport: { x: 0, y: 0, w: 1, h: 1 } },
      ],
    });
  });

  it("clamps hello strings, keeping the previous value for one that is too long or not a string", async () => {
    const room = new Room();
    const tv = await room.need({ role: "renderer", deviceId: "tv" });
    room.say(tv, { type: "hello", scene: "mesh", palette: "ember" });
    room.say(tv, { type: "hello", scene: "s".repeat(LOOK_LIMITS.maxIdChars + 1), palette: 7 });
    expect(tv.attachment.scene).toBe("mesh");
    expect(tv.attachment.palette).toBe("ember");
    room.say(tv, { type: "hello", scene: "s".repeat(LOOK_LIMITS.maxIdChars), palette: "has spaces and ünïcode" });
    expect(tv.attachment.scene).toBe("s".repeat(LOOK_LIMITS.maxIdChars));
    expect(tv.attachment.palette).toBe("has spaces and ünïcode");
  });

  it("accepts a viewport only when all four parts are finite numbers", async () => {
    const room = new Room();
    const tv = await room.need({ role: "renderer", deviceId: "tv" });
    room.say(tv, { type: "hello", viewport: { x: 0.25, y: 0, w: 0.5, h: 1 } });
    expect(tv.attachment.viewport).toEqual({ x: 0.25, y: 0, w: 0.5, h: 1 });
    room.say(tv, { type: "hello", viewport: { x: 0, y: 0, w: "1", h: 1 } });
    room.say(tv, { type: "hello", viewport: { x: 0, y: 0, w: 1 } });
    room.say(tv, `{"type":"hello","viewport":{"x":0,"y":0,"w":1e999,"h":1}}`);
    expect(tv.attachment.viewport).toEqual({ x: 0.25, y: 0, w: 0.5, h: 1 });
  });

  it("tells the others when a socket leaves, without listing the one that left", async () => {
    const room = new Room();
    const host = await room.need({ role: "host", deviceId: "laptop" });
    const tv = await room.need({ role: "renderer", deviceId: "tv" });
    const tv2 = await room.need({ role: "renderer", deviceId: "tv2" });
    host.clear();
    room.close(tv, false);
    const roster = host.msgs("roster").pop();
    expect((roster?.devices as Array<{ deviceId: string }>).map((d) => d.deviceId)).toEqual(["laptop", "tv2"]);
    expect(tv.msgs("roster")).toEqual([]);
    expect(tv2.msgs("roster").length).toBe(1);
  });
});

describe("device records", () => {
  const row = (room: Room, id: string): Record<string, unknown> => JSON.parse(room.host.store.get(`d:${id}`) ?? "null");

  it("makes a record for each device on open, from what its join query said", async () => {
    const room = new Room();
    await room.claimed();
    await room.controller("pad", { kind: "tablet", mic: true, name: "Studio iPad" });
    await room.controller("phone", { kind: "phone", mic: true });
    await room.renderer("tv");
    expect(row(room, "laptop")).toMatchObject({ role: "host", kind: "laptop", name: "Laptop", hasMic: true, ears: "own", follow: null, screen: "main" });
    expect(row(room, "pad")).toMatchObject({ role: "controller", kind: "tablet", name: "Studio iPad", hasMic: true, ears: "follow", screen: "main" });
    expect(row(room, "phone")).toMatchObject({ kind: "phone", name: "Phone", ears: "follow", screen: "off" });
    expect(row(room, "tv")).toMatchObject({ role: "renderer", kind: "tv", name: "TV", hasMic: false, ears: "follow", screen: "main" });
    expect(row(room, "pad")).toMatchObject({ added: room.host.time, seen: room.host.time });
  });

  it("keeps a returning device's choices, and takes only what it is and when it was seen from its new join", async () => {
    const room = new Room();
    await room.claimed();
    const pad = await room.controller("pad", { kind: "tablet", mic: true, name: "Studio iPad" });
    room.say(pad, { type: "deviceSet", targetId: "pad", name: "Kitchen", screen: "own" });
    room.close(pad);
    room.host.time += 5000;
    await room.controller("pad", { kind: "tablet", mic: false, name: "Something else" });
    expect(row(room, "pad")).toMatchObject({ name: "Kitchen", screen: "own", hasMic: false, added: 1_000_000, seen: 1_005_000 });
  });

  it("is rebuilt from the rows after hibernation: the same records and the same roster", async () => {
    const room = new Room();
    const host = await room.claimed();
    const pad = await room.controller("pad", { kind: "tablet", mic: true, name: "Studio iPad" });
    await room.controller("phone", { kind: "phone" });
    await room.renderer("tv");
    room.say(pad, { type: "deviceSet", targetId: "pad", ears: "own" });
    room.say(pad, { type: "deviceSet", targetId: "phone", follow: "pad", screen: "own" });
    const before = roster(host);

    const again = room.reborn();
    const host2 = await again.need({ role: "host", deviceId: "laptop", hk: HK, k: K, mic: true });
    const after = roster(host2);
    expect(after.map((d) => d.deviceId)).toEqual(before.map((d) => d.deviceId));
    const strip = (d: Record<string, unknown>) => ({ ...d, online: undefined, scene: undefined, palette: undefined });
    expect(after.map(strip)).toEqual(before.map(strip));
    expect(after.map((d) => d.online)).toEqual([true, false, false, false]);
    // And frames route by the restored records.
    const tv2 = await again.renderer("tv");
    const padAgain = await again.controller("pad", { kind: "tablet", mic: true });
    const phone2 = await again.controller("phone", { kind: "phone" });
    again.bytes(padAgain);
    expect(phone2.frames().length).toBe(1);
    expect(tv2.frames()).toEqual([]);
  });

  it("skips rows it can't read, rows under an illegal id, and every row of an unclaimed room", async () => {
    const first = new Room();
    await first.claimed();
    const rows = new Map(first.host.store);
    const good = rows.get("d:laptop") ?? "";
    rows.set("d:broken", "{nope");
    rows.set("d:bad id", good);
    rows.set("d:host", good);
    const room = new Room(rows);
    const host = await room.need({ role: "host", deviceId: "laptop", hk: HK, k: K });
    expect(roster(host).map((d) => d.deviceId)).toEqual(["laptop"]);

    const stray = new Room(new Map([["d:laptop", good]]));
    const tv = await stray.need({ role: "renderer", deviceId: "tv" });
    stray.say(tv, { type: "hello" });
    expect(tv.msgs("roster").pop()).toEqual({ type: "roster", devices: [{ deviceId: "tv", role: "renderer", scene: "", palette: "", viewport: FULL_VIEWPORT }] });
  });

  it("clears the records with the room: an idle wipe, and the host's Reset", async () => {
    const idle = new Room();
    const host = await idle.claimed();
    await idle.controller("pad");
    idle.close(host);
    idle.host.live = [];
    idle.core.alarm();
    expect(idle.host.store.size).toBe(0);
    const next = await idle.need({ role: "host", deviceId: "other", hk: OTHER_HK, k: OTHER_K });
    expect(roster(next).map((d) => d.deviceId)).toEqual(["other"]);

    const reset = new Room();
    const owner = await reset.claimed();
    await reset.controller("pad");
    reset.say(owner, { type: "endRoom" });
    reset.host.live = [];
    const fresh = await reset.need({ role: "host", deviceId: "laptop2", hk: OTHER_HK, k: OTHER_K });
    expect(roster(fresh).map((d) => d.deviceId)).toEqual(["laptop2"]);
  });

  it("stamps a device's last-seen time when its socket closes", async () => {
    const room = new Room();
    await room.claimed();
    const pad = await room.controller("pad");
    room.host.time += 7000;
    room.close(pad);
    expect(row(room, "pad")).toMatchObject({ added: 1_000_000, seen: 1_007_000 });
  });

  it("does not bring a forgotten device back when its old socket closes", async () => {
    const room = new Room();
    const host = await room.claimed();
    const pad = await room.controller("pad");
    room.say(host, { type: "deviceForget", targetId: "pad" });
    room.close(pad);
    expect(room.host.store.has("d:pad")).toBe(false);
  });

  it("lets a hello update what the device is, but never its name", async () => {
    const room = new Room();
    const host = await room.claimed();
    const pad = await room.controller("pad", { kind: "phone", mic: true, name: "Pad" });
    room.say(pad, { type: "hello", kind: "tablet", hasMic: false, name: "Hijack" });
    expect(row(room, "pad")).toMatchObject({ kind: "tablet", hasMic: false, name: "Pad" });
    expect(pad.attachment).toMatchObject({ kind: "tablet", hasMic: false });
    expect(roster(host).find((d) => d.deviceId === "pad")).toMatchObject({ kind: "tablet", hasMic: false, name: "Pad" });
    room.host.puts = [];
    room.say(pad, { type: "hello", kind: "fridge", hasMic: "yes", scene: "mesh" });
    expect(row(room, "pad")).toMatchObject({ kind: "tablet", hasMic: false });
    expect(room.host.puts).toEqual([]); // nothing about the record changed: no row written
    const tv = await room.renderer("tv");
    room.say(tv, { type: "hello", hasMic: true });
    expect(row(room, "tv").hasMic).toBe(false);
  });

  it("drops the record of the device that has been offline longest when the room holds too many, never the owner's", async () => {
    const room = new Room();
    const host = await room.claimed();
    room.close(host); // the owner is now the oldest record and offline
    for (let i = 0; i < DEVICE_LIMITS.maxStoredDevices - 1; i++) {
      room.host.time += 1000;
      const ws = await room.controller(`p${i}`);
      room.host.time += 1000;
      room.close(ws);
    }
    expect([...room.host.store.keys()].filter((k) => k.startsWith("d:")).length).toBe(DEVICE_LIMITS.maxStoredDevices);
    room.host.time += 1000;
    const online = await room.controller("online");
    const rows = [...room.host.store.keys()].filter((k) => k.startsWith("d:"));
    expect(rows.length).toBe(DEVICE_LIMITS.maxStoredDevices);
    expect(rows).toContain("d:laptop");
    expect(rows).not.toContain("d:p0");
    expect(rows).toContain("d:p1");
    expect(rows).toContain("d:online");
    expect(roster(online).map((d) => d.deviceId)).not.toContain("p0");
    room.host.time += 1000;
    await room.controller("online2");
    expect([...room.host.store.keys()]).not.toContain("d:p1");
  });

  it("gives a keyed non-host that presents the owner's device id a fresh id, leaving the owner's record alone", async () => {
    const room = new Room();
    const host = await room.claimed();
    const tv1 = await room.renderer("tv1");
    for (const role of ["renderer", "controller"] as const) {
      const imposter = await room.need({ role, deviceId: "laptop", k: K, kind: role === "renderer" ? "tv" : "phone" });
      expect(imposter.attachment.deviceId).not.toBe("laptop");
      expect(imposter.tags).not.toContain("laptop");
    }
    expect(row(room, "laptop")).toMatchObject({ role: "host", kind: "laptop", hasMic: true, ears: "own" });
    expect(roster(host).find((d) => d.deviceId === "laptop")).toMatchObject({ owner: true });
    // The owner's frames still reach the follower, and only through the owner's feed.
    tv1.clear();
    room.bytes(host);
    expect(tv1.frames().length).toBe(1);
    // The owner can remove one of them.
    const other = await room.controller("pad");
    room.say(host, { type: "deviceForget", targetId: "pad" });
    expect(other.closedWith).not.toBeNull();
    // The real owner reconnecting on its own id is still the owner.
    room.close(host);
    const again = await room.claimed();
    expect(again.attachment.deviceId).toBe("laptop");
    expect(row(room, "laptop")).toMatchObject({ role: "host" });
  });

  it("never changes a record's role when a socket rejoins under it", async () => {
    const room = new Room();
    await room.claimed();
    const pad = await room.controller("pad");
    room.close(pad);
    await room.renderer("pad");
    expect(row(room, "pad")).toMatchObject({ role: "controller" });
  });

  it("rations a hello that rewrites the device row: a flood of trait flips writes only the allowance", async () => {
    const room = new Room();
    await room.claimed();
    const pad = await room.controller("pad", { kind: "phone", mic: true });
    room.host.puts = [];
    for (let i = 0; i < 1000; i++) {
      room.say(pad, { type: "hello", kind: i % 2 === 0 ? "tablet" : "phone" });
    }
    expect(room.host.puts.length).toBeLessThanOrEqual(LOOK_LIMITS.patchBurst);
    // Out of allowance: the attachment and the row still agree.
    expect(pad.attachment.kind).toBe(row(room, "pad").kind);
  });

  it("points a feed's followers at another feed when the feed's record is evicted", async () => {
    const room = new Room();
    const host = await room.claimed();
    const tablet = await room.controller("tablet", { kind: "tablet", mic: true });
    const tv = await room.renderer("tv");
    room.say(tablet, { type: "deviceSet", targetId: "tablet", ears: "own" });
    room.say(tv, { type: "deviceSet", targetId: "tv", follow: "tablet" });
    room.close(tablet); // the oldest-seen offline record from here on
    for (let i = 0; i < DEVICE_LIMITS.maxStoredDevices; i++) {
      room.host.time += 1000;
      await room.controller(`g${i}`); // guests stay online and are never evicted
    }
    expect(room.host.store.has("d:tablet")).toBe(false);
    expect(row(room, "tv").follow).toBeNull();
    tv.clear();
    room.bytes(host);
    expect(tv.frames().length).toBe(1);
  });

  it("never evicts a device that is online", async () => {
    const room = new Room();
    await room.claimed();
    for (let i = 0; i < DEVICE_LIMITS.maxStoredDevices + 2; i++) {
      room.host.time += 1000;
      await room.controller(`p${i}`); // all stay connected
    }
    expect([...room.host.store.keys()].filter((k) => k.startsWith("d:")).length).toBe(DEVICE_LIMITS.maxStoredDevices + 3);
  });
});

describe("deviceSet", () => {
  async function party(): Promise<{ room: Room; host: FakeSocket; pad: FakeSocket; tv: FakeSocket; phone: FakeSocket }> {
    const room = new Room();
    const host = await room.claimed();
    const pad = await room.controller("pad", { kind: "tablet", mic: true, name: "Pad" });
    const tv = await room.renderer("tv");
    const phone = await room.controller("phone", { kind: "phone", mic: false });
    [host, pad, tv, phone].forEach((s) => s.clear());
    return { room, host, pad, tv, phone };
  }

  it("changes a device, stores its row and tells everyone, whoever asked", async () => {
    const { room, host, pad, tv, phone } = await party();
    room.say(phone, { type: "deviceSet", targetId: "pad", name: "  Kitchen   iPad ", screen: "own" });
    expect(JSON.parse(room.host.store.get("d:pad") ?? "{}")).toMatchObject({ name: "Kitchen iPad", screen: "own" });
    for (const ws of [host, pad, tv, phone]) {
      expect(roster(ws).find((d) => d.deviceId === "pad")).toMatchObject({ name: "Kitchen iPad", screen: "own" });
    }
    expect(phone.msgs("deviceReject")).toEqual([]);
    // A renderer may too: the QR is the permission.
    room.say(tv, { type: "deviceSet", targetId: "tv", name: "Big TV" });
    expect(roster(host).find((d) => d.deviceId === "tv")?.name).toBe("Big TV");
  });

  it("writes only the rows that changed, including a follower it re-pointed", async () => {
    const { room, pad, tv } = await party();
    room.say(pad, { type: "deviceSet", targetId: "pad", ears: "own" });
    room.say(tv, { type: "deviceSet", targetId: "tv", follow: "pad" });
    room.host.puts = [];
    room.say(tv, { type: "deviceSet", targetId: "pad", ears: "follow" });
    expect(room.host.puts.sort()).toEqual(["d:pad", "d:tv"]);
    expect(JSON.parse(room.host.store.get("d:tv") ?? "{}").follow).toBeNull();
  });

  it("answers a refusal to the sender alone, with the target and the reason, and changes nothing", async () => {
    const { room, host, pad, tv, phone } = await party();
    const rowsBefore = new Map(room.host.store);
    const refuse = (msg: Record<string, unknown>, reason: string, targetId: unknown) => {
      phone.clear();
      room.say(phone, { type: "deviceSet", ...msg });
      expect(phone.msgs("deviceReject")).toEqual([{ type: "deviceReject", targetId, reason }]);
    };
    refuse({ targetId: "nobody", name: "x" }, "unknown", "nobody");
    refuse({ targetId: "phone", ears: "own" }, "no-mic", "phone");
    refuse({ targetId: "tv", screen: "off" }, "tv-off", "tv");
    refuse({ targetId: "pad", follow: "tv" }, "bad-follow", "pad");
    refuse({ targetId: "pad", follow: "pad" }, "bad-follow", "pad");
    refuse({ targetId: "pad", ears: "loud" }, "shape", "pad");
    refuse({ targetId: "pad" }, "shape", "pad");
    refuse({ targetId: "pad", name: "" }, "shape", "pad");
    refuse({ targetId: "bad id", name: "x" }, "shape", "bad id");
    refuse({ targetId: "host", name: "x" }, "shape", "host");
    refuse({ targetId: 7, name: "x" }, "shape", null);
    refuse({ targetId: "t".repeat(65), name: "x" }, "shape", null);
    refuse({ name: "x" }, "shape", null);
    expect(room.host.store).toEqual(rowsBefore);
    for (const ws of [host, pad, tv]) expect(ws.sent).toEqual([]);
  });

  it("rations changes like patches: a flood is answered with rate, and writes nothing more", async () => {
    const { room, host, phone } = await party();
    for (let i = 0; i < LOOK_LIMITS.patchBurst + 5; i++) {
      room.say(phone, { type: "deviceSet", targetId: "pad", name: `n${i}` });
    }
    const rejects = phone.msgs("deviceReject");
    expect(rejects.length).toBe(5);
    expect(rejects.every((r) => r.reason === "rate" && r.targetId === "pad")).toBe(true);
    expect(roster(host).find((d) => d.deviceId === "pad")?.name).toBe(`n${LOOK_LIMITS.patchBurst - 1}`);
  });

  it("is ignored in a room nobody has claimed", async () => {
    const room = new Room();
    const host = await room.need({ role: "host", deviceId: "laptop" });
    room.say(host, { type: "deviceSet", targetId: "laptop", name: "X" });
    expect(host.sent).toEqual([]);
    expect(room.host.store.size).toBe(0);
  });
});

describe("deviceForget", () => {
  async function party(): Promise<{ room: Room; host: FakeSocket; pad: FakeSocket; tv: FakeSocket; phone: FakeSocket }> {
    const room = new Room();
    const host = await room.claimed();
    const pad = await room.controller("pad", { kind: "tablet", mic: true, name: "Pad" });
    const tv = await room.renderer("tv");
    const phone = await room.controller("phone", { kind: "phone", mic: true });
    room.say(pad, { type: "deviceSet", targetId: "pad", ears: "own" });
    room.say(tv, { type: "deviceSet", targetId: "tv", follow: "pad" });
    room.say(phone, { type: "deviceSet", targetId: "phone", follow: "pad" });
    [host, pad, tv, phone].forEach((s) => s.clear());
    return { room, host, pad, tv, phone };
  }

  it("lets the host remove a device: it is told it was removed and closed as denied, its row goes, its followers are re-pointed", async () => {
    const { room, host, pad, tv, phone } = await party();
    room.say(host, { type: "deviceForget", targetId: "pad" });

    expect(pad.msgs("ended")).toEqual([{ type: "ended", reason: "removed" }]);
    expect(pad.closedWith).toEqual({ code: ROOM_CLOSE_DENIED, reason: "removed" });
    expect(room.host.store.has("d:pad")).toBe(false);
    for (const ws of [tv, phone]) expect(ws.closedWith).toBeNull();
    expect(JSON.parse(room.host.store.get("d:tv") ?? "{}").follow).toBeNull();
    expect(JSON.parse(room.host.store.get("d:phone") ?? "{}").follow).toBeNull();
    for (const ws of [host, tv, phone]) {
      expect(roster(ws).map((d) => d.deviceId)).toEqual(["laptop", "tv", "phone"]);
    }
    // The followers now draw from the owner.
    room.bytes(host);
    expect(tv.frames().length).toBe(1);
    expect(phone.frames().length).toBe(1);
    // The room is otherwise untouched.
    expect(room.host.store.has("meta")).toBe(true);
  });

  it("closes every socket of the forgotten device, and keeps going if one throws", async () => {
    const { room, host, pad } = await party();
    const twin = await room.controller("pad", { kind: "tablet", mic: true });
    pad.throwOnSend = true;
    room.say(host, { type: "deviceForget", targetId: "pad" });
    expect(twin.msgs("ended")).toEqual([{ type: "ended", reason: "removed" }]);
    expect(twin.closedWith?.code).toBe(ROOM_CLOSE_DENIED);
    expect(pad.closedWith?.code).toBe(ROOM_CLOSE_DENIED);
  });

  it("is ignored from a controller or a renderer, and in a room nobody has claimed", async () => {
    const { room, host, pad, tv, phone } = await party();
    room.say(phone, { type: "deviceForget", targetId: "pad" });
    room.say(tv, { type: "deviceForget", targetId: "pad" });
    room.say(pad, { type: "deviceForget", targetId: "phone" });
    expect(room.host.store.has("d:pad")).toBe(true);
    expect(room.host.store.has("d:phone")).toBe(true);
    for (const ws of [host, pad, tv, phone]) {
      expect(ws.sent).toEqual([]);
      expect(ws.closedWith).toBeNull();
    }
  });

  it("refuses to forget the owner's own device, an unknown device or a malformed id", async () => {
    const { room, host, pad, tv, phone } = await party();
    for (const targetId of ["laptop", "nobody", "bad id", "host", 7, null, undefined]) {
      room.say(host, { type: "deviceForget", targetId });
    }
    expect(room.host.store.has("d:laptop")).toBe(true);
    for (const ws of [host, pad, tv, phone]) {
      expect(ws.sent).toEqual([]);
      expect(ws.closedWith).toBeNull();
    }
  });

  it("lets a removed device back in as a newcomer with default settings", async () => {
    const { room, host } = await party();
    room.say(host, { type: "deviceForget", targetId: "pad" });
    room.host.live = room.host.live.filter((s) => s.attachment.deviceId !== "pad");
    await room.controller("pad", { kind: "tablet", mic: true, name: "Pad again" });
    expect(JSON.parse(room.host.store.get("d:pad") ?? "{}")).toMatchObject({ name: "Pad again", ears: "follow", follow: null });
  });
});

describe("who may Play", () => {
  it("refuses a controller's lookPatch with role by default, and the look stays empty", async () => {
    const room = new Room();
    const host = await room.claimed();
    const phone = await room.controller();
    const tv = await room.renderer();
    [host, phone, tv].forEach((s) => s.clear());
    room.host.puts = [];
    room.say(phone, { type: "lookPatch", n: 1, set: { "vibe.a": "1" } });
    expect(phone.msgs()).toEqual([{ type: "lookReject", n: 1, reason: "role" }]);
    expect(tv.msgs()).toEqual([]);
    expect(host.msgs()).toEqual([]);
    expect(room.host.puts).toEqual([]);
  });

  it("lets the owner Play without being granted anything", async () => {
    const room = new Room();
    const host = await room.claimed();
    const tv = await room.renderer();
    tv.clear();
    room.say(host, { type: "lookPatch", n: 1, set: { "vibe.a": "1" } });
    expect(host.msgs("lookAck")).toEqual([{ type: "lookAck", n: 1, rev: 1 }]);
    expect(tv.msgs("lookPatch").length).toBe(1);
  });

  it("answers a controller's deviceSet carrying canPlay with owner-only, and changes nothing", async () => {
    const room = new Room();
    const host = await room.claimed();
    const phone = await room.controller("phone");
    await room.controller("phone2");
    [host, phone].forEach((s) => s.clear());
    room.host.puts = [];
    room.say(phone, { type: "deviceSet", targetId: "phone", canPlay: true });
    room.say(phone, { type: "deviceSet", targetId: "phone2", name: "Sneaky", canPlay: true });
    expect(phone.msgs("deviceReject")).toEqual([
      { type: "deviceReject", targetId: "phone", reason: "owner-only" },
      { type: "deviceReject", targetId: "phone2", reason: "owner-only" },
    ]);
    expect(phone.msgs("roster")).toEqual([]);
    expect(host.msgs()).toEqual([]);
    expect(room.host.puts).toEqual([]);
  });

  it("refuses a canPlay that is not a boolean as a shape error", async () => {
    const room = new Room();
    const host = await room.claimed();
    await room.controller("phone");
    host.clear();
    room.say(host, { type: "deviceSet", targetId: "phone", canPlay: "yes" });
    expect(host.msgs("deviceReject")).toEqual([{ type: "deviceReject", targetId: "phone", reason: "shape" }]);
  });

  it("accepts and relays a controller's lookPatch once the owner grants canPlay, and refuses again when it is taken back", async () => {
    const room = new Room();
    const host = await room.claimed();
    const phone = await room.controller();
    const tv = await room.renderer();
    room.say(host, { type: "deviceSet", targetId: "phone", canPlay: true });
    [host, phone, tv].forEach((s) => s.clear());

    room.say(phone, { type: "lookPatch", n: 1, set: { "vibe.a": "1" } });
    expect(phone.msgs()).toEqual([{ type: "lookAck", n: 1, rev: 1 }]);
    expect(tv.msgs()).toEqual([{ type: "lookPatch", rev: 1, by: "phone", set: { "vibe.a": "1" } }]);

    room.say(host, { type: "deviceSet", targetId: "phone", canPlay: false });
    [phone, tv].forEach((s) => s.clear());
    room.say(phone, { type: "lookPatch", n: 2, set: { "vibe.a": "2" } });
    expect(phone.msgs()).toEqual([{ type: "lookReject", n: 2, reason: "role" }]);
    expect(tv.msgs()).toEqual([]);
  });

  it("keeps a grant across hibernation and across the device dropping and coming back", async () => {
    const room = new Room();
    const host = await room.claimed();
    const phone = await room.controller();
    room.say(host, { type: "deviceSet", targetId: "phone", canPlay: true });
    room.close(phone);
    const again = room.reborn();
    await again.need({ role: "host", deviceId: "laptop", hk: HK, k: K, mic: true });
    const back = await again.controller();
    back.clear();
    again.say(back, { type: "lookPatch", n: 1, set: { "vibe.a": "1" } });
    expect(back.msgs()).toEqual([{ type: "lookAck", n: 1, rev: 1 }]);
  });

  it("lists the effective canPlay in the roster: true for the owner, false until granted, true after", async () => {
    const room = new Room();
    const host = await room.claimed();
    const phone = await room.controller();
    const tv = await room.renderer();
    const flags = (ws: FakeSocket) => Object.fromEntries(roster(ws).map((d) => [d.deviceId, d.canPlay]));
    expect(flags(host)).toEqual({ laptop: true, phone: false, tv: false });
    room.say(host, { type: "deviceSet", targetId: "phone", canPlay: true });
    for (const ws of [host, phone, tv]) expect(flags(ws)).toEqual({ laptop: true, phone: true, tv: false });
  });
});

describe("endRoom", () => {
  it("lets the claimed room's host end it: claim, look and alarm wiped, every socket closed as denied", async () => {
    const room = new Room();
    const host = await room.claimed();
    const phone = await room.player();
    const tv = await room.renderer();
    room.say(phone, { type: "lookPatch", n: 1, set: { "vibe.ok": "1" } });
    expect(room.host.store.size).toBeGreaterThan(0);

    room.say(host, { type: "endRoom" });

    expect(room.host.removeAlls).toBe(1);
    expect(room.host.store.size).toBe(0);
    for (const ws of [host, phone, tv]) {
      expect(ws.msgs().pop()).toEqual({ type: "ended" });
      expect(ws.closedWith?.code).toBe(ROOM_CLOSE_DENIED);
    }
  });

  it("leaves the code an unclaimed room: the old keys are refused and a new laptop can claim it", async () => {
    const room = new Room();
    const host = await room.claimed();
    room.say(host, { type: "endRoom" });
    room.close(host);
    expect(room.host.alarmAt).toBeNull();

    expect(await room.connect({ role: "renderer", deviceId: "tv", k: K })).toBeNull();
    expect(await room.connect({ role: "host", deviceId: "laptop", hk: HK, k: K })).not.toBeNull();
  });

  it("is refused from a controller, a renderer, and anyone in a legacy room", async () => {
    const room = new Room();
    await room.claimed();
    const phone = await room.controller();
    const tv = await room.renderer();
    room.say(phone, { type: "endRoom" });
    room.say(tv, { type: "endRoom" });
    expect(room.host.removeAlls).toBe(0);
    expect(phone.closedWith).toBeNull();

    const legacy = new Room();
    const legacyHost = await legacy.need({ role: "host", deviceId: "laptop" });
    const legacyTv = await legacy.need({ role: "renderer", deviceId: "tv" });
    legacy.say(legacyHost, { type: "endRoom" });
    expect(legacy.host.removeAlls).toBe(0);
    expect(legacyTv.closedWith).toBeNull();
  });

  it("ignores what a socket of the ended room says before its close lands", async () => {
    const room = new Room();
    const host = await room.claimed();
    const phone = await room.controller();
    room.say(host, { type: "endRoom" });
    phone.clear();
    room.say(phone, { type: "lookPatch", n: 1, set: { "vibe.late": "1" } });
    room.say(phone, { type: "ping", t0: 1 });
    expect(room.host.store.size).toBe(0);
    expect(phone.sent).toEqual([]);
  });
});

describe("readAttachment", () => {
  it("reads a well-formed attachment back unchanged", async () => {
    const room = new Room();
    const tv = await room.need({ role: "renderer", deviceId: "tv" });
    expect(readAttachment(JSON.parse(JSON.stringify(tv.attachment)))).toEqual(tv.attachment);
  });

  it("keeps what a TV's hello said its own benchmark picks, and drops a preset it doesn't know", async () => {
    const room = new Room();
    const tv = await room.need({ role: "renderer", deviceId: "tv" });
    room.say(tv, { type: "hello", scene: "mesh", autoQuality: "low" });
    expect(readAttachment(JSON.parse(JSON.stringify(tv.attachment))).autoQuality).toBe("low");
    expect(readAttachment({ ...tv.attachment, autoQuality: "ultra" }).autoQuality).toBeUndefined();
  });

  it("upgrades the shape written before roles, keys and socket ids existed", () => {
    const old = { role: "host", deviceId: "laptop", scene: "mesh", palette: "ember", viewport: { x: 0, y: 0, w: 1, h: 1 } };
    expect(readAttachment(old)).toEqual({ ...old, sid: "legacy:laptop", keyed: false, kind: "laptop", hasMic: true });
  });

  it("falls back to safe defaults for anything else without throwing", () => {
    for (const raw of [null, undefined, 7, "x", [], { role: "admin", keyed: "yes", viewport: 3, scene: 4 }]) {
      const a = readAttachment(raw);
      expect(a.role).toBe("renderer");
      expect(a.keyed).toBe(false);
      expect(a.scene).toBe("");
      expect(a.viewport).toEqual(FULL_VIEWPORT);
      expect(typeof a.sid).toBe("string");
    }
  });
});
