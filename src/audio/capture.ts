import type { CaptureHandle, CaptureSourceKind } from "./types.ts";
import { displayAudioProblem } from "./sourcePref.ts";

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

/** Mic capture — the system default input, or exactly `deviceId` (a USB
 *  audio interface, a mixer's own USB sound card; see inputDevice.ts for the
 *  choice and src/app.ts's startMic for resolving it). An exact id that
 *  isn't plugged in rejects rather than silently opening another input —
 *  startMic decides what to fall back to, and says so. */
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

/** getDisplayMedia's newer hints (the Screen Capture spec's
 *  DisplayMediaStreamOptions) that TypeScript's DOM lib doesn't list yet. A
 *  browser that doesn't know one ignores it. */
interface ShareOptions extends DisplayMediaStreamOptions {
  windowAudio?: "system" | "window" | "exclude";
  audioSelection?: "preferred";
}

/**
 * Capture a shared tab/window/screen's audio (Chrome/Edge desktop). This is
 * the cleanest possible signal for a desktop host: no room noise, no mic
 * coloration, and no gesture-gated permission prompt beyond the picker.
 * See sourcePref.ts's header for exactly which browser/OS combinations this
 * actually yields audio on — and for the two hints below: `windowAudio:
 * "window"` makes a window share offer that one app's sound (the Spotify
 * app, say) instead of the whole system's, and `audioSelection` steers the
 * picker toward ticking its audio box.
 */
export async function captureDisplayAudio(): Promise<CaptureHandle> {
  const options: ShareOptions = {
    video: true,
    audio: MUSIC_AUDIO_CONSTRAINTS,
    windowAudio: "window",
    audioSelection: "preferred",
  };
  const stream = await navigator.mediaDevices.getDisplayMedia(options);
  const problem = displayAudioProblem(stream.getAudioTracks(), /Mac/.test(navigator.userAgent));
  if (problem) {
    for (const track of stream.getTracks()) track.stop();
    throw new Error(problem);
  }
  // We only need the audio; drop the video track immediately.
  for (const track of stream.getVideoTracks()) track.stop();
  // Explicit even though it's the default — states the intent (lowest
  // achievable input latency) and guards against a future default change.
  const context = new AudioContext({ latencyHint: "interactive" });
  return buildHandle("display", stream, context);
}

/** List available audio input devices (labels only populate after a permission
 *  grant — see inputDevice.ts's inputDeviceOptions for what's pickable). */
export async function listAudioInputDevices(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "audioinput");
}
