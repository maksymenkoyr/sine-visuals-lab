import { describe, expect, it } from "vitest";
import {
  parseAdoptMessage,
  parseControlMessage,
  parseViewport,
  recordsFromRoster,
  type ControlMessage,
  type RosterEntry,
} from "../src/net/roomMessages.ts";
import { feedOf, followersOf, pictureDelayMs, RENDER_DELAY_MS } from "../server/roomDevices.ts";
import { LOOK_LIMITS } from "../server/lookDoc.ts";

const KEY_A = "A".repeat(22);
const KEY_B = "b-_".repeat(8);

function parse(msg: unknown): ControlMessage | null {
  return parseControlMessage(JSON.stringify(msg));
}

describe("parseControlMessage: transport", () => {
  it("returns null for anything that is not JSON text of an object", () => {
    expect(parseControlMessage(new ArrayBuffer(40))).toBeNull();
    expect(parseControlMessage(undefined)).toBeNull();
    expect(parseControlMessage(42)).toBeNull();
    expect(parseControlMessage("not json")).toBeNull();
    expect(parseControlMessage("null")).toBeNull();
    expect(parseControlMessage("42")).toBeNull();
    expect(parseControlMessage("[]")).toBeNull();
    expect(parseControlMessage('"pong"')).toBeNull();
  });

  it("ignores a type it does not know, adopt included", () => {
    expect(parse({ type: "teleport" })).toBeNull();
    expect(parse({})).toBeNull();
    expect(parse({ type: "adopt", room: "ABCD", k: KEY_A, n: KEY_B })).toBeNull();
  });
});

/** A full roster entry as a claimed room sends it, with overrides. */
function entry(over: Partial<RosterEntry> & { deviceId: string }): RosterEntry {
  return {
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
    quality: "auto",
    autoQuality: null,
    online: true,
    owner: false,
    ...over,
  };
}

