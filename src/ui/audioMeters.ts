import type { AnimFrame } from "../render/animClock.ts";
import { getTapRun } from "../render/tapTempo.ts";
import {
  BAND_SIGNALS,
  SIGNALS,
  dialSignalId,
  surgeAtThreshold,
  type BandSignalId,
  type MeterCardId,
  type MeterRowId,
  type SignalId,
} from "../render/signals.ts";
import { isStemSignal } from "../render/stemReaders.ts";
import type { FeatureFrame } from "../audio/types.ts";
import type { DriveSourceChoice } from "../render/drives.ts";
import { driveSourceColor, driveSourceDescription, driveSourceLabel, jackKey } from "./driveSources.ts";
import { createJack, setRowFed, type JackHandle } from "./jack.ts";
import {
  createHeatTrack,
  heatGlowLevel,
  heatHistory,
  heatStripBackground,
  heatText,
  heatToColor,
  HEAT_HISTORY_CELLS,
  HEAT_REFRESH_MS,
  type HeatTrack,
} from "./heat.ts";
import { flashTo } from "./flashAnim.ts";
import { bandCenterHz, formatHz } from "../audio/bandScale.ts";
import { METRONOME_BEATS_PER_BAR } from "../render/metronome.ts";
import { SILENCE_GATE_MIN, type SilenceGateMarks, type SilenceGateReading } from "../audio/silenceGate.ts";
import { DIAL_LABELS, MUSIC_DIALS, NEUTRAL, type MusicDial } from "../render/musicProfile.ts";
import { verdictOf, type OnsetDiag, type OnsetVerdict } from "../audio/onsetDiag.ts";
import { HIT_DEFAULTS, REFRACTORY_S } from "../audio/engine/onsets.ts";
import { RISE_K, RISE_WINDOW_S } from "../render/bandEnergy.ts";
import type { HitParts } from "../audio/hitStrength.ts";
import {
  AUTO_SKY,
  FONT_LABEL,
  FONT_MONO,
  HOT_RED,
  INPUT_GREEN,
  LANE_JACK_GUTTER_PX,
  STEM_LEAD,
  STRIP_HIGH,
  STRIP_LOW,
  STRIP_MID,
  withAlpha,
} from "./controlsTheme.ts";
import {
  chipBtnStyle,
  createCard,
  createChipButton,
  createTraceLegend,
  digitsStyle,
  digitsTextStyle,
  readoutStyle,
  rowHeadStyle,
  rowLabelStyle,
  rowRightStyle,
  spacer,
  unitStyle,
} from "./controlsKit.ts";
import { setHintText } from "./hintSwatches.ts";
import { createCanvasSizer } from "./canvasSizer.ts";
import { watchOnScreen } from "./onScreen.ts";
import {
  cycleHistorySpan,
  formatHistorySpan,
  getHistorySpan,
  HISTORY_SPAN_DEFAULT,
  HISTORY_SPAN_MAX,
  HISTORY_SPANS,
} from "./historySpan.ts";
import { CARRY_MS, createColumnStore } from "./columnStore.ts";
import { createSpectrumStrip, type SpectrumStrip } from "./spectrumStrip.ts";
import { isBandPicked, toggleBandPick } from "./bandPicks.ts";

/**
 * The meters under the spectrum card: everything the audio pipeline already
 * derives besides the bands in spectrumStrip.ts, plus the two things a
 * spectrum can't show at all. Read-only cards in the panel's own row grammar
 * (see deviceMenu.ts / controlsKit.ts) — label, seven-segment readout, a
 * meter where a slider would be, and a hint shown beside the panel on hover
 * or tap (rowHints.ts) so
 * every reading explains itself. The cards run in pipeline order: Sound is
 * what this device measures before any beat/tempo logic runs, Beat is
 * everything about *when*, Song is the slow trend over a whole track.
 *
 *  - Heat history: the last card, folded by default (its own span chip), a
 *    strip per wired setting and per signal jack.
 *  - Sound: a thin live spectrum (spectrumStrip.ts's second instance, fed by
 *    deviceMenu.ts), then one-line rows (createLineRow: name, a trace over
 *    the card's span on one fixed scale that never rescales, readout, jack):
 *    Level (the only way to see features.ts's adaptive floor/peak doing its
 *    job, since its whole point is to make that invisible downstream), Bass,
 *    Mid and Treble. Under them a Bands block of line rows for single bands:
 *    a row per band (signals.ts's BAND_SIGNALS, all mounted
 *    hidden at build) that shows while it's picked by a click on the
 *    spectrum (bandPicks.ts) or wired in this scene, so a wired band never
 *    hides. The spectrum marks the Kick band's bar and every shown band's
 *    bar in that row's colour. Under Level's line a band along the bottom is shaded
 *    per column by how closed the silence gate was (1 - Dimmer), not by a
 *    line at the gate's marks: those sit on Input level's scale and Level is
 *    auto-gained, so a mark line would lie. No gate reading (the synthetic
 *    feed) draws no shade. The post-bandEnergy pulses live in the Hits
 *    card's own hits history instead — see below.
 *  - Stems: Lead and Hats (stemReaders.ts) as line rows of their own, then
 *    the Kick band row, labelled with the Hz of the band the app picks by
 *    itself. Lead and Hats are measured only on the device with the mic, and a gap is drawn
 *    where they weren't; app.ts runs the split while this card is unfolded
 *    and on screen (stemRowsOnScreen).
 *  - Hits: one lane each for Any hit (the broadband detector) and
 *    bandEnergy.ts's Bass/Mid/Treble (createHitsHistory), tracing each one's
 *    ratio against its firing threshold plus a tick for every
 *    fired/gated/blocked reading (onsetDiag.ts's OnsetVerdict) — a history,
 *    not just an instant reading, so a tuning session can see *why* a hit
 *    did or didn't count, ground-shaded by how closed the silence gate was
 *    at the time. A fired tick's height is that hit's graded strength
 *    (src/audio/hitStrength.ts's HitParts).
 *  - Beat: a welded row, Lock (how sure the tracker is of the tempo)
 *    beside the BPM block — bpm under a beat dot whose resting tint
 *    follows tempoLock, so an unlocked guess reads as
 *    unconfident rather than as a confident wrong number, and the BPM
 *    digits dim the same way. Beneath that, the bar ruler (createBarRuler):
 *    one cell per beat of the metronome's bar, the current one lit and the
 *    downbeat in its own colour, with the Metronome (every beat) and
 *    Metronome bar (once a bar) jacks on it. Last, Wave: beatWave/barWave's
 *    own smooth swing, for a setting that wants to sway in time rather than
 *    pulse on a hit. The header carries tap tempo's Tap chip and how many
 *    taps it still needs (tapStatusStyle's comment).
 *  - Song: first, Section: sectionIntensity traced over the card's span
 *    (createSectionTrace), with a red mark and DROP where a drop fired, the
 *    phrase-level trend. Then one strip of every entry in MUSIC_DIALS (never a
 *    hardcoded list, so a new dial can't ship without a cell), each a small
 *    vertical bar marking NEUTRAL with a tick (what autoTune.ts resolves every
 *    "A" chip against, otherwise invisible), its label from DIAL_LABELS, and
 *    its jack (createDialCell).
 *
 * Fills move every frame; readout text at ~10Hz (the same reasoning as
 * deviceMenu.ts's AUTO_UI_REFRESH_MS — text writes cost layout, and eyes
 * can't read faster anyway). Flashes (a bar's
 * flash(), the BPM dot on each beat, revealRow's ring) run as Web Animations
 * through flashAnim.ts rather than as style writes, so they never force a
 * layout.
 *
 * Every graph canvas here is role="img" with a name set by nameGraph, the
 * same way leashGauge.ts names its gauge. The label is a required argument of
 * createColumnRing and createTraceStrip, so a new trace can't ship unnamed.
 *
 * Each card is independently collapsible (controlsKit.ts's createCard
 * foldId, remembered in panelFolds.ts) and update() skips a folded card's
 * drawing and DOM writes — folding buys back the per-frame cost, not just
 * the screen space.
 *
 * Every time-axis trace (the Sound and Stems rows, Hits, Wave,
 * Section) records into a time store (createColumnRing) on every tick,
 * folded card or closed panel alike, so opening a card shows what it
 * missed. A span chip in each card's header (historySpan.ts) picks how
 * much of that the card's traces squeeze into its width, from
 * HISTORY_SPANS, remembered per card.
 *
 * setRaw (called by deviceMenu.ts's one merged RAW chip, in the column head
 * above the Sound card — see that file's own comment for why one chip drives this
 * and the spectrum strip's own raw mode together) flips every row that has
 * a pre-smoothing counterpart to it, for diagnosing "is this a bad
 * measurement or just a slow ease": Section reads sectionIntensity's
 * un-slewed target (anim.raw.sectionIntensity), the Song dials read
 * musicProfile's pre-ease targets (anim.raw.profile), Centroid reads its raw
 * reading (anim.centroidRaw), BPM shows the
 * estimator's raw candidate instead of tempoSettle.ts's settled reading.
 * Input level and the beat dot
 * are already raw and don't change. Level has no pre-envelope value threaded
 * through AnimFrame, so its readout is the mean of `rawBands` instead — the
 * same pre-AGC/pre-envelope feed app.ts's captureRawBands hands the spectrum
 * strip's own listening-post chip (the Sound card's thin spectrum follows it
 * too). The Sound traces keep recording the signals themselves, so a trace
 * and a wire read the same number; RAW only changes Level's readout. That
 * feed is local-only, so Level reads
 * idle under RAW on a mic-less renderer. A folded card still skips its own
 * work when RAW is on — the flag only changes what a card computes while
 * it's open, not whether folding buys back that cost.
 *
 * The patch bay's jacks (src/ui/jack.ts) mount on every row above that a
 * drive source can feed — one per line row (Sound's Level, Bass, Mid,
 * Treble and every band row, Stems' Lead, Hats and Kick band; createLineRow
 * mounts them),
 * Section's own Section+Drop pair and one per dial cell (Song, signals.ts's
 * DIAL_SIGNALS), the BPM block's own Tempo jack, Lock, the bar ruler's own
 * Metronome+Metronome bar pair (createBarRuler) and Wave's Beat/Bar pair
 * (Beat), and one per hits-history lane, plus one for the Surge lane under
 * them, Onset surge's own (createHitsHistory's own laneMounts, Hits).
 * Every jack's click/hover/fill/usage state is
 * `deps.patch` (AudioMetersDeps's own doc comment); this file only ever
 * mounts them and, on refreshPatchView(), reads that state back into a
 * jack's own visuals and its row/lane's fed glow (jack.ts's setRowFed) —
 * never per frame, only on a selection or patch change. jackElements() is
 * the cable layer's (src/ui/cableLayer.ts, owned by deviceMenu.ts) own
 * source-endpoint lookup.
 *
 * Signal jacks take part in the heat lens (heat.ts): a signal jack has no dot
 * of its own. Every signal's track records on every tick, folded card or
 * closed panel alike. Each jack's heat colour refreshes at most every
 * HEAT_REFRESH_MS, and only on an unfolded card; while the heat lens is on,
 * the jack glows, brighter as its reading moves. A jack reads its signal's
 * own card's span chip (`monitor.card`), or the card it's mounted on when the
 * signal has no monitor. Each monitor row also carries its signal's heat on
 * the same span and refresh as the jack: a line row as the floor of its trace
 * lane, any other row as strips under it, one per signal jack on it, led by a
 * dot in the signal's colour. The Heat history card (its own span chip,
 * folded by default, last in the column) draws one strip per wired setting, from
 * deps.heatSettings, and one per signal jack.
 *
 * Every one of those "un-eased" values is what its smoothed sibling is
 * eternally chasing — none of it is a param a Reset chip can zero out.
 * `rateScale` (this file's update(), threaded from app.ts's
 * sensitivity.ts's smoothingRateScale) is what actually closes the gap: at
 * Smoothing at 0 it's Infinity, and every stage upstream of
 * this file (features.ts's envelope, sectionIntensity.ts's INTENSITY_SLEW,
 * musicProfile.ts's eases) plus this
 * file's own BPM settle snap straight to their targets — see sensitivity.ts's
 * header for the full account of why RAW is then a genuine no-op rather than
 * merely fast.
 */

