import { NUM_BANDS } from "./types.ts";
import { createPerSceneSetting } from "./sensitivity.ts";

/**
 * The sensitivity line: a drawn shape over the band ladder — one height per
 * band, 0..1 — that turns "is the spectrum loud" into "how far above the
 * shape I drew is the spectrum". A band's *headroom* is `1 - line[b]`: how
 * much room is left above the line for signal to stand out in. A band drawn
 * to the very top (1) has no headroom and is excluded entirely — however
 * loud it gets, it can never drive anything. A band left at the bottom (0)
 * is fully in: its whole reading counts.
 *
 * bandLineDrive() reduces the whole line to one number per frame: the
 * fraction of the line's total headroom the signal currently fills.
 *
 *   excess_b = max(0, bands[b] - line[b])
 *   drive    = clamp01( strength * Σ excess_b / Σ (1 - line[b]) )   (0 if Σ headroom is 0)
 *
 * With the line flat at 0 and strength 1 this is exactly
 * FeatureFrame.energy (the mean of every band) — the line generalises
 * energy into "energy above a shape you drew". Near the line, a band
 * contributes almost nothing; far above it, the same band dominates.
 * `strength` scales the whole ratio and can push it all the way to the 1
 * ceiling — the "include maximum" half of the overall-strength slider.
 *
 * Storage is per-scene, same cache-over-localStorage pattern as
 * bandGains.ts/silenceGate.ts: the cache is the source of truth for get/set
 * within a session, seeded once from localStorage, so behavior stays
 * correct even where localStorage is unavailable (node test env, Safari
 * private mode). The line itself lives under one key ("vibe.bandLine",
 * `{ [sceneId]: number[] }`, sanitized on load — a missing/wrong-length/
 * non-numeric entry falls back to the default flat-0 line rather than
 * partially trusting it); the overall-strength dial is a plain
 * createPerSceneSetting float, the same shape sensitivity.ts's own rows use.
 *
 * UI is src/ui/bandLineEditor.ts, drawn over a second spectrum strip inside
 * deviceMenu.ts's Line card. Reaches the render path via
 * src/render/animClock.ts's `line` param (AnimFrame.lineDrive/lineExcess)
 * and, from there, the global `uLineDrive` uniform in sceneCommon.ts — see
 * that file's header for how a scene opts in. First consumer: Caustics'
 * `sparkleLine` setting.
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

// ---- Store: the drawn line, per scene ------------------------------------

const STORAGE_KEY_LINE = "vibe.bandLine";

function sanitizeLine(raw: unknown): Float32Array | null {
  if (!Array.isArray(raw) || raw.length !== NUM_BANDS) return null;
  const out = new Float32Array(NUM_BANDS);
  for (let b = 0; b < NUM_BANDS; b++) {
    const v = raw[b];
    out[b] = typeof v === "number" && Number.isFinite(v) ? clamp01(v) : 0;
  }
  return out;
}

// In-memory cache is the source of truth for get/set within a session,
// seeded once from localStorage below — same reasoning as
// sensitivity.ts's createPerSceneSetting. Holds already-sanitized arrays
// (not raw JSON) so getBandLine never has to re-parse or re-clamp on the
// hot per-frame path.
const lineCache = new Map<string, Float32Array>();

function loadLineCache(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LINE);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    for (const sceneId of Object.keys(parsed)) {
      const sanitized = sanitizeLine(parsed[sceneId]);
      if (sanitized) lineCache.set(sceneId, sanitized);
    }
  } catch {
    // Not fatal — every scene just starts at the default flat-0 line.
  }
}
loadLineCache();

function persistLine(): void {
  try {
    const obj: Record<string, number[]> = {};
    for (const [sceneId, heights] of lineCache) obj[sceneId] = Array.from(heights);
    localStorage.setItem(STORAGE_KEY_LINE, JSON.stringify(obj));
  } catch {
    // Not fatal — the line just won't persist across reloads.
  }
}

// Default view for a scene that's never been drawn on: flat 0, all bands
// fully in — see this file's header for what that means for the drive
// formula (identical to FeatureFrame.energy at strength 1).
const scratchLine = new Float32Array(NUM_BANDS);

/** This scene's drawn line, written into `out` (default: a shared scratch —
 *  copy if you need to hold onto it). A scene that's never been drawn on,
 *  or whose stored entry didn't sanitize (see sanitizeLine), reads as flat 0. */
export function getBandLine(sceneId: string, out: Float32Array = scratchLine): Float32Array {
  const stored = lineCache.get(sceneId);
  if (stored) out.set(stored);
  else out.fill(0);
  return out;
}

export function setBandLineBand(sceneId: string, band: number, height: number): void {
  if (!Number.isInteger(band) || band < 0 || band >= NUM_BANDS) return;
  let heights = lineCache.get(sceneId);
  if (!heights) {
    heights = new Float32Array(NUM_BANDS);
    lineCache.set(sceneId, heights);
  }
  heights[band] = Number.isFinite(height) ? clamp01(height) : 0;
  persistLine();
}

export function setBandLine(sceneId: string, heights: ArrayLike<number>): void {
  const next = new Float32Array(NUM_BANDS);
  for (let b = 0; b < NUM_BANDS; b++) {
    const v = heights[b];
    next[b] = Number.isFinite(v) ? clamp01(v) : 0;
  }
  lineCache.set(sceneId, next);
  persistLine();
}

/** Back to flat 0 — the Line card's Reset chip (alongside
 *  resetBandLineStrength below). */
export function resetBandLine(sceneId: string): void {
  lineCache.delete(sceneId);
  persistLine();
}

export function isDefaultLine(line: ArrayLike<number>): boolean {
  for (let b = 0; b < NUM_BANDS; b++) if (line[b] !== 0) return false;
  return true;
}

// ---- Store: overall strength, per scene -----------------------------------

const lineStrengthStore = createPerSceneSetting(
  "vibe.bandLineStrength",
  LINE_STRENGTH_MIN,
  LINE_STRENGTH_MAX,
  LINE_STRENGTH_DEFAULT,
);
export const getBandLineStrength = lineStrengthStore.get;
export const setBandLineStrength = lineStrengthStore.set;
export function resetBandLineStrength(sceneId: string): void {
  lineStrengthStore.set(sceneId, LINE_STRENGTH_DEFAULT);
}
