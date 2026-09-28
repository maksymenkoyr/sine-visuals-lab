/**
 * The Master card's "how intense is the picture" readout, and the numbers
 * `tools/master-sweep.mjs` averages across the Scale dial. Neither the Master
 * multiplier (`sceneSettings.ts`'s `getSceneMaster`) nor any scene setting
 * carries a direction ("this makes things more intense") — a scene can wire
 * a slider to grow *or* shrink brightness, motion, whatever it likes — so the
 * only honest way to answer "how intense is it" is to measure the finished
 * PICTURE rather than any input to it. Five measures, each a single number
 * per frame:
 *
 *   Brightness — mean luma.
 *   Colour     — mean chroma (max channel minus min channel), not HSV
 *                saturation: saturation divides chroma by the max channel,
 *                which sends a near-black pixel's tiny noise to "fully
 *                saturated" (ref-scan.py's own `sat` has this problem); a
 *                plain chroma mean doesn't.
 *   Motion     — mean absolute frame-to-frame luma change, with the frame's
 *                *mean* change subtracted out first, so a full-screen
 *                brightness swing (a flash, a fade) reads as Flashes, not
 *                Motion — deliberately different from ref-scan.py's `act`,
 *                which is a plain frame-diff mean and doesn't make that
 *                split.
 *   Detail     — mean gradient magnitude (horizontal + vertical neighbour
 *                luma difference): edges, lines, grain. Measured well
 *                upstream of this file, not from the thumbnail below —
 *                `pictureReadback.ts`'s gradient pass computes it at a fixed
 *                reference resolution (that file's DETAIL_LONG_SIDE,
 *                independent of canvas size or `quality.renderScale`) and
 *                packs the result into the thumbnail's
 *                alpha channel; frameStats below only unpacks it. Needed
 *                because fine texture (a few-pixel-period moiré grating,
 *                thin grain) would already have been averaged into flat grey
 *                by the time the plain thumbnail saw it — see that
 *                file's header for the full reasoning.
 *   Flashes    — the biggest brightness jump between consecutive samples in
 *                the last second.
 *
 * Brightness/Colour/Motion/Flashes are computed from one small downsampled
 * copy of the frame — `pictureReadback.ts`'s thumbnail — sampled at
 * PICTURE_SAMPLE_INTERVAL_MS (15 Hz, matching `tools/ref-scan.py`'s own
 * VIS_FPS: the same rate that tool's motion metrics use, so numbers from the
 * two are comparable); Detail instead arrives already computed, riding along
 * in that same thumbnail's otherwise-idle alpha channel (see its own bullet
 * above). This file is pure (no GL, no DOM) and unit-tested; the readback
 * that feeds it and the device-menu row that displays it live elsewhere.
 *
 * `PictureMeasure.fullScale` is what a display reading of 100 means: display
 * = min(1, raw / fullScale) × 100. Each one is calibrated from a
 * `tools/master-sweep.mjs` run over every free scene (2026-09-28): roughly
 * the 95th percentile of every (scene, Master value) mean, rounded — "about
 * as far as scenes go". Not the maximum: a few scenes sit far past the rest
 * (a strobing Fluid, Moiré's line gratings), and scaling to them would press
 * every other scene into single digits. Those few pin at 100 on the Master
 * card; the sweep report shows them past it. Rerun the sweep and re-derive
 * these after changing how a measure is computed.
 */

export type PictureMeasureKey = "brightness" | "colour" | "motion" | "detail" | "flashes";

export interface PictureMeasure {
  key: PictureMeasureKey;
  label: string;
  /** Raw-unit value a 100 readout means — see the file header. */
  fullScale: number;
  /** Plain-language note — the device menu's hover hint, and the sweep
   *  report's column header. */
  description: string;
}

/** In display order —
 *  everything that renders these (the Master card's Picture block, the sweep
 *  report) walks this array rather than repeating the order by hand. */
export const PICTURE_MEASURES: readonly PictureMeasure[] = [
  {
    key: "brightness",
    label: "Brightness",
    fullScale: 0.75,
    description: "How light the picture is on average.",
  },
  {
    key: "colour",
    label: "Colour",
    fullScale: 0.55,
    description: "How strongly coloured it is, from grey to fully saturated.",
  },
  {
    key: "motion",
    label: "Motion",
    fullScale: 0.13,
    description: "How much of the picture moves from moment to moment. A whole-screen flash counts as Flashes instead.",
  },
  {
    key: "detail",
    label: "Detail",
    fullScale: 0.14,
    description: "How much fine structure there is: edges, lines, grain.",
  },
  {
    key: "flashes",
    label: "Flashes",
    fullScale: 0.3,
    description: "The biggest sudden jump in brightness in the last second.",
  },
];

