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
import type { SongMarks } from "../audio/song/songLayer.ts";
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
import {
  AUTO_SKY,
  FONT_LABEL,
  FONT_MONO,
  HIT_TRACK_FLOOR_PX,
  HOT_RED,
  INPUT_GREEN,
  STEM_LEAD,
  withAlpha,
} from "./controlsTheme.ts";
import {
  chipBtnStyle,
  createCard,
  createChipButton,
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
 *    Bass, Mid and Treble. Under them a Bands block of line rows for single
 *    bands: a row per band (signals.ts's BAND_SIGNALS, all mounted
 *    hidden at build) that shows while it's picked by a click on the
 *    spectrum (bandPicks.ts) or wired in this scene, so a wired band never
 *    hides. The spectrum marks every shown band's bar in that row's colour. Then Level (the only way to see features.ts's
 *    adaptive floor/peak doing its job, since its whole point is to make that
 *    invisible downstream). Under Level's line a band along the bottom is shaded
 *    per column by how closed the silence gate was (1 - Dimmer), not by a
 *    line at the gate's marks: those sit on Input level's scale and Level is
 *    auto-gained, so a mark line would lie. No gate reading (the synthetic
 *    feed) draws no shade. Last, Hits: a drum roll of touching tracks, one
 *    per HIT_TRACKS entry (createHitsRoll), each a line row's columns around
 *    a lane of notes. Any draws one for every fired, too-soon or quiet-room
 *    reading (onsetDiag.ts's OnsetVerdict), so a tuning session can see *why*
 *    a hit did or didn't count, brighter the more it stood out
 *    (hitStrength.ts's `standout`). Kick, Clap, Hats and Chord are the song
 *    layer's instruments (AnimFrame.song): a note per edge, brighter the
 *    higher its level stood, over that level as a filled floor, with a
 *    dashed line where the trigger fires wherever the device knows it (the
 *    one that hears the music, EngineSource.marks via deps.getSongMarks);
 *    each has two jacks, its hits and its level. The instrument tracks carry
 *    a faint guide wherever Any fired, every track a faint line on each
 *    metronome beat, and the Surge track Onset surge's trace instead of
 *    notes. Its readouts count hits over the card's span.
 *  - Stems: Lead (stemReaders.ts) as a line row. It is measured only on the
 *    device with the mic and draws a gap where it wasn't. app.ts runs the
 *    split while this card is unfolded and on screen (stemRowsOnScreen).
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
 * Every time-axis trace (the Sound and Stems rows, the Hits tracks, Wave,
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
 * Treble and every band row, Stems' Lead; createLineRow mounts them) and one
 * per Hits track, two on an instrument's (createHitTrack),
 * Section's own Section+Drop pair and one per dial cell (Song, signals.ts's
 * DIAL_SIGNALS), the BPM block's own Tempo jack, Lock, the bar ruler's own
 * Metronome+Metronome bar pair (createBarRuler) and Wave's Beat/Bar pair
 * (Beat). Every jack's click/hover/fill/usage state is
 * `deps.patch` (AudioMetersDeps's own doc comment); this file only ever
 * mounts them and, on refreshPatchView(), reads that state back into a
 * jack's own visuals and its row's fed glow (jack.ts's setRowFed) —
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
  /** Where the song layer's triggers fire (EngineSource.marks), NaN until
   *  known; null on a device that doesn't hear the music, whose tracks then
   *  draw no mark. */
  getSongMarks: () => SongMarks | null;
  /** The band ladder in Hz (src/audio/bandScale.ts), for the band rows'
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
 *  column per CSS pixel over `spanSec()`, so every trace (the Sound rows,
 *  the Hits tracks) shares its timing. push() records whether or not
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

/** A line row's readout, "%" unless told otherwise; keyed, so a per-tick
 *  call is free. */
function createLineReadout() {
  const el = document.createElement("div");
  el.style.cssText = lineReadoutStyle;
  const digits = document.createElement("span");
  digits.style.cssText = lineDigitsStyle;
  const unit = document.createElement("span");
  unit.style.cssText = lineUnitStyle;
  el.append(digits, unit);
  let lastKey = "";
  return {
    el,
    set(text: string, o: ReadoutOpts = {}): void {
      const u = o.unit ?? "%";
      const key = `${text}|${u}|${o.textual ? 1 : 0}`;
      if (key === lastKey) return;
      lastKey = key;
      digits.textContent = text;
      digits.style.cssText = o.textual ? lineDigitsTextStyle : lineDigitsStyle;
      unit.textContent = u;
      unit.style.display = u ? "" : "none";
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
  description: string;
  choice: SignalId;
  span: TraceSpan;
  gateFloor?: boolean;
  mountJack: MountJack;
}) {
  const { label, description, choice, span, gateFloor, mountJack } = opts;
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

  const lane = document.createElement("div");
  lane.style.cssText = lineLaneStyle;
  const h = LINE_TRACE_HEIGHT_PX;
  const ring = createColumnRing(gateFloor ? 2 : 1, h, `${driveSourceLabel(choice)} over the card's span`, span.sec, span.max);
  ring.canvas.style.marginTop = "0";
  const floor = document.createElement("div");
  lane.append(ring.canvas, floor);

  const readout = createLineReadout();

  const right = document.createElement("div");
  right.style.cssText = rowRightStyle;

  const hint = document.createElement("div");
  hint.className = "vc-hint";
  setHintText(hint, description);

  el.append(labelEl, lane, readout.el, right, hint);
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

  let shownLabel = label;
  return {
    el,
    floor,
    setReadout: readout.set,
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

// The Sound card's Hits drum roll: one touching track per HIT_TRACKS entry,
// each laid out like a line row (name, lane, readout, jack) so its lane
// starts and ends where the line rows' lanes do, and the live edges line up
// down the card.
const HIT_TRACK_HEIGHT_PX = 16;
const HIT_NOTE_WIDTH_PX = 3;
const HIT_FLASH_MS = 250;
// A counted note's alpha is HIT_NOTE_ALPHA_MIN at no stand-out, full at a
// stand-out of 1; HIT_STANDOUT_UNKNOWN stands in where none was recorded.
const HIT_NOTE_ALPHA_MIN = 0.35;
const HIT_STANDOUT_UNKNOWN = 0.6;
// Fills are cached per step, so a frame of notes builds no colour strings.
const HIT_STANDOUT_STEPS = 20;

/** "beat" is the Any track, read from the engine; "song" an instrument,
 *  read from the song layer's edge in AnimFrame.song. */
type HitLane = "beat" | "song";
type SongEdgeKey = "kick" | "clap" | "hat" | "chord";
interface HitTrackSpec {
  name: string;
  choice: SignalId;
  row: MeterRowId;
  /** Which detector's hits it draws; null for Surge, a reading with no hits. */
  lane: HitLane | null;
  /** An instrument's second jack and its trace: the level its hits are picked from. */
  level?: SignalId;
  /** The song layer's edge and firing mark this instrument draws. */
  song?: SongEdgeKey;
}
// Any first, then the instruments; the owner's call (#715, #799).
const HIT_TRACKS: readonly HitTrackSpec[] = [
  { name: "Any", choice: "feature.onset", row: "hitAny", lane: "beat" },
  { name: "Kick", choice: "anim.kickOnset", row: "hitKick", lane: "song", level: "anim.kickLevel", song: "kick" },
  { name: "Clap", choice: "anim.clapOnset", row: "hitClap", lane: "song", level: "anim.clapLevel", song: "clap" },
  { name: "Hats", choice: "anim.hats", row: "hitHats", lane: "song", level: "anim.hatsLevel", song: "hat" },
  { name: "Chord", choice: "anim.chordOnset", row: "hitChord", lane: "song", level: "anim.chordLevel", song: "chord" },
  { name: "Surge", choice: "feature.flux", row: "surge", lane: null },
];
// A track's series. MAIN is a hit track's verdict (CODE_OF_VERDICT, ordered so
// the column store's max-hold keeps fired over blocked over gated) or Surge's
// reading. STANDOUT is written only on a fired tick, BEAT only on the tick a
// metronome beat starts (2 on a bar's first), ANY is the Any track's verdict
// for the guides through the instrument tracks, LEVEL an instrument's level.
const HT_MAIN = 0;
const HT_STANDOUT = 1;
const HT_BEAT = 2;
const HT_ANY = 3;
const HT_LEVEL = 4;
const HT_SERIES = 5;

const NULL_DIAG: OnsetDiag = { ratio: 0, gated: false, blocked: false, sinceOnsetSec: Infinity };
const CODE_OF_VERDICT: Record<OnsetVerdict, number> = { fired: 3, blocked: 2, gated: 1, miss: 0 };

const hitTrackStyle = `display: flex; align-items: center; gap: 6px; height: ${HIT_TRACK_HEIGHT_PX}px; padding: 0 8px; margin: 0 -8px;`;
const hitNameStyle = `${lineLabelStyle} font-size: 11px; line-height: 1;`;
// The Bands caption's look, as a row so it can carry the hit rule's hint.
const hitsCaptionStyle = `${bandsLabelStyle} padding: 2px 8px; margin: 6px -8px 0;`;

/** The metronome's beat in its bar, -1 while it isn't running. */
function barBeat(anim: AnimFrame): number {
  if (!anim.metronomeOn) return -1;
  return Math.min(METRONOME_BEATS_PER_BAR - 1, Math.floor(anim.metronomeBarPhase * METRONOME_BEATS_PER_BAR));
}

/** A track's HT_BEAT value per tick: 2 on the tick a bar's first beat starts,
 *  1 on any other beat's, null between. */
function createBeatMarks(): (anim: AnimFrame | null) => number | null {
  let lastBeat = -1;
  return (anim) => {
    const beat = anim ? barBeat(anim) : -1;
    if (beat === lastBeat) return null;
    lastBeat = beat;
    return beat < 0 ? null : beat === 0 ? 2 : 1;
  };
}

/** The exact hit rule, built from the live constants (the engine's onsets.ts,
 *  the silence-gate marks) so it can't drift from what decides a note.
 *  Recomputed at the text tick, so a move of the gate marks shows up. */
function hitsRuleHint(getSilenceGate: () => SilenceGateMarks): string {
  const ms = (sec: number) => `${Math.round(sec * 1000)}ms`;
  const marks = getSilenceGate();
  const gate =
    marks.closed <= SILENCE_GATE_MIN
      ? "Silence gate is off."
      : `Quieter than ${pct(marks.closed)}% input level nothing counts; between ${pct(marks.closed)}% and ${pct(marks.open)}% a hit has to clear its line by more the quieter it is. While music with a clear beat plays, every hit counts, however quiet.`;
  return [
    "One track per kind of hit. Any hit: a note for every reading that cleared its line.",
    "Filled: it counted, brighter the more it stood out.",
    "Hollow: too soon after the last one.",
    "Faint white: the room was too quiet.",
    `An Any hit: a peak in how fast the sound rises across all frequencies, over its last second's average + ${HIT_DEFAULTS.k}× its spread and at least ${HIT_DEFAULTS.min}, ≥${ms(REFRACTORY_S)} after the last one. It is any of the low, middle or high band's hits.`,
    `While music with a clear beat plays, the low and high bands also fire when their own level jumps within ${ms(RISE_WINDOW_S)} by more than its last second's average jump + ${RISE_K}× its spread.`,
    "Kick, Clap, Hats and Chord each fire when their level, the filled floor under their notes and their second jack, climbs past a mark they keep from the song's last minute or two; the dashed line is that mark, drawn on the device that hears the music. They fire only while music plays, and a note is brighter the higher its level stood.",
    "Faint red lines through those four: an Any hit at that moment. Faint white lines: the metronome's beats, brighter on the first of a bar.",
    "Surge: how close an Any hit is to firing, as a setting fed by Onset surge sees it; the hairline is where one fires.",
    gate,
  ].join(" ");
}

/** Mounts a jack for `choice` into `host`, registered for the row-level fed
 *  glow against `feedEl` (jack.ts's setRowFed). A callback so the row
 *  builders needn't know `deps.patch`'s shape. */
type MountJack = (choice: DriveSourceChoice, host: HTMLElement, feedEl: HTMLElement) => JackHandle;

/** Event times kept for `maxSec`, counted over a span up to that. */
function createEventLog(maxSec: number) {
  const times: number[] = [];
  function prune(nowMs: number): void {
    const cutoff = nowMs - maxSec * 1000;
    let stale = 0;
    while (stale < times.length && times[stale]! < cutoff) stale++;
    if (stale > 0) times.splice(0, stale);
  }
  return {
    add(nowMs: number): void {
      prune(nowMs);
      times.push(nowMs);
    },
    countSince(nowMs: number, spanSec: number): number {
      prune(nowMs);
      const cutoff = nowMs - spanSec * 1000;
      let n = 0;
      for (let i = times.length - 1; i >= 0 && times[i]! >= cutoff; i--) n++;
      return n;
    },
  };
}

/** Column x of series s, the live column at x === ring.length. */
function colAt(ring: ColumnRing, x: number, s: number): number {
  return x === ring.length ? ring.live(s) : ring.at(x, s);
}

/** One drum-roll track. `index` alternates its background so touching tracks
 *  stay apart. */
function createHitTrack<S extends HitTrackSpec>(spec: S, index: number, mountJack: MountJack, span: TraceSpan) {
  const color = driveSourceColor(spec.choice);
  const el = document.createElement("div");
  el.className = "vc-row vc-hit-track";
  el.tabIndex = 0;
  el.style.cssText = hitTrackStyle;
  el.style.setProperty("--vc-accent", color);

  const nameEl = document.createElement("div");
  nameEl.className = "vc-label";
  nameEl.style.cssText = hitNameStyle;
  nameEl.style.color = color;
  nameEl.textContent = spec.name;

  const lane = document.createElement("div");
  lane.style.cssText = lineLaneStyle;
  const h = HIT_TRACK_HEIGHT_PX - HIT_TRACK_FLOOR_PX;
  const ring = createColumnRing(HT_SERIES, h, `${driveSourceLabel(spec.choice)} over the card's span`, span.sec, span.max);
  ring.canvas.style.marginTop = "0";
  const floor = document.createElement("div");
  lane.append(ring.canvas, floor);

  const readout = createLineReadout();
  const right = document.createElement("div");
  right.style.cssText = rowRightStyle;
  const hint = document.createElement("div");
  hint.className = "vc-hint";

  el.append(nameEl, lane, readout.el, right, hint);
  const jack = mountJack(spec.choice, right, el);
  if (spec.level) mountJack(spec.level, right, el);

  const background = index % 2 ? "rgba(255,255,255,0.025)" : "rgba(255,255,255,0.05)";
  const anyGuide = withAlpha(driveSourceColor("feature.onset"), 0.38);
  const noteTop = 2;
  const noteH = h - 3;
  const noteHalf = Math.floor(HIT_NOTE_WIDTH_PX / 2);
  const yOf = (v: number) => 1 + (1 - clamp(v, 0, 1)) * (h - 2);
  // The newest counted note's left edge this draw (NaN: none), for the flash.
  let newestFiredX = Number.NaN;
  const noteFills: string[] = [];

  function drawNote(x: number, code: number, standout: number): void {
    const { ctx } = ring;
    const nx = x - noteHalf;
    if (code === 3) {
      const q = Math.round(clamp(Number.isNaN(standout) ? HIT_STANDOUT_UNKNOWN : standout, 0, 1) * HIT_STANDOUT_STEPS);
      ctx.fillStyle = noteFills[q] ??= withAlpha(color, HIT_NOTE_ALPHA_MIN + ((1 - HIT_NOTE_ALPHA_MIN) * q) / HIT_STANDOUT_STEPS);
      ctx.fillRect(nx, noteTop, HIT_NOTE_WIDTH_PX, noteH);
      newestFiredX = nx;
    } else if (code === 2) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(nx + 0.5, noteTop + 0.5, HIT_NOTE_WIDTH_PX - 1, noteH - 1);
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.fillRect(nx, noteTop, HIT_NOTE_WIDTH_PX, noteH);
    }
  }

  // The level as a floor under the notes, on the track's own scale.
  function drawLevel(): void {
    const { ctx } = ring;
    const len = ring.length;
    ctx.strokeStyle = withAlpha(color, 0.55);
    ctx.fillStyle = withAlpha(color, 0.2);
    ctx.lineWidth = 1;
    let pen = false;
    let start = 0;
    let lastX = 0;
    const close = (): void => {
      ctx.stroke();
      ctx.lineTo(lastX, h);
      ctx.lineTo(start, h);
      ctx.closePath();
      ctx.fill();
    };
    ctx.beginPath();
    for (let x = 0; x <= len; x++) {
      const v = colAt(ring, x, HT_LEVEL);
      if (Number.isNaN(v)) {
        if (pen) {
          close();
          ctx.beginPath();
          pen = false;
        }
        continue;
      }
      if (pen) ctx.lineTo(x, yOf(v));
      else {
        ctx.moveTo(x, yOf(v));
        start = x;
      }
      lastX = x;
      pen = true;
    }
    if (pen) close();
  }

  // Where the trigger fires, a dashed line across the lane; nothing where it
  // isn't known (NaN), which is every device but the one that hears the music.
  function drawMark(mark: number): void {
    if (!Number.isFinite(mark)) return;
    const { ctx } = ring;
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    const y = Math.round(yOf(mark)) + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(ring.width, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawSurge(): void {
    const { ctx } = ring;
    const len = ring.length;
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(0, Math.round(yOf(surgeAtThreshold)) - 0.5, ring.width, 1);
    ctx.strokeStyle = color;
    ctx.fillStyle = withAlpha(color, 0.18);
    ctx.lineWidth = 1;
    let pen = false;
    let start = 0;
    let lastX = 0;
    const close = (): void => {
      ctx.stroke();
      ctx.lineTo(lastX, h);
      ctx.lineTo(start, h);
      ctx.closePath();
      ctx.fill();
    };
    ctx.beginPath();
    for (let x = 0; x <= len; x++) {
      const v = colAt(ring, x, HT_MAIN);
      if (Number.isNaN(v)) {
        if (pen) {
          close();
          ctx.beginPath();
          pen = false;
        }
        continue;
      }
      if (pen) ctx.lineTo(x, yOf(v));
      else {
        ctx.moveTo(x, yOf(v));
        start = x;
      }
      lastX = x;
      pen = true;
    }
    if (pen) close();
  }

  /** `flash` 0..1: how lit the newest counted note is. `mark` is the trigger's
   *  firing mark on the level's scale, NaN where it isn't known. */
  function draw(flash: number, mark: number): void {
    if (!ring.prepare()) return;
    const { ctx } = ring;
    const w = ring.width;
    const len = ring.length;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
    for (let x = 0; x <= len; x++) {
      const b = colAt(ring, x, HT_BEAT);
      if (!(b >= 0.5)) continue;
      ctx.fillStyle = b >= 1.5 ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.06)";
      ctx.fillRect(x, 0, 1, h);
    }
    if (!spec.lane) {
      drawSurge();
      return;
    }
    if (spec.lane === "song") {
      drawLevel();
      drawMark(mark);
      ctx.fillStyle = anyGuide;
      for (let x = 0; x <= len; x++) if (colAt(ring, x, HT_ANY) >= 2.5) ctx.fillRect(x, 0, 1, h);
    }
    // One note per run of columns with the same verdict, at its newest column:
    // a slow frame holds its reading back across the columns it spanned
    // (columnStore.ts), so the run ends where the reading came in.
    newestFiredX = Number.NaN;
    let runCode = 0;
    let runStandout = Number.NaN;
    for (let x = 0; x <= len + 1; x++) {
      const v = x <= len ? colAt(ring, x, HT_MAIN) : 0;
      const code = v >= 2.5 ? 3 : v >= 1.5 ? 2 : v >= 0.5 ? 1 : 0;
      if (code === runCode) {
        if (code === 3) {
          const s = colAt(ring, x, HT_STANDOUT);
          if (Number.isNaN(runStandout) || s > runStandout) runStandout = s;
        }
        continue;
      }
      if (runCode > 0) drawNote(x - 1, runCode, runStandout);
      runCode = code;
      runStandout = code === 3 ? colAt(ring, x, HT_STANDOUT) : Number.NaN;
    }
    if (flash > 0 && !Number.isNaN(newestFiredX)) {
      ctx.fillStyle = `rgba(255,255,255,${flash.toFixed(2)})`;
      ctx.fillRect(newestFiredX, noteTop, HIT_NOTE_WIDTH_PX, noteH);
    }
  }

  const vals: (number | null)[] = new Array(HT_SERIES).fill(null);
  let jackFlash: Animation | null = null;
  let nameFlash: Animation | null = null;
  let shownHint = "";
  return {
    spec,
    el,
    /** The strip under the lane where the caller puts the signal's heat. */
    floor,
    draw,
    setReadout: readout.set,
    /** Keyed, so a text-tick call is free. */
    setHint(text: string): void {
      if (text === shownHint) return;
      shownHint = text;
      setHintText(hint, text);
    },
    push(main: number | null, standout: number | null, beat: number | null, any: number | null, level: number | null, nowMs: number): void {
      vals[HT_MAIN] = main;
      vals[HT_STANDOUT] = standout;
      vals[HT_BEAT] = beat;
      vals[HT_ANY] = any;
      vals[HT_LEVEL] = level;
      ring.push(vals, nowMs);
    },
    /** A counted hit: the jack and the name light in the track's colour. */
    flash(): void {
      jackFlash = flashTo(jack.el, jackFlash, { backgroundColor: color, boxShadow: `0 0 7px ${color}` }, null, HIT_FLASH_MS);
      nameFlash = flashTo(nameEl, nameFlash, { textShadow: `0 0 8px ${color}` }, null, HIT_FLASH_MS);
    },
    // Per-tick state for the readout, the hint and the flash.
    counted: createEventLog(span.max),
    tooSoon: createEventLog(span.max),
    quiet: createEventLog(span.max),
    lastCode: 0,
    lastStandout: null as number | null,
    lastFireMs: -Infinity,
    flashedMs: -Infinity,
  };
}

type HitTrack = ReturnType<typeof createHitTrack>;

/** An instrument track's hint: its hits, its level (the second jack), what
 *  fires it, and its notes over the span. */
function songTrackHint(t: HitTrack, nowMs: number, spanSec: number, level: number | null, mark: number): string {
  const spec = t.spec;
  const parts = [`${driveSourceLabel(spec.choice)}: ${driveSourceDescription(spec.choice)}`];
  if (spec.level) parts.push(`${driveSourceLabel(spec.level)} (the second jack, the filled floor): ${driveSourceDescription(spec.level)}`);
  parts.push(
    Number.isFinite(mark)
      ? `It fires when the level climbs past the dashed line, now at ${pct(mark)}%.`
      : "It fires when the level climbs past a mark it keeps from the song's last minute or two; the mark is shown on the device that hears the music.",
  );
  parts.push(`In the last ${formatHistorySpan(spanSec)}: ${t.counted.countSince(nowMs, spanSec)} counted.`);
  if (t.lastStandout !== null) parts.push(`The last one stood at ${pct(t.lastStandout)}%.`);
  if (level !== null) parts.push(`Now at ${pct(level)}%.`);
  return parts.join(" ");
}

/** Draws `t`, flashing its newest counted note and lighting its name and
 *  jack once per note. */
function drawHitTrack(t: HitTrack, nowMs: number, mark: number): void {
  const age = nowMs - t.lastFireMs;
  if (age < HIT_FLASH_MS && t.lastFireMs !== t.flashedMs) {
    t.flashedMs = t.lastFireMs;
    t.flash();
  }
  t.draw(age < HIT_FLASH_MS ? 1 - age / HIT_FLASH_MS : 0, mark);
}

function hitTrackHint(t: HitTrack, nowMs: number, spanSec: number, ratio: number | null): string {
  const parts = [
    `${driveSourceLabel(t.spec.choice)}: ${driveSourceDescription(t.spec.choice)}`,
    `In the last ${formatHistorySpan(spanSec)}: ${t.counted.countSince(nowMs, spanSec)} counted, ${t.tooSoon.countSince(nowMs, spanSec)} too soon after the last one, ${t.quiet.countSince(nowMs, spanSec)} while the room was too quiet.`,
  ];
  if (t.lastStandout !== null) parts.push(`The last one counted stood out at ${pct(t.lastStandout)}%.`);
  if (ratio !== null) parts.push(`Now at ${ratio.toFixed(2)}× its line.`);
  return parts.join(" ");
}

/** The firing mark of an instrument track's trigger on its level's scale, NaN
 *  where this device doesn't know it (it only exists on the device that hears
 *  the music, EngineSource.marks). */
function markOf(spec: HitTrackSpec, marks: SongMarks | null): number {
  return spec.song && marks ? marks[spec.song] : Number.NaN;
}

/** The Sound card's Hits caption and drum roll. Any reads `frame.onset` and
 *  `beatDiag` (device-local only: a null diag still lets fired/miss through,
 *  with no ratio and no too-soon or quiet notes); Kick, Clap, Hats and Chord
 *  read the song layer's edges and levels in `anim.song`, which every device
 *  has. `getMarks` is the host's firing marks, null elsewhere. */
function createHitsRoll(getSilenceGate: () => SilenceGateMarks, getMarks: () => SongMarks | null, mountJack: MountJack, span: TraceSpan) {
  const caption = document.createElement("div");
  caption.className = "vc-row";
  caption.tabIndex = 0;
  caption.style.cssText = hitsCaptionStyle;
  const captionHint = document.createElement("div");
  captionHint.className = "vc-hint";
  caption.append("Hits", captionHint);
  const hintColors = { red: driveSourceColor("feature.onset") };

  const tracks = HIT_TRACKS.map((spec, i) => createHitTrack(spec, i, mountJack, span));
  const el = document.createElement("div");
  el.append(caption, ...tracks.map((t) => t.el));
  // Until the first text tick fills in the numbers.
  for (const t of tracks) {
    const what = `${driveSourceLabel(t.spec.choice)}: ${driveSourceDescription(t.spec.choice)}`;
    t.setHint(t.spec.lane === "song" ? songTrackHint(t, 0, span.sec(), null, Number.NaN) : t.spec.lane ? what : `${what} The hairline is where an Any hit fires.`);
  }
  let lastRuleHint = hitsRuleHint(getSilenceGate);
  setHintText(captionHint, lastRuleHint, hintColors);

  const beatMarks = createBeatMarks();
  return {
    el,
    tracks,
    /** Every tick, on screen or not. */
    record(frame: FeatureFrame | null, anim: AnimFrame | null, beatDiag: OnsetDiag | null, nowMs: number): void {
      const beatMark = beatMarks(anim);
      if (!anim) {
        for (const t of tracks) t.push(null, null, null, null, null, nowMs);
        return;
      }
      const anyFired = !!frame?.onset;
      const anyCode = CODE_OF_VERDICT[verdictOf(anyFired, beatDiag ?? NULL_DIAG)];
      for (const t of tracks) {
        const spec = t.spec;
        if (!spec.lane) {
          // Only with a local detector: anim.beatRatio is 0 on a TV, a flat line
          // that reads as silence rather than "no reading".
          t.push(frame && beatDiag ? SIGNALS["feature.flux"].read(frame, anim) : null, null, beatMark, null, null, nowMs);
          continue;
        }
        let code: number;
        let fired: boolean;
        let standout: number | null;
        let level: number | null = null;
        if (spec.lane === "beat") {
          fired = anyFired;
          code = anyCode;
          standout = fired ? anim.hitStrength.beat.standout : null;
        } else {
          // The song layer gives an edge and a level, no verdict: a note is
          // either counted or absent, and stands as high as its level did.
          fired = anim.song[`${spec.song!}Onset` as const];
          code = fired ? CODE_OF_VERDICT.fired : CODE_OF_VERDICT.miss;
          level = frame && spec.level ? SIGNALS[spec.level].read(frame, anim) : null;
          standout = fired ? level : null;
        }
        t.push(code, standout, beatMark, spec.lane === "beat" ? null : anyCode, level, nowMs);
        if (fired) {
          t.counted.add(nowMs);
          t.lastFireMs = nowMs;
          t.lastStandout = standout;
        } else if (code !== t.lastCode) {
          // A too-soon or quiet reading can last several ticks: count each once.
          if (code === 2) t.tooSoon.add(nowMs);
          else if (code === 1) t.quiet.add(nowMs);
        }
        t.lastCode = code;
      }
    },
    /** Only while Sound is unfolded and on screen, after record(). */
    render(frame: FeatureFrame | null, anim: AnimFrame | null, beatDiag: OnsetDiag | null, nowMs: number, text: boolean): void {
      const marks = getMarks();
      for (const t of tracks) drawHitTrack(t, nowMs, markOf(t.spec, marks));
      if (!text) return;
      const sec = span.sec();
      const unit = `/${formatHistorySpan(sec)}`;
      for (const t of tracks) {
        const spec = t.spec;
        if (!spec.lane) {
          const v = frame && anim && beatDiag ? SIGNALS["feature.flux"].read(frame, anim) : null;
          t.setReadout(v === null ? "--" : pct(v), v === null ? IDLE : {});
          continue;
        }
        t.setReadout(String(t.counted.countSince(nowMs, sec)), { unit });
        if (spec.lane === "song") {
          const level = frame && anim && spec.level ? SIGNALS[spec.level].read(frame, anim) : null;
          t.setHint(songTrackHint(t, nowMs, sec, level, markOf(spec, marks)));
        } else {
          t.setHint(hitTrackHint(t, nowMs, sec, beatDiag ? beatDiag.ratio : null));
        }
      }
      const rule = hitsRuleHint(getSilenceGate);
      if (rule !== lastRuleHint) {
        lastRuleHint = rule;
        setHintText(captionHint, rule, hintColors);
      }
    },
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
      const beat = on ? barBeat(anim) : -1;
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
  // share a row (Section's Song+Drop, Wave's Beat+Bar) so refreshPatchView
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
   *  `feedEl` is the row that glows, the same unless the jack sits in a
   *  sub-wrapper (the Tempo block's jackHost). `heatCard` is the card whose
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

  // ---- Sound: spectrum, Bass, Mid, Treble, Bands, Level, then Hits ----
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
  const soundBand =(choice: SignalId): LineRow =>
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
  const soundLevel = lineRow({
    label: driveSourceLabel("anim.energy"),
    description:
      "The sound after auto-gain, which keeps it mid-range whether the room is quiet or loud. This is what the scene reacts to. The shaded floor shows when the silence gate was closing: darker, fewer hits get through.",
    choice: "anim.energy",
    span: soundSpan,
    gateFloor: true,
  });
  const hitsRoll = createHitsRoll(deps.getSilenceGate, deps.getSongMarks, mountJack, soundSpan);
  for (const t of hitsRoll.tracks) heatFloorHosts.set(t.el, t.floor);
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
  soundCard.body.append(soundSpectrum.el, soundBass.el, soundMid.el, soundTreble.el, bandsLabel, bandsBlock, soundLevel.el, hitsRoll.el);

  // ---- Stems: Lead ----
  const stemLead = lineRow({
    label: driveSourceLabel("anim.lead"),
    description: capitalise(driveSourceDescription("anim.lead")),
    choice: "anim.lead",
    span: stemsSpan,
  });
  const stemRows: readonly { row: LineRow; id: SignalId }[] = [{ row: stemLead, id: "anim.lead" }];
  const stemsCard = createCard({
    title: "Stems",
    accent: STEM_LEAD,
    foldId: "stems",
    right: createSpanChip("stems", () => {}),
  });
  stemsCard.body.append(stemLead.el);
  // Preallocated: update() records every tick.
  const soundLevelVals: (number | null)[] = [null, null];
  const oneVal: (number | null)[] = [null];

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
  // on one shared row.
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
    beat: beatCard.title.textContent ?? "",
    song: songCard.title.textContent ?? "",
  };
  for (const cardId of ["sound", "stems", "beat", "song"] as const) {
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
    // A track's floor is one strip tall; an instrument's second jack (its
    // level) shares the first's rather than stacking another.
    if (floor && m.ids.size > 0) return;
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
  root.append(soundCard.el, stemsCard.el, beatCard.el, songCard.el, heatHistoryCard.el);

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
    beat: beatCard.el,
    song: songCard.el,
  };
  const rowElements = new Map<MeterRowId, HTMLElement>([
    ["section", section.el],
    ["tempo", tempo.el],
    ...hitsRoll.tracks.map((t): [MeterRowId, HTMLElement] => [t.spec.row, t.el]),
    ...dialCells.map(({ dial, cell }): [MeterRowId, HTMLElement] => [dialSignalId(dial), cell.el]),
    ["wave", wave.el],
    ["lock", lock.el],
    ["bar", barRuler.el],
    ["energy", soundLevel.el],
    ["low", soundBass.el],
    ["mid", soundMid.el],
    ["high", soundTreble.el],
    ["lead", stemLead.el],
    ...bandRows.map(({ id, row }): [MeterRowId, HTMLElement] => [id, row.el]),
  ]);

  // Reused by every marks refresh: one per shown band row.
  const markPool = Array.from({ length: BAND_SIGNALS.length }, () => ({ band: 0, color: "" }));
  const marks: { band: number; color: string }[] = [];
  function refreshMarks(): void {
    marks.length = 0;
    for (const b of bandRows) {
      if (!b.shown) continue;
      const m = markPool[marks.length]!;
      m.band = b.n;
      m.color = driveSourceColor(b.id);
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
    refreshMarks();
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
    beat: beatCard,
    song: songCard,
  };
  // Whether each card is in view (onScreen.ts): one scrolled out of its column
  // or under a closed panel skips draws and DOM writes like a folded one; its
  // traces keep recording.
  const soundOnScreen = watchOnScreen(soundCard.el);
  const stemsOnScreen = watchOnScreen(stemsCard.el);
  const heatHistoryOnScreen = watchOnScreen(heatHistoryCard.el);
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
      hitsRoll.record(frame, anim, beatDiag, nowMs);
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
        for (const { row, id } of stemRows) {
          oneVal[0] = stemsOff ? null : SIGNALS[id].read(frame, anim);
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

      // ---- Sound: Bass, Mid, Treble, band rows, Level, Hits ----
      // Level's raw counterpart is rawBands (local-only). The thin
      // spectrum is drawn by deviceMenu.ts's feed, not here.
      if (!soundCard.fold?.isFolded() && soundOnScreen()) {
        for (const { row } of soundRows) row.draw();
        for (const b of bandRows) if (b.shown) b.row.draw();
        soundLevel.draw();
        hitsRoll.render(frame, anim, beatDiag, nowMs, text);
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

      // ---- Stems: Lead ----
      if (!stemsCard.fold?.isFolded() && stemsOnScreen()) {
        for (const { row } of stemRows) row.draw();
        if (text) {
          const measured = deps.stemsMeasured();
          for (const { row, id } of stemRows) {
            const v = frame && anim && measured ? SIGNALS[id].read(frame, anim) : null;
            row.setReadout(v === null ? "--" : pct(v), v === null ? IDLE : {});
          }
        }
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
