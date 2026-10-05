import { describe, it, expect } from "vitest";
import {
  createLaunchState,
  frontAt,
  kickDeltaZ,
  latticeU,
  splitZoom,
  stepLaunch,
  zoomIntro,
  CORE_R,
  FRONT_FLOOR,
  FRONT_RATE,
  FRONT_START,
  KICK_LIFE_SEC,
  KICK_SLOTS,
  K_CRUISE,
  RELAUNCH_SEC,
  ROW_PERIOD,
  SPEED_FLOOR,
  SPEED_GAIN,
  ZOOM_RAMP_END,
  ZOOM_RAMP_START,
  type LaunchInput,
  type LaunchState,
} from "../src/render/scenes/chaikin/launch.ts";
import {
  CHILD_BAND_HI,
  CHILD_BAND_LO,
  CHILD_BAND_SOFT,
  CHILD_RISE,
  MAX_ROWS,
  PHASE_COL,
  ROW_LO,
  TEX_H,
  TEX_W,
  fillSeeds,
  rowsFor,
  type Kicks,
  type SeedFrame,
} from "../src/render/scenes/chaikin/seeds.ts";

const DT = 1 / 60;
const DELTA = (2 * Math.PI) / 44;
const FLOOR = FRONT_FLOOR;

function input(over: Partial<LaunchInput> = {}): LaunchInput {
  return { timeSec: 0, dtSec: DT, speed: 1, speedDrive: 0.5, relaunch: null, kick: null, ...over };
}

function run(s: LaunchState, seconds: number, over: Partial<LaunchInput> = {}, t0 = 0) {
  let out = stepLaunch(s, input({ ...over, timeSec: t0 }));
  const n = Math.round(seconds / DT);
  for (let i = 1; i < n; i++) out = stepLaunch(s, input({ ...over, timeSec: t0 + i * DT }));
  return out;
}

