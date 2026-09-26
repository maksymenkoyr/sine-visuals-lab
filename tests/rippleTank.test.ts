import { describe, it, expect } from "vitest";
import { computeGridSize, spongeDampAt, stepTankCPU, WAVE_C2, WAVE_SPEED_CELLS_PER_STEP, type TankPhysicsParams } from "../src/render/scenes/rippleTank.ts";

/** Advances a (h, prev) pair one step in place, returning the new `h` — the
 *  test-side swap every one of these suites uses around stepTankCPU. Every
 *  caller declares its own `h`/`prev` locals with an explicit `: Float32Array`
 *  annotation (rather than letting `new Float32Array(n)` infer one) so this
 *  return type and those locals agree on the same generic ArrayBuffer
 *  parameter this TS lib version gives typed arrays. */
function advance(h: Float32Array, prev: Float32Array, w: number, hgt: number, params: TankPhysicsParams, srcDelta: number): { h: Float32Array; prev: Float32Array } {
  const next = stepTankCPU(h, prev, w, hgt, params, srcDelta);
  return { h: next, prev: h };
}

function maxAbs(a: Float32Array): number {
  let m = 0;
  for (const v of a) {
    const av = Math.abs(v);
    if (av > m) m = av;
  }
  return m;
}

function energy(a: Float32Array): number {
  let s = 0;
  for (const v of a) s += v * v;
  return s;
}

describe("computeGridSize", () => {
  it("long side is fixed per preset; short side follows the drawing buffer's aspect", () => {
    const wide = computeGridSize("high", 16 / 9);
    expect(wide.w).toBeGreaterThan(wide.h);
    const tall = computeGridSize("high", 9 / 16);
    expect(tall.h).toBeGreaterThan(tall.w);
    const square = computeGridSize("high", 1);
    expect(square.w).toBe(square.h);
  });

  it("never drops the short side below the floor, even at an extreme aspect", () => {
    const extreme = computeGridSize("floor", 8);
    expect(extreme.h).toBeGreaterThanOrEqual(64);
  });
});

describe("spongeDampAt", () => {
  it("is 0 in the interior, away from every edge", () => {
    expect(spongeDampAt(48, 27, 96, 54, 0)).toBe(0);
  });

  it("is at its largest right at the border", () => {
    const interior = spongeDampAt(48, 27, 96, 54, 0);
    const edge = spongeDampAt(0, 27, 96, 54, 0);
    expect(edge).toBeGreaterThan(interior);
  });

  it("edgeReflect=1 disables it everywhere, including right at the border", () => {
    expect(spongeDampAt(0, 0, 96, 54, 1)).toBe(0);
  });
});

// A single centre pulse should behave like a real, lossy ripple tank: it
// spreads outward, fades, and never blows up — see rippleTank.ts's own
// header for the update rule these pin.
describe("stepTankCPU stability", () => {
  it("a single source pulse then 5000 free-running steps never exceeds a small multiple of the initial peak, and is always finite", () => {
    const w = 96;
    const hgt = 54;
    const params: TankPhysicsParams = {
      c2: WAVE_C2,
      baseDampPerStep: 0.002,
      edgeReflect: 0, // open water — the sponge keeps the border from ringing forever
      sourceRadiusCells: 3,
      sourceGain: 1,
    };

    let h: Float32Array = new Float32Array(w * hgt);
    let prev: Float32Array = new Float32Array(w * hgt);
    ({ h, prev } = advance(h, prev, w, hgt, params, 1)); // the pulse itself
    const initialPeak = maxAbs(h);
    expect(initialPeak).toBeGreaterThan(0);

    let worst = initialPeak;
    for (let i = 0; i < 5000; i++) {
      ({ h, prev } = advance(h, prev, w, hgt, params, 0));
      const m = maxAbs(h);
      expect(Number.isFinite(m)).toBe(true);
      if (m > worst) worst = m;
    }
    // A point source dropped exactly at the centre of a symmetric rectangle
    // re-focuses through its own wall reflections (every image source
    // arrives back at the centre at once) before the sponge has absorbed
    // much of it, so a brief peak somewhat above the initial one is real
    // physics, not instability — the failure mode this guards against is
    // unbounded growth toward Infinity/NaN, not a modest constructive peak.
    expect(worst).toBeLessThan(initialPeak * 10);
  });
});

