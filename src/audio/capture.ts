import type { CaptureHandle, CaptureSourceKind } from "./types.ts";
import { DISPLAY_SHARE_GUIDE } from "./sourcePref.ts";

/**
 * Constraints tuned for music, not speech. All three MUST be false: browsers
 * default them on for call quality, and they will pump, duck, and gate a
 * music signal into garbage before it ever reaches the analyser.
 */
const MUSIC_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

/**
 * Options for the analysis AudioContext hung off a capture. Two intents:
 *
 * - `latencyHint: "interactive"` — explicit even though it's the default:
 *   states the intent (lowest achievable input latency) and guards against
 *   a future default change.
 * - `sampleRate` pinned to the captured track's own rate when the browser
 *   reports one. A context left at the browser's default rate resamples the
 *   mic through a FIFO whenever the two disagree (a 48k phone mic into a
 *   44.1k context, a Bluetooth headset's 16k into either), and that FIFO is
 *   pure added delay between the room and the analyser — the one stage of
 *   the local path that isn't a fixed render quantum. Running the context at
 *   the track's rate removes it. Pure so the choice is testable without a
 *   browser (tests/capture.test.ts).
 */
export function analysisContextOptions(trackSampleRate: number | undefined): AudioContextOptions {
  const options: AudioContextOptions = { latencyHint: "interactive" };
  if (trackSampleRate && Number.isFinite(trackSampleRate) && trackSampleRate > 0) {
    options.sampleRate = trackSampleRate;
  }
  return options;
}

function createAnalysisContext(stream: MediaStream): AudioContext {
  const track = stream.getAudioTracks()[0];
  const options = analysisContextOptions(track?.getSettings().sampleRate);
  try {
    return new AudioContext(options);
  } catch {
    // A rate this browser won't run a context at (NotSupportedError) — fall
    // back to its default rate and accept the resampler.
    return new AudioContext({ latencyHint: options.latencyHint });
  }
}

/**
 * Best estimate of how far behind the room the analyser reads, in seconds,
 * from what the browser itself reports: the capture track's own latency
 * (Chromium reports it in MediaTrackSettings; other engines leave it
 * undefined, counted as 0) plus the context's baseLatency — the graph is
 * pulled at the output callback's cadence, so that buffer's worth of input
 * sits in the source node's FIFO before a read sees it. Null when neither is
 * reported. Diagnostic only: what the Bands card's status line shows as
 * "in", so a delay seen on a phone can be placed on the input side (this
 * number) or elsewhere (the room's render delay, the scene's own easing).
 */
export function estimateInputLatencySec(handle: CaptureHandle): number | null {
  const track = handle.stream.getAudioTracks()[0];
  // `latency` is in the Media Capture spec and reported by Chromium, but
  // not in TypeScript's DOM lib yet — read it through a widened type.
  const settings = track?.getSettings() as (MediaTrackSettings & { latency?: number }) | undefined;
  const trackLatency = settings?.latency;
  const base = handle.context.baseLatency;
  const parts = [trackLatency, base].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (parts.length === 0) return null;
  return parts.reduce((a, b) => a + b, 0);
}

function buildHandle(kind: CaptureSourceKind, stream: MediaStream): CaptureHandle {
  const context = createAnalysisContext(stream);
  const sourceNode = context.createMediaStreamSource(stream);
  return {
    kind,
    context,
    sourceNode,
    stream,
    stop: () => {
      for (const track of stream.getTracks()) track.stop();
      void context.close();
    },
  };
}

/** Default mic capture, using the currently selected input device. */
export async function captureMic(deviceId?: string): Promise<CaptureHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...MUSIC_AUDIO_CONSTRAINTS,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
  });
  return buildHandle("mic", stream);
}

/**
 * Capture a shared tab/window/screen's audio (Chrome/Edge desktop). This is
 * the cleanest possible signal for a desktop host: no room noise, no mic
 * coloration, and no gesture-gated permission prompt beyond the picker.
 * See sourcePref.ts's header for exactly which browser/OS combinations this
 * actually yields audio on.
 */
export async function captureDisplayAudio(): Promise<CaptureHandle> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: MUSIC_AUDIO_CONSTRAINTS,
  });
  if (stream.getAudioTracks().length === 0) {
    for (const track of stream.getTracks()) track.stop();
    throw new Error(`That share had no audio track. ${DISPLAY_SHARE_GUIDE}`);
  }
  // We only need the audio; drop the video track immediately.
  for (const track of stream.getVideoTracks()) track.stop();
  return buildHandle("display", stream);
}

/** List available audio input devices (labels only populate after a permission grant). */
export async function listAudioInputDevices(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "audioinput");
}

/** Capture from a specific selected input device (e.g. a USB mixer interface). */
export async function captureDevice(deviceId: string): Promise<CaptureHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { ...MUSIC_AUDIO_CONSTRAINTS, deviceId: { exact: deviceId } },
  });
  return buildHandle("device", stream);
}
