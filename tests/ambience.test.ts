import { describe, it, expect } from "vitest";
import {
  MAX_COMETS,
  MAX_PULSES,
  POSE_FLOATS,
  PULSE_REFRACTORY_SEC,
  PULSE_TAIL,
  REST_POSE,
  SHEET_HYSTERESIS,
  WINDOW_OPEN,
  barsPerPose,
  cometState,
  createPoseScheduler,
  createPulsePool,
  createRng,
  freeRunSec,
  gridDimsForQuality,
  phaseMix,
  poseToArray,
  randomPose,
  sunburstProgress,
} from "../src/render/scenes/ambience.ts";

const DT = 1 / 60;

describe("ambience lattice size", () => {
  it("never grows the lattice as the detail proxy drops", () => {
    const qualities = [1.0, 0.7, 0.4, 0.25]; // high, mid, low, floor
    for (let i = 1; i < qualities.length; i++) {
      const better = gridDimsForQuality(qualities[i - 1]);
      const worse = gridDimsForQuality(qualities[i]);
      expect(worse.cols).toBeLessThanOrEqual(better.cols);
      expect(worse.rows).toBeLessThanOrEqual(better.rows);
    }
    const floor = gridDimsForQuality(0);
    expect(floor.cols).toBeGreaterThan(1);
    expect(floor.rows).toBeGreaterThan(1);
  });
});

