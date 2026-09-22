import { NUM_BANDS } from "./types.ts";

/**
 * The sensitivity line: a drawn shape over the band ladder — one height per
 * band, 0..1 — that turns "is the spectrum loud" into "how far above the
 * shape I drew is the spectrum". A band's *headroom* is `1 - line[b]`: how
 * much room is left above the line for signal to stand out in. A band drawn
 * to the very top (1) has no headroom and is excluded entirely — however
 * loud it gets, it can never drive anything. A band drawn to the bottom (0)
 * is fully in: its whole reading counts. The default is the top for every
 * band — a setting that's never been drawn on listens to nothing, and the
 * user draws the line *down* onto the range they want, so an undrawn band
 * can neither dilute the drive nor sneak signal into it (the first draft
 * defaulted to the bottom and both happened at once).
 *
 * bandLineDrive() reduces the whole line to one number per frame: the
 * fraction of the line's total headroom the signal currently fills.
 *
 *   excess_b = max(0, bands[b] - line[b])
 *   drive    = clamp01( strength * Σ excess_b / Σ (1 - line[b]) )   (0 if Σ headroom is 0)
 *
 * With the line drawn flat to the bottom and strength 1 this is exactly
 * FeatureFrame.energy (the mean of every band) — the line generalises
 * energy into "energy above a shape you drew". Near the line, a band
 * contributes almost nothing; far above it, the same band dominates.
 * `strength` scales the whole ratio and can push it all the way to the 1
 * ceiling — the "include maximum" half of the overall-strength slider.
 *
 * This module holds only the pure drive math now — sanitizeLine (below) and
 * the shared height/strength constants. The line is a drive source
 * (`{ source: "line" }`, one of `SceneSetting.drive`'s choices — see
 * src/render/drives.ts), so its storage lives in src/render/driveStore.ts,
 * keyed per *setting* (not per scene: two drive settings on the same scene
 * each draw their own line), and its peak-hold release lives in drives.ts
 * next to the engine that advances it every tick. UI is
 * src/ui/bandLineEditor.ts, drawn over the Bands card's own spectrum strip
 * (put into line mode for whichever setting is being drawn) rather than a
 * second strip of its own.
 */

export const LINE_STRENGTH_MIN = 0.25;
export const LINE_STRENGTH_MAX = 4;
export const LINE_STRENGTH_DEFAULT = 1;

/** One frame's line drive plus the per-band excess behind it (`excess[b]`
 *  is `max(0, bands[b] - line[b])`, before normalizing by headroom) — the
 *  overlay paints this directly to show exactly what's driving `drive`. */
export interface BandLineDrive {
  drive: number;
  excess: Float32Array;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// Reused across calls to avoid a per-frame allocation in the render loop —
// same convention as bandGains.ts's scratchGains.
const scratchExcess = new Float32Array(NUM_BANDS);
const scratchDrive: BandLineDrive = { drive: 0, excess: scratchExcess };

/**
 * Pure — see this file's header for the formula. `bands`/`line` entries are
 * sanitized (non-finite -> 0, clamped to 0..1) so a bad upstream reading can
 * never make the drive disappear or blow up; `strength` non-finite falls
 * back to LINE_STRENGTH_DEFAULT. `out` defaults to a shared scratch object —
 * copy it if you need to hold onto a reading past the next call (AnimFrame's
 * own `lineExcess` does, the same reason `hits` copies bandEnergy's diags).
 */
export function bandLineDrive(
  bands: ArrayLike<number>,
  line: ArrayLike<number>,
  strength: number,
  out: BandLineDrive = scratchDrive,
): BandLineDrive {
  const s = Number.isFinite(strength) ? strength : LINE_STRENGTH_DEFAULT;
  let excessSum = 0;
  let headroomSum = 0;
  for (let b = 0; b < NUM_BANDS; b++) {
    const bandVal = Number.isFinite(bands[b]) ? clamp01(bands[b] as number) : 0;
    const lineVal = Number.isFinite(line[b]) ? clamp01(line[b] as number) : 0;
    const excess = Math.max(0, bandVal - lineVal);
    out.excess[b] = excess;
    excessSum += excess;
    headroomSum += 1 - lineVal;
  }
  out.drive = headroomSum > 0 ? clamp01((s * excessSum) / headroomSum) : 0;
  return out;
}

/** Where an undrawn band sits: the top, excluded — see the file header. */
export const LINE_HEIGHT_DEFAULT = 1;

/** `raw` sanitized into a fresh NUM_BANDS-length line, or null if it isn't
 *  even the right shape (wrong length, not an array at all) — a
 *  missing/wrong-length entry falls back to the caller's own default
 *  (driveStore.ts's stored-line load) rather than partially trusting it.
 *  A present-but-non-numeric entry sanitizes in place to LINE_HEIGHT_DEFAULT
 *  per band instead of failing the whole line. */
export function sanitizeLine(raw: unknown): Float32Array | null {
  if (!Array.isArray(raw) || raw.length !== NUM_BANDS) return null;
  const out = new Float32Array(NUM_BANDS);
  for (let b = 0; b < NUM_BANDS; b++) {
    const v = raw[b];
    out[b] = typeof v === "number" && Number.isFinite(v) ? clamp01(v) : LINE_HEIGHT_DEFAULT;
  }
  return out;
}

export function isDefaultLine(line: ArrayLike<number>): boolean {
  for (let b = 0; b < NUM_BANDS; b++) if (line[b] !== LINE_HEIGHT_DEFAULT) return false;
  return true;
}
