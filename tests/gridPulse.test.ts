import { describe, it, expect } from "vitest";
import { createGridPulse, GRID_LOCK_OFF, GRID_LOCK_ON } from "../src/render/gridPulse.ts";
import { BEAT_GRIDS, beatGridBeats, beatGridLabel } from "../src/audio/beatGrid.ts";

const DT = 1 / 60;
const BPM = 120;

/** Runs `seconds` of a locked clock at BPM through the pulse and counts
 *  fires; raw onsets fire on every third beat so the two sources differ. */
function run(gridBeats: number | null, seconds: number, tempoLock = 1) {
  const pulse = createGridPulse();
  let beats = 0;
  let fires = 0;
  let firstFireBeats: number | null = null;
  for (let t = 0; t < seconds; t += DT) {
    const prev = beats;
    beats += DT * (BPM / 60);
    const rawOnset = Math.floor(beats / 3) !== Math.floor(prev / 3);
    if (pulse.advance(beats, tempoLock, gridBeats, rawOnset)) {
      fires++;
      if (firstFireBeats === null) firstFireBeats = beats;
    }
  }
  return { fires, firstFireBeats, pulse };
}

describe("beat grid pulse", () => {
  it("Hits passes the raw detector edge through untouched", () => {
    const { fires, pulse } = run(null, 6);
    expect(fires).toBe(4); // one raw onset every 3 beats over 12 beats
    expect(pulse.onGrid).toBe(false);
  });

  it("fires once per note value on a locked tempo", () => {
    expect(run(1, 8).fires).toBe(16); // 1/4: 16 beats in 8s at 120
    expect(run(0.5, 8).fires).toBe(32); // 1/8
    expect(run(2, 8).fires).toBe(8); // 1/2
    expect(run(4, 8).fires).toBe(4); // 1 bar
    expect(run(8, 16).fires).toBe(4); // 2 bars
  });

  it("fires on the beat line, not on the raw onsets", () => {
    const { firstFireBeats } = run(1, 4);
    // First grid tick is the crossing of beat 1 (the clock starts at 0 and
    // arms silently there).
    expect(firstFireBeats).toBeGreaterThan(1);
    expect(firstFireBeats).toBeLessThan(1 + 2 * DT * (BPM / 60));
  });

  it("falls back to hits until the tracker locks, with hysteresis", () => {
    const pulse = createGridPulse();
    let beats = 0;
    let fires = 0;
    // Unlocked: only the raw onset gets through.
    for (let i = 0; i < 120; i++) {
      beats += DT * 2;
      if (pulse.advance(beats, GRID_LOCK_ON - 0.05, 1, i === 30)) fires++;
    }
    expect(fires).toBe(1);
    expect(pulse.onGrid).toBe(false);
    // Crossing the lock threshold is silent, then the grid takes over.
    fires = 0;
    // 130 ticks = 4.33 beats: clears four beat lines with margin against
    // float rounding at the fourth.
    for (let i = 0; i < 130; i++) {
      beats += DT * 2;
      if (pulse.advance(beats, GRID_LOCK_ON + 0.05, 1, false)) fires++;
    }
    expect(pulse.onGrid).toBe(true);
    expect(fires).toBe(4);
    // Dipping between the two thresholds keeps the grid.
    pulse.advance(beats, (GRID_LOCK_ON + GRID_LOCK_OFF) / 2, 1, false);
    expect(pulse.onGrid).toBe(true);
    // Dropping under the off threshold hands back to hits.
    expect(pulse.advance(beats, GRID_LOCK_OFF - 0.05, 1, true)).toBe(true);
    expect(pulse.onGrid).toBe(false);
  });

  it("never fires on the tick the grid is switched", () => {
    const pulse = createGridPulse();
    let beats = 0;
    for (let i = 0; i < 100; i++) {
      beats += DT * 2;
      pulse.advance(beats, 1, 1, false);
    }
    // Mid-bar, switch to 2 bars: index changes from ~3 (of 1-beat) to 0 (of 8-beat).
    expect(pulse.advance(beats + DT * 2, 1, 8, false)).toBe(false);
  });

  it("beatGrid store maps indices to note values and labels", () => {
    expect(beatGridBeats(0)).toBeNull();
    expect(BEAT_GRIDS.map((g) => g.beats)).toEqual([null, 0.5, 1, 2, 4, 8]);
    expect(beatGridBeats(99)).toBe(8);
    expect(beatGridBeats(-1)).toBeNull();
    expect(beatGridLabel(2)).toBe("1/4");
  });
});
