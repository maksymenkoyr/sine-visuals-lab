import { NUM_BANDS } from "../audio/types.ts";
import { BAND_SPLIT } from "../audio/bandSplit.ts";
import { bandIndexCentroid } from "../render/spectralCentroid.ts";
import { createCanvasSizer } from "./canvasSizer.ts";
import { AUTO_SKY, FONT_MONO, STRIP_HIGH, STRIP_LOW, STRIP_MID, withAlpha } from "./controlsTheme.ts";

/**
 * The Sound card's thin live spectrum (audioMeters.ts): the log-spaced bands
 * the audio pipeline already computes (src/audio/types.ts's
 * FeatureFrame.bands), tinted by which low/mid/high group each band currently
 * falls under, with a sky-blue marker on the spectral centroid.
 *
 * Feeds, copied into this component's own buffers on arrival (callers reuse
 * scratch arrays across frames):
 *  - processed (default view): whatever's actually driving the visuals this
 *    frame, sensitivity applied;
 *  - raw ("listening post", setShowRaw): literally what's hitting the
 *    analyser — no adaptive envelope, no sensitivity.
 *
 * The centroid marker (spectralCentroid.ts's exported bandIndexCentroid, the
 * same formula AnimFrame.centroid is built from) is computed fresh each draw
 * against whichever buffer is actually on screen, not read from AnimFrame. It
 * has to be: this chart's x-axis is one column per band index, so the centroid
 * has a literal, checkable position on it — "where the bars' mass balances" —
 * and that's only true against the exact bars currently drawn. AnimFrame.centroid
 * is derived from a different buffer mid-pipeline and is range-adapted
 * besides, so it has no x-position on this axis at all.
 *
 * Plain 2D canvas, not WebGL — the gallery's preview tiles already spend a GL
 * context each; a bar chart doesn't need one. The canvas is transparent: the
 * glass card around it supplies the background. It redraws only when told to
 * (update() each audio tick, or redraw() after a highlight change) — there's
 * no rAF loop of its own.
 */

export interface SpectrumStrip {
  el: HTMLCanvasElement;
  /** "Listening post": true draws the raw mic feed, false (default) the
   *  processed feed the visuals actually see. */
  setShowRaw(on: boolean): void;
  /** Bands `[lo, hi)` to highlight — every band outside the range dims,
   *  answering "which frequencies does this setting actually listen to"
   *  while a signal-linked control is being touched (deviceMenu.ts). `null`
   *  clears it back to the normal, undimmed view. Only updates the held
   *  state — call redraw() after to actually repaint, since a hover/hotkey
   *  doesn't come with a new audio tick. */
  setHighlight(range: { lo: number; hi: number } | null): void;
  /** Called every tick with both feeds; either may be null (raw: no local
   *  analyser yet, e.g. mic pending or a mic-less renderer device; processed:
   *  audio not yet flowing at all). An idle "waiting for audio" state shows
   *  if the selected one's null. Draws. */
  update(raw: Float32Array | null, processed: Float32Array | null): void;
  /** Redraw from the held buffers — for changes that don't come with a new
   *  audio tick. */
  redraw(): void;
}

const BAR_GAP_PX = 2;
const BAR_RADIUS_PX = 1;
const PEAK_FALL_PER_SEC = 1.2; // slow decay so a transient kick is still visible a few frames later
const DIM_ALPHA = 0.22; // a band outside the current highlight range
const CENTROID_FLAG_W = 8;
const CENTROID_FLAG_H = 6;

function groupColor(index: number): string {
  if (index < BAND_SPLIT.lowMid) return STRIP_LOW;
  if (index < BAND_SPLIT.midHigh) return STRIP_MID;
  return STRIP_HIGH;
}

interface SpectrumStripOptions {
  /** Plot height in CSS px. */
  plotHeightPx: number;
}

