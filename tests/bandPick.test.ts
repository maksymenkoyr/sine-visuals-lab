import { describe, it, expect } from "vitest";
import { NUM_BANDS } from "../audio-subsystem/src/types.ts";
import { createBandPick, SWITCH_FADE_SEC, type BandPick } from "../src/render/bandPick.ts";

const DT = 1 / 60;

interface Sample {
  band: number;
  value: number;
  bands: Float32Array;
}

// Square wave: 0.9 for a quarter second, then 0.1 for a quarter second.
function pulse(t: number): number {
  return Math.floor(t / 0.25) % 2 === 0 ? 0.9 : 0.1;
}

// Every band steady at 0.5, except the bands listed in `pulsing`, which ride the square wave.
function frameWith(pulsing: readonly number[]): (t: number) => Float32Array {
  return (t) => {
    const bands = new Float32Array(NUM_BANDS).fill(0.5);
    for (const b of pulsing) bands[b] = pulse(t);
    return bands;
  };
}

function run(
  pick: BandPick,
  fromSec: number,
  seconds: number,
  source: (t: number) => Float32Array,
  lowMid = 6,
): Sample[] {
  const out: Sample[] = [];
  const frames = Math.round(seconds / DT);
  for (let i = 0; i < frames; i++) {
    const t = fromSec + i * DT;
    const bands = source(t);
    pick.advance(DT, bands, lowMid);
    out.push({ band: pick.band, value: pick.value, bands });
  }
  return out;
}

describe("bandPick", () => {
  it("picks the low band that pulses", () => {
    const pick = createBandPick();
    const samples = run(pick, 0, 6, frameWith([3]));
    expect(pick.band).toBe(3);
    expect(pick.value).toBeCloseTo(samples[samples.length - 1].bands[3], 5);
  });

  it("two equal pulsing bands: at most one switch in 20 s", () => {
    const pick = createBandPick();
    const samples = run(pick, 0, 20, frameWith([1, 2]));
    let changes = 0;
    for (let i = 1; i < samples.length; i++) {
      if (samples[i].band !== samples[i - 1].band) changes++;
    }
    expect(changes).toBeLessThanOrEqual(1);
  });

  it("re-picks when the music changes", () => {
    const pick = createBandPick();
    run(pick, 0, 10, frameWith([1]));
    expect(pick.band).toBe(1);
    run(pick, 10, 10, frameWith([4]));
    expect(pick.band).toBe(4);
  });

  it("silence freezes the pick", () => {
    const pick = createBandPick();
    run(pick, 0, 6, frameWith([3]));
    expect(pick.band).toBe(3);
    const silence = run(pick, 6, 10, () => new Float32Array(NUM_BANDS));
    expect(silence.every((s) => s.band === 3)).toBe(true);
  });

  it("the Bands split moving under the pick re-picks inside the new range at once", () => {
    const pick = createBandPick();
    run(pick, 0, 6, frameWith([4]), 6);
    expect(pick.band).toBe(4);
    pick.advance(DT, frameWith([4])(6), 3);
    expect(pick.band).toBeLessThan(3);
  });

  it("crossfades on a switch", () => {
    const pick = createBandPick();
    const first = run(pick, 0, 10, frameWith([1]));
    const second = run(pick, 10, 10, frameWith([4]));
    const all = [...first, ...second];

    let k = -1;
    for (let i = first.length; i < all.length; i++) {
      if (all[i].band !== all[i - 1].band) {
        k = i;
        break;
      }
    }
    expect(k).toBeGreaterThan(0);
    const from = all[k - 1].band;
    const to = all[k].band;
    expect(from).toBe(1);
    expect(to).toBe(4);

    const window = Math.ceil(SWITCH_FADE_SEC / DT) + 1;
    let checked = false;
    for (let i = k; i < Math.min(all.length, k + window); i++) {
      const a = all[i].bands[from];
      const b = all[i].bands[to];
      if (Math.abs(a - b) < 1e-6) continue;
      expect(all[i].value).toBeGreaterThan(Math.min(a, b));
      expect(all[i].value).toBeLessThan(Math.max(a, b));
      checked = true;
      break;
    }
    expect(checked).toBe(true);
  });

  it("a mid/high band never gets picked", () => {
    const pick = createBandPick();
    const samples = run(pick, 0, 20, frameWith([10]));
    expect(samples.every((s) => s.band < 6)).toBe(true);
  });
});
