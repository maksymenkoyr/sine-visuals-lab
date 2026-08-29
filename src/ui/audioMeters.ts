import type { AnimFrame } from "../render/animClock.ts";
import type { FeatureFrame } from "../audio/types.ts";
import { downsampleForDisplay, isClipping, peak } from "../audio/waveform.ts";
import { DIAL_LABELS, MUSIC_DIALS, NEUTRAL } from "../render/musicProfile.ts";
import { AUTO_SKY, FONT_MONO, HOT_RED, INPUT_GREEN, withAlpha } from "./controlsTheme.ts";
import {
  createCard,
  digitsStyle,
  digitsTextStyle,
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
 *    since its whole point is to make that invisible downstream. (No
 *    low/mid/high here: the spectrum strip already shows them.)
 *  - Rhythm: sectionIntensity with a drop flash, and a compact tempo block
 *    beside it — bpm under a beat dot whose resting tint follows
 *    beatClock's tempoLock, so an unlocked guess reads as unconfident
 *    rather than as a confident wrong number.
 *  - Character: one row per entry in MUSIC_DIALS (never a hardcoded list),
 *    each marking NEUTRAL with a tick — what autoTune.ts resolves every "A"
 *    chip against, otherwise invisible. Copy comes from DIAL_LABELS.
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
 * screen space. allFolded()/setAllFolded() are how deviceMenu.ts's fold-all
 * chip drives this whole strip alongside its own Bands card, without either
 * side needing to know the other's card ids.
 */

export interface AudioMetersOpts {
  /** Called after any card in this strip folds/unfolds on its own (a header
   *  click or its caret) — lets a caller (deviceMenu.ts's fold-all chip)
   *  relabel itself without polling every card each frame. */
  onFoldChange?: () => void;
}

export interface AudioMeters {
  el: HTMLElement;
  /** True once every card in this strip is folded — the fold-all chip's
   *  read side (combined with its own Bands card's fold state). */
  allFolded(): boolean;
  /** Applies the same fold state to every card in this strip — the fold-all
   *  chip's write side. */
  setAllFolded(folded: boolean): void;
  /** Fed every frame while the panel is open. `frame`/`anim` null before
   *  audio is up (idle readouts); `mono` null on any device without a local
   *  analyser (Scope card hidden). A folded card skips its computation and
   *  DOM writes for the frame — folding buys back the layout/canvas cost,
   *  not just the screen space. */
  update(
    frame: FeatureFrame | null,
    anim: AnimFrame | null,
    mono: Float32Array | null,
  ): void;
}

const PEAK_FALL_PER_SEC = 1.2; // matches spectrumStrip.ts's peak-hold decay
const TEXT_REFRESH_MS = 100;
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
  /** The hint that unfolds on hover/tap. Omit for a row that explains
   *  itself (the waveform) — no hint, and nothing to focus for. */
  description?: string;
  /** A fixed mark at this fraction of the track — the dials' NEUTRAL. */
  tickAt?: number;
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
  if (spec.tickAt !== undefined) {
    const tick = document.createElement("div");
    tick.style.cssText = tickStyle;
    tick.style.left = `${spec.tickAt * 100}%`;
    track.appendChild(tick);
  }
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

  return {
    el,
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
     *  before showing — see TEMPO_SETTLE_SEC. */
    settle(bpm: number, nowMs: number): void {
      samples.push({ atMs: nowMs, bpm });
      while (samples.length && samples[0].atMs < nowMs - TEMPO_SETTLE_SEC * 1000) samples.shift();
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

const IDLE: ReadoutOpts = { textual: true, unit: "" };
const pct = (v: number) => String(Math.round(clamp(v, 0, 1) * 100));

export function createAudioMeters(opts: AudioMetersOpts = {}): AudioMeters {
  const root = document.createElement("div");
  root.className = "vc-meters vc-scroll";
  const onFoldChange = () => opts.onFoldChange?.();

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
  const signalCard = createCard({ title: "Signal", accent: INPUT_GREEN, foldId: "signal", onFoldChange });
  signalCard.body.append(level.el, spacer(), energy.el);

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
  const rhythmCard = createCard({ title: "Rhythm", accent: NEUTRAL_ACCENT, foldId: "rhythm", onFoldChange });
  rhythmCard.body.appendChild(rhythmRow);

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
  const characterCard = createCard({ title: "Character", accent: AUTO_SKY, foldId: "character", onFoldChange });
  dialRows.forEach(({ row }, i) => {
    if (i > 0) characterCard.body.appendChild(spacer());
    characterCard.body.appendChild(row.el);
  });

  // ---- Scope ----
  const waveform = createMeterRow({
    label: "Waveform",
    accent: NEUTRAL_ACCENT,
    unit: "peak",
  });
  // The trace takes the meter's place under the head.
  const waveCanvas = document.createElement("canvas");
  waveCanvas.style.cssText = waveCanvasStyle;
  waveform.el.children[1].replaceWith(waveCanvas);
  const waveCtx = waveCanvas.getContext("2d")!;
  const scopeCard = createCard({ title: "Scope", accent: NEUTRAL_ACCENT, foldId: "scope", onFoldChange });
  scopeCard.body.appendChild(waveform.el);
  scopeCard.el.style.display = "none";
  let scopeShown = false;

  // The scope leads: it's the one live picture of the sound itself, and the
  // first thing to check when the visuals seem off.
  root.append(scopeCard.el, signalCard.el, rhythmCard.el, characterCard.el);
  const cards = [scopeCard, signalCard, rhythmCard, characterCard];

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

  function commitColumn(): void {
    histMin[head] = colMin;
    histMax[head] = colMax;
    histClip[head] = colClip ? 1 : 0;
    head = (head + 1) % histMin.length;
    colMin = 0;
    colMax = 0;
    colClip = false;
  }

  /** Folds this frame's buffer into the current column, and closes it (or
   *  several, after a stall) once WAVE_COLUMN_MS has passed. */
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
    // cap the catch-up at the visible width.
    let n = Math.min(histMin.length, Math.floor(elapsed / WAVE_COLUMN_MS));
    for (; n > 0; n--) commitColumn();
    colStartMs = nowMs - (elapsed % WAVE_COLUMN_MS);
  }

  function drawWave(): void {
    const w = waveCssWidth;
    const h = WAVE_HEIGHT_CSS_PX;
    const mid = h / 2;
    const len = histMin.length;
    waveCtx.clearRect(0, 0, w, h);

    let range = WAVE_RANGE_FLOOR;
    for (let i = 0; i < len; i++)
      range = Math.max(range, histMax[i], -histMin[i]);
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

  return {
    el: root,
    allFolded(): boolean {
      return cards.every((card) => card.fold?.isFolded() ?? false);
    },
    setAllFolded(folded): void {
      for (const card of cards) card.fold?.setFolded(folded);
    },
    update(frame, anim, mono): void {
      const nowMs = performance.now();
      const dtSec =
        lastMs === null ? 1 / 60 : Math.max(1e-4, (nowMs - lastMs) / 1000);
      lastMs = nowMs;
      const text = nowMs - lastTextMs >= TEXT_REFRESH_MS;
      if (text) lastTextMs = nowMs;

      // ---- Signal ----
      if (!signalCard.fold?.isFolded()) {
        level.setValue(frame ? frame.level : null, dtSec);
        energy.setValue(frame ? frame.energy : null, dtSec);
        if (text) {
          level.setReadout(frame ? pct(frame.level) : "--", frame ? {} : IDLE);
          energy.setReadout(frame ? pct(frame.energy) : "--", frame ? {} : IDLE);
        }
      }
      // ---- Rhythm ----
      if (!rhythmCard.fold?.isFolded()) {
        tempo.update(anim?.tempoLock ?? 0, !!frame?.beat);
        section.setValue(anim ? anim.sectionIntensity : null, dtSec);
        if (anim?.dropOnset) section.flash(HOT_RED);
        if (text) {
          tempo.settle(frame?.bpm ?? 0, nowMs);
          section.setReadout(
            anim ? pct(anim.sectionIntensity) : "--",
            anim ? {} : IDLE,
          );
        }
      }

      // ---- Character ----
      if (!characterCard.fold?.isFolded()) {
        for (const { dial, row } of dialRows) {
          const v = anim ? anim.profile[dial] : null;
          row.setValue(v, dtSec);
          if (text)
            row.setReadout(
              v === null ? "--" : v.toFixed(2),
              v === null ? IDLE : {},
            );
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
      wavePeak = Math.max(peak(mono), wavePeak - PEAK_FALL_PER_SEC * dtSec);
      if (text) {
        if (clipped)
          waveform.setReadout("CLIP", {
            textual: true,
            color: HOT_RED,
            unit: "",
          });
        else waveform.setReadout(pct(wavePeak));
      }
    },
  };
}
