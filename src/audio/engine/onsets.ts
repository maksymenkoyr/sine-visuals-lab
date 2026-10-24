// The onset envelope everything rhythmic is built on: a short-time spectrum
// every HOP samples, grouped into third-octave bands, log-compressed against
// the input's own level and each band's noise floor, and differenced against
// the recent maximum (positive flux). Reading the level first makes a far mic
// and a line-in produce the same envelope; the floor keeps steady room noise,
// hum and held notes out of it. Hits are peaks of the whole attack's rise
// across all bands over a running threshold. Each is named by where its rising
// energy sits on a log-frequency axis, against three running cluster centres
// (kick, snare, hat), so a laptop speaker that moves every kick up into the
// low mids still names them kicks.
//
// Results leave through an OnsetSink as they happen, so a hop allocates
// nothing. Besides the hits, every hop reports its rise against the threshold
// (the Hits card's lanes and the Onset surge signal) and which kind that rise
// is nearest — the naming rule without moving a cluster, since only a hit may
// move one.

import { Fft } from "./fft.ts";

export const FRAME = 1024;
export const HOP = 256;

export type HitKind = "kick" | "snare" | "hat";
export const HIT_KINDS: readonly HitKind[] = ["kick", "snare", "hat"];

/** A hit's strength is how far its peak cleared the threshold: 1 at the threshold, at most this. */
export const HIT_STRENGTH_MAX = 4;

export interface OnsetSink {
  /** One envelope sample: total flux plus the lows' share of it, stamped on the audio clock. */
  envelope(time: number, flux: number, low: number): void;
  hit(time: number, kind: HitKind, strength: number): void;
  /**
   * Every hop: its rise over the threshold (1 = at it), the kind that rise is
   * nearest, and whether the hop before peaked over the threshold inside the
   * refractory (a hit that was blocked rather than missed).
   */
  rise(ratio: number, kind: HitKind, blocked: boolean): void;
}

/** Third-octave band edges from here up; bands narrower than a bin merge with their neighbour. */
const LOWEST_HZ = 30;
const HIGHEST_HZ = 16000;
/** Bands whose centre is below this count as lows, for downbeats. */
const LOW_HZ = 160;
/** Input level is a LEVEL_SHORT_S power average, held with a LEVEL_RELEASE_S fall. */
const LEVEL_SHORT_S = 0.3;
const LEVEL_RELEASE_S = 10;
/** The log's knee sits this far under the input level, so the same hit reads the same at any gain. */
const LEVEL_KNEE = 0.002;
/** Inputs quieter than this are not boosted further: digital silence must stay silent. */
const LEVEL_FLOOR_RMS = 10 ** (-70 / 20);
/** Each band's floor is the minimum of its NOISE_SMOOTH_S-smoothed magnitude over NOISE_WINDOW_S. */
const NOISE_SMOOTH_S = 0.5;
const NOISE_WINDOW_S = 6;
const NOISE_SLICES = 4;
/** No band's knee sits lower than this ratio above its own floor. */
const NOISE_KNEE = 4;
/**
 * The envelope's flux is measured against each band's maximum over this many previous hops, so an
 * echo arriving a little after its hit can't rise past it. Hits instead measure the rise from
 * the minimum over the same hops: an attack spreads over the window's slide, and only the whole
 * rise tells a kick from a bass note's wobble.
 */
const FLUX_REF_HOPS = 4;
/** Added to every stamp; with it, beats on clean synthetic tracks land on their true times. */
const STAMP_OFFSET_S = 0.004;

export interface HitOptions {
  /** A hit's rise clears its running mean plus this many deviations... */
  k: number;
  /** ...and this much rise, summed over bands. */
  min: number;
}

export const HIT_DEFAULTS: HitOptions = { k: 2, min: 4 };

/** Where each kind's cluster centre starts and the range it may wander in, in Hz. */
const CLUSTERS: Record<HitKind, { start: number; range: readonly [number, number] }> = {
  kick: { start: 150, range: [40, 1000] },
  snare: { start: 1500, range: [300, 6000] },
  hat: { start: 8000, range: [3000, 16000] },
};
/** Share of the way a cluster centre moves towards each hit it names. */
const CLUSTER_RATE = 0.05;
/** Seconds the hit threshold's running mean and deviation cover. */
const HIT_STATS_S = 1;
/** Shorter than a 16th at 180 BPM: drum & bass puts a kick and a snare that close. */
export const REFRACTORY_S = 0.06;

