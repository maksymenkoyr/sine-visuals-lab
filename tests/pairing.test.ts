import { describe, expect, it } from "vitest";
import * as rules from "../server/roomRules.ts";
import {
  HOST_ROOM_MAX_AGE_MS,
  PENDING_ADOPT_TTL_MS,
  ROOM_CODE_RE,
  TV_SLOT_ROTATE_MS,
  newKey,
  validKey,
} from "../src/net/pairing.ts";

describe("newKey", () => {
  it("is URL-safe base64 text that the room accepts as a key", () => {
    for (let i = 0; i < 50; i++) {
      const k = newKey();
      expect(k).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(validKey(k)).toBe(true);
    }
  });

  it("never repeats", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(newKey());
    expect(seen.size).toBe(500);
  });

  it("is unpadded", () => {
    expect(newKey()).not.toContain("=");
  });
});

describe("re-exports", () => {
  it("are the room rules' own validators, not copies", () => {
    expect(ROOM_CODE_RE).toBe(rules.ROOM_CODE_RE);
    expect(validKey).toBe(rules.validKey);
  });
});

describe("lifetimes", () => {
  it("are positive durations", () => {
    for (const ms of [TV_SLOT_ROTATE_MS, PENDING_ADOPT_TTL_MS, HOST_ROOM_MAX_AGE_MS]) {
      expect(ms).toBeGreaterThan(0);
    }
  });

  it("keep a saved laptop room within what the room itself outlives", () => {
    // A saved room older than the room's idle expiry would resume into a
    // room that has already been wiped.
    expect(HOST_ROOM_MAX_AGE_MS).toBeLessThanOrEqual(rules.ROOM_IDLE_TTL_MS);
  });
});
