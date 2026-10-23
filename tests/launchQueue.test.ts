import { afterEach, describe, expect, it, vi } from "vitest";
import { METRONOME_BEATS_PER_BAR } from "../audio-subsystem/src/metronome.ts";
import {
  LAUNCH_ON,
  LAUNCH_ON_DEFAULT,
  PHRASE_BARS,
  cancelLaunch,
  launchBeat,
  queueLaunch,
  takeDue,
  type QueuedLaunch,
} from "../src/render/launchQueue.ts";
import { PRIVATE_KEYS } from "../src/net/syncedStores.ts";

const BAR = METRONOME_BEATS_PER_BAR;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("launchBeat", () => {
  it("lands a press on the next line strictly after now", () => {
    expect(launchBeat(5.3, "now")).toBe(5.3);
    expect(launchBeat(5.3, "beat")).toBe(6);
    expect(launchBeat(5.3, "bar")).toBe(2 * BAR);
    expect(launchBeat(5.3, "4bars")).toBe(4 * BAR);
    expect(launchBeat(5.3, "phrase")).toBe(PHRASE_BARS * BAR);
  });

  it("moves a press exactly on a line to the line after it", () => {
    for (const on of LAUNCH_ON) {
      if (on === "now") continue;
      const size = { beat: 1, bar: BAR, "4bars": 4 * BAR, phrase: PHRASE_BARS * BAR }[on];
      const onLine = 3 * size;
      expect(launchBeat(onLine, on), on).toBe(4 * size);
      expect(launchBeat(onLine + 0.05 * size, on), on).toBe(4 * size);
      expect(launchBeat(onLine - 0.05 * size, on), on).toBe(3 * size);
    }
  });

  it("counts a press a hair before a line as on it", () => {
    expect(launchBeat(2 * BAR - 1e-12, "bar")).toBe(3 * BAR);
    expect(launchBeat(2 * BAR - 0.1, "bar")).toBe(2 * BAR);
  });

  it("takes the bar size it is given", () => {
    expect(launchBeat(5, "bar", 3)).toBe(6);
  });
});

describe("queueLaunch and cancelLaunch", () => {
  it("sorts by beat and replaces a launch already at that beat", () => {
    let q: QueuedLaunch[] = [];
    q = queueLaunch(q, "b", 8);
    q = queueLaunch(q, "a", 4);
    q = queueLaunch(q, "c", 8);
    expect(q).toEqual([
      { padId: "a", atBeats: 4 },
      { padId: "c", atBeats: 8 },
    ]);
  });

  it("never mutates the queue it is given", () => {
    const q: QueuedLaunch[] = [{ padId: "a", atBeats: 4 }];
    const copy = JSON.stringify(q);
    queueLaunch(q, "b", 2);
    cancelLaunch(q, 4);
    expect(JSON.stringify(q)).toBe(copy);
  });

  it("cancels the launch at a beat and leaves the rest", () => {
    const q: QueuedLaunch[] = [
      { padId: "a", atBeats: 4 },
      { padId: "b", atBeats: 8 },
    ];
    expect(cancelLaunch(q, 4)).toEqual([{ padId: "b", atBeats: 8 }]);
    expect(cancelLaunch(q, 5)).toEqual(q);
  });
});

describe("takeDue", () => {
  const Q: QueuedLaunch[] = [
    { padId: "a", atBeats: 4 },
    { padId: "b", atBeats: 8 },
    { padId: "c", atBeats: 12 },
  ];

  it("finds nothing due before the first launch", () => {
    expect(takeDue(Q, 3.9)).toEqual({ due: null, rest: Q });
    expect(takeDue([], 100)).toEqual({ due: null, rest: [] });
  });

  it("takes one due launch and keeps the later ones", () => {
    expect(takeDue(Q, 4)).toEqual({ due: { padId: "a", atBeats: 4 }, rest: Q.slice(1) });
    expect(takeDue(Q, 7.99)).toEqual({ due: { padId: "a", atBeats: 4 }, rest: Q.slice(1) });
  });

  it("when several are due at once, only the last counts and the rest are dropped", () => {
    expect(takeDue(Q, 9)).toEqual({ due: { padId: "b", atBeats: 8 }, rest: [{ padId: "c", atBeats: 12 }] });
    expect(takeDue(Q, 100)).toEqual({ due: { padId: "c", atBeats: 12 }, rest: [] });
  });
});

describe("the launch line store", () => {
  it("is private to the device", () => {
    expect(PRIVATE_KEYS.has("vibe.launchOn")).toBe(true);
  });

  it("reads the default when nothing is stored, and a bad stored value falls back to it", async () => {
    vi.stubGlobal("localStorage", { getItem: () => "whenever", setItem: () => {}, removeItem: () => {} });
    vi.resetModules();
    const mod = await import("../src/render/launchQueue.ts");
    expect(mod.getLaunchOn()).toBe(LAUNCH_ON_DEFAULT);
  });

  it("round-trips a stored choice", async () => {
    const m = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    });
    vi.resetModules();
    const mod = await import("../src/render/launchQueue.ts");
    mod.setLaunchOn("phrase");
    expect(m.get("vibe.launchOn")).toBe("phrase");
    expect(mod.getLaunchOn()).toBe("phrase");
    vi.resetModules();
    const again = await import("../src/render/launchQueue.ts");
    expect(again.getLaunchOn()).toBe("phrase");
  });

  it("keeps the choice for the session when storage throws", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    });
    vi.resetModules();
    const mod = await import("../src/render/launchQueue.ts");
    expect(mod.getLaunchOn()).toBe(LAUNCH_ON_DEFAULT);
    mod.setLaunchOn("beat");
    expect(mod.getLaunchOn()).toBe("beat");
  });
});
