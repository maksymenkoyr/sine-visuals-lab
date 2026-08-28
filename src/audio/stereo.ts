/**
 * Time-domain stereo analysis — the other category of data
 * src/audio/analyser.ts never captures, alongside waveform.ts's time-domain
 * mono measurements. Deliberately reads getFloatTimeDomainData only, never
 * getFloatFrequencyData: an FFT is not needed for width/balance/correlation,
 * so this adds no transform work on top of the buffer copy either channel's
 * AnalyserNode already has to do.
 *
 * deriveStereoRead is the pure math (testable without an AudioContext, same
 * split as analyser.ts wrapping the Web Audio node and features.ts holding
 * the math); createStereoAnalyser is the thin node-wrapping factory that
 * feeds it real samples every tick.
 */

// Below this combined L/R rms there's nothing to measure — same reasoning as
// waveform.ts's SILENCE_RMS, applied to the mid/side pair so a silent buffer
// reports 0 width and 0 balance instead of a 0/0 NaN.
const SILENCE_RMS = 1e-6;

export interface StereoRead {
  /** False for a source the graph reports as carrying a single channel (see
   *  createStereoAnalyser) — width/balance/correlation would just be
   *  measurement noise on a channel duplicated by the splitter, not a real
   *  stereo signal, so they're held at their mono defaults instead. This is
   *  "the source declared itself mono," not "the two channels happen to
   *  currently be identical" — a real stereo source playing a mono sample
   *  still reports hasStereo: true and simply reads as width 0. */
  hasStereo: boolean;
  /** (L+R)/2 — the mono mix this device's waveform scope draws regardless of
   *  channel count. Same buffer identity across reads; copy before holding. */
  mono: Float32Array;
  /** -1 (all left) .. 0 (centered) .. +1 (all right), from each channel's rms. */
  balance: number;
  /** 0 (mono/centered content) .. 1 (fully wide/out-of-phase content) —
   *  rmsSide / (rmsMid + rmsSide), the side channel's share of the mix. */
  width: number;
  /** -1 (fully out of phase) .. +1 (fully in phase), normalized L/R
   *  correlation. A mono source reports +1 (trivially, perfectly
   *  correlated with itself) rather than an undefined 0/0. */
  correlation: number;
}

/** Pure derivation from raw L/R sample buffers — same length, one audio
 *  block. `right` may be null for a declared-mono source (see hasStereo);
 *  `mono` is written into the caller-owned `monoOut` buffer (reused across
 *  calls, same pattern as analyser.ts's `bands` scratch array) rather than
 *  allocated here. */
export function deriveStereoRead(left: Float32Array, right: Float32Array | null, monoOut: Float32Array): StereoRead {
  const hasStereo = right !== null;
  const n = left.length;

  let sumL2 = 0;
  let sumR2 = 0;
  let sumLR = 0;
  let sumM2 = 0;
  let sumS2 = 0;

  for (let i = 0; i < n; i++) {
    const l = left[i];
    const r = hasStereo ? right![i] : l;
    const m = (l + r) * 0.5;
    const s = (l - r) * 0.5;
    monoOut[i] = m;
    sumL2 += l * l;
    sumR2 += r * r;
    sumLR += l * r;
    sumM2 += m * m;
    sumS2 += s * s;
  }

  const rmsL = Math.sqrt(sumL2 / n);
  const rmsR = Math.sqrt(sumR2 / n);
  const rmsM = Math.sqrt(sumM2 / n);
  const rmsS = Math.sqrt(sumS2 / n);

  const balance = hasStereo && rmsL + rmsR > SILENCE_RMS ? (rmsR - rmsL) / (rmsR + rmsL) : 0;
  const width = hasStereo && rmsM + rmsS > SILENCE_RMS ? rmsS / (rmsM + rmsS) : 0;
  const correlation = hasStereo
    ? sumL2 + sumR2 > SILENCE_RMS
      ? sumLR / (Math.sqrt(sumL2 * sumR2) + SILENCE_RMS)
      : 0
    : 1; // mono: a channel is trivially perfectly correlated with itself

  return { hasStereo, mono: monoOut, balance, width, correlation };
}

export interface StereoAnalyser {
  read(): StereoRead;
}

/**
 * Splits sourceNode into two channels and reads both via
 * getFloatTimeDomainData. hasStereo is read once, from sourceNode.channelCount
 * — for a MediaStreamAudioSourceNode this reflects the underlying track's own
 * channel count (default channelCountMode "max"), so this is "does the
 * source carry two channels," not a live per-frame check. Good enough for a
 * mic (always mono) vs. tab/device audio (often stereo) without needing the
 * full CaptureHandle just to inspect its MediaStream.
 */
export function createStereoAnalyser(context: AudioContext, sourceNode: AudioNode, fftSize = 2048): StereoAnalyser {
  const hasStereo = sourceNode.channelCount >= 2;

  const splitter = context.createChannelSplitter(2);
  // Analysis tap only, same feedback guard as analyser.ts: never connect
  // toward context.destination.
  sourceNode.connect(splitter);

  const left = context.createAnalyser();
  left.fftSize = fftSize;
  splitter.connect(left, 0);

  let right: AnalyserNode | null = null;
  if (hasStereo) {
    right = context.createAnalyser();
    right.fftSize = fftSize;
    splitter.connect(right, 1);
  }

  const leftBuf = new Float32Array(left.fftSize);
  const rightBuf = hasStereo ? new Float32Array(fftSize) : null;
  const monoBuf = new Float32Array(left.fftSize);

  return {
    read(): StereoRead {
      left.getFloatTimeDomainData(leftBuf);
      if (right && rightBuf) right.getFloatTimeDomainData(rightBuf);
      return deriveStereoRead(leftBuf, rightBuf, monoBuf);
    },
  };
}
