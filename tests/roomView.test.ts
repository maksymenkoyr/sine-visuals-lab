import { describe, expect, it } from "vitest";
import {
  MAIN_BAND_H,
  NODE_H,
  NODE_W,
  OWNER_FEED_VALUE,
  chipsFor,
  currentFeedValue,
  deviceCountText,
  diagramHeight,
  feedChoices,
  kindLine,
  layoutNodes,
  neededHeight,
  rejectText,
} from "../src/ui/roomView.ts";
import type { RosterEntry } from "../src/net/roomMessages.ts";

const VIEWPORT = { w: 1, h: 1 } as unknown as RosterEntry["viewport"];

function entry(id: string, over: Partial<RosterEntry> = {}): RosterEntry {
  return {
    deviceId: id,
    role: "controller",
    scene: "",
    palette: "",
    viewport: VIEWPORT,
    kind: "phone",
    name: id,
    hasMic: true,
    ears: "follow",
    follow: null,
    screen: "main",
    online: true,
    owner: false,
    ...over,
  };
}

const laptop = entry("laptop-1", { role: "host", kind: "laptop", name: "Studio", ears: "own", owner: true });

describe("layoutNodes", () => {
  const sizes: Array<[string, number, boolean]> = [
    ["wide", 620, false],
    ["narrow", 340, true],
  ];
  for (const [label, width, narrow] of sizes) {
    it(`never overlaps two nodes or the MAIN band for 1..8 devices (${label})`, () => {
      for (let count = 1; count <= 8; count++) {
        const height = diagramHeight(count, width, narrow);
        expect(height).toBeGreaterThanOrEqual(neededHeight(count, width, narrow));
        const pts = layoutNodes(count, width, height, narrow);
        expect(pts).toHaveLength(count);
        const boxes = pts.map((p) => {
          const cx = (p.x / 100) * width;
          const cy = (p.y / 100) * height;
          return { l: cx - NODE_W / 2, r: cx + NODE_W / 2, t: cy - NODE_H / 2, b: cy + NODE_H / 2 };
        });
        for (const b of boxes) {
          expect(b.l).toBeGreaterThanOrEqual(-1e-6);
          expect(b.r).toBeLessThanOrEqual(width + 1e-6);
          expect(b.t).toBeGreaterThanOrEqual(MAIN_BAND_H - 1e-6);
          expect(b.b).toBeLessThanOrEqual(height + 1e-6);
        }
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i];
            const b = boxes[j];
            const apart = a.r <= b.l + 1e-6 || b.r <= a.l + 1e-6 || a.b <= b.t + 1e-6 || b.b <= a.t + 1e-6;
            expect(apart, `${label} count ${count}: nodes ${i} and ${j}`).toBe(true);
          }
        }
      }
    });
  }

  it("is deterministic and empty for no devices", () => {
    expect(layoutNodes(0, 600, 360, false)).toEqual([]);
    expect(layoutNodes(5, 620, 400, false)).toEqual(layoutNodes(5, 620, 400, false));
  });

  it("grows the diagram when the nodes need more than its base height", () => {
    expect(diagramHeight(8, 340, true)).toBeGreaterThan(diagramHeight(1, 340, true));
    expect(diagramHeight(1, 620, false)).toBeGreaterThanOrEqual(MAIN_BAND_H + NODE_H);
  });

  it("puts a lone node in the middle of the box", () => {
    const [p] = layoutNodes(1, 620, 360, false);
    expect(p.x).toBeCloseTo(50, 6);
  });
});

