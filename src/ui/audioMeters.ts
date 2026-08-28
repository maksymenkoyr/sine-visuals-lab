import type { AnimFrame } from "../render/animClock.ts";
import type { FeatureFrame } from "../audio/types.ts";
import type { StereoRead } from "../audio/stereo.ts";
import { downsampleForDisplay, isClipping, peak } from "../audio/waveform.ts";
import { DIAL_LABELS, MUSIC_DIALS, NEUTRAL } from "../render/musicProfile.ts";
import { AUTO_SKY, HOT_RED, INPUT_GREEN, STRIP_HIGH, STRIP_LOW, STRIP_MID } from "./controlsTheme.ts";
import {
  createCard,
  digitsStyle,
  digitsTextStyle,
  groupHeading,
  readoutStyle,
  rowHeadStyle,
  rowLabelStyle,
  rowRightStyle,
  spacer,
  unitStyle,
} from "./controlsKit.ts";

/**
 * The meters under the spectrum card: everything the audio pipeline already
 * derives besides the bands in spectrumStrip.ts, plus the two things a
 * spectrum can't show at all. Read-only cards in the panel's own row grammar
 * (see deviceMenu.ts / controlsKit.ts) — label, seven-segment readout, a
 * meter where a slider would be, and a hint that unfolds on hover or tap so
 * every reading explains itself.
 *
 *  - Signal: FeatureFrame.level (pre-AGC, absolute) beside .energy (post-AGC)
 *    — the only way to see features.ts's adaptive floor/peak doing its job,
 *    since its whole point is to make that invisible downstream — then the
 *    low/mid/high groups from AnimFrame with their onset flashes (the first
 *    consumers of midOnset/highOnset anywhere).
 *  - Rhythm: bpm with a beat dot, the meter being beatClock's tempoLock so an
 *    unlocked guess reads as unconfident rather than as a confident wrong
 *    number; and sectionIntensity with a drop flash.
 *  - Character: one row per entry in MUSIC_DIALS (never a hardcoded list),
 *    each marking NEUTRAL with a tick — what autoTune.ts resolves every "A"
 *    chip against, otherwise invisible. Copy comes from DIAL_LABELS.
 *  - Scope: a waveform trace with a clip warning, and stereo width/balance,
 *    read straight off this device's mic by stereo.ts. Local-only by
 *    construction — these never cross src/net/protocol.ts's wire frame, so a
 *    mic-less renderer has nothing to show here and the card hides itself.
 *
 * Fills move every frame; readout text at ~10Hz (the same reasoning as
 * deviceMenu.ts's AUTO_UI_REFRESH_MS — text writes cost layout, and eyes
 * can't read faster anyway). Only the waveform is a canvas.
 */

export interface AudioMeters {
  el: HTMLElement;
  /** Fed every frame while the panel is open. `frame`/`anim` null before
   *  audio is up (idle readouts); `mono`/`stereo` null on any device without
   *  a local analyser (Scope card hidden). */
  update(
    frame: FeatureFrame | null,
    anim: AnimFrame | null,
    mono: Float32Array | null,
    stereo: StereoRead | null,
  ): void;
}

const PEAK_FALL_PER_SEC = 1.2; // matches spectrumStrip.ts's peak-hold decay
const TEXT_REFRESH_MS = 100;
/** Readings that feed no single system — same neutral as the Palette card. */
const NEUTRAL_ACCENT = "rgba(255,255,255,0.7)";
const WAVE_HEIGHT_CSS_PX = 44;
const FADE = "background-color 0.3s ease-out";

// The meter sits where a row's slider would, at the slider's height, so meter
// rows and slider rows line up card to card.
const meterWrapStyle = `display: flex; align-items: center; height: 22px; margin-top: 2px;`;
const trackStyle = `position: relative; width: 100%; height: 3px; border-radius: 2px; background: rgba(255,255,255,0.18);`;
const fillStyle = (accent: string) =>
  `position: absolute; top: 0; left: 0; height: 100%; width: 0; border-radius: 2px; background-color: ${accent}; transition: ${FADE};`;
const capStyle = `position: absolute; top: -1px; bottom: -1px; width: 1.5px; left: 0; background: #fff; visibility: hidden;`;
const tickStyle = `position: absolute; top: -2px; bottom: -2px; width: 1px; background: rgba(255,255,255,0.55);`;
const beatDotStyle = `width: 6px; height: 6px; border-radius: 50%; background-color: rgba(255,255,255,0.25); transition: ${FADE};`;
const waveCanvasStyle = `display: block; width: 100%; height: ${WAVE_HEIGHT_CSS_PX}px; margin-top: 4px;`;

