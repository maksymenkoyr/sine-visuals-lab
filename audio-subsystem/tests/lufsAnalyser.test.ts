// audio-subsystem/src/lufsAnalyser.ts copies its tap only once the samples that close
// a block have arrived, and must still hand the meter a gap-free stream. A
// fake context stands in for Web Audio: its analyser returns the newest
// samples of one fixed signal as of a clock the test moves by hand, and
// notes where that clock stood at each copy.
import { describe, it, expect } from "vitest";
import { BLOCK_MS, createLufsMeter } from "../src/lufs.ts";
import { createLufsAnalyser } from "../src/lufsAnalyser.ts";

const RATE = 48000;
/** Samples per rAF tick on a 120 Hz display. */
const TICK = RATE / 120;

function signal(i: number): number {
  return 0.3 * Math.sin((2 * Math.PI * 997 * i) / RATE) + 0.1 * Math.sin((2 * Math.PI * 61 * i) / RATE);
}

function fakeCapture() {
  let end = 0;
  const copies: number[] = [];
  const node = { connect: () => {} };
  const analyser = {
    fftSize: 2048,
    connect: () => {},
    getFloatTimeDomainData(buf: Float32Array): void {
      copies.push(end);
      for (let k = 0; k < buf.length; k++) {
        const i = end - buf.length + k;
        buf[k] = i >= 0 ? signal(i) : 0;
      }
    },
  };
  const context = {
    sampleRate: RATE,
    get currentTime() {
      return end / RATE;
    },
    createIIRFilter: () => node,
    createAnalyser: () => analyser,
  };
  const lufs = createLufsAnalyser(context as unknown as AudioContext, node as unknown as AudioNode);
  lufs.read(); // starts the tap's clock
  return {
    lufs,
    /** Samples since the start, at each copy of the tap. */
    copies,
    advance(samples: number): void {
      end += samples;
    },
  };
}

/** Reads once per tick for `ticks` ticks. */
function run(ticks: number) {
  const f = fakeCapture();
  for (let t = 0; t < ticks; t++) {
    f.advance(TICK);
    f.lufs.read();
  }
  return f;
}

describe("LUFS tap", () => {
  it("copies the tap once per block, not on every tick", () => {
    expect(run(120).copies.length).toBe(1000 / BLOCK_MS); // one second
  });

  it("reads exactly what a meter fed the whole stream reads", () => {
    const { lufs, copies } = run(600); // past the short-term window
    const upTo = copies[copies.length - 1]!;
    const all = new Float32Array(upTo);
    for (let i = 0; i < upTo; i++) all[i] = signal(i);
    const meter = createLufsMeter(RATE);
    meter.push(all);
    expect(Number.isFinite(meter.read().shortTerm)).toBe(true);
    expect(lufs.read()).toEqual(meter.read());
  });

  it("reset() clears the integrated reading at once", () => {
    const { lufs } = run(600);
    expect(Number.isFinite(lufs.read().integrated)).toBe(true);
    lufs.reset();
    expect(lufs.read().integrated).toBe(-Infinity);
  });

  it("a gap longer than the tap still copies, once", () => {
    const f = fakeCapture();
    f.advance(RATE * 2);
    f.lufs.read();
    expect(f.copies.length).toBe(1);
  });
});
