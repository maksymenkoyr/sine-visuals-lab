import { describe, it, expect } from "vitest";
import {
  advanceStandout,
  advanceStandoutAmount,
  advanceStandoutSized,
  createStandoutState,
  createStandoutTrigger,
  standoutBar,
  standoutLine,
  standoutMarks,
  standoutThreshold,
  stepStandoutHit,
  stepStandoutTrigger,
  STANDOUT_THRESHOLD_DEFAULT,
} from "../src/render/standout.ts";

// Most of these were written against Caustics' Beat ripple, the graded user,
// so "a ring" below is one full standout's amount (a total of 1 per climb).

// anim.beatPulse/lowPulse's own real shape (animClock.ts's BEAT_PULSE_DECAY_PER_SEC):
// a step to 1 in a single tick, then exponential decay at 6/sec.
const BEAT_PULSE_DECAY = 6;
const DT = 1 / 60;

/** Runs advanceStandoutAmount over a driver that sits at 0 (letting the smoothing
 *  settle there) and then jumps to 1 and decays like a real beat pulse,
 *  returning the total emitted. */
function simulateSingleHit(totalSec = 3): number {
  const state = createStandoutState();
  // Settle the smoothing at 0 before the hit, same as a quiet passage.
  for (let i = 0; i < 10; i++) advanceStandoutAmount(state, DT, 0);
  let total = 0;
  for (let t = 0; t < totalSec; t += DT) {
    total += advanceStandoutAmount(state, DT, Math.exp(-BEAT_PULSE_DECAY * t));
  }
  return total;
}

/** Same shape as simulateSingleHit, but a climb of `height` (not necessarily
 *  a full 0->1 jump) and a caller-chosen threshold — Ring threshold's own Off
 *  switch (`null`) included. */
function simulateStepClimb(height: number, threshold: number | null, totalSec = 3): number {
  const state = createStandoutState();
  for (let i = 0; i < 10; i++) advanceStandoutAmount(state, DT, 0, threshold);
  let total = 0;
  for (let t = 0; t < totalSec; t += DT) {
    total += advanceStandoutAmount(state, DT, height * Math.exp(-BEAT_PULSE_DECAY * t), threshold);
  }
  return total;
}

