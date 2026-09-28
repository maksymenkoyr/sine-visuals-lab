/**
 * The impure half of src/audio/inputHealth.ts: reads real per-channel peaks
 * and the browser's own dropped-frame count off a live capture every tick,
 * so app.ts can hand createInputHealth's pure state machine an InputMeasure
 * without it ever touching an AudioContext. Analysis tap only, same feedback
 * guard as every other analyser in this directory: never connected onward to
 * context.destination.
 *
 * Splits `sourceNode` into left/right AnalyserNodes (never a downmix — that's
 * waveformAnalyser.ts's job, and exactly the mix that hides a single clipped
 * channel; see inputHealth.ts's header) and reads each with
 * getFloatTimeDomainData, same as src/audio/waveformAnalyser.ts and the
 * deleted src/audio/stereo.ts (git show 393117f^:src/audio/stereo.ts) this is
 * a narrower cousin of.
 *
 * Mono vs stereo is decided once, the same first layer stereo.ts used
 * (there's no second "did a side ever actually differ" layer here, unlike
 * that file — a clip check on a channel that's a bit-identical duplicate of
 * the other is still a correct clip check, just a redundant read): a track
 * whose getSettings().channelCount reads exactly 1 is mono, and the right
 * analyser is never even created (peakR reads null). Anything else —
 * including a track that doesn't report a channelCount at all — is read as
 * stereo.
 *
 * glitchFrames comes from the newer, Chrome-125+-only `MediaStreamTrack.stats`
 * (`totalFrames - deliveredFrames`), not yet in TypeScript's DOM lib, hence
 * the cast. Polled at most once a second and cached between polls, on the
 * capture's own AudioContext clock — this is a dropped-buffer counter, not a
 * per-tick signal, and re-reading it 60 times a second would buy nothing.
 * null wherever the property doesn't exist (any non-Chrome engine, or an
 * older Chrome) — createInputHealth treats that as "no evidence either way",
 * never as "definitely zero drops".
 */

import { peak } from "./waveform.ts";

const TAP_FFT_SIZE = 2048;
const GLITCH_POLL_SEC = 1;

export interface InputHealthTapRead {
  peakL: number;
  peakR: number | null;
  glitchFrames: number | null;
}

export interface InputHealthTap {
  read(): InputHealthTapRead;
  dispose(): void;
}

/** Chrome's own non-standard per-track stats — not in TypeScript's DOM lib
 *  yet, so the read is a cast at this one boundary rather than sprinkling
 *  `as any` through the caller. */
function readGlitchFrames(track: MediaStreamTrack | undefined): number | null {
  const stats = (track as unknown as { stats?: { totalFrames?: unknown; deliveredFrames?: unknown } } | undefined)?.stats;
  if (!stats || typeof stats.totalFrames !== "number" || typeof stats.deliveredFrames !== "number") return null;
  return stats.totalFrames - stats.deliveredFrames;
}

export function createInputHealthTap(context: AudioContext, sourceNode: AudioNode, stream: MediaStream): InputHealthTap {
  const track = stream.getAudioTracks()[0];
  const isMono = track?.getSettings().channelCount === 1;

  const splitter = context.createChannelSplitter(2);
  sourceNode.connect(splitter);

  const left = context.createAnalyser();
  left.fftSize = TAP_FFT_SIZE;
  splitter.connect(left, 0);

  let right: AnalyserNode | null = null;
  if (!isMono) {
    right = context.createAnalyser();
    right.fftSize = TAP_FFT_SIZE;
    splitter.connect(right, 1);
  }

  const leftBuf = new Float32Array(TAP_FFT_SIZE);
  const rightBuf = right ? new Float32Array(TAP_FFT_SIZE) : null;

  // See this file's header for why this is throttled to GLITCH_POLL_SEC
  // rather than read fresh every tick.
  let glitchCache: number | null = null;
  let nextPollAt = 0;

  function pollGlitchFrames(): number | null {
    const now = context.currentTime;
    if (now >= nextPollAt) {
      nextPollAt = now + GLITCH_POLL_SEC;
      glitchCache = readGlitchFrames(track);
    }
    return glitchCache;
  }

  return {
    read(): InputHealthTapRead {
      left.getFloatTimeDomainData(leftBuf);
      const peakL = peak(leftBuf);
      let peakR: number | null = null;
      if (right && rightBuf) {
        right.getFloatTimeDomainData(rightBuf);
        peakR = peak(rightBuf);
      }
      return { peakL, peakR, glitchFrames: pollGlitchFrames() };
    },
    dispose(): void {
      splitter.disconnect();
      left.disconnect();
      right?.disconnect();
    },
  };
}