describe("chaikin launch clock", () => {
  it("opens on one big cell: the front starts at FRONT_START and the zoom is still", () => {
    const s = createLaunchState();
    const out = stepLaunch(s, input());
    expect(out.front).toBeCloseTo(FRONT_START - FRONT_RATE * DT, 6);
    expect(out.k).toBe(0);
  });

  it("closes the front on the centre at FRONT_RATE until the floor, then holds", () => {
    const s = createLaunchState();
    const out = run(s, 4);
    expect(out.front).toBeCloseTo(FRONT_START - FRONT_RATE * 4, 2);
    const floored = run(s, 60);
    expect(floored.front).toBe(FLOOR);
    expect(frontAt(1e6)).toBe(FLOOR);
    // By the floor, less than half a lattice row is left inside the front.
    expect(floored.frontU).toBeLessThan(DELTA / 2);
  });

  it("lattice U follows ln r far out and r near the centre", () => {
    expect(latticeU(0)).toBe(0);
    expect(latticeU(0.01 * CORE_R) / 0.01).toBeCloseTo(1, 3);
    // Far out, one ln r step is one U step.
    expect(latticeU(2 * Math.E) - latticeU(2)).toBeCloseTo(1, 2);
  });

  it("ramps the zoom between ZOOM_RAMP_START and ZOOM_RAMP_END, then cruises", () => {
    expect(zoomIntro(ZOOM_RAMP_START)).toBe(0);
    expect(zoomIntro(ZOOM_RAMP_END)).toBe(1);
    const s = createLaunchState();
    const out = run(s, ZOOM_RAMP_END + 1, { speedDrive: 1 });
    expect(out.k).toBeCloseTo(K_CRUISE * (SPEED_FLOOR + SPEED_GAIN), 6);
    expect(run(s, 1, { speed: 0 }).k).toBe(0);
  });

  it("relaunch eases the front back toward FRONT_START and replays the intro from there", () => {
    const s = createLaunchState();
    run(s, 60);
    const before = stepLaunch(s, input({ timeSec: 60 })).front;
    stepLaunch(s, input({ timeSec: 60 + DT, relaunch: 1 }));
    const out = run(s, RELAUNCH_SEC + 0.05, {}, 60 + 2 * DT);
    expect(before).toBe(FLOOR);
    // Back out at the start (less what it has closed since the ease ended).
    expect(out.front).toBeGreaterThan(FRONT_START - 0.05);
    expect(s.tau).toBeLessThan(0.5);
    // The zoom stalls with it.
    expect(out.k).toBe(0);
  });

  it("a partial relaunch goes that share of the way and leaves tau matching the front", () => {
    const s = createLaunchState();
    run(s, 60);
    stepLaunch(s, input({ timeSec: 60, relaunch: 0.5 }));
    run(s, RELAUNCH_SEC, {}, 60 + DT);
    const target = FLOOR + (FRONT_START - FLOOR) * 0.5;
    const front = frontAt(s.tau);
    expect(front).toBeGreaterThan(target - 0.05);
    expect(front).toBeLessThan(target + 0.001);
  });

  it("ignores a second drop while a relaunch is still easing", () => {
    const s = createLaunchState();
    run(s, 60);
    stepLaunch(s, input({ timeSec: 60, relaunch: 0.3 }));
    const to = s.relTo;
    stepLaunch(s, input({ timeSec: 60 + DT, relaunch: 1 }));
    expect(s.relTo).toBe(to);
  });

  it("keeps the last KICK_SLOTS kicks, spaced at least KICK_MIN_GAP_SEC, and retires them after KICK_LIFE_SEC", () => {
    const s = createLaunchState();
    run(s, 25);
    stepLaunch(s, input({ timeSec: 25, kick: 0.8 }));
    stepLaunch(s, input({ timeSec: 25 + DT, kick: 1 }));
    expect(Array.from(s.kickAmp).filter((a) => a > 0)).toHaveLength(1);
    expect(s.kickAmp[0]).toBeCloseTo(0.8, 6);
    for (let i = 1; i <= KICK_SLOTS + 2; i++) stepLaunch(s, input({ timeSec: 25 + i * 0.16, kick: 0.5 }));
    expect(Array.from(s.kickAmp).filter((a) => a > 0).length).toBeLessThanOrEqual(KICK_SLOTS);
    run(s, KICK_LIFE_SEC + 0.1, {}, 30);
    expect(Array.from(s.kickAmp).every((a) => a === 0)).toBe(true);
  });

  it("reports how far the zoom has carried each live kick", () => {
    const s = createLaunchState();
    run(s, 25);
    stepLaunch(s, input({ timeSec: 25, kick: 1 }));
    const z0 = s.z;
    run(s, 1, {}, 25 + DT);
    const dz = kickDeltaZ(s, new Float32Array(KICK_SLOTS));
    expect(dz[0]).toBeCloseTo(s.z - z0, 5);
    expect(dz[1]).toBe(0);
  });

  it("splits the zoom into wrapped whole rows and a fraction without losing precision", () => {
    const z = 123456.789;
    const { row, frac } = splitZoom(z, DELTA);
    const rows = z / DELTA;
    expect(Number.isInteger(row)).toBe(true);
    expect(row).toBeGreaterThanOrEqual(0);
    expect(row).toBeLessThan(ROW_PERIOD);
    expect(frac).toBeGreaterThanOrEqual(0);
    expect(frac).toBeLessThan(1);
    expect(((rows - frac - row) / ROW_PERIOD) % 1).toBeCloseTo(0, 9);
    // One row on, the same fraction.
    const next = splitZoom(z + DELTA, DELTA);
    expect(next.frac).toBeCloseTo(frac, 6);
    expect((next.row - row + ROW_PERIOD) % ROW_PERIOD).toBe(1);
  });
});

const NO_KICKS: Kicks = {
  dz: new Float32Array(KICK_SLOTS),
  age: new Float32Array(KICK_SLOTS).fill(KICK_LIFE_SEC),
  amp: new Float32Array(KICK_SLOTS),
};

