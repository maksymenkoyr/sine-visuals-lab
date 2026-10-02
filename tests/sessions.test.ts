import { describe, expect, it } from "vitest";
import { PENDING_ADOPT_TTL_MS, newKey } from "../src/net/pairing.ts";
import {
  SESSION_KEYS,
  clearSession,
  readSession,
  writeSession,
  type HostRoomSession,
  type SessionKind,
} from "../src/net/sessions.ts";
import { PRIVATE_KEYS, isRoomKey } from "../src/net/syncedStores.ts";

function memStorage(): Storage & { names(): string[] } {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      m.set(k, String(v));
    },
    removeItem: (k) => {
      m.delete(k);
    },
    clear: () => m.clear(),
    names: () => [...m.keys()],
  };
}

const K1 = newKey();
const K2 = newKey();
const NOW = 1_000_000;

describe("sessions round trip", () => {
  it("controller", () => {
    const s = memStorage();
    writeSession("controller", { room: "ABCD", key: K1, ts: NOW }, s);
    expect(readSession("controller", s, NOW)).toEqual({ room: "ABCD", key: K1, ts: NOW });
  });

  it("tv", () => {
    const s = memStorage();
    writeSession("tv", { room: "WXYZ", key: K1, ts: NOW }, s);
    expect(readSession("tv", s, NOW)).toEqual({ room: "WXYZ", key: K1, ts: NOW });
  });

  it("host", () => {
    const s = memStorage();
    const v: HostRoomSession = { room: "ABCD", hostKey: K1, roomKey: K2, ts: NOW };
    writeSession("host", v, s);
    expect(readSession("host", s, NOW)).toEqual(v);
  });

  it("pending", () => {
    const s = memStorage();
    writeSession("pending", { slot: "ABCD", nonce: K1, ts: NOW }, s);
    expect(readSession("pending", s, NOW)).toEqual({ slot: "ABCD", nonce: K1, ts: NOW });
  });

  it("keeps the kinds apart", () => {
    const s = memStorage();
    writeSession("controller", { room: "ABCD", key: K1, ts: NOW }, s);
    expect(readSession("tv", s, NOW)).toBeNull();
    expect(readSession("host", s, NOW)).toBeNull();
    expect(readSession("pending", s, NOW)).toBeNull();
  });

  it("clears only the kind asked for", () => {
    const s = memStorage();
    writeSession("controller", { room: "ABCD", key: K1, ts: NOW }, s);
    writeSession("tv", { room: "ABCD", key: K1, ts: NOW }, s);
    clearSession("controller", s);
    expect(readSession("controller", s, NOW)).toBeNull();
    expect(readSession("tv", s, NOW)).not.toBeNull();
  });
});

