// lineTrigger.ts: a cut on a line the signal climbs through, with a Shortest and a Longest in seconds.
import { describe, expect, it } from "vitest";
import {
  BEAT_WAIT_MAX_SEC,
  createLineTrigger,
  lineAt,
  stepLineTrigger,
  type LineTriggerSettings,
  type LineTriggerTick,
} from "../src/render/lineTrigger.ts";

const FPS = 60;
const SETTINGS: LineTriggerSettings = { line: 0.7, sink: 0, shortestSec: 4, longestSec: 30, onBeat: false };

interface Cut {
  t: number;
  kind: "signal" | "timer";
}

/** Every cut over `seconds` at 60 fps of `signal(t)`; `beatAt` says which ticks carry a beat edge. */
function run(
  seconds: number,
  signal: (t: number) => number,
  over: Partial<LineTriggerSettings> = {},
  tickOver: (t: number) => Partial<LineTriggerTick> = () => ({}),
): { cuts: Cut[]; trigger: ReturnType<typeof createLineTrigger> } {
  const trigger = createLineTrigger();
  const cuts: Cut[] = [];
  for (let i = 0; i < Math.round(seconds * FPS); i++) {
    const t = i / FPS;
    const kind = stepLineTrigger(trigger, 1 / FPS, { signal: signal(t), beat: false, armed: true, music: true, ...tickOver(t) }, { ...SETTINGS, ...over });
    if (kind) cuts.push({ t, kind });
  }
  return { cuts, trigger };
}

