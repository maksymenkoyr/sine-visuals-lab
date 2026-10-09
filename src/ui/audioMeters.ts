import { BEAT_PULSE_DECAY_PER_SEC, type AnimFrame } from "../render/animClock.ts";
import { getTapRun } from "../render/tapTempo.ts";
import { SIGNALS, dialSignalId, surgeAtThreshold, type MeterCardId, type MeterRowId, type SignalId } from "../render/signals.ts";
import { isStemSignal } from "../render/stemReaders.ts";
import type { FeatureFrame } from "../audio/types.ts";
import type { DriveSourceChoice } from "../render/drives.ts";
import { driveSourceColor, driveSourceLabel, jackKey } from "./driveSources.ts";
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
import { downsampleForDisplay, isClipping, peak } from "../audio/waveform.ts";
import type { LufsReading } from "../audio/lufs.ts";
import { SILENCE_GATE_MIN, type SilenceGateMarks, type SilenceGateReading } from "../audio/silenceGate.ts";
import { DIAL_LABELS, MUSIC_DIALS, NEUTRAL } from "../render/musicProfile.ts";
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
  HIT_TAIL_DEFAULT,
  HIT_TAIL_MAX,
  HIT_TAIL_MIN,
  HIT_LANES,
  type HitLane,
  type HitParts,
  type HitShape,
  type HitShapePatch,
  type HitTails,
} from "../audio/hitStrength.ts";
import {
  AUTO_SKY,
  FONT_MONO,
  HOT_RED,
  INPUT_GREEN,
  LANE_JACK_GUTTER_PX,
  STRIP_HIGH,
  STRIP_LOW,
  STRIP_MID,
  withAlpha,
} from "./controlsTheme.ts";
import {
  chipBtnLitStyle,
  chipBtnStyle,
  createAdvancedSection,
  createCard,
  createChipButton,
  createTraceLegend,
  digitsStyle,
  digitsTextStyle,
  groupHeading,
  groupHeadingFirstStyle,
  groupHeadingStyle,
  percentReadout,
  readoutStyle,
  rowHeadStyle,
  rowLabelStyle,
  rowRightStyle,
  spacer,
  unitStyle,
} from "./controlsKit.ts";
// Circular with deviceMenu.ts (it imports createAudioMeters); safe because
// neither calls across until both modules have loaded.
import { createControlRow } from "./deviceMenu.ts";
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

/**
 * The meters under the spectrum card: everything the audio pipeline already
 * derives besides the bands in spectrumStrip.ts, plus the two things a
 * spectrum can't show at all. Read-only cards in the panel's own row grammar
 * (see deviceMenu.ts / controlsKit.ts) — label, seven-segment readout, a
 * meter where a slider would be, and a hint shown beside the panel on hover
 * or tap (rowHints.ts) so
 * every reading explains itself. Grouped under plain divider headings (Sound/
 * Beat/Song — this file's own meterGroupHeadingStyle, modelled on controlsKit.ts's
 * groupHeadingFirstStyle) so a card's place in the pipeline reads at a
 * glance: Sound is what this device measures before any beat/tempo logic
 * runs, Beat is everything about *when*, Song is the slow trend over a whole
 * track.
 *
 *  - Signal (first): everything this device's own mic measures, before any
 *    beat/tempo logic runs — Waveform leads it off: a rolling picture of the
 *    last few seconds with a clip warning, read straight off this device's
 *    mic by waveformAnalyser.ts. A phone or iPad following another device
 *    draws that device's waveform instead: the feed sends one min/max pair
 *    per wire frame (src/net/protocol.ts's wave tail), handed in here as a
 *    two-sample `mono`, so each column shows the frame covering it. With
 *    neither (a synthetic feed) the row hides itself. (No stereo
 *    width/balance: a phone or laptop mic is mono, so they'd read "mono"
 *    nearly always.) Then Level: FeatureFrame.level (pre-AGC, absolute).
 *    Loudness next — the broadcast measurement, BS.1770 / EBU R128 LUFS
 *    from lufsAnalyser.ts (math in lufs.ts): Momentary on the bar with the
 *    LUFS_TARGET_* marks, Short-term as the big number, Integrated beneath
 *    with a Reset chip in the card's own header. Local-only like Waveform,
 *    since it needs this device's own samples; hidden on a mic-less
 *    renderer, the header's Reset chip along with it. Energy is Level's
 *    post-AGC sibling — the only way to see features.ts's adaptive
 *    floor/peak doing its job, since its whole point is to make that
 *    invisible downstream — and under it a History trace of both Level and
 *    Energy over the card's span, with FeatureExtractor.fixedEnergy
 *    (energy as it would read with auto-gain at its minimum) as a dim
 *    reference line. The gap between Energy and that reference is exactly
 *    what the Input card's Auto-gain amount is adding; sliding it down
 *    closes the gap. (No raw low/mid/high energy — the spectrum strip
 *    already shows that. Their post-bandEnergy pulses live in the Hits
 *    card's own hits history instead — see below.) Last, a Gate row: the
 *    silence gate's (src/audio/silenceGate.ts) own Dimmer reading — how
 *    much of a hit's strength the gate is currently letting through — with
 *    a trace beneath it, inserted the way the Character card's Brightness
 *    row inserts its own Centroid trace, of Level against the Input card's
 *    two marks (dashed guides, zoomed so the upper one sits mid-height);
 *    hits the gate actually stops show up as faint ticks on the Hits card
 *    rather than a series of their own here. Local-only like fixedEnergy
 *    above — a device with no FeatureExtractor of its own (a renderer, the
 *    synthetic feed) reads Gate idle too, same as the Hits card's own Beat
 *    lane.
 *  - Hits: one lane each for Beat (the broadband detector) and
 *    bandEnergy.ts's Low/Mid/High (createHitsHistory), tracing each one's
 *    ratio against its firing threshold plus a tick for every
 *    fired/gated/blocked reading (onsetDiag.ts's OnsetVerdict) — a history,
 *    not just an instant reading, so a tuning session can see *why* a hit
 *    did or didn't count, ground-shaded by how closed the silence gate was
 *    at the time. A fired tick's height is that hit's graded strength
 *    (src/audio/hitStrength.ts's HitParts) — exactly full height at
 *    Dimension 0, so nothing on screen changes until that slider actually
 *    moves. A "Show shape" disclosure (createAdvancedSection, closed by
 *    default) folds away two groups. Height: the sliders that shape a hit's
 *    strength (Dimension/Knee/Loudness mix/Floor) plus a Curve
 *    (hitStandout(ratio, knee) plotted live, a dot per lane at that lane's
 *    own last-hit ratio). Length: one row per lane for how long its pulse
 *    rings out (hitStrength.ts's `shape.tail`, shown as the ms it takes to
 *    fade), Linked by default so one drag moves every lane, under an
 *    Envelope monitor (createTailEnvelope) of each lane's fall over four
 *    beats, with Smoothing's stretch as its readout. While Shape is open,
 *    the hits history also marks each fired column's stand-out and
 *    loudness parts as two small dots, draws a dashed Floor guide, and
 *    shades each lane's own pulse under its ticks (its tail), so dragging
 *    any of those sliders shows exactly what it did to a real hit rather
 *    than just a number moving.
 *  - Tempo: a welded row, Lock (how sure the tracker is of the tempo)
 *    beside the BPM block — bpm under a beat dot whose resting tint
 *    follows beatClock's tempoLock, so an unlocked guess reads as
 *    unconfident rather than as a confident wrong number, and the BPM
 *    digits dim the same way. Beneath that, a Timing strip
 *    (createTimingStrip): Grid (the tracker's own predicted beat, a tick
 *    as tall as the lock on every beatPhase wrap), Metronome (metronome.ts's
 *    own steady tick, bright on the bar its jack sends, faint on the beats
 *    between) and Heard (every raw detected
 *    beat) share one time axis, so a detection landing under a grid tick
 *    reads as locked, one between ticks reads as a double, and a tick with
 *    nothing under it reads as a miss. Last, Wave: beatWave/barWave's own
 *    smooth swing, for a setting that wants to sway in time rather than
 *    pulse on a hit. The header carries tap tempo's Tap chip and how many
 *    taps it still needs (tapStatusStyle's comment).
 *  - Character: first, Section — sectionIntensity with a drop flash, the
 *    phrase-level trend. Then a 2-column grid of every entry in MUSIC_DIALS except
 *    brightness (never a hardcoded list — filtered, so a new dial can't
 *    ship without a cell here), each marking NEUTRAL with a tick — what
 *    autoTune.ts resolves every "A" chip against, otherwise invisible. Copy
 *    comes from DIAL_LABELS. Last, a full-width Brightness row: the dial's
 *    own meter, with spectralCentroid.ts's fast, range-adapted Centroid
 *    traced directly under its bar (not a MUSIC_DIALS entry of its own —
 *    it's the live signal Brightness is the track-level summary of) and a
 *    small legend naming the trace.
 *
 * Fills move every frame; readout text at ~10Hz (the same reasoning as
 * deviceMenu.ts's AUTO_UI_REFRESH_MS — text writes cost layout, and eyes
 * can't read faster anyway). Only the waveform is a canvas. Flashes (a bar's
 * flash(), the Tempo dot on each beat, revealRow's ring) run as Web Animations
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
 * Every time-axis trace (Waveform, History, Gate, Hits, Timing, Wave,
 * Centroid) records into a time store (createColumnRing) on every tick,
 * folded card or closed panel alike, so opening a card shows what it
 * missed. A span chip in each card's header (historySpan.ts) picks how
 * much of that the card's traces squeeze into its width, from
 * HISTORY_SPANS, remembered per card.
 *
 * setRaw (called by deviceMenu.ts's one merged RAW chip, in the column head
 * above "Sound" — see that file's own comment for why one chip drives this
 * and the spectrum strip's own raw mode together) flips every row that has
 * a pre-smoothing counterpart to it, for diagnosing "is this a bad
 * measurement or just a slow ease": Section reads sectionIntensity's
 * un-slewed target (anim.raw.sectionIntensity), the Character dials read
 * musicProfile's pre-ease targets (anim.raw.profile), BPM shows the
 * estimator's raw candidate instead of tempoSettle.ts's settled reading,
 * and the waveform's readout shows this buffer's instant peak instead of
 * AnimFrame.wavePeak's held one (animClock.ts). Level and the beat dot are
 * already raw and don't change. Energy has no pre-envelope value threaded
 * through AnimFrame, so it reads the mean of `rawBands` instead — the same
 * pre-AGC/pre-envelope feed app.ts's captureRawBands hands the spectrum
 * strip's own listening-post chip. That feed is local-only, so Energy reads
 * idle under RAW on a mic-less renderer, same as the Waveform row hiding
 * itself. A folded card still skips its own work when RAW is on — the flag
 * only changes what a card computes while it's open, not whether folding
 * buys back that cost. The waveform's auto-zoom is NOT part of this: it's a
 * drawing choice (what range fills the card), not audio processing, so it
 * stays on in both modes.
 *
 * The patch bay's jacks (src/ui/jack.ts) mount on every row above that a
 * drive source can feed — Waveform and Energy (Signal), Section's own
 * Song+Drop pair, one per dial cell and the Brightness row's own
 * dial+Centroid pair (Character — signals.ts's DIAL_SIGNALS), the BPM
 * block's own Metronome+Tempo pair, Lock, the Timing strip's own
 * Grid/Metronome jacks (createTimingStrip) and Wave's Beat/Bar pair
 * (Tempo), and one per hits-history lane plus one for the Surge lane
 * under them, Onset surge's own (createHitsHistory's own laneMounts, Hits)
 * — plus the Bands card's own level rows (BAND_LEVELS/STEM_LEVELS, deviceMenu.ts)
 * and its Frequencies corner, built directly
 * in deviceMenu.ts. Every jack's click/hover/fill/usage state is
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
 * signal has no monitor. Each monitor row also carries its own heat strips,
 * one per signal jack on it, led by a dot in the signal's colour, on the same
 * span and refresh as the jack. The Heat history card (its own span chip,
 * folded by default) draws one strip per wired setting, from
 * deps.heatSettings, and one per signal jack. The Bands card's level jacks
 * (deviceMenu.ts) join all of this through addHeatJack.
 *
 * Every one of those "un-eased" values is what its smoothed sibling is
 * eternally chasing — none of it is a param a Reset chip can zero out.
 * `rateScale` (this file's update(), threaded from app.ts's
 * sensitivity.ts's smoothingRateScale) is what actually closes the gap: at
 * the Smoothing row's Off stop it's Infinity, and every stage upstream of
 * this file (features.ts's envelope, sectionIntensity.ts's INTENSITY_SLEW,
 * musicProfile.ts's eases, animClock.ts's own wavePeak hold) plus this
 * file's own BPM settle snap straight to their targets — see sensitivity.ts's
 * header for the full account of why RAW is then a genuine no-op rather than
 * merely fast.
 */

