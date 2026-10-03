import { describe, expect, it } from "vitest";
import {
  RESERVED_TAGS,
  ROOM_CLOSE_DENIED,
  ROOM_CODE_RE,
  ROOM_IDLE_TTL_MS,
  canSend,
  decideJoin,
  hashKey,
  parseRole,
  safeEqualHex,
  validDeviceId,
  validKey,
  validTargetTag,
  type JoinRequest,
  type RoomMeta,
  type RoomRole,
  type SendKind,
} from "../server/roomRules.ts";
import { LOOK_LIMITS } from "../server/lookDoc.ts";

const META: RoomMeta = { v: 1, hostKeyHash: "aa".repeat(32), roomKeyHash: "bb".repeat(32), claimedAt: 1 };
const HK = META.hostKeyHash;
const K = META.roomKeyHash;
const OTHER = "cc".repeat(32);

function req(role: RoomRole, hostKeyHash: string | null, roomKeyHash: string | null): JoinRequest {
  return { role, hostKeyHash, roomKeyHash };
}

describe("decideJoin on an unclaimed room", () => {
  it("lets a keyless host in as a legacy room", () => {
    expect(decideJoin(null, req("host", null, null))).toEqual({ ok: true, claim: false, keyed: false });
  });

  it("claims for a host presenting both keys", () => {
    expect(decideJoin(null, req("host", HK, K))).toEqual({ ok: true, claim: true, keyed: true });
  });

  it("denies a host presenting only one key", () => {
    expect(decideJoin(null, req("host", HK, null))).toEqual({ ok: false });
    expect(decideJoin(null, req("host", null, K))).toEqual({ ok: false });
  });

  it("lets a keyless renderer in as legacy and denies one carrying any key", () => {
    expect(decideJoin(null, req("renderer", null, null))).toEqual({ ok: true, claim: false, keyed: false });
    expect(decideJoin(null, req("renderer", null, K))).toEqual({ ok: false });
    expect(decideJoin(null, req("renderer", HK, null))).toEqual({ ok: false });
    expect(decideJoin(null, req("renderer", HK, K))).toEqual({ ok: false });
  });

  it("never lets a controller in, so a controller cannot create or claim a room", () => {
    expect(decideJoin(null, req("controller", null, null))).toEqual({ ok: false });
    expect(decideJoin(null, req("controller", null, K))).toEqual({ ok: false });
    expect(decideJoin(null, req("controller", HK, K))).toEqual({ ok: false });
  });
});

describe("decideJoin on a claimed room", () => {
  it("lets the host in with its host key, and only that", () => {
    expect(decideJoin(META, req("host", HK, null))).toEqual({ ok: true, claim: false, keyed: true });
    expect(decideJoin(META, req("host", HK, K))).toEqual({ ok: true, claim: false, keyed: true });
    expect(decideJoin(META, req("host", OTHER, K))).toEqual({ ok: false });
    expect(decideJoin(META, req("host", null, K))).toEqual({ ok: false });
    expect(decideJoin(META, req("host", null, null))).toEqual({ ok: false });
    // The room key alone is the key of everyone else: it must not make a host.
    expect(decideJoin(META, req("host", K, K))).toEqual({ ok: false });
  });

  it("lets a controller or renderer in with the room key", () => {
    for (const role of ["controller", "renderer"] as const) {
      expect(decideJoin(META, req(role, null, K))).toEqual({ ok: true, claim: false, keyed: true });
      expect(decideJoin(META, req(role, OTHER, K))).toEqual({ ok: true, claim: false, keyed: true });
    }
  });

  it("denies a controller or renderer with a wrong, swapped or missing key", () => {
    for (const role of ["controller", "renderer"] as const) {
      expect(decideJoin(META, req(role, null, OTHER))).toEqual({ ok: false });
      expect(decideJoin(META, req(role, null, null))).toEqual({ ok: false });
      // The host key is not a room key.
      expect(decideJoin(META, req(role, HK, HK))).toEqual({ ok: false });
      expect(decideJoin(META, req(role, HK, null))).toEqual({ ok: false });
    }
  });
});

describe("canSend", () => {
  // Rows are message kinds; columns host / controller / renderer. The
  // setDevice renderer cell and the endRoom host cell depend on whether the
  // room is keyed.
  const table: Record<Exclude<SendKind, "setDevice" | "endRoom">, [boolean, boolean, boolean]> = {
    binary: [true, false, false],
    ping: [true, true, true],
    hello: [true, true, true],
    lookGet: [false, true, true],
    lookPatch: [true, true, false],
  };

  for (const keyed of [true, false]) {
    for (const kind of Object.keys(table) as Array<keyof typeof table>) {
      it(`${kind} (${keyed ? "keyed" : "legacy"})`, () => {
        const [host, controller, renderer] = table[kind];
        expect(canSend(keyed, "host", kind)).toBe(host);
        expect(canSend(keyed, "controller", kind)).toBe(controller);
        expect(canSend(keyed, "renderer", kind)).toBe(renderer);
      });
    }
  }

  it("setDevice: host and controller always; a renderer only in a legacy room", () => {
    expect(canSend(true, "host", "setDevice")).toBe(true);
    expect(canSend(false, "host", "setDevice")).toBe(true);
    expect(canSend(true, "controller", "setDevice")).toBe(true);
    expect(canSend(false, "controller", "setDevice")).toBe(true);
    expect(canSend(true, "renderer", "setDevice")).toBe(false);
    expect(canSend(false, "renderer", "setDevice")).toBe(true);
  });

  it("endRoom: only a claimed room's host", () => {
    expect(canSend(true, "host", "endRoom")).toBe(true);
    for (const keyed of [true, false]) {
      expect(canSend(keyed, "controller", "endRoom")).toBe(false);
      expect(canSend(keyed, "renderer", "endRoom")).toBe(false);
    }
    expect(canSend(false, "host", "endRoom")).toBe(false);
  });
});