function seedFrame(over: Partial<SeedFrame> = {}): SeedFrame {
  return { cols: 44, jitter: 0.9, zRow: 1234, zFrac: 0.3, frontU: 0, rows: 30, kicks: NO_KICKS, ...over };
}

function texel(data: Float32Array, col: number, row: number): [number, number, number, number] {
  const o = (row * TEX_W + col) * 4;
  return [data[o], data[o + 1], data[o + 2], data[o + 3]];
}

describe("chaikin seeds", () => {
  const data = new Float32Array(TEX_W * TEX_H * 4);

  it("keeps only seeds past the front alive, and fully alive two rows past it", () => {
    const frontU = 1.2;
    fillSeeds(data, seedFrame({ frontU }));
    let alive = 0;
    for (let t = 0; t < 30; t++) {
      for (let c = 0; c < 44; c++) {
        const [x, y, w, a] = texel(data, c, t);
        if (a <= 0) continue;
        alive++;
        const u = latticeU(Math.hypot(x, y));
        expect(u).toBeGreaterThan(frontU);
        if (u > frontU + 2 * DELTA + 1e-6) {
          expect(a).toBe(1);
          expect(w).toBeCloseTo(0, 9);
        } else expect(w).toBeLessThanOrEqual(0);
      }
      expect(texel(data, PHASE_COL, t)[0]).toBeGreaterThanOrEqual(0);
      expect(texel(data, PHASE_COL, t)[0]).toBeLessThan(1);
    }
    expect(alive).toBeGreaterThan(200);
  });

  it("carries each seed one row out, same jitter, when the zoom moves one row", () => {
    const before = new Float32Array(data.length);
    fillSeeds(before, seedFrame({ zRow: 99, zFrac: 0.4 }));
    fillSeeds(data, seedFrame({ zRow: 100, zFrac: 0.4 }));
    for (const [c, t] of [[3, 5], [20, 12], [43, 20]]) {
      const [x0, y0] = texel(before, c, t);
      const [x1, y1] = texel(data, c, t + 1);
      expect(latticeU(Math.hypot(x1, y1)) - latticeU(Math.hypot(x0, y0))).toBeCloseTo(DELTA, 5);
      expect(Math.atan2(y1, x1)).toBeCloseTo(Math.atan2(y0, x0), 5);
    }
  });

  it("fills no children without a kick, and only inside a live kick's band", () => {
    fillSeeds(data, seedFrame());
    for (let i = MAX_ROWS * TEX_W * 4; i < data.length; i++) expect(data[i]).toBe(0);
    const amp = new Float32Array(KICK_SLOTS);
    amp[0] = 1;
    const age = new Float32Array(KICK_SLOTS).fill(KICK_LIFE_SEC);
    age[0] = CHILD_RISE;
    fillSeeds(data, seedFrame({ kicks: { dz: new Float32Array(KICK_SLOTS), age, amp } }));
    let born = 0;
    for (let t = 0; t < 30; t++) {
      for (let c = 0; c < 44; c++) {
        const [x, y, , a] = texel(data, c, t + MAX_ROWS);
        if (a <= 0) continue;
        born++;
        const u = latticeU(Math.hypot(x, y));
        expect(u).toBeGreaterThan(CHILD_BAND_LO - CHILD_BAND_SOFT);
        expect(u).toBeLessThan(CHILD_BAND_HI + CHILD_BAND_SOFT);
      }
    }
    expect(born).toBeGreaterThan(20);
  });

  it("fills enough rows to reach the farthest corner of the screen", () => {
    const rMax = Math.hypot(16 / 9, 1);
    const rows = rowsFor(rMax, 44);
    expect((rows - 1 + ROW_LO) * DELTA).toBeGreaterThan(latticeU(rMax));
    expect(rowsFor(100, 96)).toBe(MAX_ROWS);
  });
});
