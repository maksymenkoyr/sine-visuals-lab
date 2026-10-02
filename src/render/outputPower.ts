import { isPowerMode, type PowerMode } from "./powerMode.ts";
import { isQualityChoice, type QualityChoice } from "./qualityPref.ts";

/**
 * Quality and energy settings for the pop-out output window (see
 * src/net/outputSync.ts), which draws the scene the audience sees, and for
 * the main window's preview of it. While an output is open the main window
 * is only a preview (Cue / Go), yet it used to render full size at full
 * quality, so the GPU drew the scene twice at the same cost. These settings
 * split that:
 *
 * - output quality (default "high") and output energy saving (default
 *   "off"): the output's own counterparts of render/qualityPref.ts and
 *   render/powerMode.ts, meaning the same thing there. The defaults are the
 *   audience-facing ones: full detail, nothing cut.
 * - preview quality (default "floor"): the quality the main window renders
 *   at while an output is open, raised by app.ts only as far as the mounted
 *   scene's `minQuality` needs. "auto" follows this device's benchmark.
 * - preview size (default "half"): how large the preview's box is, as a
 *   fraction of the window (PREVIEW_SIZE_FRACTION). The drawing buffer
 *   follows the box (render/gl.ts's resizeCanvasToDisplaySize), so a
 *   smaller box is fewer pixels drawn, not just a smaller picture.
 * - output resolution and preview resolution (default 1): a plain scale on
 *   the drawing buffer, from RESOLUTION_MIN to RESOLUTION_MAX, multiplied
 *   into the quality's own `renderScale` where each window resizes its
 *   canvas (output.ts, app.ts) — so it composes with the quality preset and
 *   with the governor's steps instead of replacing either, and changes how
 *   many pixels are drawn without touching the box's size or the scene's
 *   detail. Unlike a quality change it never re-inits the scene: scenes
 *   already follow the canvas size every frame, because the governor moves
 *   it at runtime. The preview's only applies while an output is open.
 *
 * None of them is mirrored to the output (net/syncedStores.ts's
 * PRIVATE_KEYS): each window's quality and power belong to that window, and
 * the output's travels as its own `power` message, outside Cue, because
 * they are how the output renders, not part of the look Cue holds.
 *
 * Same in-memory-cache-over-localStorage pattern as qualityPref.ts: the
 * cache is the source of truth for get/set within a session, seeded once
 * from localStorage, so behavior stays correct even where localStorage is
 * unavailable (node test env, Safari private mode).
 */

export type PreviewSize = "third" | "half" | "full";

/** The preview box's width and height as a fraction of the window's. */
export const PREVIEW_SIZE_FRACTION: Record<PreviewSize, number> = { third: 1 / 3, half: 0.5, full: 1 };

/** Resolution scale bounds. The floor is the governor's own (governor.ts's
 *  MIN_RENDER_SCALE): below it a scene's fine texture is mush. */
export const RESOLUTION_MIN = 0.25;
export const RESOLUTION_MAX = 1;
export const RESOLUTION_DEFAULT = 1;

/** Clamps to [RESOLUTION_MIN, RESOLUTION_MAX]; anything that isn't a finite
 *  number (a `power` message from an older build, junk in storage) is the
 *  default, since a NaN would size the canvas to nothing. */
export function clampResolution(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return RESOLUTION_DEFAULT;
  return Math.min(RESOLUTION_MAX, Math.max(RESOLUTION_MIN, value));
}

export const OUTPUT_QUALITY_DEFAULT: QualityChoice = "high";
export const OUTPUT_POWER_MODE_DEFAULT: PowerMode = "off";
export const PREVIEW_QUALITY_DEFAULT: QualityChoice = "floor";
export const PREVIEW_SIZE_DEFAULT: PreviewSize = "half";

const OUTPUT_QUALITY_KEY = "vibe.output.quality";
const OUTPUT_POWER_MODE_KEY = "vibe.output.powerMode";
const PREVIEW_QUALITY_KEY = "vibe.preview.quality";
const PREVIEW_SIZE_KEY = "vibe.preview.size";
const OUTPUT_RESOLUTION_KEY = "vibe.output.resolution";
const PREVIEW_RESOLUTION_KEY = "vibe.preview.resolution";

function isPreviewSize(value: string): value is PreviewSize {
  return value === "third" || value === "half" || value === "full";
}

function load<T extends string>(key: string, valid: (v: string) => v is T, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null && valid(raw) ? raw : fallback;
  } catch {
    return fallback;
  }
}

function loadResolution(key: string): number {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? RESOLUTION_DEFAULT : clampResolution(Number.parseFloat(raw));
  } catch {
    return RESOLUTION_DEFAULT;
  }
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not fatal — the choice just won't persist across reloads.
  }
}

let outputQuality: QualityChoice = load(OUTPUT_QUALITY_KEY, isQualityChoice, OUTPUT_QUALITY_DEFAULT);
let outputPowerMode: PowerMode = load(OUTPUT_POWER_MODE_KEY, isPowerMode, OUTPUT_POWER_MODE_DEFAULT);
let previewQuality: QualityChoice = load(PREVIEW_QUALITY_KEY, isQualityChoice, PREVIEW_QUALITY_DEFAULT);
let previewSize: PreviewSize = load(PREVIEW_SIZE_KEY, isPreviewSize, PREVIEW_SIZE_DEFAULT);
let outputResolution = loadResolution(OUTPUT_RESOLUTION_KEY);
let previewResolution = loadResolution(PREVIEW_RESOLUTION_KEY);

export function getOutputQualityChoice(): QualityChoice {
  return outputQuality;
}

export function setOutputQualityChoice(next: QualityChoice): void {
  outputQuality = next;
  persist(OUTPUT_QUALITY_KEY, next);
}

export function getOutputPowerMode(): PowerMode {
  return outputPowerMode;
}

export function setOutputPowerMode(next: PowerMode): void {
  outputPowerMode = next;
  persist(OUTPUT_POWER_MODE_KEY, next);
}

export function getPreviewQualityChoice(): QualityChoice {
  return previewQuality;
}

export function setPreviewQualityChoice(next: QualityChoice): void {
  previewQuality = next;
  persist(PREVIEW_QUALITY_KEY, next);
}

export function getPreviewSize(): PreviewSize {
  return previewSize;
}

export function setPreviewSize(next: PreviewSize): void {
  previewSize = next;
  persist(PREVIEW_SIZE_KEY, next);
}

export function getOutputResolution(): number {
  return outputResolution;
}

export function setOutputResolution(next: number): void {
  outputResolution = clampResolution(next);
  persist(OUTPUT_RESOLUTION_KEY, String(outputResolution));
}

export function getPreviewResolution(): number {
  return previewResolution;
}

export function setPreviewResolution(next: number): void {
  previewResolution = clampResolution(next);
  persist(PREVIEW_RESOLUTION_KEY, String(previewResolution));
}
