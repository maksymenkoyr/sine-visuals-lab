import { describe, expect, it } from "vitest";
import { TV_PHASE_TEXT, WAITING_HINT_AFTER_MS, WAITING_HINT_TEXT, tvPhase, waitingLine } from "../src/net/tvPhase.ts";

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
  it("is the plain waiting line at first, so a laptop that is starting up sees no instructions", () => {
    expect(waitingLine(0)).toBe(TV_PHASE_TEXT.waiting);
    expect(waitingLine(WAITING_HINT_AFTER_MS - 1)).toBe(TV_PHASE_TEXT.waiting);
  });

  it("adds the way out once the wait has lasted, keeping the waiting line", () => {
    for (const waited of [WAITING_HINT_AFTER_MS, WAITING_HINT_AFTER_MS * 100]) {
      const line = waitingLine(waited);
      expect(line.startsWith(TV_PHASE_TEXT.waiting)).toBe(true);
      expect(line).toContain(WAITING_HINT_TEXT);
    }
  });

  it("tells the viewer to press OK twice, which is what tv.ts listens for", () => {
    expect(WAITING_HINT_TEXT).toMatch(/OK twice/);
  });
});
