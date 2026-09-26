import { NUM_BANDS } from "../../src/audio/types.ts";
import { MAX_HZ_CAP, bandEdgesHz } from "../../src/audio/bandScale.ts";

/**
 * Offline mirror of src/audio/analyser.ts's readBandsDb() for a plain
 * Float32Array buffer instead of a live AnalyserNode — same Blackman window,
 * same radix-2 FFT magnitude-to-dB mapping, same band-edge rounding (via the
 * shared bandEdgesHz()/MAX_HZ_CAP), so tests/tempoEval/run.ts feeds the real
 * FeatureExtractor exactly the numbers a live mic would have produced for
 * this same audio.
 */

const FFT_SIZE = 2048;
const LOG2_FFT_SIZE = Math.log2(FFT_SIZE);

// ---- Blackman window (a0=0.42, a1=0.5, a2=0.08), precomputed once. ----
const WINDOW = new Float32Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) {
  WINDOW[i] = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (FFT_SIZE - 1));
}

// ---- Preallocated radix-2 iterative FFT (bit-reversal + twiddle tables built once). ----
const BIT_REV = new Uint32Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) {
  let x = i;
  let r = 0;
  for (let b = 0; b < LOG2_FFT_SIZE; b++) {
    r = (r << 1) | (x & 1);
    x >>= 1;
  }
  BIT_REV[i] = r;
}
const COS_TABLE = new Float32Array(FFT_SIZE / 2);
const SIN_TABLE = new Float32Array(FFT_SIZE / 2);
for (let i = 0; i < FFT_SIZE / 2; i++) {
  const angle = (-2 * Math.PI * i) / FFT_SIZE;
  COS_TABLE[i] = Math.cos(angle);
  SIN_TABLE[i] = Math.sin(angle);
}

/** In-place decimation-in-time FFT over `re`/`im`, both length FFT_SIZE. */
function fft(re: Float32Array, im: Float32Array): void {
  for (let i = 0; i < FFT_SIZE; i++) {
    const j = BIT_REV[i]!;
    if (j > i) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let size = 2; size <= FFT_SIZE; size *= 2) {
    const half = size / 2;
    const tableStep = FFT_SIZE / size;
    for (let start = 0; start < FFT_SIZE; start += size) {
      for (let k = 0; k < half; k++) {
        const c = COS_TABLE[k * tableStep]!;
        const s = SIN_TABLE[k * tableStep]!;
        const aRe = re[start + k]!;
        const aIm = im[start + k]!;
        const bRe = re[start + k + half]!;
        const bIm = im[start + k + half]!;
        const twRe = bRe * c - bIm * s;
        const twIm = bRe * s + bIm * c;
        re[start + k] = aRe + twRe;
        im[start + k] = aIm + twIm;
        re[start + k + half] = aRe - twRe;
        im[start + k + half] = aIm - twIm;
      }
    }
  }
}

// Scratch buffers, reused across calls (no per-frame allocation — this runs
// once per synthesized frame per track).
const reBuf = new Float32Array(FFT_SIZE);
const imBuf = new Float32Array(FFT_SIZE);

// Bin-edge table is keyed by sample rate the same way analyser.ts derives it
// (against the real nyquist, not the nominal ceiling) — cached since this
// harness only ever runs at one SR, but keyed just in case.
let cachedSr = -1;
let cachedBinCount = 0;
let cachedBinEdges: Int32Array | null = null;

function binEdgesFor(sr: number): { binCount: number; binEdges: Int32Array } {
  if (sr === cachedSr && cachedBinEdges) return { binCount: cachedBinCount, binEdges: cachedBinEdges };
  const binCount = FFT_SIZE / 2;
  const nyquist = sr / 2;
  const binHz = nyquist / binCount;
  const maxHz = Math.min(MAX_HZ_CAP, nyquist - binHz);
  const edgesHz = bandEdgesHz(maxHz);
  const binEdges = new Int32Array(NUM_BANDS + 1);
  for (let i = 0; i <= NUM_BANDS; i++) {
    binEdges[i] = Math.min(binCount - 1, Math.max(0, Math.round(edgesHz[i]! / binHz)));
  }
  cachedSr = sr;
  cachedBinCount = binCount;
  cachedBinEdges = binEdges;
  return { binCount, binEdges };
}

/** Per-band FFT magnitude in dB (unnormalized, like analyser.ts's own
 *  readBandsDb) at frame time `tSec`, over the most recent FFT_SIZE samples
 *  of `mono` ending at round(tSec*sr) — samples before index 0 read as zero.
 *  -Infinity (true silence in a band) is left as-is; FeatureExtractor
 *  sanitizes it, same as a live analyser's output. */
export function readBandsDb(mono: Float32Array, tSec: number, sr: number): Float32Array {
  const { binEdges } = binEdgesFor(sr);
  const end = Math.round(tSec * sr);
  const start = end - FFT_SIZE + 1;
  for (let i = 0; i < FFT_SIZE; i++) {
    const idx = start + i;
    const s = idx >= 0 && idx < mono.length ? mono[idx]! : 0;
    reBuf[i] = s * WINDOW[i]!;
    imBuf[i] = 0;
  }
  fft(reBuf, imBuf);

  const bands = new Float32Array(NUM_BANDS);
  for (let b = 0; b < NUM_BANDS; b++) {
    const lo = binEdges[b]!;
    const hi = Math.max(lo + 1, binEdges[b + 1]!);
    let sum = 0;
    for (let k = lo; k < hi; k++) {
      const mag = Math.hypot(reBuf[k]!, imBuf[k]!) / FFT_SIZE;
      sum += 20 * Math.log10(mag);
    }
    bands[b] = sum / (hi - lo);
  }
  return bands;
}
