import type { CaptureHandle, CaptureSourceKind } from "./types.ts";
import { displayAudioProblem } from "./sourcePref.ts";

/**
 * Constraints tuned for music, not speech. All three MUST be false: browsers
 * default them on for call quality, and they will pump, duck, and gate a
 * music signal into garbage before it ever reaches the analyser.
 */
/** Events that carry user activation, for the resume() fallback in
 *  openHandle. A touch `pointerdown` does not grant activation (only a mouse
 *  pointerdown, mousedown, a non-mouse pointerup, touchend and keydown do), so
 *  touch devices — the iOS "interrupted" case — need pointerup/touchend. */
const KICK_GESTURES = ["pointerdown", "pointerup", "touchend", "click", "keydown"] as const;

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
  // The context is built after an await on getUserMedia/getDisplayMedia, so
  // the click that started it may be spent, and an auto-started mic (granted
  // permission, deep link) never had one: the browser can leave it
  // "suspended". iOS Safari also sets "interrupted" on a call, Siri or lock
  // and never resumes by itself. A context that isn't running reads as
  // permanent silence — every analyser sits at the floor while the stream is
  // live — so nudge it now, on every state change, and on the next gesture
  // (a resume() outside one can be refused). Nothing in src/ suspends this
  // context on purpose, so the statechange loop fights nothing. Compare the
  // state as a string: the DOM typings' union lacks "interrupted".
  const kick = (): void => {
    const state: string = context.state;
    if (state !== "running" && state !== "closed") void context.resume().catch(() => {});
  };
  kick();
  context.addEventListener("statechange", kick);
  for (const type of KICK_GESTURES) document.addEventListener(type, kick, { passive: true });
  document.addEventListener("visibilitychange", kick);
  return {
    kind,
    context,
    sourceNode,
    stream,
    stop: () => {
      // Listeners first, so a closed context is never asked to resume.
      context.removeEventListener("statechange", kick);
      for (const type of KICK_GESTURES) document.removeEventListener(type, kick);
      document.removeEventListener("visibilitychange", kick);
      for (const track of stream.getTracks()) track.stop();
      void context.close();
    },
  };
}

/** The AudioContext + source node for a stream that's already granted. If
 *  either throws (the context limit, a track that ended in between), the
 *  tracks are stopped here — the caller only sees the rejection and holds no
 *  handle, so otherwise the OS mic indicator / "sharing" bar would stay on
 *  with nothing in the UI to release it. */
function openHandle(kind: CaptureSourceKind, stream: MediaStream): CaptureHandle {
  let context: AudioContext | undefined;
  try {
    // Explicit even though it's the default — states the intent (lowest
    // achievable input latency) and guards against a future default change.
    context = new AudioContext({ latencyHint: "interactive" });
    return buildHandle(kind, stream, context);
  } catch (err) {
    for (const track of stream.getTracks()) track.stop();
    if (context) void context.close();
    throw err;
  }
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
  return openHandle("mic", stream);
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
    // A window share hears only that app (the Spotify app, say), never the
    // whole Mac — left unset, Chrome offers system audio there, so the share
    // picked up a YouTube tab playing elsewhere. Chrome 141+; not yet in the
    // DOM typings, hence the spread.
    ...{ windowAudio: "window" },
  });
  const problem = displayAudioProblem(stream.getAudioTracks(), /Mac/.test(navigator.userAgent));
  if (problem) {
    for (const track of stream.getTracks()) track.stop();
    throw new Error(problem);
  }
  // We only need the audio; drop the video track immediately.
  for (const track of stream.getVideoTracks()) track.stop();
  return openHandle("display", stream);
}

/** List available audio input devices (labels only populate after a permission
 *  grant — see inputDevice.ts's inputDeviceOptions for what's pickable). */
export async function listAudioInputDevices(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "audioinput");
}