export interface AudioMeters {
  el: HTMLElement;
  /** Fed every frame, panel open or closed. `onScreen` false only records the
   *  traces: no draws or DOM writes, and peak fall, text cadence and flashes
   *  count from the last drawn tick. `frame`/`anim` null = audio not up yet.
   *  `rawBands`, `beatDiag` and `gate` are null on a
   *  device without the matching local analyser, and the rows that read them
   *  idle or hide. `rateScale` is
   *  sensitivity.ts's smoothingRateScale; non-finite (Smoothing Off) shows the
   *  raw BPM estimate, as `raw` does. */
  update(
    frame: FeatureFrame | null,
    anim: AnimFrame | null,
    rawBands: Float32Array | null,
    rateScale: number,
    beatDiag: OnsetDiag | null,
    gate: SilenceGateReading | null,
    onScreen: boolean,
  ): void;
  /** Raw mode for the meters (see file header). deviceMenu.ts's merged RAW chip
   *  calls it alongside spectrumStrip.setShowRaw. */
  setRaw(on: boolean): void;
  /** Turns the heat lens on or off (deviceMenu.ts's HEAT chip and L key):
   *  while on, update() writes every signal jack's glow (heat.ts). */
  setHeatLens(on: boolean): void;
  /** Unfolds `card` if folded, scrolls `row` into view and flashes it (the
   *  "reacts to" strip's jump target). No-op for an unregistered row. */
  revealRow(card: MeterCardId, row: MeterRowId): void;
  /** Refreshes every jack and fed-row glow from `deps.patch`. On a selection or
   *  patch change only, never per frame. */
  refreshPatchView(): void;
  /** This card's jacks by driveSources.ts's jackKey: the cable layer's
   *  (src/ui/cableLayer.ts) source endpoints. Never mutated after build. */
  jackElements(): ReadonlyMap<string, HTMLElement>;
  /** The heat line (heat.ts) for a jack's tooltip; null for a jack with no
   *  heat. */
  jackHeatText(choice: DriveSourceChoice): string | null;
  /** The Sound card's thin spectrum; deviceMenu.ts feeds it. */
  soundSpectrum: SpectrumStrip;
  /** The Sound card is unfolded and on screen, so its spectrum is worth feeding. */
  soundSpectrumShown(): boolean;
  /** The Stems card is unfolded and on screen: app.ts runs the stem split for it. */
  stemRowsOnScreen(): boolean;
}

export interface AudioMetersDeps {
  /** Wired settings and their heat tracks, for the Heat history card. */
  heatSettings(): readonly { label: string; track: HeatTrack }[];
  /** Tap chip: one tap at the pointerdown's timeStamp (same path as app.ts's Ctrl). */
  onTap: (timeStamp: number) => void;
  /** Whether Hats and Lead were measured this tick (src/render/stemReaders.ts);
   *  while not, their heat records a gap rather than a cold stretch. */
  stemsMeasured(): boolean;
  /** The Input card's two gate marks, read fresh every draw/text tick so a drag
   *  moves the Gate guides and the hits hint live. */
  getSilenceGate: () => SilenceGateMarks;
  /** The band ladder in Hz (src/audio/bandScale.ts), for the Kick band row's
   *  Hz in the Sound card's Bands block. */
  getBandEdgesHz: () => ArrayLike<number>;
  /** Jack behaviour and live state (jack.ts header). Predicates are keyed by
   *  the DriveSourceChoice a jack stands for; driveSources.ts's jackKey merges
   *  every beat-grid division. deviceMenu.ts is the only implementation. */
  patch: {
    /** Settings in this scene that use `choice`: the jack's usage dots. */
    usage(choice: DriveSourceChoice): number;
    /** `choice` feeds the shown (preview ?? pinned) setting: jack fill, hard row glow. */
    isShown(choice: DriveSourceChoice): boolean;
    /** `choice` feeds the pinned setting: jack aria-pressed. */
    isPinned(choice: DriveSourceChoice): boolean;
    /** `choice` feeds the previewed setting, only while it differs from the
     *  pinned one: a row's soft glow, which wins over a pinned feed there. */
    isPreview(choice: DriveSourceChoice): boolean;
    /** `isPinned`, but false for a muted source. Use it for a row's fed glow
     *  only: a muted jack still fills solid. */
    isPinnedActive(choice: DriveSourceChoice): boolean;
    /** `isPreview`, but false for a muted source. */
    isPreviewActive(choice: DriveSourceChoice): boolean;
    /** A setting other than the pinned one is being previewed; an uncontested
     *  pinned feed then steps back to a faint mark. */
    previewIsActive(): boolean;
    /** `choice` is in the shown setting's `drive.sceneSources` (no patch to
     *  edit, so only a soft row glow). */
    isSceneSource(choice: DriveSourceChoice): boolean;
    /** aria-label / title for the jack, phrased against the setting a click reaches. */
    describe(choice: DriveSourceChoice): { aria: string; title: string };
    /** Toggles `choice` in the pinned setting; with none pinned, pins the last
     *  previewed one first; with neither, a "Pick a setting first" toast. */
    onJackClick(choice: DriveSourceChoice): void;
    /** Highlights every scene row `choice` currently feeds. */
    onJackHover(choice: DriveSourceChoice, on: boolean): void;
    /** Tells the panel which choice this jack element carries — for dragging a jack (deviceMenu.ts). */
    registerJack(el: HTMLElement, choice: DriveSourceChoice): void;
  };
}

const PEAK_FALL_PER_SEC = 1.2; // matches spectrumStrip.ts's peak-hold decay
const TEXT_REFRESH_MS = 100;
// Top of a hit lane's ratio trace and the Curve's x-axis (1 = the firing
// line); headroom so lanes don't pin at full on every beat.
const ONSET_METER_MAX = 2.5;
/** Readings that feed no single system — same neutral as the Palette card. */
const NEUTRAL_ACCENT = "rgba(255,255,255,0.7)";
const FADE_MS = 300;
const FADE = `background-color ${FADE_MS}ms ease-out`;

// At a slider's height so meter and slider rows line up.
const meterWrapStyle = `display: flex; align-items: center; height: 22px; margin-top: 2px;`;
const trackStyle = `position: relative; width: 100%; height: 3px; border-radius: 2px; background: rgba(255,255,255,0.18);`;
const fillStyle = (accent: string) =>
  `position: absolute; top: 0; left: 0; height: 100%; width: 0; border-radius: 2px; background-color: ${accent}; transition: ${FADE};`;
const capStyle = `position: absolute; top: -1px; bottom: -1px; width: 1.5px; left: 0; background: #fff; visibility: hidden;`;
const tickStyle = `position: absolute; top: -2px; bottom: -2px; width: 1px; background: rgba(255,255,255,0.55);`;
// Tempo block, welded beside the Lock row and framed like a woken .vc-row
// (controlsTheme.ts's hover ring and tint, 6px past the content). Its right
// margin reaches 8px into the card padding like a .vc-row's ring, so card edge
// -> ring, ring -> block and block -> card edge are all 4px.
//
// It hosts the anim.tempo jack (mountJack), absolutely
// positioned: a jack row would grow the block and, through weldedRowStyle's
// align-items: stretch, the Lock row.
const weldedRowStyle = `display: flex; gap: 12px; align-items: stretch;`;
const tempoBlockStyle = (accent: string) => `
  width: 74px; flex-shrink: 0; display: grid; place-items: center; text-align: center;
  margin: -6px -8px -6px 0; border-radius: 4px; position: relative;
  background-color: color-mix(in srgb, ${accent} 6%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, ${accent} 45%, transparent);
`;
const tempoJackHostStyle = `
  position: absolute; top: 50%; left: 3px; right: 3px; transform: translateY(-50%);
  display: flex; justify-content: space-between;
`;
const BEAT_COLOR = HOT_RED;
// The beat's lit look and fade are a Web Animation (flashTo); this transition
// only eases a change of resting tint.
const DOT_FADE_MS = 550;
const tempoDotStyle = `
  width: 6px; height: 6px; border-radius: 50%; margin: 5px auto 0;
  background-color: ${withAlpha(BEAT_COLOR, 0.25)}; box-shadow: 0 0 0 0 transparent;
  transition: background-color ${DOT_FADE_MS}ms ease-out;
`;
const tempoDigitsStyle = `${digitsStyle} font-size: 13px; color: #fff; transition: color 0.4s ease-out;`;
const tempoCaptionStyle = `font: 400 8.5px/1.4 ${FONT_MONO}; letter-spacing: 0.14em; color: rgba(255,255,255,0.4); margin-top: 2px;`;
const tickLabelStyle = `
  position: absolute; top: 6px; transform: translateX(-50%);
  font: 400 8px/1 ${FONT_MONO}; letter-spacing: 0.04em; color: rgba(255,255,255,0.45); white-space: nowrap;
`;
const TEMPO_TITLE =
  "Tempo. The dot flashes white on every metronome tick and settles back to its colour, brighter as the tracker gets sure. TAPPED under the number: you tapped this tempo, and the tracker follows the music from it.";
