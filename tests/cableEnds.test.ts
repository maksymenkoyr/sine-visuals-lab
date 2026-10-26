// The cable plugs' resting place, how a pull draws the cable and which end it
// lets go of, and what letting go does (src/ui/cableLayer.ts header); the
// pointer wiring is checked in a browser.
import { describe, expect, it } from "vitest";
import { nearerEnd, plugPoint, pulledPathD, pullRelease, pullStarts, type CableEnd, type PullAt } from "../src/ui/cableLayer.ts";

const ENDS: CableEnd[] = ["jack", "port"];
const first = (d: string): string => d.split(" ")[0]!;
const last = (d: string): string => d.trim().split(" ").pop()!;
const cubics = (d: string): number => d.split("C").length - 1;

describe("plugPoint", () => {
  const jack = { x: 100, y: 40 };
  const port = { x: 900, y: 300 };

  it("rests each plug on its own socket's row", () => {
    for (const end of ENDS) expect(plugPoint(jack, port, end).y).toBe(end === "jack" ? jack.y : port.y);
  });

  it("rests each plug just out from its socket, toward the other end, the same distance at both ends", () => {
    const j = plugPoint(jack, port, "jack");
    const p = plugPoint(jack, port, "port");
    expect(j.x).toBeGreaterThan(jack.x);
    expect(p.x).toBeLessThan(port.x);
    expect(j.x - jack.x).toBe(port.x - p.x);
    expect(j.x - jack.x).toBeLessThan((port.x - jack.x) / 10);
  });

  it("mirrors when the port sits left of the jack", () => {
    const right = { x: 900, y: 40 };
    const left = { x: 100, y: 300 };
    expect(plugPoint(right, left, "jack").x).toBeLessThan(right.x);
    expect(plugPoint(right, left, "port").x).toBeGreaterThan(left.x);
  });
});

describe("pullRelease", () => {
  it("is a click when the press never became a pull, wherever it was let go", () => {
    expect(pullRelease(0, 0, false)).toBe("click");
    expect(pullRelease(300, 0, false)).toBe("click");
  });

  it("unplugs a long pull in any direction", () => {
    for (const [dx, dy] of [[300, 0], [-300, 0], [0, 300], [0, -300], [200, 200]] as const) {
      expect(pullRelease(dx, dy, true)).toBe("unplug");
    }
  });

  it("puts back a pull let go right after it started", () => {
    let d = 0;
    while (!pullStarts(d, 0)) d++;
    expect(pullRelease(d, 0, true)).toBe("back");
  });
});

describe("pullStarts", () => {
  it("ignores a press that barely moved, and starts on a clear move", () => {
    expect(pullStarts(0, 0)).toBe(false);
    expect(pullStarts(1, 1)).toBe(false);
    expect(pullStarts(0, 40)).toBe(true);
  });
});

describe("nearerEnd", () => {
  it("lets go of the end nearer the press", () => {
    expect(nearerEnd({ x: 100 }, { x: 900 }, 300)).toBe("jack");
    expect(nearerEnd({ x: 100 }, { x: 900 }, 700)).toBe("port");
  });

  it("goes by distance, not side, when the port sits left of the jack", () => {
    expect(nearerEnd({ x: 900 }, { x: 100 }, 300)).toBe("port");
    expect(nearerEnd({ x: 900 }, { x: 100 }, 700)).toBe("jack");
  });
});

describe("pulledPathD", () => {
  const jack = { x: 100, y: 40 };
  const port = { x: 900, y: 300 };

  it("draws the plain cable, one bend between its sockets, when nothing pulls it", () => {
    const d = pulledPathD(jack, port, null, null);
    expect(first(d)).toBe("M100,40");
    expect(last(d)).toBe("H900");
    expect(cubics(d)).toBe(1);
  });

  it("bends a cable pulled by its stroke through the pointer, both ends still in", () => {
    for (const end of ENDS) {
      const at: PullAt = { end, x: 400, y: 600, via: true };
      const d = pulledPathD(jack, port, null, at);
      expect(first(d)).toBe("M100,40");
      expect(last(d)).toBe("H900");
      expect(d).toContain(" 400,600 C");
    }
  });

  it("ends a pulled plug at the pointer, the other end still in its socket", () => {
    const portOut = pulledPathD(jack, port, null, { end: "port", x: 500, y: 700, via: false });
    expect(first(portOut)).toBe("M100,40");
    expect(last(portOut)).toBe("H500");
    const jackOut = pulledPathD(jack, port, null, { end: "jack", x: 300, y: 500, via: false });
    expect(first(jackOut)).toBe("M300,500");
    expect(last(jackOut)).toBe("H900");
  });

  it("detours under Power only while the port end is in its socket", () => {
    const power = { top: 250, bottom: 350 };
    expect(cubics(pulledPathD(jack, port, power, null))).toBe(2);
    expect(cubics(pulledPathD(jack, port, power, { end: "jack", x: 300, y: 500, via: false }))).toBe(2);
    expect(cubics(pulledPathD(jack, port, power, { end: "port", x: 500, y: 700, via: false }))).toBe(1);
  });
});