export interface AudioMeters {
  el: HTMLElement;
  /** Fed every frame, panel open or closed. `onScreen` false only records the
   *  traces: no draws or DOM writes, and peak fall, text cadence and flashes
   *  count from the last drawn tick. `frame`/`anim` null = audio not up yet.
   *  `mono` is the local mic's samples, or on a following device the feed's
   *  [min, max] (app.ts's waveSamples); null hides the Waveform row.
   *  `rawBands`, `fixedEnergy`, `lufs`, `beatDiag` and `gate` are null on a
   *  device without the matching local analyser, and the rows that read them
   *  idle or hide (Gate's trace still plots `frame.level`). `rateScale` is
   *  sensitivity.ts's smoothingRateScale; non-finite (Smoothing Off) shows the
   *  raw BPM estimate, as `raw` does. `anim.wavePeak` answers to the same stop
   *  inside animClock.ts. */
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
  /** Joins a signal jack mounted outside the meter cards (Bands card) to heat:
   *  lens glow, a strip in `rowEl`, a line under `group` in Heat history and
   *  its tooltip line. Reads the Dynamics card's span chip; refreshes only
   *  while `folded()` is false. Call while building the panel. */
  addHeatJack(id: SignalId, jackEl: HTMLElement, rowEl: HTMLElement, group: string, folded: () => boolean): void;
}

