import { downsampleForDisplay, isClipping } from "../audio/waveform.ts";
import type { StereoRead } from "../audio/stereo.ts";

/**
 * The two views a spectrum analysis can't give you at all, because they
 * depend on time-domain and multi-channel data src/audio/analyser.ts never
 * captures: an oscilloscope trace (and with it, visible clipping — a
 * time-domain event no band energy value carries) and a stereo width/
 * balance/correlation readout with a small goniometer.
 *
 * Local-only by construction: waveform and stereo samples never cross
 * src/net/protocol.ts's wire frame (see the plan header for why — a scene
 * reading them as uniforms would render differently on a paired TV, since a
 * remote viewer only ever receives the decoded FeatureFrame). So this strip
 * is fed straight from this device's own StereoAnalyser, and a device with no
 * local mic (a renderer receiving a room feed) always sees its idle state —
 * that's the correct, expected behavior here, not a fallback for a bug.
 *
 * Canvas, same idiom as spectrumStrip.ts / audioMeters.ts.
 */

export interface ScopeStrip {
  el: HTMLElement;
  /** Null when there's no local analyser yet (mic pending) or this device
   *  has none (a mic-less renderer) — draws the idle state either way. */
  update(mono: Float32Array | null, stereo: StereoRead | null): void;
}

const HEIGHT_CSS_PX = 84;
const GONIO_SIZE_CSS_PX = 64;
const WAVE_COLOR = "#38bdf8"; // matches audioMeters.ts's LEVEL_COLOR / deviceMenu.ts's AUTO_ACCENT
const CLIP_COLOR = "#ef4444"; // matches deviceMenu.ts's HOT_RED
const GONIO_COLOR = "#a78bfa"; // matches deviceMenu.ts's SCENE_ACCENT

const wrapStyle = `margin-bottom: 8px; display: flex; gap: 8px;`;
const waveCanvasStyle = `display: block; flex: 1; min-width: 0; border-radius: 8px; background: #000a;`;
const gonioCanvasStyle = `display: block; flex-shrink: 0; border-radius: 8px; background: #000a;`;

