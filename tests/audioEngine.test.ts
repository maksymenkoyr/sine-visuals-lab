import { describe, expect, it } from "vitest";
import { BeatClock } from "../src/audio/engine/clock.ts";
import { Fft } from "../src/audio/engine/fft.ts";
import { linkwitzRiley, runChain } from "../src/audio/engine/filters.ts";
import { addHat, addKick, between, concat, drive, groove, noise, SR, silence } from "./engine/signals.ts";

const max = (xs: number[]) => xs.reduce((a, b) => Math.max(a, b), 0);
const nearest = (xs: number[], t: number) => xs.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a), Infinity);

/** Steady-state gain of a chain at `hz`, in dB. */
function gainDb(kind: "lowpass" | "highpass", fc: number, hz: number): number {
  const chain = linkwitzRiley(kind, fc, SR);
  let inPow = 0;
  let outPow = 0;
  for (let i = 0; i < SR; i++) {
    const x = Math.sin((2 * Math.PI * hz * i) / SR);
    const y = runChain(chain, x);
    if (i > SR / 2) {
      inPow += x * x;
      outPow += y * y;
    }
  }
  return 10 * Math.log10(outPow / inPow);
}

describe("audio engine: filters and FFT", () => {
  it("a Linkwitz-Riley side is -6 dB at its corner and -24 dB an octave out", () => {
    expect(Math.abs(gainDb("lowpass", 1000, 1000) + 6)).toBeLessThan(0.3);
    expect(Math.abs(gainDb("lowpass", 1000, 2000) + 24.6)).toBeLessThan(1);
    expect(Math.abs(gainDb("highpass", 1000, 500) + 24.6)).toBeLessThan(1);
    expect(Math.abs(gainDb("highpass", 1000, 8000))).toBeLessThan(0.1);
  });

  it("the FFT finds a sinusoid's bin and inverts back", () => {
    const fft = new Fft(256);
    const re = new Float64Array(256);
    const im = new Float64Array(256);
    for (let i = 0; i < 256; i++) re[i] = Math.cos((2 * Math.PI * 10 * i) / 256);
    const orig = re.slice();
    fft.transform(re, im);
    const mags = Array.from(re, (r, i) => Math.hypot(r, im[i]));
    expect(mags.slice(0, 128).indexOf(Math.max(...mags.slice(0, 128)))).toBe(10);
    fft.transform(re, im, true);
    for (let i = 0; i < 256; i++) expect(Math.abs(re[i] - orig[i])).toBeLessThan(1e-9);
  });
});