describe("parseControlMessage: clock, roster, devices", () => {
  it("accepts the room's `ended`, keeping a reason only when it is `removed`", () => {
    expect(parse({ type: "ended" })).toEqual({ type: "ended" });
    expect(parse({ type: "ended", room: "ABCD" })).toEqual({ type: "ended" });
    expect(parse({ type: "ended", reason: "removed" })).toEqual({ type: "ended", reason: "removed" });
    expect(parse({ type: "ended", reason: "because" })).toEqual({ type: "ended" });
    expect("reason" in (parse({ type: "ended", reason: 5 }) as object)).toBe(false);
  });

  it("accepts a pong with numeric times only", () => {
    expect(parse({ type: "pong", t0: 1, tServer: 2 })).toEqual({ type: "pong", t0: 1, tServer: 2 });
    expect(parse({ type: "pong", t0: "1", tServer: 2 })).toBeNull();
    expect(parse({ type: "pong", t0: 1 })).toBeNull();
  });

  it("accepts a claimed room's roster with every member field, offline ones included", () => {
    const devices: RosterEntry[] = [
      entry({ deviceId: "a", role: "host", kind: "laptop", name: "Studio Mac", ears: "own", screen: "main", owner: true, scene: "mesh", palette: "p", viewport: { x: 0, y: 0, w: 0.5, h: 1 } }),
      entry({ deviceId: "b", role: "renderer", kind: "tv", name: "TV", hasMic: false, screen: "main", viewport: { x: 0.5, y: 0, w: 0.5, h: 1 } }),
      entry({ deviceId: "c", role: "controller", kind: "tablet", name: "iPad", ears: "follow", follow: "d", screen: "own", online: false }),
      entry({ deviceId: "d", role: "controller", kind: "phone", name: "Phone", ears: "own", screen: "off" }),
    ];
    expect(parse({ type: "roster", devices })).toEqual({ type: "roster", devices });
  });

  it("fills the new fields for a legacy roster entry from its role", () => {
    const old = (deviceId: string, role: string) => ({ deviceId, role, scene: "mesh", palette: "p" });
    const msg = parse({ type: "roster", devices: [old("h", "host"), old("t", "renderer"), old("c", "controller")] }) as {
      devices: RosterEntry[];
    };
    const [h, t, c] = msg.devices;
    expect(h).toEqual({
      deviceId: "h", role: "host", scene: "mesh", palette: "p", viewport: { x: 0, y: 0, w: 1, h: 1 },
      kind: "laptop", name: "Laptop", hasMic: true, ears: "own", follow: null, screen: "main", quality: "auto", autoQuality: null, online: true, owner: true,
    });
    expect(t).toMatchObject({ kind: "tv", name: "TV", hasMic: false, ears: "follow", screen: "main", online: true, owner: false });
    expect(c).toMatchObject({ kind: "phone", name: "Phone", hasMic: true, ears: "follow", screen: "main", owner: false });
  });

  it("repairs bad member fields to the defaults instead of dropping the entry", () => {
    const msg = parse({
      type: "roster",
      devices: [
        {
          deviceId: "x", role: "controller", kind: "toaster", name: "  \u0007  ", hasMic: "yes", ears: "both",
          follow: 7, screen: "all", online: "no", owner: "yes",
        },
      ],
    }) as { devices: RosterEntry[] };
    expect(msg.devices[0]).toMatchObject({
      kind: "phone", name: "Phone", hasMic: true, ears: "follow", follow: null, screen: "main", online: true, owner: false,
    });
  });

  it("reads online, owner and a cleaned name as sent", () => {
    const msg = parse({
      type: "roster",
      devices: [
        { deviceId: "o", role: "controller", owner: true, online: false, name: "  Living   room \n iPad  ", kind: "tablet", hasMic: false },
        { deviceId: "h", role: "host", owner: false },
      ],
    }) as { devices: RosterEntry[] };
    expect(msg.devices[0]).toMatchObject({ owner: true, online: false, name: "Living room iPad", kind: "tablet", hasMic: false });
    // An explicit owner: false wins over the role.
    expect(msg.devices[1].owner).toBe(false);
  });

  it("drops roster entries that are malformed and repairs the cosmetic fields", () => {
    const msg = parse({
      type: "roster",
      devices: [
        null,
        "x",
        { deviceId: 7, role: "host" },
        { deviceId: "a", role: "admin" },
        { deviceId: "ok", role: "renderer" },
      ],
    });
    expect(msg).toEqual({
      type: "roster",
      devices: [entry({ deviceId: "ok", role: "renderer", kind: "tv", name: "TV", hasMic: false, screen: "main" })],
    });
  });

  it("rejects a roster whose devices is not a list", () => {
    expect(parse({ type: "roster", devices: {} })).toBeNull();
    expect(parse({ type: "roster" })).toBeNull();
  });

  it("accepts a deviceReject with a known reason and keeps a target only when it is a string", () => {
    for (const reason of ["unknown", "no-mic", "tv-off", "bad-follow", "shape", "rate"] as const) {
      expect(parse({ type: "deviceReject", targetId: "d1", reason })).toEqual({ type: "deviceReject", targetId: "d1", reason });
    }
    expect(parse({ type: "deviceReject", targetId: null, reason: "shape" })).toEqual({ type: "deviceReject", targetId: null, reason: "shape" });
    expect(parse({ type: "deviceReject", targetId: 4, reason: "rate" })).toEqual({ type: "deviceReject", targetId: null, reason: "rate" });
    expect(parse({ type: "deviceReject", reason: "rate" })).toEqual({ type: "deviceReject", targetId: null, reason: "rate" });
  });

  it("rejects a deviceReject with an unknown or missing reason", () => {
    expect(parse({ type: "deviceReject", targetId: "d1", reason: "nope" })).toBeNull();
    expect(parse({ type: "deviceReject", targetId: "d1" })).toBeNull();
    expect(parse({ type: "deviceReject", targetId: "d1", reason: 3 })).toBeNull();
  });

  it("no longer knows the old command message", () => {
    expect(parse({ type: "command", scene: "mesh" })).toBeNull();
    expect(parse({ type: "setDevice", targetId: "a", scene: "mesh" })).toBeNull();
  });

  it("parseViewport wants four numbers", () => {
    expect(parseViewport({ x: 0, y: 0, w: 1, h: 1 })).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(parseViewport({ x: 0, y: 0, w: 1 })).toBeUndefined();
    expect(parseViewport(null)).toBeUndefined();
    expect(parseViewport([0, 0, 1, 1])).toBeUndefined();
  });
});

