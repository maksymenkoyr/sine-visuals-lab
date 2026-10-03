import { describe, expect, it } from "vitest";
import {
  DEVICE_LIMITS,
  RENDER_DELAY_MS,
  applyDeviceSet,
  cleanName,
  defaultName,
  defaultSettings,
  feedOf,
  followersOf,
  forgetDevice,
  kindForRole,
  ownerId,
  parseEars,
  parseKind,
  parseRecord,
  parseScreen,
  pictureDelayMs,
  sanitizeDeviceSet,
  type DeviceRecord,
} from "../server/roomDevices.ts";
import { validDeviceId } from "../server/roomRules.ts";

function rec(over: Partial<DeviceRecord> = {}): DeviceRecord {
  return {
    name: "Device",
    ears: "follow",
    follow: null,
    screen: "main",
    kind: "tablet",
    hasMic: true,
    role: "controller",
    added: 0,
    seen: 0,
    ...over,
  };
}

/** laptop (owner, own), tv (follows), pad (tablet, follows, has a mic), phone (follows, no screen). */
function room(): Map<string, DeviceRecord> {
  return new Map<string, DeviceRecord>([
    ["laptop", rec({ name: "Laptop", role: "host", kind: "laptop", ears: "own", added: 1 })],
    ["tv", rec({ name: "TV", role: "renderer", kind: "tv", hasMic: false, added: 2 })],
    ["pad", rec({ name: "Pad", added: 3 })],
    ["phone", rec({ name: "Phone", kind: "phone", screen: "off", added: 4 })],
  ]);
}

describe("parsers", () => {
  it("accept only the known values", () => {
    expect(parseKind("tv")).toBe("tv");
    expect(parseKind("fridge")).toBeUndefined();
    expect(parseKind(3)).toBeUndefined();
    expect(parseEars("own")).toBe("own");
    expect(parseEars("both")).toBeUndefined();
    expect(parseScreen("off")).toBe("off");
    expect(parseScreen("")).toBeUndefined();
  });

  it("kindForRole and defaultName say what an unlabelled device is", () => {
    expect(kindForRole("host")).toBe("laptop");
    expect(kindForRole("controller")).toBe("phone");
    expect(kindForRole("renderer")).toBe("tv");
    expect(defaultName("laptop")).toBe("Laptop");
    expect(defaultName("tv")).toBe("TV");
  });
});

describe("cleanName", () => {
  it("drops control characters, collapses white space and trims", () => {
    expect(cleanName("  Living\u0000 room \n\t TV  ")).toBe("Living room TV");
    expect(cleanName("a\u007fb")).toBe("ab");
  });

  it("cuts to the cap and trims again after the cut", () => {
    const long = "x".repeat(DEVICE_LIMITS.maxNameChars + 10);
    expect(cleanName(long)).toBe("x".repeat(DEVICE_LIMITS.maxNameChars));
    expect(cleanName("x".repeat(DEVICE_LIMITS.maxNameChars - 1) + " tail")).toBe("x".repeat(DEVICE_LIMITS.maxNameChars - 1));
  });

  it("is undefined for empty, blank, control-only or non-string input", () => {
    for (const v of ["", "   ", "\u0000\u0001", 5, null, undefined, {}]) expect(cleanName(v)).toBeUndefined();
  });
});

describe("defaultSettings", () => {
  it("gives the owner its own input and Main", () => {
    expect(defaultSettings("host", { kind: "laptop", hasMic: true })).toEqual({ name: "Laptop", ears: "own", follow: null, screen: "main" });
  });

  it("makes a TV follow the owner and show Main", () => {
    expect(defaultSettings("renderer", { kind: "tv", hasMic: false })).toEqual({ name: "TV", ears: "follow", follow: null, screen: "main" });
  });

  it("makes a tablet follow and show Main, but a phone follow and be a remote", () => {
    expect(defaultSettings("controller", { kind: "tablet", hasMic: true })).toMatchObject({ ears: "follow", screen: "main" });
    expect(defaultSettings("controller", { kind: "phone", hasMic: true })).toMatchObject({ ears: "follow", screen: "off" });
  });

  it("uses the asked-for name, cleaned, or the kind's name", () => {
    expect(defaultSettings("controller", { kind: "phone", hasMic: true }, "  Ann's   phone ").name).toBe("Ann's phone");
    expect(defaultSettings("controller", { kind: "phone", hasMic: true }, "   ").name).toBe("Phone");
  });
});

