/**
 * The Overlay's saved settings (render/overlayLayout.ts has the shape and the
 * parsing): one in-memory copy, seeded from localStorage at import and
 * re-seeded when a snapshot is applied (net/syncedStores.ts's header has the
 * pattern), the same shape as render/driveStore.ts.
 *
 * Three keys, so a slider drag never re-sends a logo's bytes to the room:
 *   - KEY_SETTINGS: text, position, size and opacity as JSON. Part of the look.
 *   - KEY_LOGO: the logo, a PNG data URL small enough for the room (see
 *     LOGO_ROOM_MAX_CHARS). Part of the look, so a TV and the pop-out show it.
 *   - KEY_LOGO_LOCAL: a logo too detailed for the room. Kept off the look
 *     (ROOM_EXCLUDED_PREFIXES in syncedStores.ts) but still mirrored to the
 *     pop-out window, which is on the same machine.
 * `getOverlay()` returns the same object until something changes, so a drawing
 * layer can tell "changed" with `!==`. A bad or missing key reads as the
 * defaults; a write that storage refuses (full, blocked) keeps the change for
 * this session only.
 */

import { registerSyncedStore } from "../net/syncedStores.ts";
import {
  LOGO_LOCAL_MAX_CHARS,
  LOGO_ROOM_MAX_CHARS,
  OVERLAY_DEFAULTS,
  OVERLAY_OPACITY_MIN,
  OVERLAY_SIZE_MAX,
  OVERLAY_SIZE_MIN,
  cleanOverlayLogo,
  cleanOverlayText,
  parseOverlaySettings,
  type OverlayPosition,
  type OverlaySettings,
} from "./overlayLayout.ts";

const KEY_SETTINGS = "vibe.overlay";
const KEY_LOGO = "vibe.overlayLogo";
const KEY_LOGO_LOCAL = "vibe.overlayLogoLocal";

/** Where the logo lives: with the room's look, on this device only, or none. */
export type OverlayLogoScope = "none" | "room" | "device";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): boolean {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

interface State {
  settings: Omit<OverlaySettings, "logo">;
  roomLogo: string;
  localLogo: string;
}

function load(): State {
  return {
    settings: parseOverlaySettings(read(KEY_SETTINGS)),
    roomLogo: cleanOverlayLogo(read(KEY_LOGO), LOGO_ROOM_MAX_CHARS),
    localLogo: cleanOverlayLogo(read(KEY_LOGO_LOCAL), LOGO_LOCAL_MAX_CHARS),
  };
}

let state: State = load();
let view: OverlaySettings = makeView();

function makeView(): OverlaySettings {
  return { ...state.settings, logo: state.roomLogo || state.localLogo };
}

function changed(): void {
  view = makeView();
}

// Re-seeds from localStorage for the pop-out window and a TV (net/syncedStores.ts).
registerSyncedStore(KEY_SETTINGS, () => {
  state = load();
  changed();
});

function persistSettings(): void {
  const s = state.settings;
  const d = OVERLAY_DEFAULTS;
  const isDefault = s.text === d.text && s.position === d.position && s.size === d.size && s.opacity === d.opacity;
  write(KEY_SETTINGS, isDefault ? null : JSON.stringify(s));
}

/** The current settings. The same object until something changes. */
export function getOverlay(): OverlaySettings {
  return view;
}

export function getOverlayLogoScope(): OverlayLogoScope {
  return state.roomLogo ? "room" : state.localLogo ? "device" : "none";
}

export function setOverlayText(text: string): void {
  const next = cleanOverlayText(text);
  if (next === state.settings.text) return;
  state = { ...state, settings: { ...state.settings, text: next } };
  persistSettings();
  changed();
}

export function setOverlayPosition(position: OverlayPosition): void {
  if (position === state.settings.position) return;
  state = { ...state, settings: { ...state.settings, position } };
  persistSettings();
  changed();
}

export function setOverlaySize(size: number): void {
  const next = Math.min(OVERLAY_SIZE_MAX, Math.max(OVERLAY_SIZE_MIN, size));
  if (!Number.isFinite(next) || next === state.settings.size) return;
  state = { ...state, settings: { ...state.settings, size: next } };
  persistSettings();
  changed();
}

export function setOverlayOpacity(opacity: number): void {
  const next = Math.min(1, Math.max(OVERLAY_OPACITY_MIN, opacity));
  if (!Number.isFinite(next) || next === state.settings.opacity) return;
  state = { ...state, settings: { ...state.settings, opacity: next } };
  persistSettings();
  changed();
}

/** Stores a logo in the room's look (`room`) or on this device only
 *  (`device`); the other place is emptied. A data URL that does not belong
 *  (not a PNG one, or over that place's limit) is refused and the logo stays
 *  as it was. */
export function setOverlayLogo(dataUrl: string, scope: "room" | "device"): boolean {
  const room = scope === "room";
  const clean = cleanOverlayLogo(dataUrl, room ? LOGO_ROOM_MAX_CHARS : LOGO_LOCAL_MAX_CHARS);
  if (!clean) return false;
  write(room ? KEY_LOGO_LOCAL : KEY_LOGO, null);
  write(room ? KEY_LOGO : KEY_LOGO_LOCAL, clean);
  state = { ...state, roomLogo: room ? clean : "", localLogo: room ? "" : clean };
  changed();
  return true;
}

export function clearOverlayLogo(): void {
  if (!state.roomLogo && !state.localLogo) return;
  write(KEY_LOGO, null);
  write(KEY_LOGO_LOCAL, null);
  state = { ...state, roomLogo: "", localLogo: "" };
  changed();
}