describe("chipsFor", () => {
  it("shows OWN INPUT for a device on its own input, with YOU and OWNER tags", () => {
    const roster = [laptop];
    const c = chipsFor(laptop, roster, "laptop-1");
    expect(c.ears).toEqual({ label: "OWN INPUT", tone: "own" });
    expect(c.screen).toEqual({ label: "MAIN", tone: "main" });
    expect(c.tags.map((t) => t.label)).toEqual(["YOU", "OWNER"]);
  });

  it("names the feed a follower listens through (the owner for follow null)", () => {
    const tv = entry("tv-1", { role: "renderer", kind: "tv", name: "Lounge TV" });
    const c = chipsFor(tv, [laptop, tv], "laptop-1");
    expect(c.ears).toEqual({ label: "← Studio", tone: "follow" });
    expect(c.tags).toEqual([]);
  });

  it("follows an explicitly named feed", () => {
    const pad = entry("pad-1", { kind: "tablet", name: "iPad", ears: "own" });
    const tv = entry("tv-1", { kind: "tv", name: "TV", follow: "pad-1" });
    expect(chipsFor(tv, [laptop, pad, tv]).ears.label).toBe("← iPad");
  });

  it("says NO SOUND when the feed is gone, not on its own input, or offline", () => {
    const tv = entry("tv-1", { kind: "tv", follow: "ghost" });
    expect(chipsFor(tv, [laptop, tv]).ears).toEqual({ label: "NO SOUND", tone: "none" });
    const quiet = { ...laptop, ears: "follow" as const };
    expect(chipsFor(entry("a"), [quiet, entry("a")]).ears.tone).toBe("none");
    const away = { ...laptop, online: false };
    expect(chipsFor(entry("a"), [away, entry("a")]).ears.tone).toBe("none");
  });

  it("labels the three screen choices", () => {
    expect(chipsFor(entry("a", { screen: "own" }), [laptop]).screen).toEqual({ label: "OWN", tone: "own-screen" });
    expect(chipsFor(entry("a", { screen: "off" }), [laptop]).screen).toEqual({ label: "OFF", tone: "off" });
  });

  it("tags an offline device and leaves YOU off without a selfId", () => {
    const gone = entry("gone", { online: false });
    const c = chipsFor(gone, [laptop, gone]);
    expect(c.tags.map((t) => t.label)).toEqual(["OFFLINE"]);
  });
});

describe("kindLine and deviceCountText", () => {
  it("joins the kind, OWNER and THIS DEVICE", () => {
    expect(kindLine(laptop, "laptop-1")).toBe("LAPTOP · OWNER · THIS DEVICE");
    expect(kindLine(entry("p", { kind: "tablet" }), "laptop-1")).toBe("TABLET");
    expect(kindLine(entry("t", { kind: "tv" }), "t")).toBe("TV · THIS DEVICE");
  });

  it("counts devices, with the online count only when some are away", () => {
    expect(deviceCountText([laptop])).toBe("1 DEVICE");
    expect(deviceCountText([laptop, entry("a")])).toBe("2 DEVICES");
    expect(deviceCountText([laptop, entry("a", { online: false })])).toBe("1 ONLINE · 2 DEVICES");
  });
});

describe("feedChoices and currentFeedValue", () => {
  const pad = entry("pad-1", { kind: "tablet", name: "iPad", ears: "own" });
  const phone = entry("phone-1", { name: "Phone" });
  const roster = [laptop, pad, phone];

  it("lists every other device on its own input; the owner's value is the empty string", () => {
    expect(feedChoices(roster, "phone-1")).toEqual([
      { value: OWNER_FEED_VALUE, label: "Studio" },
      { value: "pad-1", label: "iPad" },
    ]);
    expect(feedChoices(roster, "pad-1")).toEqual([{ value: OWNER_FEED_VALUE, label: "Studio" }]);
  });

  it("has no choices when nothing is on its own input", () => {
    expect(feedChoices([entry("a"), entry("b")], "a")).toEqual([]);
  });

  it("maps follow null and the owner's id to the owner option", () => {
    expect(currentFeedValue(entry("a", { follow: null }), roster)).toBe(OWNER_FEED_VALUE);
    expect(currentFeedValue(entry("a", { follow: "laptop-1" }), roster)).toBe(OWNER_FEED_VALUE);
    expect(currentFeedValue(entry("a", { follow: "pad-1" }), roster)).toBe("pad-1");
  });
});

describe("rejectText", () => {
  it("has a plain sentence per reason and a fallback", () => {
    expect(rejectText("no-mic")).toBe("This device has no microphone.");
    expect(rejectText("tv-off")).toBe("A TV is always a screen.");
    expect(rejectText("bad-follow")).toBe("That device isn't on its own input.");
    expect(rejectText("rate")).toMatch(/Too many changes/);
    expect(rejectText("shape")).toBe("The room refused that change.");
    expect(rejectText("anything")).toBe("The room refused that change.");
  });
});
