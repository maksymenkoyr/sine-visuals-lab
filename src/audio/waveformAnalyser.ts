/**
 * Time-domain tap for the controls panel's waveform (src/ui/audioMeters.ts)
 * — the one thing src/audio/analyser.ts's frequency-domain read can't give.
 * Reads getFloatTimeDomainData only, never getFloatFrequencyData: that's a
 * buffer copy, not a second FFT, so it costs nothing on top of the band
 * analyser. An AnalyserNode downmixes its input to mono, which is exactly
 * what the scope draws — a phone or laptop mic is mono anyway.
 *
 * Display-only: nothing here reaches FeatureExtractor. In a room, a device
 * on its own input also sends each frame's min and max to its followers
 * (src/net/protocol.ts's wave tail), so a phone or iPad draws the same row. The math over the samples lives in
 * waveform.ts, kept pure so it's testable without an AudioContext.
 *
 * `fftSize` is also reused DEV-only at 32768 (app.ts's measureAnalyser) as a
 * deep ring buffer for tools/audio-latency.mjs — that caller needs 682ms of
 * history to reliably still hold a just-arrived click, well past this
 * module's own default 2048/42.7ms.
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
