import { NUM_BANDS } from "../audio/types.ts";
import { formatHz } from "../audio/bandScale.ts";
import type { BandSplit } from "../audio/bandSplit.ts";
import { FONT_MONO, STRIP_HIGH, STRIP_LOW, STRIP_MID } from "./controlsTheme.ts";

/**
 * Live spectrum analyser strip for the controls panel — the "can I see what
 * I'm about to tune" view that src/ui/deviceMenu.ts's sliders otherwise
 * lack. Draws the same 24 log-spaced bands the audio pipeline already
 * computes (src/audio/types.ts's FeatureFrame.bands), tinted by which
 * low/mid/high group each band currently falls under.
 *
 * Two feeds are supplied every tick by update(): the processed signal
 * (default — whatever's actually driving the visuals this frame) and the
 * raw mic signal (literally what's hitting the analyser, no adaptive
 * envelope, no sensitivity gain). setShowRaw() picks which one is drawn;
 * the toggle UI itself lives in the panel's spectrum card header. Both feeds
 * are copied into this component's own buffers immediately, so it's safe
 * even though callers reuse scratch arrays across frames.
 *
 * Plain 2D canvas, not WebGL — the gallery's preview tiles already spend a
 * GL context each; a bar chart doesn't need one. The canvas is transparent:
 * the glass card around it supplies the background.
 */

export interface SpectrumStrip {
  el: HTMLElement;
  /** Real Hz edges for this ladder (length NUM_BANDS + 1), from the analyser
   *  once mic access exists, or the nominal ladder before that. */
  setEdgesHz(edges: Float32Array): void;
  setSplit(split: BandSplit): void;
  /** "Listening post": true draws the raw mic feed, false (default) the
   *  processed feed the visuals actually see. */
  setShowRaw(on: boolean): void;
  showRaw(): boolean;
  /** Called every tick with both feeds; either may be null (raw: no local
   *  analyser yet, e.g. mic pending or a mic-less renderer device; processed:
   *  audio not yet flowing at all). An idle "waiting for audio" state shows
   *  if the selected one's null. */
  update(raw: Float32Array | null, processed: Float32Array | null): void;
}

const HEIGHT_CSS_PX = 50;
const AXIS_HEIGHT_CSS_PX = 16;
const BAR_GAP_PX = 2;
const BAR_RADIUS_PX = 1;
const PEAK_FALL_PER_SEC = 1.2; // slow decay so a transient kick is still visible a few frames later

const AXIS_TICKS_HZ = [100, 1000, 10000];

function groupColor(index: number, split: BandSplit): string {
  if (index < split.lowMid) return STRIP_LOW;
  if (index < split.midHigh) return STRIP_MID;
  return STRIP_HIGH;
}

// Height is fixed up front so the card is the right size before the first
// draw (which only happens once update() starts being fed, inside a viz).
const canvasStyle = `display: block; width: 100%; height: ${HEIGHT_CSS_PX + AXIS_HEIGHT_CSS_PX}px;`;

export function createSpectrumStrip(): SpectrumStrip {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = canvasStyle;

  const ctx = canvas.getContext("2d")!;

  let edgesHz: Float32Array = new Float32Array(0);
  let split: BandSplit = { lowMid: 6, midHigh: 16 };
  let lastDrawMs: number | null = null;
  let showRaw = false;

  // Both feeds are copied into these on every update() — never aliased to a
  // caller's array — since app.ts/deviceMenu.ts reuse scratch buffers across
  // frames and this component needs to hold values steady between ticks
  // (e.g. while the panel briefly stops receiving updates).
  const rawBuf = new Float32Array(NUM_BANDS);
  const processedBuf = new Float32Array(NUM_BANDS);
  let hasRaw = false;
  let hasProcessed = false;
  const peaksRaw = new Float32Array(NUM_BANDS);
  const peaksProcessed = new Float32Array(NUM_BANDS);

  // devicePixelRatio-scaled backing store, resized whenever the card's
  // layout width changes (the panel's column widths differ between the
  // two-column and stacked layouts — see controlsTheme.ts).
  let cssWidth = 0;
  function ensureSize(): void {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    if (w === cssWidth) return;
    cssWidth = w;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round((HEIGHT_CSS_PX + AXIS_HEIGHT_CSS_PX) * dpr);
    canvas.style.height = `${HEIGHT_CSS_PX + AXIS_HEIGHT_CSS_PX}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Bands are drawn evenly spaced (not log-positioned by Hz) so every bar
  // gets a readable width — the log spacing is already baked into what each
  // band index *means* in Hz, which the axis labels below show instead.
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

  function drawBars(width: number, plotHeight: number, dtSec: number): void {
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
      const v = Math.min(1, Math.max(0, bands[b]));
      peaks[b] = Math.max(v, peaks[b] - PEAK_FALL_PER_SEC * dtSec);

      const x = xForEdgeIndex(b, width);
      const barH = v * plotHeight;
      ctx.fillStyle = groupColor(b, split);
      fillBar(x, plotHeight - barH, barWidth, barH);

      // Peak-hold cap.
      const peakY = plotHeight - peaks[b] * plotHeight;
      ctx.fillRect(x, peakY, barWidth, 1.5);
    }
  }

  function drawAxis(width: number, plotHeight: number): void {
    if (edgesHz.length !== NUM_BANDS + 1) return;
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.font = `11px ${FONT_MONO}`;
    ctx.textBaseline = "bottom";
    const maxHz = edgesHz[NUM_BANDS];
    const minHz = edgesHz[0];
    const y = plotHeight + AXIS_HEIGHT_CSS_PX;
    for (const hz of AXIS_TICKS_HZ) {
      if (hz <= minHz || hz >= maxHz) continue;
      const t = Math.log(hz / minHz) / Math.log(maxHz / minHz);
      const label = formatHz(hz);
      const labelWidth = ctx.measureText(label).width;
      const x = Math.min(width - labelWidth, Math.max(0, t * width - labelWidth / 2));
      ctx.fillText(label, x, y);
    }
  }

  function draw(nowMs: number): void {
    ensureSize();
    const width = cssWidth;
    const plotHeight = HEIGHT_CSS_PX;
    ctx.clearRect(0, 0, width, plotHeight + AXIS_HEIGHT_CSS_PX);

    const dtSec = lastDrawMs === null ? 1 / 60 : Math.max(1e-4, (nowMs - lastDrawMs) / 1000);
    lastDrawMs = nowMs;

    drawBars(width, plotHeight, dtSec);
    drawAxis(width, plotHeight);
  }

  function requestRedraw(): void {
    if (!canvas.isConnected) return;
    draw(performance.now());
  }

  return {
    el: canvas,
    setEdgesHz(edges: Float32Array): void {
      edgesHz = edges;
    },
    setSplit(next: BandSplit): void {
      split = next;
    },
    setShowRaw(on: boolean): void {
      showRaw = on;
      requestRedraw();
    },
    showRaw: () => showRaw,
    update(raw: Float32Array | null, processed: Float32Array | null): void {
      hasRaw = !!raw;
      if (raw) rawBuf.set(raw);
      hasProcessed = !!processed;
      if (processed) processedBuf.set(processed);
      requestRedraw();
    },
  };
}
