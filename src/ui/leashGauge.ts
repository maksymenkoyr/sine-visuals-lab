import { expansionReach } from "../render/drives.ts";
import { FONT_MONO } from "./controlsTheme.ts";

/**
 * The Master card's leash gauge: how Scale and Expansion relate, live. A
 * flat meter arc (wider than it is tall, so it costs the column little
 * height) with:
 *
 *   - a notch at the normal line — Scale's position along its own slider;
 *   - a band either side of it — how far Expansion typically lets the music
 *     pull the picture (expansionReach × GAUGE_TYPICAL_SWING);
 *   - a needle — where the picture is right now, from the scene's
 *     SceneDrives.masterExcursion() (drives.ts), with a short fading tail so
 *     the spring back to the notch reads.
 *
 * One fixed scale, never auto-fit: a full swing of the needle from the
 * notch to an end is GAUGE_FULL_SWING reading units, whatever the scene
 * does. The band ignores the Shape chip on purpose — it shows the dial, the
 * needle shows what the shape did with it.
 */

const GAUGE_FULL_SWING = 0.5;
const GAUGE_TYPICAL_SWING = 0.25;
const HALF_SWEEP = (50 * Math.PI) / 180;
const HEIGHT_PX = 84;
const SIDE_PAD_PX = 12;
const TOP_PAD_PX = 18;
const TAIL_LEN = 20;

export interface LeashGaugeState {
  /** Scale's position along its slider, 0..1. */
  normal: number;
  expansion: number;
  /** SceneDrives.masterExcursion(), or null with nothing to read. */
  excursion: number | null;
}

export function createLeashGauge(accent: string): { el: HTMLCanvasElement; draw: (state: LeashGaugeState) => void } {
  const el = document.createElement("canvas");
  el.style.cssText = `display: block; width: 100%; height: ${HEIGHT_PX}px; border-radius: 4px; background: rgba(0,0,0,0.35);`;
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", "Where the picture sits now against its normal line");
  const tail: number[] = [];

  function draw({ normal, expansion, excursion }: LeashGaugeState): void {
    const w = el.clientWidth;
    if (w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.round(w * dpr), ph = Math.round(HEIGHT_PX * dpr);
    if (el.width !== pw || el.height !== ph) {
      el.width = pw;
      el.height = ph;
    }
    const g = el.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, HEIGHT_PX);

    const R = (w / 2 - SIDE_PAD_PX) / Math.sin(HALF_SWEEP);
    const cx = w / 2, cy = TOP_PAD_PX + R;
    const angle = (v: number) => -HALF_SWEEP + 2 * HALF_SWEEP * Math.min(1, Math.max(0, v));
    const at = (v: number, r: number): [number, number] => [cx + r * Math.sin(angle(v)), cy - r * Math.cos(angle(v))];
    // Canvas arcs run clockwise from +x; a needle angle a from vertical is -π/2 + a.
    const arc = (from: number, to: number) => {
      g.beginPath();
      g.arc(cx, cy, R, -Math.PI / 2 + angle(from), -Math.PI / 2 + angle(to));
      g.stroke();
    };

    const line = Math.min(1, Math.max(0, normal));
    const band = Math.min(1, (expansionReach(expansion) * GAUGE_TYPICAL_SWING) / GAUGE_FULL_SWING);
    g.lineCap = "round";
    g.lineWidth = 7;
    g.strokeStyle = "rgba(255,255,255,0.08)";
    arc(0, 1);
    g.strokeStyle = accent;
    g.globalAlpha = 0.38;
    arc(line - line * band, line + (1 - line) * band);
    g.globalAlpha = 1;

    // Normal notch + label.
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(...at(line, R - 9));
    g.lineTo(...at(line, R + 9));
    g.stroke();
    g.font = `9.5px ${FONT_MONO}`;
    g.fillStyle = accent;
    g.textAlign = "center";
    const [lx, ly] = at(line, R + 9);
    g.fillText("NORMAL", Math.min(w - 22, Math.max(22, lx)), Math.max(9, ly - 3));
    g.textAlign = "left";

    // Needle + tail. The pivot sits below the canvas, as on a VU meter.
    const live = excursion !== null;
    const x = live ? Math.max(-1, Math.min(1, excursion / GAUGE_FULL_SWING)) : 0;
    const p = line + (x >= 0 ? 1 - line : line) * x;
    tail.push(p);
    if (tail.length > TAIL_LEN) tail.shift();
    g.strokeStyle = "#fff";
    g.lineWidth = 1.5;
    for (let i = 0; i < tail.length - 1; i++) {
      g.globalAlpha = (i / tail.length) * 0.3;
      g.beginPath();
      g.moveTo(...at(tail[i]!, R - 46));
      g.lineTo(...at(tail[i]!, R - 4));
      g.stroke();
    }
    g.globalAlpha = live ? 1 : 0.35;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(...at(p, R - 70));
    g.lineTo(...at(p, R - 3));
    g.stroke();
    g.globalAlpha = 1;
  }

  return { el, draw };
}
