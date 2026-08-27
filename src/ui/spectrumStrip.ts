import { NUM_BANDS } from "../audio/types.ts";
import { formatHz } from "../audio/bandScale.ts";
import type { BandSplit } from "../audio/bandSplit.ts";

/**
 * Live spectrum analyser strip for the config panel — the "can I see what
 * I'm about to tune" view that src/ui/deviceMenu.ts's sliders otherwise
 * lack. Draws the same 24 log-spaced bands the audio pipeline already
 * computes (src/audio/types.ts's FeatureFrame.bands), tinted by which
 * low/mid/high group each band currently falls under.
 *
 * A "Before processing" checkbox switches between two feeds, both supplied
 * every tick by update(): the processed signal (default — whatever's
 * actually driving the visuals this frame) and, when checked, the raw mic
 * signal (literally what's hitting the analyser, no adaptive envelope, no
 * sensitivity gain). Both are copied into this component's own buffers
 * immediately, so it's safe even though callers reuse scratch arrays across
 * frames.
 *
 * Plain 2D canvas, not WebGL — the gallery's preview tiles already spend a
 * GL context each; a bar chart doesn't need one.
 */

export interface SpectrumStrip {
  el: HTMLElement;
  /** Real Hz edges for this ladder (length NUM_BANDS + 1), from the analyser
   *  once mic access exists, or the nominal ladder before that. */
  setEdgesHz(edges: Float32Array): void;
  setSplit(split: BandSplit): void;
  /** Called every tick with both feeds; either may be null (raw: no local
   *  analyser yet, e.g. mic pending or a mic-less renderer device; processed:
   *  audio not yet flowing at all). The "Before processing" checkbox picks
   *  which one is drawn — an idle "waiting for audio" state shows if that
   *  one's null. */
  update(raw: Float32Array | null, processed: Float32Array | null): void;
}

const HEIGHT_CSS_PX = 64;
const AXIS_HEIGHT_CSS_PX = 14;
const PEAK_FALL_PER_SEC = 1.2; // slow decay so a transient kick is still visible a few frames later

const LOW_COLOR = "#22c55e"; // matches deviceMenu's MIC_GREEN family
const MID_COLOR = "#a78bfa"; // matches deviceMenu's SCENE_ACCENT
const HIGH_COLOR = "#f59e0b"; // matches deviceMenu's Bands-box accent
const AXIS_TICKS_HZ = [100, 1000, 10000];

function groupColor(index: number, split: BandSplit): string {
  if (index < split.lowMid) return LOW_COLOR;
  if (index < split.midHigh) return MID_COLOR;
  return HIGH_COLOR;
}

// Tightened from 12px now that Bands sits directly below — the strip and its
// gain sliders should read as one unit, not two separate boxes.
const wrapStyle = `margin-bottom: 8px;`;
const toggleRowStyle = `
  display: flex; align-items: center; gap: 6px; margin-bottom: 6px;
  font-size: 11px; opacity: 0.7; cursor: pointer; user-select: none;
`;
const canvasStyle = `display: block; width: 100%; border-radius: 8px; background: #000a;`;

export function createSpectrumStrip(): SpectrumStrip {
  const wrap = document.createElement("div");
  wrap.style.cssText = wrapStyle;

  // "Listening post": unchecked (default) shows the processed signal that's
  // actually driving the visuals. Checked ("Before processing") shows the
  // raw mic signal exactly as it comes in — no adaptive envelope, no
  // sensitivity gain, nothing.
  const toggleRow = document.createElement("label");
  toggleRow.style.cssText = toggleRowStyle;
  toggleRow.title = "Listening post — compare the raw mic signal against what the visuals actually see";
  const toggleCheckbox = document.createElement("input");
  toggleCheckbox.type = "checkbox";
  const toggleText = document.createElement("span");
  toggleText.textContent = "Before processing";
  toggleRow.append(toggleCheckbox, toggleText);

  const canvas = document.createElement("canvas");
  canvas.style.cssText = canvasStyle;

  wrap.append(toggleRow, canvas);

  const ctx = canvas.getContext("2d")!;

  let edgesHz: Float32Array = new Float32Array(0);
  let split: BandSplit = { lowMid: 6, midHigh: 16 };
  let lastDrawMs: number | null = null;

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

  toggleCheckbox.addEventListener("change", () => requestRedraw());

  // devicePixelRatio-scaled backing store, resized whenever the panel's
  // layout width changes (the panel itself can appear at different widths —
  // min(320px, 88vw) — across devices).
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
  // band index *means* in Hz, which the axis ticks below show instead.
  function xForEdgeIndex(index: number, width: number): number {
    return (index / NUM_BANDS) * width;
  }

  function drawBars(width: number, plotHeight: number, dtSec: number): void {
    // Checked ("Before processing") shows the raw feed; unchecked (default)
    // shows the processed feed — the normal spectrum view.
    const showRaw = toggleCheckbox.checked;
    const bands = showRaw ? rawBuf : processedBuf;
    const hasData = showRaw ? hasRaw : hasProcessed;
    const peaks = showRaw ? peaksRaw : peaksProcessed;

    if (!hasData) {
      // Idle state: no bars — signals "no audio yet" rather than faking a
      // silent-but-present spectrum.
      ctx.fillStyle = "#fff5";
      ctx.font = "11px system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText("waiting for audio…", 4, plotHeight / 2);
      return;
    }

    const barGapPx = 1;
    const barWidth = Math.max(1, width / NUM_BANDS - barGapPx);

    for (let b = 0; b < NUM_BANDS; b++) {
      const v = Math.min(1, Math.max(0, bands[b]));
      peaks[b] = Math.max(v, peaks[b] - PEAK_FALL_PER_SEC * dtSec);

      const x = xForEdgeIndex(b, width);
      const barH = v * plotHeight;
      ctx.fillStyle = groupColor(b, split);
      ctx.fillRect(x, plotHeight - barH, barWidth, barH);

      // Peak-hold cap.
      const peakY = plotHeight - peaks[b] * plotHeight;
      ctx.fillRect(x, peakY, barWidth, 1.5);
    }
  }

  function drawAxis(width: number, plotHeight: number): void {
    if (edgesHz.length !== NUM_BANDS + 1) return;
    ctx.strokeStyle = "#fff3";
    ctx.fillStyle = "#fff8";
    ctx.font = "9px system-ui, sans-serif";
    ctx.textBaseline = "top";
    const maxHz = edgesHz[NUM_BANDS];
    const minHz = edgesHz[0];
    for (const hz of AXIS_TICKS_HZ) {
      if (hz <= minHz || hz >= maxHz) continue;
      const t = Math.log(hz / minHz) / Math.log(maxHz / minHz);
      const x = t * width;
      ctx.beginPath();
      ctx.moveTo(x, plotHeight);
      ctx.lineTo(x, plotHeight + 3);
      ctx.stroke();
      ctx.fillText(formatHz(hz), Math.min(width - 26, Math.max(0, x - 12)), plotHeight + 4);
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
    if (!wrap.isConnected) return;
    draw(performance.now());
  }

  return {
    el: wrap,
    setEdgesHz(edges: Float32Array): void {
      edgesHz = edges;
    },
    setSplit(next: BandSplit): void {
      split = next;
    },
    update(raw: Float32Array | null, processed: Float32Array | null): void {
      hasRaw = !!raw;
      if (raw) rawBuf.set(raw);
      hasProcessed = !!processed;
      if (processed) processedBuf.set(processed);
      requestRedraw();
    },
  };
}