describe("ambience pulse pool", () => {
  const COLS = 40;
  const ROWS = 28;
  const strengths = (pool: ReturnType<typeof createPulsePool>) =>
    Array.from({ length: MAX_PULSES }, (_, i) => pool.data[i * 4 + 3]);

  it("starts empty and uploads a fired swell at its full strength", () => {
    const pool = createPulsePool(createRng(1));
    expect(pool.live()).toBe(0);
    expect(strengths(pool).every((s) => s === 0)).toBe(true);
    expect(pool.trigger(0.8, COLS, ROWS)).toBe(true);
    expect(pool.live()).toBe(1);
    const live = strengths(pool).filter((s) => s > 0);
    expect(live).toHaveLength(1);
    expect(live[0]).toBeCloseTo(0.8, 6); // Float32 storage
  });

  it("puts the head just off the sheet, on a line that exists", () => {
    const rng = createRng(2);
    for (let n = 0; n < 200; n++) {
      const pool = createPulsePool(rng);
      pool.trigger(1, COLS, ROWS);
      const slot = strengths(pool).findIndex((s) => s > 0);
      const o = slot * 4;
      const axis = pool.data[o];
      const line = pool.data[o + 1];
      const head = pool.data[o + 2];
      expect(axis === 0 || axis === 1).toBe(true);
      expect(Number.isInteger(line)).toBe(true);
      expect(line).toBeGreaterThanOrEqual(0);
      expect(line).toBeLessThan(axis === 0 ? ROWS : COLS);
      const cells = axis === 0 ? COLS : ROWS;
      expect(head === -PULSE_TAIL || head === cells - 1 + PULSE_TAIL).toBe(true);
    }
  });

  it("folds a second hit inside the refractory window into the first", () => {
    const pool = createPulsePool(createRng(3));
    expect(pool.trigger(1, COLS, ROWS)).toBe(true);
    pool.tick(DT, 1);
    expect(pool.trigger(1, COLS, ROWS)).toBe(false);
    expect(pool.live()).toBe(1);
    pool.tick(PULSE_REFRACTORY_SEC, 1);
    expect(pool.trigger(1, COLS, ROWS)).toBe(true);
    expect(pool.live()).toBe(2);
  });

  it("a forced trigger (drop burst) ignores the refractory window", () => {
    const pool = createPulsePool(createRng(4));
    expect(pool.trigger(1, COLS, ROWS)).toBe(true);
    expect(pool.trigger(1, COLS, ROWS, true)).toBe(true);
    expect(pool.trigger(1, COLS, ROWS, true)).toBe(true);
    expect(pool.live()).toBe(3);
  });

  it("runs the head along its line and frees the slot once it has left the sheet", () => {
    const pool = createPulsePool(createRng(5));
    pool.trigger(1, COLS, ROWS);
    const o = strengths(pool).findIndex((s) => s > 0) * 4;
    const start = pool.data[o + 2];
    pool.tick(0.1, 1);
    const moved = pool.data[o + 2];
    expect(moved).not.toBe(start);
    // Monotone in one direction: the sign of the first step is the sign of every step.
    const dir = Math.sign(moved - start);
    let prev = moved;
    let steps = 0;
    while (pool.live() > 0 && steps < 10_000) {
      pool.tick(0.05, 1);
      if (pool.live() > 0) {
        expect(Math.sign(pool.data[o + 2] - prev)).toBe(dir);
        prev = pool.data[o + 2];
      }
      steps++;
    }
    expect(pool.live()).toBe(0);
    expect(pool.data[o + 3]).toBe(0);
    // Faster Swell speed clears the line sooner.
    const slow = createPulsePool(createRng(5));
    const fast = createPulsePool(createRng(5));
    slow.trigger(1, COLS, ROWS);
    fast.trigger(1, COLS, ROWS);
    let slowTicks = 0;
    let fastTicks = 0;
    while (slow.live() > 0 && slowTicks < 10_000) {
      slow.tick(0.05, 0.5);
      slowTicks++;
    }
    while (fast.live() > 0 && fastTicks < 10_000) {
      fast.tick(0.05, 2);
      fastTicks++;
    }
    expect(fastTicks).toBeLessThan(slowTicks);
  });

  it("reclaims the slot that has been running the longest, never the newest", () => {
    const pool = createPulsePool(createRng(6));
    for (let i = 0; i < MAX_PULSES; i++) {
      expect(pool.trigger(0.1 + i * 0.01, COLS, ROWS, true)).toBe(true);
      pool.tick(0.001, 0); // speed 0: nothing moves, only ages
    }
    const before = strengths(pool);
    const newest = before.indexOf(Math.max(...before));
    const oldest = before.indexOf(Math.min(...before));
    pool.trigger(0.5, COLS, ROWS, true);
    const after = strengths(pool);
    expect(after.indexOf(0.5)).toBe(oldest);
    expect(after[newest]).toBe(before[newest]);
    expect(pool.live()).toBe(MAX_PULSES);
  });

  it("ignores a bad strength or a backwards / non-finite dt", () => {
    const pool = createPulsePool(createRng(7));
    expect(pool.trigger(0, COLS, ROWS)).toBe(false);
    expect(pool.trigger(Number.NaN, COLS, ROWS)).toBe(false);
    pool.trigger(1, COLS, ROWS);
    const o = strengths(pool).findIndex((s) => s > 0) * 4;
    const head = pool.data[o + 2];
    pool.tick(-1, 1);
    pool.tick(Number.NaN, 1);
    expect(pool.data[o + 2]).toBe(head);
    expect(pool.live()).toBe(1);
  });
});

describe("ambience poses", () => {
  const fields = (p: ReturnType<typeof randomPose>) => Array.from(poseToArray(p));

  it("packs POSE_FLOATS floats in a fixed order", () => {
    const arr = poseToArray(REST_POSE);
    expect(arr.length).toBe(POSE_FLOATS);
    expect(arr[3]).toBe(Math.fround(REST_POSE.dist));
    expect(arr[10]).toBe(Math.fround(REST_POSE.winWidth));
  });

  it("at range 0 a random pose is the rest pose exactly", () => {
    expect(fields(randomPose(createRng(1), 0))).toEqual(fields(REST_POSE));
  });

  it("stays inside sane bounds at full range, and is deterministic per seed", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const p = randomPose(createRng(seed), 1);
      expect(fields(p).every((v) => Number.isFinite(v))).toBe(true);
      expect(p.el).toBeGreaterThan(0.05); // never below the sheet
      expect(p.el).toBeLessThan(Math.PI / 2);
      expect(p.dist).toBeGreaterThan(5);
      expect(p.winWidth).toBeGreaterThan(0.2);
      expect(fields(randomPose(createRng(seed), 1))).toEqual(fields(p));
    }
  });

  it("only sometimes narrows the row window, and never at range 0", () => {
    const rng = createRng(9);
    let partial = 0;
    for (let n = 0; n < 300; n++) if (randomPose(rng, 1).winWidth < WINDOW_OPEN) partial++;
    expect(partial).toBeGreaterThan(30);
    expect(partial).toBeLessThan(200);
    for (let n = 0; n < 50; n++) expect(randomPose(rng, 0).winWidth).toBeGreaterThanOrEqual(WINDOW_OPEN);
  });

  it("drift trades pose interval for briskness in both clocks", () => {
    expect(barsPerPose(0)).toBeGreaterThan(barsPerPose(1));
    expect(barsPerPose(1)).toBeGreaterThanOrEqual(1);
    expect(freeRunSec(0)).toBeGreaterThan(freeRunSec(1));
    expect(freeRunSec(1)).toBeGreaterThan(0);
  });
});

