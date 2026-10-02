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
import { LOOK_PUBLISH_MS } from "../src/net/lookSync.ts";
import { ROOM_CLOSE_DENIED, ROOM_IDLE_TTL_MS, adoptTag, hashKey } from "../server/roomRules.ts";

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
  frames?: boolean;
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
        frames: p.frames ?? false,
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
    return this.need({ role: "host", deviceId: "laptop", hk: HK, k: K });
  }
  controller(deviceId = "phone", frames = false): Promise<FakeSocket> {
    return this.need({ role: "controller", deviceId, k: K, frames });
  }
  renderer(deviceId = "tv"): Promise<FakeSocket> {
    return this.need({ role: "renderer", deviceId, k: K });
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

  it("gives the frames tag to a controller that asks, and to nobody else", async () => {
    const room = new Room();
    await room.claimed();
    expect((await room.controller("p1", true)).tags).toEqual(["controller", "p1", "frames"]);
    expect((await room.controller("p2", false)).tags).toEqual(["controller", "p2"]);
    const tv = await room.need({ role: "renderer", deviceId: "tv", k: K, frames: true });
    expect(tv.tags).toEqual(["renderer", "tv"]);
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
    room.say(squatter, { type: "setDevice", targetId: "tv", scene: "x" });
    room.say(squatter, { type: "hello", scene: "x" });
    room.say(squatter, { type: "ping", t0: 1 });
    expect(tv.sent).toEqual([]);
    expect(squatter.sent).toEqual([]);
    room.bytes(host);
    expect(squatter.frames()).toEqual([]);
  });
});