describe("audio engine: band levels", () => {
  it("digital silence reads 0 in every band", () => {
    for (const r of between(drive(silence(4)), 0, 4)) expect(r.low + r.mid + r.high).toBe(0);
  });

  it("a kick drives the low band, a hat the high band", () => {
    const x = concat(silence(1), new Float32Array(SR * 6));
    for (let k = 0; k < 4; k++) addKick(x, 1.5 + k * 0.7, 0.8, k + 1);
    for (let k = 0; k < 4; k++) addHat(x, 4.5 + k * 0.6, 0.3, k + 9);
    const run = drive(x);
    const kicks = between(run, 1.4, 4.2);
    const hats = between(run, 4.4, 7);
    const sum = (rs: typeof kicks, b: "low" | "mid" | "high") => rs.reduce((s, r) => s + r[b], 0);
    expect(max(kicks.map((r) => r.low))).toBeGreaterThan(0.7);
    // Over silence nothing else sets the other bands' range, so a kick's attack still shows in
    // them at roughly a third of the low band; it must stay well under it.
    expect(sum(kicks, "high")).toBeLessThan(0.5 * sum(kicks, "low"));
    expect(sum(kicks, "mid")).toBeLessThan(0.5 * sum(kicks, "low"));
    expect(max(hats.map((r) => r.high))).toBeGreaterThan(0.7);
    expect(max(hats.map((r) => r.low))).toBeLessThan(0.1);
    expect(max(hats.map((r) => r.mid))).toBeLessThan(0.2);
  });

  it("a band follows its hit within two frames", () => {
    const run = drive(concat(groove(6, 120), silence(0.5)));
    // The kick at 5.0 s: the frame ending 33 ms later must already be most of the way up.
    const at = run.frames.find((f) => f.t >= 5.0333)!;
    expect(at.r.low).toBeGreaterThan(0.5);
  });

  it("steady noise does not pin or flicker the bands", () => {
    const late = between(drive(noise(10, 0.01)), 6, 10);
    for (const b of ["low", "mid", "high"] as const) expect(max(late.map((r) => r[b])), b).toBeLessThan(0.6);
  });

  it("a quieter passage is auto-ranged back up within a few seconds", () => {
    const quiet = groove(8, 120).map((v) => v * 0.1);
    const run = drive(concat(groove(8, 120), quiet));
    const spread = (rs: { low: number }[]) => max(rs.map((r) => r.low)) - Math.min(...rs.map((r) => r.low));
    expect(spread(between(run, 12, 16))).toBeGreaterThan(0.6 * spread(between(run, 4, 8)));
  });

  it("levels stay in 0..1 at any frame rate", () => {
    for (const fps of [24, 60, 144]) {
      for (const { r } of drive(groove(4, 128), fps).frames) {
        for (const v of [r.low, r.mid, r.high]) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe("audio engine: hits, tempo and the beat clock", () => {
  it("a steady groove locks tempo and beats within a few seconds", () => {
    const run = drive(groove(20, 120));
    const late = run.frames.filter((f) => f.t > 8);
    expect(late.every((f) => f.r.music)).toBe(true);
    expect(late.every((f) => Math.abs(f.bpm - 120) < 1.5), `bpm ${late[0].bpm}`).toBe(true);
    // Every beat after 8 s lands within 20 ms of a kick, and none is missing.
    const kicks = Array.from({ length: 40 }, (_, k) => k * 0.5).filter((t) => t > 8 && t < 19.5);
    for (const k of kicks) expect(Math.abs(nearest(run.beats, k) - k), `beat near ${k}`).toBeLessThan(0.02);
    expect(run.beats.filter((t) => t > 8 && t < 19.5).length).toBe(kicks.length);
  });

  it("a tempo change is followed within four seconds", () => {
    const after = drive(concat(groove(14, 120), groove(14, 128))).frames.filter((f) => f.t > 18);
    expect(after.every((f) => Math.abs(f.bpm - 128) < 1.5), `bpm ${after[0].bpm}`).toBe(true);
  });

  it("drum hits are reported, named, and on time", () => {
    const run = drive(groove(10, 100));
    const kicks = run.hits.filter((h) => h.kind === "kick").map((h) => h.t);
    for (let t = 3; t < 9.5; t += 0.6) expect(Math.abs(nearest(kicks, t) - t), `kick at ${t}`).toBeLessThan(0.045);
    expect(run.hits.filter((h) => h.kind === "hat").length).toBeGreaterThan(5);
  });

  it("no music: no beats, no tempo, for silence and for steady noise", () => {
    for (const x of [silence(15), noise(15, 0.02, 4)]) {
      const run = drive(x);
      expect(run.beats.length).toBe(0);
      expect(run.frames.every((f) => f.bpm === 0 && !f.r.music)).toBe(true);
    }
  });

  it("when the music stops, beats stop within a few seconds", () => {
    const run = drive(concat(groove(12, 120), noise(10, 0.002, 5)));
    expect(run.beats.filter((t) => t > 16).length).toBe(0);
    expect(run.frames.filter((f) => f.t > 16).every((f) => f.bpm === 0)).toBe(true);
  });

  it("tempo does not depend on the frame rate", () => {
    for (const fps of [24, 30, 144]) {
      const last = drive(groove(12, 132), fps).frames.at(-1)!;
      expect(Math.abs(last.bpm - 132), `${fps} fps: ${last.bpm}`).toBeLessThan(1.5);
    }
  });

  it("the clock's beat count never goes back", () => {
    for (const x of [groove(20, 120), concat(groove(14, 120), groove(14, 128)), concat(groove(12, 120), noise(10, 0.002, 5))]) {
      const frames = drive(x).frames;
      for (let i = 1; i < frames.length; i++) expect(frames[i].c.beats).toBeGreaterThanOrEqual(frames[i - 1].c.beats);
    }
  });

  it("the clock holds still before any music, and coasts to a stop after it", () => {
    expect(drive(noise(8, 0.02, 4)).frames.every((f) => f.c.beats === 0 && f.c.bpm === 0)).toBe(true);
    const frames = drive(concat(groove(12, 120), noise(10, 0.002, 5))).frames;
    const late = frames.filter((f) => f.t > 19);
    expect(late.every((f) => f.c.bpm === 0 && !f.c.locked)).toBe(true);
    expect(late.at(-1)!.c.beats).toBe(late[0].c.beats);
  });
});

describe("audio engine: beat clock seed and division", () => {
  const locked = { bpm: 120, music: true, beatTime: 0, downbeatTime: 0, downbeatConfidence: 0, updates: 1 };

  it("a seed runs at the tapped tempo, moved the short way onto the tapped beat", () => {
    const clock = new BeatClock();
    clock.follow(locked, 0);
    clock.tick(0, 1 / 60);
    clock.seed(90, 0.25, 0.1);
    const c = { ...clock.tick(0.1, 1 / 60) };
    expect(c.bpm).toBe(90);
    expect(c.beatPhase).toBeCloseTo(0.25, 9);
    const later = clock.tick(0.1 + 60 / 90, 1 / 60);
    expect(later.beats - c.beats).toBeCloseTo(1, 9);
  });

  it("follow() returns the phase error it measured: none on the snap, a repeat or no music", () => {
    const clock = new BeatClock();
    expect(clock.follow(locked, 0)).toBeNull();
    clock.tick(0, 1 / 60);
    expect(clock.follow(locked, 0.01)).toBeNull();
    // The clock reads a tenth of a beat past whole at the tracker's beat.
    const error = clock.follow({ ...locked, beatTime: 0.55, updates: 2 }, 0.6);
    expect(error).toBeCloseTo(0.1, 9);
    expect(clock.follow({ ...locked, music: false, updates: 3 }, 0.7)).toBeNull();
  });

  it("at division 2 a tracker beat on the clock's half beat isn't pulled onto the whole beat", () => {
    const pulled = (division: 1 | 2) => {
      const clock = new BeatClock();
      clock.setDivision(division);
      // Half tempo: the tracker hears 120, the clock runs at 60 with its beat on t = 0.
      clock.follow({ ...locked, bpm: 60, beatTime: 0 }, 0);
      clock.tick(0, 1 / 60);
      // The tracker's next beat, half a clock beat later.
      clock.follow({ ...locked, bpm: 60, beatTime: 0.5, updates: 2 }, 0.5);
      return clock.tick(0.5, 1 / 60).beatPhase;
    };
    expect(pulled(2)).toBeCloseTo(0.5, 9);
    expect(Math.abs(pulled(1) - 0.5)).toBeGreaterThan(0.1);
  });
});
