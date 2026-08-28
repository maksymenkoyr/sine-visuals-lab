import type { AnimFrame } from "../render/animClock.ts";
import type { FeatureFrame } from "../audio/types.ts";
import { MUSIC_DIALS, NEUTRAL } from "../render/musicProfile.ts";

/**
 * The rest of the "listening post": everything the audio pipeline already
 * derives besides the 24-band spectrum in spectrumStrip.ts. None of this is
 * new analysis — it's `FeatureFrame`/`AnimFrame` fields that reach the
 * shaders as uniforms but, until this component, were never shown to a
 * person tuning against them:
 *
 *  - Transport: bpm + a dot that flashes on frame.beat, dimmed by
 *    anim.tempoLock so an unlocked tempo guess reads as unconfident rather
 *    than as a confident wrong number.
 *  - Level vs energy: frame.level (pre-AGC, absolute) against frame.energy
 *    (post-AGC) — the only way to actually see features.ts's adaptive
 *    floor/peak doing its job, since normally its whole point is to make
 *    that invisible downstream.
 *  - Low/mid/high: anim.low/mid/high with their *Onset flashes — the same
 *    crossover the Bands box sliders set, but with the onsets visible. Gives
 *    anim.midOnset/highOnset their first consumers anywhere in the repo.
 *  - Section: anim.sectionIntensity with a anim.dropPulse flash.
 *  - Dials: one mini-meter per entry in MUSIC_DIALS (never a hardcoded list,
 *    so a future eighth dial shows up here for free) — what autoTune.ts
 *    actually resolves every Auto chip against, and otherwise has zero
 *    visibility anywhere in the UI.
 *
 * Canvas, not DOM meters, matching spectrumStrip.ts's reasoning: one cheap
 * draw() call beats dozens of styled elements for a panel that's mostly bars.
 */

export interface AudioMeters {
  el: HTMLElement;
  /** Either may be null (no frame yet — mic pending, or between tracks on a
   *  renderer device before the first sample arrives): draws the same idle
   *  state spectrumStrip.ts uses rather than stale or zeroed bars. */
  update(frame: FeatureFrame | null, anim: AnimFrame | null): void;
}

const HEIGHT_CSS_PX = 108;
const PEAK_FALL_PER_SEC = 1.2; // matches spectrumStrip.ts's peak-hold decay

const LOW_COLOR = "#22c55e"; // matches spectrumStrip.ts / deviceMenu.ts's MIC_GREEN family
const MID_COLOR = "#a78bfa";
const HIGH_COLOR = "#f59e0b";
const LEVEL_COLOR = "#38bdf8"; // matches deviceMenu.ts's AUTO_ACCENT — a distinct fourth system
const ENERGY_COLOR = "#fff";
const DIAL_COLOR = "#fff9";
const BEAT_COLOR = "#fff";
const DROP_COLOR = "#ef4444"; // matches deviceMenu.ts's HOT_RED

const wrapStyle = `margin-bottom: 8px;`;
const canvasStyle = `display: block; width: 100%; border-radius: 8px; background: #000a;`;