describe("reading distrusts what it finds", () => {
  const put = (kind: SessionKind, raw: string): Storage => {
    const s = memStorage();
    s.setItem(SESSION_KEYS[kind], raw);
    return s;
  };

  it("rejects text that isn't JSON, or isn't an object", () => {
    for (const raw of ["", "{", "null", "7", '"x"', "[]", "true"]) {
      expect(readSession("controller", put("controller", raw), NOW)).toBeNull();
    }
  });

  it("rejects a malformed room code", () => {
    for (const room of ["abcd", "ABC", "ABCDE", "AB1D", "", 12, null]) {
      expect(readSession("controller", put("controller", JSON.stringify({ room, key: K1, ts: NOW })), NOW)).toBeNull();
    }
  });

  it("rejects a malformed key", () => {
    for (const key of ["short", "has space has space has space", "x".repeat(65), "", 12, null]) {
      expect(readSession("tv", put("tv", JSON.stringify({ room: "ABCD", key, ts: NOW })), NOW)).toBeNull();
    }
  });

  it("rejects a missing or non-numeric timestamp", () => {
    expect(readSession("controller", put("controller", JSON.stringify({ room: "ABCD", key: K1 })), NOW)).toBeNull();
    expect(
      readSession("controller", put("controller", JSON.stringify({ room: "ABCD", key: K1, ts: "now" })), NOW),
    ).toBeNull();
  });

  it("needs every field of a host room", () => {
    const base = { room: "ABCD", hostKey: K1, roomKey: K2, ts: NOW };
    expect(readSession("host", put("host", JSON.stringify(base)), NOW)).not.toBeNull();
    for (const drop of ["room", "hostKey", "roomKey"] as const) {
      const partial: Record<string, unknown> = { ...base };
      delete partial[drop];
      expect(readSession("host", put("host", JSON.stringify(partial)), NOW)).toBeNull();
    }
  });

  it("checks the pending slot and nonce, not the controller's field names", () => {
    expect(readSession("pending", put("pending", JSON.stringify({ room: "ABCD", key: K1, ts: NOW })), NOW)).toBeNull();
    expect(readSession("pending", put("pending", JSON.stringify({ slot: "abcd", nonce: K1, ts: NOW })), NOW)).toBeNull();
    expect(readSession("pending", put("pending", JSON.stringify({ slot: "ABCD", nonce: "no", ts: NOW })), NOW)).toBeNull();
  });

  it("drops fields it doesn't know", () => {
    const s = put("controller", '{"room":"ABCD","key":"' + K1 + '","ts":' + NOW + ',"extra":"x","__proto__":{"evil":1}}');
    expect(readSession("controller", s, NOW)).toEqual({ room: "ABCD", key: K1, ts: NOW });
  });
});

describe("pending expires", () => {
  it("reads until the TTL has passed, null after", () => {
    const s = memStorage();
    writeSession("pending", { slot: "ABCD", nonce: K1, ts: NOW }, s);
    expect(readSession("pending", s, NOW + PENDING_ADOPT_TTL_MS - 1)).not.toBeNull();
    expect(readSession("pending", s, NOW + PENDING_ADOPT_TTL_MS)).not.toBeNull();
    expect(readSession("pending", s, NOW + PENDING_ADOPT_TTL_MS + 1)).toBeNull();
  });

  it("is the only kind that expires on read", () => {
    const s = memStorage();
    writeSession("controller", { room: "ABCD", key: K1, ts: NOW }, s);
    writeSession("host", { room: "ABCD", hostKey: K1, roomKey: K2, ts: NOW }, s);
    const later = NOW + PENDING_ADOPT_TTL_MS * 1000;
    expect(readSession("controller", s, later)).not.toBeNull();
    expect(readSession("host", s, later)).not.toBeNull();
  });
});

describe("unavailable storage", () => {
  it("reads null, writes and clears quietly, for null storage", () => {
    expect(readSession("controller", null, NOW)).toBeNull();
    expect(() => writeSession("controller", { room: "ABCD", key: K1, ts: NOW }, null)).not.toThrow();
    expect(() => clearSession("controller", null)).not.toThrow();
  });

  it("survives a storage that throws", () => {
    const boom = (): never => {
      throw new Error("blocked");
    };
    expect(readSession("tv", { getItem: boom }, NOW)).toBeNull();
    expect(() => writeSession("tv", { room: "ABCD", key: K1, ts: NOW }, { setItem: boom })).not.toThrow();
    expect(() => clearSession("tv", { removeItem: boom })).not.toThrow();
  });
});

describe("session keys", () => {
  it("are private to the device and never part of a look", () => {
    for (const key of Object.values(SESSION_KEYS)) {
      expect(PRIVATE_KEYS.has(key)).toBe(true);
      expect(isRoomKey(key)).toBe(false);
    }
  });

  it("are written under their own names", () => {
    const s = memStorage();
    writeSession("host", { room: "ABCD", hostKey: K1, roomKey: K2, ts: NOW }, s);
    expect(s.names()).toEqual([SESSION_KEYS.host]);
  });
});