describe("sanitizeDeviceSet", () => {
  const clean = (m: Record<string, unknown>) => sanitizeDeviceSet(m, validDeviceId);

  it("reads each field into the patch, and only the fields present", () => {
    expect(clean({ targetId: "tv", name: " Big  TV " })).toEqual({ targetId: "tv", patch: { name: "Big TV" } });
    expect(clean({ targetId: "tv", ears: "own" })).toEqual({ targetId: "tv", patch: { ears: "own" } });
    expect(clean({ targetId: "tv", follow: "pad" })).toEqual({ targetId: "tv", patch: { follow: "pad" } });
    expect(clean({ targetId: "tv", screen: "off" })).toEqual({ targetId: "tv", patch: { screen: "off" } });
    expect(clean({ targetId: "tv", ears: "follow", screen: "own" })).toEqual({ targetId: "tv", patch: { ears: "follow", screen: "own" } });
  });

  it("takes follow: null as the owner", () => {
    expect(clean({ targetId: "tv", follow: null })).toEqual({ targetId: "tv", patch: { follow: null } });
  });

  it("refuses a bad target, and any bad value for a present field", () => {
    expect(clean({ ears: "own" })).toBeNull();
    expect(clean({ targetId: "host", ears: "own" })).toBeNull();
    expect(clean({ targetId: 7, ears: "own" })).toBeNull();
    expect(clean({ targetId: "tv", name: "" })).toBeNull();
    expect(clean({ targetId: "tv", name: 5 })).toBeNull();
    expect(clean({ targetId: "tv", ears: "loud" })).toBeNull();
    expect(clean({ targetId: "tv", follow: "bad id" })).toBeNull();
    expect(clean({ targetId: "tv", follow: 3 })).toBeNull();
    expect(clean({ targetId: "tv", screen: "wall" })).toBeNull();
    // One bad field refuses the lot, even beside good ones.
    expect(clean({ targetId: "tv", screen: "off", ears: "loud" })).toBeNull();
  });

  it("refuses an empty patch", () => {
    expect(clean({ targetId: "tv" })).toBeNull();
    expect(clean({ targetId: "tv", unknown: 1 })).toBeNull();
  });
});

describe("parseRecord", () => {
  it("round-trips a record through its row text", () => {
    const r = rec({ name: "Pad", ears: "own", follow: "laptop", added: 12, seen: 34 });
    expect(parseRecord(JSON.stringify(r))).toEqual(r);
  });

  it("reads hasMic as false unless it is exactly true", () => {
    expect(parseRecord(JSON.stringify({ ...rec(), hasMic: "yes" }))?.hasMic).toBe(false);
  });

  it("returns null for garbage and for rows missing or mangling a field", () => {
    const good = rec();
    expect(parseRecord("{not json")).toBeNull();
    for (const raw of ["null", "[]", "7", '"x"']) expect(parseRecord(raw)).toBeNull();
    for (const bad of [
      { ...good, kind: "fridge" },
      { ...good, ears: "x" },
      { ...good, screen: "x" },
      { ...good, name: "" },
      { ...good, role: "admin" },
      { ...good, follow: 5 },
      { ...good, added: "1" },
      { ...good, seen: null },
    ]) {
      expect(parseRecord(JSON.stringify(bad))).toBeNull();
    }
    const { follow: _follow, ...noFollow } = good;
    expect(parseRecord(JSON.stringify(noFollow))).toBeNull();
  });
});