/** Peak picking on the summed rise: a local maximum over a running threshold. */
class Picker {
  private prev2 = 0;
  private prev1 = 0;
  private prevTime = 0;
  private mean = 0;
  private dev = 0;
  private last = -Infinity;
  /** Time of the hop the last non-zero step() reported. */
  peakTime = 0;
  /** This hop's rise over the threshold it was judged against. */
  ratio = 0;
  /** The previous hop peaked over the threshold but inside the refractory. */
  blocked = false;
  private readonly min: number;
  private readonly k: number;
  constructor(min: number, k: number) {
    this.min = min;
    this.k = k;
  }

  /** Feeds a hop's value; returns the previous hop's strength if it peaked over the threshold, else 0. */
  step(flux: number, time: number, hopSec: number): number {
    const threshold = Math.max(this.min, this.mean + this.k * this.dev);
    let strength = 0;
    const peaked = this.prev1 > this.prev2 && this.prev1 >= flux && this.prev1 > threshold;
    this.blocked = peaked && this.prevTime - this.last < REFRACTORY_S;
    if (peaked && !this.blocked) {
      strength = Math.min(HIT_STRENGTH_MAX, this.prev1 / threshold);
      this.last = this.peakTime = this.prevTime;
    }
    this.ratio = flux / threshold;
    const a = Math.min(1, hopSec / HIT_STATS_S);
    this.mean += (flux - this.mean) * a;
    this.dev += (Math.abs(flux - this.mean) - this.dev) * a;
    this.prev2 = this.prev1;
    this.prev1 = flux;
    this.prevTime = time;
    return strength;
  }
}

interface Band {
  lo: number;
  hi: number;
  smooth: number;
  sliceMin: number;
  slices: number[];
  prev: Float64Array;
  /** Band power over the same hops as `prev`. */
  prevPower: Float64Array;
  isLow: boolean;
  /** log2 of the band's centre frequency. */
  octave: number;
}

export class OnsetDetector {
  readonly sampleRate: number;
  /** Envelope samples per second. */
  readonly rate: number;
  private readonly sink: OnsetSink;
  private readonly fft = new Fft(FRAME);
  private readonly window = new Float64Array(FRAME);
  private readonly ring = new Float32Array(FRAME);
  private ringPos = 0;
  private sinceHop = 0;
  private readonly re = new Float64Array(FRAME);
  private readonly im = new Float64Array(FRAME);
  private readonly bands: Band[] = [];
  private prevPos = 0;
  private hopPower = 0;
  private shortPower = 0;
  private heldPower = 0;
  private sliceHops = 0;
  private readonly hopsPerSlice: number;
  private samplesIn = 0;
  private anchorSample = 0;
  private anchorTime = 0;
  private readonly picker: Picker;
  private centre = 0;
  private prevCentre = 0;
  private readonly clusters: Record<HitKind, number> = {
    kick: Math.log2(CLUSTERS.kick.start),
    snare: Math.log2(CLUSTERS.snare.start),
    hat: Math.log2(CLUSTERS.hat.start),
  };

