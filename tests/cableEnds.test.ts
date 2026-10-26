// The cable plugs' resting place and what letting go of one does
// (src/ui/cableLayer.ts header); the pointer wiring is checked in a browser.
import { describe, expect, it } from "vitest";
import { plugPoint, pullRelease, pullStarts, type CableEnd } from "../src/ui/cableLayer.ts";

const ENDS: CableEnd[] = ["jack", "port"];

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