describe("ownerId, feedOf and followersOf", () => {
  it("finds the owner as the record that joined as host", () => {
    expect(ownerId(room())).toBe("laptop");
    expect(ownerId(new Map([["pad", rec()]]))).toBeNull();
  });

  it("feedOf: own input is its own feed", () => {
    expect(feedOf(room(), "laptop")).toBe("laptop");
  });

  it("feedOf: follow null means the owner, while the owner is a feed", () => {
    const r = room();
    expect(feedOf(r, "tv")).toBe("laptop");
    r.set("laptop", { ...r.get("laptop")!, ears: "follow" });
    expect(feedOf(r, "tv")).toBeNull();
  });

  it("feedOf: an explicit feed must still be on its own input, and exist", () => {
    const r = room();
    r.set("pad", { ...r.get("pad")!, ears: "own" });
    r.set("tv", { ...r.get("tv")!, follow: "pad" });
    expect(feedOf(r, "tv")).toBe("pad");
    r.set("pad", { ...r.get("pad")!, ears: "follow" });
    expect(feedOf(r, "tv")).toBeNull();
    r.set("tv", { ...r.get("tv")!, follow: "gone" });
    expect(feedOf(r, "tv")).toBeNull();
  });

  it("feedOf: unknown device, and a follower of itself, have no feed", () => {
    expect(feedOf(room(), "nobody")).toBeNull();
    const r = room();
    r.set("pad", { ...r.get("pad")!, follow: "pad" });
    expect(feedOf(r, "pad")).toBeNull();
  });

  it("followersOf lists every device drawing from a feed, in record order, never the feed", () => {
    expect(followersOf(room(), "laptop")).toEqual(["tv", "pad", "phone"]);
    expect(followersOf(room(), "tv")).toEqual([]);
    const r = room();
    r.set("pad", { ...r.get("pad")!, ears: "own" });
    r.set("phone", { ...r.get("phone")!, follow: "pad" });
    expect(followersOf(r, "pad")).toEqual(["phone"]);
    expect(followersOf(r, "laptop")).toEqual(["tv"]);
  });
});