// The wavefront from a centre pulse should travel at WAVE_SPEED_CELLS_PER_STEP
// (sqrt(c2)) cells per step — the actual physical speed the wave equation
// gives this discretisation, independent of Wave speed's own steps/sec
// mapping (that only decides how many of these steps happen per second).
describe("stepTankCPU wave speed", () => {
  it("a probe at a fixed radius first registers the wavefront at roughly radius/speed steps", () => {
    const w = 160;
    const hgt = 160;
    const params: TankPhysicsParams = {
      c2: WAVE_C2,
      baseDampPerStep: 0,
      edgeReflect: 1, // no sponge to muddy the reading; the front never reaches the wall in this run anyway
      sourceRadiusCells: 2,
      sourceGain: 1,
    };
    const cx = (w - 1) / 2;
    const cy = (hgt - 1) / 2;
    const radius = 40;
    const probeX = Math.round(cx + radius);
    const probeY = Math.round(cy);

    let h: Float32Array = new Float32Array(w * hgt);
    let prev: Float32Array = new Float32Array(w * hgt);
    ({ h, prev } = advance(h, prev, w, hgt, params, 1));

    const threshold = 1e-4;
    let arrivalStep = -1;
    for (let step = 1; step <= 200; step++) {
      ({ h, prev } = advance(h, prev, w, hgt, params, 0));
      if (Math.abs(h[probeY * w + probeX]!) > threshold) {
        arrivalStep = step;
        break;
      }
    }

    expect(arrivalStep).toBeGreaterThan(0);
    const expected = radius / WAVE_SPEED_CELLS_PER_STEP;
    expect(arrivalStep).toBeGreaterThan(expected * 0.7);
    expect(arrivalStep).toBeLessThan(expected * 1.4);
  });
});

// Edge reflection: with the sponge fully active (edgeReflect=0), a wave that
// has had plenty of time to reach and cross the border should have lost
// almost all of its energy; with the sponge off (edgeReflect=1, a hard
// energy-conserving wall), that same energy is still sloshing around the
// tank.
describe("stepTankCPU edge absorption vs reflection", () => {
  it("open water (edgeReflect=0) ends up with far less total energy than a walled tank (edgeReflect=1) long after the wave hits the border", () => {
    const w = 96;
    const hgt = 54;
    const baseParams = { c2: WAVE_C2, baseDampPerStep: 0, sourceRadiusCells: 3, sourceGain: 1 };
    const steps = 4000;

    function run(edgeReflect: number): number {
      const params: TankPhysicsParams = { ...baseParams, edgeReflect };
      let h: Float32Array = new Float32Array(w * hgt);
      let prev: Float32Array = new Float32Array(w * hgt);
      ({ h, prev } = advance(h, prev, w, hgt, params, 1));
      for (let i = 0; i < steps; i++) ({ h, prev } = advance(h, prev, w, hgt, params, 0));
      return energy(h);
    }

    const openEnergy = run(0);
    const walledEnergy = run(1);
    expect(openEnergy).toBeGreaterThanOrEqual(0);
    expect(walledEnergy).toBeGreaterThan(0);
    expect(openEnergy).toBeLessThan(walledEnergy * 0.1);
  });
});

// A periodic driver (a sustained, oscillating signal, once high-passed —
// see caustics.ts's advanceRippleHighpass) should settle into a periodic
// wave train at a probe point, at the driver's own period — a real surface
// tracks whatever rhythm keeps disturbing it.
describe("stepTankCPU periodic driving", () => {
  it("a sinusoidal driver's delta produces a periodic response at the probe, with peak spacing matching the driver period", () => {
    const w = 96;
    const hgt = 54;
    const period = 24; // steps per cycle
    const params: TankPhysicsParams = {
      c2: WAVE_C2,
      baseDampPerStep: 0.003,
      edgeReflect: 0,
      sourceRadiusCells: 3,
      sourceGain: 1,
    };
    const cx = Math.floor((w - 1) / 2);
    const cy = Math.floor((hgt - 1) / 2);
    const probe = cy * w + cx;

    let h: Float32Array = new Float32Array(w * hgt);
    let prev: Float32Array = new Float32Array(w * hgt);
    let prevSignal = 0;
    const totalSteps = period * 20;
    const trace: number[] = [];
    for (let n = 1; n <= totalSteps; n++) {
      const signal = Math.sin((2 * Math.PI * n) / period);
      const delta = signal - prevSignal;
      prevSignal = signal;
      ({ h, prev } = advance(h, prev, w, hgt, params, delta));
      trace.push(h[probe]!);
    }

    // Drop the first several cycles (startup transient), then find local
    // maxima in what's left.
    const settled = trace.slice(period * 8);
    const maximaIdx: number[] = [];
    for (let i = 1; i < settled.length - 1; i++) {
      if (settled[i]! > settled[i - 1]! && settled[i]! >= settled[i + 1]!) maximaIdx.push(i);
    }
    expect(maximaIdx.length).toBeGreaterThanOrEqual(3);

    const spacings: number[] = [];
    for (let i = 1; i < maximaIdx.length; i++) spacings.push(maximaIdx[i]! - maximaIdx[i - 1]!);
    const meanSpacing = spacings.reduce((a, b) => a + b, 0) / spacings.length;
    expect(meanSpacing).toBeGreaterThan(period * 0.7);
    expect(meanSpacing).toBeLessThan(period * 1.3);
  });
});