describe("recordsFromRoster", () => {
  const roster: RosterEntry[] = [
    entry({ deviceId: "laptop", role: "host", kind: "laptop", name: "Mac", ears: "own", screen: "main", owner: true }),
    entry({ deviceId: "tv", role: "renderer", kind: "tv", name: "TV", hasMic: false, ears: "follow", screen: "main" }),
    entry({ deviceId: "ipad", role: "controller", kind: "tablet", name: "iPad", ears: "follow", follow: null, screen: "main", online: false }),
    entry({ deviceId: "phone", role: "controller", kind: "phone", name: "Phone", ears: "own", screen: "off" }),
  ];

  it("turns each entry into a record in roster order and lists who is online", () => {
    const { records, online } = recordsFromRoster(roster);
    expect([...records.keys()]).toEqual(["laptop", "tv", "ipad", "phone"]);
    expect(records.get("ipad")).toEqual({
      name: "iPad", ears: "follow", follow: null, screen: "main", quality: "auto", kind: "tablet", hasMic: true, role: "controller", added: 2, seen: 0,
    });
    expect(records.get("laptop")?.added).toBe(0);
    expect([...online].sort()).toEqual(["laptop", "phone", "tv"]);
  });

  it("is an empty pair for an empty roster", () => {
    const { records, online } = recordsFromRoster([]);
    expect(records.size).toBe(0);
    expect(online.size).toBe(0);
  });

  it("feeds the room's own rules: feeds, followers and picture delay", () => {
    const { records, online } = recordsFromRoster(roster);
    expect(feedOf(records, "laptop")).toBe("laptop");
    expect(feedOf(records, "tv")).toBe("laptop");
    expect(feedOf(records, "phone")).toBe("phone");
    expect(followersOf(records, "laptop")).toEqual(["tv", "ipad"]);
    expect(followersOf(records, "phone")).toEqual([]);
    expect(pictureDelayMs(records, online, "tv")).toBe(RENDER_DELAY_MS);
    // The laptop shows Main next to an online follower that shows Main.
    expect(pictureDelayMs(records, online, "laptop")).toBe(RENDER_DELAY_MS);
    // The offline iPad does not count: with the TV gone too the laptop is alone.
    const alone = recordsFromRoster([roster[0], { ...roster[1], online: false }, roster[2]]);
    expect(pictureDelayMs(alone.records, alone.online, "laptop")).toBe(0);
  });
});

