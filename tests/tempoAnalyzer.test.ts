import { describe, it, expect } from "vitest";
import { TempoAnalyzer } from "../src/audio/tempoAnalyzer.ts";

const SR = 48000;
const BLOCK = 128; // matches tempoWorklet.ts's own AudioWorklet render-quantum-sized feed

/** A click track: a decaying low tone at every beat, rendered well past its
 *  own decay floor (clickLenSec, ~8 time constants) so consecutive clicks
 *  never truncate each other into an abrupt discontinuity — that would read
 *  as a second, spurious flux onset right where the tail gets cut off.
 *  Enough low-band flux for the analyzer's onset picker to fire on, without
 *  needing the full drum-machine synthesis tests/tempoEval/synth.ts builds.
 *  `trailingSilenceSec`, appended after the last click, is part of the same
 *  continuous buffer (not a separate push() call) so the analyzer's own
 *  absolute-time bookkeeping (endTime vs lastOnset) stays consistent. */
function clickTrack(bpm: number, seconds: number, trailingSilenceSec = 0): { mono: Float32Array; clicks: number[] } {
  const mono = new Float32Array(Math.round((seconds + trailingSilenceSec) * SR));
  const intervalSec = 60 / bpm;
  const freq = 150;
  const decaySec = 0.05;
  const clickLenSec = decaySec * 8;
  const clicks: number[] = [];
  for (let t = 0; t < seconds; t += intervalSec) {
    clicks.push(t);
    const startSample = Math.round(t * SR);
    const len = Math.round(clickLenSec * SR);
    for (let i = 0; i < len && startSample + i < mono.length; i++) {
      const lt = i / SR;
      mono[startSample + i]! += Math.sin(2 * Math.PI * freq * lt) * Math.exp(-lt / decaySec);
    }
  }
  return { mono, clicks };
}

function feed(an: TempoAnalyzer, mono: Float32Array, onOnsets?: (onsets: ReturnType<TempoAnalyzer["drainOnsets"]>) => void): void {
  for (let i = 0; i < mono.length; i += BLOCK) {
    an.push(mono.subarray(i, Math.min(mono.length, i + BLOCK)), i / SR);
    const onsets = an.drainOnsets();
    if (onsets.length && onOnsets) onOnsets(onsets);
  }
}

describe("TempoAnalyzer", () => {
  it("locks onto a click track's tempo within +/-1 bpm", () => {
    const bpm = 120;
    const { mono } = clickTrack(bpm, 12);
    const an = new TempoAnalyzer(SR);
    feed(an, mono);
    expect(an.bpm).toBeGreaterThan(bpm - 1);
    expect(an.bpm).toBeLessThan(bpm + 1);
  });

  it("onsets land within one hop of the true click times", () => {
    const bpm = 128;
    const { mono, clicks } = clickTrack(bpm, 10);
    const an = new TempoAnalyzer(SR);
    const detected: number[] = [];
    feed(an, mono, (onsets) => {
      for (const o of onsets) detected.push(o.time);
    });

    expect(detected.length).toBeGreaterThanOrEqual(clicks.length - 1);
    for (const d of detected) {
      let nearest = Infinity;
      for (const c of clicks) if (Math.abs(c - d) < Math.abs(nearest)) nearest = c - d;
      expect(Math.abs(nearest)).toBeLessThanOrEqual(an.hopSec);
    }
  });

  it("bpm returns to 0 after silence past the decay window", () => {
    const bpm = 100;
    // trailingSilenceSec is part of the same continuous buffer — see
    // clickTrack's own doc comment for why a separate push() call with its
    // own restarted startTime would break the analyzer's decay check.
    const { mono } = clickTrack(bpm, 8, 4); // 4s silence, past TEMPO_DECAY_SEC
    const an = new TempoAnalyzer(SR);
    let bpmAtClicksEnd = 0;
    for (let i = 0; i < mono.length; i += BLOCK) {
      an.push(mono.subarray(i, Math.min(mono.length, i + BLOCK)), i / SR);
      an.drainOnsets();
      if (i / SR < 8) bpmAtClicksEnd = an.bpm;
    }
    expect(bpmAtClicksEnd).toBeGreaterThan(0); // sanity: it actually locked first
    expect(an.bpm).toBe(0);
  });
});
