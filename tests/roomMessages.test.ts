import { describe, expect, it } from "vitest";
import {
  parseAdoptMessage,
  parseControlMessage,
  parseViewport,
  type ControlMessage,
} from "../src/net/roomMessages.ts";
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

describe("parseControlMessage: clock, roster, command", () => {
  it("accepts the room's `ended`, keeping nothing else from it", () => {
    expect(parse({ type: "ended" })).toEqual({ type: "ended" });
    expect(parse({ type: "ended", room: "ABCD" })).toEqual({ type: "ended" });
  });

  it("accepts a pong with numeric times only", () => {
    expect(parse({ type: "pong", t0: 1, tServer: 2 })).toEqual({ type: "pong", t0: 1, tServer: 2 });
    expect(parse({ type: "pong", t0: "1", tServer: 2 })).toBeNull();
    expect(parse({ type: "pong", t0: 1 })).toBeNull();
  });

  it("accepts a roster including a controller role", () => {
    const devices = [
      { deviceId: "a", role: "host", scene: "mesh", palette: "p", viewport: { x: 0, y: 0, w: 0.5, h: 1 } },
      { deviceId: "b", role: "renderer", scene: "", palette: "", viewport: { x: 0.5, y: 0, w: 0.5, h: 1 } },
      { deviceId: "c", role: "controller", scene: "s", palette: "q", viewport: { x: 0, y: 0, w: 1, h: 1 } },
    ];
    expect(parse({ type: "roster", devices })).toEqual({ type: "roster", devices });
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
      devices: [{ deviceId: "ok", role: "renderer", scene: "", palette: "", viewport: { x: 0, y: 0, w: 1, h: 1 } }],
    });
  });

  it("rejects a roster whose devices is not a list", () => {
    expect(parse({ type: "roster", devices: {} })).toBeNull();
    expect(parse({ type: "roster" })).toBeNull();
  });

  it("reads a command's optional fields", () => {
    expect(parse({ type: "command", scene: "mesh", palette: "p", viewport: { x: 0, y: 0, w: 1, h: 1 } })).toEqual({
      type: "command",
      scene: "mesh",
      palette: "p",
      viewport: { x: 0, y: 0, w: 1, h: 1 },
    });
    const bare = parse({ type: "command", scene: 3, viewport: { x: "0" } });
    expect(bare).toEqual({ type: "command", scene: undefined, palette: undefined, viewport: undefined });
  });

  it("parseViewport wants four numbers", () => {
    expect(parseViewport({ x: 0, y: 0, w: 1, h: 1 })).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(parseViewport({ x: 0, y: 0, w: 1 })).toBeUndefined();
    expect(parseViewport(null)).toBeUndefined();
    expect(parseViewport([0, 0, 1, 1])).toBeUndefined();
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
