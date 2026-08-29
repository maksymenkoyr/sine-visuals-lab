import { createLufsMeter, kWeightingCoefficients, type LufsReading } from "./lufs.ts";

/**
 * The AudioContext half of the LUFS meter (math in lufs.ts): hangs a
 * K-weighting chain — two IIRFilterNodes carrying the spec's coefficients,
 * re-discretised for this context's sample rate — off the capture source,
 * with an AnalyserNode at the end as a time-domain tap. Explicit IIR
 * coefficients rather than a BiquadFilterNode "highshelf": the latter is a
 * textbook shelf and doesn't match BS.1770's table.
 *
 * The analyser is a snapshot, not a stream: getFloatTimeDomainData hands
 * back the most recent LUFS_TAP_FFT_SIZE samples whenever asked, and
 * consecutive rAF reads overlap. read() reconstructs a near-gap-free stream
 * by counting how many samples the audio clock (context.currentTime, which
 * advances per render quantum exactly as the analyser's ring does) moved
 * since the last read, and handing only that tail to the meter. Error is
 * at most one render quantum per read, zero-mean, and invisible at the
 * meter's 100 ms block size. A backgrounded tab (dt longer than the buffer)
 * caps at the buffer and accepts the gap; a suspended context stops the
 * clock, so the reading simply freezes.
 *
 * Display-only and local to this device, same as waveformAnalyser.ts:
 * nothing here reaches FeatureExtractor or the wire frame.
 */

export interface LufsAnalyser {
  read(): LufsReading;
  /** Starts the integrated reading over. */
  reset(): void;
}

// The Web Audio maximum. Time-domain reads never run the FFT, so the only
// cost of a big buffer is the copy — and it has to cover the longest gap
// between two rAF reads, which at 48 kHz is ~680 ms here.
export const LUFS_TAP_FFT_SIZE = 32768;

export function createLufsAnalyser(context: AudioContext, sourceNode: AudioNode): LufsAnalyser {
  const k = kWeightingCoefficients(context.sampleRate);
  const shelf = context.createIIRFilter(k.shelf.b, k.shelf.a);
  const highpass = context.createIIRFilter(k.highpass.b, k.highpass.a);
  const node = context.createAnalyser();
  node.fftSize = LUFS_TAP_FFT_SIZE;
  // Tap only — never connect toward context.destination (feeding a live mic
  // to the room's speakers would howl).
  sourceNode.connect(shelf);
  shelf.connect(highpass);
  highpass.connect(node);

  const buf = new Float32Array(node.fftSize);
  const meter = createLufsMeter(context.sampleRate);
  let lastTime: number | null = null;

  return {
    read(): LufsReading {
      const now = context.currentTime;
      if (lastTime === null) {
        lastTime = now;
        return meter.read();
      }
      const n = Math.min(buf.length, Math.round((now - lastTime) * context.sampleRate));
      lastTime = now;
      if (n > 0) {
        node.getFloatTimeDomainData(buf);
        meter.push(buf, buf.length - n);
      }
      return meter.read();
    },
    reset(): void {
      meter.reset();
    },
  };
}
