import { describe, expect, it } from "vitest";
import type { AutopilotConfig } from "../src/render/sceneSet.ts";
import { crossedBeatMultiple, METRONOME_BEATS_PER_BAR } from "../src/render/metronome.ts";
import {
  AUTOPILOT_FALLBACK_SEC_PER_BAR,
  createAutopilot,
  restartAutopilot,
  stepAutopilot,
  type AutopilotState,
} from "../src/render/setAutopilot.ts";

const IDS = ["a", "b", "c"];
const CFG: AutopilotConfig = { on: true, everyBars: 4, order: "inOrder" };
const BAR = METRONOME_BEATS_PER_BAR;
const DT_BEATS = 0.1;

/** Runs the metronome-clocked machine from `from` to `to` beats in small
 *  steps, collecting what fired and at which beat. */
function runBeats(
  s: AutopilotState,
  from: number,
  to: number,
  cfg = CFG,
  ids = IDS,
  random?: () => number,
): Array<{ id: string; beats: number }> {
  const out: Array<{ id: string; beats: number }> = [];
  for (let b = from; b <= to + 1e-9; b += DT_BEATS) {
    const id = stepAutopilot(s, { timeSec: b / 2, beats: b, tempo: true }, cfg, ids, random);
    if (id) out.push({ id, beats: b });
  }
  return out;
}

describe("crossedBeatMultiple", () => {
  it("is true only on the tick a multiple was passed", () => {
    expect(crossedBeatMultiple(3.9, 4.1, 4)).toBe(true);
    expect(crossedBeatMultiple(4.1, 4.3, 4)).toBe(false);
    expect(crossedBeatMultiple(7.9, 8, 4)).toBe(true);
  });
});

describe("autopilot on the metronome", () => {
  it("fires on the bar boundary after N bars, then every N bars exactly", () => {
    const s = createAutopilot();
    const fired = runBeats(s, 1.05, 80);
    expect(fired.map((f) => f.id)).toEqual(["a", "b", "c", "a"]);
    // First change: on the first bar boundary at least N bars after the start.
    expect(fired[0]!.beats).toBeGreaterThanOrEqual(1.05 + 4 * BAR);
    expect(fired[0]!.beats).toBeLessThan(1.05 + 5 * BAR + DT_BEATS);
    for (const f of fired) expect(f.beats % BAR).toBeLessThan(DT_BEATS + 1e-6);
    // Every one after an Autopilot change is exactly N bars on.
    const gaps = fired.slice(1).map((f, i) => Math.round((f.beats - fired[i]!.beats) / BAR));
    expect(gaps).toEqual([4, 4, 4]);
  });

  it("restarts the bar count on a manual press", () => {
    const s = createAutopilot();
    runBeats(s, 1, 14); // 13 beats in, nothing due yet
    restartAutopilot(s, "b"); // pressed by hand
    const fired = runBeats(s, 14.1, 14.1 + 4 * BAR - 1);
    expect(fired).toEqual([]);
    const later = runBeats(s, 14.1 + 4 * BAR - 1, 14.1 + 5 * BAR + 1);
    expect(later[0]?.id).toBe("c"); // walks on from the pressed pad
  });

  it("walks from an unknown cursor to the first pad and wraps after the last", () => {
    const s = createAutopilot();
    restartAutopilot(s, "gone");
    expect(runBeats(s, 0.5, 20)[0]?.id).toBe("a");
    const s2 = createAutopilot();
    restartAutopilot(s2, "c");
    expect(runBeats(s2, 0.5, 20)[0]?.id).toBe("a");
  });

  it("does nothing with fewer than two pads or while off", () => {
    expect(runBeats(createAutopilot(), 0.5, 100, CFG, ["a"])).toEqual([]);
    expect(runBeats(createAutopilot(), 0.5, 100, { ...CFG, on: false })).toEqual([]);
  });

  it("starts counting from the moment it turns on, not from the past", () => {
    const s = createAutopilot();
    runBeats(s, 0.5, 100, { ...CFG, on: false });
    const fired = runBeats(s, 100.1, 100.1 + 3 * BAR, CFG);
    expect(fired).toEqual([]);
  });
});

describe("shuffle", () => {
  it("deals every pad once before repeating and never repeats across a deal", () => {
    const s = createAutopilot();
    const cfg: AutopilotConfig = { ...CFG, everyBars: 4, order: "shuffle" };
    let n = 0;
    const random = () => [0.9, 0.1, 0.5, 0.0, 0.7, 0.3][n++ % 6]!;
    const fired = runBeats(s, 0.5, 4 * BAR * 8, cfg, ["a", "b", "c", "d"], random).map((f) => f.id);
    expect(fired.length).toBeGreaterThanOrEqual(6);
    for (let i = 0; i + 4 <= fired.length; i += 4) expect(new Set(fired.slice(i, i + 4)).size).toBe(4);
    for (let i = 1; i < fired.length; i++) expect(fired[i]).not.toBe(fired[i - 1]);
  });

  it("copes with a pad deleted mid-deal", () => {
    const s = createAutopilot();
    const cfg: AutopilotConfig = { ...CFG, order: "shuffle" };
    const first = runBeats(s, 0.5, 5 * BAR + 1, cfg, ["a", "b", "c"], () => 0)[0];
    expect(first).toBeDefined();
    const left = ["a", "b", "c"].filter((id) => id !== first!.id);
    const next = runBeats(s, 5 * BAR + 1, 12 * BAR, cfg, left, () => 0)[0];
    expect(left).toContain(next?.id);
  });
});

describe("autopilot with no tempo", () => {
  it("falls back to a timer of seconds per bar", () => {
    const s = createAutopilot();
    const cfg: AutopilotConfig = { ...CFG, everyBars: 4 };
    const fired: Array<{ id: string; t: number }> = [];
    for (let t = 0; t <= 40; t += 0.05) {
      const id = stepAutopilot(s, { timeSec: t, beats: 0, tempo: false }, cfg, IDS);
      if (id) fired.push({ id, t });
    }
    const gap = 4 * AUTOPILOT_FALLBACK_SEC_PER_BAR;
    expect(fired.map((f) => f.id)).toEqual(["a", "b", "c", "a"]);
    expect(fired[0]!.t).toBeGreaterThanOrEqual(gap);
    expect(fired[0]!.t).toBeLessThan(gap + 0.2);
    expect(fired[1]!.t - fired[0]!.t).toBeCloseTo(gap, 0);
  });

  it("restarts the count when a tempo settles, instead of firing off a mixed-up clock", () => {
    const s = createAutopilot();
    const cfg: AutopilotConfig = { ...CFG, everyBars: 4 };
    for (let t = 0; t < 7; t += 0.05) stepAutopilot(s, { timeSec: t, beats: 0, tempo: false }, cfg, IDS);
    // The metronome starts and its beat count jumps to the live clock's (large).
    const fired = stepAutopilot(s, { timeSec: 7.05, beats: 5000.2, tempo: true }, cfg, IDS);
    expect(fired).toBeNull();
  });
});