describe("applyDeviceSet", () => {
  const ok = (r: ReturnType<typeof applyDeviceSet>) => {
    if (!r.ok) throw new Error(`refused: ${r.reason}`);
    return r.changed;
  };

  it("refuses an unknown target", () => {
    expect(applyDeviceSet(room(), "nobody", { screen: "own" })).toEqual({ ok: false, reason: "unknown" });
  });

  it("changes a name and a screen, and never mutates the records it was given", () => {
    const r = room();
    const before = JSON.stringify([...r]);
    const changed = ok(applyDeviceSet(r, "tv", { name: "Big TV", screen: "own" }));
    expect([...changed.keys()]).toEqual(["tv"]);
    expect(changed.get("tv")).toMatchObject({ name: "Big TV", screen: "own" });
    expect(JSON.stringify([...r])).toBe(before);
  });

  it("refuses own input for a device with no microphone", () => {
    expect(applyDeviceSet(room(), "tv", { ears: "own" })).toEqual({ ok: false, reason: "no-mic" });
  });

  it("refuses off for a TV", () => {
    expect(applyDeviceSet(room(), "tv", { screen: "off" })).toEqual({ ok: false, reason: "tv-off" });
    expect(ok(applyDeviceSet(room(), "pad", { screen: "off" })).get("pad")?.screen).toBe("off");
  });

  it("refuses a follow that is the device itself, unknown, or not on its own input", () => {
    expect(applyDeviceSet(room(), "pad", { follow: "pad" })).toEqual({ ok: false, reason: "bad-follow" });
    expect(applyDeviceSet(room(), "pad", { follow: "gone" })).toEqual({ ok: false, reason: "bad-follow" });
    expect(applyDeviceSet(room(), "pad", { follow: "tv" })).toEqual({ ok: false, reason: "bad-follow" });
  });

  it("checks only what the patch sets: an owner with no mic can still be renamed or change its screen", () => {
    const r = room();
    r.set("laptop", { ...r.get("laptop")!, hasMic: false });
    expect(ok(applyDeviceSet(r, "laptop", { name: "My laptop" })).get("laptop")?.name).toBe("My laptop");
    expect(ok(applyDeviceSet(r, "laptop", { screen: "own" })).get("laptop")?.screen).toBe("own");
    expect(applyDeviceSet(r, "laptop", { ears: "own" })).toEqual({ ok: false, reason: "no-mic" });
    // A TV left on screen off by an odd record can still be renamed.
    r.set("tv", { ...r.get("tv")!, screen: "off" });
    expect(ok(applyDeviceSet(r, "tv", { name: "Big TV" })).get("tv")?.name).toBe("Big TV");
  });

  it("refuses the owner switching to Follow while its follow is null (it would follow itself)", () => {
    expect(applyDeviceSet(room(), "laptop", { ears: "follow" })).toEqual({ ok: false, reason: "bad-follow" });
    expect(applyDeviceSet(room(), "laptop", { follow: null })).toEqual({ ok: false, reason: "bad-follow" });
    // Naming another feed is fine.
    const r = room();
    r.set("pad", { ...r.get("pad")!, ears: "own" });
    expect(ok(applyDeviceSet(r, "laptop", { ears: "follow", follow: "pad" })).get("laptop")).toMatchObject({ ears: "follow", follow: "pad" });
    // A non-owner on follow null follows the owner, which is not itself.
    expect(ok(applyDeviceSet(room(), "pad", { ears: "follow" })).get("pad")?.ears).toBe("follow");
  });

  it("a follow without ears means ears: follow", () => {
    const r = room();
    r.set("pad", { ...r.get("pad")!, ears: "own" });
    const changed = ok(applyDeviceSet(r, "pad", { follow: "laptop" }));
    expect(changed.get("pad")).toMatchObject({ ears: "follow", follow: "laptop" });
  });

  it("follow null points at the owner and is allowed whatever the owner is doing", () => {
    const r = room();
    r.set("pad", { ...r.get("pad")!, follow: "laptop" });
    expect(ok(applyDeviceSet(r, "pad", { follow: null })).get("pad")?.follow).toBeNull();
  });

  it("when a non-owner feed stops and the owner is a feed, its followers go back to the owner (null)", () => {
    const r = room();
    r.set("pad", { ...r.get("pad")!, ears: "own" });
    r.set("phone", { ...r.get("phone")!, follow: "pad" });
    r.set("tv", { ...r.get("tv")!, follow: "pad" });
    const changed = ok(applyDeviceSet(r, "pad", { ears: "follow" }));
    expect(changed.get("pad")?.ears).toBe("follow");
    expect(changed.get("phone")?.follow).toBeNull();
    expect(changed.get("tv")?.follow).toBeNull();
  });

  it("when the owner stops being a feed and another feed exists, its followers are pointed at that feed", () => {
    const r = room();
    r.set("pad", { ...r.get("pad")!, ears: "own", follow: null });
    const changed = ok(applyDeviceSet(r, "laptop", { ears: "follow", follow: "pad" }));
    expect(changed.get("laptop")).toMatchObject({ ears: "follow", follow: "pad" });
    expect(changed.get("tv")?.follow).toBe("pad");
    expect(changed.get("phone")?.follow).toBe("pad");
    // The new feed was following the owner by default; it is on its own input, so it is not re-pointed.
    expect(changed.has("pad")).toBe(false);
  });

  it("when no other feed exists the followers are left as they were", () => {
    // The owner follows the pad, the pad is the only feed, and the pad stops.
    const r = room();
    r.set("pad", { ...r.get("pad")!, ears: "own" });
    r.set("laptop", { ...r.get("laptop")!, ears: "follow", follow: "pad" });
    r.set("tv", { ...r.get("tv")!, follow: "pad" });
    const changed = ok(applyDeviceSet(r, "pad", { ears: "follow", follow: null }));
    expect([...changed.keys()]).toEqual(["pad"]);
    expect(feedOf(new Map([...r].map(([id, rec2]) => [id, changed.get(id) ?? rec2])), "tv")).toBeNull();
  });

  it("does not re-point anyone when a device switches to own input", () => {
    const r = room();
    const changed = ok(applyDeviceSet(r, "pad", { ears: "own" }));
    expect([...changed.keys()]).toEqual(["pad"]);
  });
});

