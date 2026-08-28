/**
 * Time-domain tap for the controls panel's waveform (src/ui/audioMeters.ts)
 * — the one thing src/audio/analyser.ts's frequency-domain read can't give.
 * Reads getFloatTimeDomainData only, never getFloatFrequencyData: that's a
 * buffer copy, not a second FFT, so it costs nothing on top of the band
 * analyser. An AnalyserNode downmixes its input to mono, which is exactly
 * what the scope draws — a phone or laptop mic is mono anyway.
 *
 * Display-only and local to this device: nothing here reaches
 * FeatureExtractor or the wire frame. The math over the samples lives in
 * waveform.ts, kept pure so it's testable without an AudioContext.
 */

export interface WaveformAnalyser {
  /** The latest block of samples, [-1,1]. Same buffer identity on every
   *  read — copy before holding. */
  read(): Float32Array;
}

export function createWaveformAnalyser(context: AudioContext, sourceNode: AudioNode, fftSize = 2048): WaveformAnalyser {
  const node = context.createAnalyser();
  node.fftSize = fftSize;
  // Analysis tap only, same feedback guard as analyser.ts: never connect
  // toward context.destination.
  sourceNode.connect(node);
  const buf = new Float32Array(node.fftSize);
  return {
    read(): Float32Array {
      node.getFloatTimeDomainData(buf);
      return buf;
    },
  };
}