export interface AudioMetersDeps {
  /** Wired settings and their heat tracks, for the Heat history card. */
  heatSettings(): readonly { label: string; track: HeatTrack }[];
  /** Reset chip: start the integrated loudness reading over. */
  onLufsReset: () => void;
  /** Tap chip: one tap at the pointerdown's timeStamp (same path as app.ts's Ctrl). */
  onTap: (timeStamp: number) => void;
  /** Whether Hats and Lead were measured this tick (src/render/stemReaders.ts);
   *  while not, their heat records a gap rather than a cold stretch. */
  stemsMeasured(): boolean;
  /** The Input card's two gate marks, read fresh every draw/text tick so a drag
   *  moves the Gate guides and the hits hint live. */
  getSilenceGate: () => SilenceGateMarks;
  /** The Hits card's Shape sliders (formula in src/audio/hitStrength.ts).
   *  Global per device, not per scene: it's a taste about detection, not one
   *  scene's look. */
  hitShape: { get: () => HitShape; set: (partial: HitShapePatch) => void };
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
const WAVE_HEIGHT_CSS_PX = 64;
// One analyser buffer is ~40ms (a single kick) and drew as a flat hairline at
// speech level, so each column holds the min/max over its share of the card's
// span. The range zooms to the loudest column, floored at WAVE_RANGE_FLOOR so
// mic hiss isn't blown up into signal.
const WAVE_RANGE_FLOOR = 0.05;
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
// It hosts the anim.metronome/anim.tempo jacks (mountJack), absolutely
// positioned: a jack row would grow the block and, through weldedRowStyle's
// align-items: stretch, the Lock row. The same style welds the Loudness bar
// beside its LUFS block.
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
// Loudness row: the bar spans LUFS_SCALE_MIN..MAX with the two targets people
// aim at marked (EBU R128 broadcast; what streaming services normalise to).
// Past the streaming one the bar and digits go hot, since a louder mix gets
// turned down on delivery. The block is Tempo's, wider for a signed decimal.
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
  "Tempo. The dot flashes white on every metronome tick and settles back to its colour, brighter as the tracker gets sure. TAPPED under the number: you tapped this tempo, and the tracker follows the music from it.";
// Tap tempo chip (src/render/tapTempo.ts): taps on pointerdown, the press is
// the beat, as with Ctrl in app.ts.
const tapStatusStyle = `font: 400 9.5px/1.2 ${FONT_MONO}; letter-spacing: 0.04em; color: rgba(255,255,255,0.7); white-space: nowrap;`;
const tapRightStyle = `display: flex; align-items: center; gap: 8px;`;
// The digits' settle rule lives in tempoSettle.ts (shared with metronome.ts);
// RAW / Smoothing Off bypass it (see file header).
// Dynamics History: level, energy and the fixed-mapping reference, one column
// per CSS pixel, each keeping the max so a beat's peak survives. The shortest
// span is long enough to watch the adaptive window re-settle (features.ts's
// FLOOR_RISE_RATE) with before and after on screen. The Centroid trace shares
// createTraceStrip.
const HISTORY_HEIGHT_CSS_PX = 48;
const CENTROID_TRACE_HEIGHT_CSS_PX = 28;
const HISTORY_LEVEL_COLOR = "rgba(255,255,255,0.85)";
const HISTORY_ENERGY_COLOR = INPUT_GREEN;
// A different hue from Energy's green so the two read apart; blue is the
// auto system's colour (AUTO_SKY).
const HISTORY_FIXED_COLOR = withAlpha(AUTO_SKY, 0.75);
const BEAT_TRACE_HEIGHT_CSS_PX = 28;
// Predicted-grid colour (Timing's Grid lane, Wave's bar wave). Blue against
// BEAT_COLOR's red keeps "predicted" and "detected" apart.
const BEAT_GRID_COLOR = AUTO_SKY;
// The Gate trace sits under a meter like Centroid does, so it gets more
// height. GATE_DIMMER_COLOR is a dim reference line like HISTORY_FIXED_COLOR;
// GATE_GUIDE_COLOR ties the dashed guides to the Input card that edits them.
const GATE_HISTORY_HEIGHT_CSS_PX = HISTORY_HEIGHT_CSS_PX + 16;
const GATE_DIMMER_COLOR = withAlpha(AUTO_SKY, 0.7);
const GATE_GUIDE_COLOR = withAlpha(INPUT_GREEN, 0.5);
// The Gate trace plots Level on a zoomed scale: the marks sit near the bottom
// of level's range, so on the full scale they and Level's movement around
// them would collapse into a few pixels. The strip's top is
// GATE_LEVEL_TOP_PER_OPEN times the `open` mark (pinning it mid-height);
// Level past it clamps. GATE_LEVEL_TOP_MIN stops the scale blowing up with
// marks at the very bottom. Dimmer keeps its own 0..1 scale. Dragging a mark
// rescales new columns only.
const GATE_LEVEL_TOP_PER_OPEN = 2;
const GATE_LEVEL_TOP_MIN = 0.1;

function gateLevelTop(marks: SilenceGateMarks): number {
  return Math.min(1, Math.max(GATE_LEVEL_TOP_MIN, marks.open * GATE_LEVEL_TOP_PER_OPEN));
}

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
 *  column per CSS pixel over `spanSec()`, so createHitsHistory and the
 *  Waveform share its timing. push() records whether or not anything is on
 *  screen; prepare() resamples and returns false while the canvas has no
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

/** A rolling line trace over createColumnRing. `guides` replaces the fixed
 *  mid-height line with dashed lines at each `at` (0..1, the series' y scale),
 *  read fresh every draw() since a mark can move. `span` is the card's span
 *  chip; without it the strip uses HISTORY_SPAN_DEFAULT. `label` names the
 *  canvas (nameGraph) and has no default, so a strip can't ship unnamed.
 *  Exported for the Master card's Picture block. */
export function createTraceStrip(
  series: TraceStripSeries[],
  heightPx: number,
  opts: { label: string; guides?: () => TraceStripGuide[]; span?: TraceSpan },
) {
  const { guides, span, label } = opts;
  const ring = createColumnRing(series.length, heightPx, label, span?.sec, span?.max);
  const { canvas, ctx } = ring;
  const yOf = (v: number) => 1 + (1 - clamp(v, 0, 1)) * (heightPx - 2);

  /** One polyline over the ring plus the live column; NaN lifts the pen so a
   *  missing sample leaves a gap, not a line to zero. */
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
      for (let i = 0; i < series.length; i++) traceHistory(i, series[i].color, series[i].width);
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

export interface MeterRowSpec {
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

export function createMeterRow(spec: MeterRowSpec) {
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
    /** The anim.metronome/anim.tempo jacks mount here (see tempoBlockStyle). */
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

// The Hits card's history: lanes for Beat and Low/Mid/High, one canvas, one
// column per CSS pixel over the card's span. A trace-only Surge lane (signals.ts's
// "feature.flux") sits under them; it's not part of HITS_LANES, having no hits
// of its own.
const HITS_LANE_HEIGHT_PX = 16;
const HITS_LANE_COUNT = 5; // Beat, Low, Mid, High, Surge
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
  { label: "Beat", color: BEAT_COLOR },
  { label: "Low", color: STRIP_LOW },
  { label: "Mid", color: STRIP_MID },
  { label: "High", color: STRIP_HIGH },
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

/** The exact hit rule, built from the live constants (features.ts,
 *  GROUP_TUNING, the silence-gate marks) so it can't drift from what decides a
 *  tick. Recomputed at the text tick, so a drag of the Input card's gate rows
 *  shows up. */
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
    "Surge: how close Beat is to firing, as a setting fed by Onset surge sees it; the line is where Beat fires.",
    gate,
  ].join(" ");
}

function laneNote(ratio: number | null, fires: number, spanSec: number): string {
  return `${ratio === null ? "--" : ratio.toFixed(2)} · ${fires}/${formatHistorySpan(spanSec)}`;
}

/** A lane's last fired hit's three numbers. `anim.hitStrength.*` always holds
 *  a valid HitParts once `anim` exists, so "--" means no anim at all. */
function hitStrengthNote(parts: HitParts | null): string {
  if (!parts) return "--";
  return `${parts.standout.toFixed(2)} · ${parts.loudness.toFixed(2)} → ${parts.strength.toFixed(2)}`;
}

/** Mounts a jack for `choice` into `host`, registered for the row-level fed
 *  glow against `feedEl` (jack.ts's setRowFed). A callback so
 *  createHitsHistory needn't know `deps.patch`'s shape. */
type MountJack = (choice: DriveSourceChoice, host: HTMLElement, feedEl: HTMLElement) => JackHandle;

/** The Hits card's history row. Beat reads `frame.onset` and `beatDiag`
 *  (device-local only: a null diag still lets fired/miss through, with no
 *  ratio trace and no gated/blocked). Low/Mid/High read `anim` (bandEnergy.ts
 *  runs everywhere). Ground shading is `1 - anim.gateDimmer`, the Gate row's
 *  dimmer. */
function createHitsHistory(getSilenceGate: () => SilenceGateMarks, mountJack: MountJack, span: TraceSpan) {
  const row = createMeterRow({
    label: "Hits",
    accent: NEUTRAL_ACCENT,
    unit: "s",
    description: `${hitsRuleHint(getSilenceGate)} A fired tick's height is its graded strength (Shape).`,
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

  /** `shapeOpen`/`floor` gate the Shape-only drawing (step 5). */
  function draw(shapeOpen: boolean, floor: number): void {
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

    // Divider between the Beat lane and the per-band ones, and above Surge.
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

    // 3b. Surge lane: a filled trace (already 0..1) with a hairline where Beat
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

    // 3c. Shape open: each lane's decaying pulse (the value a scene reads), so
    // Length and Smoothing show as tails and overlap. Under the ticks.
    if (shapeOpen) {
      for (let li = 0; li < HITS_LANES.length; li++) {
        const idx = hitsLaneIdx(li);
        ctx.fillStyle = withAlpha(HITS_LANES[li].color, 0.22);
        const bottom = laneTop(li) + HITS_LANE_HEIGHT_PX;
        for (let x = 0; x <= len; x++) {
          const v = x === len ? ring.live(idx.pulse) : ring.at(x, idx.pulse);
          if (!(v > 0)) continue; // NaN or 0
          const yTop = laneYFrac(li, v);
          ctx.fillRect(x === len ? w - 1 : x, yTop, 1, bottom - yTop);
        }
      }
    }

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

    // 5. Shape open: a dashed Floor guide per lane, and two dots per fired
    // column (stand-out, loudness).
    if (!shapeOpen) return;
    if (floor > 0) {
      for (let li = 0; li < HITS_LANES.length; li++) {
        ctx.strokeStyle = withAlpha(HITS_LANES[li].color, 0.4);
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        const y = Math.round(laneYFrac(li, floor)) - 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    for (let x = 0; x <= len; x++) {
      const px = x === len ? w - 1 : x;
      for (let li = 0; li < HITS_LANES.length; li++) {
        const idx = hitsLaneIdx(li);
        const code = x === len ? ring.live(idx.code) : ring.at(x, idx.code);
        if (code < 2.5) continue;
        const standout = x === len ? ring.live(idx.standout) : ring.at(x, idx.standout);
        const loudness = x === len ? ring.live(idx.loudness) : ring.at(x, idx.loudness);
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.fillRect(px, Math.round(laneYFrac(li, standout)) - 0.5, 1, 1);
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.fillRect(px, Math.round(laneYFrac(li, loudness)) - 0.5, 1, 1);
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
    /** Only while on screen, after record(). `shapeOpen`/`floor` gate the
     *  Shape-only drawing and switch the legend notes. The Curve is drawn
     *  separately (createHitCurve). */
    render(
      frame: FeatureFrame | null,
      anim: AnimFrame | null,
      beatDiag: OnsetDiag | null,
      nowMs: number,
      text: boolean,
      shapeOpen: boolean,
      floor: number,
    ): void {
      draw(shapeOpen, floor);

      if (text) {
        legend.setNote(
          HITS_SURGE_LANE,
          anim && frame && beatDiag ? `${Math.round(SIGNALS["feature.flux"].read(frame, anim) * 100)}%` : "--",
        );
        if (shapeOpen) {
          const parts = anim
            ? [anim.hitStrength.beat, anim.hitStrength.low, anim.hitStrength.mid, anim.hitStrength.high]
            : null;
          for (let li = 0; li < HITS_LANES.length; li++) {
            legend.setNote(li, hitStrengthNote(parts ? parts[li] : null));
          }
        } else {
          const sec = span.sec();
          legend.setNote(0, laneNote(beatDiag ? beatDiag.ratio : null, firesInSpan(0, nowMs), sec));
          legend.setNote(1, laneNote(anim ? anim.hits.low.ratio : null, firesInSpan(1, nowMs), sec));
          legend.setNote(2, laneNote(anim ? anim.hits.mid.ratio : null, firesInSpan(2, nowMs), sec));
          legend.setNote(3, laneNote(anim ? anim.hits.high.ratio : null, firesInSpan(3, nowMs), sec));
        }
        // The marks in the hint can move; touch the DOM only when it changed.
        const hint = `${hitsRuleHint(getSilenceGate)} A fired tick's height is its graded strength (Shape).`;
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

// The Tempo card's Timing strip: Grid/Metronome/Heard on one time axis, to
// compare what the tracker predicts, what rang the metronome and what the
// detector heard.
// A jack is 13px tall (createHitsHistory's lane-centring math); a shorter
// lane would make the Grid and Metronome jacks touch.
const TIMING_LANE_HEIGHT_PX = 14;
const TIMING_LANE_COUNT = 3; // Grid, Metronome, Heard
const TIMING_HEIGHT_PX = TIMING_LANE_HEIGHT_PX * TIMING_LANE_COUNT;
// Distinct from BEAT_GRID_COLOR so Grid and Metronome don't read as one line;
// lighter, not more transparent: a dimmed AUTO_SKY was too faint to tell a
// beat tick from a bar tick.
const TIMING_METRO_COLOR = "#cfe8ff";
// The Metronome jack sends metronomeBar, one pulse per bar, so the bar tick is
// full height and colour; the beats between are short, faint context for
// lining Heard up, so they don't read as pulses the jack sends too.
const TIMING_METRO_BEAT_COLOR = withAlpha(TIMING_METRO_COLOR, 0.35);
const TIMING_METRO_BEAT_HEIGHT = 0.45;
const TIMING_METRO_LANE = 1;
interface TimingLane {
  label: string;
  color: string;
}
const TIMING_LANES: readonly TimingLane[] = [
  { label: "Grid", color: BEAT_GRID_COLOR },
  { label: "Metronome", color: TIMING_METRO_COLOR },
  { label: "Heard", color: BEAT_COLOR },
];

/** The Tempo card's Timing strip. Grid: a tick as tall as tempoLock on each
 *  beatPhase wrap (an unconfident tracker draws short). Metro: full on the bar
 *  (what the jack sends), short and faint on other beats. Heard:
 *  `frame.onset`, the Hits Beat lane's fired edge. */
function createTimingStrip(mountJack: MountJack, span: TraceSpan) {
  const row = createMeterRow({
    label: "Timing",
    accent: NEUTRAL_ACCENT,
    unit: "s",
    description:
      "Grid (blue) is the tracker's predicted beat, tall when it's sure; Metronome ticks steadily at the BPM above: faint on each beat, bright on the bar, and only the bar goes out its jack; Heard (red) is every beat the detector caught. Red under blue is on the beat; red alone is a double; blue with nothing under it is a miss.",
    hintColors: { red: BEAT_COLOR, blue: BEAT_GRID_COLOR },
  });
  // The lane names come from TIMING_LANES, so the label can't drift from the lanes.
  const timingLabel = `Beat timing history: ${TIMING_LANES.map((l) => l.label).join(", ")}`;
  const ring = createColumnRing(TIMING_LANES.length, TIMING_HEIGHT_PX, timingLabel, span.sec, span.max);
  const ctx = ring.ctx;
  // Padded on the right like createHitsHistory's vizWrap, so jacks sit past the trace.
  const vizWrap = document.createElement("div");
  vizWrap.style.cssText = `position: relative; margin-top: 4px; padding-right: ${LANE_JACK_GUTTER_PX}px;`;
  ring.canvas.style.marginTop = "0";
  vizWrap.appendChild(ring.canvas);
  row.el.children[1].replaceWith(vizWrap);
  row.setReadout(String(span.sec()));

  const legend = createTraceLegend(TIMING_LANES.map((l) => ({ color: l.color, label: l.label })));
  vizWrap.after(legend.el);

  // Grid's jack and Metronome's (anim.metronomeBar), each on its own lane. No
  // lane glow: neither lane shares a jack, so the row-level glow is enough.
  const gridJack = mountJack({ source: "beat", grid: 2 }, vizWrap, row.el);
  gridJack.el.style.position = "absolute";
  gridJack.el.style.right = "2px";
  gridJack.el.style.top = `${(TIMING_LANE_HEIGHT_PX - 13) / 2}px`;
  const metroJack = mountJack("anim.metronomeBar", vizWrap, row.el);
  metroJack.el.style.position = "absolute";
  metroJack.el.style.right = "2px";
  metroJack.el.style.top = `${TIMING_LANE_HEIGHT_PX + (TIMING_LANE_HEIGHT_PX - 13) / 2}px`;

  let prevBeatPhase: number | null = null;

  function draw(): void {
    if (!ring.prepare()) return;
    const w = ring.width;
    const len = ring.length;
    ctx.clearRect(0, 0, w, TIMING_HEIGHT_PX);

    // A full-height guide at each Grid tick, so a Heard double or miss reads
    // against the predicted column.
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    for (let x = 0; x <= len; x++) {
      const g = x === len ? ring.live(0) : ring.at(x, 0);
      if (!(g > 0)) continue;
      ctx.fillRect(x === len ? w - 1 : x, 0, 1, TIMING_HEIGHT_PX);
    }

    ctx.fillStyle = "rgba(255,255,255,0.12)";
    for (let li = 1; li < TIMING_LANES.length; li++) {
      ctx.fillRect(0, li * TIMING_LANE_HEIGHT_PX - 0.5, w, 1);
    }

    // Ticks bottom-up per lane, height = the column's value; NaN or 0 draws
    // nothing. A Metronome value under the bar's 1 is the faint beat tick.
    for (let x = 0; x <= len; x++) {
      const px = x === len ? w - 1 : x;
      for (let li = 0; li < TIMING_LANES.length; li++) {
        const raw = x === len ? ring.live(li) : ring.at(x, li);
        if (!(raw > 0)) continue;
        const metroBeat = li === TIMING_METRO_LANE && raw < 1;
        const v = metroBeat ? TIMING_METRO_BEAT_HEIGHT : raw;
        const top = li * TIMING_LANE_HEIGHT_PX;
        const h = Math.max(1, v * (TIMING_LANE_HEIGHT_PX - 1));
        ctx.fillStyle = metroBeat ? TIMING_METRO_BEAT_COLOR : TIMING_LANES[li].color;
        ctx.fillRect(px, top + (TIMING_LANE_HEIGHT_PX - h), 1, h);
      }
    }
  }

  return {
    el: row.el,
    /** Every tick, on screen or not, so a wrap is never read across an
     *  unwatched stretch. */
    record(frame: FeatureFrame | null, anim: AnimFrame | null, nowMs: number): void {
      if (anim) {
        const wrapped = prevBeatPhase !== null && anim.beatPhase < prevBeatPhase;
        prevBeatPhase = anim.beatPhase;
        ring.push(
          [
            wrapped ? anim.tempoLock : 0,
            anim.metronomeBar ? 1 : anim.metronomeBeat ? 0.6 : 0,
            frame?.onset ? 1 : 0,
          ],
          nowMs,
        );
      } else {
        prevBeatPhase = null;
        ring.push([null, null, null], nowMs);
      }
    },
    draw,
    refreshSpan(): void {
      row.setReadout(String(span.sec()));
    },
  };
}

// ---- The Hits card's Shape disclosure: the Curve monitor ---------------

const HIT_CURVE_HEIGHT_CSS_PX = 56;

/** The knee curve, hitStandout(ratio, knee) for ratio in 1..ONSET_METER_MAX,
 *  plus a dot per lane at its last-hit ratio. A function plot redrawn from
 *  scratch each tick; cheap. */
// ---- The Shape section's Length group ----

// A row's ms is the time to fall to e^-3 (about 5%) of its height, 3 / rate:
// round at the base rates, about where a pulse stops reading.
const TAIL_FADE_TIME_CONSTANTS = 3;
/** Each lane's base pulse decay rate per second, read from the modules that
 *  own them, never re-typed (as gateWindow.ts's stepHeightEnv does). */
const LANE_DECAY_PER_SEC: Readonly<Record<HitLane, number>> = {
  beat: BEAT_PULSE_DECAY_PER_SEC,
  low: GROUP_TUNING.low.pulseDecayRate,
  mid: GROUP_TUNING.mid.pulseDecayRate,
  high: GROUP_TUNING.high.pulseDecayRate,
};
/** Ms for `lane`'s pulse to fade at tail multiple `tail`, before Smoothing. */
function laneFadeMs(lane: HitLane, tail: number): number {
  return ((TAIL_FADE_TIME_CONSTANTS / LANE_DECAY_PER_SEC[lane]) * 1000) * tail;
}
const TAIL_ROW_TAIL = "Right: longer, still fading when the next hit lands. Left: a short flick.";
const TAIL_ROW_HINTS: Readonly<Record<HitLane, string>> = {
  beat: `How long a Beat pulse takes to fade — also the metronome's and a beat grid's pulses, and Beat wired with a Fixed or Loud height. ${TAIL_ROW_TAIL}`,
  low: `How long a Low pulse takes to fade, and Bass hit wired with a Fixed or Loud height. ${TAIL_ROW_TAIL}`,
  mid: `How long a Mid pulse takes to fade, and Mid hit wired with a Fixed or Loud height. ${TAIL_ROW_TAIL}`,
  high: `How long a High pulse takes to fade, and Treble hit wired with a Fixed or Loud height. ${TAIL_ROW_TAIL}`,
};

// Whether the Length rows move together: a drag habit, not a look, so it stays
// on this device (syncedStores.ts's PRIVATE_KEYS). Absent = linked.
const TAILS_LINKED_KEY = "vibe.hitTailLinked";
function loadTailsLinked(): boolean {
  try {
    return localStorage.getItem(TAILS_LINKED_KEY) !== "0";
  } catch {
    return true;
  }
}
function saveTailsLinked(linked: boolean): void {
  try {
    if (linked) localStorage.removeItem(TAILS_LINKED_KEY);
    else localStorage.setItem(TAILS_LINKED_KEY, "0");
  } catch {
    // Not fatal — the choice just won't persist across reloads.
  }
}

const TAIL_ENVELOPE_HEIGHT_CSS_PX = 64;
const TAIL_ENVELOPE_BEATS = 4;
// No tempo yet (or none at all): draw the beat lines at this.
const TAIL_ENVELOPE_FALLBACK_BPM = 120;

/** The Length group's Envelope: each lane's pulse after a hit (e^(-rate·t))
 *  over TAIL_ENVELOPE_BEATS beats, with a hairline at the fade level the rows'
 *  ms count to. Redrawn every frame while Shape is open (the last-hit dots
 *  move). */
function createTailEnvelope() {
  const canvas = document.createElement("canvas");
  nameGraph(canvas, "How each lane's pulse falls after a hit");
  canvas.style.cssText = `display: block; width: 100%; height: ${TAIL_ENVELOPE_HEIGHT_CSS_PX}px; margin-top: 4px;`;
  const ctx = canvas.getContext("2d")!;
  const sizer = createCanvasSizer(canvas, ctx, { heightCssPx: TAIL_ENVELOPE_HEIGHT_CSS_PX });
  const h = TAIL_ENVELOPE_HEIGHT_CSS_PX;
  const yOf = (v: number) => 1 + (1 - clamp(v, 0, 1)) * (h - 2);

  function curve(w: number, spanSec: number, rate: number): void {
    ctx.beginPath();
    const STEPS = 64;
    for (let i = 0; i <= STEPS; i++) {
      const x = (i / STEPS) * (w - 1);
      const y = yOf(Math.exp(-rate * (i / STEPS) * spanSec));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  return {
    canvas,
    /** `rateScale` is Smoothing's (non-finite at its Off stop: nothing
     *  plays, so only the as-set curves are drawn); `sinceHitSec[i]` is
     *  HIT_LANES[i]'s time since its last hit, null before one. */
    draw(tails: HitTails, rateScale: number, bpm: number, sinceHitSec: readonly (number | null)[]): void {
      if (!sizer.ensure()) return;
      const w = sizer.width;
      ctx.clearRect(0, 0, w, h);
      const beatSec = 60 / (bpm > 0 && Number.isFinite(bpm) ? bpm : TAIL_ENVELOPE_FALLBACK_BPM);
      const spanSec = TAIL_ENVELOPE_BEATS * beatSec;

      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillRect(0, 0, 1, h);
      ctx.fillRect(0, Math.round(yOf(Math.exp(-TAIL_FADE_TIME_CONSTANTS))) - 0.5, w, 1);
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      for (let b = 1; b <= TAIL_ENVELOPE_BEATS; b++) {
        const x = Math.round((b / TAIL_ENVELOPE_BEATS) * (w - 1)) - 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }

      const playing = Number.isFinite(rateScale);
      const stretched = !playing || rateScale !== 1;
      for (let li = 0; li < HIT_LANES.length; li++) {
        const lane = HIT_LANES[li];
        const color = HITS_LANES[li].color;
        const setRate = LANE_DECAY_PER_SEC[lane] / tails[lane];
        if (stretched) {
          ctx.strokeStyle = withAlpha(color, 0.45);
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 3]);
          curve(w, spanSec, setRate);
        }
        if (!playing) continue;
        ctx.setLineDash([]);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        const rate = setRate * rateScale;
        curve(w, spanSec, rate);
        const since = sinceHitSec[li];
        if (since === null || since > spanSec) continue;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc((since / spanSec) * (w - 1), yOf(Math.exp(-rate * since)), 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.setLineDash([]);
    },
  };
}

function createHitCurve() {
  const canvas = document.createElement("canvas");
  nameGraph(canvas, "Curve: how strongly a hit stands out against how far it cleared the firing line");
  canvas.style.cssText = `display: block; width: 100%; height: ${HIT_CURVE_HEIGHT_CSS_PX}px; margin-top: 4px;`;
  const ctx = canvas.getContext("2d")!;

  // A folded or closed panel has no width to draw at (canvasSizer.ts).
  const sizer = createCanvasSizer(canvas, ctx, { heightCssPx: HIT_CURVE_HEIGHT_CSS_PX });

  let lastKey = "";
  const xOf = (ratio: number, w: number) => ((ratio - 1) / (ONSET_METER_MAX - 1)) * (w - 1);
  const yOf = (v: number) => 1 + (1 - clamp(v, 0, 1)) * (HIT_CURVE_HEIGHT_CSS_PX - 2);

  return {
    canvas,
    /** `laneRatios[i]` is HITS_LANES[i]'s last-hit ratio; null before it ever
     *  fired, or with no local reading (the Beat lane on a renderer). */
    draw(knee: number, laneRatios: readonly (number | null)[]): void {
      // The curve changes only when Knee or a lane's last hit does, both rare,
      // so a repeat call is a no-op. The size check stays first so a resize
      // still repaints.
      if (!sizer.ensure()) return;
      // `sizer.version` stands in for the width: a resized backing store clears
      // the plot.
      const key = `${sizer.version}|${knee}|${laneRatios.join(",")}`;
      if (key === lastKey) return;
      lastKey = key;
      const w = sizer.width;
      const h = HIT_CURVE_HEIGHT_CSS_PX;
      ctx.clearRect(0, 0, w, h);

      // The firing line, at ratio == 1 (the left edge).
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

/** The Loudness welded block: Short-term as the big reading (toFixed's ASCII
 *  minus renders in DSEG7), "LUFS" under it, Integrated beneath. Digits go hot
 *  past LUFS_HOT. */
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
/** Shows or hides a row that only exists with a local mic. Restores the
 *  element's own inline display rather than blanking it: a `display: flex` row
 *  (the welded Loudness row) would fall back to block and stack its LUFS block
 *  under the bar. */
const shownDisplay = new WeakMap<HTMLElement, string>();
function setShown(el: HTMLElement, on: boolean): void {
  if (!shownDisplay.has(el)) shownDisplay.set(el, el.style.display);
  el.style.display = on ? shownDisplay.get(el)! : "none";
}
const meanOf = (v: Float32Array) => {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i];
  return v.length > 0 ? sum / v.length : 0;
};

// The Sound/Beat/Song dividers between cards: plain divs in `root` (Sound is
// built by deviceMenu.ts in its column head, see meterGroupHeading). Modelled
// on groupHeadingFirstStyle, not the bordered groupHeadingStyle: a border would
// read as a second card edge under the real one. The extra top margin is what
// separates a heading from the card above.
const meterGroupHeadingStyle = `${groupHeadingFirstStyle} margin: 18px 0 8px;`;

/** Exported so deviceMenu.ts builds its "Sound" heading with the same look as
 *  "Beat"/"Song" here: one owner for the style. */
export function meterGroupHeading(text: string): HTMLElement {
  const el = document.createElement("div");
  el.textContent = text;
  el.style.cssText = meterGroupHeadingStyle;
  return el;
}

// The Character card's dial grid (MUSIC_DIALS minus brightness, which has a
// full-width row below): two columns, since stacked one-line rows made
// Character the tallest card.
const characterGridStyle = `display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 16px;`;

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
  // history card. The Bands card's jacks join through addHeatJack.
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
   *  `monitor` card, then Dynamics. */
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
      const card = heatCard ?? SIGNALS[choice].monitor?.card ?? "signal";
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
  const signalSpan = cardSpan("signal");
  const hitsSpan = cardSpan("hits");
  const tempoSpan = cardSpan("tempo");
  const characterSpan = cardSpan("character");

  // ---- Signal: Waveform, Level, Loudness, Energy, History, Gate ----
  // The trace takes the meter's place under the head, like History/Gate.
  const waveform = createMeterRow({
    label: "Waveform",
    accent: NEUTRAL_ACCENT,
    unit: "%",
  });
  // Per column: the loudest positive and negative swing (both as heights
  // above zero, so one max-hold serves both) and whether anything clipped.
  const waveRing = createColumnRing(
    3,
    WAVE_HEIGHT_CSS_PX,
    "Waveform of the incoming sound, with clipping marked",
    signalSpan.sec,
    signalSpan.max,
  );
  waveform.el.children[1].replaceWith(waveRing.canvas);
  const waveCtx = waveRing.ctx;
  mountJack("anim.wavePeak", waveform.right, waveform.el);
  // Row + spacer, hidden together with no samples (mono === null).
  const waveformSpacer = spacer();

  const level = createMeterRow({
    label: "Level",
    accent: INPUT_GREEN,
    unit: "%",
    description:
      "How loud the room is on a fixed quiet-to-loud scale. Doesn't auto-adjust: a quiet room reads low and stays low.",
  });
  mountJack("feature.level", level.right, level.el);

  // Loudness (lufsAnalyser.ts, math in lufs.ts): the bar and row readout are
  // Momentary (400 ms); the welded block is Short-term (3 s) over Integrated
  // (gated average since Reset, via the header's Reset chip).
  const lufsRow = createMeterRow({
    label: "Loudness",
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
  lufsWelded.style.cssText = weldedRowStyle;
  lufsWelded.append(lufsRow.el, lufsBlock.el);
  // Row + spacer, hidden together (with the header's Reset chip) on a device
  // with no local lufsAnalyser.
  const loudnessSpacer = spacer();
  const lufsResetChip = createChipButton(
    "Reset I",
    "Start the integrated loudness reading over",
    deps.onLufsReset,
  );

  const energy = createMeterRow({
    label: "Energy",
    accent: INPUT_GREEN,
    unit: "%",
    description:
      "The same sound after auto-gain, which keeps it mid-range whether the room is quiet or loud. This is what the scene actually reacts to.",
  });
  mountJack("anim.energy", energy.right, energy.el);
  const history = createMeterRow({
    label: "History",
    accent: INPUT_GREEN,
    unit: "s",
    description:
      "The last few seconds of Level and Energy. The gap between Energy and No auto-gain is what the Auto-gain slider is adding.",
  });
  // The trace takes the meter's place under the head. Series order is paint
  // order: level lands on top.
  const historyStrip = createTraceStrip(
    [
      { color: HISTORY_FIXED_COLOR, width: 1 },
      { color: HISTORY_ENERGY_COLOR, width: 1.5 },
      { color: HISTORY_LEVEL_COLOR, width: 1 },
    ],
    HISTORY_HEIGHT_CSS_PX,
    { label: "History of Level and Energy", span: signalSpan },
  );
  history.el.children[1].replaceWith(historyStrip.canvas);
  history.setReadout(String(signalSpan.sec()));
  const histLegend = createTraceLegend([
    { color: HISTORY_LEVEL_COLOR, label: "Level" },
    { color: HISTORY_ENERGY_COLOR, label: "Energy" },
    { color: HISTORY_FIXED_COLOR, label: "No auto-gain" },
  ]);
  historyStrip.canvas.after(histLegend.el);
  // The silence gate's reading (src/audio/silenceGate.ts), spliced in like the
  // Character card's Centroid trace: the meter (Dimmer) stays, a canvas goes
  // under it before the hint.
  const gateRow = createMeterRow({
    label: "Gate",
    accent: INPUT_GREEN,
    unit: "%",
    description:
      "How much of a hit's strength the silence gate is currently letting through — full: beats are detected exactly as before; empty: the room is silent and nothing can fire. Below, Level against the two Input-card marks (dashed, zoomed so the upper one sits mid-height) and the Dimmer itself over time. Hits the gate actually stops show up as faint ticks on the Hits card instead of a series here.",
  });
  // Paint order: Dimmer, then Level on top.
  const gateHistoryStrip = createTraceStrip(
    [
      { color: GATE_DIMMER_COLOR, width: 1 },
      { color: HISTORY_LEVEL_COLOR, width: 1 },
    ],
    GATE_HISTORY_HEIGHT_CSS_PX,
    {
      label: "History of Level and the gate's Dimmer against the gate's two marks",
      guides: () => {
        const marks = deps.getSilenceGate();
        const top = gateLevelTop(marks);
        return [
          { at: marks.closed / top, color: GATE_GUIDE_COLOR },
          { at: marks.open / top, color: GATE_GUIDE_COLOR },
        ];
      },
      span: signalSpan,
    },
  );
  gateRow.el.insertBefore(gateHistoryStrip.canvas, gateRow.el.children[2]);
  const gateLegend = createTraceLegend([
    { color: HISTORY_LEVEL_COLOR, label: "Level" },
    { color: GATE_DIMMER_COLOR, label: "Dimmer" },
  ]);
  gateHistoryStrip.canvas.after(gateLegend.el);
  const signalRight = document.createElement("div");
  signalRight.style.cssText = tapRightStyle;
  signalRight.append(
    lufsResetChip,
    createSpanChip("signal", () => history.setReadout(String(signalSpan.sec()))),
  );
  const signalCard = createCard({
    title: "Dynamics",
    accent: INPUT_GREEN,
    foldId: "signal",
    right: signalRight,
  });
  signalCard.body.append(
    waveform.el,
    waveformSpacer,
    level.el,
    spacer(),
    lufsWelded,
    loudnessSpacer,
    energy.el,
    spacer(),
    history.el,
    spacer(),
    gateRow.el,
  );
  // Row visibility is toggled in update(). null until the first unfolded tick
  // applies the real state: rows are built visible, so a mic-less device must
  // still get its first setShown(false) rather than compare false !== false.
  let waveformShown: boolean | null = null;
  let lufsShown: boolean | null = null;

  // ---- Hits ----
  const hitsHistory = createHitsHistory(deps.getSilenceGate, mountJack, hitsSpan);
  // Shape: sliders that turn a fired tick's fixed height into a graded strength
  // (hitStrength.ts), closed by default (see createAdvancedSection's header).
  // Their effect shows in the history's dashed Floor line and dots, and the
  // Curve.
  const hitsShape = createAdvancedSection("hitsShape", "shape");
  const hitAmountRow = createControlRow({
    label: "Dimension",
    accent: NEUTRAL_ACCENT,
    min: HIT_AMOUNT_MIN,
    max: HIT_AMOUNT_MAX,
    defaultValue: HIT_AMOUNT_DEFAULT,
    mapping: "linear",
    ...percentReadout,
    description:
      "How much a hit's size counts. Off: every hit lands at full strength, exactly as before. Full: a hit's pulse height on the hits history above is its own graded strength.",
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
    ...percentReadout,
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
    ...percentReadout,
    description:
      "Hits graded weaker than this count as nothing; the rest are rescaled to fill 0 to 100. 0: nothing is discarded — the dashed line on the hits history above marks where it sits.",
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

  // Length (hitStrength.ts's `shape.tail`): stored as a multiple of the lane's
  // own fall, shown as the time it comes to (laneFadeMs), so an untouched row
  // stays exactly 1. Linked (default) moves every lane by the same ratio,
  // keeping proportions; unlinked, each row is its own.
  let tailsLinked = loadTailsLinked();
  const tailLinkChip = createChipButton("", "Linked: dragging any lane moves all four together, keeping their proportions", () => {
    tailsLinked = !tailsLinked;
    saveTailsLinked(tailsLinked);
    refreshTailLinkChip();
  });
  function refreshTailLinkChip(): void {
    tailLinkChip.textContent = tailsLinked ? "Linked" : "Unlinked";
    tailLinkChip.style.cssText = tailsLinked ? chipBtnLitStyle : chipBtnStyle;
  }
  refreshTailLinkChip();
  const lengthHead = document.createElement("div");
  lengthHead.style.cssText = `${groupHeadingStyle} display: flex; align-items: center; justify-content: space-between;`;
  lengthHead.append("Length", tailLinkChip);

  const tailEnvelopeRow = createMeterRow({
    label: "Envelope",
    accent: NEUTRAL_ACCENT,
    unit: "×",
    description:
      "Each lane's pulse falling after a hit, over four beats at the current tempo (dashed lines). Dots ride down from each lane's last hit. Solid is what plays; when this scene's Smoothing stretches it, the dashed curve is what the rows alone set. The readout is Smoothing's stretch.",
  });
  const tailEnvelope = createTailEnvelope();
  tailEnvelopeRow.el.children[1].replaceWith(tailEnvelope.canvas);

  const tailRows = HIT_LANES.map((lane, li) => {
    const baseMs = laneFadeMs(lane, HIT_TAIL_DEFAULT);
    const row = createControlRow({
      label: HITS_LANES[li].label,
      accent: HITS_LANES[li].color,
      min: laneFadeMs(lane, HIT_TAIL_MIN),
      max: laneFadeMs(lane, HIT_TAIL_MAX),
      defaultValue: baseMs,
      mapping: "log",
      unit: "ms",
      format: (v) => String(Math.round(v)),
      description: TAIL_ROW_HINTS[lane],
    });
    // ms / baseMs is exactly 1 when the row's own reset commits baseMs.
    row.onChange((ms) => setTail(lane, ms / baseMs));
    return { lane, row, baseMs };
  });
  function syncTailRows(): void {
    const tails = deps.hitShape.get().tail;
    for (const t of tailRows) t.row.sync(() => t.baseMs * tails[t.lane]);
  }
  function setTail(lane: HitLane, mult: number): void {
    if (!tailsLinked) {
      deps.hitShape.set({ tail: { [lane]: mult } });
      return;
    }
    const cur = deps.hitShape.get().tail;
    // One ratio for every lane, narrowed so none runs past its range; the
    // dragged row snaps back if it would push another off its end.
    let ratio = mult / cur[lane];
    for (const l of HIT_LANES) ratio = Math.min(HIT_TAIL_MAX / cur[l], Math.max(HIT_TAIL_MIN / cur[l], ratio));
    // Lanes level with the dragged one land on exactly its value, so a
    // linked Reset of an untouched set returns every lane to exactly 1.
    const unclamped = ratio === mult / cur[lane];
    const next: Partial<Record<HitLane, number>> = {};
    for (const l of HIT_LANES) next[l] = unclamped && cur[l] === cur[lane] ? mult : cur[l] * ratio;
    deps.hitShape.set({ tail: next });
    syncTailRows();
  }

  hitsShape.body.append(
    groupHeading("Height", true),
    hitAmountRow.el,
    spacer(),
    hitKneeRow.el,
    spacer(),
    hitLoudnessRow.el,
    spacer(),
    hitFloorRow.el,
    spacer(),
    hitCurveRow.el,
    lengthHead,
    tailEnvelopeRow.el,
    ...tailRows.flatMap((t) => [spacer(), t.row.el]),
  );
  syncTailRows();

  // Per-lane last-hit ratio for the Curve's dots, set only on the tick a lane
  // fires, so a dot marks a real hit.
  const lastHitRatio: (number | null)[] = [null, null, null, null];
  // Per-lane last-hit time for the Envelope's dots, same rule.
  const lastHitMs: (number | null)[] = [null, null, null, null];
  const sinceHitSec: (number | null)[] = [null, null, null, null];

  const hitsCard = createCard({
    title: "Hits",
    accent: NEUTRAL_ACCENT,
    foldId: "hits",
    right: createSpanChip("hits", () => hitsHistory.refreshSpan()),
  });
  hitsCard.body.append(hitsHistory.el, spacer(), hitsShape.el);

  // ---- Tempo ----
  const tempo = createTempoBlock(NEUTRAL_ACCENT);
  // Both mount here, not on a row of their own: the BPM is the metronome's
  // number (signals.ts's MeterRowId).
  mountJack("anim.metronome", tempo.jackHost, tempo.el);
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

  const timingStrip = createTimingStrip(mountJack, tempoSpan);

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
    { label: "History of the beat wave and the bar wave", span: tempoSpan },
  );
  wave.el.children[1].replaceWith(waveTrace.canvas);
  wave.setReadout(String(tempoSpan.sec()));
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
    createSpanChip("tempo", () => {
      timingStrip.refreshSpan();
      wave.setReadout(String(tempoSpan.sec()));
    }),
  );
  let shownTapStatus = "";
  const tempoCard = createCard({ title: "Tempo", accent: NEUTRAL_ACCENT, foldId: "tempo", right: tapRight });
  tempoCard.body.append(tempoWelded, spacer(), timingStrip.el, spacer(), wave.el);

  // ---- Character ----
  const section = createMeterRow({
    label: "Section",
    accent: NEUTRAL_ACCENT,
    unit: "%",
    description:
      "How intense this part of the track is against the last while. Flashes red on a drop.",
  });
  mountJack("anim.sectionIntensity", section.right, section.el, "character");
  mountJack("anim.dropOnset", section.right, section.el);
  // MUSIC_DIALS minus brightness (its own full-width row below), filtered so a
  // new dial lands in the grid by construction.
  const dialRows = MUSIC_DIALS.filter((dial) => dial !== "brightness").map((dial) => ({
    dial,
    row: createMeterRow({
      label: DIAL_LABELS[dial].label,
      accent: AUTO_SKY,
      description: DIAL_LABELS[dial].description,
      ticks: [{ at: NEUTRAL[dial] }],
    }),
  }));
  const dialGrid = document.createElement("div");
  dialGrid.style.cssText = characterGridStyle;
  dialRows.forEach(({ dial, row }) => {
    mountJack(dialSignalId(dial), row.right, row.el);
    dialGrid.appendChild(row.el);
  });

  // Brightness: the dial's meter row, with spectralCentroid.ts's fast Centroid
  // traced under its bar (the live signal Brightness summarises, not a
  // MUSIC_DIALS entry).
  const brightnessRow = createMeterRow({
    label: DIAL_LABELS.brightness.label,
    accent: AUTO_SKY,
    description: DIAL_LABELS.brightness.description,
    ticks: [{ at: NEUTRAL.brightness }],
  });
  // Two jacks, bar first: the slow dial, then the live Centroid the trace
  // shows (as Section's pair).
  mountJack(dialSignalId("brightness"), brightnessRow.right, brightnessRow.el);
  mountJack("anim.centroid", brightnessRow.right, brightnessRow.el);
  // Inserted before the hint, under the meter. RAW briefly mixes raw and
  // processed samples in this trace after a toggle until the span rolls them
  // out; harmless.
  const centroidTrace = createTraceStrip([{ color: AUTO_SKY, width: 1.5 }], CENTROID_TRACE_HEIGHT_CSS_PX, {
    label: "History of the live Centroid",
    span: characterSpan,
  });
  brightnessRow.el.insertBefore(centroidTrace.canvas, brightnessRow.el.children[2]);
  const centroidLegend = createTraceLegend([{ color: AUTO_SKY, label: "Centroid (live)" }]);
  centroidTrace.canvas.after(centroidLegend.el);

  // No row here reads out its span (Brightness's readout is the dial), so the
  // chip is the only label.
  const characterCard = createCard({
    title: "Character",
    accent: AUTO_SKY,
    foldId: "character",
    right: createSpanChip("character", () => {}),
  });
  characterCard.body.append(section.el, spacer(), dialGrid, spacer(), brightnessRow.el);

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
  // Signal jacks outside the meter cards (the Bands card's, via addHeatJack) get
  // their own grid above the meter cards' groups, as their card sits above.
  const heatOuterGrid = document.createElement("div");
  heatOuterGrid.className = "vc-heat-hist";
  const heatSignalsGrid = document.createElement("div");
  heatSignalsGrid.className = "vc-heat-hist";
  const heatAxis = document.createElement("div");
  heatAxis.className = "vc-heat-hist-axis";
  const heatAxisLeft = document.createElement("span");
  const heatAxisNow = document.createElement("span");
  heatAxisNow.textContent = "now";
  heatAxis.append(heatAxisLeft, heatAxisNow);
  heatHistoryCard.body.append(heatNote, heatSettingsGrid, heatOuterGrid, heatSignalsGrid, heatAxis);
  let heatOuterGroup: string | null = null;

  function heatHistGroup(grid: HTMLElement, text: string): void {
    const group = document.createElement("div");
    group.className = "vc-heat-hist-group";
    group.textContent = text;
    grid.append(group);
  }
  function heatHistRow(grid: HTMLElement, label: string): HTMLElement {
    const name = document.createElement("span");
    name.className = "vc-heat-hist-label";
    name.textContent = label;
    name.title = label;
    const strip = document.createElement("div");
    strip.className = "vc-heat-hist-strip";
    grid.append(name, strip);
    return strip;
  }

  // The Signals group is built once; every jack is mounted by now.
  const heatSignalStrips: { idx: number; el: HTMLElement; bg: string }[] = [];
  const heatCardTitles: Record<MeterCardId, string> = {
    signal: signalCard.title.textContent ?? "",
    hits: hitsCard.title.textContent ?? "",
    tempo: tempoCard.title.textContent ?? "",
    character: characterCard.title.textContent ?? "",
  };
  for (const cardId of ["signal", "hits", "tempo", "character"] as const) {
    const seen = new Set<SignalId>();
    const jacks = heatJacks.filter((j) => {
      if (j.card !== cardId || seen.has(j.id)) return false;
      seen.add(j.id);
      return true;
    });
    if (!jacks.length) continue;
    heatHistGroup(heatSignalsGrid, heatCardTitles[cardId]);
    for (const j of jacks) {
      heatSignalStrips.push({ idx: j.idx, el: heatHistRow(heatSignalsGrid, driveSourceLabel(j.id)), bg: "" });
    }
  }

  // Each monitor's heat strips sit under the row a signal jack feeds, one per
  // signal in mount order, led by a dot in the signal's colour. Above the row's
  // hint, so under its trace and legend. The Tempo block is a narrow box welded
  // beside Lock, so its strips join Lock's.
  const heatMonitorStrips: { idx: number; card: MeterCardId; folded: () => boolean; el: HTMLElement; bg: string }[] = [];
  const heatMonitorHosts = new Map<HTMLElement, { host: HTMLElement; ids: Set<SignalId> }>();
  function addHeatMonitorStrip(j: HeatJack, rowEl: HTMLElement): void {
    let m = heatMonitorHosts.get(rowEl);
    if (!m) {
      const host = document.createElement("div");
      host.className = "vc-heat-monitor";
      rowEl.insertBefore(host, rowEl.querySelector(":scope > .vc-hint"));
      m = { host, ids: new Set() };
      heatMonitorHosts.set(rowEl, m);
    }
    if (m.ids.has(j.id)) return;
    m.ids.add(j.id);
    const line = document.createElement("div");
    line.className = "vc-heat-monitor-line";
    line.style.setProperty("--c", driveSourceColor(j.id));
    const strip = document.createElement("div");
    strip.className = "vc-heat-strip";
    line.append(strip);
    m.host.append(line);
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
      for (const r of rows) heatSettingStrips.push({ track: r.track, el: heatHistRow(heatSettingsGrid, r.label), bg: "" });
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

  // Sound/Beat/Song, per the file header. Signal leads: it's the raw picture of
  // the sound, the first thing to check when the visuals seem off.
  root.append(
    signalCard.el,
    meterGroupHeading("Beat"),
    hitsCard.el,
    tempoCard.el,
    meterGroupHeading("Song"),
    characterCard.el,
    meterGroupHeading("Heat"),
    heatHistoryCard.el,
  );

  function pushWave(mono: Float32Array, clipped: boolean, nowMs: number): void {
    const { min, max } = downsampleForDisplay(mono, 1);
    waveRing.push([Math.max(0, max[0]), Math.max(0, -min[0]), clipped ? 1 : 0], nowMs);
  }

  /** Zooms to the loudest column on screen. A drawing choice, not audio
   *  processing, so unlike the rest of RAW it never changes with it. A column
   *  nothing was sampled for rests at silence. */
  function drawWave(): void {
    if (!waveRing.prepare()) return;
    const w = waveRing.width;
    const h = WAVE_HEIGHT_CSS_PX;
    const mid = h / 2;
    const len = waveRing.length;
    waveCtx.clearRect(0, 0, w, h);
    const col = (x: number, s: number): number => {
      const v = x === len ? waveRing.live(s) : waveRing.at(x, s);
      return Number.isNaN(v) ? 0 : v;
    };

    let range = WAVE_RANGE_FLOOR;
    for (let x = 0; x <= len; x++) range = Math.max(range, col(x, 0), col(x, 1));
    const scale = (mid * 0.92) / range;

    let lastClip = -1;
    for (let x = 0; x <= len; x++) {
      const clip = col(x, 2) > 0 ? 1 : 0;
      if (clip !== lastClip) {
        waveCtx.fillStyle = clip ? HOT_RED : "rgba(255,255,255,0.8)";
        lastClip = clip;
      }
      const y0 = mid - col(x, 0) * scale;
      const y1 = mid + col(x, 1) * scale;
      waveCtx.fillRect(x === len ? w - 1 : x, y0, 1, Math.max(1, y1 - y0));
    }

    waveCtx.fillStyle = "rgba(255,255,255,0.18)";
    waveCtx.fillRect(0, mid - 0.5, w, 1);
  }

  // The last drawn tick (update() with onScreen true).
  let lastMs: number | null = null;
  let lastTextMs = 0;
  // When anim.metronomeBeat and anim.dropOnset last fired: recorded on every
  // tick, flashed on the next drawn one (update()).
  let beatAtMs = -Infinity;
  let dropAtMs = -Infinity;

  // signals.ts's monitor anchors, populated on demand as a SignalSpec points at
  // a card/row (see MeterCardId/MeterRowId). section.el, tempo.el and lock.el
  // are the flash/scroll targets, not their welded wrapper, so a jump
  // highlights only that half.
  const cardElements: Record<MeterCardId, HTMLElement> = {
    signal: signalCard.el,
    hits: hitsCard.el,
    tempo: tempoCard.el,
    character: characterCard.el,
  };
  const rowElements = new Map<MeterRowId, HTMLElement>([
    ["section", section.el],
    ["tempo", tempo.el],
    ["hits", hitsHistory.el],
    ["centroid", brightnessRow.el],
    [dialSignalId("brightness"), brightnessRow.el],
    ...dialRows.map(({ dial, row }): [MeterRowId, HTMLElement] => [dialSignalId(dial), row.el]),
    ["wave", wave.el],
    ["lock", lock.el],
    ["timing", timingStrip.el],
    ["waveform", waveform.el],
  ]);

  // Each card's fold, for update()'s heat block.
  const meterCards: Record<MeterCardId, { fold?: { isFolded(): boolean } }> = {
    signal: signalCard,
    hits: hitsCard,
    tempo: tempoCard,
    character: characterCard,
  };
  // Whether each card is in view (onScreen.ts): one scrolled out of its column
  // or under a closed panel skips draws and DOM writes like a folded one; its
  // traces keep recording.
  const signalOnScreen = watchOnScreen(signalCard.el);
  const hitsOnScreen = watchOnScreen(hitsCard.el);
  const tempoOnScreen = watchOnScreen(tempoCard.el);
  const characterOnScreen = watchOnScreen(characterCard.el);

  return {
    el: root,
    update(frame, anim, mono, rawBands, rateScale, fixedEnergy, lufs, beatDiag, gate, onScreen): void {
      const nowMs = performance.now();
      const raw = showRaw;
      // Smoothing's Off stop (smoothingRateScale is Infinity) bypasses the BPM
      // settle like `raw`, so RAW has nothing left to differ by (file header).
      const smoothingOff = !Number.isFinite(rateScale);

      // ---- Every trace records, every tick ----
      // On screen or not, so a card opens on what it missed. Recording is a few
      // compares per series; the drawing and DOM writes are the cost.
      const clipped = mono !== null && isClipping(mono);
      if (mono) pushWave(mono, clipped, nowMs);
      // Nothing to sample: on mono's return the Waveform starts a fresh
      // column instead of reading the gap as a stall's catch-up burst.
      else waveRing.resetColumn();
      if (frame) historyStrip.push([fixedEnergy, frame.energy, frame.level], nowMs);
      // Level plots off `frame` regardless of `gate` (no local extractor
      // needed); Dimmer goes null wherever `gate` does.
      if (frame || gate) {
        gateHistoryStrip.push(
          [gate ? gate.dimmer : null, frame ? frame.level / gateLevelTop(deps.getSilenceGate()) : null],
          nowMs,
        );
      }
      hitsHistory.record(frame, anim, beatDiag, nowMs);
      if (anim) {
        // Each Curve dot tracks its lane's last-hit ratio, set only on the tick
        // it fires: the live ratio wanders below the line between hits, where
        // no hit landed.
        if (frame?.onset) lastHitRatio[0] = beatDiag ? beatDiag.ratio : null;
        if (anim.lowOnset) lastHitRatio[1] = anim.hits.low.ratio;
        if (anim.midOnset) lastHitRatio[2] = anim.hits.mid.ratio;
        if (anim.highOnset) lastHitRatio[3] = anim.hits.high.ratio;
        if (frame?.onset) lastHitMs[0] = nowMs;
        if (anim.lowOnset) lastHitMs[1] = nowMs;
        if (anim.midOnset) lastHitMs[2] = nowMs;
        if (anim.highOnset) lastHitMs[3] = nowMs;
      }
      timingStrip.record(frame, anim, nowMs);
      // Via SIGNALS[id].read(), not a copied formula, so this trace and a
      // setting driven by the signal agree.
      waveTrace.push(
        frame && anim
          ? [SIGNALS["anim.beatWave"].read(frame, anim), SIGNALS["anim.barWave"].read(frame, anim)]
          : [null, null],
        nowMs,
      );
      centroidTrace.push([anim ? (raw ? anim.centroidRaw : anim.centroid) : null], nowMs);
      if (frame && anim) {
        const recordSec = nowMs / 1000;
        const stemsOff = !deps.stemsMeasured();
        for (let i = 0; i < heatIds.length; i++) {
          const x = SIGNALS[heatIds[i]!].read(frame, anim);
          heatLive[i] = x;
          if (stemsOff && heatIsStem[i]) continue;
          heatTracks[i]!.push(x, frame.level, recordSec);
        }
      }
      if (anim?.metronomeBeat) beatAtMs = nowMs;
      if (anim?.dropOnset) dropAtMs = nowMs;
      if (!onScreen) return;

      // ---- Drawn ticks only from here ----
      // onScreen false ticks aren't drawn, so peak fall and text cadence count
      // from the last drawn tick, and a beat or drop on a tick between still
      // flashes now. An edge older than CARRY_MS (panel closed, rAF paused) is
      // stale.
      const sinceDrawMs = lastMs === null ? 1000 / 60 : nowMs - lastMs;
      lastMs = nowMs;
      const dtSec = Math.max(1e-4, sinceDrawMs / 1000);
      const edgeWindowMs = Math.min(sinceDrawMs, CARRY_MS);
      const beat = nowMs - beatAtMs < edgeWindowMs;
      const drop = nowMs - dropAtMs < edgeWindowMs;
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
        if (!heatHistoryCard.fold?.isFolded()) refreshHeatHistory(heatSec);
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

      // ---- Signal: Waveform, Level, Loudness, Energy, History, Gate ----
      // Level is already raw; Energy's raw counterpart is rawBands (local-only
      // like mono). Gate has no RAW branch: no pre-smoothing counterpart in
      // AnimFrame.
      if (!signalCard.fold?.isFolded() && signalOnScreen()) {
        // Waveform: hidden (with its spacer) with no samples.
        const showWaveform = mono !== null;
        if (showWaveform !== waveformShown) {
          waveformShown = showWaveform;
          setShown(waveform.el, showWaveform);
          setShown(waveformSpacer, showWaveform);
        }
        if (mono) {
          drawWave();
          const instPeak = peak(mono);
          // The held reading is AnimFrame.wavePeak (animClock.ts), so this
          // readout and the Waveform jack's `anim.wavePeak` read one number.
          // instPeak covers a tick with no anim yet.
          if (text) {
            if (clipped)
              waveform.setReadout("CLIP", {
                textual: true,
                color: HOT_RED,
                unit: "",
              });
            else waveform.setReadout(pct(raw ? instPeak : anim ? anim.wavePeak : instPeak));
          }
        }

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
          historyStrip.draw();
          histLegend.setEntryEnabled(2, fixedEnergy !== null);
        }

        // Loudness: hidden (with its spacer and the header's Reset chip) with no
        // local lufsAnalyser.
        const showLufs = lufs !== null;
        if (showLufs !== lufsShown) {
          lufsShown = showLufs;
          setShown(lufsWelded, showLufs);
          setShown(loudnessSpacer, showLufs);
          setShown(lufsResetChip, showLufs);
        }
        if (lufs) {
          const m = lufs.momentary;
          const live = Number.isFinite(m);
          lufsRow.setValue(live ? lufsFrac(m) : 0, dtSec);
          lufsRow.setFillColor(m > LUFS_HOT ? HOT_RED : NEUTRAL_ACCENT);
          if (text) {
            lufsRow.setReadout(live ? m.toFixed(1) : "--", live ? {} : IDLE);
            lufsBlock.set(lufs);
          }
        }

        gateRow.setValue(gate ? gate.dimmer : null, dtSec);
        if (text) gateRow.setReadout(gate ? pct(gate.dimmer) : "--", gate ? {} : IDLE);
        if (frame || gate) gateHistoryStrip.draw();
      }

      // ---- Hits ----
      if (!hitsCard.fold?.isFolded() && hitsOnScreen()) {
        const shapeOpen = hitsShape.isOpen();
        // Read fresh every draw, so a slider drag moves the Floor line and the
        // Curve at once.
        const shape = deps.hitShape.get();
        hitsHistory.render(frame, anim, beatDiag, nowMs, text, shapeOpen, shape.floor);
        // The Curve and Envelope aren't on the hits history's canvas, so draw
        // them only while Shape is open.
        if (shapeOpen) {
          hitCurve.draw(shape.knee, lastHitRatio);
          for (let li = 0; li < lastHitMs.length; li++) {
            const at = lastHitMs[li];
            sinceHitSec[li] = at === null ? null : (nowMs - at) / 1000;
          }
          tailEnvelope.draw(shape.tail, rateScale, anim ? anim.metronomeBpm : 0, sinceHitSec);
          if (text) {
            if (Number.isFinite(rateScale)) tailEnvelopeRow.setReadout((1 / rateScale).toFixed(2));
            else tailEnvelopeRow.setReadout("Off", { textual: true, unit: "" });
          }
        }
      }

      // ---- Tempo ----
      // The Tap chip's count sits in the header, so it updates folded too.
      if (text) {
        const run = getTapRun(nowMs);
        const status = run && run.more > 0 ? `${run.more} more ${run.more === 1 ? "tap" : "taps"}` : "";
        if (status !== shownTapStatus) {
          shownTapStatus = status;
          tapStatus.textContent = status;
        }
      }
      if (!tempoCard.fold?.isFolded() && tempoOnScreen()) {
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
        timingStrip.draw();
        waveTrace.draw();
      }

      // ---- Character ----
      if (!characterCard.fold?.isFolded() && characterOnScreen()) {
        const sectionVal = anim ? (raw ? anim.raw.sectionIntensity : anim.sectionIntensity) : null;
        section.setValue(sectionVal, dtSec);
        if (drop) section.flash(HOT_RED);
        if (text) {
          section.setReadout(
            sectionVal === null ? "--" : pct(sectionVal),
            sectionVal === null ? IDLE : {},
          );
        }
        for (const { dial, row } of dialRows) {
          const v = anim ? (raw ? anim.raw.profile[dial] : anim.profile[dial]) : null;
          row.setValue(v, dtSec);
          if (text)
            row.setReadout(
              v === null ? "--" : v.toFixed(2),
              v === null ? IDLE : {},
            );
        }
        // Brightness: the dial's value on the bar and readout; the trace under
        // it is the live Centroid.
        const brightnessVal = anim ? (raw ? anim.raw.profile.brightness : anim.profile.brightness) : null;
        brightnessRow.setValue(brightnessVal, dtSec);
        if (text)
          brightnessRow.setReadout(
            brightnessVal === null ? "--" : brightnessVal.toFixed(2),
            brightnessVal === null ? IDLE : {},
          );
        centroidTrace.draw();
      }
    },
    setRaw(on): void {
      showRaw = on;
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
    addHeatJack(id, jackEl, rowEl, group, folded) {
      const j: HeatJack = {
        id, card: "signal", el: jackEl, feedEl: rowEl, row: heatRowFor(rowEl), folded, idx: heatIdx.get(id)!, color: "", glow: -1,
      };
      jackEl.classList.add("vc-heat-jack");
      heatJacks.push(j);
      heatCardByKey.set(jackKey(id), j.card);
      addHeatMonitorStrip(j, rowEl);
      if (group !== heatOuterGroup) {
        heatOuterGroup = group;
        heatHistGroup(heatOuterGrid, group);
      }
      heatSignalStrips.push({ idx: j.idx, el: heatHistRow(heatOuterGrid, driveSourceLabel(id)), bg: "" });
    },
  };
}