describe("ambience pose scheduler", () => {
  /** Runs `bars` bars of a locked tempo through the scheduler, `perBar`
   *  ticks per bar, and returns how many times the target changed. */
  function runBars(s: ReturnType<typeof createPoseScheduler>, bars: number, drift: number, perBar = 32): number {
    let changes = 0;
    let last = s.target();
    for (let b = 0; b < bars; b++) {
      for (let k = 0; k < perBar; k++) {
        s.advance(DT, k / perBar, 1, drift, 1);
        if (s.target() !== last) {
          changes++;
          last = s.target();
        }
      }
    }
    return changes;
  }

  it("opens on the rest pose and never retargets mid-bar while the tempo is locked", () => {
    const s = createPoseScheduler(createRng(1));
    expect(Array.from(s.current)).toEqual(Array.from(poseToArray(REST_POSE)));
    const t0 = s.target();
    for (let k = 0; k < 100; k++) s.advance(DT, 0.1 + 0.008 * k, 1, 1, 1); // phase climbs, never wraps
    expect(s.target()).toBe(t0);
  });

  it("retargets on a bar boundary, every bar at full drift and less often at none", () => {
    expect(runBars(createPoseScheduler(createRng(2)), 8, 1)).toBe(8 - 1); // the first wrap is bar 1
    const slow = runBars(createPoseScheduler(createRng(2)), 8, 0);
    expect(slow).toBeLessThan(7);
    expect(slow).toBeGreaterThan(0);
  });

  it("free-runs on a timer when no tempo is locked", () => {
    const s = createPoseScheduler(createRng(3));
    const t0 = s.target();
    const secs = freeRunSec(0.5);
    let elapsed = 0;
    while (elapsed < secs - 0.1) {
      s.advance(DT, 0, 0, 0.5, 1);
      elapsed += DT;
    }
    expect(s.target()).toBe(t0);
    for (let k = 0; k < 20; k++) s.advance(DT, 0, 0, 0.5, 1);
    expect(s.target()).not.toBe(t0);
  });

  it("eases every field monotonically toward the target without overshoot", () => {
    const s = createPoseScheduler(createRng(4));
    s.retarget(1);
    const target = poseToArray(s.target());
    const start = Array.from(s.current);
    let prev = Array.from(s.current);
    for (let k = 0; k < 600; k++) {
      s.advance(DT, 0.5, 1, 0.5, 1); // phase never wraps: the target stays put
      for (let i = 0; i < POSE_FLOATS; i++) {
        const towards = Math.sign(target[i] - start[i]);
        if (towards === 0) {
          expect(s.current[i]).toBe(start[i]);
          continue;
        }
        expect(Math.sign(s.current[i] - prev[i]) * towards).toBeGreaterThanOrEqual(0);
        expect((target[i] - s.current[i]) * towards).toBeGreaterThanOrEqual(-1e-9);
      }
      prev = Array.from(s.current);
    }
    for (let i = 0; i < POSE_FLOATS; i++) expect(s.current[i]).toBeCloseTo(target[i], 2);
  });

  it("treats a non-finite or backwards dt as no time passing", () => {
    const s = createPoseScheduler(createRng(5));
    s.retarget(1);
    const before = Array.from(s.current);
    s.advance(Number.NaN, 0, 0, 1, 1);
    s.advance(-1, 0, 0, 1, 1);
    expect(Array.from(s.current)).toEqual(before);
  });
});

