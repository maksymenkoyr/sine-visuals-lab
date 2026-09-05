/**
 * Global choice of which audio source this device listens to. Global per
 * device (like src/render/powerMode.ts and src/audio/autoGain.ts, not per
 * scene) — which input a device listens to describes the device, not one
 * scene's look.
 *
 * - "mic": the microphone (src/audio/capture.ts's captureMic). Always
 *   available, but picks up room noise, HVAC, and the room's own reverb —
 *   colours everything it hears.
 * - "display": captureDisplayAudio's getDisplayMedia capture. The cleaner
 *   signal — sharing an entire screen with system audio catches a native
 *   desktop app (e.g. Spotify), sharing a single Chrome tab catches just that
 *   tab's audio with no other app or notification bleeding in.
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
 * audio", and a window share offers neither — a window is silent no matter
 * what. Leave the box unticked and getDisplayMedia hands back a video-only
 * stream, which is exactly the case captureDisplayAudio() throws on.
 * DISPLAY_SHARE_GUIDE below is the one-line user-facing form of this
 * paragraph; the start prompt (src/app.ts), the Input card's Source row
 * (src/ui/deviceMenu.ts) and that throw (src/audio/capture.ts) all render the
 * same constant, so the wording can't drift apart across the three.
 *
 * Same in-memory-cache-over-localStorage pattern as powerMode.ts: the cache is
 * the source of truth for get/set within a session, seeded once from
 * localStorage, so behavior stays correct even where localStorage is
 * unavailable (node test env, Safari private mode).
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
    return raw !== null && isAudioSourceChoice(raw) ? raw : AUDIO_SOURCE_DEFAULT;
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
  'A screen share is silent unless you tick "Also share tab audio" (a tab) or "Also share system audio" (a whole screen) — a single window carries no audio.';