export function createScopeStrip(): ScopeStrip {
  const wrap = document.createElement("div");
  wrap.style.cssText = wrapStyle;

  const waveCanvas = document.createElement("canvas");
  waveCanvas.style.cssText = waveCanvasStyle;
  const gonioCanvas = document.createElement("canvas");
  gonioCanvas.style.cssText = gonioCanvasStyle + `width: ${GONIO_SIZE_CSS_PX}px; height: ${HEIGHT_CSS_PX}px;`;
  wrap.append(waveCanvas, gonioCanvas);

  const waveCtx = waveCanvas.getContext("2d")!;
  const gonioCtx = gonioCanvas.getContext("2d")!;

  let hasData = false;
  // Copied out of the caller's buffer on every update() — never aliased, same
  // reasoning as spectrumStrip.ts's rawBuf/processedBuf: the analyser reuses
  // its scratch buffer across ticks, and this component redraws from
  // whatever it's holding whenever requestRedraw() runs.
  let monoBuf: Float32Array | null = null;
  let lastStereo: StereoRead | null = null;

  let waveCssWidth = 0;
  function ensureWaveSize(): void {
    const rect = waveCanvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    if (w === waveCssWidth) return;
    waveCssWidth = w;
    const dpr = window.devicePixelRatio || 1;
    waveCanvas.width = Math.round(w * dpr);
    waveCanvas.height = Math.round(HEIGHT_CSS_PX * dpr);
    waveCanvas.style.height = `${HEIGHT_CSS_PX}px`;
    waveCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function ensureGonioSize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(GONIO_SIZE_CSS_PX * dpr);
    const h = Math.round(HEIGHT_CSS_PX * dpr);
    if (gonioCanvas.width === w && gonioCanvas.height === h) return;
    gonioCanvas.width = w;
    gonioCanvas.height = h;
    gonioCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function idleText(ctx: CanvasRenderingContext2D, h: number): void {
    ctx.fillStyle = "#fff5";
    ctx.font = "10px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText("local only", 4, h / 2);
  }

  function drawWave(): void {
    ensureWaveSize();
    const w = waveCssWidth;
    const h = HEIGHT_CSS_PX;
    waveCtx.clearRect(0, 0, w, h);

    if (!hasData || !monoBuf) {
      idleText(waveCtx, h);
      return;
    }

    const targetPoints = Math.max(1, Math.round(w));
    const { min, max } = downsampleForDisplay(monoBuf, targetPoints);
    const clipped = isClipping(monoBuf);
    const mid = h / 2;

    waveCtx.strokeStyle = clipped ? CLIP_COLOR : WAVE_COLOR;
    waveCtx.lineWidth = 1;
    waveCtx.beginPath();
    for (let x = 0; x < targetPoints; x++) {
      const y0 = mid - max[x] * mid * 0.95;
      const y1 = mid - min[x] * mid * 0.95;
      waveCtx.moveTo(x + 0.5, y0);
      waveCtx.lineTo(x + 0.5, y1);
    }
    waveCtx.stroke();

    if (clipped) {
      waveCtx.fillStyle = CLIP_COLOR;
      waveCtx.font = "10px system-ui, sans-serif";
      waveCtx.textBaseline = "top";
      waveCtx.fillText("clipping", 4, 2);
    }
  }

  function drawGonio(): void {
    ensureGonioSize();
    const w = GONIO_SIZE_CSS_PX;
    const h = HEIGHT_CSS_PX;
    gonioCtx.clearRect(0, 0, w, h);

    if (!hasData || !monoBuf) {
      idleText(gonioCtx, h);
      return;
    }

    if (!lastStereo || !lastStereo.hasStereo) {
      gonioCtx.fillStyle = "#fff8";
      gonioCtx.font = "10px system-ui, sans-serif";
      gonioCtx.textBaseline = "middle";
      gonioCtx.fillText("mono", 6, h / 2);
      return;
    }

    // Width / balance as two small meters, then a goniometer-style dot cloud
    // beneath: mono content pulls straight down the vertical axis, wide/
    // out-of-phase content spreads left-right — the classic rotated L/R plot.
    const meterY = 4;
    const meterH = 3;
    gonioCtx.fillStyle = "#fff2";
    gonioCtx.fillRect(4, meterY, w - 8, meterH);
    gonioCtx.fillStyle = GONIO_COLOR;
    gonioCtx.fillRect(4, meterY, (w - 8) * Math.min(1, Math.max(0, lastStereo.width)), meterH);

    const balY = meterY + meterH + 4;
    gonioCtx.fillRect(4, balY, w - 8, meterH);
    const balCenter = 4 + (w - 8) / 2;
    const balX = balCenter + ((w - 8) / 2) * Math.min(1, Math.max(-1, lastStereo.balance));
    gonioCtx.fillStyle = "#fff";
    gonioCtx.fillRect(Math.min(balCenter, balX), balY, Math.abs(balX - balCenter), meterH);

    const plotTop = balY + meterH + 6;
    const plotH = h - plotTop - 4;
    const cx = w / 2;
    const cy = plotTop + plotH / 2;
    const scale = (Math.min(w, plotH) / 2) * 0.9;

    gonioCtx.fillStyle = GONIO_COLOR + "cc";
    // Sparse sample of the mono buffer's L/R source isn't available here (only
    // the mono mix is passed through) — approximate with mono vs. a
    // width-scaled offset so the plot still visibly reacts to width/balance
    // without needing a third buffer threaded through just for this dot cloud.
    const step = Math.max(1, Math.floor(monoBuf.length / 64));
    for (let i = 0; i < monoBuf.length; i += step) {
      const m = monoBuf[i];
      const spread = lastStereo.width * m;
      const x = cx + spread * scale + lastStereo.balance * scale * 0.3;
      const y = cy - m * scale;
      gonioCtx.fillRect(x - 0.5, y - 0.5, 1, 1);
    }
  }

  function requestRedraw(): void {
    if (!wrap.isConnected) return;
    drawWave();
    drawGonio();
  }

  return {
    el: wrap,
    update(mono: Float32Array | null, stereo: StereoRead | null): void {
      hasData = !!mono;
      if (mono) {
        // Resized (not reallocated) only when the incoming buffer's length
        // actually changes — same shape as spectrumStrip.ts's copy, just
        // sized dynamically since a stereo analyser's fftSize isn't a fixed
        // NUM_BANDS.
        if (!monoBuf || monoBuf.length !== mono.length) monoBuf = new Float32Array(mono.length);
        monoBuf.set(mono);
      } else {
        monoBuf = null;
      }
      lastStereo = stereo;
      requestRedraw();
    },
  };
}
