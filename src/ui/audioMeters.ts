import type { AnimFrame } from "../render/animClock.ts";
import type { MeterCardId, MeterRowId } from "../render/signals.ts";
import type { FeatureFrame } from "../audio/types.ts";
import { downsampleForDisplay, isClipping, peak } from "../audio/waveform.ts";
import type { LufsReading } from "../audio/lufs.ts";
import { SILENCE_GATE_MIN, type SilenceGateMarks, type SilenceGateReading } from "../audio/silenceGate.ts";
import { DIAL_LABELS, MUSIC_DIALS, NEUTRAL } from "../render/musicProfile.ts";
import { BEAT_GRIDS, BEAT_GRID_DEFAULT } from "../audio/beatGrid.ts";
import { verdictOf, type OnsetDiag, type OnsetVerdict } from "../audio/onsetDiag.ts";
import { FLUX_THRESHOLD_MARGIN, FLUX_THRESHOLD_MULT, ONSET_REFRACTORY_SEC } from "../audio/features.ts";
import { GROUP_TUNING } from "../render/bandEnergy.ts";
import {
  hitStandout,
  HIT_AMOUNT_DEFAULT,
  HIT_AMOUNT_MAX,
  HIT_AMOUNT_MIN,
  HIT_FLOOR_DEFAULT,
  HIT_FLOOR_MAX,
  HIT_FLOOR_MIN,
  HIT_KNEE_DEFAULT,
  HIT_KNEE_MAX,
  HIT_KNEE_MIN,
  HIT_LOUDNESS_DEFAULT,
  HIT_LOUDNESS_MAX,
  HIT_LOUDNESS_MIN,
  type HitParts,
  type HitShape,
} from "../audio/hitStrength.ts";
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
  createPickerRow,
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
// The Hit strength card's four sliders reuse deviceMenu.ts's own slider row
// builder rather than duplicate it — see that file's header comment on
// createControlRow. deviceMenu.ts imports createAudioMeters from this file
// in the other direction; that's fine (nothing but createDeviceMenu/
// createAudioMeters actually call across the two at runtime, well after
// both modules have finished loading).
import { createControlRow } from "./deviceMenu.ts";

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
 *  - Gate (right after Signal): the live view of the silence gate
 *    (src/audio/silenceGate.ts) — Dimmer, how much of a hit's strength the
 *    gate is currently letting through, and beneath it a History trace of
 *    Level against the Input card's two marks (dashed guides), with ticks
 *    for every beat that fired and every hit the gate stopped. Local-only
 *    like fixedEnergy above — a device with no FeatureExtractor of its own
 *    (a renderer, the synthetic feed) has nothing to read here, so Dimmer
 *    and the ticks go idle, same as the Rhythm card's hits history's Beat
 *    lane.
 *  - Loudness: the broadcast measurement — BS.1770 / EBU R128 LUFS from
 *    lufsAnalyser.ts (math in lufs.ts). Momentary on the bar with the
 *    LUFS_TARGET_* marks, Short-term as the big number, Integrated beneath
 *    with a Reset chip. Local-only like the Scope, since it needs this
 *    device's own samples; hidden on a mic-less renderer.
 *  - Rhythm: sectionIntensity with a drop flash, a compact tempo block
 *    beside it — bpm under a beat dot whose resting tint follows
 *    beatClock's tempoLock, so an unlocked guess reads as unconfident
 *    rather than as a confident wrong number — and beneath both a hits
 *    history (createHitsHistory): one lane each for Beat (the broadband
 *    detector) and bandEnergy.ts's Low/Mid/High, tracing each one's ratio
 *    against its firing threshold plus a tick for every fired/gated/blocked
 *    reading (onsetDiag.ts's OnsetVerdict) — a history, not just an instant
 *    reading, so a tuning session can see *why* a hit did or didn't count,
 *    ground-shaded by how closed the silence gate was at the time. Last,
 *    an Onset row: the Beat lane's same ratio as a full-width live bar
 *    with the firing line marked — the lane is the history, the bar is the
 *    reading you can see from across the room.
 *  - Hit strength: the one card that's controls *and* monitors together —
 *    src/audio/hitStrength.ts's Dimension/Knee/Loudness mix/Floor sliders,
 *    then a Curve (hitStandout(ratio, knee) plotted live, a dot per
 *    HITS_LANES lane at that lane's own last-hit ratio) and a Strength
 *    history in the hits history's own four-lane layout — a bar per fired
 *    hit up to its final strength, with its stand-out and loudness parts
 *    as two small dots on the same column, and a dashed guide at Floor —
 *    so dragging any of the four sliders shows exactly what it did to a
 *    real hit rather than just a number.
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
   *  file header). `beatDiag` is FeatureExtractor.onsetDiag — this frame's
   *  full broadband onset diagnostic (ratio, gated, blocked — see
   *  onsetDiag.ts's OnsetDiag), null on the same devices as `fixedEnergy`
   *  (the hits history's Beat lane draws no ratio trace there, same as
   *  synthetic). `gate` is this device's own SilenceGateReading
   *  (src/audio/silenceGate.ts) — null on the same devices as `fixedEnergy`
   *  (the Gate card's Dimmer row and ticks read idle; its History trace
   *  still plots `frame.level` against the two marks, since that part
   *  doesn't need a local extractor). */
  update(
    frame: FeatureFrame | null,
    anim: AnimFrame | null,
    mono: Float32Array | null,
    rawBands: Float32Array | null,
    rateScale: number,
    fixedEnergy: number | null,
    lufs: LufsReading | null,
    beatDiag: OnsetDiag | null,
    gate: SilenceGateReading | null,
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
  /** The Rhythm card's Beat grid row and the Hit strength card's four
   *  sliders (below) are the only controls that live in the meters panel
   *  rather than the Input card — each one's effect is exactly what a trace
   *  right beneath it shows, so splitting the knob from its own picture
   *  would put the two a card apart. The stored index into BEAT_GRIDS for
   *  the current scene (src/audio/beatGrid.ts); the row re-reads `get` on
   *  its text tick so a scene switch is picked up. */
  beatGrid: { get: () => number; set: (value: number) => void };
  /** The Gate card's History trace guides and the Rhythm card's hits
   *  history hint (hitsRuleHint) — the same two marks the Input card's
   *  Silence below/Sound above rows edit (src/audio/silenceGate.ts). Read
   *  fresh every draw()/text tick so dragging a mark in the Input card
   *  moves the dashed lines and the hint's numbers live. */
  getSilenceGate: () => SilenceGateMarks;
  /** The Hit strength card's four sliders — see src/audio/hitStrength.ts
   *  for the formula they shape. Global per device, like getSilenceGate
   *  above, not per scene: how a hit's stand-out and loudness blend into
   *  its pulse height is a taste about detection itself, not one scene's
   *  look, so it carries across scene switches the same way. */
  hitShape: { get: () => HitShape; set: (partial: Partial<HitShape>) => void };
}

const PEAK_FALL_PER_SEC = 1.2; // matches spectrumStrip.ts's peak-hold decay
const TEXT_REFRESH_MS = 100;
// Track width for the Onset row and scale for a hit-history lane's ratio
// trace (both OnsetDiag.ratio), in units of the ratio itself (1 = the
// firing line). An ordinary hit clears 1 by some margin but rarely reaches
// this — picked so the bar and the lanes have headroom rather than pinning
// at full on every beat.
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
const BEAT_TRACE_HEIGHT_CSS_PX = 28;
// The predicted-grid series in the Rhythm card's Beat trace: same blue as
// the auto-gain/auto-tune system, distinct from BEAT_COLOR so "detected"
// (red) and "predicted" (blue) never read as the same line.
const BEAT_GRID_COLOR = AUTO_SKY;
// The Gate card's History (src/audio/silenceGate.ts): more series, plus the
// dashed SilenceGateMarks guide lines on top, read more crowded than
// Signal's own History, so this trace gets a little more height.
// GATE_DIMMER_COLOR reuses the same blue as the auto-gain/auto-tune system
// (AUTO_SKY) at a dim alpha — the dimmer is a reference line like
// HISTORY_FIXED_COLOR above, not a primary reading. GATE_GUIDE_COLOR ties
// the dashed guide lines back to the Input card's own accent, since that's
// the card that edits the marks they trace.
const GATE_HISTORY_HEIGHT_CSS_PX = HISTORY_HEIGHT_CSS_PX + 16;
const GATE_DIMMER_COLOR = withAlpha(AUTO_SKY, 0.7);
const GATE_GUIDE_COLOR = withAlpha(INPUT_GREEN, 0.5);
// The Gate History draws Level (and the two guide lines) on a zoomed scale,
// not the full range Signal's History uses: the marks live near the bottom
// of FeatureFrame.level's range by design (they separate silence from quiet
// playback), so on the full scale both dashed lines and everything Level
// does around them collapse into the strip's bottom few pixels — the one
// region this card exists to show. The strip's top is this multiple of the
// `open` mark instead, which pins that mark at mid-height wherever the
// slider puts it; Level past the top clamps there, which reads correctly as
// "well clear of the gate". GATE_LEVEL_TOP_MIN keeps the scale from
// blowing up when the marks are dragged to the very bottom. Dimmer and the
// Fired/Stopped ticks stay on their own full scale — they're already 0..1.
// Dragging a mark rescales new columns only; the columns already drawn keep
// the scale they were recorded at until they scroll off.
const GATE_LEVEL_TOP_PER_OPEN = 2;
const GATE_LEVEL_TOP_MIN = 0.1;

function gateLevelTop(marks: SilenceGateMarks): number {
  return Math.min(1, Math.max(GATE_LEVEL_TOP_MIN, marks.open * GATE_LEVEL_TOP_PER_OPEN));
}

interface TraceStripSeries {
  color: string;
  width: number;
}

interface TraceStripGuide {
  /** 0..1 on the same y scale as the series. */
  at: number;
  color: string;
}

/** The ring-buffer bookkeeping shared by every trace/history strip in this
 *  file: a canvas sized to one column per CSS pixel over HISTORY_SPAN_SEC,
 *  `seriesCount` parallel ring buffers, and push()/resetColumn() to fill
 *  them — factored out of createTraceStrip below so createHitsHistory's
 *  per-column shading/ticks can share the exact same column timing instead
 *  of re-deriving it.
 *
 *  Each series' column is a max-hold of what push() saw since the column
 *  before last closed, so a transient survives however many frames the
 *  column spans; when push() closes several columns in one call (see
 *  COLUMN_CARRY_MS above) the sample that closed them is held across all
 *  but blank past the carry bound. A column stays NaN when nothing was ever
 *  sampled for it — a null reading this series had no value for, or a carry
 *  bound stretch with no reading at all — which a caller reads as "lift the
 *  pen" rather than a reading of zero, the same gap HISTORY_FIXED_COLOR
 *  relies on for a source with no fixed-mapping reading this tick. */
function createColumnRing(seriesCount: number, heightPx: number) {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = `display: block; width: 100%; height: ${heightPx}px; margin-top: 4px;`;
  const ctx = canvas.getContext("2d")!;

  let bufs: Float32Array[] = [];
  let head = 0;
  // The column being accumulated, one slot per series — NaN means "nothing
  // folded in yet this column", not "zero". commitColumn() below relies on
  // Number.isNaN to tell first-touch-this-column apart from a genuine 0.
  let colVals: number[] = new Array(seriesCount).fill(Number.NaN);
  // A burst's filler once past COLUMN_CARRY_MS — never mutated.
  const blank: number[] = new Array(seriesCount).fill(Number.NaN);
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
    bufs = [];
    for (let i = 0; i < seriesCount; i++) bufs.push(new Float32Array(w).fill(Number.NaN));
    head = 0;
    columnMs = (HISTORY_SPAN_SEC * 1000) / w;
    return true;
  }

  function commitColumn(vals: number[]): void {
    for (let i = 0; i < seriesCount; i++) bufs[i][head] = vals[i];
    head = (head + 1) % bufs[0].length;
  }

  return {
    canvas,
    ctx,
    /** CSS pixel width the ring is currently sized to (0 before first
     *  layout). */
    get width(): number {
      return cssWidth;
    },
    /** Number of closed columns — equals width, one per CSS pixel. */
    get length(): number {
      return bufs[0]?.length ?? 0;
    },
    /** Closed column value at ring-relative index x (0 = oldest,
     *  length-1 = newest), series s. */
    at(x: number, s: number): number {
      const len = bufs[0].length;
      return bufs[s][(head + x) % len];
    },
    /** The in-progress (not yet closed) column's current reading for series
     *  s — a caller draws this at the right edge, same shape as
     *  traceHistory's own `live` param below. */
    live(s: number): number {
      return colVals[s];
    },
    /** One sample per series, `null` where this tick has no reading for that
     *  series (e.g. no fixed-mapping reference) — max-held into the current
     *  column, closing it (or several, after a stall) once `columnMs` has
     *  passed. Call every tick the card is open; skip entirely while folded,
     *  same as resetColumn() below. */
    push(values: (number | null)[], nowMs: number): void {
      if (!ensureSize()) return;
      for (let i = 0; i < seriesCount; i++) {
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
    /** Don't accumulate a column while the card holding this strip is
     *  hidden (folded) — same reasoning as the waveform's own fold guard. */
    resetColumn(): void {
      colStartMs = null;
    },
  };
}

/** A rolling line-trace view over createColumnRing — the Signal card's
 *  History (three series: level, energy, the fixed-mapping reference), the
 *  Character card's Centroid trace (one series, no legend) and the Gate
 *  card's History (its own series plus `guides`) all drive one of these.
 *
 *  `guides`, when given, replaces draw()'s own fixed mid-height line with
 *  dashed horizontal lines at each entry's `at` (0..1, the same y scale the
 *  series use) — the Gate History's two Input-card marks. Read fresh every
 *  draw() call (not cached), since a mark can move while the card is open. */
function createTraceStrip(series: TraceStripSeries[], heightPx: number, guides?: () => TraceStripGuide[]) {
  const ring = createColumnRing(series.length, heightPx);
  const { canvas, ctx } = ring;
  const yOf = (v: number) => 1 + (1 - clamp(v, 0, 1)) * (heightPx - 2);

  /** One polyline over the ring buffer plus the live (in-progress) column at
   *  the right edge; a NaN reading lifts the pen so a missing sample leaves
   *  a gap rather than a line to zero. */
  function traceHistory(s: number, color: string, width: number): void {
    const len = ring.length;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    let pen = false;
    for (let x = 0; x <= len; x++) {
      const v = x === len ? ring.live(s) : ring.at(x, s);
      if (Number.isNaN(v)) {
        pen = false;
        continue;
      }
      const px = x === len ? ring.width - 1 : x;
      if (pen) ctx.lineTo(px, yOf(v));
      else ctx.moveTo(px, yOf(v));
      pen = true;
    }
    ctx.stroke();
  }

  return {
    canvas,
    push: ring.push,
    /** Redraws every series in the order given to createTraceStrip — the
     *  last one lands on top, same as the Signal card putting Level over
     *  Energy over the fixed-mapping reference. With no `guides`, draws the
     *  plain fixed mid-height line every trace has always had; with `guides`,
     *  draws those instead (a mid-height line would read as an unlabeled
     *  third mark on top of them). */
    draw(): void {
      const w = ring.width;
      const h = heightPx;
      ctx.clearRect(0, 0, w, h);
      if (guides) {
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        for (const g of guides()) {
          const y = yOf(g.at);
          ctx.strokeStyle = g.color;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.18)";
        ctx.fillRect(0, Math.round(h / 2) - 0.5, w, 1);
      }
      for (let i = 0; i < series.length; i++) traceHistory(i, series[i].color, series[i].width);
    },
    resetColumn: ring.resetColumn,
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

// Rhythm's hit history: four lanes, one canvas, one column per CSS pixel
// over HISTORY_SPAN_SEC (createColumnRing above) — Beat (the broadband
// onset), Low/Mid/High (bandEnergy.ts's per-group onsets). Replaces the old
// Hits row (four instantaneous pulse bars, no history): the point of a
// history is seeing *why* something did or didn't count, which four bars
// that reset every frame never could. The Onset row under it shows the
// Beat lane's ratio live, at a size a thin lane can't.
const HITS_LANE_HEIGHT_PX = 16;
const HITS_LANE_COUNT = 4; // Beat, Low, Mid, High
const HITS_HEIGHT_PX = HITS_LANE_HEIGHT_PX * HITS_LANE_COUNT;
// A lane's ratio trace is scaled the same way the old Onset row's meter
// was — 1 (the firing line) sits inside the track with headroom above it,
// rather than pinning the lane to full height on every ordinary hit.
const HITS_RATIO_MAX = ONSET_METER_MAX;
// Per-column series layout in the ring: [ratio, event code] per lane, plus
// one shared ground-shade series (1 - anim.gateDimmer; the room isn't
// per-lane, so one series covers all four). Event code is fired=3 >
// blocked=2 > gated=1 > 0 — see CODE_OF_VERDICT below — so a max-hold
// column resolves the right priority on its own when a burst of rAF ticks
// closes into one column.
interface HitsLane {
  label: string;
  color: string;
  ratioIdx: number;
  codeIdx: number;
}
const HITS_LANES: readonly HitsLane[] = [
  { label: "Beat", color: BEAT_COLOR, ratioIdx: 0, codeIdx: 1 },
  { label: "Low", color: STRIP_LOW, ratioIdx: 2, codeIdx: 3 },
  { label: "Mid", color: STRIP_MID, ratioIdx: 4, codeIdx: 5 },
  { label: "High", color: STRIP_HIGH, ratioIdx: 6, codeIdx: 7 },
];
const HITS_GROUND_IDX = 8;
const HITS_SERIES_COUNT = 9;
// Ground shading is a wash, not a primary reading — capped well under full
// white so a shut gate (1 - gateDimmer == 1) reads as a dim tint rather
// than blacking the lanes out; a half-open gate lands proportionally
// lighter, rather than the old flat on/off wash.
const HITS_GROUND_ALPHA_MAX = 0.07;

const NULL_DIAG: OnsetDiag = { ratio: 0, gated: false, blocked: false, sinceOnsetSec: Infinity };
const CODE_OF_VERDICT: Record<OnsetVerdict, number> = { fired: 3, blocked: 2, gated: 1, miss: 0 };

/** The exact hit rule, generated from the live constants rather than
 *  hand-typed — features.ts's broadband threshold, bandEnergy.ts's
 *  GROUP_TUNING, and the current silence-gate marks (src/audio/silenceGate.ts)
 *  — so it can't drift from what actually decides a tick. Recomputed at the
 *  text tick (see createHitsHistory's update()), so a live drag of the
 *  Input card's Silence below/Sound above rows is reflected the next time
 *  it refreshes. */
function hitsRuleHint(getSilenceGate: () => SilenceGateMarks): string {
  const ms = (sec: number) => `${Math.round(sec * 1000)}ms`;
  const group = (label: string, g: (typeof GROUP_TUNING)["low"]) =>
    `${label}: rise over ${g.triggerMult}× its recent average + ${g.triggerMargin}, ≥${ms(g.refractorySec)} apart.`;
  const marks = getSilenceGate();
  const gate =
    marks.closed <= SILENCE_GATE_MIN
      ? "Silence gate is off."
      : `Quieter than ${pct(marks.closed)}% input level nothing counts; between ${pct(marks.closed)}% and ${pct(marks.open)}% a hit has to stand out more (Silence below / Sound above, Input card).`;
  return [
    "Full tick: fired.",
    "Dim tick: cleared the line but too soon after the last one (refractory).",
    "Faint tick on shaded ground: cleared it while the room was quiet.",
    `Beat: flux over ${FLUX_THRESHOLD_MULT}× the recent average + ${FLUX_THRESHOLD_MARGIN}, ≥${ms(ONSET_REFRACTORY_SEC)} apart.`,
    group("Low", GROUP_TUNING.low),
    group("Mid", GROUP_TUNING.mid),
    group("High", GROUP_TUNING.high),
    gate,
  ].join(" ");
}

function laneNote(ratio: number | null, fires: number): string {
  return `${ratio === null ? "--" : ratio.toFixed(2)} · ${fires}/${HISTORY_SPAN_SEC}s`;
}

/** The Hit strength card's per-lane legend note — that lane's last fired
 *  hit's three numbers. `anim.hitStrength.*` (see animClock.ts) always
 *  holds a valid HitParts once `anim` exists (initial zeros before that
 *  lane's very first hit, then the last one's numbers from then on), so
 *  this only reads "--" while there's no anim at all — idle, same as every
 *  other row's convention in this file. */
function hitStrengthNote(parts: HitParts | null): string {
  if (!parts) return "--";
  return `${parts.standout.toFixed(2)} · ${parts.loudness.toFixed(2)} → ${parts.strength.toFixed(2)}`;
}

/** Rhythm's hit history. Feeds: Beat from `frame.onset` (the detector edge,
 *  pre-grid — the Beat trace row already shows it against the grid) and
 *  `beatDiag` (device-local only, see AudioMeters.update's own doc — a null
 *  diag still lets `fired`/"miss" through, just with no ratio trace and no
 *  gated/blocked distinction, hence "no ratio trace on synthetic/
 *  renderer"); Low/Mid/High from `anim.lowOnset`/`midOnset`/`highOnset` and
 *  `anim.hits.low/mid/high` (always available once `anim` exists, local or
 *  remote — bandEnergy.ts runs everywhere); ground shading from
 *  `1 - anim.gateDimmer` — the same dimmer the Gate card's Dimmer row shows
 *  — so a half-open gate reads lighter than a shut one. */
function createHitsHistory(getSilenceGate: () => SilenceGateMarks) {
  const row = createMeterRow({
    label: "Hits",
    accent: NEUTRAL_ACCENT,
    unit: "s",
    description: hitsRuleHint(getSilenceGate),
  });
  const ring = createColumnRing(HITS_SERIES_COUNT, HITS_HEIGHT_PX);
  const ctx = ring.ctx;
  row.el.children[1].replaceWith(ring.canvas);
  row.setReadout(String(HISTORY_SPAN_SEC));

  const legend = createTraceLegend(HITS_LANES.map((l) => ({ color: l.color, label: l.label })));
  ring.canvas.after(legend.el);

  // Fire timestamps per lane, for the legend's "N fires in the last span"
  // note — pruned to HISTORY_SPAN_SEC on read, same window the trace shows.
  const fireLog: number[][] = HITS_LANES.map(() => []);
  function firesInSpan(lane: number, nowMs: number): number {
    const log = fireLog[lane];
    const cutoff = nowMs - HISTORY_SPAN_SEC * 1000;
    while (log.length && log[0] < cutoff) log.shift();
    return log.length;
  }

  function laneY(laneIdx: number, ratio: number): number {
    const top = laneIdx * HITS_LANE_HEIGHT_PX;
    const frac = clamp(ratio / HITS_RATIO_MAX, 0, 1);
    return top + 1 + (1 - frac) * (HITS_LANE_HEIGHT_PX - 2);
  }

  function draw(): void {
    const w = ring.width;
    const len = ring.length;
    ctx.clearRect(0, 0, w, HITS_HEIGHT_PX);

    // 1. Ground shading proportional to how closed the gate is
    // (1 - gateDimmer) — a half-open gate reads lighter than a shut one,
    // rather than a flat on/off wash.
    for (let x = 0; x <= len; x++) {
      const g = x === len ? ring.live(HITS_GROUND_IDX) : ring.at(x, HITS_GROUND_IDX);
      if (!(g > 0)) continue; // NaN or 0 — nothing to shade
      ctx.fillStyle = `rgba(255,255,255,${(g * HITS_GROUND_ALPHA_MAX).toFixed(3)})`;
      ctx.fillRect(x === len ? w - 1 : x, 0, 1, HITS_HEIGHT_PX);
    }

    // Divider between the broadband Beat lane and the per-band ones below —
    // the old Hits row's own divider, redrawn on canvas.
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(0, HITS_LANE_HEIGHT_PX - 0.5, w, 1);

    // 2. A hairline per lane at ratio == 1 — the firing line.
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    for (let li = 0; li < HITS_LANES.length; li++) {
      ctx.fillRect(0, Math.round(laneY(li, 1)) - 0.5, w, 1);
    }

    // 3. The ratio trace per lane, low alpha (NaN lifts the pen).
    for (let li = 0; li < HITS_LANES.length; li++) {
      const lane = HITS_LANES[li];
      ctx.strokeStyle = withAlpha(lane.color, 0.55);
      ctx.lineWidth = 1;
      ctx.beginPath();
      let pen = false;
      for (let x = 0; x <= len; x++) {
        const v = x === len ? ring.live(lane.ratioIdx) : ring.at(x, lane.ratioIdx);
        if (Number.isNaN(v)) {
          pen = false;
          continue;
        }
        const px = x === len ? w - 1 : x;
        const y = laneY(li, v);
        if (pen) ctx.lineTo(px, y);
        else ctx.moveTo(px, y);
        pen = true;
      }
      ctx.stroke();
    }

    // 4. The event tick: full = fired, dim = blocked (refractory), faint
    // neutral on the shaded ground = gated (silence gate).
    for (let x = 0; x <= len; x++) {
      const px = x === len ? w - 1 : x;
      for (let li = 0; li < HITS_LANES.length; li++) {
        const lane = HITS_LANES[li];
        const code = x === len ? ring.live(lane.codeIdx) : ring.at(x, lane.codeIdx);
        const top = li * HITS_LANE_HEIGHT_PX;
        if (code >= 2.5) ctx.fillStyle = lane.color;
        else if (code >= 1.5) ctx.fillStyle = withAlpha(lane.color, 0.4);
        else if (code >= 0.5) ctx.fillStyle = "rgba(255,255,255,0.35)";
        else continue;
        ctx.fillRect(px, top, 1, HITS_LANE_HEIGHT_PX);
      }
    }
  }

  let lastHint = "";
  return {
    el: row.el,
    update(frame: FeatureFrame | null, anim: AnimFrame | null, beatDiag: OnsetDiag | null, nowMs: number, text: boolean): void {
      if (anim) {
        const beatFired = !!frame?.onset;
        const beatVerdict = verdictOf(beatFired, beatDiag ?? NULL_DIAG);
        const lowVerdict = verdictOf(anim.lowOnset, anim.hits.low);
        const midVerdict = verdictOf(anim.midOnset, anim.hits.mid);
        const highVerdict = verdictOf(anim.highOnset, anim.hits.high);
        ring.push(
          [
            beatDiag ? beatDiag.ratio : null,
            CODE_OF_VERDICT[beatVerdict],
            anim.hits.low.ratio,
            CODE_OF_VERDICT[lowVerdict],
            anim.hits.mid.ratio,
            CODE_OF_VERDICT[midVerdict],
            anim.hits.high.ratio,
            CODE_OF_VERDICT[highVerdict],
            1 - anim.gateDimmer,
          ],
          nowMs,
        );
        if (beatFired) fireLog[0].push(nowMs);
        if (anim.lowOnset) fireLog[1].push(nowMs);
        if (anim.midOnset) fireLog[2].push(nowMs);
        if (anim.highOnset) fireLog[3].push(nowMs);
      } else {
        ring.push(new Array(HITS_SERIES_COUNT).fill(null), nowMs);
      }
      draw();

      if (text) {
        legend.setNote(0, laneNote(beatDiag ? beatDiag.ratio : null, firesInSpan(0, nowMs)));
        legend.setNote(1, laneNote(anim ? anim.hits.low.ratio : null, firesInSpan(1, nowMs)));
        legend.setNote(2, laneNote(anim ? anim.hits.mid.ratio : null, firesInSpan(2, nowMs)));
        legend.setNote(3, laneNote(anim ? anim.hits.high.ratio : null, firesInSpan(3, nowMs)));
        // The two marks in the hint can move (the Input card's Silence
        // below/Sound above rows) — recompute and only touch the DOM when
        // it actually changed.
        const hint = hitsRuleHint(getSilenceGate);
        if (hint !== lastHint) {
          lastHint = hint;
          row.el.querySelector<HTMLElement>(".vc-hint")!.textContent = hint;
        }
      }
    },
    resetColumn(): void {
      ring.resetColumn();
    },
  };
}

// ---- Hit strength: the two monitors --------------------------------
// (src/audio/hitStrength.ts) — the sliders themselves are plain
// createControlRow instances built in createAudioMeters below, next to
// these two.

const HIT_CURVE_HEIGHT_CSS_PX = 56;

/** The knee curve — hitStandout(ratio, knee) plotted for ratio in
 *  1..ONSET_METER_MAX — plus a dot per HITS_LANES lane at that lane's own
 *  last-hit ratio, so dragging Knee shows exactly what it does to a real
 *  hit rather than just a number moving. A function plot, not a rolling
 *  history: nothing to accumulate per frame, so draw() just takes this
 *  tick's inputs and redraws from scratch (a canvas clear plus a few dozen
 *  line segments is cheap — see file header's "fills move every frame"
 *  rule). */
function createHitCurve() {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = `display: block; width: 100%; height: ${HIT_CURVE_HEIGHT_CSS_PX}px; margin-top: 4px;`;
  const ctx = canvas.getContext("2d")!;
  let cssWidth = 0;

  /** Same "no layout yet" guard as every other canvas in this file
   *  (createColumnRing's own ensureSize) — a folded/closed panel has a
   *  zero-size rect. */
  function ensureSize(): boolean {
    const rect = canvas.getBoundingClientRect();
    const w = Math.round(rect.width);
    if (w <= 0) return false;
    if (w === cssWidth) return true;
    cssWidth = w;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(HIT_CURVE_HEIGHT_CSS_PX * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  let lastKey = "";
  const xOf = (ratio: number, w: number) => ((ratio - 1) / (ONSET_METER_MAX - 1)) * (w - 1);
  const yOf = (v: number) => 1 + (1 - clamp(v, 0, 1)) * (HIT_CURVE_HEIGHT_CSS_PX - 2);

  return {
    canvas,
    /** `laneRatios[i]` is HITS_LANES[i]'s own last-hit ratio — null before
     *  that lane has ever fired, or on a device with no local reading for
     *  it (the Beat lane on synthetic/renderer — see createHitsHistory's
     *  own doc comment for the same gap). */
    draw(knee: number, laneRatios: readonly (number | null)[]): void {
      // The curve only changes when Knee or a lane's last hit does — and
      // both are rare next to the tick rate — so a repeat call is a no-op
      // rather than a clear+stroke+rect read every frame. The width check
      // stays first so a panel resize still repaints.
      if (!ensureSize()) return;
      const key = `${cssWidth}|${knee}|${laneRatios.join(",")}`;
      if (key === lastKey) return;
      lastKey = key;
      const w = cssWidth;
      const h = HIT_CURVE_HEIGHT_CSS_PX;
      ctx.clearRect(0, 0, w, h);

      // The firing line itself, at ratio == 1 (the left edge) — same
      // hairline-at-the-threshold convention as the hits history's own
      // per-lane line at ratio == 1.
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillRect(0, 0, 1, h);

      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const STEPS = 48;
      for (let i = 0; i <= STEPS; i++) {
        const ratio = 1 + (i / STEPS) * (ONSET_METER_MAX - 1);
        const x = xOf(ratio, w);
        const y = yOf(hitStandout(ratio, knee));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      for (let li = 0; li < HITS_LANES.length; li++) {
        const ratio = laneRatios[li];
        if (ratio === null || !Number.isFinite(ratio)) continue;
        const clamped = clamp(ratio, 1, ONSET_METER_MAX);
        const x = xOf(clamped, w);
        const y = yOf(hitStandout(clamped, knee));
        ctx.fillStyle = HITS_LANES[li].color;
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  };
}

// Per-lane column layout for the strength history below: [strength,
// standout, loudness] per HITS_LANES entry, in that lane order — reusing
// HITS_LANES' colours/labels rather than a second copy of them.
function hitStrengthLaneIdx(lane: number): { strength: number; standout: number; loudness: number } {
  const base = lane * 3;
  return { strength: base, standout: base + 1, loudness: base + 2 };
}
const HIT_STRENGTH_SERIES_COUNT = HITS_LANES.length * 3;

/** The Strength history: same four-lane layout as the hits history above
 *  (createHitsHistory) — Beat/Low/Mid/High, HITS_LANES' own colours and
 *  HITS_LANE_HEIGHT_PX — but each column is a graded hit's three numbers
 *  rather than a fixed-height event tick: a bar up to that hit's final
 *  `strength`, with its `standout` and `loudness` parts as two small dots
 *  on the same column so all three stay comparable at a glance. Only
 *  written on the tick a lane actually fires (createColumnRing's own
 *  NaN-lifts-the-pen convention leaves every other column blank) — a
 *  continuous trace would just be a flat line holding the last hit's value,
 *  which isn't what "the last hit's numbers" means here. */
function createHitStrengthHistory() {
  const ring = createColumnRing(HIT_STRENGTH_SERIES_COUNT, HITS_HEIGHT_PX);
  const { canvas, ctx } = ring;

  function laneY(laneIdx: number, v: number): number {
    const top = laneIdx * HITS_LANE_HEIGHT_PX;
    return top + 1 + (1 - clamp(v, 0, 1)) * (HITS_LANE_HEIGHT_PX - 2);
  }

  function draw(floor: number): void {
    const w = ring.width;
    const len = ring.length;
    ctx.clearRect(0, 0, w, HITS_HEIGHT_PX);

    // Divider between lanes, same as the hits history's own.
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(0, HITS_LANE_HEIGHT_PX - 0.5, w, 1);

    for (let li = 0; li < HITS_LANES.length; li++) {
      const lane = HITS_LANES[li];
      const idx = hitStrengthLaneIdx(li);

      if (floor > 0) {
        ctx.strokeStyle = withAlpha(lane.color, 0.4);
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        const y = Math.round(laneY(li, floor)) - 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      for (let x = 0; x <= len; x++) {
        const strength = x === len ? ring.live(idx.strength) : ring.at(x, idx.strength);
        if (Number.isNaN(strength)) continue;
        const px = x === len ? w - 1 : x;
        const top = li * HITS_LANE_HEIGHT_PX;
        const yTop = laneY(li, strength);
        ctx.fillStyle = withAlpha(lane.color, 0.85);
        ctx.fillRect(px, yTop, 1, top + HITS_LANE_HEIGHT_PX - yTop);

        const standout = x === len ? ring.live(idx.standout) : ring.at(x, idx.standout);
        const loudness = x === len ? ring.live(idx.loudness) : ring.at(x, idx.loudness);
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.fillRect(px, Math.round(laneY(li, standout)) - 0.5, 1, 1);
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.fillRect(px, Math.round(laneY(li, loudness)) - 0.5, 1, 1);
      }
    }
  }

  return {
    canvas,
    /** Beat from `frame.onset` (the detector edge, pre-grid) and
     *  `anim.hitStrength.beat`; Low/Mid/High from `anim.lowOnset`/
     *  `midOnset`/`highOnset` and `anim.hitStrength.low/mid/high` — same
     *  source split as createHitsHistory's own push(). */
    push(frame: FeatureFrame | null, anim: AnimFrame | null, nowMs: number): void {
      if (!anim) {
        ring.push(new Array(HIT_STRENGTH_SERIES_COUNT).fill(null), nowMs);
        return;
      }
      const vals: (number | null)[] = new Array(HIT_STRENGTH_SERIES_COUNT).fill(null);
      const setLane = (li: number, fired: boolean, parts: HitParts): void => {
        if (!fired) return;
        const idx = hitStrengthLaneIdx(li);
        vals[idx.strength] = parts.strength;
        vals[idx.standout] = parts.standout;
        vals[idx.loudness] = parts.loudness;
      };
      setLane(0, !!frame?.onset, anim.hitStrength.beat);
      setLane(1, anim.lowOnset, anim.hitStrength.low);
      setLane(2, anim.midOnset, anim.hitStrength.mid);
      setLane(3, anim.highOnset, anim.hitStrength.high);
      ring.push(vals, nowMs);
    },
    draw,
    resetColumn: ring.resetColumn,
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

  // ---- Gate ----
  // The live version of the silence-gate timeline (src/audio/silenceGate.ts)
  // — see this file's header for what the two rows show and why a mic-less
  // device (renderer, synthetic feed) reads idle here the same way it does
  // on the Rhythm card's hits history.
  const gateDimmer = createMeterRow({
    label: "Dimmer",
    accent: INPUT_GREEN,
    unit: "%",
    description:
      "How much of a hit's strength is allowed to count right now. Full: beats are detected exactly as before. Empty: the room is silent and nothing can fire.",
  });
  const gateHistory = createMeterRow({
    label: "History",
    accent: INPUT_GREEN,
    unit: "s",
    description:
      "Level against the two Input-card marks (dashed), zoomed in so the upper mark sits mid-height. Green ticks are beats that fired; red ticks are hits the gate stopped because the room was too quiet.",
  });
  // Paint order: the two tick series first, then Dimmer, then Level on top
  // — the same "Level lands last" order Signal's own History uses. A tick
  // runs the strip's full height on exactly the columns where Level and
  // Dimmer move (a hit is what raises both), so ticks painted last would
  // hide the two lines at the only moments they say anything.
  const gateHistoryStrip = createTraceStrip(
    [
      { color: HOT_RED, width: 1.5 },
      { color: INPUT_GREEN, width: 1.5 },
      { color: GATE_DIMMER_COLOR, width: 1 },
      { color: HISTORY_LEVEL_COLOR, width: 1 },
    ],
    GATE_HISTORY_HEIGHT_CSS_PX,
    () => {
      const marks = deps.getSilenceGate();
      const top = gateLevelTop(marks);
      return [
        { at: marks.closed / top, color: GATE_GUIDE_COLOR },
        { at: marks.open / top, color: GATE_GUIDE_COLOR },
      ];
    },
  );
  gateHistory.el.children[1].replaceWith(gateHistoryStrip.canvas);
  gateHistory.setReadout(String(HISTORY_SPAN_SEC));
  const gateLegend = createTraceLegend([
    { color: HISTORY_LEVEL_COLOR, label: "Level" },
    { color: GATE_DIMMER_COLOR, label: "Dimmer" },
    { color: INPUT_GREEN, label: "Fired" },
    { color: HOT_RED, label: "Stopped" },
  ]);
  gateHistoryStrip.canvas.after(gateLegend.el);
  const gateCard = createCard({ title: "Gate", accent: INPUT_GREEN, foldId: "gate" });
  gateCard.body.append(gateDimmer.el, spacer(), gateHistory.el);

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
  const hitsHistory = createHitsHistory(deps.getSilenceGate);
  // Beat grid: which pulses every scene's beat reactions fire on. Lives
  // here rather than in the Input card because its effect is visible in
  // the Beat trace two rows down — red ticks either land where the
  // detector fired or on the blue grid — and the tempo tile beside it is
  // what a grid stop is waiting on (the row says so while it is).
  const gridRow = createPickerRow({
    label: "Beat grid",
    accent: NEUTRAL_ACCENT,
    options: BEAT_GRIDS.map((g) => g.label),
    defaultValue: BEAT_GRID_DEFAULT,
    description:
      "Which pulses this scene's beat reactions fire on: every detected hit, or a steady grid from the tempo tracker — one pulse per eighth, beat, half bar, bar or two bars. A grid waits for a locked tempo and fires hits until then.",
    get: () => deps.beatGrid.get(),
    set: (value) => deps.beatGrid.set(value),
  });
  // Beats as actually detected (anim.beatPulse, red — same as the hit
  // history's Beat lane and the tempo dot) against the phase-locked grid
  // beatClock predicts (a spike at each anim.beatPhase wrap, blue, height
  // anim.tempoLock so an unconfident tracker draws a short tick and a locked
  // one a tall one — the same "unconfident reads as unconfident" convention
  // the beat dot itself uses). Detections landing on a grid tick read as
  // locked; a detection between ticks reads as a double; a tick with no
  // detection reads as a miss. Same createTraceStrip machinery as the
  // Signal card's History and the Character card's Centroid trace.
  const beat = createMeterRow({
    label: "Beat",
    accent: NEUTRAL_ACCENT,
    unit: "s",
    description:
      "Detected beats (red) against the tracker's predicted grid (blue, tall when locked, short when unsure). On the grid is locked; between ticks is a double; a tick with nothing under it is a miss.",
  });
  const beatTrace = createTraceStrip(
    [
      { color: BEAT_GRID_COLOR, width: 1.5 },
      { color: BEAT_COLOR, width: 1.5 },
    ],
    BEAT_TRACE_HEIGHT_CSS_PX,
  );
  beat.el.children[1].replaceWith(beatTrace.canvas);
  beat.setReadout(String(HISTORY_SPAN_SEC));
  let prevBeatPhase: number | null = null;
  // The onset detector's own input: how hard this frame's spectral flux
  // cleared its adaptive threshold (OnsetDiag.ratio — the same number the
  // hits history's Beat lane traces). The tick is the firing line; short
  // of it, a near-miss. Track runs to ONSET_METER_MAX so an ordinary hit
  // doesn't pin the bar.
  const onset = createMeterRow({
    label: "Onset",
    accent: NEUTRAL_ACCENT,
    ticks: [{ at: 1 / ONSET_METER_MAX, label: "fires" }],
    description:
      "How hard the broadband onset detector's flux cleared its threshold this frame — past the mark is a beat, short of it a near-miss.",
  });
  const rhythmCard = createCard({ title: "Rhythm", accent: NEUTRAL_ACCENT, foldId: "rhythm" });
  rhythmCard.body.append(rhythmRow, spacer(), gridRow.el, spacer(), hitsHistory.el, spacer(), beat.el, spacer(), onset.el);

  // ---- Hit strength ----
  // Controls and monitors together, right after Rhythm — same reasoning as
  // that card's own Beat grid row (AudioMetersDeps.beatGrid's doc comment):
  // each slider's effect is exactly what the Curve/Strength traces beneath
  // it show. See src/audio/hitStrength.ts for the formula these four shape.
  const hitAmountRow = createControlRow({
    label: "Dimension",
    accent: NEUTRAL_ACCENT,
    min: HIT_AMOUNT_MIN,
    max: HIT_AMOUNT_MAX,
    defaultValue: HIT_AMOUNT_DEFAULT,
    mapping: "linear",
    unit: "%",
    format: (v) => String(Math.round(v * 100)),
    description:
      "How much a hit's size counts. Off: every hit lands at full strength, exactly as before. Full: a hit's pulse height is its graded strength, shown in Strength below.",
  });
  hitAmountRow.onChange((v) => deps.hitShape.set({ amount: v }));
  hitAmountRow.sync(() => deps.hitShape.get().amount);

  const hitKneeRow = createControlRow({
    label: "Knee",
    accent: NEUTRAL_ACCENT,
    min: HIT_KNEE_MIN,
    max: HIT_KNEE_MAX,
    defaultValue: HIT_KNEE_DEFAULT,
    mapping: "linear",
    format: (v) => v.toFixed(2),
    description:
      "How sharply stand-out saturates above the firing line — the Curve below plots exactly this. Small: even a hit just over the line reads as nearly full strength. Large: a hit has to clear the line by a lot before it counts as strong.",
  });
  hitKneeRow.onChange((v) => deps.hitShape.set({ knee: v }));
  hitKneeRow.sync(() => deps.hitShape.get().knee);

  const hitLoudnessRow = createControlRow({
    label: "Loudness mix",
    accent: NEUTRAL_ACCENT,
    min: HIT_LOUDNESS_MIN,
    max: HIT_LOUDNESS_MAX,
    defaultValue: HIT_LOUDNESS_DEFAULT,
    mapping: "linear",
    unit: "%",
    format: (v) => String(Math.round(v * 100)),
    description:
      "How much of a hit's strength comes from how loud it actually was, rather than how far it stood out from the recent average. 0: stand-out only. 100: loudness only.",
  });
  hitLoudnessRow.onChange((v) => deps.hitShape.set({ loudness: v }));
  hitLoudnessRow.sync(() => deps.hitShape.get().loudness);

  const hitFloorRow = createControlRow({
    label: "Floor",
    accent: NEUTRAL_ACCENT,
    min: HIT_FLOOR_MIN,
    max: HIT_FLOOR_MAX,
    defaultValue: HIT_FLOOR_DEFAULT,
    mapping: "linear",
    unit: "%",
    format: (v) => String(Math.round(v * 100)),
    description:
      "Hits graded weaker than this count as nothing; the rest are rescaled to fill 0 to 100. 0: nothing is discarded — the dashed line in Strength below marks where it sits.",
  });
  hitFloorRow.onChange((v) => deps.hitShape.set({ floor: v }));
  hitFloorRow.sync(() => deps.hitShape.get().floor);

  const hitCurveRow = createMeterRow({
    label: "Curve",
    accent: NEUTRAL_ACCENT,
    unit: "×",
    description:
      "Stand-out as a function of how far a hit's ratio cleared the firing line, at the current Knee. Dots mark each lane's most recent hit.",
  });
  const hitCurve = createHitCurve();
  hitCurveRow.el.children[1].replaceWith(hitCurve.canvas);
  hitCurveRow.setReadout(ONSET_METER_MAX.toFixed(1));

  const hitStrengthRow = createMeterRow({
    label: "Strength",
    accent: NEUTRAL_ACCENT,
    unit: "s",
    description:
      "Each fired hit's final strength (the tall bar), with its stand-out and loudness parts as two small dots on the same column, so the three stay comparable. Dashed line is Floor.",
  });
  const hitStrengthHistory = createHitStrengthHistory();
  hitStrengthRow.el.children[1].replaceWith(hitStrengthHistory.canvas);
  hitStrengthRow.setReadout(String(HISTORY_SPAN_SEC));
  const hitStrengthLegend = createTraceLegend(HITS_LANES.map((l) => ({ color: l.color, label: l.label })));
  hitStrengthHistory.canvas.after(hitStrengthLegend.el);

  // Per-lane last-hit ratio, for the Curve's own dots — updated only on the
  // tick each lane fires (see the update() block below), so a dot always
  // marks a real hit rather than the ratio's live wander below the line.
  const lastHitRatio: (number | null)[] = [null, null, null, null];

  const hitStrengthCard = createCard({ title: "Hit strength", accent: NEUTRAL_ACCENT, foldId: "hitStrength" });
  hitStrengthCard.body.append(
    hitAmountRow.el,
    spacer(),
    hitKneeRow.el,
    spacer(),
    hitLoudnessRow.el,
    spacer(),
    hitFloorRow.el,
    spacer(),
    hitCurveRow.el,
    spacer(),
    hitStrengthRow.el,
  );

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
  root.append(
    metersHeader,
    scopeCard.el,
    signalCard.el,
    gateCard.el,
    lufsCard.el,
    rhythmCard.el,
    hitStrengthCard.el,
    characterCard.el,
  );

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
    gate: gateCard.el,
    lufs: lufsCard.el,
    rhythm: rhythmCard.el,
    character: characterCard.el,
  };
  const rowElements = new Map<MeterRowId, HTMLElement>([
    ["section", section.el],
    ["tempo", tempo.el],
    ["hits", hitsHistory.el],
    ["centroid", centroidRow.el],
  ]);

  return {
    el: root,
    update(frame, anim, mono, rawBands, rateScale, fixedEnergy, lufs, beatDiag, gate): void {
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

      // ---- Gate ----
      // No RAW branch, same as the Rhythm card's hits history just below:
      // this is already an instant, local reading with no pre-smoothing
      // counterpart threaded through AnimFrame to switch to.
      if (!gateCard.fold?.isFolded()) {
        gateDimmer.setValue(gate ? gate.dimmer : null, dtSec);
        if (text) gateDimmer.setReadout(gate ? pct(gate.dimmer) : "--", gate ? {} : IDLE);
        // Level plots off `frame` regardless of `gate` — it doesn't need a
        // local extractor — while Dimmer/Stopped/Fired go null wherever
        // `gate` itself does (see AudioMeters.update's own doc comment).
        if (frame || gate) {
          gateHistoryStrip.push(
            [
              gate ? (gate.suppressed ? 1 : 0) : null,
              gate ? (gate.fired ? 1 : 0) : null,
              gate ? gate.dimmer : null,
              frame ? frame.level / gateLevelTop(deps.getSilenceGate()) : null,
            ],
            nowMs,
          );
          gateHistoryStrip.draw();
        }
      } else {
        // Folded: don't accumulate a column while hidden, same as Signal's History.
        gateHistoryStrip.resetColumn();
      }

      // ---- Rhythm ----
      if (!rhythmCard.fold?.isFolded()) {
        const sectionVal = anim ? (raw ? anim.raw.sectionIntensity : anim.sectionIntensity) : null;
        tempo.update(anim?.tempoLock ?? 0, !!frame?.onset);
        section.setValue(sectionVal, dtSec);
        if (anim?.dropOnset) section.flash(HOT_RED);
        if (text) {
          gridRow.sync();
          // A grid stop that hasn't got a tempo yet is firing hits — say so
          // beside the choice rather than letting it look ignored.
          const waiting = anim !== null && deps.beatGrid.get() !== BEAT_GRID_DEFAULT && !anim.onGrid;
          gridRow.setStatus(waiting ? "no tempo lock · hits" : "");
          tempo.settle(frame?.bpm ?? 0, nowMs, raw || smoothingOff);
          section.setReadout(
            sectionVal === null ? "--" : pct(sectionVal),
            sectionVal === null ? IDLE : {},
          );
        }
        // A wrap (this frame's beatPhase less than last frame's) is the grid
        // tick; its height is tempoLock, so an unlocked guess draws short
        // rather than a confident-looking full-height spike. null (not 0)
        // while idle, matching every other series' "lift the pen" idle read.
        if (anim) {
          const wrapped = prevBeatPhase !== null && anim.beatPhase < prevBeatPhase;
          prevBeatPhase = anim.beatPhase;
          beatTrace.push([wrapped ? anim.tempoLock : 0, anim.beatPulse], nowMs);
        } else {
          prevBeatPhase = null;
          beatTrace.push([null, null], nowMs);
        }
        beatTrace.draw();
        // Local diagnostic, same availability as fixedEnergy (null on a
        // mic-less renderer or the synthetic feed) — see AudioMeters.update's
        // own doc.
        hitsHistory.update(frame, anim, beatDiag, nowMs, text);
        onset.setValue(beatDiag ? beatDiag.ratio / ONSET_METER_MAX : null, dtSec);
        if (frame?.onset) onset.flash();
        if (text) {
          onset.setReadout(beatDiag ? beatDiag.ratio.toFixed(2) : "--", beatDiag ? {} : IDLE);
        }
      } else {
        // Folded: don't accumulate a column while hidden, same as History
        // and Centroid — and forget the last phase so unfolding mid-track
        // doesn't read the jump across the fold as a wrap.
        beatTrace.resetColumn();
        hitsHistory.resetColumn();
        prevBeatPhase = null;
      }

      // ---- Hit strength ----
      if (!hitStrengthCard.fold?.isFolded()) {
        if (anim) {
          // Each lane's dot on the Curve tracks its own *last-hit* ratio,
          // not this tick's live reading (which wanders below the firing
          // line between hits and would put the dot somewhere a real hit
          // never landed) — only overwritten on the exact tick that lane
          // fires, same convention hitStrengthHistory's own push() below
          // uses for its bars.
          if (frame?.onset) lastHitRatio[0] = beatDiag ? beatDiag.ratio : null;
          if (anim.lowOnset) lastHitRatio[1] = anim.hits.low.ratio;
          if (anim.midOnset) lastHitRatio[2] = anim.hits.mid.ratio;
          if (anim.highOnset) lastHitRatio[3] = anim.hits.high.ratio;
        }
        hitStrengthHistory.push(frame, anim, nowMs);
        // Read fresh every draw(), like the Gate History's own marks — a
        // slider drag should move the curve/guide immediately.
        const shape = deps.hitShape.get();
        hitCurve.draw(shape.knee, lastHitRatio);
        hitStrengthHistory.draw(shape.floor);
        if (text) {
          const parts = anim
            ? [anim.hitStrength.beat, anim.hitStrength.low, anim.hitStrength.mid, anim.hitStrength.high]
            : null;
          for (let li = 0; li < HITS_LANES.length; li++) {
            hitStrengthLegend.setNote(li, hitStrengthNote(parts ? parts[li] : null));
          }
        }
      } else {
        // Folded: don't accumulate a column while hidden, same as the hits
        // history above.
        hitStrengthHistory.resetColumn();
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
