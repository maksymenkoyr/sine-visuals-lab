// Band levels for visuals. Each band is a time-domain crossover filter whose
// RMS is measured over exactly the audio since the previous frame, so a level
// follows the instrument's own loudness with no FFT window behind it. Each
// level is auto-ranged against its own recent peak, which may not fall far
// below the loudest band's peak scaled by the band's usual share of a mix (so
// a band hearing only another instrument's leakage is not blown up to full
// scale), nor down into the band's noise floor (so room tone stays near 0).
// docs/audio-engine.md has the measurements behind each choice.

import { type Biquad, linkwitzRiley, runChain } from "./filters.ts";

export interface BandSpec {
  name: string;
  highpassHz?: number;
  lowpassHz?: number;
  /** This band's usual peak level against the loudest band's in a full mix, in dB. */
  shareDb: number;
  /**
   * The band's range top stays this far above its noise floor. A narrow band's noise swings
   * further from frame to frame, so it needs more.
   */
  noiseHeadroomDb: number;
}

// The gaps between bands are on purpose: they keep a snare's body out of the
// lows and its sizzle partly out of the highs. The edges are the ones the
// bench's real-music stems use (docs/audio-engine.md).
export const DEFAULT_BANDS: readonly BandSpec[] = [
  { name: "low", lowpassHz: 150, shareDb: 0, noiseHeadroomDb: 14 },
  { name: "mid", highpassHz: 300, lowpassHz: 3000, shareDb: -10, noiseHeadroomDb: 9 },
  { name: "high", highpassHz: 6000, shareDb: -14, noiseHeadroomDb: 9 },
];

export interface RangeOptions {
  /** Seconds for the peak to rise to a louder level. */
  attack: number;
  /** dB per second the peak falls while the band is quieter than it. */
  releaseDbPerSec: number;
  /** Share (0..1) of the band's sustained level subtracted, so a held pad doesn't pin the band high. */
  sustain: number;
  /** How far under its usual share of the loudest band's peak a band's peak may fall, in dB. */
  couplingDb: number;
  /** Peaks never count as quieter than this, so digital near-silence stays at 0. */
  absoluteFloorDb: number;
  /** Seconds a falling output takes to cover 63% of the way; rises are immediate. */
  release: number;
  /** Outputs above this bend smoothly towards 1 instead of clipping. */
  knee: number;
}

// releaseDbPerSec: half as fast kept a quiet passage after a loud one dark
// for over ten seconds; faster cost band separation. couplingDb: tighter
// separated hits better but squeezed bands that are naturally quiet in a mix;
// looser kept quiet passages livelier but let more leakage and talking
// through.
const RANGE_DEFAULTS: RangeOptions = {
  attack: 0.15,
  releaseDbPerSec: 3,
  sustain: 0.5,
  couplingDb: -12,
  absoluteFloorDb: -80,
  release: 0.06,
  knee: 0.8,
};

/** Noise and sustained levels are the minimum of a smoothed level over this window, in slices. */
const MIN_WINDOW_S = 5;
const MIN_SLICES = 5;
/** Smoothing before the minimum, so one quiet frame between hits isn't taken for the floor. */
const MIN_SMOOTH_S = 0.12;
/** The minimum ignores this long after start, while the filters and smoothing settle. */
const MIN_SETTLE_S = 0.3;
/** Headroom above the noise floor for the unfiltered level, which fluctuates little. */
const FULL_NOISE_HEADROOM_DB = 9;

const toDb = (x: number) => 20 * Math.log10(Math.max(x, 1e-10));
const fromDb = (db: number) => 10 ** (db / 20);

/** The minimum of a smoothed value over the last MIN_WINDOW_S, from rolling slices. */
class RollingMin {
  value = 0;
  private smooth = Number.NaN;
  private sliceMin = Infinity;
  private readonly slices: number[] = [];
  private age = 0;
  private alive = 0;

  update(x: number, dt: number): number {
    this.smooth = Number.isNaN(this.smooth) ? x : this.smooth + (x - this.smooth) * (1 - Math.exp(-dt / MIN_SMOOTH_S));
    this.alive += dt;
    if (this.alive < MIN_SETTLE_S) return (this.value = this.smooth);
    this.sliceMin = Math.min(this.sliceMin, this.smooth);
    this.age += dt;
    if (this.age >= MIN_WINDOW_S / MIN_SLICES) {
      this.slices.push(this.sliceMin);
      if (this.slices.length > MIN_SLICES) this.slices.shift();
      this.sliceMin = Infinity;
      this.age = 0;
    }
    let m = this.sliceMin;
    for (const s of this.slices) m = Math.min(m, s);
    return (this.value = m);
  }
}

class Range {
  /** Minimum of the band's power. */
  readonly noise = new RollingMin();
  /** Minimum of the band's level: what it never drops under while something is held. */
  readonly held = new RollingMin();
  level = 0;
  peakDb = -Infinity;
  value = 0;