export function createSpectrumStrip(opts: SpectrumStripOptions): SpectrumStrip {
  const plotHeight = opts.plotHeightPx;
  const canvas = document.createElement("canvas");
  // Height is fixed up front so the card is the right size before the first
  // draw (which only happens once update() starts being fed, inside a viz).
  canvas.style.cssText = `display: block; width: 100%; height: ${plotHeight}px;`;

  const ctx = canvas.getContext("2d")!;

  let lastDrawMs: number | null = null;
  let showRaw = false;

  const rawBuf = new Float32Array(NUM_BANDS);
  const processedBuf = new Float32Array(NUM_BANDS);
  let hasRaw = false;
  let hasProcessed = false;
  const peaksRaw = new Float32Array(NUM_BANDS);
  const peaksProcessed = new Float32Array(NUM_BANDS);

  let highlight: { lo: number; hi: number } | null = null;

  // devicePixelRatio-scaled backing store, resized whenever the card's
  // layout width changes. ensure() is false while the canvas has no layout
  // (the panel is closed, display: none) — a draw then would size the backing
  // store to a pixel and get stretched across the card when it opens. See
  // canvasSizer.ts.
  const sizer = createCanvasSizer(canvas, ctx, { heightCssPx: plotHeight });

  // Bands are drawn evenly spaced (not log-positioned by Hz) so every bar
  // gets a readable width.
  function xForEdgeIndex(index: number, width: number): number {
    return (index / NUM_BANDS) * width;
  }

  function fillBar(x: number, y: number, w: number, h: number): void {
    if (h <= 0) return;
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, BAR_RADIUS_PX);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, w, h);
    }
  }

  function drawBars(width: number, dtSec: number): void {
    const bands = showRaw ? rawBuf : processedBuf;
    const hasData = showRaw ? hasRaw : hasProcessed;
    const peaks = showRaw ? peaksRaw : peaksProcessed;

    if (!hasData) {
      // Idle state: no bars — signals "no audio yet" rather than faking a
      // silent-but-present spectrum.
      ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
      ctx.font = `11px ${FONT_MONO}`;
      ctx.textBaseline = "middle";
      ctx.fillText("waiting for audio…", 0, plotHeight / 2);
      return;
    }

    const barWidth = Math.max(1, width / NUM_BANDS - BAR_GAP_PX);

    for (let b = 0; b < NUM_BANDS; b++) {
      const x = xForEdgeIndex(b, width);
      const groupCol = groupColor(b);
      // Outside a highlighted range, a band dims to its group tint at low
      // alpha regardless of level — "not one of the bands this control
      // listens to" reads the same whether that band is loud or silent.
      const inHighlight = !highlight || (b >= highlight.lo && b < highlight.hi);
      const color = inHighlight ? groupCol : withAlpha(groupCol, DIM_ALPHA);

      const v = Math.min(1, Math.max(0, bands[b]));
      peaks[b] = Math.max(v, peaks[b] - PEAK_FALL_PER_SEC * dtSec);
      const barH = v * plotHeight;
      ctx.fillStyle = color;
      fillBar(x, plotHeight - barH, barWidth, barH);

      const peakY = plotHeight - peaks[b] * plotHeight;
      ctx.fillStyle = color;
      ctx.fillRect(x, peakY, barWidth, 1.5);
    }
  }

  // Tracks whichever buffer drawBars is currently showing rather than a value
  // passed in, so toggling RAW moves the marker in lockstep with the bars
  // it's describing.
  function drawCentroidMarker(width: number): void {
    const bands = showRaw ? rawBuf : processedBuf;
    const hasData = showRaw ? hasRaw : hasProcessed;
    if (!hasData) return;
    const t = bandIndexCentroid(bands);
    if (t === null) return;

    // t runs 0..1 over band indices 0..NUM_BANDS-1, so it names the *centre*
    // of a bar: index i is drawn from xForEdgeIndex(i) and is barWidth (the
    // slot minus BAR_GAP_PX) wide, so its centre sits half a slot in, less
    // half the gap. Mapping t straight to the strip width would land half a
    // slot left of the bars' balance point at the low end and half a slot
    // right at the high end.
    const x = xForEdgeIndex(t * (NUM_BANDS - 1) + 0.5, width) - BAR_GAP_PX / 2;
    ctx.strokeStyle = withAlpha(AUTO_SKY, 0.85);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, plotHeight);
    ctx.stroke();

    ctx.fillStyle = AUTO_SKY;
    ctx.beginPath();
    ctx.moveTo(x - CENTROID_FLAG_W / 2, 0);
    ctx.lineTo(x + CENTROID_FLAG_W / 2, 0);
    ctx.lineTo(x, CENTROID_FLAG_H);
    ctx.closePath();
    ctx.fill();
  }

  function draw(nowMs: number): void {
    if (!sizer.ensure()) return;
    const width = sizer.width;
    ctx.clearRect(0, 0, width, plotHeight);

    const dtSec = lastDrawMs === null ? 1 / 60 : Math.max(1e-4, (nowMs - lastDrawMs) / 1000);
    lastDrawMs = nowMs;

    drawBars(width, dtSec);
    drawCentroidMarker(width);
  }

  function requestRedraw(): void {
    if (!canvas.isConnected) return;
    draw(performance.now());
  }

  return {
    el: canvas,
    setShowRaw(on: boolean): void {
      showRaw = on;
      requestRedraw();
    },
    setHighlight(range: { lo: number; hi: number } | null): void {
      highlight = range;
    },
    update(raw: Float32Array | null, processed: Float32Array | null): void {
      hasRaw = !!raw;
      if (raw) rawBuf.set(raw);
      hasProcessed = !!processed;
      if (processed) processedBuf.set(processed);
      requestRedraw();
    },
    redraw: requestRedraw,
  };
}