const MONO_HINT = "This source is mono — a phone mic usually is. Tab audio comes through in stereo.";
const WIDTH_HINT = "How wide the stereo picture is: 0 is mono, 100 is fully wide.";
const BALANCE_HINT = "Which side is louder — the fill grows toward it.";

/** Jump an element to `color` with no fade, then re-arm the fade so the
 *  next color write eases back — a one-frame event made visible. */
function blink(el: HTMLElement, color: string): void {
  el.style.transition = "none";
  el.style.backgroundColor = color;
  void el.offsetWidth; // commit the jump before the fade is re-enabled
  el.style.transition = FADE;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

interface MeterRowSpec {
  label: string;
  accent: string;
  /** Mono suffix after the digits ("%", "bpm"). */
  unit?: string;
  description: string;
  /** A fixed mark at this fraction of the track — the dials' NEUTRAL. */
  tickAt?: number;
  /** The fill grows out from the centre toward either end (balance), and
   *  the value runs -1..1 instead of 0..1. No peak cap. */
  centered?: boolean;
}

interface ReadoutOpts {
  /** Words rather than digits ("mono", "--") — DSEG7 has no letters. */
  textual?: boolean;
  color?: string;
  /** Overrides the spec's unit for this write; "" hides it. */
  unit?: string;
}

function createMeterRow(spec: MeterRowSpec) {
  const el = document.createElement("div");
  el.className = "vc-row";
  el.tabIndex = 0;
  el.style.setProperty("--vc-accent", spec.accent);

  const head = document.createElement("div");
  head.style.cssText = rowHeadStyle;
  const label = document.createElement("div");
  label.textContent = spec.label;
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
  readout.append(digits, unit);
  right.appendChild(readout);
  head.append(label, right);

  const meter = document.createElement("div");
  meter.style.cssText = meterWrapStyle;
  const track = document.createElement("div");
  track.style.cssText = trackStyle;
  const fill = document.createElement("div");
  fill.style.cssText = fillStyle(spec.accent);
  track.appendChild(fill);
  if (spec.tickAt !== undefined) {
    const tick = document.createElement("div");
    tick.style.cssText = tickStyle;
    tick.style.left = `${spec.tickAt * 100}%`;
    track.appendChild(tick);
  }
  const cap = document.createElement("div");
  cap.style.cssText = capStyle;
  if (!spec.centered) track.appendChild(cap);
  meter.appendChild(track);

  const hint = document.createElement("div");
  hint.className = "vc-hint";
  hint.textContent = spec.description;

  el.append(head, meter, hint);

  let peakFrac = 0;
  let flashed = false;
  let lastReadoutKey = "";

  return {
    el,
    /** Extra head slot, before the readout — the Tempo row's beat dot. */
    right,
    /** Fraction of the track (null empties it). `dtSec` drives the peak cap's fall. */
    setValue(value: number | null, dtSec: number): void {
      if (flashed) {
        fill.style.backgroundColor = spec.accent;
        flashed = false;
      }
      if (value === null) {
        fill.style.width = "0";
        cap.style.visibility = "hidden";
        peakFrac = 0;
        return;
      }
      if (spec.centered) {
        const v = clamp(value, -1, 1);
        const half = Math.abs(v) * 50;
        fill.style.left = v < 0 ? `${50 - half}%` : "50%";
        fill.style.width = `${half}%`;
        return;
      }
      const v = clamp(value, 0, 1);
      fill.style.width = `${v * 100}%`;
      peakFrac = Math.max(v, peakFrac - PEAK_FALL_PER_SEC * dtSec);
      cap.style.left = `${peakFrac * 100}%`;
      cap.style.visibility = "visible";
    },
    setReadout(text: string, opts: ReadoutOpts = {}): void {
      const u = opts.unit ?? spec.unit ?? "";
      const key = `${text}|${u}|${opts.textual ? 1 : 0}|${opts.color ?? ""}`;
      if (key === lastReadoutKey) return;
      lastReadoutKey = key;
      digits.textContent = text;
      digits.style.cssText = opts.textual ? digitsTextStyle : digitsStyle;
      if (opts.color) digits.style.color = opts.color;
      unit.textContent = u;
      unit.style.display = u ? "" : "none";
    },
    /** A one-frame event (an onset, a drop): the fill jumps to `color` and
     *  fades back to the accent on the next setValue(). */
    flash(color = "#fff"): void {
      blink(fill, color);
      flashed = true;
    },
    setHint(text: string): void {
      if (hint.textContent !== text) hint.textContent = text;
    },
  };
}
type MeterRow = ReturnType<typeof createMeterRow>;

const IDLE: ReadoutOpts = { textual: true, unit: "" };
const pct = (v: number) => String(Math.round(clamp(v, 0, 1) * 100));

export function createAudioMeters(): AudioMeters {
  const root = document.createElement("div");
  root.className = "vc-meters vc-scroll";

  // ---- Signal ----
  const level = createMeterRow({
    label: "Level",
    accent: INPUT_GREEN,
    unit: "%",
    description: "Raw loudness at the mic, before auto-gain.",
  });
  const energy = createMeterRow({
    label: "Energy",
    accent: INPUT_GREEN,
    unit: "%",
    description: "What the scene reacts to, after auto-gain levels the room — the gap to Level is the gain at work.",
  });
  const bandRows: { row: MeterRow; read: (anim: AnimFrame) => { value: number; onset: boolean } }[] = [
    {
      row: createMeterRow({ label: "Low", accent: STRIP_LOW, unit: "%", description: "Bass, kicks and sub — blinks on a hit." }),
      read: (anim) => ({ value: anim.low, onset: anim.lowOnset }),
    },
    {
      row: createMeterRow({ label: "Mid", accent: STRIP_MID, unit: "%", description: "Vocals, chords, snares — blinks on a hit." }),
      read: (anim) => ({ value: anim.mid, onset: anim.midOnset }),
    },
    {
      row: createMeterRow({ label: "High", accent: STRIP_HIGH, unit: "%", description: "Hats and air — blinks on a hit." }),
      read: (anim) => ({ value: anim.high, onset: anim.highOnset }),
    },
  ];
  const signalCard = createCard({ title: "Signal", accent: INPUT_GREEN });
  signalCard.body.append(level.el, spacer(), energy.el, groupHeading("Bands"));
  bandRows.forEach(({ row }, i) => {
    if (i > 0) signalCard.body.appendChild(spacer());
    signalCard.body.appendChild(row.el);
  });

  // ---- Rhythm ----
  const tempo = createMeterRow({
    label: "Tempo",
    accent: NEUTRAL_ACCENT,
    unit: "bpm",
    description: "Detected tempo. The dot blinks on each beat; the bar is how sure the tracker is.",
  });
  const beatDot = document.createElement("div");
  beatDot.style.cssText = beatDotStyle;
  tempo.right.prepend(beatDot);
  const section = createMeterRow({
    label: "Section",
    accent: NEUTRAL_ACCENT,
    unit: "%",
    description: "How intense this part of the track is against the last while. Flashes red on a drop.",
  });
  const rhythmCard = createCard({ title: "Rhythm", accent: NEUTRAL_ACCENT });
  rhythmCard.body.append(tempo.el, spacer(), section.el);

  // ---- Character ----
  const dialRows = MUSIC_DIALS.map((dial) => ({
    dial,
    row: createMeterRow({
      label: DIAL_LABELS[dial].label,
      accent: AUTO_SKY,
      description: DIAL_LABELS[dial].description,
      tickAt: NEUTRAL[dial],
    }),
  }));
  const characterCard = createCard({ title: "Character", accent: AUTO_SKY });
  dialRows.forEach(({ row }, i) => {
    if (i > 0) characterCard.body.appendChild(spacer());
    characterCard.body.appendChild(row.el);
  });

  // ---- Scope ----
  const waveform = createMeterRow({
    label: "Waveform",
    accent: NEUTRAL_ACCENT,
    unit: "%",
    description: "The signal as it arrives. Red means the mic is clipping — turn the source down.",
  });
  // The trace takes the meter's place under the head.
  const waveCanvas = document.createElement("canvas");
  waveCanvas.style.cssText = waveCanvasStyle;
  waveform.el.children[1].replaceWith(waveCanvas);
  const waveCtx = waveCanvas.getContext("2d")!;
  const width = createMeterRow({ label: "Width", accent: NEUTRAL_ACCENT, unit: "%", description: WIDTH_HINT });
  const balance = createMeterRow({ label: "Balance", accent: NEUTRAL_ACCENT, description: BALANCE_HINT, centered: true });
  const scopeCard = createCard({ title: "Scope", accent: NEUTRAL_ACCENT });
  scopeCard.body.append(waveform.el, spacer(), width.el, spacer(), balance.el);
  scopeCard.el.style.display = "none";
  let scopeShown = false;

  root.append(signalCard.el, rhythmCard.el, characterCard.el, scopeCard.el);

  // devicePixelRatio-scaled backing store, resized whenever the card's
  // layout width changes — same as spectrumStrip.ts.
  let waveCssWidth = 0;
  function ensureWaveSize(): void {
    const rect = waveCanvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    if (w === waveCssWidth) return;
    waveCssWidth = w;
    const dpr = window.devicePixelRatio || 1;
    waveCanvas.width = Math.round(w * dpr);
    waveCanvas.height = Math.round(WAVE_HEIGHT_CSS_PX * dpr);
    waveCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Min/max envelope per pixel column (not decimation) so a one-sample
  // transient still shows as a spike — see waveform.ts's downsampleForDisplay.
  function drawWave(mono: Float32Array, clipped: boolean): void {
    ensureWaveSize();
    const w = waveCssWidth;
    const h = WAVE_HEIGHT_CSS_PX;
    const mid = h / 2;
    waveCtx.clearRect(0, 0, w, h);
    waveCtx.fillStyle = "rgba(255,255,255,0.18)";
    waveCtx.fillRect(0, mid - 0.5, w, 1);

    const { min, max } = downsampleForDisplay(mono, w);
    waveCtx.strokeStyle = clipped ? HOT_RED : "rgba(255,255,255,0.85)";
    waveCtx.lineWidth = 1;
    waveCtx.beginPath();
    for (let x = 0; x < w; x++) {
      waveCtx.moveTo(x + 0.5, mid - max[x] * mid * 0.95);
      waveCtx.lineTo(x + 0.5, mid - min[x] * mid * 0.95);
    }
    waveCtx.stroke();
  }

  let lastMs: number | null = null;
  let lastTextMs = 0;
  let beatLit = false;

  return {
    el: root,
    update(frame, anim, mono, stereo): void {
      const nowMs = performance.now();
      const dtSec = lastMs === null ? 1 / 60 : Math.max(1e-4, (nowMs - lastMs) / 1000);
      lastMs = nowMs;
      const text = nowMs - lastTextMs >= TEXT_REFRESH_MS;
      if (text) lastTextMs = nowMs;

      // ---- Signal ----
      level.setValue(frame ? frame.level : null, dtSec);
      energy.setValue(frame ? frame.energy : null, dtSec);
      if (text) {
        level.setReadout(frame ? pct(frame.level) : "--", frame ? {} : IDLE);
        energy.setReadout(frame ? pct(frame.energy) : "--", frame ? {} : IDLE);
      }
      for (const { row, read } of bandRows) {
        const r = anim ? read(anim) : null;
        row.setValue(r ? r.value : null, dtSec);
        if (r?.onset) row.flash();
        if (text) row.setReadout(r ? pct(r.value) : "--", r ? {} : IDLE);
      }

      // ---- Rhythm ----
      tempo.setValue(anim ? anim.tempoLock : null, dtSec);
      if (beatLit) {
        beatDot.style.backgroundColor = "";
        beatLit = false;
      }
      if (frame?.beat) {
        blink(beatDot, "#fff");
        beatLit = true;
      }
      section.setValue(anim ? anim.sectionIntensity : null, dtSec);
      if (anim?.dropOnset) section.flash(HOT_RED);
      if (text) {
        const bpm = frame?.bpm ?? 0;
        tempo.setReadout(bpm > 0 ? String(Math.round(bpm)) : "--", bpm > 0 ? {} : IDLE);
        section.setReadout(anim ? pct(anim.sectionIntensity) : "--", anim ? {} : IDLE);
      }

      // ---- Character ----
      for (const { dial, row } of dialRows) {
        const v = anim ? anim.profile[dial] : null;
        row.setValue(v, dtSec);
        if (text) row.setReadout(v === null ? "--" : v.toFixed(2), v === null ? IDLE : {});
      }

      // ---- Scope ----
      const showScope = mono !== null;
      if (showScope !== scopeShown) {
        scopeShown = showScope;
        scopeCard.el.style.display = showScope ? "" : "none";
      }
      if (!mono) return;
      const clipped = isClipping(mono);
      drawWave(mono, clipped);
      if (text) {
        if (clipped) waveform.setReadout("CLIP", { textual: true, color: HOT_RED, unit: "" });
        else waveform.setReadout(pct(peak(mono)));
      }
      const hasStereo = !!stereo && stereo.hasStereo;
      width.setValue(hasStereo ? stereo.width : null, dtSec);
      balance.setValue(hasStereo ? stereo.balance : null, dtSec);
      if (text) {
        if (hasStereo) {
          width.setReadout(pct(stereo.width));
          const side = Math.round(Math.abs(stereo.balance) * 100);
          balance.setReadout(String(side), { unit: side === 0 ? "" : stereo.balance < 0 ? "L" : "R" });
          width.setHint(WIDTH_HINT);
          balance.setHint(BALANCE_HINT);
        } else {
          width.setReadout("mono", IDLE);
          balance.setReadout("mono", IDLE);
          width.setHint(MONO_HINT);
          balance.setHint(MONO_HINT);
        }
      }
    },
  };
}