  /** Updates noise, sustained level and peak from this frame's mean square power. */
  track(power: number, dt: number, o: RangeOptions): void {
    this.noise.update(power, dt);
    this.level = Math.sqrt(power);
    this.held.update(this.level, dt);
    const db = toDb(this.level);
    if (!Number.isFinite(this.peakDb)) this.peakDb = db;
    else if (db > this.peakDb) {
      // Rising in amplitude, not in dB: after silence a dB approach needed a second to climb the
      // 100+ dB to the first sound, and every band sat at full scale meanwhile.
      const peak = fromDb(this.peakDb);
      this.peakDb = toDb(peak + (this.level - peak) * (1 - Math.exp(-dt / o.attack)));
    } else {
      this.peakDb = Math.max(db, this.peakDb - o.releaseDbPerSec * dt);
    }
  }

  /** The lowest top this band may be ranged against, from its own noise. */
  noiseTopDb(headroomDb: number): number {
    return 10 * Math.log10(Math.max(this.noise.value, 1e-20)) + headroomDb;
  }

  /** Maps the level into 0..1 under `topDb`, bends the top, and smooths falls. */
  output(topDb: number, dt: number, o: RangeOptions): number {
    const base = o.sustain * this.held.value;
    const u = Math.max(0, (this.level - base) / Math.max(1e-12, fromDb(topDb) - base));
    const k = o.knee;
    const shaped = u <= k ? u : k + (1 - k) * (1 - Math.exp(-(u - k) / (1 - k)));
    const fall = Math.exp(-dt / o.release);
    this.value = shaped >= this.value ? shaped : shaped + (this.value - shaped) * fall;
    return this.value;
  }
}

export interface BandReading {
  /** Auto-ranged level, 0..1. */
  values: Float32Array;
  /** RMS since the previous reading, in dBFS. */
  db: Float32Array;
  /** Auto-ranged level of the unfiltered signal, 0..1. */
  level: number;
}

function buildChain(s: BandSpec, sampleRate: number): Biquad[] {
  return [
    ...(s.highpassHz ? linkwitzRiley("highpass", s.highpassHz, sampleRate) : []),
    ...(s.lowpassHz ? linkwitzRiley("lowpass", s.lowpassHz, sampleRate) : []),
  ];
}

export class BandMeter {
  readonly specs: readonly BandSpec[];
  readonly options: RangeOptions;
  private readonly chains: Biquad[][];
  private readonly sums: Float64Array;
  private fullSum = 0;
  private count = 0;
  private readonly power: Float64Array;
  private fullPower = 0;
  private readonly ranges: Range[];
  private readonly full = new Range();
  private readonly reading: BandReading;

  constructor(sampleRate: number, specs: readonly BandSpec[] = DEFAULT_BANDS, options: Partial<RangeOptions> = {}) {
    this.specs = specs;
    this.options = { ...RANGE_DEFAULTS, ...options };
    this.chains = specs.map((s) => buildChain(s, sampleRate));
    this.sums = new Float64Array(specs.length);
    this.power = new Float64Array(specs.length);
    this.ranges = specs.map(() => new Range());
    this.reading = { values: new Float32Array(specs.length), db: new Float32Array(specs.length), level: 0 };
  }

  // @per-frame
  push(samples: Float32Array): void {
    const { chains, sums } = this;
    for (let b = 0; b < chains.length; b++) {
      const chain = chains[b];
      let s = 0;
      for (let i = 0; i < samples.length; i++) {
        const y = runChain(chain, samples[i]);
        s += y * y;
      }
      sums[b] += s;
    }
    let s = 0;
    for (let i = 0; i < samples.length; i++) s += samples[i] * samples[i];
    this.fullSum += s;
    this.count += samples.length;
  }

  /** Levels for a frame `dt` seconds after the previous one. */
  // @per-frame
  read(dt: number): BandReading {
    const o = this.options;
    const n = this.ranges.length;
    // A frame with no new audio repeats the last level rather than reading silence.
    if (this.count > 0) {
      for (let b = 0; b < n; b++) this.power[b] = this.sums[b] / this.count;
      this.fullPower = this.fullSum / this.count;
    }
    this.sums.fill(0);
    this.fullSum = 0;
    this.count = 0;
    let loudest = -Infinity;
    for (let b = 0; b < n; b++) {
      this.ranges[b].track(this.power[b], dt, o);
      loudest = Math.max(loudest, this.ranges[b].peakDb - this.specs[b].shareDb);
    }
    for (let b = 0; b < n; b++) {
      const r = this.ranges[b];
      const spec = this.specs[b];
      const top = Math.max(r.peakDb, loudest + spec.shareDb + o.couplingDb, r.noiseTopDb(spec.noiseHeadroomDb), o.absoluteFloorDb);
      this.reading.values[b] = r.output(top, dt, o);
      this.reading.db[b] = 10 * Math.log10(Math.max(this.power[b], 1e-20));
    }
    const f = this.full;
    f.track(this.fullPower, dt, o);
    this.reading.level = f.output(Math.max(f.peakDb, f.noiseTopDb(FULL_NOISE_HEADROOM_DB), o.absoluteFloorDb), dt, o);
    return this.reading;
  }
}