describe("parseControlMessage: look", () => {
  it("accepts the empty room's snapshot", () => {
    expect(parse({ type: "look", rev: 0, doc: null })).toEqual({ type: "look", rev: 0, doc: null });
  });

  it("accepts a snapshot with a document", () => {
    const doc = { scene: "mesh", palette: "neon", storage: { "vibe.sensitivity": '{"mesh":1}' } };
    expect(parse({ type: "look", rev: 7, doc })).toEqual({ type: "look", rev: 7, doc });
  });

  it("drops poisoned entries from a snapshot instead of trusting them", () => {
    // Raw text, not an object literal: a literal `__proto__` key sets the
    // prototype instead of making a property, and JSON.parse makes one.
    const text =
      '{"type":"look","rev":2,"doc":{"scene":"mesh","palette":"bad id with spaces","storage":{' +
      '"vibe.good":"1","__proto__":"x","constructor":"x","svl.session":"x","vibe.":"x","vibe.number":5,' +
      `"vibe.huge":"${"x".repeat(LOOK_LIMITS.maxValueBytes + 1)}"}}}`;
    const msg = parseControlMessage(text);
    expect(msg).toEqual({ type: "look", rev: 2, doc: { scene: "mesh", palette: "", storage: { "vibe.good": "1" } } });
    const stored = (msg as { doc: { storage: object } }).doc.storage;
    expect(Object.getPrototypeOf(stored)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(stored, "constructor")).toBe(false);
  });

  it("rejects a snapshot with no usable document or revision", () => {
    expect(parse({ type: "look", rev: 1, doc: "nope" })).toBeNull();
    expect(parse({ type: "look", rev: 1, doc: [] })).toBeNull();
    expect(parse({ type: "look", rev: 1 })).toBeNull();
    expect(parse({ type: "look", doc: null })).toBeNull();
    expect(parse({ type: "look", rev: -1, doc: null })).toBeNull();
    expect(parse({ type: "look", rev: 1.5, doc: null })).toBeNull();
    expect(parse({ type: "look", rev: "1", doc: null })).toBeNull();
  });

  it("accepts a relayed patch and keeps only the patch fields", () => {
    const msg = parse({
      type: "lookPatch",
      rev: 3,
      n: 9,
      scene: "mesh",
      set: { "vibe.a": "1" },
      del: ["vibe.b"],
      extra: "ignored",
    });
    expect(msg).toEqual({ type: "lookPatch", rev: 3, scene: "mesh", set: { "vibe.a": "1" }, del: ["vibe.b"] });
  });

  it("keeps the glide a relayed patch asks for", () => {
    expect(parse({ type: "lookPatch", rev: 2, set: { "vibe.a": "1" }, glideMs: 4000 })).toEqual({
      type: "lookPatch",
      rev: 2,
      set: { "vibe.a": "1" },
      glideMs: 4000,
    });
  });

  it("keeps who made a relayed patch, when it is a plain device id", () => {
    expect(parse({ type: "lookPatch", rev: 3, by: "dev-1_A", scene: "mesh" })).toEqual({
      type: "lookPatch",
      rev: 3,
      by: "dev-1_A",
      scene: "mesh",
    });
    const id64 = "a".repeat(64);
    expect(parse({ type: "lookPatch", rev: 3, by: id64, scene: "mesh" })).toMatchObject({ by: id64 });
  });

  it("drops a `by` that is not a device id, but keeps the patch", () => {
    for (const by of ["", "a".repeat(65), "has space", "x/y", "a\nb", 5, null, {}]) {
      const msg = parse({ type: "lookPatch", rev: 3, by, scene: "mesh" });
      expect(msg).toEqual({ type: "lookPatch", rev: 3, scene: "mesh" });
      expect(msg && "by" in msg).toBe(false);
    }
  });

  it("accepts a relayed patch that changes only the palette", () => {
    expect(parse({ type: "lookPatch", rev: 1, palette: "neon" })).toEqual({ type: "lookPatch", rev: 1, palette: "neon" });
  });

  it("rejects a relayed patch that is not valid", () => {
    expect(parse({ type: "lookPatch", rev: 1, set: { __proto__x: "1" } })).toBeNull();
    expect(parse({ type: "lookPatch", rev: 1, set: { "svl.tvSession": "1" } })).toBeNull();
    expect(parse({ type: "lookPatch", rev: 1, set: { "vibe.a": 1 } })).toBeNull();
    expect(parse({ type: "lookPatch", rev: 1, set: { "vibe.a": "1" }, del: ["vibe.a"] })).toBeNull();
    expect(parse({ type: "lookPatch", rev: 1, del: "vibe.a" })).toBeNull();
    expect(parse({ type: "lookPatch", rev: 1, scene: "has space" })).toBeNull();
    expect(parse({ type: "lookPatch", set: { "vibe.a": "1" } })).toBeNull();
    expect(parse({ type: "lookPatch", rev: -2, set: { "vibe.a": "1" } })).toBeNull();
  });

  it("rejects a relayed patch with an oversize value", () => {
    const big = "x".repeat(LOOK_LIMITS.maxValueBytes + 1);
    expect(parse({ type: "lookPatch", rev: 1, set: { "vibe.a": big } })).toBeNull();
  });

  it("accepts an ack", () => {
    expect(parse({ type: "lookAck", n: 4, rev: 12 })).toEqual({ type: "lookAck", n: 4, rev: 12 });
    expect(parse({ type: "lookAck", n: 4 })).toBeNull();
    expect(parse({ type: "lookAck", n: "4", rev: 1 })).toBeNull();
    expect(parse({ type: "lookAck", n: 4, rev: -1 })).toBeNull();
  });

  it("accepts a rejection with or without the patch number", () => {
    expect(parse({ type: "lookReject", n: 4, reason: "size" })).toEqual({ type: "lookReject", n: 4, reason: "size" });
    expect(parse({ type: "lookReject", n: null, reason: "role" })).toEqual({ type: "lookReject", n: null, reason: "role" });
    expect(parse({ type: "lookReject", n: 1, reason: "shape" })).toEqual({ type: "lookReject", n: 1, reason: "shape" });
  });

  it("rejects a rejection with an unknown reason or a bad patch number", () => {
    expect(parse({ type: "lookReject", n: 1, reason: "because" })).toBeNull();
    expect(parse({ type: "lookReject", n: 1 })).toBeNull();
    expect(parse({ type: "lookReject", n: "1", reason: "role" })).toBeNull();
    expect(parse({ type: "lookReject", reason: "role" })).toBeNull();
  });
});

