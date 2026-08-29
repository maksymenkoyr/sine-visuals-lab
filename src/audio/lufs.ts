/**
 * Loudness per ITU-R BS.1770-4 / EBU R128, in LUFS — the pure math, no
 * AudioContext involved (same split as waveform.ts / waveformAnalyser.ts:
 * the node-wrapping half is lufsAnalyser.ts). Written from the spec:
 *
 *  - K-weighting: a high-shelf (BS1770_SHELF_48K) then a high-pass
 *    (BS1770_HIGHPASS_48K), both given by the spec as biquad tables at
 *    BS1770_RATE_HZ only. kWeightingCoefficients() re-discretises those
 *    tables for whatever rate the device's AudioContext actually runs at —
 *    see resampleBiquad for how — rather than reaching for a textbook shelf
 *    formula, which doesn't reproduce the spec's table.
 *  - Mean-square of the K-weighted signal over BLOCK_MS blocks; Momentary
 *    is the last MOMENTARY_BLOCKS of them, Short-term the last
 *    SHORT_TERM_BLOCKS. LUFS = LUFS_OFFSET + 10·log10(mean square).
 *  - Integrated: every closed block also completes a gating block (the
 *    spec's 400 ms window at 100 ms hop). Blocks below ABSOLUTE_GATE_LUFS
 *    are dropped outright; the rest go into a histogram, and the reading is
 *    the mean power of the blocks no more than RELATIVE_GATE_LU below the
 *    mean of everything that passed the absolute gate. A histogram (per-bin
 *    count plus per-bin power sum, so the mean isn't bin-centred) keeps
 *    memory flat over a long session instead of growing a block list.
 *
 * Single-channel with weight 1, which is exact for a phone/laptop mic. The
 * AnalyserNode feeding this downmixes stereo display audio to (L+R)/2, so a
 * stereo source reads 3–6 dB low against a true two-channel BS.1770 sum —
 * documented here, not corrected.
 *
 * Display-only: the reading lives in the controls panel's Loudness card and
 * never reaches FeatureFrame, the wire frame, or Auto mode's `loudness`
 * dial (musicProfile.ts — an unrelated [0,1] dial eased from
 * FeatureFrame.level, which is why nothing here is named "loudness").
 */

export interface BiquadCoefficients {
  b: [number, number, number];
  /** a[0] is always 1. */
  a: [number, number, number];
}

export interface KWeighting {
  shelf: BiquadCoefficients;
  highpass: BiquadCoefficients;
}

/** The sample rate the spec's tables below are given at. */
export const BS1770_RATE_HZ = 48000;

export const BS1770_SHELF_48K: BiquadCoefficients = {
  b: [1.53512485958697, -2.69169618940638, 1.19839281085285],
  a: [1, -1.69065929318241, 0.73248077421585],
};

export const BS1770_HIGHPASS_48K: BiquadCoefficients = {
  b: [1, -2, 1],
  a: [1, -1.99004745483398, 0.99007225036621],
};

export const LUFS_OFFSET = -0.691;
export const BLOCK_MS = 100;
export const MOMENTARY_BLOCKS = 4; // 400 ms
export const SHORT_TERM_BLOCKS = 30; // 3 s
export const ABSOLUTE_GATE_LUFS = -70;
export const RELATIVE_GATE_LU = -10;

// Gating-block histogram: from the absolute gate up to a ceiling a full-scale
// K-weighted square wave can't quite reach; anything above clamps to the top
// bin. Resolution well under the spec's ±0.1 LU tolerance.
const HISTOGRAM_LO_LUFS = ABSOLUTE_GATE_LUFS;
const HISTOGRAM_HI_LUFS = 10;
const HISTOGRAM_STEP_LU = 0.1;
const HISTOGRAM_BINS = Math.round((HISTOGRAM_HI_LUFS - HISTOGRAM_LO_LUFS) / HISTOGRAM_STEP_LU) + 1;

/**
 * Re-discretise a biquad designed (by bilinear transform) at one sample rate
 * for another. In x = s/(2·fs), a biquad's bilinear image is the rational
 * function N(x)/D(x) with N(x) = (b0+b1+b2) + 2(b0−b2)·x + (b0−b1+b2)·x²
 * (D likewise from the a's). Changing the rate by `ratio` = fsNew/fsOld
 * rescales x, so evaluating N at ratio·x and mapping back through
 * x = (1−z⁻¹)/(1+z⁻¹) gives the new table in closed form. At ratio 1 this
 * is the identity; elsewhere it keeps the spec's own frequency response
 * (pre-warp included) rather than a re-derivation that wouldn't match it.
 */
export function resampleBiquad(c: BiquadCoefficients, ratio: number): BiquadCoefficients {
  function image(k: [number, number, number]): [number, number, number] {
    const [k0, k1, k2] = k;
    return [k0 + k1 + k2, 2 * (k0 - k2) * ratio, (k0 - k1 + k2) * ratio * ratio];
  }
  function back(p: [number, number, number]): [number, number, number] {
    const [p0, p1, p2] = p;
    return [p0 + p1 + p2, 2 * (p0 - p2), p0 - p1 + p2];
  }
  const b = back(image(c.b));
  const a = back(image(c.a));
  const norm = a[0];
  return {
    b: [b[0] / norm, b[1] / norm, b[2] / norm],
    a: [1, a[1] / norm, a[2] / norm],
  };
}

