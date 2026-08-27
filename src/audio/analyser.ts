import { NUM_BANDS } from "./types.ts";
import { MAX_HZ_CAP, bandEdgesHz } from "./bandScale.ts";

export interface BandAnalyser {
  node: AnalyserNode;
  /** Raw per-band magnitude in dB (unnormalized), low band -> high band. */
  readBandsDb(): Float32Array;
  /** This band ladder's actual Hz edges (length NUM_BANDS + 1), against this
   *  context's real sample rate — not the nominal 40Hz-16kHz ceiling, since a
   *  phone mic context can run well below 32kHz. For UI axis labels. */
  bandEdgesHz: Float32Array;
  /** node.minDecibels/maxDecibels — the fixed floor/ceiling readBandsDb() is
   *  clamped to. For normalizing raw dB straight to [0,1] with no adaptive
   *  envelope, e.g. a "before any processing" display. */
  dbRange: { min: number; max: number };
}

/**
 * Wraps an AnalyserNode and folds its linear FFT bins into NUM_BANDS
 * log-spaced bands (music perception and mixing are log-frequency).
 */
export function createBandAnalyser(
  context: AudioContext,
  sourceNode: AudioNode,
  fftSize = 2048,
): BandAnalyser {
  const node = context.createAnalyser();
  node.fftSize = fftSize;
  // We do our own attack/release smoothing in features.ts; disable the
  // built-in one so it doesn't fight our envelope logic.
  node.smoothingTimeConstant = 0;
  node.minDecibels = -100;
  node.maxDecibels = -10;

  // Analysis tap only. Never connect to context.destination — routing a
  // live mic to room speakers would create audible feedback.
  sourceNode.connect(node);

  const binCount = node.frequencyBinCount;
  const freqData = new Float32Array(binCount);
  const nyquist = context.sampleRate / 2;
  const binHz = nyquist / binCount;
  const maxHz = Math.min(MAX_HZ_CAP, nyquist - binHz);

  const edgesHz = bandEdgesHz(maxHz);
  const binEdges = new Int32Array(NUM_BANDS + 1);
  for (let i = 0; i <= NUM_BANDS; i++) {
    binEdges[i] = Math.min(binCount - 1, Math.max(0, Math.round(edgesHz[i] / binHz)));
  }

  const bands = new Float32Array(NUM_BANDS);

  return {
    node,
    bandEdgesHz: edgesHz,
    dbRange: { min: node.minDecibels, max: node.maxDecibels },
    readBandsDb(): Float32Array {
      node.getFloatFrequencyData(freqData);
      for (let b = 0; b < NUM_BANDS; b++) {
        const lo = binEdges[b];
        const hi = Math.max(lo + 1, binEdges[b + 1]);
        let sum = 0;
        for (let i = lo; i < hi; i++) sum += freqData[i];
        bands[b] = sum / (hi - lo);
      }
      return bands;
    },
  };
}