describe("ambience phase crossfade", () => {
  const THR = 0.5;

  it("heads for the sheet above the band and for the sunburst below it", () => {
    let m = 0;
    for (let k = 0; k < 600; k++) m = phaseMix(m, THR + SHEET_HYSTERESIS + 0.05, DT, THR);
    expect(m).toBeGreaterThan(0.99);
    for (let k = 0; k < 1200; k++) m = phaseMix(m, THR - SHEET_HYSTERESIS - 0.05, DT, THR);
    expect(m).toBeLessThan(0.01);
  });

  it("holds its side inside the hysteresis band", () => {
    let up = 1;
    let down = 0;
    for (let k = 0; k < 600; k++) {
      up = phaseMix(up, THR, DT, THR);
      down = phaseMix(down, THR, DT, THR);
    }
    expect(up).toBe(1);
    expect(down).toBe(0);
  });

  it("slews rather than snaps, arriving faster than it leaves", () => {
    const rise = phaseMix(0, 1, DT, THR);
    expect(rise).toBeGreaterThan(0);
    expect(rise).toBeLessThan(0.2);
    const fall = 1 - phaseMix(1, 0, DT, THR);
    expect(fall).toBeGreaterThan(0);
    expect(fall).toBeLessThan(rise);
  });

  it("stays in [0,1] and finite whatever it is fed", () => {
    for (const prev of [-1, 0, 0.5, 1, 2, Number.NaN]) {
      for (const si of [-1, 0, 0.5, 1, 2, Number.NaN]) {
        for (const dt of [0, DT, 0.25, -1, Number.NaN]) {
          const m = phaseMix(prev, si, dt, THR);
          expect(Number.isFinite(m)).toBe(true);
          expect(m).toBeGreaterThanOrEqual(0);
          expect(m).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe("ambience comet state", () => {
  const THR = 0.5;

  it("grows the burst with the section and never past the Comets setting", () => {
    let prev = 0;
    for (let si = 0; si <= THR; si += 0.02) {
      const { count } = cometState(20, 0.5, si, THR);
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(20);
      expect(count).toBeGreaterThanOrEqual(prev);
      prev = count;
    }
    expect(cometState(20, 1, THR, THR).count).toBeCloseTo(20, 6);
    expect(cometState(1, 0, 0, THR).count).toBe(1);
    expect(cometState(1000, 1, 1, THR).count).toBe(MAX_COMETS);
  });

  it("with Sunburst pinned, the live level walks the burst through its whole build", () => {
    // Quiet: a handful of comets and no contraction. Loud: every comet out,
    // contracted. And a burst driven this way must open up again when the
    // level falls, which is the point of not reading the section here.
    expect(sunburstProgress(0, 0)).toBe(0);
    expect(sunburstProgress(1, 1)).toBe(1);
    let prev = 0;
    for (let l = 0; l <= 1; l += 0.05) {
      const p = sunburstProgress(l, l);
      expect(p).toBeGreaterThanOrEqual(prev);
      expect(p).toBeLessThanOrEqual(1);
      prev = p;
    }
    // A typical real-track reading sits mid-build, not pinned at either end.
    const mid = sunburstProgress(0.55, 0.5);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.9);
    expect(sunburstProgress(Number.NaN, 0.5)).toBeGreaterThanOrEqual(0);
  });

  it("only contracts in the last stretch before the threshold", () => {
    expect(cometState(20, 0.5, 0, THR).contract).toBe(0);
    expect(cometState(20, 0.5, THR * 0.6, THR).contract).toBe(0);
    const mid = cometState(20, 0.5, THR * 0.85, THR).contract;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(cometState(20, 0.5, THR, THR).contract).toBe(1);
    expect(cometState(20, 0.5, 5, THR).contract).toBe(1);
  });
});