export function kWeightingCoefficients(sampleRate: number): KWeighting {
  const ratio = sampleRate / BS1770_RATE_HZ;
  return {
    shelf: resampleBiquad(BS1770_SHELF_48K, ratio),
    highpass: resampleBiquad(BS1770_HIGHPASS_48K, ratio),
  };
}

/** Direct-form biquad over a whole buffer, from rest. For tests and any
 *  path that can't use a native IIRFilterNode — the live meter runs the
 *  filters in the audio graph (lufsAnalyser.ts), not here. */
export function biquad(samples: Float32Array, c: BiquadCoefficients): Float32Array {
  const out = new Float32Array(samples.length);
  const [b0, b1, b2] = c.b;
  const [, a1, a2] = c.a;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
}

/** |H(e^jω)| of a biquad at `hz`, in dB — for checking a table's response. */
export function magnitudeDb(c: BiquadCoefficients, hz: number, sampleRate: number): number {
  const w = (2 * Math.PI * hz) / sampleRate;
  // Evaluate numerator and denominator at z⁻¹ = e^(−jω).
  function evalPoly(k: [number, number, number]): [number, number] {
    let re = 0;
    let im = 0;
    for (let n = 0; n < 3; n++) {
      re += k[n] * Math.cos(-n * w);
      im += k[n] * Math.sin(-n * w);
    }
    return [re, im];
  }
  const [nr, ni] = evalPoly(c.b);
  const [dr, di] = evalPoly(c.a);
  const mag = Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
  return 20 * Math.log10(mag);
}

export interface LufsReading {
  /** Last MOMENTARY_BLOCKS, in LUFS; −Infinity until that window has filled
   *  or when it's silent. */
  momentary: number;
  /** Last SHORT_TERM_BLOCKS, same convention. */
  shortTerm: number;
  /** Gated, since the last reset(); −Infinity while no block has passed
   *  the absolute gate. */
  integrated: number;
}

export interface LufsMeter {
  /** Feed K-weighted samples, starting at index `from` (so a caller holding
   *  a larger buffer can hand over just its tail). */
  push(samples: Float32Array, from?: number): void;
  read(): LufsReading;
  /** Starts the integrated reading over; momentary/short-term keep running. */
  reset(): void;
}

function toLufs(meanSquare: number): number {
  return meanSquare > 0 ? LUFS_OFFSET + 10 * Math.log10(meanSquare) : -Infinity;
}

export function createLufsMeter(sampleRate: number): LufsMeter {
  const blockSamples = Math.max(1, Math.round((sampleRate * BLOCK_MS) / 1000));

  // The block being accumulated.
  let blockSum = 0;
  let blockCount = 0;

  // Ring of closed-block mean squares — newest just before `head`.
  const ring = new Float64Array(SHORT_TERM_BLOCKS);
  let head = 0;
  let filled = 0;

  // Gating-block histogram for Integrated.
  const binCount = new Uint32Array(HISTOGRAM_BINS);
  const binPower = new Float64Array(HISTOGRAM_BINS);
  let gatedCount = 0;
  let gatedPower = 0;

  function meanOfLast(n: number): number {
    let sum = 0;
    for (let i = 1; i <= n; i++) sum += ring[(head - i + SHORT_TERM_BLOCKS) % SHORT_TERM_BLOCKS];
    return sum / n;
  }

  function closeBlock(): void {
    ring[head] = blockSum / blockSamples;
    head = (head + 1) % SHORT_TERM_BLOCKS;
    filled = Math.min(filled + 1, SHORT_TERM_BLOCKS);
    blockSum = 0;
    blockCount = 0;

    if (filled < MOMENTARY_BLOCKS) return;
    const power = meanOfLast(MOMENTARY_BLOCKS);
    const lufs = toLufs(power);
    if (lufs < ABSOLUTE_GATE_LUFS) return;
    const bin = Math.min(HISTOGRAM_BINS - 1, Math.round((lufs - HISTOGRAM_LO_LUFS) / HISTOGRAM_STEP_LU));
    binCount[bin]++;
    binPower[bin] += power;
    gatedCount++;
    gatedPower += power;
  }

  function integrated(): number {
    if (gatedCount === 0) return -Infinity;
    const threshold = toLufs(gatedPower / gatedCount) + RELATIVE_GATE_LU;
    const firstBin = Math.max(0, Math.ceil((threshold - HISTOGRAM_LO_LUFS) / HISTOGRAM_STEP_LU));
    let count = 0;
    let power = 0;
    for (let i = firstBin; i < HISTOGRAM_BINS; i++) {
      count += binCount[i];
      power += binPower[i];
    }
    return count === 0 ? -Infinity : toLufs(power / count);
  }

  return {
    push(samples, from = 0): void {
      for (let i = from; i < samples.length; i++) {
        const v = samples[i];
        blockSum += v * v;
        if (++blockCount === blockSamples) closeBlock();
      }
    },
    read(): LufsReading {
      return {
        momentary: filled >= MOMENTARY_BLOCKS ? toLufs(meanOfLast(MOMENTARY_BLOCKS)) : -Infinity,
        shortTerm: filled >= SHORT_TERM_BLOCKS ? toLufs(meanOfLast(SHORT_TERM_BLOCKS)) : -Infinity,
        integrated: integrated(),
      };
    },
    reset(): void {
      binCount.fill(0);
      binPower.fill(0);
      gatedCount = 0;
      gatedPower = 0;
    },
  };
}