// Tap tempo chip (src/render/tapTempo.ts): taps on pointerdown, the press is
// the beat, as with Ctrl in app.ts.
const tapStatusStyle = `font: 400 9.5px/1.2 ${FONT_MONO}; letter-spacing: 0.04em; color: rgba(255,255,255,0.7); white-space: nowrap;`;
const tapRightStyle = `display: flex; align-items: center; gap: 8px;`;
const SECTION_TRACE_HEIGHT_CSS_PX = 34;
const DROP_MARK_COLOR = HOT_RED;
const DROP_LABEL_FONT = `9px ${FONT_MONO}`;
// Room the DROP label needs before the right edge, so a drop at "now" stays readable.
const DROP_LABEL_PX = 24;
const DIAL_BAR_HEIGHT_CSS_PX = 44;
const DIAL_BAR_WIDTH_CSS_PX = 10;
const SOUND_SPECTRUM_HEIGHT_CSS_PX = 30;
// A one-line row (createLineRow): name column, trace, readout, jacks. The
// heat floor (.vc-heat-floor) sits under the trace inside the same lane.
const LINE_LABEL_WIDTH_PX = 66;
const LINE_TRACE_HEIGHT_PX = 19;
const LINE_READOUT_WIDTH_PX = 38;
// The gate floor: the share of Level's height the shade takes, and its alpha at
// a fully closed gate.
const SOUND_GATE_FLOOR_FRAC = 0.15;
const SOUND_GATE_FLOOR_ALPHA = 0.22;
// Faint enough that the heat floor stays the louder cue.
const SOUND_FILL_ALPHA = 0.13;
// Vertical padding without .vc-row's negative vertical margin, so stacked line
// rows don't overlap and need no spacer.
const lineRowStyle = `display: flex; align-items: center; gap: 6px; padding: 2px 8px; margin: 0 -8px;`;
const lineLabelStyle = `
  font: 300 13px/1.2 ${FONT_LABEL}; flex: none; width: ${LINE_LABEL_WIDTH_PX}px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const lineLaneStyle = `position: relative; flex: 1; min-width: 0;`;
const lineReadoutStyle = `${readoutStyle} flex: none; width: ${LINE_READOUT_WIDTH_PX}px; justify-content: flex-end; gap: 2px;`;
const lineDigitsStyle = `${digitsStyle} font-size: 10px;`;
const lineDigitsTextStyle = `font: 400 10px/1 ${FONT_MONO};`;
const lineUnitStyle = `font: 400 9px/1 ${FONT_MONO}; color: rgba(255,255,255,0.75);`;
const rowSubStyle = `font: 400 9.5px/1 ${FONT_MONO}; letter-spacing: 0.04em; color: rgba(255,255,255,0.45); margin-left: 4px;`;
// The Sound card's "Bands" caption: the card title's small caps, a step down.
const bandsLabelStyle = `font: 400 9px/1 ${FONT_MONO}; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.45); margin: 8px 0 2px;`;
const BEAT_TRACE_HEIGHT_CSS_PX = 28;
// Predicted-grid colour (Wave's bar wave, the bar ruler's downbeat). Blue against
// BEAT_COLOR's red keeps "predicted" and "detected" apart.
const BEAT_GRID_COLOR = AUTO_SKY;
/** A card's span chip as a trace reads it: what it shows now, and the most
 *  it can ever show (how long the trace keeps). */
interface TraceSpan {
  sec: () => number;
  max: number;
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

/** A graph canvas is role="img" with a name, the way leashGauge.ts names its
 *  gauge. Labelled rather than hidden: a readout beside a graph gives the
 *  current value, while the graph draws its history. */
function nameGraph(canvas: HTMLCanvasElement, label: string): void {
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", label);
}

/** The canvas side of every trace strip: a columnStore.ts store drawn as one
 *  column per CSS pixel over `spanSec()`, so every trace (createHitsHistory,
 *  the Sound rows) shares its timing. push() records whether or not
 *  anything is on screen; prepare() resamples and returns false while the canvas has no
 *  layout. A column stays NaN when never sampled (a null reading, or a stall,
 *  see columnStore.ts's header): read it as "lift the pen", not zero. */
function createColumnRing(
  seriesCount: number,
  heightPx: number,
  label: string,
  spanSec: () => number = () => HISTORY_SPAN_DEFAULT,
  maxSpanSec: number = HISTORY_SPAN_DEFAULT,
) {
  const canvas = document.createElement("canvas");
  nameGraph(canvas, label);
  canvas.style.cssText = `display: block; width: 100%; height: ${heightPx}px; margin-top: 4px;`;
  const ctx = canvas.getContext("2d")!;
  const S = seriesCount;
  const store = createColumnStore(S, maxSpanSec);
  // This tick's columns (prepare()), pixel-major, S floats per column.
  let cols = new Float32Array(0);
  let colsW = 0;
  // Only sizes the pixels: the store keeps time, so a width change doesn't
  // touch it — see canvasSizer.ts.
  const sizer = createCanvasSizer(canvas, ctx, { heightCssPx: heightPx });

  return {
    canvas,
    ctx,
    /** CSS pixel width (0 before first layout). */
    get width(): number {
      return sizer.width;
    },
    /** Whole columns before the live one at the right edge: at(x, s) takes
     *  0..length-1, live(s) is column `length`. Valid after a prepare() that
     *  returned true. */
    get length(): number {
      return Math.max(0, colsW - 1);
    },
    /** Column x (0 = oldest), series s. */
    at(x: number, s: number): number {
      return cols[x * S + s];
    },
    /** The newest, still-filling column, drawn at the right edge. */
    live(s: number): number {
      return cols[(colsW - 1) * S + s];
    },
    /** One sample per series, `null` for no reading. Call every tick, drawn or not. */
    push: store.push,
    resetColumn: store.resetColumn,
    prepare(): boolean {
      if (!sizer.ensure()) return false;
      const w = sizer.width;
      if (w !== colsW) {
        cols = new Float32Array(w * S);
        colsW = w;
      }
      store.resample(cols, w, spanSec());
      return true;
    },
  };
}

type ColumnRing = ReturnType<typeof createColumnRing>;

/** One polyline of series `s` over the ring plus the live column; NaN lifts the
 *  pen so a missing sample leaves a gap, not a line to zero. */
function strokeSeries(
  ring: ColumnRing,
  ctx: CanvasRenderingContext2D,
  s: number,
  color: string,
  width: number,
  yOf: (v: number) => number,
): void {
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

/** A rolling line trace over createColumnRing. `guides` replaces the fixed
 *  mid-height line with dashed lines at each `at` (0..1, the series' y scale),
 *  read fresh every draw() since a mark can move. `span` is the card's span
 *  chip; without it the strip uses HISTORY_SPAN_DEFAULT. `label` names the
 *  canvas (nameGraph) and has no default, so a strip can't ship unnamed. */
function createTraceStrip(
  series: TraceStripSeries[],
  heightPx: number,
  opts: { label: string; guides?: () => TraceStripGuide[]; span?: TraceSpan },
) {
  const { guides, span, label } = opts;
  const ring = createColumnRing(series.length, heightPx, label, span?.sec, span?.max);
  const { canvas, ctx } = ring;
  const yOf = (v: number) => 1 + (1 - clamp(v, 0, 1)) * (heightPx - 2);

  return {
    canvas,
    push: ring.push,
    /** Redraws every series in order; the last lands on top. `guides` replace
     *  the mid-height line, which would read as an unlabeled third mark. */
    draw(): void {
      if (!ring.prepare()) return;
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
      for (let i = 0; i < series.length; i++) strokeSeries(ring, ctx, i, series[i].color, series[i].width, yOf);
    },
    resetColumn: ring.resetColumn,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

const ROW_FLASH_MS = 600;
// A new flash cancels the row's last one instead of stacking.
const rowFlashes = new WeakMap<HTMLElement, Animation>();
/** Jump-then-fade on a row's ring: revealRow's cue, since a jumped-to row
 *  isn't necessarily under the pointer. */
function flashRow(el: HTMLElement): void {
  const anim = flashTo(
    el,
    rowFlashes.get(el) ?? null,
    { boxShadow: "0 0 0 1px #fff, 0 0 16px 2px rgba(255,255,255,0.5)" },
    null, // ease to whatever the row shows then (hover ring, focus)
    ROW_FLASH_MS,
  );
  if (anim) rowFlashes.set(el, anim);
}

interface MeterRowSpec {
  label: string;
  accent: string;
  /** Mono suffix after the digits ("%", "bpm"). */
  unit?: string;
  /** The hint shown beside the panel on hover/tap (rowHints.ts). Omit for a
   *  self-explaining row: no hint, not focusable. */
  description?: string;
  /** The colour a word in `description` stands for (hintSwatches.ts): "red"
   *  beat ticks are `BEAT_COLOR`, not the generic red. */
  hintColors?: Readonly<Record<string, string>>;
  /** Fixed marks at fractions of the track (dials' NEUTRAL, Loudness targets);
   *  a labelled tick gets text under the track. */
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
  // Labels hang below the track, past the meter's fixed height.
  if (labelled) meter.style.marginBottom = "8px";
  const cap = document.createElement("div");
  cap.style.cssText = capStyle;
  track.appendChild(cap);
  meter.appendChild(track);

  const hint = document.createElement("div");
  hint.className = "vc-hint";
  setHintText(hint, spec.description ?? "", spec.hintColors);
  if (!spec.description) hint.style.display = "none";

  el.append(head, meter, hint);

  let peakFrac = 0;
  let flashAnim: Animation | null = null;
  let lastReadoutKey = "";
  // What the fill settles to after a flash, unless setFillColor moved it.
  let restColor = spec.accent;

  return {
    el,
    /** The head's right slot: a caller mounts a jack beside the readout here. */
    right,
    /** Fraction of the track (null empties it). `dtSec` drives the peak cap's fall. */
    setValue(value: number | null, dtSec: number): void {
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
    /** A one-frame event (onset, drop): the fill jumps to `color`, fades back. */
    flash(color = "#fff"): void {
      flashAnim = flashTo(fill, flashAnim, { backgroundColor: color }, { backgroundColor: restColor }, FADE_MS);
    },
    /** A sustained state (Loudness past hot): the colour the fill rests at.
     *  Keyed, so a per-frame call is free. */
    setFillColor(color: string): void {
      if (color === restColor) return;
      restColor = color;
      fill.style.backgroundColor = color;
    },
  };
}

/** A one-line row (Sound, Stems): name | trace | % readout | jack, with the
 *  trace on a fixed 0..1 scale that never rescales. `gateFloor` adds a second
 *  series, 0..1 for how closed the silence gate was, shaded along the bottom.
 *  The jack mounts through `mountJack`; `floor` is the strip under the trace
 *  where the caller puts the signal's heat (addHeatMonitorStrip). */
function createLineRow(opts: {
  label: string;
  /** Small mono suffix after the label ("kick"). */
  sub?: string;
  description: string;
  choice: SignalId;
  span: TraceSpan;
  gateFloor?: boolean;
  mountJack: MountJack;
}) {
  const { label, sub, description, choice, span, gateFloor, mountJack } = opts;
  const color = driveSourceColor(choice);
  const el = document.createElement("div");
  el.className = "vc-row";
  el.tabIndex = 0;
  el.style.cssText = lineRowStyle;
  el.style.setProperty("--vc-accent", color);

  const labelEl = document.createElement("div");
  labelEl.className = "vc-label";
  labelEl.style.cssText = lineLabelStyle;
  const labelText = document.createElement("span");
  labelText.textContent = label;
  labelEl.append(labelText);
  if (sub) {
    const subEl = document.createElement("span");
    subEl.textContent = sub;
    subEl.style.cssText = rowSubStyle;
    labelEl.append(subEl);
  }

  const lane = document.createElement("div");
  lane.style.cssText = lineLaneStyle;
  const h = LINE_TRACE_HEIGHT_PX;
  const ring = createColumnRing(gateFloor ? 2 : 1, h, `${driveSourceLabel(choice)} over the card's span`, span.sec, span.max);
  ring.canvas.style.marginTop = "0";
  const floor = document.createElement("div");
  lane.append(ring.canvas, floor);

  const readout = document.createElement("div");
  readout.style.cssText = lineReadoutStyle;
  const digits = document.createElement("span");
  digits.style.cssText = lineDigitsStyle;
  const unit = document.createElement("span");
  unit.style.cssText = lineUnitStyle;
  readout.append(digits, unit);

  const right = document.createElement("div");
  right.style.cssText = rowRightStyle;

  const hint = document.createElement("div");
  hint.className = "vc-hint";
  setHintText(hint, description);

  el.append(labelEl, lane, readout, right, hint);
  mountJack(choice, right, el);

  const fill = withAlpha(color, SOUND_FILL_ALPHA);
  const floorH = h * SOUND_GATE_FLOOR_FRAC;
  const yOf = (v: number) => 1 + (1 - clamp(v, 0, 1)) * (h - 2);

  function draw(): void {
    if (!ring.prepare()) return;
    const { ctx } = ring;
    const w = ring.width;
    const len = ring.length;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(0, h - 1, w, 1);
    if (gateFloor) {
      ctx.fillStyle = "#fff";
      for (let x = 0; x <= len; x++) {
        const a = x === len ? ring.live(1) : ring.at(x, 1);
        if (Number.isNaN(a) || a <= 0) continue;
        ctx.globalAlpha = SOUND_GATE_FLOOR_ALPHA * a;
        ctx.fillRect(x === len ? w - 1 : x, h - floorH, 1, floorH);
      }
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = fill;
    for (let x = 0; x <= len; x++) {
      const v = x === len ? ring.live(0) : ring.at(x, 0);
      if (Number.isNaN(v)) continue;
      const y = yOf(v);
      ctx.fillRect(x === len ? w - 1 : x, y, 1, h - y);
    }
    strokeSeries(ring, ctx, 0, color, 1.5, yOf);
  }

  let lastReadoutKey = "";
  let shownLabel = label;
  return {
    el,
    floor,
    setReadout(text: string, o: ReadoutOpts = {}): void {
      const u = o.unit ?? "%";
      const key = `${text}|${u}|${o.textual ? 1 : 0}`;
      if (key === lastReadoutKey) return;
      lastReadoutKey = key;
      digits.textContent = text;
      digits.style.cssText = o.textual ? lineDigitsTextStyle : lineDigitsStyle;
      unit.textContent = u;
      unit.style.display = u ? "" : "none";
    },
    push: ring.push,
    resetColumn: ring.resetColumn,
    draw,
    /** Keyed, so a per-tick call is free. */
    setLabel(text: string): void {
      if (text === shownLabel) return;
      shownLabel = text;
      labelText.textContent = text;
    },
  };
}

type LineRow = ReturnType<typeof createLineRow>;

function createTempoBlock(accent: string) {
  const el = document.createElement("div");
  el.style.cssText = tempoBlockStyle(accent);
  el.title = TEMPO_TITLE;
  const jackHost = document.createElement("div");
  jackHost.style.cssText = tempoJackHostStyle;
  const inner = document.createElement("div");
  const dot = document.createElement("div");
  dot.style.cssText = tempoDotStyle;
  const digits = document.createElement("div");
  digits.style.cssText = tempoDigitsStyle;
  const caption = document.createElement("div");
  caption.style.cssText = tempoCaptionStyle;
  caption.textContent = "BPM";
  inner.append(digits, caption, dot);
  el.append(jackHost, inner);

  let restColor = withAlpha(BEAT_COLOR, 0.25);
  let dotAnim: Animation | null = null;
  let lastLockStep = -1;
  let shownBpm = 0;
  let shownCaption = caption.textContent;
  digits.textContent = "--";

  return {
    el,
    /** The anim.tempo jack mounts here (see tempoBlockStyle). */
    jackHost,
    /** Per frame. `lock` (0..1) sets the resting tint; `beat` is
     *  anim.metronomeBeat, not a raw hit. */
    update(lock: number, beat: boolean): void {
      // Quantised so the resting tint isn't rewritten every frame.
      const step = Math.round(lock * 20);
      if (step !== lastLockStep) {
        lastLockStep = step;
        restColor = withAlpha(BEAT_COLOR, 0.25 + 0.6 * (step / 20));
        digits.style.color = `rgba(255,255,255,${(0.45 + 0.55 * (step / 20)).toFixed(3)})`;
        dot.style.backgroundColor = restColor;
      }
      if (beat) {
        // Lit look -> current resting tint as a Web Animation, cancelled by the
        // next beat, so a beat never forces a style and layout pass.
        dotAnim = flashTo(
          dot,
          dotAnim,
          { backgroundColor: "#fff", boxShadow: `0 0 6px 1px ${BEAT_COLOR}`, transform: "scale(1.6)" },
          { backgroundColor: restColor, boxShadow: "0 0 0 0 transparent", transform: "scale(1)" },
          DOT_FADE_MS,
        );
      }
    },
    /** Text tick. `bpm` is the number to show (0 = none): anim.metronomeBpm,
     *  or the raw estimate under RAW / Smoothing Off. Keyed to skip identical
     *  writes. */
    setBpm(bpm: number): void {
      const next = bpm > 0 ? Math.round(bpm) : 0;
      if (next === shownBpm) return;
      shownBpm = next;
      digits.textContent = shownBpm > 0 ? String(shownBpm) : "--";
    },
    /** Text tick: "TAPPED" while a tap guides the shown tempo, else "BPM". */
    setTapped(tapped: boolean): void {
      const next = tapped ? "TAPPED" : "BPM";
      if (next === shownCaption) return;
      shownCaption = next;
      caption.textContent = next;
    },
  };
}

// The Hits card's history: lanes for Any hit and Bass/Mid/Treble, one canvas, one
// column per CSS pixel over the card's span. A trace-only Surge lane (signals.ts's
// "feature.flux") sits under them; it's not part of HITS_LANES, having no hits
// of its own.
const HITS_LANE_HEIGHT_PX = 16;
const HITS_LANE_COUNT = 5; // Any, Bass, Mid, Treble, Surge
const HITS_HEIGHT_PX = HITS_LANE_HEIGHT_PX * HITS_LANE_COUNT;
// 1 (the firing line) sits inside the track with headroom above it.
const HITS_RATIO_MAX = ONSET_METER_MAX;
// Per-column series: each lane's fields (hitsLaneIdx), then Surge (0..1), then
// one shared ground-shade series (1 - anim.gateDimmer). Event code is
// fired=3 > blocked=2 > gated=1 > 0 (CODE_OF_VERDICT), so a max-hold column
// keeps the highest priority when several ticks close into one column.
// strength/standout/loudness (HitParts) are written only on the tick a lane
// fires; the NaN-lifts-the-pen convention leaves the other columns blank.
interface HitsLane {
  label: string;
  color: string;
}
const HITS_LANES: readonly HitsLane[] = [
  { label: "Any", color: BEAT_COLOR },
  { label: "Bass", color: STRIP_LOW },
  { label: "Mid", color: STRIP_MID },
  { label: "Treble", color: STRIP_HIGH },
];
// Same order as HITS_LANES: each lane's jack source. Surge has its own
// (SURGE_CHOICE).
const HITS_LANE_CHOICES: readonly DriveSourceChoice[] = ["feature.onset", "anim.lowOnset", "anim.midOnset", "anim.highOnset"];
const SURGE_CHOICE: DriveSourceChoice = "feature.flux";
const HITS_FIELDS_PER_LANE = 6; // ratio, code, strength, standout, loudness, pulse

