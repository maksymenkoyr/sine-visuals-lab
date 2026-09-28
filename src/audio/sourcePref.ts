/**
 * Global choice of which audio source this device listens to. Global per
 * device (like src/render/powerMode.ts and src/audio/autoGain.ts, not per
 * scene) — which input a device listens to describes the device, not one
 * scene's look.
 *
 * - "mic": the microphone (src/audio/capture.ts's captureMic). Always
 *   available, but picks up room noise, HVAC, and the room's own reverb —
 *   colours everything it hears. Unless it's a line input: which device
 *   "mic" opens (a USB interface fed from a DJ mixer, say) is a separate
 *   choice — src/audio/inputDevice.ts.
 * - "display": captureDisplayAudio's getDisplayMedia capture. The cleaner
 *   signal — sharing a native desktop app's window (e.g. the Spotify app)
 *   catches just that app's sound where the browser can capture one app (see
 *   the share-TYPE paragraph below), an entire screen with system audio
 *   catches everything the computer plays, and a single Chrome tab catches
 *   just that tab's audio with no other app or notification bleeding in.
 *
 * displayCaptureSupported() gates whether "display" is offered at all.
 * getDisplayMedia-with-audio support is a desktop-Chromium feature, not a Web
 * Audio one, so this is a browser/OS check, not just an API-presence check:
 *
 * - Windows, Chrome/Edge: works, and has for years. An entire-screen share
 *   offers "Share system audio"; a tab share offers "Share tab audio".
 * - macOS, Chrome >= 141 on macOS >= 14.2: works, via Apple's Core Audio taps
 *   (macOS 14.2) that Chrome wired up in v141. Older combinations on macOS
 *   offer tab audio only, never system audio.
 * - Linux Chrome, Firefox and Safari on every platform, iOS, most Android: no
 *   usable audio from getDisplayMedia. Mic is the only route.
 *
 * displayCaptureSupported() only checks API presence (getDisplayMedia exists
 * on navigator.mediaDevices) — it can't detect the macOS-version/Chrome-
 * version combination above, so an old-Chrome-on-old-macOS user will still
 * see the option and simply get tab-audio-only, or a picker with no system
 * audio checkbox. That's a real gap but a small one: worth closing only if it
 * turns out to confuse people in practice.
 *
 * Which share TYPE yields audio is a second, independent dimension, and it's
 * the one people actually get wrong. In Chrome's picker a tab share offers
 * "Also share tab audio", an entire-screen share offers "Also share system
 * audio", and a window share offers "Also share app audio (from all its
 * windows and related apps)" — that one app's sound — because
 * captureDisplayAudio asks for `windowAudio: "window"`. Chrome can capture a
 * single app on macOS 14.2+ (Core Audio taps; on by default since mid-2026,
 * Chromium's kApplicationAudioCaptureMac) and on Windows; where it can't, a
 * window share falls back to offering system audio, or nothing (Chromium's
 * desktop_media_picker_views.cc, GetWindowCaptureAudioType). Leave the box
 * unticked and getDisplayMedia hands back a video-only stream, which is
 * exactly the case captureDisplayAudio() throws on.
 * DISPLAY_SHARE_GUIDE below is the one-line user-facing form of this
 * paragraph; the start prompt (src/app.ts), the Input card's Source row
 * (src/ui/deviceMenu.ts) and that throw (src/audio/capture.ts) all render the
 * same constant, so the wording can't drift apart across the three.
 *
 * A ticked box can still come back silent on macOS: if the system's "Screen &
 * System Audio Recording" permission is off for the browser, Chrome no longer
 * fails the share — it hands back an audio track that has already ended
 * (Chromium's user_media_processor.cc ignores a system-permission failure on
 * display audio). displayAudioProblem() below checks for that as well as for
 * no audio track at all, so the share says why instead of going quietly dead.
 *
 * Same in-memory-cache-over-localStorage pattern as powerMode.ts: the cache is
 * the source of truth for get/set within a session, seeded once from
 * localStorage, so behavior stays correct even where localStorage is
 * unavailable (node test env, Safari private mode).
 *
 * Every picker (the gallery masthead, the Input card's Source row) paints only
 * two states: live (a capture of that source is actually running) or not. A
 * stored preference is never painted as a highlight — a user reads any
 * highlight as "this is running". resolveSourceState() below is what lets a
 * caller (src/app.ts) that also knows about live capture state hand every
 * picker the same SourceState, so they can never say different things about
 * what's actually listening.
 *
 * Nor does a stored preference start anything on its own: an implicit start
 * (opening a scene, tapping a tile) only ever uses a source whose permission
 * is still active, so no browser prompt can appear that the user didn't just
 * ask for — see watchMicPermission below and src/app.ts's autoStartSource.
 */