describe("lineTrigger", () => {
  it("cuts on a slow rise through the line, which a standout detector never counts", () => {
    const { cuts } = run(12, (t) => Math.min(0.9, (t / 10) * 0.9));
    expect(cuts).toHaveLength(1);
    expect(cuts[0]!.kind).toBe("signal");
    // 0.7 is reached at 10 * 0.7 / 0.9 s, after Shortest.
    expect(cuts[0]!.t).toBeCloseTo((10 * 0.7) / 0.9, 1);
  });

  it("cuts a level held above the line only at Longest, and again one Longest later", () => {
    const { cuts } = run(65, () => 0.9);
    expect(cuts.map((c) => c.kind)).toEqual(["timer", "timer"]);
    expect(cuts[0]!.t).toBeCloseTo(30, 1);
    expect(cuts[1]!.t - cuts[0]!.t).toBeCloseTo(30, 1);
  });

  it("never cuts twice within Shortest, however fast the pulses", () => {
    for (const shortestSec of [1, 3.5, 4, 7]) {
      const { cuts } = run(40.25, (t) => (t % 0.5 < 0.1 ? 1 : 0), { shortestSec });
      expect(cuts.length).toBeGreaterThan(2);
      for (let i = 1; i < cuts.length; i++) expect(cuts[i]!.t - cuts[i - 1]!.t).toBeGreaterThanOrEqual(shortestSec - 1e-9);
      expect(cuts[0]!.t).toBeGreaterThanOrEqual(shortestSec - 1e-9);
    }
  });

  it("skips a crossing during Shortest instead of remembering it", () => {
    // Above the line from 1 s on: crossed once at 1 s, during Shortest, so no cut at 4 s.
    const { cuts } = run(10, (t) => (t < 1 ? 0 : 0.9));
    expect(cuts).toEqual([]);
  });

  it("draws the line: flat until Shortest, sunk by Sink at Longest, flat for no sink or no Longest", () => {
    const s: LineTriggerSettings = { ...SETTINGS, sink: 0.5 };
    expect(lineAt(s, 0)).toBe(0.7);
    expect(lineAt(s, s.shortestSec)).toBeCloseTo(0.7, 12);
    expect(lineAt(s, s.longestSec)).toBeCloseTo(0.7 * 0.5, 12);
    expect(lineAt(s, s.longestSec + 20)).toBeCloseTo(0.7 * 0.5, 12);
    const mid = lineAt(s, (s.shortestSec + s.longestSec) / 2)!;
    expect(mid).toBeCloseTo(0.7 * 0.75, 12);
    expect(lineAt({ ...s, sink: 1 }, s.longestSec)).toBeCloseTo(0, 12);
    expect(lineAt({ ...s, sink: 9 }, s.longestSec)).toBeCloseTo(0, 12);
    for (const flat of [{ sink: 0 }, { longestSec: Infinity }]) {
      for (const at of [0, 4, 15, 30, 100]) expect(lineAt({ ...s, ...flat }, at)).toBe(0.7);
    }
    expect(lineAt({ ...s, line: null }, 10)).toBeNull();
  });

  it("with a sink, a signal that stays under the line cuts when the sinking line reaches it", () => {
    const { cuts } = run(40, () => 0.5, { sink: 0.5 });
    // 0.7 * (1 - 0.5 * along) = 0.5 at along = 4/7 of the way from Shortest to Longest.
    expect(cuts[0]!.kind).toBe("signal");
    expect(cuts[0]!.t).toBeCloseTo(4 + (26 * 4) / 7, 1);
    // Without a sink it never cuts before Longest.
    const flat = run(40, () => 0.5);
    expect(flat.cuts.map((c) => c.kind)).toEqual(["timer"]);
  });

  it("on-beat: the timer cut lands on the first beat edge at or after Longest", () => {
    const edges = (t: number): boolean => Math.abs(((t - 0.13) / 0.5) - Math.round((t - 0.13) / 0.5)) < 0.5 / FPS / 0.5 / 2 && t > 0.1;
    const { cuts } = run(40, () => 0.9, { onBeat: true }, (t) => ({ beat: edges(t) }));
    expect(cuts[0]!.kind).toBe("timer");
    expect(cuts[0]!.t).toBeGreaterThanOrEqual(30 - 1e-9);
    // The first edge at or after Longest.
    let first = -1;
    for (let i = 0; i < 40 * FPS; i++) {
      if (i / FPS >= 30 && edges(i / FPS)) {
        first = i / FPS;
        break;
      }
    }
    expect(first).toBeGreaterThan(0);
    expect(cuts[0]!.t).toBeCloseTo(first, 6);
    expect(first - 30).toBeLessThan(0.5 + 1e-9);
  });

  it("on-beat with no beat edges cuts BEAT_WAIT_MAX_SEC after Longest", () => {
    const { cuts } = run(40, () => 0.9, { onBeat: true });
    expect(cuts).toHaveLength(1);
    expect(cuts[0]!.kind).toBe("timer");
    expect(cuts[0]!.t).toBeCloseTo(30 + BEAT_WAIT_MAX_SEC, 1);
  });

  it("disarmed never cuts and keeps the wait at 0; re-armed, it starts a fresh wait", () => {
    const trigger = createLineTrigger();
    const s = { ...SETTINGS };
    for (let i = 0; i < 60 * FPS; i++) {
      expect(stepLineTrigger(trigger, 1 / FPS, { signal: i % 20 < 5 ? 1 : 0, beat: true, armed: false, music: true }, s)).toBeNull();
      expect(trigger.sinceSec).toBe(0);
    }
    let first = -1;
    for (let i = 0; i < 40 * FPS; i++) {
      if (stepLineTrigger(trigger, 1 / FPS, { signal: 0.9, beat: false, armed: true, music: true }, s) && first < 0) first = i / FPS;
    }
    // Held above the line from the moment it armed: only the timer, a full Longest later.
    expect(first).toBeGreaterThanOrEqual(29.9);
    expect(first).toBeLessThanOrEqual(30.1);
  });

  it("without music the timer waits but a crossing still cuts", () => {
    const quiet = run(70, () => 0.9, {}, () => ({ music: false }));
    expect(quiet.cuts).toEqual([]);
    const crossing = run(10, (t) => (t < 5 ? 0 : 0.9), {}, () => ({ music: false }));
    expect(crossing.cuts).toHaveLength(1);
    expect(crossing.cuts[0]!.kind).toBe("signal");
    // Music returns long after Longest: it cuts at once.
    const back = run(40, () => 0.9, {}, (t) => ({ music: t >= 35 }));
    expect(back.cuts[0]!.kind).toBe("timer");
    expect(back.cuts[0]!.t).toBeCloseTo(35, 1);
  });

  it("with no line, cuts only at Longest; with no line and no Longest, never", () => {
    const { cuts } = run(65, (t) => (t % 1 < 0.5 ? 1 : 0), { line: null });
    expect(cuts.map((c) => c.kind)).toEqual(["timer", "timer"]);
    expect(cuts[0]!.t).toBeCloseTo(30, 1);
    expect(run(300, (t) => (t % 1 < 0.5 ? 1 : 0), { line: null, longestSec: Infinity }).cuts).toEqual([]);
  });
});