/** Where lane `li`'s fields sit in the ring's per-column series. */
function hitsLaneIdx(li: number): {
  ratio: number;
  code: number;
  strength: number;
  standout: number;
  loudness: number;
  pulse: number;
} {
  const base = li * HITS_FIELDS_PER_LANE;
  return { ratio: base, code: base + 1, strength: base + 2, standout: base + 3, loudness: base + 4, pulse: base + 5 };
}
const HITS_SURGE_LANE = HITS_LANES.length;
const HITS_SURGE_IDX = HITS_LANES.length * HITS_FIELDS_PER_LANE;
const HITS_GROUND_IDX = HITS_SURGE_IDX + 1;
const HITS_SERIES_COUNT = HITS_GROUND_IDX + 1;
// Ground shading is a wash: capped well under white so a shut gate reads as a
// dim tint, not a blackout.
const HITS_GROUND_ALPHA_MAX = 0.07;

const NULL_DIAG: OnsetDiag = { ratio: 0, gated: false, blocked: false, sinceOnsetSec: Infinity };
const CODE_OF_VERDICT: Record<OnsetVerdict, number> = { fired: 3, blocked: 2, gated: 1, miss: 0 };

/** The exact hit rule, built from the live constants (the engine's onsets.ts,
 *  the silence-gate marks) so it can't drift from what decides a tick.
 *  Recomputed at the text tick, so a drag of the Input card's gate rows shows
 *  up. */
function hitsRuleHint(getSilenceGate: () => SilenceGateMarks): string {
  const ms = (sec: number) => `${Math.round(sec * 1000)}ms`;
  const marks = getSilenceGate();
  const gate =
    marks.closed <= SILENCE_GATE_MIN
      ? "Silence gate is off."
      : `Quieter than ${pct(marks.closed)}% input level nothing counts; between ${pct(marks.closed)}% and ${pct(marks.open)}% a hit has to clear its line by more the quieter it is (Silence below / Sound above, Input card).`;
  return [
    "Full tick: fired.",
    "Dim tick: cleared the line but too soon after the last one (refractory).",
    "Faint tick on shaded ground: cleared it while the room was quiet.",
    `A hit: a peak in how fast the sound rises across all frequencies, over its last second's average + ${HIT_DEFAULTS.k}× its spread and at least ${HIT_DEFAULTS.min}, ≥${ms(REFRACTORY_S)} after the last one.`,
    "Each hit is a kick (Bass), snare (Mid) or hat (Treble) by where its rising sound sits; Any hit is any of the three.",
    `While music with a clear beat plays, Bass and Treble also fire when their own level jumps within ${ms(RISE_WINDOW_S)} by more than its last second's average jump + ${RISE_K}× its spread, so a hat under a snare still reaches Treble.`,
    "Surge: how close a hit is to firing, as a setting fed by Onset surge sees it; the line is where one fires.",
    gate,
  ].join(" ");
}

function laneNote(ratio: number | null, fires: number, spanSec: number): string {
  return `${ratio === null ? "--" : ratio.toFixed(2)} · ${fires}/${formatHistorySpan(spanSec)}`;
}

/** Mounts a jack for `choice` into `host`, registered for the row-level fed
 *  glow against `feedEl` (jack.ts's setRowFed). A callback so
 *  createHitsHistory needn't know `deps.patch`'s shape. */
type MountJack = (choice: DriveSourceChoice, host: HTMLElement, feedEl: HTMLElement) => JackHandle;

/** The Hits card's history row. Beat reads `frame.onset` and `beatDiag`
 *  (device-local only: a null diag still lets fired/miss through, with no
 *  ratio trace and no gated/blocked). Bass/Mid/Treble read `anim` (bandEnergy.ts
 *  runs everywhere). Ground shading is `1 - anim.gateDimmer`, the silence
 *  gate's dimmer. */