export function createAudioMeters(): AudioMeters {
  const wrap = document.createElement("div");
  wrap.style.cssText = wrapStyle;

  const canvas = document.createElement("canvas");
  canvas.style.cssText = canvasStyle;
  wrap.append(canvas);

  const ctx = canvas.getContext("2d")!;

  let lastDrawMs: number | null = null;
  let hasFrame = false;
  let hasAnim = false;

  // Held across ticks so idle-state redraws (panel reopened, no new data)
  // and the peak-hold caps below have something to read.
  let lastFrame: FeatureFrame | null = null;
  let lastAnim: AnimFrame | null = null;
  let levelPeak = 0;
  let energyPeak = 0;

  let cssWidth = 0;
  function ensureSize(): void {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    if (w === cssWidth) return;
    cssWidth = w;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(HEIGHT_CSS_PX * dpr);
    canvas.style.height = `${HEIGHT_CSS_PX}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawBar(x: number, y: number, w: number, h: number, frac: number, color: string): void {
    const v = Math.min(1, Math.max(0, frac));
    ctx.fillStyle = "#fff2";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * v, h);
  }

  function draw(nowMs: number): void {
    ensureSize();
    const width = cssWidth;
    ctx.clearRect(0, 0, width, HEIGHT_CSS_PX);

    const dtSec = lastDrawMs === null ? 1 / 60 : Math.max(1e-4, (nowMs - lastDrawMs) / 1000);
    lastDrawMs = nowMs;

    if (!hasFrame || !lastFrame) {
      ctx.fillStyle = "#fff5";
      ctx.font = "11px system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText("waiting for audio…", 4, HEIGHT_CSS_PX / 2);
      return;
    }

    const frame = lastFrame;
    const anim = hasAnim ? lastAnim : null;

    let y = 4;

    // --- transport: bpm + beat dot, dimmed while unlocked ---
    const tempoLock = anim?.tempoLock ?? 0;
    ctx.font = "11px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.55 * tempoLock})`;
    ctx.fillText(frame.bpm > 0 ? `${frame.bpm.toFixed(0)} bpm` : "— bpm", 4, y + 6);
    ctx.beginPath();
    ctx.arc(width - 10, y + 6, frame.beat ? 5 : 3, 0, Math.PI * 2);
    ctx.fillStyle = frame.beat ? BEAT_COLOR : `rgba(255,255,255,${0.15 + 0.35 * tempoLock})`;
    ctx.fill();
    y += 16;

    // --- level (pre-AGC) vs energy (post-AGC), with peak-hold caps ---
    const barH = 5;
    const barGap = 2;
    levelPeak = Math.max(frame.level, levelPeak - PEAK_FALL_PER_SEC * dtSec);
    energyPeak = Math.max(frame.energy, energyPeak - PEAK_FALL_PER_SEC * dtSec);
    drawBar(4, y, width - 8, barH, frame.level, LEVEL_COLOR);
    ctx.fillRect(4 + (width - 8) * Math.min(1, levelPeak) - 1, y, 1.5, barH);
    y += barH + barGap;
    drawBar(4, y, width - 8, barH, frame.energy, ENERGY_COLOR);
    ctx.fillRect(4 + (width - 8) * Math.min(1, energyPeak) - 1, y, 1.5, barH);
    y += barH + 6;

    // --- low/mid/high, flashing on their onset edges ---
    if (anim) {
      const groupW = (width - 8 - 2 * barGap) / 3;
      const groups: { level: number; onset: boolean; color: string }[] = [
        { level: anim.low, onset: anim.lowOnset, color: LOW_COLOR },
        { level: anim.mid, onset: anim.midOnset, color: MID_COLOR },
        { level: anim.high, onset: anim.highOnset, color: HIGH_COLOR },
      ];
      let x = 4;
      for (const g of groups) {
        drawBar(x, y, groupW, barH, g.level, g.color);
        if (g.onset) {
          ctx.fillStyle = "#fff";
          ctx.fillRect(x, y - 1, groupW, 1.5);
        }
        x += groupW + barGap;
      }
      y += barH + 6;

      // --- section intensity + drop flash ---
      drawBar(4, y, width - 8, barH, anim.sectionIntensity, "#fff6");
      if (anim.dropPulse > 0.05) {
        ctx.fillStyle = DROP_COLOR;
        ctx.globalAlpha = Math.min(1, anim.dropPulse);
        ctx.fillRect(4, y, width - 8, barH);
        ctx.globalAlpha = 1;
      }
      y += barH + 8;

      // --- the seven MUSIC_DIALS, each marking NEUTRAL (0.5) ---
      const dialH = 3;
      const dialGap = 2;
      ctx.font = "8px system-ui, sans-serif";
      for (const dial of MUSIC_DIALS) {
        const v = anim.profile[dial];
        const labelW = 52;
        ctx.fillStyle = "#fff8";
        ctx.textBaseline = "middle";
        ctx.fillText(dial, 4, y + dialH / 2 + 1);
        const barX = 4 + labelW;
        const barW = width - 8 - labelW;
        drawBar(barX, y, barW, dialH, v, DIAL_COLOR);
        // Neutral tick — always drawn, so "sitting at 0.5" reads as a dial
        // resting exactly on its marker, not as an empty/broken meter.
        const neutralX = barX + barW * NEUTRAL[dial];
        ctx.fillStyle = "#fff6";
        ctx.fillRect(neutralX - 0.5, y - 1, 1, dialH + 2);
        y += dialH + dialGap;
      }
    }
  }

  function requestRedraw(): void {
    if (!wrap.isConnected) return;
    draw(performance.now());
  }

  return {
    el: wrap,
    update(frame: FeatureFrame | null, anim: AnimFrame | null): void {
      hasFrame = !!frame;
      lastFrame = frame;
      hasAnim = !!anim;
      lastAnim = anim;
      requestRedraw();
    },
  };
}
