import { NUM_BANDS } from "../audio/types.ts";
import type { BandSplit } from "../audio/bandSplit.ts";
import { createSpectrumStrip, STRIP_PLOT_HEIGHT_PX, type SpectrumStrip } from "./spectrumStrip.ts";
import { BANDS_AMBER, withAlpha } from "./controlsTheme.ts";
import { digitsStyle, readoutStyle, rowHeadStyle, rowLabelStyle, rowRightStyle, unitStyle } from "./controlsKit.ts";
import { LINE_STRENGTH_DEFAULT, LINE_STRENGTH_MAX, LINE_STRENGTH_MIN } from "../audio/bandLine.ts";
// Circular with deviceMenu.ts (it imports createBandLineEditor below) — same
// established pattern as audioMeters.ts importing createControlRow from
// there; safe because neither side calls the other at module-eval time,
// only from inside functions invoked later.
import { createControlRow } from "./deviceMenu.ts";

/**
 * The Line card's interactive piece: a second spectrum strip (the same
 * processed feed the Bands card shows, so the user draws over live bars —
 * src/ui/bandFaders.ts is the model this follows) with a transparent overlay
 * <canvas> drawn on top, plus the Strength row and Drive meter beneath it.
 * The overlay paints the sensitivity line itself (src/audio/bandLine.ts):
 * a stepped polyline at each band's `1 - line[b]` height, a faint fill below
 * it down to the bottom ("ignored"), and — fed live every tick via update()
 * — a translucent amber fill above it wherever the current bars clear it
 * (AnimFrame.lineExcess), so the user sees exactly what's driving the Drive
 * meter and any scene reading uLineDrive.
 *
 * Pointer-only, not wired into the panel's keyboard/Tab-ring layer the way
 * bandFaders.ts's faders are (each their own role="slider" hit area) — this
 * is a drawing surface, not a bank of discrete controls, and giving it a
 * keyboard equivalent isn't worth the complexity for what's still an
 * experiment. The Strength row is a plain createControlRow, so it already
 * sits in the Tab ring / gets A-less R/T for free.
 *
 * Values come in through setLine/setStrength (the panel pushes the current
 * scene's store on open() and after a card Reset, the same call sites as
 * bandFaders.setGains) and go out through onLineChange/onStrengthChange —
 * this component holds a copy but is not the source of truth, matching the
 * rest of the panel.
 */

export interface BandLineEditor {
  /** The strip + overlay only — same scope as bandFaders.ts's own `el`. The
   *  caller wraps this in its own `.vc-row` alongside the card's hint text,
   *  mirroring the Bands card's fadersRow. */
  el: HTMLElement;
  strip: SpectrumStrip;
  /** The Strength row and Drive meter row — already their own `.vc-row`s,
   *  appended as direct siblings in the card body rather than nested inside
   *  `el`'s row. */
  strengthRow: HTMLElement;
  driveRow: HTMLElement;
  setEdgesHz(edges: Float32Array): void;
  setSplit(split: BandSplit): void;
  /** Pushes a scene's stored line into the overlay. */
  setLine(heights: ArrayLike<number>): void;
  setStrength(value: number): void;
  /** Called every tick: this scene's live drive/excess (0/null before audio
   *  or with `line` omitted from animClock.advance) — feeds the Drive meter
   *  and the overlay's amber fill. */
  update(lineDrive: number, excess: ArrayLike<number> | null): void;
}

