import { NUM_BANDS } from "../audio/types.ts";
import { formatHz } from "../audio/bandScale.ts";
import type { BandSplit } from "../audio/bandSplit.ts";
import { BAND_FADER_COUNT, BAND_GAIN_MIN, FADER_CENTER_POS, faderWeights, gainToFaderPos } from "../audio/bandGains.ts";
import { BANDS_AMBER, FADER_OFF, FONT_MONO, STRIP_HIGH, STRIP_LOW, STRIP_MID, withAlpha } from "./controlsTheme.ts";

/**
 * Live spectrum analyser strip for the controls panel, with the band faders
 * drawn over it — the "can I see what I'm about to tune" view and the
 * tuning itself on the same pixels. Draws the log-spaced bands the audio
 * pipeline already computes (src/audio/types.ts's FeatureFrame.bands),
 * tinted by which low/mid/high group each band currently falls under, and
 * on top of them one fader per entry of the gain bank in
 * src/audio/bandGains.ts: a rail, a knob, and a filled travel from the 1×
 * centre line to wherever the knob sits.
 *
 * Drawing only — the faders' pointer/keyboard handling and readouts live in
 * src/ui/bandFaders.ts, which owns this canvas and tells it what to draw
 * via setFaders/setFocused. This split keeps the canvas free of DOM
 * concerns and the interaction free of pixel math.
 *
 * Feeds, all copied into this component's own buffers on arrival (callers
 * reuse scratch arrays across frames):
 *  - processed (default view): whatever's actually driving the visuals this
 *    frame, faders and sensitivity applied;
 *  - raw ("listening post", setShowRaw): literally what's hitting the
 *    analyser — no adaptive envelope, no gain, no sensitivity;
 *  - ghost: the processed signal *without* the faders, drawn faintly behind
 *    any bar whose fader weight isn't 1 — so a cut shows what it took away
 *    and a boost what it added;
 *  - pinned: which bands the gain stage clamped this frame (bandGains.ts's
 *    pinnedBands); their peak cap turns white, the one cue that a boost has
 *    stopped doing anything.
 *
 * Plain 2D canvas, not WebGL — the gallery's preview tiles already spend a
 * GL context each; a bar chart doesn't need one. The canvas is transparent:
 * the glass card around it supplies the background. It redraws only when
 * told to (update() each audio tick, or redraw() after a fader moves) —
 * there's no rAF loop of its own.
 */

export interface SpectrumStrip {
  el: HTMLCanvasElement;
  /** Real Hz edges for this ladder (length NUM_BANDS + 1), from the analyser
   *  once mic access exists, or the nominal ladder before that. */
  setEdgesHz(edges: Float32Array): void;
  setSplit(split: BandSplit): void;
  /** "Listening post": true draws the raw mic feed, false (default) the
   *  processed feed the visuals actually see. */
  setShowRaw(on: boolean): void;
  showRaw(): boolean;
  /** The fader bank's current gains — drives the knobs and which bars get a
   *  ghost. Copied. */
  setFaders(gains: ArrayLike<number>): void;
  /** Which fader is grabbed or focused (-1: none) — its knob fills solid. */
  setFocused(index: number): void;
  /** Bands `[lo, hi)` to highlight — every band outside the range dims,
   *  answering "which frequencies does this setting actually listen to"
   *  while a signal-linked control is being touched (deviceMenu.ts). `null`
   *  clears it back to the normal, undimmed view. Like setFocused, this
   *  only updates the held state — call redraw() after to actually repaint,
   *  since a hover/hotkey doesn't come with a new audio tick. */
  setHighlight(range: { lo: number; hi: number } | null): void;
  /** Called every tick with both feeds; either may be null (raw: no local
   *  analyser yet, e.g. mic pending or a mic-less renderer device; processed:
   *  audio not yet flowing at all). An idle "waiting for audio" state shows
   *  if the selected one's null. Draws. */
  update(raw: Float32Array | null, processed: Float32Array | null): void;
  /** The un-faded processed signal, set *before* update() each tick. */
  setGhost(bands: Float32Array | null): void;
  setPinned(mask: Uint8Array | null): void;
  /** Redraw from the held buffers — for changes that don't come with a new
   *  audio tick (a fader drag while the feed is idle, focus moving). */
  redraw(): void;
}

/** Fader travel, in CSS px — tall enough to drag with a thumb. The faders'
 *  hit areas in bandFaders.ts are sized from this. */