describe("parseRole", () => {
  it("treats a missing or empty role as renderer", () => {
    expect(parseRole(null)).toBe("renderer");
    expect(parseRole("")).toBe("renderer");
  });

  it("accepts the three roles and nothing else", () => {
    expect(parseRole("host")).toBe("host");
    expect(parseRole("controller")).toBe("controller");
    expect(parseRole("renderer")).toBe("renderer");
    expect(parseRole("Host")).toBeNull();
    expect(parseRole("admin")).toBeNull();
    expect(parseRole("frames")).toBeNull();
  });
});

describe("device ids and target tags", () => {
  it("accepts UUIDs and plain tokens", () => {
    expect(validDeviceId("0f8fad5b-d9cb-469f-a165-70867728950e")).toBe(true);
    expect(validDeviceId("dev_1")).toBe(true);
    expect(validTargetTag("dev_1")).toBe(true);
  });

  it("rejects the reserved tags, odd characters and bad lengths", () => {
    for (const tag of RESERVED_TAGS) {
      expect(validDeviceId(tag)).toBe(false);
      expect(validTargetTag(tag)).toBe(false);
    }
    expect(RESERVED_TAGS.has("host")).toBe(true);
    expect(RESERVED_TAGS.has("renderer")).toBe(true);
    expect(RESERVED_TAGS.has("controller")).toBe(true);
    expect(RESERVED_TAGS.has("frames")).toBe(true);
    expect(validDeviceId("")).toBe(false);
    expect(validDeviceId("a b")).toBe(false);
    expect(validDeviceId("a/b")).toBe(false);
    expect(validDeviceId(5)).toBe(false);
    expect(validDeviceId(null)).toBe(false);
    expect(validDeviceId("a".repeat(LOOK_LIMITS.maxDeviceIdChars))).toBe(true);
    expect(validDeviceId("a".repeat(LOOK_LIMITS.maxDeviceIdChars + 1))).toBe(false);
  });
});

describe("validKey", () => {
  it("accepts base64url keys within the length range", () => {
    expect(validKey("a".repeat(22))).toBe(true);
    expect(validKey("A-_0".repeat(10))).toBe(true);
    expect(validKey("a".repeat(64))).toBe(true);
  });

  it("rejects short, long, non-base64url and non-string values", () => {
    expect(validKey("a".repeat(21))).toBe(false);
    expect(validKey("a".repeat(65))).toBe(false);
    expect(validKey("a".repeat(21) + "=")).toBe(false);
    expect(validKey("a".repeat(21) + "+")).toBe(false);
    expect(validKey("a".repeat(21) + " ")).toBe(false);
    expect(validKey("a".repeat(22) + "\n")).toBe(false);
    expect(validKey(undefined)).toBe(false);
    expect(validKey(12345678901234567890123)).toBe(false);
  });
});

describe("hashKey and safeEqualHex", () => {
  it("hashes to the known SHA-256 vectors", async () => {
    expect(await hashKey("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await hashKey("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("compares equal digests as equal and any difference as unequal", async () => {
    const a = await hashKey("one");
    const b = await hashKey("two");
    expect(safeEqualHex(a, a)).toBe(true);
    expect(safeEqualHex(a, b)).toBe(false);
    // A difference in just the last character still shows.
    expect(safeEqualHex(a, a.slice(0, -1) + (a.endsWith("0") ? "1" : "0"))).toBe(false);
  });

  it("is false for different lengths", () => {
    expect(safeEqualHex("ab", "abc")).toBe(false);
    expect(safeEqualHex("", "a")).toBe(false);
    expect(safeEqualHex("", "")).toBe(true);
  });
});

describe("constants", () => {
  it("room codes are four of the unambiguous characters", () => {
    expect(ROOM_CODE_RE.test("ABCD")).toBe(true);
    expect(ROOM_CODE_RE.test("A2C9")).toBe(true);
    expect(ROOM_CODE_RE.test("abcd")).toBe(false);
    expect(ROOM_CODE_RE.test("ABC")).toBe(false);
    expect(ROOM_CODE_RE.test("ABCDE")).toBe(false);
    expect(ROOM_CODE_RE.test("AB1D")).toBe(false);
  });

  it("denial is the one terminal close and the idle limit is a positive duration", () => {
    expect(ROOM_CLOSE_DENIED).toBeGreaterThanOrEqual(4000);
    expect(ROOM_CLOSE_DENIED).toBeLessThanOrEqual(4999);
    expect(ROOM_IDLE_TTL_MS).toBeGreaterThan(0);
  });
});
