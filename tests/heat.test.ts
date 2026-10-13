import { describe, expect, it } from "vitest";
import {
  createHeatTrack,
  HEAT_COLORS,
  HEAT_LEVEL_LOUD,
  HEAT_LEVEL_QUIET,
  HEAT_STEPS,
  type HeatTrack,
  heatColor,
  heatStep,
  heatText,
} from "../src/ui/heat.ts";
import { HISTORY_SPAN_MAX } from "../src/ui/historySpan.ts";

const PER_SEC = 60;

/** Pushes `PER_SEC` ticks a second for every whole second from `fromSec` to
 *  `toSec` inclusive; `x(k)` gives the reading for tick k within its second. */
function feed(track: HeatTrack, fromSec: number, toSec: number, x: (k: number) => number, level: number): void {
  for (let s = fromSec; s <= toSec; s++) {
    for (let k = 0; k < PER_SEC; k++) track.push(x(k), level, s + k / PER_SEC);
  }
}

const square = (k: number): number => k % 2;
const flat = (): number => 0.5;

describe("heat", () => {
  it("reads a flat value as cold", () => {
    const t = createHeatTrack();
    feed(t, 0, 9, flat, 0.9);
    expect(t.read(10, 9.99)!.heat).toBeCloseTo(0);
  });

  it("reads a full 0-to-1 swing on loud music as hot", () => {
    const t = createHeatTrack();
    feed(t, 0, 9, square, 0.9);
    expect(t.read(10, 9.99)!.heat).toBeGreaterThan(0.95);
  });

  it("warms the same swing more on loud music than on quiet music", () => {
    const quiet = createHeatTrack();
    feed(quiet, 0, 9, square, HEAT_LEVEL_QUIET + 0.02);
    const loud = createHeatTrack();
    feed(loud, 0, 9, square, HEAT_LEVEL_LOUD);
    const quietHeat = quiet.read(10, 9.99)!.heat;
    const loudHeat = loud.read(10, 9.99)!.heat;
    expect(quietHeat).toBeGreaterThan(0);
    expect(quietHeat).toBeLessThan(loudHeat);
  });

  it("reads silence as cold, whatever the swing", () => {
    const t = createHeatTrack();
    feed(t, 0, 9, square, HEAT_LEVEL_QUIET / 2);
    expect(t.read(10, 9.99)!.heat).toBe(0);
  });

  it("counts each second once across a stalled second", () => {
    const t = createHeatTrack();
    feed(t, 0, 4, flat, 0.9);
    feed(t, 6, 9, flat, 0.9);
    expect(t.read(10, 9.5)!.samples).toBe(5 * PER_SEC + 4 * PER_SEC);
  });

  it("reads only the span asked for", () => {
    const t = createHeatTrack();
    feed(t, 0, 19, square, 0.9);
    feed(t, 20, 29, flat, 0.9);
    expect(t.read(10, 29.5)!.swing).toBeCloseTo(0);
    expect(t.read(30, 29.5)!.swing).toBeGreaterThan(0.3);
  });

  it("forgets seconds the ring has wrapped past", () => {
    const t = createHeatTrack();
    feed(t, 0, 9, square, 0.9);
    const last = HISTORY_SPAN_MAX + 20;
    feed(t, 10, last, flat, 0.9);
    const read = t.read(HISTORY_SPAN_MAX, last + 0.99)!;
    expect(read.swing).toBeCloseTo(0);
    expect(read.samples).toBe(PER_SEC * HISTORY_SPAN_MAX);
  });

  it("does not count a slot's old second once the ring reuses it", () => {
    const t = createHeatTrack();
    feed(t, 0, 4, flat, 0.9);
    // `reuse` shares second 2's slot (one ring length, HISTORY_SPAN_MAX + 1
    // seconds, later), so it resets that slot; of the old seconds only the
    // last is still inside the HISTORY_SPAN_MAX window ending at `reuse`.
    const reuse = HISTORY_SPAN_MAX + 1 + 2;
    for (let k = 0; k < 10; k++) t.push(0.5, 0.9, reuse + k / 10);
    expect(t.read(HISTORY_SPAN_MAX, reuse + 0.5)!.samples).toBe(PER_SEC + 10);
  });

  it("reads an empty track as null, and heatText says it is not measured", () => {
    expect(createHeatTrack().read(10, 5)).toBeNull();
    expect(heatText(null, 30)).toContain("not measured");
  });

  it("maps heat to the first and last step and colour", () => {
    expect(heatStep(0)).toBe(0);
    expect(heatStep(1)).toBe(HEAT_STEPS - 1);
    expect(heatColor(0)).toBe(HEAT_COLORS[0]);
    expect(heatColor(HEAT_STEPS - 1)).toBe(HEAT_COLORS[HEAT_COLORS.length - 1]);
  });

  it("describes a loud full swing in plain words", () => {
    const text = heatText({ heat: 1, swing: 1, level: 0.9, samples: 600 }, 30);
    expect(text).toContain("hot");
    expect(text).toContain("Moved a lot");
    expect(text).toContain("30s");
    expect(text).toContain("loud music");
  });
});