describe("message gating", () => {
  it("relays binary only from the host", async () => {
    const room = new Room();
    const host = await room.claimed();
    const phone = await room.controller("phone", true);
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

  it("drops a keyed renderer's setDevice but honours a legacy renderer's, a controller's and a host's", async () => {
    const legacy = new Room();
    const target = await legacy.need({ role: "renderer", deviceId: "target" });
    const legacyTv = await legacy.need({ role: "renderer", deviceId: "tv" });
    legacy.say(legacyTv, { type: "setDevice", targetId: "target", scene: "mesh" });
    expect(target.msgs("command")).toEqual([{ type: "command", scene: "mesh" }]);

    const keyed = new Room();
    const host = await keyed.claimed();
    const phone = await keyed.controller();
    const tv = await keyed.renderer("tv");
    const other = await keyed.renderer("other");
    keyed.say(tv, { type: "setDevice", targetId: "other", scene: "mesh" });
    expect(other.msgs("command")).toEqual([]);
    keyed.say(phone, { type: "setDevice", targetId: "other", scene: "mesh" });
    keyed.say(host, { type: "setDevice", targetId: "other", palette: "ember" });
    expect(other.msgs("command")).toEqual([
      { type: "command", scene: "mesh" },
      { type: "command", palette: "ember" },
    ]);
  });

  it("forwards a command's viewport and drops over-long or non-string ids", async () => {
    const room = new Room();
    const host = await room.need({ role: "host", deviceId: "laptop" });
    const tv = await room.need({ role: "renderer", deviceId: "tv" });
    room.say(host, {
      type: "setDevice",
      targetId: "tv",
      scene: "s".repeat(LOOK_LIMITS.maxIdChars + 1),
      palette: 7,
      viewport: { x: 0.5, y: 0, w: 0.5, h: 1 },
    });
    expect(tv.msgs("command")).toEqual([{ type: "command", viewport: { x: 0.5, y: 0, w: 0.5, h: 1 } }]);
  });

  it("ignores a setDevice aimed at a reserved or malformed tag", async () => {
    const room = new Room();
    const host = await room.claimed();
    const phone = await room.controller("phone", true);
    const tv = await room.renderer("tv");
    for (const targetId of ["renderer", "controller", "host", "frames", "", "bad id", 7, null]) {
      room.say(host, { type: "setDevice", targetId, scene: "mesh" });
    }
    expect(tv.msgs("command")).toEqual([]);
    expect(phone.msgs("command")).toEqual([]);
  });

  it("keeps delivering when one target's send throws", async () => {
    const room = new Room();
    const host = await room.need({ role: "host", deviceId: "laptop" });
    const bad = await room.need({ role: "renderer", deviceId: "twin" });
    const good = await room.need({ role: "renderer", deviceId: "twin" });
    bad.throwOnSend = true;
    room.say(host, { type: "setDevice", targetId: "twin", scene: "mesh" });
    expect(good.msgs("command").length).toBe(1);

    const tvA = await room.need({ role: "renderer", deviceId: "a" });
    const tvB = await room.need({ role: "renderer", deviceId: "b" });
    tvA.throwOnSend = true;
    room.bytes(host);
    expect(tvB.frames().length).toBe(1);
    room.say(host, { type: "hello", scene: "mesh" });
    expect(tvB.msgs("roster").length).toBeGreaterThan(0);
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

  it("answers lookPatch from a host or renderer with lookReject role, and drops lookGet from a host", async () => {
    const room = new Room();
    const host = await room.claimed();
    const tv = await room.renderer();
    room.say(tv, { type: "lookPatch", n: 3, set: { "vibe.x": "1" } });
    room.say(host, { type: "lookPatch", n: 4, set: { "vibe.x": "1" } });
    expect(tv.msgs("lookReject")).toEqual([{ type: "lookReject", n: 3, reason: "role" }]);
    expect(host.msgs("lookReject")).toEqual([{ type: "lookReject", n: 4, reason: "role" }]);
    room.say(host, { type: "lookGet" });
    expect(host.msgs("look")).toEqual([]);
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

describe("relay", () => {
  it("sends a host frame to each renderer and frame-watching controller exactly once, never to the sender or a plain controller", async () => {
    const room = new Room();
    const host = await room.claimed();
    const tvA = await room.renderer("a");
    const tvB = await room.renderer("b");
    const watcher = await room.controller("watcher", true);
    const plain = await room.controller("plain", false);
    room.bytes(host);
    for (const ws of [tvA, tvB, watcher]) expect(ws.frames().length).toBe(1);
    expect(plain.frames()).toEqual([]);
    expect(host.frames()).toEqual([]);
  });

  it("relays the same bytes it was given, unparsed", async () => {
    const room = new Room();
    const host = await room.need({ role: "host", deviceId: "laptop" });
    const tv = await room.need({ role: "renderer", deviceId: "tv" });
    const frame = new Uint8Array(40).map((_, i) => i).buffer;
    room.core.message(host, frame);
    expect(tv.frames()[0]).toBe(frame);
  });

  it("dedupes a socket that sits under both tags", async () => {
    const room = new Room();
    const host = await room.claimed();
    const both = await room.renderer("both");
    both.tags.push("frames");
    room.bytes(host);
    expect(both.frames().length).toBe(1);
  });

  it("relays frames in a legacy room as before", async () => {
    const room = new Room();
    const host = await room.need({ role: "host", deviceId: "laptop" });
    const tv = await room.need({ role: "renderer", deviceId: "tv" });
    room.bytes(host, 39);
    expect(tv.frames().length).toBe(1);
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
    expect(tv.tags).toEqual(["renderer", "tv", adoptTag(N)]);
    expect(room.core.adopt(body)).toEqual({ status: 200, body: { delivered: 1 } });
    expect(tv.msgs("adopt")).toEqual([expected]);
    expect(host.sent).toEqual([]);
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
      { room: "ABCD", k: K },
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
  it("opens with a null document at revision 0 for a keyed controller or renderer, and not for a host", async () => {
    const room = new Room();
    const host = await room.claimed();
    const phone = await room.controller();
    const tv = await room.renderer();
    expect(host.sent).toEqual([]);
    expect(phone.msgs("look")).toEqual([{ type: "look", rev: 0, doc: null }]);
    expect(tv.msgs("look")).toEqual([{ type: "look", rev: 0, doc: null }]);
  });

  it("pushes no look to a legacy room's sockets", async () => {
    const room = new Room();
    const tv = await room.need({ role: "renderer", deviceId: "tv" });
    expect(tv.sent).toEqual([]);
  });

  it("applies a patch: ack, one revision, broadcast to everyone but the sender and the host", async () => {
    const room = new Room();
    const host = await room.claimed();
    const phone = await room.controller("phone");
    const phone2 = await room.controller("phone2");
    const tv = await room.renderer();
    [host, phone, phone2, tv].forEach((s) => s.clear());

    room.say(phone, { type: "lookPatch", n: 1, scene: "mesh", palette: "ember", set: { "vibe.a": "1", "vibe.b": "2" } });

    expect(phone.msgs()).toEqual([{ type: "lookAck", n: 1, rev: 1 }]);
    const expected = { type: "lookPatch", rev: 1, scene: "mesh", palette: "ember", set: { "vibe.a": "1", "vibe.b": "2" } };
    expect(tv.msgs()).toEqual([expected]);
    expect(phone2.msgs()).toEqual([expected]);
    expect(host.sent).toEqual([]);
  });

  it("broadcasts only the entries that changed", async () => {
    const room = new Room();
    await room.claimed();
    const phone = await room.controller();
    const tv = await room.renderer();
    room.say(phone, { type: "lookPatch", n: 1, scene: "mesh", set: { "vibe.a": "1", "vibe.b": "2" } });
    tv.clear();
    room.say(phone, { type: "lookPatch", n: 2, scene: "mesh", set: { "vibe.a": "1", "vibe.b": "3" }, del: ["vibe.gone"] });
    expect(tv.msgs()).toEqual([{ type: "lookPatch", rev: 2, set: { "vibe.b": "3" } }]);
  });

  it("treats a no-op patch as acked with the same revision: no bump, no write, no broadcast", async () => {
    const room = new Room();
    await room.claimed();
    const phone = await room.controller();
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
    const phone = await room.controller();
    const tv = await room.renderer();
    room.say(phone, { type: "lookPatch", n: 1, set: { "vibe.a": "1", "vibe.b": "2" } });
    tv.clear();
    room.say(phone, { type: "lookPatch", n: 2, del: ["vibe.a"] });
    expect(tv.msgs()).toEqual([{ type: "lookPatch", rev: 2, del: ["vibe.a"] }]);
    expect(room.host.store.has("k:vibe.a")).toBe(false);
    expect(room.host.store.get("k:vibe.b")).toBe("2");
  });

  it("replies to lookGet with the current document, and a late joiner gets the same", async () => {
    const room = new Room();
    await room.claimed();
    const phone = await room.controller();
    room.say(phone, { type: "lookPatch", n: 1, scene: "mesh", palette: "ember", set: { "vibe.a": "1" } });
    const doc = { scene: "mesh", palette: "ember", storage: { "vibe.a": "1" } };
    phone.clear();
    room.say(phone, { type: "lookGet" });
    expect(phone.msgs()).toEqual([{ type: "look", rev: 1, doc }]);
    const late = await room.renderer("late");
    expect(late.msgs()).toEqual([{ type: "look", rev: 1, doc }]);
  });

  it("rejects bad patches without touching state", async () => {
    const room = new Room();
    await room.claimed();
    const phone = await room.controller();
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
    const phone = await room.controller();
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
    const phone = await room.controller();

    const many: Record<string, string> = {};
    for (let i = 0; i < LOOK_LIMITS.maxKeys; i++) many[`vibe.k${i}`] = "v";
    room.say(phone, { type: "lookPatch", n: 1, set: many });
    expect(phone.msgs("lookAck").pop()).toEqual({ type: "lookAck", n: 1, rev: 1 });
    room.say(phone, { type: "lookPatch", n: 2, set: { "vibe.one-too-many": "v" } });
    expect(phone.msgs("lookReject").pop()).toEqual({ type: "lookReject", n: 2, reason: "size" });
    expect(room.host.store.has("k:vibe.one-too-many")).toBe(false);

    const room2 = new Room();
    await room2.claimed();
    const phone2 = await room2.controller();
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
    const phone = await room.controller();
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
    const phone = await room.controller();
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
    const phone = await room.controller();
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
    const phone = await room.controller();
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
    const phone = await room.controller();
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
    const noisy = await room.controller("noisy");
    const calm = await room.controller("calm");
    for (let n = 1; n <= LOOK_LIMITS.patchBurst + 1; n++) room.say(noisy, flip(n));
    calm.clear();
    room.say(calm, flip(1));
    expect(calm.msgs("lookAck").length).toBe(1);
  });

  it("gives a reconnecting socket a fresh budget", async () => {
    const room = new Room();
    await room.claimed();
    const first = await room.controller("phone");
    for (let n = 1; n <= LOOK_LIMITS.patchBurst; n++) room.say(first, flip(n));
    room.close(first);
    const second = await room.controller("phone");
    second.clear();
    room.say(second, flip(1));
    expect(second.msgs("lookAck").length).toBe(1);
  });

  it("charges a patch whether or not it changes anything", async () => {
    const room = new Room();
    await room.claimed();
    const phone = await room.controller();
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
    const phone = await room.controller();
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
    const phone2 = await again.controller("phone");
    tv.clear();
    again.say(phone2, { type: "lookPatch", n: 1, set: { "vibe.z": "9" } });
    expect(phone2.msgs("lookAck").pop()).toEqual({ type: "lookAck", n: 1, rev: 3 });
    expect(tv.msgs()).toEqual([{ type: "lookPatch", rev: 3, set: { "vibe.z": "9" } }]);
  });

  it("starts unclaimed from empty storage, and from a claim it can't read", async () => {
    const room = new Room(new Map([["meta", "{not json"], ["look", '{"rev":3}'], ["k:vibe.a", "1"]]));
    const tv = await room.need({ role: "renderer", deviceId: "tv" });
    expect(tv.attachment.keyed).toBe(false);
    expect(await room.connect({ role: "controller", k: K })).toBeNull();
    const host = await room.claimed();
    expect(host.attachment.keyed).toBe(true);
    const phone = await room.controller();
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
    const phone = await room.controller();
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
    const phone = await room.controller();
    room.say(phone, { type: "lookPatch", n: 1, set: { "vibe.a": "1" } });
    room.core.alarm();
    expect(room.host.removeAlls).toBe(0);
    expect(room.host.store.size).toBeGreaterThan(0);
    expect(await room.connect({ role: "renderer" })).toBeNull();
  });

  it("wipes an empty claimed room when the alarm fires, leaving the code unclaimed", async () => {
    const room = new Room();
    const host = await room.claimed();
    const phone = await room.controller();
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
  it("lists hosts and renderers, hides controllers, and goes to everyone including controllers", async () => {
    const room = new Room();
    const host = await room.claimed();
    const phone = await room.controller();
    const tv = await room.renderer();
    room.say(tv, { type: "hello", scene: "mesh", palette: "ember", viewport: { x: 0, y: 0, w: 0.5, h: 1 } });
    room.say(phone, { type: "hello", scene: "phone-scene", palette: "ice" });

    const last = (ws: FakeSocket) => ws.msgs("roster").pop();
    const devices = [
      { deviceId: "laptop", role: "host", scene: "", palette: "", viewport: { x: 0, y: 0, w: 1, h: 1 } },
      { deviceId: "tv", role: "renderer", scene: "mesh", palette: "ember", viewport: { x: 0, y: 0, w: 0.5, h: 1 } },
    ];
    for (const ws of [host, phone, tv]) expect(last(ws)).toEqual({ type: "roster", devices });
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

describe("readAttachment", () => {
  it("reads a well-formed attachment back unchanged", async () => {
    const room = new Room();
    const tv = await room.need({ role: "renderer", deviceId: "tv" });
    expect(readAttachment(JSON.parse(JSON.stringify(tv.attachment)))).toEqual(tv.attachment);
  });

  it("upgrades the shape written before roles, keys and socket ids existed", () => {
    const old = { role: "host", deviceId: "laptop", scene: "mesh", palette: "ember", viewport: { x: 0, y: 0, w: 1, h: 1 } };
    expect(readAttachment(old)).toEqual({ ...old, sid: "legacy:laptop", keyed: false });
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