/** One frame's reading, raw units (not the 0..100 display scale) — `null`
 *  where this frame has no reading for that measure (Motion/Flashes need a
 *  previous sample; see createPictureMeter). */
export type PictureReading = Record<PictureMeasureKey, number | null>;

/** The rate `pictureReadback.ts` is kicked at — see the file header for why
 *  this matches ref-scan.py's VIS_FPS. */
export const PICTURE_SAMPLE_INTERVAL_MS = 1000 / 15;

/** Flashes looks back this far for its biggest jump. */
export const FLASH_WINDOW_MS = 1000;

/** After a gap longer than this between samples (the meter was off, the tab
 *  was hidden), the previous frame is dropped so Motion/Flashes don't compare
 *  frames seconds apart. */
export const PICTURE_GAP_RESET_MS = 500;

/** Per-pixel luma weights — Rec. 709, applied to the gamma-encoded channel
 *  values directly (deliberately not linearised first: this is a measure of
 *  perceived lightness on screen, not radiometric light). */
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

/** Brightness/Colour/Detail for one thumbnail — everything that needs only
 *  this one frame (Motion needs the previous frame too; see motionBetween).
 *  Writes this frame's luma into `lumaOut` (length w*h) so a caller can keep
 *  it around for the next call's Motion compare — `createPictureMeter`'s own
 *  two-buffer swap does exactly that. `px` is RGBA8; alpha is Detail, already
 *  computed and packed in by pictureReadback.ts's gradient pass (see the file
 *  header) — this function only unpacks the mean back out (× 2, undoing that
 *  pass's own × 0.5 packing so an 8-bit channel never clips it), never
 *  re-derives it from neighbour pixels itself. */
export function frameStats(
  px: Uint8Array,
  w: number,
  h: number,
  lumaOut: Float32Array,
): { brightness: number; colour: number; detail: number } {
  const n = w * h;
  if (n <= 0) return { brightness: 0, colour: 0, detail: 0 };

  let sumY = 0;
  let sumChroma = 0;
  let sumAlpha = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const r = px[o]! / 255;
    const g = px[o + 1]! / 255;
    const b = px[o + 2]! / 255;
    const y = LUMA_R * r + LUMA_G * g + LUMA_B * b;
    lumaOut[i] = y;
    sumY += y;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    sumChroma += mx - mn;
    sumAlpha += px[o + 3]!;
  }

  return {
    brightness: sumY / n,
    colour: sumChroma / n,
    detail: (sumAlpha / n / 255) * 2,
  };
}

/** Motion between two same-size luma buffers — mean |d_i - mean(d)|, `d_i =
 *  cur_i - prev_i` — see the file header for why the frame's own mean shift
 *  is subtracted before averaging. */
export function motionBetween(prev: Float32Array, cur: Float32Array, n: number): number {
  if (n <= 0) return 0;
  let sumD = 0;
  for (let i = 0; i < n; i++) sumD += cur[i]! - prev[i]!;
  const meanD = sumD / n;
  let sumAbsDev = 0;
  for (let i = 0; i < n; i++) sumAbsDev += Math.abs(cur[i]! - prev[i]! - meanD);
  return sumAbsDev / n;
}

/** 0..1 display level for a raw reading — `min(1, max(0, raw / fullScale))`;
 *  `null` (no reading yet) stays `null`. The device menu and the sweep
 *  report both multiply this by 100 for their own readouts. */
export function displayLevel(measure: PictureMeasure, raw: number | null): number | null {
  if (raw === null) return null;
  return Math.min(1, Math.max(0, raw / measure.fullScale));
}

/** The Master card's folded Picture block's one combined number — the plain
 *  mean of every measure's display level (displayLevel above), skipping the
 *  ones with no reading yet; null only when none has one. A plain mean
 *  because no measure outranks another in "how intense": a dark, busy frame
 *  and a bright, still one are both somewhere in the middle. */
export function overallLevel(levels: readonly (number | null)[]): number | null {
  let sum = 0;
  let n = 0;
  for (const v of levels) {
    if (v === null) continue;
    sum += v;
    n++;
  }
  return n > 0 ? sum / n : null;
}

/** Feeds one thumbnail per call, in order, and keeps exactly the state the
 *  next call's Motion/Flashes need — see createPictureMeter. */
export interface PictureMeter {
  /** Feed one thumbnail captured at `atMs`. Returns (and keeps) this sample's
   *  reading. */
  push(px: Uint8Array, w: number, h: number, atMs: number): PictureReading;
  /** The last reading push() produced, or null before the first push. */
  latest(): PictureReading | null;
  /** Time of the latest push, or -Infinity before the first one. */
  readonly lastAtMs: number;
}

/** One flash-window sample — just enough to find the biggest brightness jump
 *  in the trailing FLASH_WINDOW_MS (see pollFlash below). */
