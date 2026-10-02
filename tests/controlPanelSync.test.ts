import { describe, expect, it } from "vitest";
import { syncSource } from "../src/ui/controlPanel.ts";
import type { RosterEntry } from "../src/net/room.ts";

const entry = (deviceId: string, role: RosterEntry["role"], scene: string, palette: string): RosterEntry => ({
  deviceId,
  role,
  scene,
  palette,
  viewport: { x: 0, y: 0, w: 1, h: 1 },
});

describe("syncSource", () => {
  it("copies this device's roster entry when the room lists it", () => {
    const roster = [entry("me", "host", "mesh", "neon"), entry("tv", "renderer", "sky", "ember")];
    expect(syncSource(roster, "me", { scene: "own", palette: "own" })).toEqual({ scene: "mesh", palette: "neon" });
  });

  it("a phone controller is not in the roster: it copies its own look", () => {
    const roster = [entry("laptop", "host", "mesh", "neon"), entry("tv", "renderer", "sky", "ember")];
    expect(syncSource(roster, "phone", { scene: "storm", palette: "aurora" })).toEqual({
      scene: "storm",
      palette: "aurora",
    });
  });

  it("has nothing to copy when the room does not list this device and it has no look of its own", () => {
    expect(syncSource([entry("tv", "renderer", "sky", "ember")], "phone", null)).toBeNull();
    expect(syncSource([], "phone", null)).toBeNull();
  });
});