export const STRIP_PLOT_HEIGHT_PX = 120;
export const STRIP_AXIS_HEIGHT_PX = 16;
const BAR_GAP_PX = 2;
const BAR_RADIUS_PX = 1;
const PEAK_FALL_PER_SEC = 1.2; // slow decay so a transient kick is still visible a few frames later
const GHOST_ALPHA = 0.18;
const DIM_ALPHA = 0.22; // a band outside the current highlight range
const KNOB_W = 16;
const KNOB_H = 10;

const AXIS_TICKS_HZ = [100, 1000, 10000];

function groupColor(index: number, split: BandSplit): string {
  if (index < split.lowMid) return STRIP_LOW;
  if (index < split.midHigh) return STRIP_MID;
  return STRIP_HIGH;
}

// Height is fixed up front so the card is the right size before the first
// draw (which only happens once update() starts being fed, inside a viz).
const canvasStyle = `display: block; width: 100%; height: ${STRIP_PLOT_HEIGHT_PX + STRIP_AXIS_HEIGHT_PX}px;`;

export function createSpectrumStrip(): SpectrumStrip {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = canvasStyle;

  const ctx = canvas.getContext("2d")!;

  let edgesHz: Float32Array = new Float32Array(0);
  let split: BandSplit = { lowMid: 6, midHigh: 16 };
  let lastDrawMs: number | null = null;
  let showRaw = false;

  // Every feed is copied into these on arrival — never aliased to a caller's
  // array — since app.ts/deviceMenu.ts reuse scratch buffers across frames
  // and this component needs to hold values steady between ticks (e.g.
  // while the panel briefly stops receiving updates).
  const rawBuf = new Float32Array(NUM_BANDS);
  const processedBuf = new Float32Array(NUM_BANDS);
  const ghostBuf = new Float32Array(NUM_BANDS);
  const pinnedBuf = new Uint8Array(NUM_BANDS);
  let hasRaw = false;
  let hasProcessed = false;
  let hasGhost = false;
  const peaksRaw = new Float32Array(NUM_BANDS);
  const peaksProcessed = new Float32Array(NUM_BANDS);

  const gains = new Float32Array(BAND_FADER_COUNT).fill(1);
  const weights = new Float32Array(NUM_BANDS).fill(1);
  let focused = -1;
  let highlight: { lo: number; hi: number } | null = null;

  // devicePixelRatio-scaled backing store, resized whenever the card's
  // layout width changes (the panel's column widths differ between the
  // two-column and stacked layouts — see controlsTheme.ts).
  let cssWidth = 0;
  /** False while the canvas has no layout (the panel is closed, display:
   *  none) — a draw then would size the backing store to a pixel and get
   *  stretched across the card when it opens. */
  function ensureSize(): boolean {
    const rect = canvas.getBoundingClientRect();
    const w = Math.round(rect.width);
    if (w <= 0) return false;
    if (w === cssWidth) return true;
    cssWidth = w;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round((STRIP_PLOT_HEIGHT_PX + STRIP_AXIS_HEIGHT_PX) * dpr);
    canvas.style.height = `${STRIP_PLOT_HEIGHT_PX + STRIP_AXIS_HEIGHT_PX}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  // Bands are drawn evenly spaced (not log-positioned by Hz) so every bar
  // gets a readable width — the log spacing is already baked into what each
  // band index *means* in Hz, which the axis labels below show instead. A
  // fader's column is the same even split, so its span of bands lines up
  // under it exactly.
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
      // silent-but-present spectrum. The faders still draw over it.
      ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
      ctx.font = `11px ${FONT_MONO}`;
      ctx.textBaseline = "middle";
      ctx.fillText("waiting for audio…", 0, plotHeight / 2);
      return;
    }

    const barWidth = Math.max(1, width / NUM_BANDS - BAR_GAP_PX);
    const showGhost = !showRaw && hasGhost;

    for (let b = 0; b < NUM_BANDS; b++) {
      const x = xForEdgeIndex(b, width);
      const groupCol = groupColor(b, split);
      // Outside a highlighted range, a band dims to its group tint at low
      // alpha regardless of level — "not one of the bands this control
      // listens to" reads the same whether that band is loud or silent.
      const inHighlight = !highlight || (b >= highlight.lo && b < highlight.hi);
      const color = inHighlight ? groupCol : withAlpha(groupCol, DIM_ALPHA);

      // What this bar would be with its fader at 1× — only where a fader is
      // actually doing something, so a flat bank draws nothing extra.
      if (showGhost && Math.abs(weights[b] - 1) > 0.01) {
        const g = Math.min(1, Math.max(0, ghostBuf[b]));
        ctx.fillStyle = withAlpha(color, GHOST_ALPHA);
        fillBar(x, plotHeight - g * plotHeight, barWidth, g * plotHeight);
      }

      const v = Math.min(1, Math.max(0, bands[b]));
      peaks[b] = Math.max(v, peaks[b] - PEAK_FALL_PER_SEC * dtSec);
      const barH = v * plotHeight;
      ctx.fillStyle = color;
      fillBar(x, plotHeight - barH, barWidth, barH);

      // Peak-hold cap; white while the gain stage is clamping this band —
      // except a dimmed band, where the white cap would fight the "this
      // doesn't matter right now" read the dim is making.
      const peakY = plotHeight - peaks[b] * plotHeight;
      ctx.fillStyle = !showRaw && pinnedBuf[b] && inHighlight ? "#fff" : color;
      ctx.fillRect(x, peakY, barWidth, 1.5);
    }
  }

  function drawFaders(width: number, plotHeight: number): void {
    const colWidth = width / BAND_FADER_COUNT;
    const centerY = plotHeight - FADER_CENTER_POS * plotHeight;

    // The 1× line every fader rests on — "flat" is visible at a glance.
    ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(0, centerY + 0.5);
    ctx.lineTo(width, centerY + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);

    for (let i = 0; i < BAND_FADER_COUNT; i++) {
      const cx = (i + 0.5) * colWidth;
      const off = gains[i] <= BAND_GAIN_MIN;
      const tint = off ? FADER_OFF : BANDS_AMBER;
      const knobY = plotHeight - gainToFaderPos(gains[i]) * plotHeight;

      // Rail.
      ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, 2);
      ctx.lineTo(cx, plotHeight - 2);
      ctx.stroke();

      // Travel from the centre line to the knob, up or down.
      ctx.strokeStyle = withAlpha(tint, 0.85);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, centerY);
      ctx.lineTo(cx, knobY);
      ctx.stroke();

      // Centre tick.
      ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
      ctx.fillRect(cx - 4, centerY, 8, 1);

      // Knob — kept inside the plot at either extreme.
      const ky = Math.min(plotHeight - KNOB_H, Math.max(0, knobY - KNOB_H / 2));
      const lit = focused === i;
      ctx.fillStyle = lit ? tint : "#0b0f0d";
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") ctx.roundRect(cx - KNOB_W / 2, ky, KNOB_W, KNOB_H, 2);
      else ctx.rect(cx - KNOB_W / 2, ky, KNOB_W, KNOB_H);
      ctx.fill();
      ctx.strokeStyle = tint;
      ctx.lineWidth = 1.25;
      ctx.stroke();
      ctx.fillStyle = lit ? "#070a09" : withAlpha(tint, 0.7);
      ctx.fillRect(cx - 3, ky + KNOB_H / 2 - 0.5, 6, 1);
    }
  }

  function drawAxis(width: number, plotHeight: number): void {
    if (edgesHz.length !== NUM_BANDS + 1) return;
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.font = `11px ${FONT_MONO}`;
    ctx.textBaseline = "bottom";
    const maxHz = edgesHz[NUM_BANDS];
    const minHz = edgesHz[0];
    const y = plotHeight + STRIP_AXIS_HEIGHT_PX;
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
    if (!ensureSize()) return;
    const width = cssWidth;
    const plotHeight = STRIP_PLOT_HEIGHT_PX;
    ctx.clearRect(0, 0, width, plotHeight + STRIP_AXIS_HEIGHT_PX);

    const dtSec = lastDrawMs === null ? 1 / 60 : Math.max(1e-4, (nowMs - lastDrawMs) / 1000);
    lastDrawMs = nowMs;

    drawBars(width, plotHeight, dtSec);
    drawAxis(width, plotHeight);
    drawFaders(width, plotHeight);
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
    setFaders(next: ArrayLike<number>): void {
      for (let i = 0; i < BAND_FADER_COUNT; i++) gains[i] = next[i];
      faderWeights(gains, weights);
    },
    setFocused(index: number): void {
      focused = index;
    },
    setHighlight(range: { lo: number; hi: number } | null): void {
      highlight = range;
    },
    setGhost(bands: Float32Array | null): void {
      hasGhost = !!bands;
      if (bands) ghostBuf.set(bands);
    },
    setPinned(mask: Uint8Array | null): void {
      if (mask) pinnedBuf.set(mask);
      else pinnedBuf.fill(0);
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