export interface BandLineEditorOpts {
  onLineChange: (band: number, height: number) => void;
  onStrengthChange: (value: number) => void;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

const wrapperStyle = `position: relative;`;
const overlayStyle = `position: absolute; top: 0; left: 0; width: 100%; height: ${STRIP_PLOT_HEIGHT_PX}px; touch-action: none; cursor: crosshair;`;

const IGNORED_FILL = "rgba(255,255,255,0.06)";
const EXCESS_FILL_ALPHA = 0.35;
const LINE_WIDTH_PX = 2;

const formatStrength = (v: number) => v.toFixed(1);

const meterTrackStyle = `position: relative; width: 100%; height: 3px; border-radius: 2px; background: rgba(255,255,255,0.18); margin-top: 8px;`;
const meterFillStyle = `position: absolute; top: 0; left: 0; height: 100%; width: 0%; border-radius: 2px; background-color: ${BANDS_AMBER};`;

/** The Drive meter: the simplest possible bar — a label, a % readout, a
 *  track+fill — no peak-hold cap and no ticks (see audioMeters.ts's own
 *  createMeterRow for the fuller version this deliberately doesn't reuse;
 *  it isn't exported, and this card doesn't need what the extra weight buys). */
function createDriveMeterRow(): { el: HTMLElement; setValue(v: number): void } {
  const el = document.createElement("div");
  el.className = "vc-row";
  el.tabIndex = 0;
  el.style.setProperty("--vc-accent", BANDS_AMBER);

  const head = document.createElement("div");
  head.style.cssText = rowHeadStyle;
  const label = document.createElement("div");
  label.textContent = "Drive";
  label.className = "vc-label";
  label.style.cssText = rowLabelStyle;
  const right = document.createElement("div");
  right.style.cssText = rowRightStyle;
  const readout = document.createElement("div");
  readout.style.cssText = readoutStyle;
  const digits = document.createElement("span");
  digits.style.cssText = digitsStyle;
  const unit = document.createElement("span");
  unit.style.cssText = unitStyle;
  unit.textContent = "%";
  readout.append(digits, unit);
  right.appendChild(readout);
  head.append(label, right);

  const track = document.createElement("div");
  track.style.cssText = meterTrackStyle;
  const fill = document.createElement("div");
  fill.style.cssText = meterFillStyle;
  track.appendChild(fill);

  const hint = document.createElement("div");
  hint.className = "vc-hint";
  hint.textContent = "How hard the spectrum above the line is driving right now — what Strength scales.";

  el.append(head, track, hint);

  let lastPct = -1;
  return {
    el,
    setValue(v: number): void {
      const pct = Math.round(clamp01(v) * 100);
      if (pct === lastPct) return;
      lastPct = pct;
      fill.style.width = `${pct}%`;
      digits.textContent = String(pct);
    },
  };
}

export function createBandLineEditor(opts: BandLineEditorOpts): BandLineEditor {
  const strip = createSpectrumStrip();
  // No fader bank of its own — see spectrumStrip.ts's own header for why
  // this can't just be "never call setFaders" (the default gains still draw
  // every knob dead-center).
  strip.setShowFaders(false);

  const el = document.createElement("div");
  el.style.cssText = wrapperStyle;

  const overlay = document.createElement("canvas");
  overlay.style.cssText = overlayStyle;
  const ctx = overlay.getContext("2d")!;

  el.append(strip.el, overlay);

  // This component's own copy — pushed in via setLine, painted locally on
  // pointer input and reported out through onLineChange; not the source of
  // truth (see this file's header).
  const line = new Float32Array(NUM_BANDS);
  let excess: ArrayLike<number> | null = null;

  let cssWidth = 0;
  function ensureSize(): boolean {
    const rect = overlay.getBoundingClientRect();
    const w = Math.round(rect.width);
    if (w <= 0) return false;
    if (w === cssWidth) return true;
    cssWidth = w;
    const dpr = window.devicePixelRatio || 1;
    overlay.width = Math.round(w * dpr);
    overlay.height = Math.round(STRIP_PLOT_HEIGHT_PX * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  function redraw(): void {
    if (!ensureSize()) return;
    const width = cssWidth;
    const plotHeight = STRIP_PLOT_HEIGHT_PX;
    ctx.clearRect(0, 0, width, plotHeight);

    const colWidth = width / NUM_BANDS;

    // Ignored region: below the line, down to the bottom — reads as "this
    // part of the spectrum doesn't count" regardless of what the bars do.
    ctx.fillStyle = IGNORED_FILL;
    for (let b = 0; b < NUM_BANDS; b++) {
      const lineY = (1 - line[b]) * plotHeight;
      if (lineY >= plotHeight) continue;
      ctx.fillRect(b * colWidth, lineY, colWidth, plotHeight - lineY);
    }

    // Excess: wherever the live bars currently clear the line, filled from
    // the line up to how far they clear it — exactly what's driving
    // bandLineDrive() this tick (src/audio/bandLine.ts).
    if (excess) {
      ctx.fillStyle = withAlpha(BANDS_AMBER, EXCESS_FILL_ALPHA);
      for (let b = 0; b < NUM_BANDS; b++) {
        const e = excess[b];
        if (!e || e <= 0) continue;
        const lineY = (1 - line[b]) * plotHeight;
        const h = Math.min(lineY, e * plotHeight);
        if (h <= 0) continue;
        ctx.fillRect(b * colWidth, lineY - h, colWidth, h);
      }
    }

    // The line itself: a stepped polyline, one flat segment per band.
    ctx.strokeStyle = BANDS_AMBER;
    ctx.lineWidth = LINE_WIDTH_PX;
    ctx.beginPath();
    for (let b = 0; b < NUM_BANDS; b++) {
      const x0 = b * colWidth;
      const x1 = x0 + colWidth;
      const y = (1 - line[b]) * plotHeight;
      if (b === 0) ctx.moveTo(x0, y);
      else ctx.lineTo(x0, y);
      ctx.lineTo(x1, y);
    }
    ctx.stroke();
  }

  function bandAndHeightFromEvent(e: PointerEvent | MouseEvent): { band: number; height: number } {
    const rect = overlay.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const band = Math.min(NUM_BANDS - 1, Math.max(0, Math.floor((x / rect.width) * NUM_BANDS)));
    const height = clamp01(1 - y / rect.height);
    return { band, height };
  }

  function commitBand(band: number, height: number): void {
    line[band] = height;
    opts.onLineChange(band, height);
  }

  // Drag state: the previously painted band/height, so a fast drag can walk
  // and lerp every band in between rather than leaving gaps — see this
  // file's header. -1 means "no previous sample yet" (a fresh pointerdown).
  let prevBand = -1;
  let prevHeight = 0;

  function paintDrag(band: number, height: number): void {
    if (prevBand < 0 || prevBand === band) {
      commitBand(band, height);
    } else {
      const step = band > prevBand ? 1 : -1;
      for (let b = prevBand + step; ; b += step) {
        const t = (b - prevBand) / (band - prevBand);
        commitBand(b, prevHeight + (height - prevHeight) * t);
        if (b === band) break;
      }
    }
    prevBand = band;
    prevHeight = height;
    redraw();
  }

  let dragging = false;
  overlay.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    dragging = true;
    overlay.setPointerCapture(e.pointerId);
    prevBand = -1; // a single-band paint on the first sample of this drag
    const { band, height } = bandAndHeightFromEvent(e);
    paintDrag(band, height);
    e.preventDefault();
  });
  overlay.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const { band, height } = bandAndHeightFromEvent(e);
    paintDrag(band, height);
  });
  const endDrag = (): void => {
    dragging = false;
    prevBand = -1;
  };
  overlay.addEventListener("pointerup", endDrag);
  overlay.addEventListener("pointercancel", endDrag);

  // Small nicety: reset one band to 0 (fully in — see this file's header)
  // without hunting for the exact bottom of its column.
  overlay.addEventListener("dblclick", (e) => {
    const { band } = bandAndHeightFromEvent(e);
    commitBand(band, 0);
    redraw();
  });

  const strengthRow = createControlRow({
    label: "Strength",
    accent: BANDS_AMBER,
    min: LINE_STRENGTH_MIN,
    max: LINE_STRENGTH_MAX,
    defaultValue: LINE_STRENGTH_DEFAULT,
    mapping: "log",
    unit: "×",
    format: formatStrength,
    description:
      "Scales how hard the spectrum above the line drives an effect. Above 1× a modest rise already reaches full; below it even a big rise stays gentle.",
  });
  strengthRow.onChange((value) => opts.onStrengthChange(value));

  const driveRow = createDriveMeterRow();

  return {
    el,
    strip,
    strengthRow: strengthRow.el,
    driveRow: driveRow.el,
    setEdgesHz(edges: Float32Array): void {
      strip.setEdgesHz(edges);
    },
    setSplit(split: BandSplit): void {
      strip.setSplit(split);
    },
    setLine(heights: ArrayLike<number>): void {
      for (let b = 0; b < NUM_BANDS; b++) line[b] = heights[b];
      redraw();
    },
    setStrength(value: number): void {
      strengthRow.setValue(value);
    },
    update(lineDrive: number, nextExcess: ArrayLike<number> | null): void {
      excess = nextExcess;
      driveRow.setValue(lineDrive);
      redraw();
    },
  };
}