interface FlashSample {
  atMs: number;
  brightness: number;
}

/** The biggest `max(0, brightness[k] - brightness[k-1])` over consecutive
 *  pairs in `history` — null until there are at least two samples. */
function biggestJump(history: readonly FlashSample[]): number | null {
  if (history.length < 2) return null;
  let biggest = 0;
  for (let i = 1; i < history.length; i++) {
    const d = history[i]!.brightness - history[i - 1]!.brightness;
    if (d > biggest) biggest = d;
  }
  return biggest;
}

export function createPictureMeter(): PictureMeter {
  // Two luma buffers, swapped each push so "the previous frame's luma" and
  // "this frame's luma" are never the same array — reallocated only when the
  // thumbnail's own size changes (physarum2.ts's territory readback follows
  // the same reallocate-on-size-change discipline for its own textures).
  let lumaA: Float32Array | null = null;
  let lumaB: Float32Array | null = null;
  // Points at whichever of lumaA/lumaB holds the previous push's luma; null
  // means "no valid previous frame" (first push, a size change, or a gap —
  // see the file header's PICTURE_GAP_RESET_MS).
  let prevLuma: Float32Array | null = null;
  let curW = 0;
  let curH = 0;
  let lastAtMsVal = -Infinity;
  let latestReading: PictureReading | null = null;
  const flashHistory: FlashSample[] = [];

  return {
    push(px, w, h, atMs) {
      const sizeChanged = w !== curW || h !== curH;
      const gap = atMs - lastAtMsVal > PICTURE_GAP_RESET_MS;
      if (sizeChanged) {
        lumaA = new Float32Array(Math.max(1, w * h));
        lumaB = new Float32Array(Math.max(1, w * h));
        curW = w;
        curH = h;
        prevLuma = null;
        flashHistory.length = 0;
      } else if (gap) {
        prevLuma = null;
        flashHistory.length = 0;
      }

      const target = prevLuma === lumaA ? lumaB! : lumaA!;
      const stats = frameStats(px, w, h, target);
      // Scaled to one nominal PICTURE_SAMPLE_INTERVAL_MS step: samples land
      // on whole render frames, so their real spacing wobbles with the frame
      // rate (a 50 fps render samples every 60 ms, a 40 fps one every 75 ms),
      // and an unscaled diff would read a slower device as more motion.
      const dt = atMs - lastAtMsVal;
      const motion = prevLuma && dt > 0 ? motionBetween(prevLuma, target, w * h) * (PICTURE_SAMPLE_INTERVAL_MS / dt) : null;

      flashHistory.push({ atMs, brightness: stats.brightness });
      while (flashHistory.length > 0 && atMs - flashHistory[0]!.atMs > FLASH_WINDOW_MS) flashHistory.shift();
      const flashes = biggestJump(flashHistory);

      prevLuma = target;
      lastAtMsVal = atMs;
      const reading: PictureReading = {
        brightness: stats.brightness,
        colour: stats.colour,
        detail: stats.detail,
        motion,
        flashes,
      };
      latestReading = reading;
      return reading;
    },
    latest: () => latestReading,
    get lastAtMs(): number {
      return lastAtMsVal;
    },
  };
}

/** Running mean of each measure since the last reset(), skipping nulls —
 *  what `tools/master-sweep.mjs` reads after letting a (scene, master value)
 *  settle. `count` is the number of add() calls, not a per-measure count —
 *  a measure that happened to be null on every call still shows a `count`,
 *  just with a null mean(). */
export interface PictureAverager {
  add(r: PictureReading): void;
  mean(): PictureReading;
  readonly count: number;
  reset(): void;
}

export function createPictureAverager(): PictureAverager {
  let callCount = 0;
  const sums: Record<PictureMeasureKey, number> = { brightness: 0, colour: 0, motion: 0, detail: 0, flashes: 0 };
  const nonNullCounts: Record<PictureMeasureKey, number> = { brightness: 0, colour: 0, motion: 0, detail: 0, flashes: 0 };

  return {
    add(r) {
      callCount++;
      for (const m of PICTURE_MEASURES) {
        const v = r[m.key];
        if (v === null) continue;
        sums[m.key] += v;
        nonNullCounts[m.key]++;
      }
    },
    mean() {
      const out = {} as PictureReading;
      for (const m of PICTURE_MEASURES) {
        out[m.key] = nonNullCounts[m.key] > 0 ? sums[m.key] / nonNullCounts[m.key] : null;
      }
      return out;
    },
    get count(): number {
      return callCount;
    },
    reset() {
      callCount = 0;
      for (const m of PICTURE_MEASURES) {
        sums[m.key] = 0;
        nonNullCounts[m.key] = 0;
      }
    },
  };
}
