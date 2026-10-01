import type { PowerMode } from "./powerMode.ts";
import type { QualityChoice } from "./qualityPref.ts";

/**
 * Quality and energy settings for the pop-out output window (see
 * src/net/outputSync.ts), which draws the scene the audience sees, and for
 * the main window's preview of it. While an output is open the main window
 * is only a preview (Cue / Go), yet it used to render full size at full
 * quality, so the GPU drew the scene twice at the same cost. Four settings
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
 *
 * - output cast (default "off"): how the output is drawn when its window is
 *   being cast to a Chromecast with Chrome's own Cast. Chrome re-encodes the
 *   window as ~30 fps video at 720p-1080p and a few Mbit/s, so a 60 fps,
 *   Retina-density picture only spends GPU the encoder needs and hands it
 *   detail it turns into blocks. "on" draws a CAST_BUFFER_HEIGHT-line buffer
 *   at 1x density and CAST_FPS (a fixed height rather than a fraction, so a
 *   fullscreen 4K window casts the same as a small one); "soft" also blurs
 *   the canvas by CAST_SOFT_BLUR_PX in CSS, which the capture includes, since
 *   fine high-frequency detail is what an encoder spends its bits on and
 *   smears. This does nothing about the encode-and-network delay, which only
 *   a Cast receiver page would remove.
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

/** How the output is drawn for a Chrome Cast: not at all different, a
 *  Cast-sized buffer, or that plus a soft blur. */
export type CastMode = "off" | "on" | "soft";
export const CAST_MODES: readonly CastMode[] = ["off", "on", "soft"];
/** The drawing buffer's height under Cast (width follows the window's aspect). */
export const CAST_BUFFER_HEIGHT = 720;
/** The render rate under Cast: what Chrome's mirroring streams. */
export const CAST_FPS = 30;
/** The canvas blur under "soft", in CSS pixels of the final window. */
export const CAST_SOFT_BLUR_PX = 0.8;

export type PreviewSize = "third" | "half" | "full";

/** The preview box's width and height as a fraction of the window's. */
export const PREVIEW_SIZE_FRACTION: Record<PreviewSize, number> = { third: 1 / 3, half: 0.5, full: 1 };

export const OUTPUT_QUALITY_DEFAULT: QualityChoice = "high";
export const OUTPUT_POWER_MODE_DEFAULT: PowerMode = "off";
export const OUTPUT_CAST_DEFAULT: CastMode = "off";
export const PREVIEW_QUALITY_DEFAULT: QualityChoice = "floor";
export const PREVIEW_SIZE_DEFAULT: PreviewSize = "half";

const OUTPUT_QUALITY_KEY = "vibe.output.quality";
const OUTPUT_POWER_MODE_KEY = "vibe.output.powerMode";
const OUTPUT_CAST_KEY = "vibe.output.cast";
const PREVIEW_QUALITY_KEY = "vibe.preview.quality";
const PREVIEW_SIZE_KEY = "vibe.preview.size";

function isQualityChoice(value: string): value is QualityChoice {
  return value === "auto" || value === "high" || value === "mid" || value === "low" || value === "floor";
}

function isPowerMode(value: string): value is PowerMode {
  return value === "auto" || value === "on" || value === "off";
}

export function isCastMode(value: string): value is CastMode {
  return value === "off" || value === "on" || value === "soft";
}

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

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not fatal — the choice just won't persist across reloads.
  }
}

let outputQuality: QualityChoice = load(OUTPUT_QUALITY_KEY, isQualityChoice, OUTPUT_QUALITY_DEFAULT);
let outputPowerMode: PowerMode = load(OUTPUT_POWER_MODE_KEY, isPowerMode, OUTPUT_POWER_MODE_DEFAULT);
let outputCast: CastMode = load(OUTPUT_CAST_KEY, isCastMode, OUTPUT_CAST_DEFAULT);
let previewQuality: QualityChoice = load(PREVIEW_QUALITY_KEY, isQualityChoice, PREVIEW_QUALITY_DEFAULT);
let previewSize: PreviewSize = load(PREVIEW_SIZE_KEY, isPreviewSize, PREVIEW_SIZE_DEFAULT);

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

export function getOutputCastMode(): CastMode {
  return outputCast;
}

export function setOutputCastMode(next: CastMode): void {
  outputCast = next;
  persist(OUTPUT_CAST_KEY, next);
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
