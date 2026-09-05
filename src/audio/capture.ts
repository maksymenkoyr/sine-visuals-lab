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

function buildHandle(
  kind: CaptureSourceKind,
  stream: MediaStream,
  context: AudioContext,
): CaptureHandle {
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
  // Explicit even though it's the default — states the intent (lowest
  // achievable input latency) and guards against a future default change.
  const context = new AudioContext({ latencyHint: "interactive" });
  return buildHandle("mic", stream, context);
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
  // Explicit even though it's the default — states the intent (lowest
  // achievable input latency) and guards against a future default change.
  const context = new AudioContext({ latencyHint: "interactive" });
  return buildHandle("display", stream, context);
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
  // Explicit even though it's the default — states the intent (lowest
  // achievable input latency) and guards against a future default change.
  const context = new AudioContext({ latencyHint: "interactive" });
  return buildHandle("device", stream, context);
}