describe("advanceStandoutAmount", () => {
  it("a clean hit (0->1 jump, beat-pulse decay) emits a total close to 1 — one old-style ring's worth", () => {
    const total = simulateSingleHit();
    expect(total).toBeGreaterThan(0.85);
    expect(total).toBeLessThan(1.05);
  });

  it("a constant signal emits nothing once settled", () => {
    const state = createStandoutState();
    let total = 0;
    for (let i = 0; i < 300; i++) total += advanceStandoutAmount(state, DT, 0.6);
    expect(total).toBe(0);
  });

  it("a slow ramp (0->1 over 5s) emits close to nothing — too slow to clear the rise deadband", () => {
    const state = createStandoutState();
    let total = 0;
    const rampSec = 5;
    for (let t = 0; t < rampSec; t += DT) {
      total += advanceStandoutAmount(state, DT, Math.min(1, t / rampSec));
    }
    expect(total).toBeLessThan(0.1);
  });

  it("a fast pulse train ducks itself: every hit after the first emits noticeably less than a lone hit", () => {
    const state = createStandoutState();
    for (let i = 0; i < 20; i++) advanceStandoutAmount(state, DT, 0); // settle at 0
    const period = 0.15; // hits faster than the pulse's own ~1/6s decay area
    const totalSec = 2;
    const perPulse: number[] = [];
    let current = 0;
    let lastIdx = -1;
    for (let t = 0; t < totalSec; t += DT) {
      const idx = Math.floor(t / period);
      if (idx !== lastIdx) {
        if (lastIdx >= 0) perPulse.push(current);
        current = 0;
        lastIdx = idx;
      }
      current += advanceStandoutAmount(state, DT, Math.exp(-BEAT_PULSE_DECAY * (t % period)));
    }
    perPulse.push(current);

    const first = perPulse[0]!;
    const later = perPulse.slice(2, -1); // skip the first (settling from 0) and the last (partial window)
    expect(first).toBeGreaterThan(0.85); // reads like the lone-hit case above
    for (const p of later) {
      expect(p).toBeLessThan(first * 0.75); // meaningfully ducked, not merely a lone hit repeated
    }
  });

  it("never produces NaN or a negative amount across a broad random sweep, including dt=0", () => {
    const state = createStandoutState();
    for (let i = 0; i < 500; i++) {
      const out = advanceStandoutAmount(state, Math.random() < 0.05 ? 0 : Math.random() / 30, Math.random());
      expect(Number.isFinite(out)).toBe(true);
      expect(out).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("advanceStandoutAmount salience — a ring is sized by how much a hit stands out", () => {
  /** A beat-pulse-shaped driver from a list of hits ({t, h}): each hit
   *  raises the pulse to max(current, h), then it decays like anim.beatPulse.
   *  Returns the total emitted around each hit (from the hit's tick until the
   *  next hit), in hit order. */
  function emitPerHit(hits: { t: number; h: number }[], endSec: number, state = createStandoutState()): number[] {
    const out = hits.map(() => 0);
    let pulse = 0;
    let next = 0;
    let current = -1;
    advanceStandoutAmount(state, DT, 0);
    for (let t = 0; t < endSec; t += DT) {
      pulse *= Math.exp(-BEAT_PULSE_DECAY * DT);
      while (next < hits.length && hits[next]!.t <= t) {
        pulse = Math.max(pulse, hits[next]!.h);
        current = next++;
      }
      const e = advanceStandoutAmount(state, DT, pulse);
      if (current >= 0) out[current]! += e;
    }
    return out;
  }

  // Deterministic "noise": small hits between kicks, heights in 0.2..0.4.
  const noisyKicks = (seconds: number) => {
    const hits: { t: number; h: number; kick: boolean }[] = [];
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let t = 0; t < seconds; t += 0.1) {
      const kick = Math.abs((t / 0.5) - Math.round(t / 0.5)) < 1e-6;
      hits.push({ t, h: kick ? 1 : 0.2 + 0.2 * rnd(), kick });
    }
    return hits;
  };

  it("background hits between kicks emit ~nothing once the floor has settled, kicks still emit full rings", () => {
    const hits = noisyKicks(12);
    const emitted = emitPerHit(hits, 12.5);
    const settled = hits.map((hit, i) => ({ ...hit, e: emitted[i]! })).filter((h) => h.t > 4);
    const noise = settled.filter((h) => !h.kick).map((h) => h.e);
    const kicks = settled.filter((h) => h.kick).map((h) => h.e);
    // Most background hits emit exactly nothing; the odd louder blip may make
    // a faint ring, never anything near a kick's.
    expect(noise.reduce((a, b) => a + b, 0) / noise.length).toBeLessThan(0.05);
    expect(Math.max(...noise)).toBeLessThan(0.3);
    expect(Math.min(...kicks)).toBeGreaterThan(0.7);
  });

  it("a steady run of equal kicks keeps emitting full rings — the peak is the kick itself", () => {
    const hits = Array.from({ length: 60 }, (_, i) => ({ t: i * 0.5, h: 1 }));
    const emitted = emitPerHit(hits, 30.5);
    for (const e of emitted.slice(-10)) expect(e).toBeGreaterThan(0.85);
  });

  it("after a quiet spell a modest hit stands out again", () => {
    const state = createStandoutState();
    // A busy passage of 0.3 hits pushes the floor up to ~0.3...
    emitPerHit(Array.from({ length: 40 }, (_, i) => ({ t: i * 0.1, h: 0.3 })), 4, state);
    // ...then 8s of silence, then one 0.3 hit.
    const [afterQuiet] = emitPerHit([{ t: 8, h: 0.3 }], 8.5, state);
    expect(afterQuiet).toBeGreaterThan(0.7);
  });

  it("a noise-only passage settles to ~nothing instead of ringing on every blip", () => {
    const hits = noisyKicks(10).filter((h) => !h.kick);
    const emitted = emitPerHit(hits, 10.5);
    const late = emitted.filter((_, i) => hits[i]!.t > 5);
    const mean = late.reduce((a, b) => a + b, 0) / late.length;
    expect(mean).toBeLessThan(0.3);
  });
});

describe("advanceStandoutAmount on a smooth source — whole climbs, not frame steps", () => {
  // A level sitting high with smooth raised-cosine bumps, alternating a big
  // (0.25) and a small (0.06) one every second, each 0.5 s long — the shape a
  // level or drawn-line source gives, not a hit envelope.
  const bumpSignal = (t: number) => {
    const k = Math.floor(t);
    const ph = t - k;
    const size = k % 2 === 0 ? 0.25 : 0.06;
    return 0.75 + (ph < 0.5 ? size * 0.5 * (1 - Math.cos((ph / 0.5) * 2 * Math.PI)) : 0);
  };

  /** Per bump: total emitted and how many separate runs of emitting frames. */
  function runBumps(dt: number, seconds: number) {
    const state = createStandoutState();
    const totals: number[] = [];
    const runs: number[] = [];
    let wasEmitting = false;
    for (let t = 0; t < seconds; t += dt) {
      const k = Math.floor(t);
      const e = advanceStandoutAmount(state, dt, bumpSignal(t));
      totals[k] = (totals[k] ?? 0) + e;
      if (e > 0 && !wasEmitting) runs[k] = (runs[k] ?? 0) + 1;
      wasEmitting = e > 0;
    }
    return { totals, runs };
  }

  it("each big bump sends one ring, small bumps send nothing once it has learned the source", () => {
    const { totals, runs } = runBumps(DT, 20);
    for (let k = 6; k < 20; k++) {
      if (k % 2 === 0) {
        expect(totals[k]!).toBeGreaterThan(0.7);
        expect(runs[k]).toBe(1);
      } else {
        expect(totals[k] ?? 0).toBeLessThan(0.15);
      }
    }
  });

  it("a bump's ring is the same size at 30 and 120 fps", () => {
    const slow = runBumps(1 / 30, 12).totals;
    const fast = runBumps(1 / 120, 12).totals;
    for (let k = 6; k < 12; k += 2) expect(Math.abs(slow[k]! - fast[k]!)).toBeLessThan(0.1);
  });

  it("a ring only starts once the signal is above the drawn 'rings above' line", () => {
    const state = createStandoutState();
    for (let t = 0; t < 12; t += DT) {
      const e = advanceStandoutAmount(state, DT, bumpSignal(t));
      const marks = standoutMarks(state)!; // Ring threshold is on (the default) throughout this test
      if (e > 0) expect(state.smoothed).toBeGreaterThanOrEqual(marks.reach - 1e-9);
      expect(marks.full).toBeGreaterThan(marks.reach);
    }
  });
});

describe("the threshold (the bar's margin over the floor)", () => {
  it("the default is exactly the old fixed bar: 1.5x the floor, no minimum", () => {
    expect(standoutBar(0.2, STANDOUT_THRESHOLD_DEFAULT)).toBeCloseTo(0.3, 10);
    expect(standoutBar(0, STANDOUT_THRESHOLD_DEFAULT)).toBe(0);
  });

  it("its range is wide: no bar at the bottom, well past the old top (3x floor + 0.25) at the top", () => {
    for (const floor of [0, 0.1, 0.2, 0.5]) expect(standoutBar(floor, 0)).toBe(0);
    expect(standoutBar(0.2, 1)).toBeGreaterThan(3 * 0.2 + 0.25);
    expect(standoutBar(0, 1)).toBeGreaterThan(0.25);
  });

  it("raising it rings less on the busy kick-and-hi-hat case; lowering it rings more", () => {
    const totalFaint = (threshold: number) => {
      const state = createStandoutState();
      let pulse = 0;
      let faint = 0;
      let seed = 11;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      advanceStandoutAmount(state, DT, 0, threshold);
      for (let f = 0; f < 60 * 12; f++) {
        const t = f * DT;
        pulse *= Math.exp(-BEAT_PULSE_DECAY * DT);
        const tick = f % 6 === 0; // every 0.1 s
        const kick = f % 30 === 0; // every 0.5 s
        if (kick) pulse = 1;
        else if (tick) pulse = Math.max(pulse, 0.2 + 0.2 * rnd());
        const e = advanceStandoutAmount(state, DT, pulse, threshold);
        if (t > 4 && !(f % 30 < 3)) faint += e; // emission not caused by a kick
      }
      return faint;
    };
    expect(totalFaint(0)).toBeGreaterThan(totalFaint(STANDOUT_THRESHOLD_DEFAULT));
    expect(totalFaint(1)).toBeLessThan(totalFaint(STANDOUT_THRESHOLD_DEFAULT) + 1e-9);
  });

  it("at its top it still blocks small jumps on a clean source (floor 0)", () => {
    const state = createStandoutState();
    advanceStandoutAmount(state, DT, 0, 1);
    let total = 0;
    for (let t = 0; t < 1; t += DT) total += advanceStandoutAmount(state, DT, 0.15 * Math.exp(-BEAT_PULSE_DECAY * t), 1);
    expect(total).toBe(0);
  });

  it("the drawn line follows it", () => {
    const low = createStandoutState();
    const high = createStandoutState();
    for (let t = 0; t < 1; t += DT) {
      advanceStandoutAmount(low, DT, 0.2, 0);
      advanceStandoutAmount(high, DT, 0.2, 1);
    }
    expect(standoutMarks(high)!.reach).toBeGreaterThan(standoutMarks(low)!.reach);
  });
});

describe("threshold Off (threshold: null) — every climb rings, sized by its own climb", () => {
  it("a background-sized (0.3) climb rings ~0.3 and a clean (1.0) hit still rings ~1", () => {
    const background = simulateStepClimb(0.3, null);
    expect(background).toBeGreaterThan(0.25);
    expect(background).toBeLessThan(0.35);
    const full = simulateStepClimb(1, null);
    expect(full).toBeGreaterThan(0.85);
    expect(full).toBeLessThan(1.05);
  });

  it("the same busy kick-and-hi-hat background that reads as ~nothing at the default (see the salience describe above) rings for real once the threshold is off", () => {
    // Same shape as noisyKicks/emitPerHit above (this file's own idiom for a
    // busy track), inlined here since those are scoped to their own describe.
    function noiseTotal(threshold: number | null): number {
      const hits: { t: number; h: number; kick: boolean }[] = [];
      let seed = 11;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let t = 0; t < 12; t += 0.1) {
        const kick = Math.abs(t / 0.5 - Math.round(t / 0.5)) < 1e-6;
        hits.push({ t, h: kick ? 1 : 0.2 + 0.2 * rnd(), kick });
      }
      const state = createStandoutState();
      let pulse = 0;
      let next = 0;
      let current = -1;
      advanceStandoutAmount(state, DT, 0, threshold);
      let total = 0;
      for (let t = 0; t < 12.5; t += DT) {
        pulse *= Math.exp(-BEAT_PULSE_DECAY * DT);
        while (next < hits.length && hits[next]!.t <= t) {
          pulse = Math.max(pulse, hits[next]!.h);
          current = next++;
        }
        const e = advanceStandoutAmount(state, DT, pulse, threshold);
        if (current >= 0 && t > 4 && !hits[current]!.kick) total += e;
      }
      return total;
    }
    const atDefault = noiseTotal(STANDOUT_THRESHOLD_DEFAULT);
    const off = noiseTotal(null);
    expect(atDefault).toBeLessThan(2); // matches the salience describe's own "emit ~nothing" verdict
    expect(off).toBeGreaterThan(atDefault * 2.5); // the very same hits ring for real once nothing is filtered
  });

  it("standoutMarks returns null (no bar to draw) while off, and the real bar again once back on", () => {
    const state = createStandoutState();
    advanceStandoutAmount(state, DT, 0.2, null);
    expect(standoutMarks(state)).toBeNull();
    advanceStandoutAmount(state, DT, 0.2, STANDOUT_THRESHOLD_DEFAULT);
    expect(standoutMarks(state)).not.toBeNull();
  });
});

describe("advanceStandout — one yes per hit that stands out (Physarum 2's Dose reseed)", () => {
  /** Fires counted per hit, for kicks (height 1 every 0.5s) with a small
   *  background blip between each, like noisyKicks above. */
  function firesFor(threshold: number | null): { kick: number; blip: number } {
    const state = createStandoutState();
    let pulse = 0;
    let kick = 0;
    let blip = 0;
    advanceStandout(state, DT, 0, threshold);
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let t = 0; t < 12; t += DT) {
      pulse *= Math.exp(-BEAT_PULSE_DECAY * DT);
      const onKick = Math.abs(t / 0.5 - Math.round(t / 0.5)) < DT / 2 / 0.5;
      const onBlip = !onKick && Math.abs((t - 0.25) / 0.5 - Math.round((t - 0.25) / 0.5)) < DT / 2 / 0.5;
      if (onKick) pulse = Math.max(pulse, 1);
      else if (onBlip) pulse = Math.max(pulse, 0.2 + 0.2 * rnd());
      const fired = advanceStandout(state, DT, pulse, threshold);
      if (fired && t > 4) {
        if (pulse > 0.8) kick++;
        else blip++;
      }
    }
    return { kick, blip };
  }

  it("fires once per kick and stays quiet on the background blips", () => {
    const { kick, blip } = firesFor(STANDOUT_THRESHOLD_DEFAULT);
    // 16 kicks in the 8s after the floor settles; one fire each, never two.
    expect(kick).toBeGreaterThanOrEqual(14);
    expect(kick).toBeLessThanOrEqual(16);
    expect(blip).toBeLessThanOrEqual(1);
  });

  it("with the threshold Off every climb counts, blips included", () => {
    // Many blips sit under the decaying tail of the kick before them and make
    // no climb at all; the ones that do climb all count with the line off.
    const { blip } = firesFor(null);
    expect(blip).toBeGreaterThanOrEqual(2);
    expect(blip).toBeGreaterThan(firesFor(STANDOUT_THRESHOLD_DEFAULT).blip);
  });

  it("a steady level never fires", () => {
    const state = createStandoutState();
    let fires = 0;
    for (let i = 0; i < 300; i++) if (advanceStandout(state, DT, 0.6)) fires++;
    expect(fires).toBe(0);
  });
});

/** A decaying hit pulse (BEAT_PULSE_DECAY) with hits of `h` at times `t` —
 *  the shape a hit or Drop wire hands a setting. */
function pulseAt(hits: { t: number; h: number }[], t: number): number {
  let v = 0;
  for (const hit of hits) if (hit.t <= t) v = Math.max(v, hit.h * Math.exp(-BEAT_PULSE_DECAY * (t - hit.t)));
  return v;
}

/** Steps a trigger over `pulseAt(hits)` from 0 to `endSec`, returning the
 *  time of every fire. `armed` is asked once per frame, with that frame's time. */
function fireTimes(minGapSec: number, hits: { t: number; h: number }[], endSec: number, armed: (t: number) => boolean = () => true): number[] {
  const trigger = createStandoutTrigger(minGapSec);
  const fires: number[] = [];
  for (let i = 0; i * DT < endSec; i++) {
    const t = i * DT;
    if (stepStandoutTrigger(trigger, DT, pulseAt(hits, t), STANDOUT_THRESHOLD_DEFAULT, armed(t))) fires.push(t);
  }
  return fires;
}

describe("StandoutTrigger — one event per standout, never closer than its gap", () => {
  it("fires on the first standout, then at most once per minGapSec", () => {
    // Equal kicks every 0.5 s for 10 s, gap 1.2 s: every third kick.
    const kicks = Array.from({ length: 20 }, (_, i) => ({ t: 0.5 + i * 0.5, h: 1 }));
    const fires = fireTimes(1.2, kicks, 10.4);
    expect(fires[0]).toBeCloseTo(0.5, 1);
    for (let i = 1; i < fires.length; i++) expect(fires[i]! - fires[i - 1]!).toBeGreaterThanOrEqual(1.2);
    expect(fires.length).toBeGreaterThanOrEqual(6);
    expect(fires.length).toBeLessThanOrEqual(7);
  });

  it("drops a standout inside the gap instead of firing it late", () => {
    // Two kicks 0.4 s apart, gap 1 s, then silence: one fire, not a delayed second.
    const fires = fireTimes(1, [{ t: 0.5, h: 1 }, { t: 0.9, h: 1 }], 4);
    expect(fires).toHaveLength(1);
  });

  it("disarmed it never fires but keeps learning, so once armed only the kicks fire", () => {
    // Kicks every 0.5 s with a quieter hat between, disarmed for the first 6 s.
    const hits: { t: number; h: number }[] = [];
    for (let t = 0.5; t < 10; t += 0.5) hits.push({ t, h: 1 }, { t: t + 0.25, h: 0.3 });
    const fires = fireTimes(0.1, hits, 10, (t) => t > 6);
    expect(fires.every((t) => t > 6)).toBe(true);
    // Every fire lands on a kick, none on a hat: the floor was learned while disarmed.
    for (const t of fires) expect(Math.abs(t / 0.5 - Math.round(t / 0.5))).toBeLessThan(0.1);
    expect(fires.length).toBeGreaterThanOrEqual(7);
  });
});

describe("standoutThreshold / standoutLine", () => {
  it("reads the row's slider, null while it's Off, and the shared default with no engine", () => {
    expect(standoutThreshold({ threshold: () => 0.7 }, "k")).toBe(0.7);
    expect(standoutThreshold({ threshold: () => null }, "k")).toBeNull();
    expect(standoutThreshold({ threshold: () => undefined }, "k")).toBe(STANDOUT_THRESHOLD_DEFAULT);
  });

  it("draws one labelled line at the reach mark while on, and none while off", () => {
    const state = createStandoutState();
    advanceStandoutAmount(state, DT, 0.2, STANDOUT_THRESHOLD_DEFAULT);
    expect(standoutLine(state, "reach to cut")).toEqual([{ value: standoutMarks(state)!.reach, label: "reach to cut" }]);
    advanceStandoutAmount(state, DT, 0.2, null);
    expect(standoutLine(state, "reach to cut")).toEqual([]);
  });
});

describe("advanceStandoutSized — one sized report per climb (the Reaction row's Sized)", () => {
  /** Settles at 0, then runs `signal(t)` and returns every non-zero report
   *  with the tick it came on (tick 0 is the signal's first tick). */
  function reports(signal: (t: number) => number, threshold: number | null, totalSec = 2) {
    const state = createStandoutState();
    for (let i = 0; i < 10; i++) advanceStandoutSized(state, DT, 0, threshold);
    const out: { tick: number; size: number }[] = [];
    for (let tick = 0; tick * DT < totalSec; tick++) {
      const size = advanceStandoutSized(state, DT, signal(tick * DT), threshold);
      if (size > 0) out.push({ tick, size });
    }
    return out;
  }

  it("a clean full hit reports about 1 on the tick it lands, once", () => {
    const r = reports((t) => Math.exp(-BEAT_PULSE_DECAY * t), STANDOUT_THRESHOLD_DEFAULT);
    expect(r).toHaveLength(1);
    expect(r[0]!.tick).toBe(0);
    expect(r[0]!.size).toBeGreaterThan(0.95);
  });

  it("with the threshold Off, a smaller hit reports its own height one tick later, once", () => {
    const r = reports((t) => 0.4 * Math.exp(-BEAT_PULSE_DECAY * t), null);
    expect(r).toHaveLength(1);
    expect(r[0]!.tick).toBe(1);
    expect(r[0]!.size).toBeCloseTo(0.4, 1);
  });

  it("a smooth bump reports once, at its top, for its whole climb", () => {
    const bump = (t: number) => (t < 0.4 ? 0.3 * (1 - Math.cos((Math.PI * t) / 0.4)) : 0.6 * Math.exp(-3 * (t - 0.4)));
    const r = reports(bump, null);
    expect(r).toHaveLength(1);
    expect(r[0]!.tick * DT).toBeGreaterThan(0.3);
    expect(r[0]!.size).toBeCloseTo(0.6, 1);
  });

  it("a sliver too small to be a reaction reports nothing", () => {
    expect(reports((t) => 0.05 * Math.exp(-BEAT_PULSE_DECAY * t), null)).toHaveLength(0);
  });
});

describe("stepStandoutHit — the trigger with a read-out", () => {
  /** Half-height hits at `hitSec`, a 1 s gap, the threshold Off: what each
   *  firing tick returned. */
  function fires(readout: "flat" | "sized", hitSec: number[]) {
    const trigger = createStandoutTrigger(1);
    let pulse = 0;
    const out: number[] = [];
    for (let tick = 0; tick * DT < 3; tick++) {
      const t = tick * DT;
      pulse *= Math.exp(-BEAT_PULSE_DECAY * DT);
      if (hitSec.some((h) => Math.abs(h - t) < DT / 2)) pulse = Math.max(pulse, 0.5);
      const size = stepStandoutHit(trigger, DT, pulse, null, readout);
      if (size > 0) out.push(size);
    }
    return out;
  }
  const HITS = [0.5, 0.75, 2];

  it("Flat fires at 1, and drops the hit inside the gap", () => {
    expect(fires("flat", HITS)).toEqual([1, 1]);
  });

  it("Sized fires at the hit's size, and drops the same hit", () => {
    const sized = fires("sized", HITS);
    expect(sized).toHaveLength(2);
    for (const s of sized) expect(s).toBeCloseTo(0.5, 1);
  });

  it("stepStandoutTrigger is the Flat form", () => {
    const a = createStandoutTrigger(0.2);
    const b = createStandoutTrigger(0.2);
    for (let tick = 0; tick < 600; tick++) {
      const v = Math.exp(-BEAT_PULSE_DECAY * ((tick * DT) % 0.37)) * (tick % 3 === 0 ? 1 : 0.6);
      expect(stepStandoutTrigger(a, DT, v, STANDOUT_THRESHOLD_DEFAULT)).toBe(stepStandoutHit(b, DT, v, STANDOUT_THRESHOLD_DEFAULT, "flat") > 0);
    }
  });
});