  constructor(sampleRate: number, sink: OnsetSink, hits: Partial<HitOptions> = {}) {
    const h = { ...HIT_DEFAULTS, ...hits };
    this.picker = new Picker(h.min, h.k);
    this.sink = sink;
    this.sampleRate = sampleRate;
    this.rate = sampleRate / HOP;
    for (let i = 0; i < FRAME; i++) this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME);
    const binHz = sampleRate / FRAME;
    const top = Math.min(HIGHEST_HZ, sampleRate / 2 - binHz);
    let lo = Math.max(1, Math.round(LOWEST_HZ / binHz));
    for (let hz = LOWEST_HZ * 2 ** (1 / 3); ; hz *= 2 ** (1 / 3)) {
      const hi = Math.min(Math.round(Math.min(hz, top) / binHz), FRAME / 2);
      if (hz >= top && hi <= lo) break;
      if (hi <= lo) continue;
      const centre = ((lo + hi) / 2) * binHz;
      this.bands.push({
        lo,
        hi,
        smooth: -1,
        sliceMin: Infinity,
        slices: [],
        prev: new Float64Array(FLUX_REF_HOPS),
        prevPower: new Float64Array(FLUX_REF_HOPS),
        isLow: centre < LOW_HZ,
        octave: Math.log2(centre),
      });
      lo = hi;
    }
    this.hopsPerSlice = Math.max(1, Math.round((NOISE_WINDOW_S / NOISE_SLICES) * this.rate));
  }

  /** Mono samples whose first one was captured at `time`. */
  // @per-frame
  push(samples: Float32Array, time: number): void {
    this.anchorSample = this.samplesIn;
    this.anchorTime = time;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      this.ring[this.ringPos] = s;
      this.ringPos = (this.ringPos + 1) % FRAME;
      this.hopPower += s * s;
      this.samplesIn++;
      if (++this.sinceHop === HOP) {
        this.sinceHop = 0;
        // A part-empty first frame would seed every band's floor far too low.
        if (this.samplesIn >= FRAME) this.analyse();
      }
    }
  }

  private nearest(octave: number): HitKind {
    let kind: HitKind = "kick";
    for (const k of HIT_KINDS) if (Math.abs(octave - this.clusters[k]) < Math.abs(octave - this.clusters[kind])) kind = k;
    return kind;
  }

  /** The kind whose cluster centre is nearest `octave`, which then moves that centre towards it. */
  private name(octave: number): HitKind {
    const kind = this.nearest(octave);
    const [lo, hi] = CLUSTERS[kind].range;
    const c = this.clusters[kind] + (octave - this.clusters[kind]) * CLUSTER_RATE;
    this.clusters[kind] = Math.min(Math.log2(hi), Math.max(Math.log2(lo), c));
    return kind;
  }

  private timeOfSample(index: number): number {
    return this.anchorTime + (index - this.anchorSample) / this.sampleRate;
  }

  private analyse(): void {
    const { re, im, window, ring } = this;
    for (let i = 0; i < FRAME; i++) {
      re[i] = ring[(this.ringPos + i) % FRAME] * window[i];
      im[i] = 0;
    }
    this.fft.transform(re, im);

    const hopSec = HOP / this.sampleRate;
    this.shortPower += (this.hopPower / HOP - this.shortPower) * Math.min(1, hopSec / LEVEL_SHORT_S);
    this.hopPower = 0;
    this.heldPower = Math.max(this.shortPower, this.heldPower * Math.exp(-hopSec / LEVEL_RELEASE_S));
    const levelKnee = Math.max(Math.sqrt(this.heldPower), LEVEL_FLOOR_RMS) * LEVEL_KNEE;
    const noiseA = Math.min(1, hopSec / NOISE_SMOOTH_S);
    const newSlice = ++this.sliceHops >= this.hopsPerSlice;
    if (newSlice) this.sliceHops = 0;

    // Sinusoid amplitude A reads A: a Hann window's coherent gain is FRAME / 4.
    const scale = 4 / FRAME;
    let flux = 0;
    let low = 0;
    let rises = 0;
    let energy = 0;
    let weighted = 0;
    for (const b of this.bands) {
      let p = 0;
      for (let k = b.lo; k < b.hi; k++) p += re[k] * re[k] + im[k] * im[k];
      const mag = Math.sqrt(p / (b.hi - b.lo)) * scale;
      b.smooth = b.smooth < 0 ? mag : b.smooth + (mag - b.smooth) * noiseA;
      b.sliceMin = Math.min(b.sliceMin, b.smooth);
      let floor = b.sliceMin;
      for (const s of b.slices) floor = Math.min(floor, s);
      if (newSlice) {
        b.slices.push(b.sliceMin);
        if (b.slices.length > NOISE_SLICES) b.slices.shift();
        b.sliceMin = Infinity;
      }
      const level = Math.log1p(mag / Math.max(levelKnee, NOISE_KNEE * floor));
      let ref = 0;
      let base = Infinity;
      let basePower = Infinity;
      for (let j = 0; j < FLUX_REF_HOPS; j++) {
        ref = Math.max(ref, b.prev[j]);
        base = Math.min(base, b.prev[j]);
        basePower = Math.min(basePower, b.prevPower[j]);
      }
      b.prev[this.prevPos] = level;
      b.prevPower[this.prevPos] = p;
      const d = Math.max(0, level - ref);
      flux += d;
      rises += Math.max(0, level - base);
      // Naming weighs bands by how much energy rose, not by their log rise: a kick's click lifts
      // every band's log a little, but nearly all the energy it adds is in the lows.
      const gained = Math.max(0, p - basePower);
      energy += gained;
      weighted += gained * b.octave;
      if (b.isLow) low += d;
    }
    this.prevPos = (this.prevPos + 1) % FLUX_REF_HOPS;

    const centre = this.samplesIn - FRAME / 2;
    const time = this.timeOfSample(centre) + STAMP_OFFSET_S;
    this.sink.envelope(time, flux, flux > 0 ? low / flux : 0);
    // The picker reports the previous hop, so that hop's centre is the one named.
    this.prevCentre = this.centre;
    this.centre = energy > 0 ? weighted / energy : 0;
    const strength = this.picker.step(rises, time, hopSec);
    // Before naming: a hit moves its cluster, and this hop's rise is read against the clusters as they were.
    this.sink.rise(this.picker.ratio, this.nearest(this.centre), this.picker.blocked);
    if (strength > 0) this.sink.hit(this.picker.peakTime, this.name(this.prevCentre), strength);
  }
}