describe("parseAdoptMessage", () => {
  const good = { type: "adopt", room: "ABCD", k: KEY_A, n: KEY_B };

  it("accepts the room's relay from raw text", () => {
    expect(parseAdoptMessage(JSON.stringify(good))).toEqual(good);
  });

  it("accepts an already-parsed object", () => {
    expect(parseAdoptMessage(good)).toEqual(good);
  });

  it("accepts a relay with no nonce (a laptop's typed code), but not a malformed one", () => {
    const { n: _n, ...noNonce } = good;
    expect(parseAdoptMessage(noNonce)).toEqual(noNonce);
    expect(parseAdoptMessage({ ...good, n: "short" })).toBeNull();
  });

  it("keeps only the adopt fields", () => {
    expect(parseAdoptMessage({ ...good, extra: 1 })).toEqual(good);
  });

  it("rejects a malformed room code", () => {
    for (const room of ["abcd", "ABC", "ABCDE", "AB1D", "AB0D", "", 4, null]) {
      expect(parseAdoptMessage({ ...good, room })).toBeNull();
    }
  });

  it("rejects a malformed key or nonce", () => {
    for (const bad of ["short", "A".repeat(21), "A".repeat(65), "has space ".repeat(3), "", 5, null]) {
      expect(parseAdoptMessage({ ...good, k: bad })).toBeNull();
      expect(parseAdoptMessage({ ...good, n: bad })).toBeNull();
    }
    expect(parseAdoptMessage({ type: "adopt", room: "ABCD", n: KEY_B })).toBeNull();
  });

  it("rejects another type, bad JSON and non-objects", () => {
    expect(parseAdoptMessage({ ...good, type: "look" })).toBeNull();
    expect(parseAdoptMessage("not json")).toBeNull();
    expect(parseAdoptMessage("null")).toBeNull();
    expect(parseAdoptMessage(null)).toBeNull();
    expect(parseAdoptMessage(undefined)).toBeNull();
    expect(parseAdoptMessage([good])).toBeNull();
    expect(parseAdoptMessage(new ArrayBuffer(8))).toBeNull();
  });
});
