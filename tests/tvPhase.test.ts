import { describe, expect, it } from "vitest";
import { TV_PHASE_TEXT, hostInRoster, tvPhase, waitingLine } from "../src/net/tvPhase.ts";

describe("tvPhase", () => {
  it("is pair for any unpaired screen, whatever the socket and frames say", () => {
    for (const connected of [false, true]) {
      for (const freshFrames of [false, true]) {
        expect(tvPhase({ paired: false, connected, freshFrames })).toBe("pair");
      }
    }
  });

  it("is joining while a paired screen's socket is not open", () => {
    expect(tvPhase({ paired: true, connected: false, freshFrames: false })).toBe("joining");
  });

  it("ignores frames that outlived their socket: a dropped link is joining again, not live", () => {
    expect(tvPhase({ paired: true, connected: false, freshFrames: true })).toBe("joining");
  });

  it("waits for the laptop when the socket is open but no fresh frames arrive", () => {
    expect(tvPhase({ paired: true, connected: true, freshFrames: false })).toBe("waiting");
  });

  it("is live once the socket is open and frames are fresh", () => {
    expect(tvPhase({ paired: true, connected: true, freshFrames: true })).toBe("live");
  });
});

describe("TV_PHASE_TEXT", () => {
  it("has a line for the two phases that show one, and they differ", () => {
    expect(TV_PHASE_TEXT.joining).not.toBe("");
    expect(TV_PHASE_TEXT.waiting).not.toBe("");
    expect(TV_PHASE_TEXT.joining).not.toBe(TV_PHASE_TEXT.waiting);
  });
});

describe("waitingLine", () => {
  it("is the plain waiting line until the socket has had a roster", () => {
    expect(waitingLine(null)).toBe(TV_PHASE_TEXT.waiting);
  });

  it("tells a silent laptop that is in the room from one that is gone", () => {
    expect(waitingLine(true)).not.toBe(waitingLine(false));
    expect(waitingLine(true)).not.toBe(TV_PHASE_TEXT.waiting);
    expect(waitingLine(false)).toMatch(/isn't in this room/);
  });
});

describe("hostInRoster", () => {
  it("is true only when the roster lists a host", () => {
    expect(hostInRoster([])).toBe(false);
    expect(hostInRoster([{ role: "renderer" }, { role: "controller" }])).toBe(false);
    expect(hostInRoster([{ role: "renderer" }, { role: "host" }])).toBe(true);
  });

  it("does not count a host that is listed but offline", () => {
    expect(hostInRoster([{ role: "host", online: false }])).toBe(false);
    expect(hostInRoster([{ role: "host", online: true }])).toBe(true);
  });
});
