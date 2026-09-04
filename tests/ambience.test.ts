import { describe, it, expect } from "vitest";
import {
  MAX_COMETS,
  MAX_PULSES,
  POSE_FLOATS,
  PULSE_REFRACTORY_SEC,
  PULSE_TAIL,
  REST_POSE,
  ANIM,
  ANIM_N,
  ENTER_LEGS,
  FORM,
  JOURNEYS,
  LEAVE_LEGS,
  STAGGER,
  SHEET_HYSTERESIS,
  WINDOW_OPEN,
  barsPerPose,
  cometState,
  createChoreographer,
  createPulsePool,
  createRng,
  freeRunSec,
  gridDimsForQuality,
  journeyBars,
  latticeDims,
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

describe("ambience lattice factoring", () => {
  it("factors every quality grid exactly into three and four balanced sides", () => {
    for (const q of [1.0, 0.7, 0.4, 0.25]) {
      const { cols, rows } = gridDimsForQuality(q);
      const n = cols * rows;
      for (const k of [3, 4]) {
        const d = latticeDims(n, k);
        expect(d).toHaveLength(k);
        expect(d.reduce((a, b) => a * b, 1)).toBe(n);
        expect(Math.max(...d)).toBeLessThanOrEqual(3 * Math.min(...d));
        for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThanOrEqual(d[i - 1]);
      }
    }
  });

  it("still covers a count it cannot factor, never short", () => {
    for (const n of [1, 2, 7, 97, 1009]) {
      for (const k of [3, 4]) {
        const d = latticeDims(n, k);
        expect(d).toHaveLength(k);
        expect(d.reduce((a, b) => a * b, 1)).toBeGreaterThanOrEqual(n);
        expect(d.every((s) => Number.isInteger(s) && s >= 1)).toBe(true);
      }
    }
  });
});

describe("ambience journeys", () => {
  it("every journey starts and ends on the sheet and chains its legs", () => {
    for (const [name, legs] of Object.entries(JOURNEYS)) {
      expect(legs.length, name).toBeGreaterThan(0);
      expect(legs[0].from).toBe(FORM.SHEET);
      expect(legs[legs.length - 1].to).toBe(FORM.SHEET);
      for (let i = 1; i < legs.length; i++) expect(legs[i].from, name).toBe(legs[i - 1].to);
      for (const leg of legs) {
        expect(leg.bars).toBeGreaterThan(0);
        expect(Object.values(STAGGER)).toContain(leg.stagger);
        expect(Object.values(FORM)).toContain(leg.from);
        expect(Object.values(FORM)).toContain(leg.to);
      }
    }
  });

  it("the way in climbs the ladder from the dot; the way out descends to it", () => {
    expect(ENTER_LEGS[0].from).toBe(FORM.DOT);
    expect(ENTER_LEGS[ENTER_LEGS.length - 1].to).toBe(FORM.SHEET);
    expect(LEAVE_LEGS[0].from).toBe(FORM.SHEET);
    expect(LEAVE_LEGS[LEAVE_LEGS.length - 1].to).toBe(FORM.DOT);
    const climbs = (legs: readonly { from: number; to: number }[], up: boolean) =>
      legs.every((l) => (up ? l.to > l.from : l.to < l.from));
    expect(climbs(ENTER_LEGS, true)).toBe(true);
    expect(climbs(LEAVE_LEGS, false)).toBe(true);
  });

  it("more Transitions means fewer bars between journeys", () => {
    expect(journeyBars(0)).toBeGreaterThan(journeyBars(1));
    expect(journeyBars(1)).toBeGreaterThanOrEqual(1);
  });
});

describe("ambience choreographer", () => {
  const OPTS = { drift: 0.5, range: 1, flip: 0.6, transitions: 0 };
  /** Runs `bars` locked bars through the choreographer, `perBar` ticks each. */
  function runBars(c: ReturnType<typeof createChoreographer>, bars: number, opts = OPTS, perBar = 32) {
    for (let b = 0; b < bars; b++) {
      for (let k = 0; k < perBar; k++) c.advance(DT, k / perBar, 1, opts);
    }
  }

  it("opens on the rest pose, on the sheet, idle", () => {
    const c = createChoreographer(createRng(1));
    expect(Array.from(c.anim.subarray(0, POSE_FLOATS))).toEqual(Array.from(poseToArray(REST_POSE)));
    expect(c.anim.length).toBe(ANIM_N);
    expect(c.formA()).toBe(FORM.SHEET);
    expect(c.formB()).toBe(FORM.SHEET);
    expect(c.journey()).toBeNull();
    expect(c.anim[ANIM.PROGRESS]).toBe(0);
  });

  it("never retargets mid-bar while the tempo is locked", () => {
    const c = createChoreographer(createRng(1));
    const t0 = c.target();
    for (let k = 0; k < 100; k++) c.advance(DT, 0.1 + 0.008 * k, 1, OPTS); // phase climbs, never wraps
    expect(c.target()).toBe(t0);
  });

  it("retargets on a bar boundary, every bar at full drift and less often at none", () => {
    const count = (drift: number) => {
      const c = createChoreographer(createRng(2));
      let changes = 0;
      let last = c.target();
      for (let b = 0; b < 8; b++) {
        for (let k = 0; k < 32; k++) {
          c.advance(DT, k / 32, 1, { ...OPTS, drift });
          if (c.target() !== last) {
            changes++;
            last = c.target();
          }
        }
      }
      return changes;
    };
    expect(count(1)).toBe(8 - 1); // the first wrap is bar 1
    expect(count(0)).toBeLessThan(7);
    expect(count(0)).toBeGreaterThan(0);
  });

  it("free-runs on a timer when no tempo is locked", () => {
    const c = createChoreographer(createRng(3));
    const t0 = c.target();
    const secs = freeRunSec(0.5);
    let elapsed = 0;
    while (elapsed < secs - 0.1) {
      c.advance(DT, 0, 0, OPTS);
      elapsed += DT;
    }
    expect(c.target()).toBe(t0);
    for (let k = 0; k < 20; k++) c.advance(DT, 0, 0, OPTS);
    expect(c.target()).not.toBe(t0);
  });

  it("eases every pose field monotonically toward the target without overshoot", () => {
    const c = createChoreographer(createRng(4));
    c.retarget(1, 0.6);
    const target = poseToArray(c.target());
    const start = Array.from(c.anim.subarray(0, POSE_FLOATS));
    let prev = Array.from(start);
    for (let k = 0; k < 600; k++) {
      c.advance(DT, 0.5, 1, OPTS); // phase never wraps: the target stays put
      for (let i = 0; i < POSE_FLOATS; i++) {
        const towards = Math.sign(target[i] - start[i]);
        if (towards === 0) {
          expect(c.anim[i]).toBe(start[i]);
          continue;
        }
        expect(Math.sign(c.anim[i] - prev[i]) * towards).toBeGreaterThanOrEqual(0);
        expect((target[i] - c.anim[i]) * towards).toBeGreaterThanOrEqual(-1e-9);
      }
      prev = Array.from(c.anim.subarray(0, POSE_FLOATS));
    }
    for (let i = 0; i < POSE_FLOATS; i++) expect(c.anim[i]).toBeCloseTo(target[i], 2);
  });

  it("with Flip up, some poses are a half-turn away; with it off, none are", () => {
    const turns = (flip: number) => {
      const c = createChoreographer(createRng(5));
      let flips = 0;
      for (let n = 0; n < 200; n++) {
        const before = c.target();
        c.retarget(1, flip);
        const t = c.target();
        if (Math.abs(t.rx - before.rx) > 2 || Math.abs(t.rz - before.rz) > 2) flips++;
      }
      return flips;
    };
    expect(turns(1)).toBeGreaterThan(40);
    expect(turns(0)).toBe(0);
  });

  it("runs a journey leg by leg, progress climbing 0..1 in each, and lands back on the sheet idle", () => {
    const c = createChoreographer(createRng(6));
    expect(c.start("unfold")).toBe(true);
    expect(c.journey()).toBe("unfold");
    expect(c.start("roll")).toBe(false); // one at a time
    const seen: number[][] = [];
    let lastProgress = -1;
    let guard = 0;
    while (c.journey() !== null && guard++ < 100_000) {
      const pair = [c.formA(), c.formB()];
      if (!seen.length || seen[seen.length - 1][0] !== pair[0] || seen[seen.length - 1][1] !== pair[1]) {
        seen.push(pair);
        lastProgress = -1;
      }
      c.advance(DT, 0.5, 1, OPTS);
      expect(c.anim[ANIM.PROGRESS]).toBeGreaterThanOrEqual(0);
      expect(c.anim[ANIM.PROGRESS]).toBeLessThanOrEqual(1);
      if (c.journey() !== null && c.formA() === pair[0] && c.formB() === pair[1]) {
        expect(c.anim[ANIM.PROGRESS]).toBeGreaterThanOrEqual(lastProgress);
        lastProgress = c.anim[ANIM.PROGRESS];
      }
    }
    expect(seen.map((p) => p.join(">"))).toEqual(JOURNEYS.unfold.map((l) => `${l.from}>${l.to}`));
    expect(c.formA()).toBe(FORM.SHEET);
    expect(c.formB()).toBe(FORM.SHEET);
    expect(c.anim[ANIM.PROGRESS]).toBe(0);
  });

  it("a 4D turn leaves the sheet's plane angle exactly a half-turn on", () => {
    const c = createChoreographer(createRng(7));
    const before = c.anim[ANIM.ROT_XW];
    expect(c.start("turnX")).toBe(true);
    let peak = before;
    let guard = 0;
    while (c.journey() !== null && guard++ < 100_000) {
      c.advance(DT, 0.5, 1, OPTS);
      peak = Math.max(peak, c.anim[ANIM.ROT_XW]);
    }
    expect(c.anim[ANIM.ROT_XW]).toBeCloseTo(before + Math.PI, 5); // Float32 storage
    expect(peak).toBeLessThanOrEqual(before + Math.PI + 1e-5);
    expect(c.anim[ANIM.ROT_ZW]).toBe(0);
  });

  it("the tesseract dwell spins through whole turns, so the sheet returns unmirrored", () => {
    const c = createChoreographer(createRng(8));
    expect(c.start("tesseract")).toBe(true);
    let guard = 0;
    while (c.journey() !== null && guard++ < 200_000) c.advance(DT, 0.5, 1, OPTS);
    expect(c.anim[ANIM.SPIN] / (2 * Math.PI)).toBeCloseTo(Math.round(c.anim[ANIM.SPIN] / (2 * Math.PI)), 5); // Float32 storage
    expect(c.anim[ANIM.SPIN]).toBeGreaterThan(0);
  });

  it("starts journeys on its own every few bars, more often with Transitions up, never at 0", () => {
    const started = (transitions: number) => {
      const c = createChoreographer(createRng(9));
      let n = 0;
      let last: string | null = null;
      for (let b = 0; b < 40; b++) {
        for (let k = 0; k < 32; k++) {
          c.advance(DT, k / 32, 1, { ...OPTS, transitions });
          if (c.journey() !== last) {
            if (c.journey() !== null) n++;
            last = c.journey();
          }
        }
      }
      return n;
    };
    expect(started(1)).toBeGreaterThan(started(0.3));
    expect(started(0.3)).toBeGreaterThan(0);
  });

  it("a drop can start a journey; nothing can while one is running", () => {
    const c = createChoreographer(createRng(10));
    let fired = false;
    for (let n = 0; n < 20 && !fired; n++) {
      c.advance(DT, 0.5, 1, OPTS, { drop: true });
      fired = c.journey() !== null;
    }
    expect(fired).toBe(true);
    const running = c.journey();
    c.advance(DT, 0.5, 1, OPTS, { drop: true });
    expect(c.journey()).toBe(running);
  });

  it("enters from the dot up to the sheet, and leaves back down to the dot, whatever it was doing", () => {
    const c = createChoreographer(createRng(11));
    c.advance(DT, 0.5, 1, OPTS, { enter: true });
    expect(c.formA()).toBe(FORM.DOT);
    expect(c.journey()).toBe("enter");
    let guard = 0;
    while (c.journey() !== null && guard++ < 100_000) c.advance(DT, 0.5, 1, OPTS);
    expect(c.formA()).toBe(FORM.SHEET);
    // Leaving mid-journey overrides it.
    expect(c.start("roll")).toBe(true);
    c.advance(DT, 0.5, 1, OPTS, { leave: true });
    expect(c.journey()).toBe("leave");
    guard = 0;
    while (c.journey() !== null && guard++ < 100_000) c.advance(DT, 0.5, 1, OPTS);
    expect(c.formA()).toBe(FORM.DOT);
    expect(c.formB()).toBe(FORM.DOT);
    // Parked on the dot: no journey starts by itself until the next enter.
    runBars(c, 30, { ...OPTS, transitions: 1 });
    expect(c.formA()).toBe(FORM.DOT);
    expect(c.journey()).toBeNull();
    c.advance(DT, 0.5, 1, OPTS, { enter: true });
    expect(c.journey()).toBe("enter");
  });

  it("treats a non-finite or backwards dt as no time passing", () => {
    const c = createChoreographer(createRng(12));
    c.retarget(1, 0.6);
    const before = Array.from(c.anim);
    c.advance(Number.NaN, 0, 0, OPTS);
    c.advance(-1, 0, 0, OPTS);
    expect(Array.from(c.anim)).toEqual(before);
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
