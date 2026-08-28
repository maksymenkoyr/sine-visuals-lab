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
  /** False while the source has only ever carried one channel (see
   *  createStereoAnalyser for how that's decided) — width/balance/
   *  correlation would just be measurement noise on a channel duplicated by
   *  the splitter, not a real stereo signal, so they're held at their mono
   *  defaults instead. */
  hasStereo: boolean;
  /** (L+R)/2 — the mono mix this device's waveform scope draws regardless of
   *  channel count. Same buffer identity across reads; copy before holding. */
  mono: Float32Array;
  /** -1 (all left) .. 0 (centered) .. +1 (all right), from each channel's rms. */
  balance: number;
  /** 0 (mono/centered content) .. 1 (fully wide) — the side-to-mid rms
   *  ratio, clamped: 1 means as much side as mid, which is what uncorrelated
   *  or out-of-phase content produces. The ratio rather than side's share of
   *  the total (rmsS / (rmsM + rmsS)) because that squeezed ordinary stereo
   *  music into the bottom third of a meter. */
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
  const width = hasStereo && rmsM + rmsS > SILENCE_RMS ? Math.min(1, rmsS / (rmsM + SILENCE_RMS)) : 0;
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
 * getFloatTimeDomainData.
 *
 * Whether the source is stereo is decided in two layers, because neither
 * alone is reliable. sourceNode.channelCount is NOT the answer: on a
 * MediaStreamAudioSourceNode it's the node's own mixing setting (default 2)
 * whatever the track carries, so a mono mic reads as "stereo" with L and R
 * bit-identical — width pinned at 0, which is worse than saying mono.
 *  1. The track's own settings, when `stream` is given and the browser
 *     reports channelCount: a declared-mono track skips the right analyser
 *     entirely.
 *  2. Otherwise (or when the track claims two channels) a source is treated
 *     as mono until a read shows any side signal at all. Duplicated channels
 *     are bit-identical, so their side is exactly 0 — real stereo content
 *     flips this on its first non-silent buffer and it stays flipped. A
 *     mono-mastered file on a stereo track therefore also reads "mono",
 *     which is the honest answer.
 */
export function createStereoAnalyser(
  context: AudioContext,
  sourceNode: AudioNode,
  stream?: MediaStream,
  fftSize = 2048,
): StereoAnalyser {
  const trackChannels = stream?.getAudioTracks()[0]?.getSettings().channelCount;
  const declaredStereo = trackChannels === undefined || trackChannels >= 2;

  const splitter = context.createChannelSplitter(2);
  // Analysis tap only, same feedback guard as analyser.ts: never connect
  // toward context.destination.
  sourceNode.connect(splitter);

  const left = context.createAnalyser();
  left.fftSize = fftSize;
  splitter.connect(left, 0);

  let right: AnalyserNode | null = null;
  if (declaredStereo) {
    right = context.createAnalyser();
    right.fftSize = fftSize;
    splitter.connect(right, 1);
  }

  const leftBuf = new Float32Array(left.fftSize);
  const rightBuf = declaredStereo ? new Float32Array(fftSize) : null;
  const monoBuf = new Float32Array(left.fftSize);
  let seenSide = false;

  return {
    read(): StereoRead {
      left.getFloatTimeDomainData(leftBuf);
      if (right && rightBuf) right.getFloatTimeDomainData(rightBuf);
      const read = deriveStereoRead(leftBuf, rightBuf, monoBuf);
      if (read.width > 0) seenSide = true;
      if (read.hasStereo && !seenSide) {
        // Both channels identical so far — report the mono defaults rather
        // than a stereo read that can only ever say "0".
        return { hasStereo: false, mono: read.mono, balance: 0, width: 0, correlation: 1 };
      }
      return read;
    },
  };
}