describe("forgetDevice", () => {
  it("re-points the forgotten feed's followers to the owner when the owner is a feed", () => {
    const r = room();
    r.set("pad", { ...r.get("pad")!, ears: "own" });
    r.set("tv", { ...r.get("tv")!, follow: "pad" });
    r.set("phone", { ...r.get("phone")!, follow: "pad" });
    const { changed } = forgetDevice(r, "pad");
    expect([...changed.keys()].sort()).toEqual(["phone", "tv"]);
    expect(changed.get("tv")?.follow).toBeNull();
    expect(changed.get("phone")?.follow).toBeNull();
    expect(changed.has("pad")).toBe(false);
  });

  it("falls back to the first other feed when the owner is not one", () => {
    const r = room();
    r.set("laptop", { ...r.get("laptop")!, ears: "follow", follow: "pad" });
    r.set("pad", { ...r.get("pad")!, ears: "own" });
    r.set("phone", { ...r.get("phone")!, ears: "own" });
    r.set("tv", { ...r.get("tv")!, follow: "phone" });
    const { changed } = forgetDevice(r, "phone");
    expect(changed.get("tv")?.follow).toBe("pad");
  });

  it("leaves followers as they were when no feed remains", () => {
    const r = room();
    const { changed } = forgetDevice(r, "laptop");
    expect(changed.size).toBe(0);
  });

  it("changes nothing for a device nobody listens to, or an unknown one, and never mutates", () => {
    const r = room();
    const before = JSON.stringify([...r]);
    expect(forgetDevice(r, "tv").changed.size).toBe(0);
    expect(forgetDevice(r, "nobody").changed.size).toBe(0);
    expect(JSON.stringify([...r])).toBe(before);
  });
});

describe("pictureDelayMs", () => {
  const online = (...ids: string[]) => new Set(ids);

  it("a follower always waits the render delay", () => {
    expect(pictureDelayMs(room(), online("laptop", "tv"), "tv")).toBe(RENDER_DELAY_MS);
    expect(pictureDelayMs(room(), online(), "pad")).toBe(RENDER_DELAY_MS);
  });

  it("a device on its own input alone draws at once", () => {
    const r = new Map([["laptop", room().get("laptop")!]]);
    expect(pictureDelayMs(r, online("laptop"), "laptop")).toBe(0);
  });

  it("an own-input Main screen waits as long as an online Main follower does", () => {
    expect(pictureDelayMs(room(), online("laptop", "tv"), "laptop")).toBe(RENDER_DELAY_MS);
  });

  it("an own-input Main screen draws at once when the Main follower is offline", () => {
    expect(pictureDelayMs(room(), online("laptop"), "laptop")).toBe(0);
  });

  it("an own-input Main screen is not held back by a follower that does not show Main", () => {
    const r = room();
    r.set("tv", { ...r.get("tv")!, screen: "own" });
    expect(pictureDelayMs(r, online("laptop", "tv", "phone"), "laptop")).toBe(0);
  });

  it("an own-input device whose screen is own or off draws at once whoever follows", () => {
    for (const screen of ["own", "off"] as const) {
      const r = room();
      r.set("laptop", { ...r.get("laptop")!, screen });
      expect(pictureDelayMs(r, online("laptop", "tv", "pad"), "laptop")).toBe(0);
    }
  });

  it("an unknown device has no delay", () => {
    expect(pictureDelayMs(room(), online("nobody"), "nobody")).toBe(0);
  });
});