function createHitsHistory(
  getSilenceGate: () => SilenceGateMarks,
  mountJack: MountJack,
  span: TraceSpan,
) {
  const row = createMeterRow({
    label: "Hits",
    accent: NEUTRAL_ACCENT,
    unit: "s",
    description: `${hitsRuleHint(getSilenceGate)} A fired tick's height is its graded strength.`,
  });
  // The lane names come from HITS_LANES, so the label can't drift from the lanes.
  const hitsNames = HITS_LANES.map((l) => l.label).join(", ");
  const hitsLabel = `History of hits, one lane each for ${hitsNames}, with Surge under them`;
  const ring = createColumnRing(HITS_SERIES_COUNT, HITS_HEIGHT_PX, hitsLabel, span.sec, span.max);
  const ctx = ring.ctx;
  // Lane jacks mount in this wrapper, not the row: the row's top edge is above
  // the head and shifts with font metrics, the wrapper's is exactly the
  // canvas's. Its right padding (LANE_JACK_GUTTER_PX) ends the canvas short of
  // the jacks, so no trace runs on under one.
  const vizWrap = document.createElement("div");
  vizWrap.style.cssText = `position: relative; margin-top: 4px; padding-right: ${LANE_JACK_GUTTER_PX}px;`;
  ring.canvas.style.marginTop = "0";
  vizWrap.appendChild(ring.canvas);
  row.el.children[1].replaceWith(vizWrap);
  row.setReadout(String(span.sec()));

  const surgeColor = driveSourceColor(SURGE_CHOICE);
  const legend = createTraceLegend([
    ...HITS_LANES.map((l) => ({ color: l.color, label: l.label })),
    { color: surgeColor, label: "Surge" },
  ]);
  vizWrap.after(legend.el);

  // One jack per lane on the right edge. feedEl is the shared row, so it
  // glows as a whole; laneMounts lets refreshPatchView also glow the right lane.
  const laneMounts = HITS_LANES.map((lane, i) => {
    const choice = HITS_LANE_CHOICES[i]!;
    const jack = mountJack(choice, vizWrap, row.el);
    jack.el.style.position = "absolute";
    jack.el.style.right = "2px";
    jack.el.style.top = `${i * HITS_LANE_HEIGHT_PX + (HITS_LANE_HEIGHT_PX - 13) / 2}px`;
    const glow = document.createElement("div");
    glow.className = "vc-lane-glow";
    glow.style.top = `${i * HITS_LANE_HEIGHT_PX}px`;
    glow.style.height = `${HITS_LANE_HEIGHT_PX}px`;
    glow.style.setProperty("--c", lane.color);
    vizWrap.appendChild(glow);
    return { choice, glowEl: glow };
  });
  // The Surge lane's jack (Onset surge) sits on its own lane, so the trace a
  // patched setting reads is the one beside it.
  const surgeJack = mountJack(SURGE_CHOICE, vizWrap, row.el);
  surgeJack.el.style.position = "absolute";
  surgeJack.el.style.right = "2px";
  surgeJack.el.style.top = `${HITS_SURGE_LANE * HITS_LANE_HEIGHT_PX + (HITS_LANE_HEIGHT_PX - 13) / 2}px`;
  const surgeGlow = document.createElement("div");
  surgeGlow.className = "vc-lane-glow";
  surgeGlow.style.top = `${HITS_SURGE_LANE * HITS_LANE_HEIGHT_PX}px`;
  surgeGlow.style.height = `${HITS_LANE_HEIGHT_PX}px`;
  surgeGlow.style.setProperty("--c", surgeColor);
  vizWrap.appendChild(surgeGlow);
  laneMounts.push({ choice: SURGE_CHOICE, glowEl: surgeGlow });

  // Fire times per lane for the legend's count: kept for span.max, counted over
  // the shown span. Pruned on logging too: the only reader (the legend) is
  // skipped while Shape is open or off screen, and the log would grow.
  const fireLog: number[][] = HITS_LANES.map(() => []);
  function pruneFires(lane: number, nowMs: number): number[] {
    const log = fireLog[lane];
    const cutoff = nowMs - span.max * 1000;
    let stale = 0;
    while (stale < log.length && log[stale] < cutoff) stale++;
    if (stale > 0) log.splice(0, stale);
    return log;
  }
  function logFire(lane: number, nowMs: number): void {
    pruneFires(lane, nowMs).push(nowMs);
  }
  function firesInSpan(lane: number, nowMs: number): number {
    const log = pruneFires(lane, nowMs);
    const cutoff = nowMs - span.sec() * 1000;
    let n = 0;
    for (let i = log.length - 1; i >= 0 && log[i] >= cutoff; i--) n++;
    return n;
  }

  function laneTop(laneIdx: number): number {
    return laneIdx * HITS_LANE_HEIGHT_PX;
  }
  /** `frac` is already 0..1; laneY divides HITS_RATIO_MAX out first. */
  function laneYFrac(laneIdx: number, frac: number): number {
    return laneTop(laneIdx) + 1 + (1 - clamp(frac, 0, 1)) * (HITS_LANE_HEIGHT_PX - 2);
  }
  function laneY(laneIdx: number, ratio: number): number {
    return laneYFrac(laneIdx, ratio / HITS_RATIO_MAX);
  }

  function draw(): void {
    if (!ring.prepare()) return;
    const w = ring.width;
    const len = ring.length;
    ctx.clearRect(0, 0, w, HITS_HEIGHT_PX);

    // 1. Ground shading, proportional to how closed the gate is.
    for (let x = 0; x <= len; x++) {
      const g = x === len ? ring.live(HITS_GROUND_IDX) : ring.at(x, HITS_GROUND_IDX);
      if (!(g > 0)) continue; // NaN or 0 — nothing to shade
      ctx.fillStyle = `rgba(255,255,255,${(g * HITS_GROUND_ALPHA_MAX).toFixed(3)})`;
      ctx.fillRect(x === len ? w - 1 : x, 0, 1, HITS_HEIGHT_PX);
    }

    // Divider between the Any lane and the per-band ones, and above Surge.
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(0, HITS_LANE_HEIGHT_PX - 0.5, w, 1);
    ctx.fillRect(0, HITS_SURGE_LANE * HITS_LANE_HEIGHT_PX - 0.5, w, 1);

    // 2. A hairline per lane at ratio == 1 — the firing line.
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    for (let li = 0; li < HITS_LANES.length; li++) {
      ctx.fillRect(0, Math.round(laneY(li, 1)) - 0.5, w, 1);
    }

    // 3. The ratio trace per lane, low alpha (NaN lifts the pen).
    for (let li = 0; li < HITS_LANES.length; li++) {
      const lane = HITS_LANES[li];
      const idx = hitsLaneIdx(li);
      ctx.strokeStyle = withAlpha(lane.color, 0.55);
      ctx.lineWidth = 1;
      ctx.beginPath();
      let pen = false;
      for (let x = 0; x <= len; x++) {
        const v = x === len ? ring.live(idx.ratio) : ring.at(x, idx.ratio);
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

    // 3b. Surge lane: a filled trace (already 0..1) with a hairline where Any hit
    // fires on that scale.
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(0, Math.round(laneYFrac(HITS_SURGE_LANE, surgeAtThreshold)) - 0.5, w, 1);
    const surgeBase = laneTop(HITS_SURGE_LANE) + HITS_LANE_HEIGHT_PX - 1;
    ctx.strokeStyle = surgeColor;
    ctx.fillStyle = withAlpha(surgeColor, 0.18);
    ctx.lineWidth = 1;
    ctx.beginPath();
    let surgePen = false;
    let surgeStart = 0;
    let surgeLastX = 0;
    const closeSurge = (): void => {
      ctx.stroke();
      if (!surgePen) return;
      ctx.lineTo(surgeLastX, surgeBase);
      ctx.lineTo(surgeStart, surgeBase);
      ctx.closePath();
      ctx.fill();
    };
    for (let x = 0; x <= len; x++) {
      const v = x === len ? ring.live(HITS_SURGE_IDX) : ring.at(x, HITS_SURGE_IDX);
      if (Number.isNaN(v)) {
        if (surgePen) {
          closeSurge();
          ctx.beginPath();
          surgePen = false;
        }
        continue;
      }
      const px = x === len ? w - 1 : x;
      const y = laneYFrac(HITS_SURGE_LANE, v);
      if (surgePen) ctx.lineTo(px, y);
      else {
        ctx.moveTo(px, y);
        surgeStart = px;
      }
      surgeLastX = px;
      surgePen = true;
    }
    if (surgePen) closeSurge();

    // 4. Event tick: fired is a bar up to the hit's graded strength (exactly
    // full at Dimension 0); blocked and gated stay full-height dim/faint marks.
    for (let x = 0; x <= len; x++) {
      const px = x === len ? w - 1 : x;
      for (let li = 0; li < HITS_LANES.length; li++) {
        const lane = HITS_LANES[li];
        const idx = hitsLaneIdx(li);
        const code = x === len ? ring.live(idx.code) : ring.at(x, idx.code);
        const top = laneTop(li);
        if (code >= 2.5) {
          const strength = x === len ? ring.live(idx.strength) : ring.at(x, idx.strength);
          const yTop = laneYFrac(li, Number.isNaN(strength) ? 1 : strength);
          ctx.fillStyle = lane.color;
          ctx.fillRect(px, yTop, 1, top + HITS_LANE_HEIGHT_PX - yTop);
        } else if (code >= 1.5) {
          ctx.fillStyle = withAlpha(lane.color, 0.4);
          ctx.fillRect(px, top, 1, HITS_LANE_HEIGHT_PX);
        } else if (code >= 0.5) {
          ctx.fillStyle = "rgba(255,255,255,0.35)";
          ctx.fillRect(px, top, 1, HITS_LANE_HEIGHT_PX);
        }
      }
    }

  }

  let lastHint = "";
  return {
    el: row.el,
    /** Every tick, on screen or not: this tick's column and fires. */
    record(frame: FeatureFrame | null, anim: AnimFrame | null, beatDiag: OnsetDiag | null, nowMs: number): void {
      if (anim) {
        const beatFired = !!frame?.onset;
        const beatVerdict = verdictOf(beatFired, beatDiag ?? NULL_DIAG);
        const lowVerdict = verdictOf(anim.lowOnset, anim.hits.low);
        const midVerdict = verdictOf(anim.midOnset, anim.hits.mid);
        const highVerdict = verdictOf(anim.highOnset, anim.hits.high);
        const vals: (number | null)[] = new Array(HITS_SERIES_COUNT).fill(null);
        const setLane = (
          li: number,
          ratio: number | null,
          verdict: OnsetVerdict,
          fired: boolean,
          parts: HitParts,
          pulse: number,
        ): void => {
          const idx = hitsLaneIdx(li);
          vals[idx.ratio] = ratio;
          vals[idx.code] = CODE_OF_VERDICT[verdict];
          vals[idx.pulse] = pulse;
          if (!fired) return;
          vals[idx.strength] = parts.strength;
          vals[idx.standout] = parts.standout;
          vals[idx.loudness] = parts.loudness;
        };
        setLane(0, beatDiag ? beatDiag.ratio : null, beatVerdict, beatFired, anim.hitStrength.beat, anim.beatPulse);
        setLane(1, anim.hits.low.ratio, lowVerdict, anim.lowOnset, anim.hitStrength.low, anim.lowPulse);
        setLane(2, anim.hits.mid.ratio, midVerdict, anim.midOnset, anim.hitStrength.mid, anim.midPulse);
        setLane(3, anim.hits.high.ratio, highVerdict, anim.highOnset, anim.hitStrength.high, anim.highPulse);
        // Only with a local detector: anim.beatRatio is 0 on a TV, a flat line
        // that reads as silence rather than "no reading".
        vals[HITS_SURGE_IDX] = frame && beatDiag ? SIGNALS["feature.flux"].read(frame, anim) : null;
        vals[HITS_GROUND_IDX] = 1 - anim.gateDimmer;
        ring.push(vals, nowMs);
        if (beatFired) logFire(0, nowMs);
        if (anim.lowOnset) logFire(1, nowMs);
        if (anim.midOnset) logFire(2, nowMs);
        if (anim.highOnset) logFire(3, nowMs);
      } else {
        ring.push(new Array(HITS_SERIES_COUNT).fill(null), nowMs);
      }
    },
    /** Only while on screen, after record(). */
    render(
      frame: FeatureFrame | null,
      anim: AnimFrame | null,
      beatDiag: OnsetDiag | null,
      nowMs: number,
      text: boolean,
    ): void {
      draw();

      if (text) {
        legend.setNote(
          HITS_SURGE_LANE,
          anim && frame && beatDiag ? `${Math.round(SIGNALS["feature.flux"].read(frame, anim) * 100)}%` : "--",
        );
        const sec = span.sec();
        legend.setNote(0, laneNote(beatDiag ? beatDiag.ratio : null, firesInSpan(0, nowMs), sec));
        legend.setNote(1, laneNote(anim ? anim.hits.low.ratio : null, firesInSpan(1, nowMs), sec));
        legend.setNote(2, laneNote(anim ? anim.hits.mid.ratio : null, firesInSpan(2, nowMs), sec));
        legend.setNote(3, laneNote(anim ? anim.hits.high.ratio : null, firesInSpan(3, nowMs), sec));
        // The marks in the hint can move; touch the DOM only when it changed.
        const hint = hitsRuleHint(getSilenceGate);
        if (hint !== lastHint) {
          lastHint = hint;
          setHintText(row.el.querySelector<HTMLElement>(".vc-hint")!, hint);
        }
      }
    },
    refreshSpan(): void {
      row.setReadout(String(span.sec()));
    },
    laneMounts,
  };
}

// The Beat card's bar ruler: one cell per beat of the metronome's bar, the
// current one lit and fading over its beat, the downbeat in the Wave row's
// bar colour (both metronome jacks are white), and a playhead at the exact
// bar position. It has no history, so it
// records nothing between draws.
const BAR_RULER_HEIGHT_CSS_PX = 16;
const BAR_RULER_UNLIT = "rgba(255,255,255,0.08)";

function createBarRuler() {
  const row = createMeterRow({
    label: "Bar",
    accent: NEUTRAL_ACCENT,
    description:
      "Where the metronome is in the bar: one cell per beat, the current beat lit, the first beat of the bar in its own colour, and the thin line is the exact spot. Plug Metronome (every beat) or Metronome bar (once a bar) into a setting to pulse it in time.",
  });
  const canvas = document.createElement("canvas");
  nameGraph(canvas, "Where the metronome is in the bar, one cell per beat");
  canvas.style.cssText = `display: block; width: 100%; height: ${BAR_RULER_HEIGHT_CSS_PX}px; margin-top: 4px;`;
  const ctx = canvas.getContext("2d")!;
  const sizer = createCanvasSizer(canvas, ctx, { heightCssPx: BAR_RULER_HEIGHT_CSS_PX });
  row.el.children[1].replaceWith(canvas);
  const beatColor = driveSourceColor("anim.metronome");
  const barColor = BEAT_GRID_COLOR;

  return {
    el: row.el,
    /** The anim.metronome/anim.metronomeBar jacks mount here. */
    right: row.right,
    /** Only while on screen. */
    draw(anim: AnimFrame | null, text: boolean): void {
      const on = !!anim && anim.metronomeOn;
      const beat = on ? Math.min(METRONOME_BEATS_PER_BAR - 1, Math.floor(anim.metronomeBarPhase * METRONOME_BEATS_PER_BAR)) : -1;
      if (text) row.setReadout(on ? String(beat + 1) : "--", on ? {} : IDLE);
      if (!sizer.ensure()) return;
      const w = sizer.width;
      const h = BAR_RULER_HEIGHT_CSS_PX;
      ctx.clearRect(0, 0, w, h);
      const cw = w / METRONOME_BEATS_PER_BAR;
      for (let i = 0; i < METRONOME_BEATS_PER_BAR; i++) {
        const x0 = Math.round(i * cw) + 1;
        const x1 = Math.round((i + 1) * cw) - 1;
        if (i === beat && anim) {
          ctx.globalAlpha = 0.35 + 0.65 * (1 - anim.metronomePhase);
          ctx.fillStyle = i === 0 ? barColor : beatColor;
        } else {
          ctx.globalAlpha = 1;
          ctx.fillStyle = BAR_RULER_UNLIT;
        }
        ctx.fillRect(x0, 2, x1 - x0, h - 4);
      }
      ctx.globalAlpha = 1;
      if (on) {
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.fillRect(Math.min(w - 1, Math.round(anim.metronomeBarPhase * w)), 0, 1, h);
      }
    },
  };
}

// The Song card's Section row: sectionIntensity traced over the card's span,
// with a red mark and DROP where anim.dropOnset fired. The drop is its own
// series, recorded as 1 on the tick it fires: the column store's max-hold
// keeps a one-tick edge visible at any span.
function createSectionTrace(span: TraceSpan) {
  const row = createMeterRow({
    label: "Section",
    accent: driveSourceColor("anim.sectionIntensity"),
    unit: "%",
    description: "How intense this part of the track is against the last while, traced over the card's span. A red mark with DROP is where a drop landed.",
    hintColors: { red: DROP_MARK_COLOR },
  });
  const h = SECTION_TRACE_HEIGHT_CSS_PX;
  const ring = createColumnRing(2, h, "History of Section, with a mark at each drop", span.sec, span.max);
  row.el.children[1].replaceWith(ring.canvas);
  const { ctx } = ring;
  const color = driveSourceColor("anim.sectionIntensity");
  const yOf = (v: number) => 1 + (1 - clamp(v, 0, 1)) * (h - 2);

  return {
    el: row.el,
    /** The anim.sectionIntensity and anim.dropOnset jacks mount here. */
    right: row.right,
    setReadout: row.setReadout,
    /** [Section, 1 on a drop tick else 0]; null for no reading. */
    push: ring.push,
    /** Only while on screen. */
    draw(): void {
      if (!ring.prepare()) return;
      const w = ring.width;
      const len = ring.length;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillRect(0, h - 1, w, 1);
      ctx.fillStyle = DROP_MARK_COLOR;
      ctx.font = DROP_LABEL_FONT;
      ctx.textBaseline = "top";
      let prevDrop = false;
      for (let x = 0; x <= len; x++) {
        const isDrop = (x === len ? ring.live(1) : ring.at(x, 1)) >= 1;
        if (isDrop) {
          const px = x === len ? w - 1 : x;
          ctx.fillRect(px - 1, 0, 2, h);
          if (!prevDrop) ctx.fillText("DROP", Math.min(px + 3, w - DROP_LABEL_PX), 1);
        }
        prevDrop = isDrop;
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let pen = false;
      for (let x = 0; x <= len; x++) {
        const v = x === len ? ring.live(0) : ring.at(x, 0);
        if (Number.isNaN(v)) {
          pen = false;
          continue;
        }
        const px = x === len ? w - 1 : x;
        if (pen) ctx.lineTo(px, yOf(v));
        else ctx.moveTo(px, yOf(v));
        pen = true;
      }
      ctx.stroke();
    },
  };
}

// One cell of the Song card's dial strip: a vertical bar with the dial's
// NEUTRAL tick, its label, then its jack. Each cell is its own .vc-row so its
// hint, fed glow, heat strip (mountJack) and revealRow flash work as on a meter row.
function createDialCell(dial: MusicDial) {
  const el = document.createElement("div");
  el.className = "vc-row";
  el.tabIndex = 0;
  el.style.cssText = dialCellStyle;
  el.style.setProperty("--vc-accent", AUTO_SKY);

  const track = document.createElement("div");
  track.style.cssText = dialTrackStyle;
  const fill = document.createElement("div");
  fill.style.cssText = dialFillStyle;
  const tick = document.createElement("div");
  tick.style.cssText = dialTickStyle;
  tick.style.bottom = `${NEUTRAL[dial] * 100}%`;
  track.append(fill, tick);

  const label = document.createElement("div");
  label.className = "vc-label";
  label.style.cssText = dialLabelStyle;
  label.textContent = DIAL_LABELS[dial].label;

  const right = document.createElement("div");
  right.style.cssText = "display: flex; justify-content: center;";

  const hint = document.createElement("div");
  hint.className = "vc-hint";
  setHintText(hint, DIAL_LABELS[dial].description);

  el.append(track, label, right, hint);

  let shown = -1;
  return {
    el,
    /** The dial's own jack mounts here. */
    right,
    /** A reading in 0..1; null empties the bar. Writes only when the shown percent moves. */
    setValue(v: number | null): void {
      const pct = v === null ? 0 : Math.round(clamp(v, 0, 1) * 1000) / 10;
      if (pct === shown) return;
      shown = pct;
      fill.style.height = `${pct}%`;
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

// The Song card's dial strip: one cell per MUSIC_DIALS entry.
const dialStripStyle = `display: grid; grid-template-columns: repeat(${MUSIC_DIALS.length}, minmax(0, 1fr)); gap: 4px;`;
// margin 0 overrides .vc-row's negative margin, which would overlap the next cell.
// The cell keeps align-items: stretch so the heat strip mountJack inserts gets its full width.
const dialCellStyle = `display: flex; flex-direction: column; gap: 4px; min-width: 0; margin: 0; padding: 4px 2px;`;
const dialTrackStyle = `position: relative; width: ${DIAL_BAR_WIDTH_CSS_PX}px; height: ${DIAL_BAR_HEIGHT_CSS_PX}px; margin: 0 auto; border-radius: 2px; background: rgba(255,255,255,0.08);`;
const dialFillStyle = `position: absolute; left: 0; right: 0; bottom: 0; height: 0; border-radius: 2px; background: ${AUTO_SKY}; opacity: 0.85;`;
const dialTickStyle = `position: absolute; left: -3px; right: -3px; height: 1px; background: #fff;`;
const dialLabelStyle = `font: 400 9px/1 ${FONT_MONO}; text-transform: uppercase; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;

const capitalise = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export function createAudioMeters(deps: AudioMetersDeps): AudioMeters {
  const root = document.createElement("div");
  root.className = "vc-meters vc-scroll";

  // Every jack this card mounts (jack.ts header). `feedEl` groups jacks that
  // share a row (Section's Song+Drop, the Hits lanes) so refreshPatchView
  // writes that row's fed state once.
  const jackRegistry: { choice: DriveSourceChoice; jack: JackHandle; feedEl: HTMLElement }[] = [];
  const jackElementsMap = new Map<string, HTMLElement>();
  // Heat (heat.ts): one track per signal, session-long, recorded every tick
  // panel open or closed. A jack's heat colour refreshes at most every
  // HEAT_REFRESH_MS while its card is on screen and unfolded; with the lens on,
  // each jack glows brighter as its reading moves (written only when the level
  // changes). Its monitor row (feedEl) glows in its hottest jack's colour at
  // its brightest jack's level, since several jacks can share a row.
  // Parallel arrays so the per-tick record loop allocates nothing.
  const heatIds = Object.keys(SIGNALS) as SignalId[];
  const heatTracks: HeatTrack[] = heatIds.map(() => createHeatTrack());
  const heatById = new Map<SignalId, HeatTrack>(heatIds.map((id, i) => [id, heatTracks[i]!]));
  const heatIsStem = heatIds.map(isStemSignal);
  // A monitor row under the lens: last written values and this pass's hottest
  // heat and brightest glow among its jacks.
  type HeatRow = { el: HTMLElement; color: string; glow: number; hottest: number; brightest: number };
  const heatRows: HeatRow[] = [];
  /** Lens record for monitor row `el`, made (and the row marked) when its
   *  first jack registers. */
  function heatRowFor(el: HTMLElement): HeatRow {
    let row = heatRows.find((r) => r.el === el);
    if (!row) {
      row = { el, color: "", glow: -1, hottest: -1, brightest: -1 };
      heatRows.push(row);
      el.classList.add("vc-heat-row");
    }
    return row;
  }
  // Each signal jack, for its lens glow, its monitor's strip and the Heat
  // history card.
  interface HeatJack {
    id: SignalId;
    card: MeterCardId;
    el: HTMLElement;
    feedEl: HTMLElement;
    row: HeatRow;
    folded: () => boolean;
    idx: number;
    color: string;
    glow: number;
  }
  const heatJacks: HeatJack[] = [];
  // This tick's reading of every signal, by heatIds index, for the lens glow.
  const heatLive = new Float32Array(heatIds.length);
  const heatIdx = new Map<SignalId, number>(heatIds.map((id, i) => [id, i]));
  let heatLensOn = false;
  // jackKey → the card whose span chip its heat line reads (jackHeatText below).
  const heatCardByKey = new Map<string, MeterCardId>();
  let lastHeatMs = -Infinity;

  /** Builds one jack, wires it to `deps.patch` and registers it for
   *  refreshPatchView's row-level glow/dim. `host` is where the element mounts;
   *  `feedEl` is the row/lane that glows, the same unless the jack sits in a
   *  sub-wrapper (createHitsHistory's vizWrap). `heatCard` is the card whose
   *  span chip a signal jack's heat reads; it defaults to the signal's
   *  `monitor` card, then Sound. */
  function mountJack(choice: DriveSourceChoice, host: HTMLElement, feedEl: HTMLElement, heatCard?: MeterCardId): JackHandle {
    const jack = createJack(
      driveSourceColor(choice),
      () => deps.patch.onJackClick(choice),
      (on) => deps.patch.onJackHover(choice, on),
    );
    deps.patch.registerJack(jack.el, choice);
    host.appendChild(jack.el);
    jackRegistry.push({ choice, jack, feedEl });
    jackElementsMap.set(jackKey(choice), jack.el);
    // A signal jack joins the heat lens, its monitor's strip and Heat history;
    // a beat-grid or line jack has no signal reading.
    if (typeof choice === "string") {
      const card = heatCard ?? SIGNALS[choice].monitor?.card ?? "sound";
      jack.el.classList.add("vc-heat-jack");
      const folded = (): boolean => meterCards[card].fold?.isFolded() ?? false;
      heatJacks.push({
        id: choice, card, el: jack.el, feedEl, row: heatRowFor(feedEl), folded, idx: heatIdx.get(choice)!, color: "", glow: -1,
      });
      heatCardByKey.set(jackKey(choice), card);
    }
    return jack;
  }

  // Set only by the returned setRaw (deviceMenu.ts's merged RAW chip).
  let showRaw = false;

  // Each card's span chip (historySpan.ts), keyed by foldId. Traces read it at
  // every draw, so a click redraws from what's recorded; `onChange` only
  // refreshes the rows' "s" readouts.
  const cardSpan = (cardId: string): TraceSpan => ({ sec: () => getHistorySpan(cardId), max: HISTORY_SPAN_MAX });
  function createSpanChip(cardId: string, onChange: () => void): HTMLButtonElement {
    const chip = createChipButton(
      formatHistorySpan(getHistorySpan(cardId)),
      `How much time this card's traces show — click for ${HISTORY_SPANS.map(formatHistorySpan).join(", ")}. They keep recording while the panel is closed.`,
      () => {
        chip.textContent = formatHistorySpan(cycleHistorySpan(cardId));
        onChange();
      },
    );
    return chip;
  }
  const soundSpan = cardSpan("sound");
  const stemsSpan = cardSpan("stems");
  const hitsSpan = cardSpan("hits");
  const beatSpan = cardSpan("beat");
  const songSpan = cardSpan("song");

  // Each line row's heat floor, keyed by the row its jack feeds:
  // addHeatMonitorStrip draws the row's heat there instead of under the row.
  const heatFloorHosts = new Map<HTMLElement, HTMLElement>();
  function lineRow(spec: Omit<Parameters<typeof createLineRow>[0], "mountJack">): LineRow {
    const row = createLineRow({ ...spec, mountJack });
    heatFloorHosts.set(row.el, row.floor);
    return row;
  }
  const bandLabel = (id: SignalId) => driveSourceLabel(id).replace(/ level$/, "");

  // ---- Sound: spectrum, Level, Bass, Mid, Treble, then Bands ----
  // The thin spectrum is fed by deviceMenu.ts.
  const soundSpectrum = createSpectrumStrip({
    plotHeightPx: SOUND_SPECTRUM_HEIGHT_CSS_PX,
    onBandClick: (n) => {
      toggleBandPick(n);
      refreshBandRows();
    },
  });
  nameGraph(soundSpectrum.el, "Live spectrum, bass on the left");
  soundSpectrum.el.style.marginBottom = "4px";
  const soundLevel = lineRow({
    label: driveSourceLabel("anim.energy"),
    description:
      "The sound after auto-gain, which keeps it mid-range whether the room is quiet or loud. This is what the scene reacts to. The shaded floor shows when the silence gate was closing: darker, fewer hits get through.",
    choice: "anim.energy",
    span: soundSpan,
    gateFloor: true,
  });
  const soundBand = (choice: SignalId): LineRow =>
    lineRow({ label: bandLabel(choice), description: capitalise(driveSourceDescription(choice)), choice, span: soundSpan });
  const soundBass = soundBand("anim.low");
  const soundMid = soundBand("anim.mid");
  const soundTreble = soundBand("anim.high");
  const bandsLabel = document.createElement("div");
  bandsLabel.style.cssText = bandsLabelStyle;
  bandsLabel.textContent = "Bands · click the spectrum to pick one";
  const bandsBlock = document.createElement("div");
  // Labels start on the nominal ladder; the text tick rewrites them from the
  // live edge table, which only exists once there's an AudioContext.
  const bandRows: { row: LineRow; id: BandSignalId; n: number; shown: boolean; display: string }[] = BAND_SIGNALS.map((id, n) => {
    const row = lineRow({
      label: formatHz(bandCenterHz(deps.getBandEdgesHz(), n)),
      description: capitalise(driveSourceDescription(id)),
      choice: id,
      span: soundSpan,
    });
    // The row's own display is in its inline style, so showing it again
    // restores that rather than clearing to "".
    const display = row.el.style.display;
    row.el.style.display = "none";
    bandsBlock.append(row.el);
    return { row, id, n, shown: false, display };
  });
  const bandRowIds: ReadonlySet<SignalId> = new Set(BAND_SIGNALS);
  // Single-series rows, recorded and drawn the same way every tick.
  const soundRows: readonly { row: LineRow; id: SignalId }[] = [
    { row: soundBass, id: "anim.low" },
    { row: soundMid, id: "anim.mid" },
    { row: soundTreble, id: "anim.high" },
  ];
  const soundCard = createCard({
    title: "Sound",
    accent: INPUT_GREEN,
    foldId: "sound",
    right: createSpanChip("sound", () => {}),
  });
  soundCard.body.append(soundSpectrum.el, soundLevel.el, soundBass.el, soundMid.el, soundTreble.el, bandsLabel, bandsBlock);

  // ---- Stems: Lead, Hats, Kick band ----
  const stemLead = lineRow({
    label: driveSourceLabel("anim.lead"),
    description: capitalise(driveSourceDescription("anim.lead")),
    choice: "anim.lead",
    span: stemsSpan,
  });
  const stemHats = lineRow({
    label: driveSourceLabel("anim.hats"),
    description: capitalise(driveSourceDescription("anim.hats")),
    choice: "anim.hats",
    span: stemsSpan,
  });
  // Its label is the picked band's Hz, written on the text tick.
  const stemKick = lineRow({
    label: "--",
    sub: "kick",
    description: capitalise(driveSourceDescription("anim.kickBand")),
    choice: "anim.kickBand",
    span: stemsSpan,
  });
  // The Kick band comes from the spectrum bands, not the stem split, so it
  // reads whether or not the split is measured.
  const stemRows: readonly { row: LineRow; id: SignalId; needsSplit: boolean }[] = [
    { row: stemLead, id: "anim.lead", needsSplit: true },
    { row: stemHats, id: "anim.hats", needsSplit: true },
    { row: stemKick, id: "anim.kickBand", needsSplit: false },
  ];
  const stemsCard = createCard({
    title: "Stems",
    accent: STEM_LEAD,
    foldId: "stems",
    right: createSpanChip("stems", () => {}),
  });
  stemsCard.body.append(stemLead.el, stemHats.el, stemKick.el);
  // Preallocated: update() records every tick.
  const soundLevelVals: (number | null)[] = [null, null];
  const oneVal: (number | null)[] = [null];

  // ---- Hits ----
  const hitsHistory = createHitsHistory(deps.getSilenceGate, mountJack, hitsSpan);
  const hitsCard = createCard({
    title: "Hits",
    accent: NEUTRAL_ACCENT,
    foldId: "hits",
    right: createSpanChip("hits", () => hitsHistory.refreshSpan()),
  });
  hitsCard.body.append(hitsHistory.el);

  // ---- Beat ----
  const tempo = createTempoBlock(NEUTRAL_ACCENT);
  // Mounts here, not on a row of its own: the BPM is anim.tempo's number
  // (signals.ts's MeterRowId).
  mountJack("anim.tempo", tempo.jackHost, tempo.el);
  const lock = createMeterRow({
    label: "Lock",
    accent: NEUTRAL_ACCENT,
    unit: "%",
    description:
      "How sure the tracker is about the beat: high while hits keep landing where it expects them, low on loose or beatless music. The BPM beside it (digits and dot) brightens with the same reading.",
  });
  lock.el.style.flex = "1";
  lock.el.style.minWidth = "0";
  mountJack("anim.tempoLock", lock.right, lock.el);
  const tempoWelded = document.createElement("div");
  tempoWelded.style.cssText = weldedRowStyle;
  tempoWelded.append(lock.el, tempo.el);

  const barRuler = createBarRuler();
  mountJack("anim.metronome", barRuler.right, barRuler.el);
  mountJack("anim.metronomeBar", barRuler.right, barRuler.el);

  // The two beat-shape drives off the metronome (a smooth swing, not a hit),
  // on one shared row like the Hits lanes.
  const wave = createMeterRow({
    label: "Wave",
    accent: NEUTRAL_ACCENT,
    unit: "s",
    description:
      "Beat wave (red) and bar wave (blue): a smooth swing that peaks on every beat, or once a bar. It fades out with the metronome rather than the live tempo lock. Plug either into a setting to make it sway in time.",
    hintColors: { red: BEAT_COLOR, blue: BEAT_GRID_COLOR },
  });
  const waveTrace = createTraceStrip(
    [
      { color: BEAT_COLOR, width: 1.5 },
      { color: BEAT_GRID_COLOR, width: 1.5 },
    ],
    BEAT_TRACE_HEIGHT_CSS_PX,
    { label: "History of the beat wave and the bar wave", span: beatSpan },
  );
  wave.el.children[1].replaceWith(waveTrace.canvas);
  wave.setReadout(String(beatSpan.sec()));
  mountJack("anim.beatWave", wave.right, wave.el);
  mountJack("anim.barWave", wave.right, wave.el);

  // See tapStatusStyle. Built by hand: it taps on pointerdown, not click, and
  // its hover hint is keyHints.ts's (data-key), not a title.
  const tapStatus = document.createElement("span");
  tapStatus.style.cssText = tapStatusStyle;
  const tapChip = document.createElement("button");
  tapChip.type = "button";
  tapChip.textContent = "Tap";
  tapChip.style.cssText = chipBtnStyle;
  tapChip.dataset.key = "tap";
  tapChip.dataset.keycap = "Ctrl";
  tapChip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    // No focus move: a tap shouldn't take the keyboard's place in the panel.
    e.preventDefault();
    deps.onTap(e.timeStamp);
  });
  const tapRight = document.createElement("div");
  tapRight.style.cssText = tapRightStyle;
  tapRight.append(
    tapStatus,
    tapChip,
    createSpanChip("beat", () => wave.setReadout(String(beatSpan.sec()))),
  );
  let shownTapStatus = "";
  const beatCard = createCard({ title: "Beat", accent: NEUTRAL_ACCENT, foldId: "beat", right: tapRight });
  beatCard.body.append(tempoWelded, spacer(), barRuler.el, spacer(), wave.el);

  // ---- Song ----
  const section = createSectionTrace(songSpan);
  mountJack("anim.sectionIntensity", section.right, section.el);
  mountJack("anim.dropOnset", section.right, section.el);
  // Every MUSIC_DIALS entry, so a new dial gets a cell by construction.
  const dialCells = MUSIC_DIALS.map((dial) => ({ dial, cell: createDialCell(dial) }));
  const dialStrip = document.createElement("div");
  dialStrip.style.cssText = dialStripStyle;
  for (const { dial, cell } of dialCells) {
    mountJack(dialSignalId(dial), cell.right, cell.el);
    dialStrip.appendChild(cell.el);
  }
  // No row reads out its span, so the chip is the only label.
  const songCard = createCard({
    title: "Song",
    accent: AUTO_SKY,
    foldId: "song",
    right: createSpanChip("song", () => {}),
  });
  songCard.body.append(section.el, spacer(), dialStrip);

  // The Heat history card (heat.ts): a strip per wired setting and per signal
  // jack, one cell per second over this card's span. Folded by default.
  const heatHistoryCard = createCard({
    title: "Heat history",
    accent: NEUTRAL_ACCENT,
    foldId: "heat",
    defaultFolded: true,
    right: createSpanChip("heat", () => refreshHeatHistory(performance.now() / 1000)),
  });
  const heatNote = document.createElement("div");
  heatNote.className = "vc-heat-hist-note";
  heatNote.textContent = "How much each one moved, second by second. Colder = barely moves, hotter = big moves on loud music.";
  const heatSettingsGrid = document.createElement("div");
  heatSettingsGrid.className = "vc-heat-hist";
  const heatSignalsGrid = document.createElement("div");
  heatSignalsGrid.className = "vc-heat-hist";
  const heatAxis = document.createElement("div");
  heatAxis.className = "vc-heat-hist-axis";
  const heatAxisLeft = document.createElement("span");
  const heatAxisNow = document.createElement("span");
  heatAxisNow.textContent = "now";
  heatAxis.append(heatAxisLeft, heatAxisNow);
  heatHistoryCard.body.append(heatNote, heatSettingsGrid, heatSignalsGrid, heatAxis);

  function heatHistGroup(grid: HTMLElement, text: string): void {
    const group = document.createElement("div");
    group.className = "vc-heat-hist-group";
    group.textContent = text;
    grid.append(group);
  }
  function heatHistRow(grid: HTMLElement, label: string): { name: HTMLElement; strip: HTMLElement } {
    const name = document.createElement("span");
    name.className = "vc-heat-hist-label";
    name.textContent = label;
    name.title = label;
    const strip = document.createElement("div");
    strip.className = "vc-heat-hist-strip";
    grid.append(name, strip);
    return { name, strip };
  }

  // The Signals group is built once; every jack is mounted by now.
  const heatSignalStrips: { idx: number; el: HTMLElement; bg: string }[] = [];
  // A band's two cells, hidden with its row (refreshBandRows).
  const bandHeatCells = new Map<SignalId, { name: HTMLElement; strip: HTMLElement }>();
  const heatCardTitles: Record<MeterCardId, string> = {
    sound: soundCard.title.textContent ?? "",
    stems: stemsCard.title.textContent ?? "",
    hits: hitsCard.title.textContent ?? "",
    beat: beatCard.title.textContent ?? "",
    song: songCard.title.textContent ?? "",
  };
  for (const cardId of ["sound", "stems", "hits", "beat", "song"] as const) {
    const seen = new Set<SignalId>();
    const jacks = heatJacks.filter((j) => {
      if (j.card !== cardId || seen.has(j.id)) return false;
      seen.add(j.id);
      return true;
    });
    if (!jacks.length) continue;
    heatHistGroup(heatSignalsGrid, heatCardTitles[cardId]);
    for (const j of jacks) {
      const cells = heatHistRow(heatSignalsGrid, driveSourceLabel(j.id));
      heatSignalStrips.push({ idx: j.idx, el: cells.strip, bg: "" });
      if (bandRowIds.has(j.id)) bandHeatCells.set(j.id, cells);
    }
  }

  // A line row's heat is the floor of its own trace lane (heatFloorHosts).
  // Every other monitor's heat strips sit under the row a signal jack feeds,
  // one per signal in mount order, led by a dot in the signal's colour. Above
  // the row's hint, so under its trace and legend. The Tempo block is a narrow
  // box welded beside Lock, so its strips join Lock's.
  const heatMonitorStrips: { idx: number; card: MeterCardId; folded: () => boolean; el: HTMLElement; bg: string }[] = [];
  const heatMonitorHosts = new Map<HTMLElement, { host: HTMLElement; ids: Set<SignalId> }>();
  function addHeatMonitorStrip(j: HeatJack, rowEl: HTMLElement): void {
    const floor = heatFloorHosts.get(rowEl);
    let m = heatMonitorHosts.get(rowEl);
    if (!m) {
      const host = floor ?? document.createElement("div");
      if (!floor) {
        host.className = "vc-heat-monitor";
        rowEl.insertBefore(host, rowEl.querySelector(":scope > .vc-hint"));
      }
      m = { host, ids: new Set() };
      heatMonitorHosts.set(rowEl, m);
    }
    if (m.ids.has(j.id)) return;
    m.ids.add(j.id);
    const strip = document.createElement("div");
    if (floor) {
      strip.className = "vc-heat-floor";
      m.host.append(strip);
    } else {
      const line = document.createElement("div");
      line.className = "vc-heat-monitor-line";
      line.style.setProperty("--c", driveSourceColor(j.id));
      strip.className = "vc-heat-strip";
      line.append(strip);
      m.host.append(line);
    }
    heatMonitorStrips.push({ idx: j.idx, card: j.card, folded: j.folded, el: strip, bg: "" });
  }
  for (const j of heatJacks) addHeatMonitorStrip(j, j.feedEl === tempo.el ? lock.el : j.feedEl);

  /** Repaints a heat strip over the last `span` seconds; writes style only on change. */
  function paintHeatStrip(s: { el: HTMLElement; bg: string }, track: HeatTrack, span: number, nowSec: number): void {
    const bg = heatStripBackground(heatHistory(track, span, nowSec, HEAT_HISTORY_CELLS));
    if (bg !== s.bg) {
      s.bg = bg;
      s.el.style.background = bg;
    }
  }

  // The Settings group is rebuilt only when the wired labels change; their
  // tracks are re-read every refresh.
  let heatSettingsKey: string | null = null;
  let heatSettingStrips: { track: HeatTrack; el: HTMLElement; bg: string }[] = [];
  function refreshHeatSettings(): void {
    const rows = deps.heatSettings();
    const key = rows.map((r) => r.label).join("\n");
    if (key !== heatSettingsKey) {
      heatSettingsKey = key;
      heatSettingsGrid.replaceChildren();
      heatSettingStrips = [];
      heatHistGroup(heatSettingsGrid, "Settings");
      if (!rows.length) {
        const none = document.createElement("div");
        none.className = "vc-heat-hist-note";
        none.textContent = "No wired settings in this scene.";
        heatSettingsGrid.append(none);
      }
      for (const r of rows) heatSettingStrips.push({ track: r.track, el: heatHistRow(heatSettingsGrid, r.label).strip, bg: "" });
    }
    rows.forEach((r, i) => {
      heatSettingStrips[i]!.track = r.track;
    });
  }

  function refreshHeatHistory(nowSec: number): void {
    const span = getHistorySpan("heat");
    heatAxisLeft.textContent = "−" + formatHistorySpan(span);
    refreshHeatSettings();
    for (const s of heatSettingStrips) paintHeatStrip(s, s.track, span, nowSec);
    for (const s of heatSignalStrips) paintHeatStrip(s, heatTracks[s.idx]!, span, nowSec);
  }

  // Per the file header. Sound leads: it's the raw picture of the sound, the
  // first thing to check when the visuals seem off.
  root.append(soundCard.el, stemsCard.el, hitsCard.el, beatCard.el, songCard.el, heatHistoryCard.el);

  // The last drawn tick (update() with onScreen true).
  let lastMs: number | null = null;
  let lastTextMs = 0;
  // When anim.metronomeBeat last fired: recorded on every tick, flashed on the
  // next drawn one (update()).
  let beatAtMs = -Infinity;

  // signals.ts's monitor anchors, populated on demand as a SignalSpec points at
  // a card/row (see MeterCardId/MeterRowId). section.el, tempo.el and lock.el
  // are the flash/scroll targets, not their welded wrapper, so a jump
  // highlights only that half.
  const cardElements: Record<MeterCardId, HTMLElement> = {
    sound: soundCard.el,
    stems: stemsCard.el,
    hits: hitsCard.el,
    beat: beatCard.el,
    song: songCard.el,
  };
  const rowElements = new Map<MeterRowId, HTMLElement>([
    ["section", section.el],
    ["tempo", tempo.el],
    ["hits", hitsHistory.el],
    ...dialCells.map(({ dial, cell }): [MeterRowId, HTMLElement] => [dialSignalId(dial), cell.el]),
    ["wave", wave.el],
    ["lock", lock.el],
    ["bar", barRuler.el],
    ["energy", soundLevel.el],
    ["low", soundBass.el],
    ["mid", soundMid.el],
    ["high", soundTreble.el],
    ["kick", stemKick.el],
    ["lead", stemLead.el],
    ["hats", stemHats.el],
    ...bandRows.map(({ id, row }): [MeterRowId, HTMLElement] => [id, row.el]),
  ]);

  // Reused by every marks refresh: the Kick band's mark, then one per shown
  // band row, drawn in that order so the Kick mark wins a shared bar.
  const markPool = Array.from({ length: BAND_SIGNALS.length + 1 }, () => ({ band: 0, color: "" }));
  const marks: { band: number; color: string }[] = [];
  let markedKickBand = -1;
  function refreshMarks(kickBand: number): void {
    markedKickBand = kickBand;
    marks.length = 0;
    for (const b of bandRows) {
      if (!b.shown) continue;
      const m = markPool[marks.length]!;
      m.band = b.n;
      m.color = driveSourceColor(b.id);
      marks.push(m);
    }
    if (kickBand >= 0) {
      const m = markPool[marks.length]!;
      m.band = kickBand;
      m.color = driveSourceColor("anim.kickBand");
      marks.push(m);
    }
    soundSpectrum.setMarks(marks);
    soundSpectrum.redraw();
  }
  function refreshBandRows(): void {
    for (const b of bandRows) {
      const shown = isBandPicked(b.n) || deps.patch.usage(b.id) > 0;
      if (shown === b.shown) continue;
      b.shown = shown;
      b.row.el.style.display = shown ? b.display : "none";
      const display = shown ? "" : "none";
      const cells = bandHeatCells.get(b.id);
      if (cells) {
        cells.name.style.display = display;
        cells.strip.style.display = display;
      }
    }
    refreshMarks(markedKickBand);
  }
  for (const b of bandRows) {
    const cells = bandHeatCells.get(b.id);
    if (cells) {
      cells.name.style.display = "none";
      cells.strip.style.display = "none";
    }
  }
  refreshBandRows();

  // Each card's fold, for update()'s heat block.
  const meterCards: Record<MeterCardId, { fold?: { isFolded(): boolean } }> = {
    sound: soundCard,
    stems: stemsCard,
    hits: hitsCard,
    beat: beatCard,
    song: songCard,
  };
  // Whether each card is in view (onScreen.ts): one scrolled out of its column
  // or under a closed panel skips draws and DOM writes like a folded one; its
  // traces keep recording.
  const soundOnScreen = watchOnScreen(soundCard.el);
  const stemsOnScreen = watchOnScreen(stemsCard.el);
  const heatHistoryOnScreen = watchOnScreen(heatHistoryCard.el);
  const hitsOnScreen = watchOnScreen(hitsCard.el);
  const beatOnScreen = watchOnScreen(beatCard.el);
  const songOnScreen = watchOnScreen(songCard.el);

  return {
    el: root,
    update(frame, anim, rawBands, rateScale, beatDiag, gate, onScreen): void {
      const nowMs = performance.now();
      const raw = showRaw;
      // Smoothing at 0 (smoothingRateScale is Infinity) bypasses the BPM
      // settle like `raw`, so RAW has nothing left to differ by (file header).
      const smoothingOff = !Number.isFinite(rateScale);

      // ---- Every trace records, every tick ----
      // On screen or not, so a card opens on what it missed. Recording is a few
      // compares per series; the drawing and DOM writes are the cost.
      hitsHistory.record(frame, anim, beatDiag, nowMs);
      // Via SIGNALS[id].read(), not a copied formula, so this trace and a
      // setting driven by the signal agree.
      waveTrace.push(
        frame && anim
          ? [SIGNALS["anim.beatWave"].read(frame, anim), SIGNALS["anim.barWave"].read(frame, anim)]
          : [null, null],
        nowMs,
      );
      section.push(anim ? [raw ? anim.raw.sectionIntensity : anim.sectionIntensity, anim.dropOnset ? 1 : 0] : [null, null], nowMs);
      if (frame && anim) {
        const recordSec = nowMs / 1000;
        const stemsOff = !deps.stemsMeasured();
        // Via SIGNALS[id].read() like the Wave trace, so a line row and a
        // wire driven by the signal agree. A stem not measured this tick is a
        // gap, as in its heat track.
        soundLevelVals[0] = SIGNALS["anim.energy"].read(frame, anim);
        soundLevelVals[1] = gate ? 1 - gate.dimmer : null;
        for (const { row, id } of soundRows) {
          oneVal[0] = SIGNALS[id].read(frame, anim);
          row.push(oneVal, nowMs);
        }
        // Hidden rows too, so a row opens on what it missed.
        for (const { row, id } of bandRows) {
          oneVal[0] = SIGNALS[id].read(frame, anim);
          row.push(oneVal, nowMs);
        }
        for (const { row, id, needsSplit } of stemRows) {
          oneVal[0] = stemsOff && needsSplit ? null : SIGNALS[id].read(frame, anim);
          row.push(oneVal, nowMs);
        }
        for (let i = 0; i < heatIds.length; i++) {
          const x = SIGNALS[heatIds[i]!].read(frame, anim);
          heatLive[i] = x;
          if (stemsOff && heatIsStem[i]) continue;
          heatTracks[i]!.push(x, frame.level, recordSec);
        }
      } else {
        soundLevelVals.fill(null);
        oneVal[0] = null;
        for (const { row } of soundRows) row.push(oneVal, nowMs);
        for (const { row } of bandRows) row.push(oneVal, nowMs);
        for (const { row } of stemRows) row.push(oneVal, nowMs);
      }
      soundLevel.push(soundLevelVals, nowMs);
      if (anim?.metronomeBeat) beatAtMs = nowMs;
      if (!onScreen) return;

      // ---- Drawn ticks only from here ----
      // onScreen false ticks aren't drawn, so peak fall and text cadence count
      // from the last drawn tick, and a beat on a tick between still flashes
      // now. An edge older than CARRY_MS (panel closed, rAF paused) is stale.
      const sinceDrawMs = lastMs === null ? 1000 / 60 : nowMs - lastMs;
      lastMs = nowMs;
      const dtSec = Math.max(1e-4, sinceDrawMs / 1000);
      const edgeWindowMs = Math.min(sinceDrawMs, CARRY_MS);
      const beat = nowMs - beatAtMs < edgeWindowMs;
      const text = nowMs - lastTextMs >= TEXT_REFRESH_MS;
      if (text) lastTextMs = nowMs;

      // Heat: jack and monitor-row colours, monitor strips and Heat history at
      // most every HEAT_REFRESH_MS; the lens glow every tick it's on (written
      // only on a level change). Unfolded cards only.
      const heatSec = nowMs / 1000;
      if (nowMs - lastHeatMs >= HEAT_REFRESH_MS) {
        lastHeatMs = nowMs;
        for (const row of heatRows) row.hottest = -1;
        for (const j of heatJacks) {
          if (j.folded()) continue;
          const r = heatTracks[j.idx]!.read(getHistorySpan(j.card), heatSec);
          const heat = r ? r.heat : 0;
          const color = heatToColor(heat);
          if (color !== j.color) {
            j.color = color;
            j.el.style.setProperty("--vc-heat", color);
          }
          if (heat > j.row.hottest) j.row.hottest = heat;
        }
        for (const row of heatRows) {
          if (row.hottest < 0) continue;
          const color = heatToColor(row.hottest);
          if (color !== row.color) {
            row.color = color;
            row.el.style.setProperty("--vc-heat", color);
          }
        }
        for (const s of heatMonitorStrips) {
          if (s.folded()) continue;
          paintHeatStrip(s, heatTracks[s.idx]!, getHistorySpan(s.card), heatSec);
        }
        if (!heatHistoryCard.fold?.isFolded() && heatHistoryOnScreen()) refreshHeatHistory(heatSec);
      }
      if (heatLensOn) {
        for (const row of heatRows) row.brightest = -1;
        for (const j of heatJacks) {
          if (j.folded()) continue;
          const glow = heatGlowLevel(heatLive[j.idx]!);
          if (glow !== j.glow) {
            j.glow = glow;
            j.el.style.setProperty("--vc-heat-glow", String(glow));
          }
          if (glow > j.row.brightest) j.row.brightest = glow;
        }
        for (const row of heatRows) {
          if (row.brightest < 0 || row.brightest === row.glow) continue;
          row.glow = row.brightest;
          row.el.style.setProperty("--vc-heat-glow", String(row.glow));
        }
      }

      if (text && anim && anim.kickBandIndex !== markedKickBand) refreshMarks(anim.kickBandIndex);

      // ---- Sound: Level, Bass, Mid, Treble, band rows ----
      // Level's raw counterpart is rawBands (local-only). The thin
      // spectrum is drawn by deviceMenu.ts's feed, not here.
      if (!soundCard.fold?.isFolded() && soundOnScreen()) {
        soundLevel.draw();
        for (const { row } of soundRows) row.draw();
        for (const b of bandRows) if (b.shown) b.row.draw();
        if (text) {
          const levelVal = raw ? (rawBands ? meanOf(rawBands) : null) : frame ? frame.energy : null;
          soundLevel.setReadout(levelVal === null ? "--" : pct(levelVal), levelVal === null ? IDLE : {});
          for (const { row, id } of soundRows) {
            const v = frame && anim ? SIGNALS[id].read(frame, anim) : null;
            row.setReadout(v === null ? "--" : pct(v), v === null ? IDLE : {});
          }
          for (const b of bandRows) {
            if (!b.shown) continue;
            const v = frame && anim ? SIGNALS[b.id].read(frame, anim) : null;
            b.row.setReadout(v === null ? "--" : pct(v), v === null ? IDLE : {});
            b.row.setLabel(formatHz(bandCenterHz(deps.getBandEdgesHz(), b.n)));
          }
        }
      }

      // ---- Stems: Lead, Hats, Kick band ----
      if (!stemsCard.fold?.isFolded() && stemsOnScreen()) {
        for (const { row } of stemRows) row.draw();
        if (text) {
          const measured = deps.stemsMeasured();
          for (const { row, id, needsSplit } of stemRows) {
            const v = frame && anim && (measured || !needsSplit) ? SIGNALS[id].read(frame, anim) : null;
            row.setReadout(v === null ? "--" : pct(v), v === null ? IDLE : {});
          }
          stemKick.setLabel(anim ? formatHz(bandCenterHz(deps.getBandEdgesHz(), anim.kickBandIndex)) : "--");
        }
      }

      // ---- Hits ----
      if (!hitsCard.fold?.isFolded() && hitsOnScreen()) {
        hitsHistory.render(frame, anim, beatDiag, nowMs, text);
      }

      // ---- Beat ----
      // The Tap chip's count sits in the header, so it updates folded too.
      if (text) {
        const run = getTapRun(nowMs);
        const status = run && run.more > 0 ? `${run.more} more ${run.more === 1 ? "tap" : "taps"}` : "";
        if (status !== shownTapStatus) {
          shownTapStatus = status;
          tapStatus.textContent = status;
        }
      }
      if (!beatCard.fold?.isFolded() && beatOnScreen()) {
        // The dot flashes on the metronome's tick, not a raw hit; dot and digits
        // share tempoSettle.ts's reading.
        tempo.update(anim?.tempoLock ?? 0, beat);
        if (text) {
          // RAW / Smoothing Off show the unsettled raw estimate.
          tempo.setBpm(raw || smoothingOff ? (frame?.bpm ?? 0) : (anim?.metronomeBpm ?? 0));
          tempo.setTapped(!raw && !smoothingOff && !!anim?.tapGuided);
        }
        // Via SIGNALS[id].read(), so this row and a driven setting agree.
        if (frame && anim) {
          lock.setValue(SIGNALS["anim.tempoLock"].read(frame, anim), dtSec);
        } else {
          lock.setValue(null, dtSec);
        }
        if (text) {
          lock.setReadout(anim ? pct(anim.tempoLock) : "--", anim ? {} : IDLE);
        }
        barRuler.draw(anim, text);
        waveTrace.draw();
      }

      // ---- Song ----
      if (!songCard.fold?.isFolded() && songOnScreen()) {
        if (text) {
          const v = anim ? (raw ? anim.raw.sectionIntensity : anim.sectionIntensity) : null;
          section.setReadout(v === null ? "--" : pct(v), v === null ? IDLE : {});
        }
        section.draw();
        for (const { dial, cell } of dialCells) cell.setValue(anim ? (raw ? anim.raw.profile[dial] : anim.profile[dial]) : null);
      }
    },
    setRaw(on): void {
      showRaw = on;
      soundSpectrum.setShowRaw(on);
    },
    revealRow(card, row): void {
      const cardEl = cardElements[card];
      if (cardEl.classList.contains("vc-folded")) cardEl.querySelector<HTMLButtonElement>(".vc-fold")?.click();
      const rowEl = rowElements.get(row);
      if (!rowEl) return;
      rowEl.scrollIntoView({ block: "nearest" });
      flashRow(rowEl);
    },
    refreshPatchView(): void {
      refreshBandRows();
      const previewOn = deps.patch.previewIsActive();
      // Grouped by feedEl so a row shared by several jacks is written once.
      const feedGroups = new Map<HTMLElement, DriveSourceChoice[]>();
      for (const { choice, jack, feedEl } of jackRegistry) {
        jack.setFilled(deps.patch.isShown(choice));
        jack.setPressed(deps.patch.isPinned(choice));
        jack.setUses(deps.patch.usage(choice));
        const { aria, title } = deps.patch.describe(choice);
        jack.setLabel(aria, title);
        let list = feedGroups.get(feedEl);
        if (!list) {
          list = [];
          feedGroups.set(feedEl, list);
        }
        list.push(choice);
      }
      // Glow priority for a shared row: an active preview wins (soft) over a
      // pinned feed (full, or faint when a different preview is live), which
      // wins over the scene-mix fallback (isSceneSource; see jack.ts's
      // setRowFed).
      for (const [rowEl, choices] of feedGroups) {
        // Mute-aware pair: a muted source keeps its jack filled but stops
        // lighting its row.
        const previewChoice = previewOn ? choices.find((c) => deps.patch.isPreviewActive(c)) : undefined;
        const pinnedChoice = choices.find((c) => deps.patch.isPinnedActive(c));
        const sceneSoftChoice =
          previewChoice || pinnedChoice ? undefined : choices.find((c) => deps.patch.isSceneSource(c));
        if (previewChoice) {
          setRowFed(rowEl, "soft", driveSourceColor(previewChoice));
        } else if (pinnedChoice) {
          setRowFed(rowEl, previewOn ? "faint" : "full", driveSourceColor(pinnedChoice));
        } else if (sceneSoftChoice) {
          setRowFed(rowEl, "soft", driveSourceColor(sceneSoftChoice));
        } else {
          setRowFed(rowEl, "none", "");
        }
      }
      // The hits lanes' own glow, on top of the row's state above. No scene-mix
      // treatment (a hit-onset in `sceneSources` is rare). Grouped by glowEl:
      // the Beat lane has two choices (feature.onset, feature.flux) sharing one
      // glow, so a later weaker kind mustn't overwrite a stronger one. Same
      // priority as the row pass: soft > full/faint > none.
      const LANE_GLOW_RANK: Record<"soft" | "full" | "faint" | "none", number> = {
        soft: 3,
        full: 2,
        faint: 1,
        none: 0,
      };
      const laneGlowKind = new Map<HTMLElement, "soft" | "full" | "faint" | "none">();
      for (const { choice, glowEl } of hitsHistory.laneMounts) {
        const kind = deps.patch.isPreviewActive(choice)
          ? "soft"
          : deps.patch.isPinnedActive(choice)
            ? previewOn
              ? "faint"
              : "full"
            : "none";
        const current = laneGlowKind.get(glowEl);
        if (!current || LANE_GLOW_RANK[kind] > LANE_GLOW_RANK[current]) laneGlowKind.set(glowEl, kind);
      }
      for (const [glowEl, kind] of laneGlowKind) {
        glowEl.classList.toggle("on", kind !== "none");
        glowEl.style.opacity = kind === "faint" ? "0.45" : kind === "soft" ? "0.75" : "";
      }
    },
    setHeatLens(on) {
      heatLensOn = on;
      for (const j of heatJacks) j.glow = -1;
      for (const row of heatRows) row.glow = -1;
    },
    jackElements(): ReadonlyMap<string, HTMLElement> {
      return jackElementsMap;
    },
    jackHeatText(choice) {
      if (typeof choice !== "string") return null;
      const card = heatCardByKey.get(jackKey(choice));
      if (!card) return null;
      const span = getHistorySpan(card);
      return heatText(heatById.get(choice)!.read(span, performance.now() / 1000), span);
    },
    soundSpectrum,
    soundSpectrumShown: () => !soundCard.fold?.isFolded() && soundOnScreen(),
    stemRowsOnScreen: () => !stemsCard.fold?.isFolded() && stemsOnScreen(),
  };
}
