import type { AnimFrame } from "../render/animClock.ts";
import type { MeterCardId, MeterRowId } from "../render/signals.ts";
import type { FeatureFrame } from "../audio/types.ts";
import { downsampleForDisplay, isClipping, peak } from "../audio/waveform.ts";
import type { LufsReading } from "../audio/lufs.ts";
import { DIAL_LABELS, MUSIC_DIALS, NEUTRAL } from "../render/musicProfile.ts";
import {
  AUTO_SKY,
  FONT_MONO,
  HOT_RED,
  INPUT_GREEN,
  STRIP_HIGH,
  STRIP_LOW,
  STRIP_MID,
  withAlpha,
} from "./controlsTheme.ts";
import {
  chipBtnLitStyle,
  chipBtnStyle,
  createCard,
  createChipButton,
  createTraceLegend,
  digitsStyle,
  digitsTextStyle,
  groupHeadingFirstStyle,
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
 *    since its whole point is to make that invisible downstream — and under
 *    them a History trace of both over the last HISTORY_SPAN_SEC, with
 *    FeatureExtractor.fixedEnergy (energy as it would read with auto-gain
 *    at its minimum) as a dim reference line. The gap between energy and
 *    that reference is exactly what the Input card's Auto-gain amount is
 *    adding; sliding it down closes the gap. (No raw low/mid/high energy
 *    spectrum strip already shows that. Their post-bandEnergy pulses live
 *    in Rhythm's Hits row instead — see below.)
 *  - Loudness: the broadcast measurement — BS.1770 / EBU R128 LUFS from
 *    lufsAnalyser.ts (math in lufs.ts). Momentary on the bar with the
 *    LUFS_TARGET_* marks, Short-term as the big number, Integrated beneath
 *    with a Reset chip. Local-only like the Scope, since it needs this
 *    device's own samples; hidden on a mic-less renderer.
 *  - Rhythm: sectionIntensity with a drop flash, a compact tempo block
 *    beside it — bpm under a beat dot whose resting tint follows
 *    beatClock's tempoLock, so an unlocked guess reads as unconfident
 *    rather than as a confident wrong number — and a Hits row beneath both:
 *    AnimFrame's low/mid/high pulse envelopes (bandEnergy.ts), the
 *    continuous counterpart of the one-shot lowOnset/midOnset/highOnset
 *    edges a scene can trigger from directly (see src/render/signals.ts,
 *    which reads this same envelope so a signal pill stays live on a
 *    render-rate-capped path where the one-shot edge itself would be
 *    silently dropped).
 *  - Character: one row per entry in MUSIC_DIALS (never a hardcoded list),
 *    each marking NEUTRAL with a tick — what autoTune.ts resolves every "A"
 *    chip against, otherwise invisible. Copy comes from DIAL_LABELS. Plus
 *    one hand-added Centroid row (not a MUSIC_DIALS entry) for
 *    spectralCentroid.ts's fast, range-adapted counterpart to the slow
 *    Brightness dial just above it.
 *  - Scope (first): a rolling waveform of the last few seconds with a clip
 *    warning, read straight off this device's mic by waveformAnalyser.ts.
 *    Local-only by construction — samples never cross src/net/protocol.ts's
 *    wire frame, so a mic-less renderer has nothing to show here and the
 *    card hides itself. (No stereo width/balance: a phone or laptop mic is
 *    mono, so they'd read "mono" nearly always.)
 *
 * Fills move every frame; readout text at ~10Hz (the same reasoning as
 * deviceMenu.ts's AUTO_UI_REFRESH_MS — text writes cost layout, and eyes
 * can't read faster anyway). Only the waveform is a canvas.
 *
 * Each card is independently collapsible (controlsKit.ts's createCard
 * foldId, remembered in panelFolds.ts) and update() skips a folded card's
 * work entirely — folding buys back the per-frame cost, not just the
 * screen space.
 *
 * The RAW chip above the cards flips every row that has a pre-smoothing
 * counterpart to it, for diagnosing "is this a bad measurement or just a
 * slow ease": Section reads sectionIntensity's un-slewed target
 * (anim.raw.sectionIntensity), the Character dials read musicProfile's
 * pre-ease targets (anim.raw.profile), BPM skips this file's own settle()
 * pass and shows the estimator's raw candidate, and the waveform's peak
 * readout drops the peak-hold decay. Level and the beat dot are already raw
 * and don't change. Energy has no pre-envelope value threaded through
 * AnimFrame, so it reads the mean of `rawBands` instead — the same
 * pre-AGC/pre-envelope feed app.ts's captureRawBands hands the spectrum
 * strip's own listening-post chip. That feed is local-only, so Energy reads
 * idle under RAW on a mic-less renderer, same as the Scope card hiding
 * itself. A folded card still skips its own work when RAW is on — the flag
 * only changes what a card computes while it's open, not whether folding
 * buys back that cost. The waveform's auto-zoom is NOT part of this: it's a
 * drawing choice (what range fills the card), not audio processing, so it
 * stays on in both modes.
 *
 * Every one of those "un-eased" values is what its smoothed sibling is
 * eternally chasing — none of it is a param a Reset chip can zero out.
 * `rateScale` (this file's update(), threaded from app.ts's
 * sensitivity.ts's smoothingRateScale) is what actually closes the gap: at
 * the Smoothing row's Off stop it's Infinity, and every stage upstream of
 * this file (features.ts's envelope, sectionIntensity.ts's INTENSITY_SLEW,
 * musicProfile.ts's eases) plus this file's own BPM settle and waveform
 * peak-hold snap straight to their targets — see sensitivity.ts's header for
 * the full account of why RAW is then a genuine no-op rather than merely
 * fast.
 */

export interface AudioMeters {
  el: HTMLElement;
  /** Fed every frame while the panel is open. `frame`/`anim` null before
   *  audio is up (idle readouts); `mono`/`rawBands` null on any device
   *  without a local analyser (Scope card hidden; Energy reads idle under
   *  RAW — see file header); `fixedEnergy` null on any device without a
   *  local FeatureExtractor (the History trace drops its reference line);
   *  `lufs` null on any device without a local lufsAnalyser (Loudness card
   *  hidden). A folded card skips its computation and DOM writes for the
   *  frame — folding buys back the layout/canvas cost, not just the screen
   *  space. `rateScale` is app.ts's already-resolved sensitivity.ts's
   *  smoothingRateScale for this tick — non-finite (the Smoothing row's Off
   *  stop) bypasses this file's own BPM settle and waveform peak-hold, the
   *  same way `raw` already does, so RAW and processed agree exactly (see
   *  file header). `fluxRatio` is FeatureExtractor.fluxRatio — how hard the
   *  broadband onset detector's flux cleared its adaptive threshold this
   *  frame (1 is a bare trigger, below 1 a near-miss) — null on the same
   *  devices as `fixedEnergy` (the Onset row reads idle). */
  update(
    frame: FeatureFrame | null,
    anim: AnimFrame | null,
    mono: Float32Array | null,
    rawBands: Float32Array | null,
    rateScale: number,
    fixedEnergy: number | null,
    lufs: LufsReading | null,
    fluxRatio: number | null,
  ): void;
  /** Unfolds `card` if needed (the same click-the-chevron move
   *  deviceMenu.ts's jumpToBlock makes for a folded settings card), scrolls
   *  `row` into view and flashes it — the "reacts to" strip's jump target
   *  (src/ui/deviceMenu.ts). A no-op if `row` was never registered (a
   *  MeterRowId with no matching createMeterRow/welded-block call). */
  revealRow(card: MeterCardId, row: MeterRowId): void;
}

export interface AudioMetersDeps {
  /** The Loudness card's Reset chip: start the integrated reading over. */
  onLufsReset: () => void;
}

const PEAK_FALL_PER_SEC = 1.2; // matches spectrumStrip.ts's peak-hold decay
const TEXT_REFRESH_MS = 100;
// Track width for the Onset row, in units of fluxRatio (1 = the firing
// line). An ordinary hit clears 1 by some margin but rarely reaches this —
// picked so the bar has headroom rather than pinning at full on every beat.
const ONSET_METER_MAX = 2.5;
/** Readings that feed no single system — same neutral as the Palette card. */
const NEUTRAL_ACCENT = "rgba(255,255,255,0.7)";
const WAVE_HEIGHT_CSS_PX = 64;
// The waveform is a rolling history, not a snapshot: one analyser buffer is
// ~40ms — a single kick — and at speech level it drew as a flat hairline.
// Each column holds the min/max over WAVE_COLUMN_MS, so a card's width
// spans the last several seconds regardless of frame rate, and beats read
// as blobs the way they do in an audio editor. The vertical range zooms to
// the loudest column on screen, floored at WAVE_RANGE_FLOOR so silence and
// mic hiss aren't blown up to look like signal.
const WAVE_COLUMN_MS = 16;
const WAVE_RANGE_FLOOR = 0.05;
// Both this waveform and createTraceStrip below close more than one column
// in a single push() whenever a frame outlasts a column — routine once a
// scene is GPU-bound, since a column follows the strip's pixel width while
// push() follows rAF, uncapped by the render-rate cap (see app.ts's loop()).
// Rather than commit those extra columns empty, the sample that closed the
// burst is held across all of them: the reading was there for that whole
// stretch, we just weren't asked for it more often. Past COLUMN_CARRY_MS the
// hold would be a lie — rAF was paused (a hidden tab), not slow — so those
// columns stay empty and draw the same gap they always have.
const COLUMN_CARRY_MS = 250;
const FADE = "background-color 0.3s ease-out";

// The meter sits where a row's slider would, at the slider's height, so meter
// rows and slider rows line up card to card.
const meterWrapStyle = `display: flex; align-items: center; height: 22px; margin-top: 2px;`;
const trackStyle = `position: relative; width: 100%; height: 3px; border-radius: 2px; background: rgba(255,255,255,0.18);`;
const fillStyle = (accent: string) =>
  `position: absolute; top: 0; left: 0; height: 100%; width: 0; border-radius: 2px; background-color: ${accent}; transition: ${FADE};`;
const capStyle = `position: absolute; top: -1px; bottom: -1px; width: 1.5px; left: 0; background: #fff; visibility: hidden;`;
const tickStyle = `position: absolute; top: -2px; bottom: -2px; width: 1px; background: rgba(255,255,255,0.55);`;
// Tempo is a compact block welded beside the Section row — the Auto master
// block's shape (deviceMenu.ts), framed like a woken .vc-row (the same ring
// and tint controlsTheme.ts gives the Section row on hover, with the same
// 6px reach past the row's content) so the two read as one line. Digits,
// caption, and a beat dot beneath. The dot rests at a dim BEAT_COLOR that
// brightens with beatClock's tempoLock (an unconfident guess stays dim);
// each beat it jumps to white inside a BEAT_COLOR halo and eases back into
// the colour as the halo fades — white-to-orange is the beat.
// A .vc-row's ring reaches 8px past its content into the card padding; the
// block reaches the same 8px on its right, and the gap between the two is
// what's left of that reach — so card edge → ring, ring → block, and block →
// card edge are all the same 4px.
const rhythmRowStyle = `display: flex; gap: 12px; align-items: stretch;`;
const tempoBlockStyle = (accent: string) => `
  width: 74px; flex-shrink: 0; display: grid; place-items: center; text-align: center;
  margin: -6px -8px -6px 0; border-radius: 4px;
  background-color: color-mix(in srgb, ${accent} 6%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, ${accent} 45%, transparent);
`;
const BEAT_COLOR = HOT_RED;
const DOT_EASE =
  "background-color 0.55s ease-out, box-shadow 0.55s ease-out, transform 0.55s ease-out";
const tempoDotStyle = `
  width: 6px; height: 6px; border-radius: 50%; margin: 5px auto 0;
  background-color: ${withAlpha(BEAT_COLOR, 0.25)}; box-shadow: 0 0 0 0 transparent;
  transition: ${DOT_EASE};
`;
const tempoDigitsStyle = `${digitsStyle} font-size: 13px; color: #fff; transition: color 0.4s ease-out;`;
const tempoCaptionStyle = `font: 400 8.5px/1.4 ${FONT_MONO}; letter-spacing: 0.14em; color: rgba(255,255,255,0.4); margin-top: 2px;`;
// Loudness card. The bar spans LUFS_SCALE_MIN..MAX — a broadcast meter's
// range, with the two targets people actually aim at marked: EBU R128's
// −23 for broadcast, and the level streaming services normalise to
// (LUFS_TARGET_STREAMING), above which the bar and digits go hot since a
// louder mix will just be turned down on delivery. The block beside the bar
// is the Tempo block's shape, wider for a signed one-decimal reading.
const LUFS_SCALE_MIN = -60;
const LUFS_SCALE_MAX = 0;
const LUFS_TARGET_EBU = -23;
const LUFS_TARGET_STREAMING = -14;
const LUFS_HOT = LUFS_TARGET_STREAMING;
const lufsFrac = (v: number) => (v - LUFS_SCALE_MIN) / (LUFS_SCALE_MAX - LUFS_SCALE_MIN);
const lufsBlockStyle = (accent: string) => `${tempoBlockStyle(accent)} width: 96px;`;
const lufsDigitsStyle = `${tempoDigitsStyle} font-size: 15px;`;
const lufsSubStyle = `${tempoCaptionStyle} letter-spacing: 0.06em; white-space: nowrap;`;
const tickLabelStyle = `
  position: absolute; top: 6px; transform: translateX(-50%);
  font: 400 8px/1 ${FONT_MONO}; letter-spacing: 0.04em; color: rgba(255,255,255,0.45); white-space: nowrap;
`;
const LUFS_TITLE =
  "Short-term loudness: the last 3 s, K-weighted like a broadcast meter. I is the gated average since Reset.";
const TEMPO_TITLE =
  "Tempo. The dot flashes white on every beat and settles back to its colour, brighter as the tracker gets sure.";
// The raw estimate flits between candidates (half/double-time, a fill), but
// a song's tempo hardly ever changes — so the readout shows the value that
// most of the last TEMPO_SETTLE_SEC of readings agree on (within
// TEMPO_SETTLE_TOL of the window's median, at least TEMPO_SETTLE_SHARE of
// them). A majority rather than an unbroken run: on a real mic the estimate
// can blip for an onset or two, and a run that resets on every blip never
// settles at all. Once shown, a value only moves for an agreed value at
// least TEMPO_HOLD_BPM away — enough to stop 124/125 flicker, small enough
// that an early reading a couple of bpm off is corrected rather than
// held. Display-only; nothing downstream reads this.
const TEMPO_SETTLE_SEC = 1.5;
const TEMPO_SETTLE_TOL = 0.03;
const TEMPO_SETTLE_SHARE = 0.6;
const TEMPO_HOLD_BPM = 2;
const waveCanvasStyle = `display: block; width: 100%; height: ${WAVE_HEIGHT_CSS_PX}px; margin-top: 4px;`;
// The Signal card's history trace: level, energy, and the fixed-mapping
// reference over the last HISTORY_SPAN_SEC, one column per CSS pixel so the
// card's width always spans exactly that long. Each column keeps the max of
// what it saw, so a beat's peak survives however many frames a column
// covers. Long enough to see the adaptive window re-settle after a change
// in room level (a couple of seconds — see features.ts's FLOOR_RISE_RATE)
// with the before and after both still on screen. traceLegend below reads
// its swatch colours from the same HISTORY_*_COLOR constants the strokes
// use, so the two can't drift apart; its reference entry dims when this
// frame's source has no fixed-mapping reading to show (see createTraceStrip's
// push). The Character card's Centroid trace (below, no legend — one series
// needs none) shares this same span and the createTraceStrip machinery.
const HISTORY_SPAN_SEC = 10;
const HISTORY_HEIGHT_CSS_PX = 48;
const CENTROID_TRACE_HEIGHT_CSS_PX = 28;
const HISTORY_LEVEL_COLOR = "rgba(255,255,255,0.85)";
const HISTORY_ENERGY_COLOR = INPUT_GREEN;
// A different hue from Energy's green, not just a dimmer shade of it — the
// two need to read apart at a glance, and blue is already this UI's colour
// for the auto-gain/auto-tune system (AUTO_SKY, Character card).
const HISTORY_FIXED_COLOR = withAlpha(AUTO_SKY, 0.75);

interface TraceStripSeries {
  color: string;
  width: number;
}

/** A rolling ring-buffer history trace, one column per CSS pixel over
 *  HISTORY_SPAN_SEC, one line per series — the Signal card's History (three
 *  series: level, energy, the fixed-mapping reference) and the Character
 *  card's Centroid trace (one series, no legend) both drive one of these.
 *  Each series' column is a max-hold of what push() saw since the column
 *  before last closed, so a transient survives however many frames the
 *  column spans; when push() closes several columns in one call (see
 *  COLUMN_CARRY_MS above) the sample that closed them is held across all
 *  but blank past the carry bound. A column stays NaN when nothing was ever
 *  sampled for it — a null reading this series had no value for, or a carry
 *  bound stretch with no reading at all — which traceHistory's caller
 *  (below) reads as "lift the pen" rather than a reading of zero, the same
 *  gap HISTORY_FIXED_COLOR relies on for a source with no fixed-mapping
 *  reading this tick. */
function createTraceStrip(series: TraceStripSeries[], heightPx: number) {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = `display: block; width: 100%; height: ${heightPx}px; margin-top: 4px;`;
  const ctx = canvas.getContext("2d")!;

  let bufs: Float32Array[] = series.map(() => new Float32Array(0));
  let head = 0;
  // The column being accumulated, one slot per series — NaN means "nothing
  // folded in yet this column", not "zero". commitColumn() below relies on
  // Number.isNaN to tell first-touch-this-column apart from a genuine 0.
  let colVals: number[] = series.map(() => Number.NaN);
  // A burst's filler once past COLUMN_CARRY_MS — never mutated.
  const blank: number[] = series.map(() => Number.NaN);
  let colStartMs: number | null = null;
  let cssWidth = 0;
  // Follows the width so the trace always spans exactly HISTORY_SPAN_SEC.
  let columnMs = 1000;

  function ensureSize(): boolean {
    const rect = canvas.getBoundingClientRect();
    const w = Math.round(rect.width);
    if (w <= 0) return false;
    if (w === cssWidth) return true;
    cssWidth = w;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(heightPx * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bufs = series.map(() => new Float32Array(w).fill(Number.NaN));
    head = 0;
    columnMs = (HISTORY_SPAN_SEC * 1000) / w;
    return true;
  }

  function commitColumn(vals: number[]): void {
    for (let i = 0; i < series.length; i++) bufs[i][head] = vals[i];
    head = (head + 1) % bufs[0].length;
  }

  /** One polyline over the ring buffer plus the live (in-progress) column at
   *  the right edge; a NaN reading lifts the pen so a missing sample leaves
   *  a gap rather than a line to zero. */
  function traceHistory(buf: Float32Array, live: number, color: string, width: number): void {
    const len = buf.length;
    const h = heightPx;
    const yOf = (v: number) => 1 + (1 - clamp(v, 0, 1)) * (h - 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    let pen = false;
    for (let x = 0; x <= len; x++) {
      const v = x === len ? live : buf[(head + x) % len];
      if (Number.isNaN(v)) {
        pen = false;
        continue;
      }
      const px = x === len ? cssWidth - 1 : x;
      if (pen) ctx.lineTo(px, yOf(v));
      else ctx.moveTo(px, yOf(v));
      pen = true;
    }
    ctx.stroke();
  }

  return {
    canvas,
    /** One sample per series, `null` where this tick has no reading for that
     *  series (e.g. no fixed-mapping reference) — max-held into the current
     *  column, closing it (or several, after a stall) once `columnMs` has
     *  passed. Call every tick the card is open; skip entirely while folded,
     *  same as resetColumn() below. */
    push(values: (number | null)[], nowMs: number): void {
      if (!ensureSize()) return;
      for (let i = 0; i < series.length; i++) {
        const v = values[i];
        if (v === null) continue;
        colVals[i] = Number.isNaN(colVals[i]) ? v : Math.max(colVals[i], v);
      }
      if (colStartMs === null) colStartMs = nowMs;
      const elapsed = nowMs - colStartMs;
      if (elapsed < columnMs) return;
      let n = Math.min(bufs[0].length, Math.floor(elapsed / columnMs));
      // A frame that outlasts a column closes several at once (see
      // COLUMN_CARRY_MS above) — this push's sample is a reading for now, so
      // it lands in the newest column, while the ones before it in the same
      // burst hold that same sample (ordinary frame pacing) or go blank (a
      // stall: nothing was actually sampled through that stretch).
      const filler = elapsed > COLUMN_CARRY_MS ? blank : colVals;
      for (; n > 1; n--) commitColumn(filler);
      commitColumn(colVals);
      colVals = colVals.map(() => Number.NaN);
      colStartMs = nowMs - (elapsed % columnMs);
    },
    /** Redraws every series in the order given to createTraceStrip — the
     *  last one lands on top, same as the Signal card putting Level over
     *  Energy over the fixed-mapping reference. */
    draw(): void {
      const w = cssWidth;
      const h = heightPx;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillRect(0, Math.round(h / 2) - 0.5, w, 1);
      for (let i = 0; i < series.length; i++) {
        traceHistory(bufs[i], colVals[i], series[i].color, series[i].width);
      }
    },
    /** Don't accumulate a column while the card holding this strip is
     *  hidden (folded) — same reasoning as the waveform's own fold guard. */
    resetColumn(): void {
      colStartMs = null;
    },
  };
}

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

const ROW_FLASH_MS = 900;
/** Same jump-then-fade shape as blink(), applied to a row's own ring
 *  (.vc-row's hover box-shadow, controlsTheme.ts) instead of a fill's
 *  background — AudioMeters.revealRow's "you're looking at the right row"
 *  cue, since a jumped-to row isn't necessarily under the pointer. */
function flashRow(el: HTMLElement): void {
  el.style.transition = "none";
  el.style.boxShadow = "0 0 0 1px #fff, 0 0 16px 2px rgba(255,255,255,0.5)";
  void el.offsetWidth; // commit the jump before the fade is re-enabled
  el.style.transition = "box-shadow 0.6s ease-out";
  // The fade-to-nothing has to start on a later paint than the jump above,
  // or the browser coalesces both writes into one frame and nothing visibly
  // eases — same reasoning as blink()'s reflow, one step further because
  // this fades to a cleared style rather than to a value a later real update
  // will overwrite on its own.
  requestAnimationFrame(() => {
    el.style.boxShadow = "";
  });
  setTimeout(() => {
    el.style.transition = "";
  }, ROW_FLASH_MS);
}

interface MeterRowSpec {
  label: string;
  accent: string;
  /** Mono suffix after the digits ("%", "bpm"). */
  unit?: string;
  /** The hint that unfolds on hover/tap. Omit for a row that explains
   *  itself (the waveform) — no hint, and nothing to focus for. */
  description?: string;
  /** Fixed marks at these fractions of the track — the dials' NEUTRAL, the
   *  Loudness card's targets. A labelled tick gets its text just under the
   *  track. */
  ticks?: { at: number; label?: string }[];
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
  if (spec.description) el.tabIndex = 0;
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
  let labelled = false;
  for (const t of spec.ticks ?? []) {
    const tick = document.createElement("div");
    tick.style.cssText = tickStyle;
    tick.style.left = `${t.at * 100}%`;
    track.appendChild(tick);
    if (!t.label) continue;
    const text = document.createElement("div");
    text.style.cssText = tickLabelStyle;
    text.style.left = `${t.at * 100}%`;
    text.textContent = t.label;
    track.appendChild(text);
    labelled = true;
  }
  // Labels hang below the track, past the meter's fixed height — give them
  // room so they don't sit on the (collapsed) hint.
  if (labelled) meter.style.marginBottom = "8px";
  const cap = document.createElement("div");
  cap.style.cssText = capStyle;
  track.appendChild(cap);
  meter.appendChild(track);

  const hint = document.createElement("div");
  hint.className = "vc-hint";
  hint.textContent = spec.description ?? "";
  if (!spec.description) hint.style.display = "none";

  el.append(head, meter, hint);

  let peakFrac = 0;
  let flashed = false;
  let lastReadoutKey = "";
  // What the fill settles back to after a flash — the accent unless
  // setFillColor has moved it (the Loudness bar going hot).
  let restColor = spec.accent;

  return {
    el,
    /** Fraction of the track (null empties it). `dtSec` drives the peak cap's fall. */
    setValue(value: number | null, dtSec: number): void {
      if (flashed) {
        fill.style.backgroundColor = restColor;
        flashed = false;
      }
      if (value === null) {
        fill.style.width = "0";
        cap.style.visibility = "hidden";
        peakFrac = 0;
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
     *  fades back to the resting colour on the next setValue(). */
    flash(color = "#fff"): void {
      blink(fill, color);
      flashed = true;
    },
    /** A sustained state (the Loudness bar past its hot mark): the colour
     *  the fill rests at from now on. Keyed, so a per-frame call is free. */
    setFillColor(color: string): void {
      if (color === restColor) return;
      restColor = color;
      if (!flashed) fill.style.backgroundColor = color;
    },
  };
}
function createTempoBlock(accent: string) {
  const el = document.createElement("div");
  el.style.cssText = tempoBlockStyle(accent);
  el.title = TEMPO_TITLE;
  const inner = document.createElement("div");
  const dot = document.createElement("div");
  dot.style.cssText = tempoDotStyle;
  const digits = document.createElement("div");
  digits.style.cssText = tempoDigitsStyle;
  const caption = document.createElement("div");
  caption.style.cssText = tempoCaptionStyle;
  caption.textContent = "BPM";
  inner.append(digits, caption, dot);
  el.appendChild(inner);

  let restColor = withAlpha(BEAT_COLOR, 0.25);
  let lit = false;
  let lastLockStep = -1;
  let shownBpm = 0;
  let wasRaw = false;
  const samples: { atMs: number; bpm: number }[] = [];
  digits.textContent = "--";

  function settle(): void {
    dot.style.backgroundColor = restColor;
    dot.style.boxShadow = "0 0 0 0 transparent";
    dot.style.transform = "scale(1)";
  }

  return {
    el,
    /** Per frame. `lock` (0..1) sets the resting tint; a lit dot eases back
     *  to it on the frame after its beat. */
    update(lock: number, beat: boolean): void {
      // Quantised so the resting tint isn't rewritten every frame.
      const step = Math.round(lock * 20);
      if (step !== lastLockStep) {
        lastLockStep = step;
        restColor = withAlpha(BEAT_COLOR, 0.25 + 0.6 * (step / 20));
        digits.style.color = `rgba(255,255,255,${(0.45 + 0.55 * (step / 20)).toFixed(3)})`;
      }
      if (lit) {
        settle();
        lit = false;
      }
      if (beat) {
        // Jump with no easing, then re-arm the easing so the next settle()
        // fades — same shape as blink(), with glow and size along for the ride.
        dot.style.transition = "none";
        dot.style.backgroundColor = "#fff";
        dot.style.boxShadow = `0 0 6px 1px ${BEAT_COLOR}`;
        dot.style.transform = "scale(1.6)";
        void dot.offsetWidth;
        dot.style.transition = DOT_EASE;
        lit = true;
      }
    },
    /** At the text tick, with the raw estimate (0 = none): settles it
     *  before showing — see TEMPO_SETTLE_SEC. `raw` bypasses the settle pass
     *  entirely and shows the estimate as-is — true for the meters' RAW
     *  chip, and also (from update() below) whenever `rateScale` is
     *  non-finite (Smoothing's Off stop), so the processed reading lands on
     *  the exact same unsettled number RAW already shows rather than merely
     *  a fast-settling one. Samples keep accumulating underneath either way,
     *  so settle() picks up cleanly the moment `raw` goes back to false. */
    settle(bpm: number, nowMs: number, raw: boolean): void {
      samples.push({ atMs: nowMs, bpm });
      while (samples.length && samples[0].atMs < nowMs - TEMPO_SETTLE_SEC * 1000) samples.shift();

      if (raw) {
        wasRaw = true;
        digits.textContent = bpm > 0 ? String(Math.round(bpm)) : "--";
        return;
      }
      if (wasRaw) {
        // Force a repaint back to the settled value: the digits currently
        // show whatever the raw estimate last landed on, which the guards
        // below won't necessarily overwrite on their own.
        wasRaw = false;
        digits.textContent = shownBpm > 0 ? String(shownBpm) : "--";
      }
      if (samples.length < 2 || nowMs - samples[0].atMs < TEMPO_SETTLE_SEC * 800) return;

      const sorted = samples.map((s) => s.bpm).sort((a, b) => a - b);
      const median = sorted[sorted.length >> 1];
      const tol = Math.max(1, median * TEMPO_SETTLE_TOL);
      let agree = 0;
      let sum = 0;
      for (const v of sorted) {
        if (Math.abs(v - median) > tol) continue;
        agree++;
        sum += v;
      }
      if (agree < samples.length * TEMPO_SETTLE_SHARE) return;

      const next = median > 0 ? Math.round(sum / agree) : 0;
      if (next === shownBpm || (shownBpm > 0 && next > 0 && Math.abs(next - shownBpm) < TEMPO_HOLD_BPM)) return;
      shownBpm = next;
      digits.textContent = shownBpm > 0 ? String(shownBpm) : "--";
    },
  };
}

const hitBarWrapStyle = `display: flex; flex-direction: column; align-items: center; gap: 3px; flex: 1; min-width: 0;`;
const hitBarTrackStyle = `position: relative; width: 100%; height: 3px; border-radius: 2px; background: rgba(255,255,255,0.18);`;
const hitBarLabelStyle = `font: 400 8.5px/1 ${FONT_MONO}; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.45);`;

/** One band's mini bar in the Hits row below — width tracks bandEnergy's
 *  pulse envelope directly (no peak-hold, no per-frame flash call needed:
 *  the envelope's own decay from onset back to baseline is the blink). */
function createHitBar(label: string, accent: string) {
  const el = document.createElement("div");
  el.style.cssText = hitBarWrapStyle;
  const track = document.createElement("div");
  track.style.cssText = hitBarTrackStyle;
  const fill = document.createElement("div");
  fill.style.cssText = fillStyle(accent);
  track.appendChild(fill);
  const lbl = document.createElement("div");
  lbl.textContent = label;
  lbl.style.cssText = hitBarLabelStyle;
  el.append(track, lbl);
  return {
    el,
    setValue(v: number): void {
      fill.style.width = `${clamp(v, 0, 1) * 100}%`;
    },
  };
}

/** Rhythm's third row: bandEnergy's low/mid/high pulse envelopes
 *  (AnimFrame.lowPulse/midPulse/highPulse) — the continuous form of the
 *  lowOnset/midOnset/highOnset edges a scene can trigger from directly
 *  (caustics' Beat ripple, among others). Distinct from the spectrum
 *  strip's bars, which show raw per-band energy, not this file's own
 *  onset-shaped pulses. Same tints as the spectrum strip's own low/mid/high
 *  bars (STRIP_LOW/MID/HIGH) so the two read as the same three ranges. */
function createHitsRow() {
  const el = document.createElement("div");
  el.className = "vc-row";
  el.tabIndex = 0;
  el.style.setProperty("--vc-accent", NEUTRAL_ACCENT);

  const head = document.createElement("div");
  head.style.cssText = rowHeadStyle;
  const label = document.createElement("div");
  label.textContent = "Hits";
  label.className = "vc-label";
  label.style.cssText = rowLabelStyle;
  head.appendChild(label);

  const bars = document.createElement("div");
  bars.style.cssText = `display: flex; gap: 10px; margin-top: 6px;`;
  const low = createHitBar("Low", STRIP_LOW);
  const mid = createHitBar("Mid", STRIP_MID);
  const high = createHitBar("High", STRIP_HIGH);
  bars.append(low.el, mid.el, high.el);

  const hint = document.createElement("div");
  hint.className = "vc-hint";
  hint.textContent =
    "Per-band onset pulses — the edges a scene can drive a discrete effect from (a beat ripple's bass trigger, say) instead of a continuous level.";

  el.append(head, bars, hint);

  return {
    el,
    setValues(lowV: number, midV: number, highV: number): void {
      low.setValue(lowV);
      mid.setValue(midV);
      high.setValue(highV);
    },
  };
}

/** The Loudness card's welded block: Short-term as the big seven-segment
 *  reading (toFixed's ASCII minus renders in DSEG7), "LUFS" under it, and
 *  the Integrated reading beneath that. Digits go hot past LUFS_HOT. */
function createLufsBlock(accent: string) {
  const el = document.createElement("div");
  el.style.cssText = lufsBlockStyle(accent);
  el.title = LUFS_TITLE;
  const inner = document.createElement("div");
  const digits = document.createElement("div");
  digits.style.cssText = lufsDigitsStyle;
  digits.textContent = "--";
  const caption = document.createElement("div");
  caption.style.cssText = tempoCaptionStyle;
  caption.textContent = "LUFS";
  const sub = document.createElement("div");
  sub.style.cssText = lufsSubStyle;
  sub.textContent = "I --";
  inner.append(digits, caption, sub);
  el.appendChild(inner);

  const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : "--");
  let lastKey = "";
  return {
    el,
    /** At the text tick. */
    set(reading: LufsReading): void {
      const s = fmt(reading.shortTerm);
      const i = fmt(reading.integrated);
      const hot = reading.shortTerm > LUFS_HOT;
      const key = `${s}|${i}|${hot ? 1 : 0}`;
      if (key === lastKey) return;
      lastKey = key;
      digits.textContent = s;
      digits.style.color = hot ? HOT_RED : "#fff";
      sub.textContent = `I ${i}`;
    },
  };
}

const IDLE: ReadoutOpts = { textual: true, unit: "" };
const pct = (v: number) => String(Math.round(clamp(v, 0, 1) * 100));
const meanOf = (v: Float32Array) => {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i];
  return v.length > 0 ? sum / v.length : 0;
};

// A slim control strip above the cards, not itself a card — "Meters" reads
// as a section label the same way groupHeading marks a block of rows
// elsewhere, with the RAW chip in the same right-hand slot a card's own
// header chip would sit in (see createCard's `right`).
const metersHeaderStyle = `display: flex; align-items: center; justify-content: space-between; margin: 2px 0 10px;`;
const metersHeaderLabelStyle = `${groupHeadingFirstStyle} margin: 0;`;
const RAW_CHIP_TITLE =
  "Every reading below its pre-smoothing value: Section, Character and BPM jitter frame to frame instead of easing. That easing is built into the pipeline, not a setting — Reset won't close the gap. Drag Smoothing (Input card) to Off instead: at Off, every eased reading lands on exactly what RAW already shows, so there's nothing left to toggle.";

export function createAudioMeters(deps: AudioMetersDeps): AudioMeters {
  const root = document.createElement("div");
  root.className = "vc-meters vc-scroll";

  let showRaw = false;
  const metersHeader = document.createElement("div");
  metersHeader.style.cssText = metersHeaderStyle;
  const metersHeaderLabel = document.createElement("div");
  metersHeaderLabel.textContent = "Meters";
  metersHeaderLabel.style.cssText = metersHeaderLabelStyle;
  const rawChip = createChipButton("RAW", RAW_CHIP_TITLE, () => {
    showRaw = !showRaw;
    rawChip.style.cssText = showRaw ? chipBtnLitStyle : chipBtnStyle;
  });
  metersHeader.append(metersHeaderLabel, rawChip);

  // ---- Signal ----
  const level = createMeterRow({
    label: "Level",
    accent: INPUT_GREEN,
    unit: "%",
    description:
      "How loud the room is on a fixed quiet-to-loud scale. Doesn't auto-adjust: a quiet room reads low and stays low.",
  });
  const energy = createMeterRow({
    label: "Energy",
    accent: INPUT_GREEN,
    unit: "%",
    description:
      "The same sound after auto-gain, which keeps it mid-range whether the room is quiet or loud. This is what the scene actually reacts to.",
  });
  const history = createMeterRow({
    label: "History",
    accent: INPUT_GREEN,
    unit: "s",
    description:
      "The last few seconds of Level and Energy. The gap between Energy and No auto-gain is what the Auto-gain slider is adding.",
  });
  // The trace takes the meter's place under the head, like the waveform.
  // Series order (fixed, energy, level) is the paint order: level lands on
  // top, matching HISTORY_*_COLOR's original z-order.
  const historyStrip = createTraceStrip(
    [
      { color: HISTORY_FIXED_COLOR, width: 1 },
      { color: HISTORY_ENERGY_COLOR, width: 1.5 },
      { color: HISTORY_LEVEL_COLOR, width: 1 },
    ],
    HISTORY_HEIGHT_CSS_PX,
  );
  history.el.children[1].replaceWith(historyStrip.canvas);
  history.setReadout(String(HISTORY_SPAN_SEC));
  const histLegend = createTraceLegend([
    { color: HISTORY_LEVEL_COLOR, label: "Level" },
    { color: HISTORY_ENERGY_COLOR, label: "Energy" },
    { color: HISTORY_FIXED_COLOR, label: "No auto-gain" },
  ]);
  historyStrip.canvas.after(histLegend.el);
  const signalCard = createCard({ title: "Signal", accent: INPUT_GREEN, foldId: "signal" });
  signalCard.body.append(level.el, spacer(), energy.el, spacer(), history.el);

  // ---- Loudness ----
  const lufsRow = createMeterRow({
    label: "Momentary",
    accent: NEUTRAL_ACCENT,
    description:
      "Loudness the way broadcast meters measure it (BS.1770, K-weighted). The bar and this number are the last 400 ms; the big number the last 3 s; I the gated average since Reset. −23 is the EBU R128 broadcast target; streaming services normalise to about −14, and the bar goes red above it.",
    ticks: [
      { at: lufsFrac(LUFS_TARGET_EBU), label: String(LUFS_TARGET_EBU) },
      { at: lufsFrac(LUFS_TARGET_STREAMING), label: String(LUFS_TARGET_STREAMING) },
    ],
  });
  lufsRow.el.style.flex = "1";
  lufsRow.el.style.minWidth = "0";
  const lufsBlock = createLufsBlock(NEUTRAL_ACCENT);
  const lufsWelded = document.createElement("div");
  lufsWelded.style.cssText = rhythmRowStyle;
  lufsWelded.append(lufsRow.el, lufsBlock.el);
  const lufsCard = createCard({
    title: "Loudness",
    accent: NEUTRAL_ACCENT,
    foldId: "lufs",
    right: createChipButton("Reset", "Start the integrated reading over", deps.onLufsReset),
  });
  lufsCard.body.appendChild(lufsWelded);
  lufsCard.el.style.display = "none";
  let lufsShown = false;

  // ---- Rhythm ----
  const section = createMeterRow({
    label: "Section",
    accent: NEUTRAL_ACCENT,
    unit: "%",
    description:
      "How intense this part of the track is against the last while. Flashes red on a drop.",
  });
  section.el.style.flex = "1";
  section.el.style.minWidth = "0";
  const tempo = createTempoBlock(NEUTRAL_ACCENT);
  const rhythmRow = document.createElement("div");
  rhythmRow.style.cssText = rhythmRowStyle;
  rhythmRow.append(section.el, tempo.el);
  const hits = createHitsRow();
  // The onset detector's own input: how hard this frame's spectral flux
  // cleared its adaptive threshold (FeatureExtractor.fluxRatio). The tick
  // marks the firing line — right of it, the beat dot just flashed; left of
  // it, a near-miss. Track runs to ONSET_METER_MAX so an ordinary hit (~1-2)
  // reads with headroom rather than pinning the bar every time.
  const onset = createMeterRow({
    label: "Onset",
    accent: NEUTRAL_ACCENT,
    ticks: [{ at: 1 / ONSET_METER_MAX, label: "fires" }],
    description:
      "How hard the broadband onset detector's flux cleared its threshold this frame — past the mark is a beat, short of it a near-miss.",
  });
  const rhythmCard = createCard({ title: "Rhythm", accent: NEUTRAL_ACCENT, foldId: "rhythm" });
  rhythmCard.body.append(rhythmRow, spacer(), hits.el, spacer(), onset.el);

  // ---- Character ----
  const dialRows = MUSIC_DIALS.map((dial) => ({
    dial,
    row: createMeterRow({
      label: DIAL_LABELS[dial].label,
      accent: AUTO_SKY,
      description: DIAL_LABELS[dial].description,
      ticks: [{ at: NEUTRAL[dial] }],
    }),
  }));
  // Fast counterpart to the (slow, eased) Brightness dial above — see
  // spectralCentroid.ts. Hand-added rather than folded into dialRows: it's
  // not one of MUSIC_DIALS, just placed alongside them because it's the
  // live signal Brightness is the track-level summary of.
  const centroidRow = createMeterRow({
    label: "Centroid",
    accent: AUTO_SKY,
    description: "Live spectral centroid, range-adapted to this track's own recent swing — 0.5 is its own recent middle, not an absolute mid-spectrum reading. The fast counterpart to Brightness above. Below the bar, the last few seconds of it — the shape brightness moves in, since an instant reading alone just jitters.",
    ticks: [{ at: 0.5 }],
  });
  // Inserted before the hint (el's 3rd child), so it sits under the meter
  // like the Signal card's History — always visible, not hover-revealed.
  // One series, so no legend; RAW briefly mixes raw/processed samples in
  // the same trace right after a toggle, until HISTORY_SPAN_SEC rolls the
  // pre-toggle column out — harmless, and self-heals.
  const centroidTrace = createTraceStrip([{ color: AUTO_SKY, width: 1.5 }], CENTROID_TRACE_HEIGHT_CSS_PX);
  centroidRow.el.insertBefore(centroidTrace.canvas, centroidRow.el.children[2]);
  const characterCard = createCard({ title: "Character", accent: AUTO_SKY, foldId: "character" });
  dialRows.forEach(({ row }, i) => {
    if (i > 0) characterCard.body.appendChild(spacer());
    characterCard.body.appendChild(row.el);
  });
  characterCard.body.appendChild(spacer());
  characterCard.body.appendChild(centroidRow.el);

  // ---- Scope ----
  const waveform = createMeterRow({
    label: "Waveform",
    accent: NEUTRAL_ACCENT,
    unit: "%",
  });
  // The trace takes the meter's place under the head.
  const waveCanvas = document.createElement("canvas");
  waveCanvas.style.cssText = waveCanvasStyle;
  waveform.el.children[1].replaceWith(waveCanvas);
  const waveCtx = waveCanvas.getContext("2d")!;
  const scopeCard = createCard({ title: "Scope", accent: NEUTRAL_ACCENT, foldId: "scope" });
  scopeCard.body.appendChild(waveform.el);
  scopeCard.el.style.display = "none";
  let scopeShown = false;

  // The scope leads: it's the one live picture of the sound itself, and the
  // first thing to check when the visuals seem off.
  root.append(metersHeader, scopeCard.el, signalCard.el, lufsCard.el, rhythmCard.el, characterCard.el);

  // Ring buffer of columns, one pixel each — oldest at `head`, newest just
  // before it — plus the column currently being accumulated.
  let histMin = new Float32Array(0);
  let histMax = new Float32Array(0);
  let histClip = new Uint8Array(0);
  let head = 0;
  let colMin = 0;
  let colMax = 0;
  let colClip = false;
  let colStartMs: number | null = null;

  // devicePixelRatio-scaled backing store, resized whenever the card's
  // layout width changes — same as spectrumStrip.ts. The history is one
  // column per CSS pixel, so it's rebuilt (cleared) with the width.
  let waveCssWidth = 0;
  /** False while the canvas has no layout (the card is folded, or the panel
   *  is closed) — same reasoning as spectrumStrip.ts's ensureSize: sizing to
   *  a clamped 1px here would rebuild (clear) the wave history the moment
   *  the card is hidden, then stretch a 1px backing store across it on show. */
  function ensureWaveSize(): boolean {
    const rect = waveCanvas.getBoundingClientRect();
    const w = Math.round(rect.width);
    if (w <= 0) return false;
    if (w === waveCssWidth) return true;
    waveCssWidth = w;
    const dpr = window.devicePixelRatio || 1;
    waveCanvas.width = Math.round(w * dpr);
    waveCanvas.height = Math.round(WAVE_HEIGHT_CSS_PX * dpr);
    waveCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    histMin = new Float32Array(w);
    histMax = new Float32Array(w);
    histClip = new Uint8Array(w);
    head = 0;
    return true;
  }

  function commitColumn(min: number, max: number, clip: boolean): void {
    histMin[head] = min;
    histMax[head] = max;
    histClip[head] = clip ? 1 : 0;
    head = (head + 1) % histMin.length;
  }

  /** Folds this frame's buffer into the current column, and closes it (or
   *  several, after a frame that outlasts WAVE_COLUMN_MS — held across the
   *  burst, or blank past COLUMN_CARRY_MS — once WAVE_COLUMN_MS has
   *  passed). */
  function pushWave(mono: Float32Array, clipped: boolean, nowMs: number): void {
    if (!ensureWaveSize()) return;
    const { min, max } = downsampleForDisplay(mono, 1);
    colMin = Math.min(colMin, min[0]);
    colMax = Math.max(colMax, max[0]);
    colClip = colClip || clipped;
    if (colStartMs === null) colStartMs = nowMs;
    const elapsed = nowMs - colStartMs;
    if (elapsed < WAVE_COLUMN_MS) return;
    // A long stall (tab hidden) shouldn't paint a screen of stale columns:
    // cap the catch-up at the visible width, and rest at silence rather than
    // holding a reading through time nothing was actually sampled.
    let n = Math.min(histMin.length, Math.floor(elapsed / WAVE_COLUMN_MS));
    const stalled = elapsed > COLUMN_CARRY_MS;
    for (; n > 1; n--) commitColumn(stalled ? 0 : colMin, stalled ? 0 : colMax, !stalled && colClip);
    commitColumn(colMin, colMax, colClip);
    colMin = 0;
    colMax = 0;
    colClip = false;
    colStartMs = nowMs - (elapsed % WAVE_COLUMN_MS);
  }

  /** Zooms to the loudest column on screen, in both RAW and processed modes
   *  — this is a drawing choice (what range fills the card), not audio
   *  processing, so unlike the rest of the RAW chip it never changes with
   *  it (see file header). */
  function drawWave(): void {
    const w = waveCssWidth;
    const h = WAVE_HEIGHT_CSS_PX;
    const mid = h / 2;
    const len = histMin.length;
    waveCtx.clearRect(0, 0, w, h);

    let range = WAVE_RANGE_FLOOR;
    for (let i = 0; i < len; i++) range = Math.max(range, histMax[i], -histMin[i]);
    range = Math.max(range, colMax, -colMin);
    const scale = (mid * 0.92) / range;

    // Oldest on the left; the live, still-open column at the right edge.
    let lastClip = -1;
    for (let x = 0; x <= len; x++) {
      const live = x === len;
      const i = (head + x) % len;
      const lo = live ? colMin : histMin[i];
      const hi = live ? colMax : histMax[i];
      const clip = live ? (colClip ? 1 : 0) : histClip[i];
      if (clip !== lastClip) {
        waveCtx.fillStyle = clip ? HOT_RED : "rgba(255,255,255,0.8)";
        lastClip = clip;
      }
      const y0 = mid - hi * scale;
      const y1 = mid - lo * scale;
      waveCtx.fillRect(live ? w - 1 : x, y0, 1, Math.max(1, y1 - y0));
    }

    waveCtx.fillStyle = "rgba(255,255,255,0.18)";
    waveCtx.fillRect(0, mid - 0.5, w, 1);
  }

  let lastMs: number | null = null;
  let lastTextMs = 0;
  // Peak-hold for the waveform readout: one buffer's peak jumps around too
  // fast to read, so it holds and falls at the meters' cap rate.
  let wavePeak = 0;

  // src/render/signals.ts's monitor anchors — populated on demand as a
  // SignalSpec starts pointing at a card/row, never exhaustively (see
  // MeterCardId/MeterRowId's own doc comments). section.el and tempo.el are
  // the actual flash/scroll targets, not their shared rhythmRow wrapper, so
  // a jump highlights only the half of the welded row the signal is about.
  const cardElements: Record<MeterCardId, HTMLElement> = {
    scope: scopeCard.el,
    signal: signalCard.el,
    lufs: lufsCard.el,
    rhythm: rhythmCard.el,
    character: characterCard.el,
  };
  const rowElements = new Map<MeterRowId, HTMLElement>([
    ["section", section.el],
    ["tempo", tempo.el],
    ["hits", hits.el],
    ["centroid", centroidRow.el],
  ]);

  return {
    el: root,
    update(frame, anim, mono, rawBands, rateScale, fixedEnergy, lufs, fluxRatio): void {
      const nowMs = performance.now();
      const dtSec =
        lastMs === null ? 1 / 60 : Math.max(1e-4, (nowMs - lastMs) / 1000);
      lastMs = nowMs;
      const text = nowMs - lastTextMs >= TEXT_REFRESH_MS;
      if (text) lastTextMs = nowMs;
      const raw = showRaw;
      // Smoothing's Off stop (sensitivity.ts's smoothingRateScale returns
      // Infinity there) — bypasses this file's own BPM settle and waveform
      // peak-hold the same way `raw` does, so RAW has nothing left to show
      // that the processed reading doesn't already match (see file header).
      const smoothingOff = !Number.isFinite(rateScale);

      // ---- Signal ----
      // Level is already raw and doesn't change; Energy's raw counterpart
      // is rawBands (see file header), local-only like mono/the Scope card.
      if (!signalCard.fold?.isFolded()) {
        const energyVal = raw
          ? rawBands
            ? meanOf(rawBands)
            : null
          : frame
            ? frame.energy
            : null;
        level.setValue(frame ? frame.level : null, dtSec);
        energy.setValue(energyVal, dtSec);
        if (text) {
          level.setReadout(frame ? pct(frame.level) : "--", frame ? {} : IDLE);
          energy.setReadout(
            energyVal === null ? "--" : pct(energyVal),
            energyVal === null ? IDLE : {},
          );
        }
        if (frame) {
          historyStrip.push([fixedEnergy, frame.energy, frame.level], nowMs);
          historyStrip.draw();
          histLegend.setEntryEnabled(2, fixedEnergy !== null);
        }
      } else {
        // Folded: don't accumulate a column while hidden, same as the Scope.
        historyStrip.resetColumn();
      }

      // ---- Rhythm ----
      if (!rhythmCard.fold?.isFolded()) {
        const sectionVal = anim ? (raw ? anim.raw.sectionIntensity : anim.sectionIntensity) : null;
        tempo.update(anim?.tempoLock ?? 0, !!frame?.onset);
        section.setValue(sectionVal, dtSec);
        if (anim?.dropOnset) section.flash(HOT_RED);
        if (text) {
          tempo.settle(frame?.bpm ?? 0, nowMs, raw || smoothingOff);
          section.setReadout(
            sectionVal === null ? "--" : pct(sectionVal),
            sectionVal === null ? IDLE : {},
          );
        }
        // Already raw the way the beat dot is (see file header) — no
        // pre-envelope counterpart threaded through AnimFrame to switch to.
        hits.setValues(anim?.lowPulse ?? 0, anim?.midPulse ?? 0, anim?.highPulse ?? 0);
        // Local diagnostic, same availability as fixedEnergy (null on a
        // mic-less renderer or the synthetic feed) — no RAW counterpart,
        // same reasoning as the hit pulses above.
        onset.setValue(fluxRatio === null ? null : fluxRatio / ONSET_METER_MAX, dtSec);
        if (frame?.onset) onset.flash();
        if (text)
          onset.setReadout(
            fluxRatio === null ? "--" : fluxRatio.toFixed(2),
            fluxRatio === null ? IDLE : {},
          );
      }

      // ---- Character ----
      if (!characterCard.fold?.isFolded()) {
        for (const { dial, row } of dialRows) {
          const v = anim ? (raw ? anim.raw.profile[dial] : anim.profile[dial]) : null;
          row.setValue(v, dtSec);
          if (text)
            row.setReadout(
              v === null ? "--" : v.toFixed(2),
              v === null ? IDLE : {},
            );
        }
        const cv = anim ? (raw ? anim.centroidRaw : anim.centroid) : null;
        centroidRow.setValue(cv, dtSec);
        if (text)
          centroidRow.setReadout(
            cv === null ? "--" : cv.toFixed(2),
            cv === null ? IDLE : {},
          );
        centroidTrace.push([cv], nowMs);
        centroidTrace.draw();
      } else {
        // Folded: don't accumulate a column while hidden, same as History.
        centroidTrace.resetColumn();
      }

      // ---- Loudness ----
      const showLufs = lufs !== null;
      if (showLufs !== lufsShown) {
        lufsShown = showLufs;
        lufsCard.el.style.display = showLufs ? "" : "none";
      }
      if (lufs && !lufsCard.fold?.isFolded()) {
        const m = lufs.momentary;
        const live = Number.isFinite(m);
        lufsRow.setValue(live ? lufsFrac(m) : 0, dtSec);
        lufsRow.setFillColor(m > LUFS_HOT ? HOT_RED : NEUTRAL_ACCENT);
        if (text) {
          lufsRow.setReadout(live ? m.toFixed(1) : "--", live ? {} : IDLE);
          lufsBlock.set(lufs);
        }
      }

      // ---- Scope ----
      const showScope = mono !== null;
      if (showScope !== scopeShown) {
        scopeShown = showScope;
        scopeCard.el.style.display = showScope ? "" : "none";
      }
      if (!mono) return;
      if (scopeCard.fold?.isFolded()) {
        // Don't accumulate a column while hidden — on unfold this starts a
        // fresh one instead of the elapsed gap reading as a stall and
        // committing a burst of catch-up columns (see pushWave).
        colStartMs = null;
        return;
      }
      const clipped = isClipping(mono);
      pushWave(mono, clipped, nowMs);
      drawWave();
      const instPeak = peak(mono);
      // finite - Infinity is exactly -Infinity (IEEE754), and Math.max
      // against that is exactly instPeak — no separate smoothingOff branch
      // needed here, unlike the ease()-style blends elsewhere.
      wavePeak = Math.max(instPeak, wavePeak - PEAK_FALL_PER_SEC * rateScale * dtSec);
      if (text) {
        if (clipped)
          waveform.setReadout("CLIP", {
            textual: true,
            color: HOT_RED,
            unit: "",
          });
        else waveform.setReadout(pct(raw ? instPeak : wavePeak));
      }
    },
    revealRow(card, row): void {
      const cardEl = cardElements[card];
      if (cardEl.classList.contains("vc-folded")) cardEl.querySelector<HTMLButtonElement>(".vc-fold")?.click();
      const rowEl = rowElements.get(row);
      if (!rowEl) return;
      rowEl.scrollIntoView({ block: "nearest" });
      flashRow(rowEl);
    },
  };
}
