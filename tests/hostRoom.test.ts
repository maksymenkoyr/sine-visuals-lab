import { describe, expect, it } from "vitest";
import { planHostRoom } from "../src/net/hostRoom.ts";
import { HOST_ROOM_MAX_AGE_MS, newKey } from "../src/net/pairing.ts";
import type { HostRoomSession } from "../src/net/sessions.ts";

const MINTED = 5_000_000;
const SAVED: HostRoomSession = { room: "ABCD", hostKey: newKey(), roomKey: newKey(), ts: MINTED };

describe("planHostRoom", () => {
  it("resumes a young saved room when this tab holds the lock", () => {
    const plan = planHostRoom(SAVED, MINTED + 1000, true);
    expect(plan).toEqual({ kind: "resume", session: SAVED });
  });

  it("hands back the saved session itself, keys and all", () => {
    const plan = planHostRoom(SAVED, MINTED, true);
    expect(plan.kind === "resume" && plan.session).toBe(SAVED);
  });

  it("creates when nothing was saved", () => {
    expect(planHostRoom(null, MINTED, true)).toEqual({ kind: "create" });
  });

  it("creates when another tab holds the lock, or locks are unavailable", () => {
    expect(planHostRoom(SAVED, MINTED + 1000, false)).toEqual({ kind: "create" });
  });

  it("resumes until the room is as old as the maximum age, creates from then on", () => {
    expect(planHostRoom(SAVED, MINTED + HOST_ROOM_MAX_AGE_MS - 1, true).kind).toBe("resume");
    expect(planHostRoom(SAVED, MINTED + HOST_ROOM_MAX_AGE_MS, true).kind).toBe("create");
    expect(planHostRoom(SAVED, MINTED + HOST_ROOM_MAX_AGE_MS * 3, true).kind).toBe("create");
  });
});