export type AudioSourceChoice = "mic" | "display";

const STORAGE_KEY = "vibe.audioSource";
export const AUDIO_SOURCE_DEFAULT: AudioSourceChoice = "mic";

function isAudioSourceChoice(value: string): value is AudioSourceChoice {
  return value === "mic" || value === "display";
}

function loadInitial(): AudioSourceChoice {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null && isAudioSourceChoice(raw)) return raw;
    return AUDIO_SOURCE_DEFAULT;
  } catch {
    return AUDIO_SOURCE_DEFAULT;
  }
}

let cache: AudioSourceChoice = loadInitial();

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, cache);
  } catch {
    // Not fatal — the choice just won't persist across reloads.
  }
}

export function getAudioSourceChoice(): AudioSourceChoice {
  return cache;
}

export function setAudioSourceChoice(next: AudioSourceChoice): void {
  cache = next;
  persist();
}

export type MicPermission = "granted" | "prompt" | "denied" | "unknown";

/** Subscribes to the browser's microphone permission status and returns its
 *  current state; `onChange` fires on every later transition (a grant from
 *  the browser's own prompt, a reset while the page is open). This is the
 *  "is the mic's permission still active" check an implicit start needs —
 *  see src/app.ts's autoStartSource. Screen capture has no equivalent: its
 *  permission is never remembered, getDisplayMedia prompts on every call.
 *  Resolves "unknown" wherever navigator.permissions is absent or its query
 *  rejects (Safari and older Firefox reject the "microphone" name) — same
 *  typeof-navigator guard style as displayCaptureSupported() below. */
export async function watchMicPermission(onChange: (p: MicPermission) => void): Promise<MicPermission> {
  if (typeof navigator === "undefined" || !navigator.permissions) return "unknown";
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    status.addEventListener("change", () => onChange(status.state));
    return status.state;
  } catch {
    return "unknown";
  }
}

/** One resolved source state. Every picker (the gallery masthead, the Input
 *  card's Source row) renders off this instead of AudioSourceChoice alone, so
 *  none of them can claim "listening" before a capture actually is. */
export interface SourceState {
  choice: AudioSourceChoice;
  /** A capture of `choice` is actually running right now — the only thing any
   *  picker highlights. See this file's header. */
  live: boolean;
}

/** Pure so it's node-testable without a DOM: the caller (src/app.ts) does the
 *  impure part — reading the live capture globals and handing in the
 *  preferred choice (resolveInitialSource(), itself sourced from the
 *  `?source=` URL pin or localStorage). `liveChoice` wins outright — a
 *  capture actually running reports `live: true` regardless of what's
 *  stored, which matters right after a source swap where the persisted pref
 *  hasn't caught up yet (see swapAudioSource's ordering in src/app.ts).
 *  Otherwise it's just the preferred choice, not live. */
export function resolveSourceState(input: {
  liveChoice: AudioSourceChoice | null;
  preferredChoice: AudioSourceChoice;
}): SourceState {
  if (input.liveChoice !== null) return { choice: input.liveChoice, live: true };
  return { choice: input.preferredChoice, live: false };
}

/** Whether this browser exposes getDisplayMedia at all. Doesn't (can't)
 *  distinguish the macOS/Chrome-version combination that actually yields
 *  system audio from one that yields tab-audio-only — see the header above. */
export function displayCaptureSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;
}

/** The share-audio checkbox, in one line — see the share-TYPE paragraph in
 *  this file's header. Worded to stand alone so every surface can render it
 *  verbatim rather than paraphrasing it into three slightly different truths. */
export const DISPLAY_SHARE_GUIDE =
  'A share is silent unless you tick its audio box: "Also share tab audio" for a tab, "Also share app audio" for a window (just that app, e.g. Spotify), "Also share system audio" for the entire screen.';

/** Why a finished share has nothing to listen to, or null when it does —
 *  see the macOS-permission paragraph in this file's header. Pure (takes the
 *  share's audio tracks and whether this is a Mac) so it's node-testable;
 *  src/audio/capture.ts throws the message, and src/app.ts's
 *  captureErrorMessage shows it. */
export function displayAudioProblem(audioTracks: readonly Pick<MediaStreamTrack, "readyState">[], onMac: boolean): string | null {
  if (audioTracks.length === 0) return `That share had no audio track. ${DISPLAY_SHARE_GUIDE}`;
  if (audioTracks.some((t) => t.readyState === "live")) return null;
  return onMac
    ? "macOS blocked the browser from recording this computer's sound — allow it under System Settings → Privacy & Security → Screen & System Audio Recording"
    : "The share's audio stopped before it started";
}
