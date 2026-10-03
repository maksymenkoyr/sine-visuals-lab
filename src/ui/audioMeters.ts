import { BEAT_PULSE_DECAY_PER_SEC, type AnimFrame } from "../render/animClock.ts";
import { SIGNALS, surgeAtThreshold, type MeterCardId, type MeterRowId } from "../render/signals.ts";
import type { FeatureFrame } from "../audio/types.ts";
import type { DriveSourceChoice } from "../render/drives.ts";
import { driveSourceColor, jackKey } from "./driveSources.ts";
import { createJack, setRowFed, type JackHandle } from "./jack.ts";
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
  readoutStyle,
  rowHeadStyle,
  rowLabelStyle,
  rowRightStyle,
  spacer,
  unitStyle,
} from "./controlsKit.ts";
// The Hits card's Shape sliders reuse deviceMenu.ts's own slider row
// builder rather than duplicate it — see that file's header comment on
// createControlRow. deviceMenu.ts imports createAudioMeters from this file
// in the other direction; that's fine (nothing but createDeviceMenu/
// createAudioMeters actually call across the two at runtime, well after
// both modules have finished loading).
import { createControlRow } from "./deviceMenu.ts";
import { setHintText } from "./hintSwatches.ts";
import { createCanvasSizer } from "./canvasSizer.ts";

/**
 * The meters under the spectrum card: everything the audio pipeline already
 * derives besides the bands in spectrumStrip.ts, plus the two things a
 * spectrum can't show at all. Read-only cards in the panel's own row grammar
 * (see deviceMenu.ts / controlsKit.ts) — label, seven-segment readout, a
 * meter where a slider would be, and a hint that unfolds on hover or tap so
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
 *    mic by waveformAnalyser.ts. Local-only by construction — samples never
 *    cross src/net/protocol.ts's wire frame, so a mic-less renderer has
 *    nothing to show here and the row hides itself. (No stereo
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
 *    Energy over the last HISTORY_SPAN_SEC, with FeatureExtractor.fixedEnergy
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
 *    pulse on a hit.
 *  - Character: first, Section — sectionIntensity with a drop flash, the
 *    phrase-level trend the dials below are the instant-by-instant texture
 *    of. Then a 2-column grid of every entry in MUSIC_DIALS except
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
 * can't read faster anyway). Only the waveform is a canvas.
 *
 * Each card is independently collapsible (controlsKit.ts's createCard
 * foldId, remembered in panelFolds.ts) and update() skips a folded card's
 * work entirely — folding buys back the per-frame cost, not just the
 * screen space.
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
 * Song+Drop pair and Centroid, on the Brightness row (Character), the BPM
 * block's own Metronome+Tempo pair, Lock, the Timing strip's own
 * Grid/Metronome jacks (createTimingStrip) and Wave's Beat/Bar pair
 * (Tempo), and one per hits-history lane plus one for the Surge lane
 * under them, Onset surge's own (createHitsHistory's own laneMounts, Hits)
 * — plus the Bands card's own level rows (BAND_LEVEL_CHOICES, deviceMenu.ts)
 * and its Frequencies corner, built directly
 * in deviceMenu.ts. Every jack's click/hover/fill/usage state is
 * `deps.patch` (AudioMetersDeps's own doc comment); this file only ever
 * mounts them and, on refreshPatchView(), reads that state back into a
 * jack's own visuals and its row/lane's fed glow (jack.ts's setRowFed) —
 * never per frame, only on a selection or patch change. jackElements() is
 * the cable layer's (src/ui/cableLayer.ts, owned by deviceMenu.ts) own
 * source-endpoint lookup.
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
  /** Fed every frame while the panel is open. `frame`/`anim` null before
   *  audio is up (idle readouts); `mono`/`rawBands` null on any device
   *  without a local analyser (the Signal card's Waveform row hidden;
   *  Energy reads idle under RAW — see file header); `fixedEnergy` null on
   *  any device without a local FeatureExtractor (the History trace drops
   *  its reference line); `lufs` null on any device without a local
   *  lufsAnalyser (the Signal card's Loudness row and header Reset chip
   *  hidden). A folded card skips its computation and DOM writes for the
   *  frame — folding buys back the layout/canvas cost, not just the screen
   *  space. `rateScale` is app.ts's already-resolved sensitivity.ts's
   *  smoothingRateScale for this tick — non-finite (the Smoothing row's Off
   *  stop) bypasses this file's own BPM display (showing the raw estimate
   *  instead of tempoSettle.ts's settled reading), the same way `raw`
   *  already does, so RAW and processed agree exactly (see file header).
   *  `anim.wavePeak`'s own peak-hold answers to this same non-finite stop,
   *  but inside animClock.ts (it's handed the identical `smoothing` this
   *  tick, one call earlier in app.ts's loop), not to this `rateScale`
   *  parameter directly. `beatDiag` is FeatureExtractor.onsetDiag — this frame's
   *  full broadband onset diagnostic (ratio, gated, blocked — see
   *  onsetDiag.ts's OnsetDiag), null on the same devices as `fixedEnergy`
   *  (the hits history's Beat lane draws no ratio trace there, same as
   *  synthetic). `gate` is this device's own SilenceGateReading
   *  (src/audio/silenceGate.ts) — null on the same devices as `fixedEnergy`
   *  (the Signal card's Gate row reads idle; its trace still plots
   *  `frame.level` against the two marks, since that part doesn't need a
   *  local extractor). */
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
  /** Sets the meters' own raw mode (this file's own showRaw flag — see file
   *  header for what it changes per row). Called by deviceMenu.ts's one
   *  merged RAW chip alongside spectrumStrip.setShowRaw, so a single click
   *  always keeps the two in sync rather than this file owning a chip of
   *  its own. */
  setRaw(on: boolean): void;
  /** Unfolds `card` if needed (the same click-the-chevron move
   *  deviceMenu.ts's jumpToBlock makes for a folded settings card), scrolls
   *  `row` into view and flashes it — the "reacts to" strip's jump target
   *  (src/ui/deviceMenu.ts). A no-op if `row` was never registered (a
   *  MeterRowId with no matching createMeterRow/welded-block call). */
  revealRow(card: MeterCardId, row: MeterRowId): void;
  /** Refreshes every jack's fill/pressed/uses and each fed row/lane's
   *  glow, purely from `deps.patch` — called by deviceMenu.ts on a
   *  selection or patch change (a pin, a preview, an add/remove), never per
   *  frame (this file's own carried click-loss rule covers rebuilds, not
   *  this — but the same reasoning applies: nothing here is worth doing at
   *  frame rate). */
  refreshPatchView(): void;
  /** This card's own jacks, keyed by driveSources.ts's jackKey — the cable
   *  layer's (src/ui/cableLayer.ts) source endpoints. Never mutated after
   *  a jack is built. */
  jackElements(): ReadonlyMap<string, HTMLElement>;
}

export interface AudioMetersDeps {
  /** The Signal card's Reset chip (its header, beside Loudness): start the
   *  integrated reading over. */
  onLufsReset: () => void;
  /** The Signal card's Gate row's trace guides and the Hits card's hits
   *  history hint (hitsRuleHint) — the same two marks the Input card's
   *  Silence below/Sound above rows edit (src/audio/silenceGate.ts). Read
   *  fresh every draw()/text tick so dragging a mark in the Input card
   *  moves the dashed lines and the hint's numbers live. */
  getSilenceGate: () => SilenceGateMarks;
  /** The Hits card's Shape sliders — see src/audio/hitStrength.ts
   *  for the formula they shape. Global per device, like getSilenceGate
   *  above, not per scene: how a hit's stand-out and loudness blend into
   *  its pulse height is a taste about detection itself, not one scene's
   *  look, so it carries across scene switches the same way. */
  hitShape: { get: () => HitShape; set: (partial: HitShapePatch) => void };
  /** Every jack's behaviour and live state — see jack.ts's own header for
   *  why this file never touches a DriveSetting directly. Every predicate
   *  is keyed by the DriveSourceChoice a jack represents (driveSources.ts's
   *  jackKey collapses every beat-grid division to one shared identity, so
   *  a caller here never needs to know which one). deviceMenu.ts is the
   *  only implementation — it closes over `pinned`/`preview` and every
   *  scene setting's own patch. */
  patch: {
    /** How many of this scene's settings currently use `choice` — the
     *  jack's usage dots (always on, independent of selection). */
    usage(choice: DriveSourceChoice): number;
    /** `choice` feeds the shown (preview ?? pinned) setting — jack fill and
     *  a row/lane's hard glow. */
    isShown(choice: DriveSourceChoice): boolean;
    /** `choice` is a source of the *pinned* setting specifically — jack
     *  aria-pressed, i.e. what a click on it would toggle off. */
    isPinned(choice: DriveSourceChoice): boolean;
    /** `choice` is a source of the setting being *previewed* (a hover/
     *  focus short of a click) — but only while that preview is a
     *  genuinely different setting from whatever's pinned; hovering the
     *  pinned row itself never counts. A row/lane's soft glow, always
     *  taking priority over a competing pinned feed on the same row. */
    isPreview(choice: DriveSourceChoice): boolean;
    /** `isPinned`, but false when the matching source is muted (drives.ts's
     *  `DriveSource.off`) — use this (not `isPinned`) for a row/lane's own
     *  fed glow specifically: a muted source's jack still fills solid
     *  (`isShown`/`isPinned` stay mute-agnostic, since it's still plugged
     *  in — see deviceMenu.ts's own header), but its row stops glowing. */
    isPinnedActive(choice: DriveSourceChoice): boolean;
    /** `isPreview`, but false when the matching source is muted — see
     *  isPinnedActive above. */
    isPreviewActive(choice: DriveSourceChoice): boolean;
    /** True while isPreview(...) could return true for *something* — i.e.
     *  a different setting is being previewed than whatever's pinned right
     *  now. Drives whether a pinned feed on an uncontested row still gets
     *  its full glow, or steps back to a bare "faint" mark instead. */
    previewIsActive(): boolean;
    /** `choice` is named in the shown setting's own `drive.sceneSources`
     *  (a `"scene"` setting has no patch to plug/unplug, so this never
     *  drives a jack's own fill — only a row/lane's *soft* glow). */
    isSceneSource(choice: DriveSourceChoice): boolean;
    /** aria-label / title text for `choice`'s jack right now — phrased
     *  against whichever setting a click on it would actually reach
     *  (pinned, else the last previewed setting, else neither). */
    describe(choice: DriveSourceChoice): { aria: string; title: string };
    /** A pinned setting: toggles `choice` in its patch. Nothing pinned but
     *  something was previously previewed: pins that setting and toggles
     *  `choice` into it in the same click. Neither: a "Pick a setting
     *  first" toast, no change. */
    onJackClick(choice: DriveSourceChoice): void;
    /** Highlights every scene row `choice` currently feeds — independent
     *  of the shown-setting highlight above, this is purely "what does
     *  hovering *this* jack, right now, actually reach". */
    onJackHover(choice: DriveSourceChoice, on: boolean): void;
  };
}

const PEAK_FALL_PER_SEC = 1.2; // matches spectrumStrip.ts's peak-hold decay
const TEXT_REFRESH_MS = 100;
// Scale for a hit-history lane's ratio trace and the Curve's own x-axis
// (both OnsetDiag.ratio), in units of the ratio itself (1 = the firing
// line). An ordinary hit clears 1 by some margin but rarely reaches this —
// picked so the lanes and the curve have headroom rather than pinning at
// full on every beat.
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
// Tempo is a compact block welded beside the Lock row — the Auto master
// block's shape (deviceMenu.ts), framed like a woken .vc-row (the same ring
// and tint controlsTheme.ts gives the Lock row on hover, with the same
// 6px reach past the row's content) so the two read as one line. Digits,
// caption, and a beat dot beneath. The dot rests at a dim BEAT_COLOR that
// brightens with beatClock's tempoLock (an unconfident guess stays dim);
// each metronome tick it jumps to white inside a BEAT_COLOR halo and eases
// back into the colour as the halo fades — white-to-orange is the beat.
// A .vc-row's ring reaches 8px past its content into the card padding; the
// block reaches the same 8px on its right, and the gap between the two is
// what's left of that reach — so card edge → ring, ring → block, and block →
// card edge are all the same 4px.
//
// The block is also this card's jack host for anim.metronome/anim.tempo
// (mountJack, below): tempoJackHostStyle sits absolutely positioned at the
// block's own vertical center, its two jacks pinned to the block's left/
// right edges — using the block's *width*, never adding a row and so never
// growing the Lock row it's welded beside (weldedRowStyle's own
// align-items: stretch would otherwise carry any height this block gains
// straight into Lock's). The same weldedRowStyle also welds the Loudness
// card's bar beside its own LUFS block (createLufsBlock) — one shape for
// every "row plus a compact digits block" pairing in this file.
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
const DOT_EASE =
  "background-color 0.55s ease-out, box-shadow 0.55s ease-out, transform 0.55s ease-out";
const tempoDotStyle = `
  width: 6px; height: 6px; border-radius: 50%; margin: 5px auto 0;
  background-color: ${withAlpha(BEAT_COLOR, 0.25)}; box-shadow: 0 0 0 0 transparent;
  transition: ${DOT_EASE};
`;
const tempoDigitsStyle = `${digitsStyle} font-size: 13px; color: #fff; transition: color 0.4s ease-out;`;
const tempoCaptionStyle = `font: 400 8.5px/1.4 ${FONT_MONO}; letter-spacing: 0.14em; color: rgba(255,255,255,0.4); margin-top: 2px;`;
// The Signal card's Loudness row. The bar spans LUFS_SCALE_MIN..MAX — a
// broadcast meter's range, with the two targets people actually aim at
// marked: EBU R128's −23 for broadcast, and the level streaming services
// normalise to (LUFS_TARGET_STREAMING), above which the bar and digits go
// hot since a louder mix will just be turned down on delivery. The block
// beside the bar is the Tempo block's shape, wider for a signed
// one-decimal reading.
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
  "Tempo. The dot flashes white on every metronome tick and settles back to its colour, brighter as the tracker gets sure.";
// The settle rule that decides the digits below (a majority-agreement window
// over the raw estimate, so 124/125 flicker and half/double-time candidates
// don't reach the display) now lives in tempoSettle.ts, shared with
// metronome.ts — see that file's own header. This card just formats
// anim.metronomeBpm; the RAW chip / Smoothing Off bypass that settle and
// show the raw estimate instead (see this file's own header).
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
// The predicted-grid colour: the Tempo card's Timing strip (createTimingStrip)
// paints its Grid lane in this, and Wave's own bar wave reuses it — same
// blue as the auto-gain/auto-tune system, distinct from BEAT_COLOR so
// "detected" (red) and "predicted" (blue) never read as the same line.
const BEAT_GRID_COLOR = AUTO_SKY;
// The Signal card's own Gate row (src/audio/silenceGate.ts): a second trace,
// inserted under the Gate row's meter the way the Character card's Centroid
// row inserts its own, so it reads a little more crowded than the row above
// it and gets a bit more height. GATE_DIMMER_COLOR reuses the same blue as
// the auto-gain/auto-tune system (AUTO_SKY) at a dim alpha — the dimmer is
// a reference line like HISTORY_FIXED_COLOR above, not a primary reading.
// GATE_GUIDE_COLOR ties the dashed guide lines back to the Input card's own
// accent, since that's the card that edits the marks they trace.
const GATE_HISTORY_HEIGHT_CSS_PX = HISTORY_HEIGHT_CSS_PX + 16;
const GATE_DIMMER_COLOR = withAlpha(AUTO_SKY, 0.7);
const GATE_GUIDE_COLOR = withAlpha(INPUT_GREEN, 0.5);
// The Gate row's own trace draws Level (and the two guide lines) on a
// zoomed scale, not the full range Signal's History uses: the marks live
// near the bottom of FeatureFrame.level's range by design (they separate
// silence from quiet playback), so on the full scale both dashed lines and
// everything Level does around them collapse into the strip's bottom few
// pixels — the one region this trace exists to show. The strip's top is
// this multiple of the `open` mark instead, which pins that mark at
// mid-height wherever the slider puts it; Level past the top clamps there,
// which reads correctly as "well clear of the gate". GATE_LEVEL_TOP_MIN
// keeps the scale from blowing up when the marks are dragged to the very
// bottom. Dimmer stays on its own full scale — it's already 0..1. Dragging
// a mark rescales new columns only; the columns already drawn keep the
// scale they were recorded at until they scroll off.
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
  // Follows the width so the trace always spans exactly HISTORY_SPAN_SEC.
  let columnMs = 1000;

  // The history is one column per CSS pixel, so a width change rebuilds
  // (clears) it; a devicePixelRatio-only change keeps it — see canvasSizer.ts.
  const sizer = createCanvasSizer(canvas, ctx, {
    heightCssPx: heightPx,
    onWidthChange(w) {
      bufs = [];
      for (let i = 0; i < seriesCount; i++) bufs.push(new Float32Array(w).fill(Number.NaN));
      head = 0;
      columnMs = (HISTORY_SPAN_SEC * 1000) / w;
    },
  });
  const ensureSize = sizer.ensure;

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
      return sizer.width;
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
 *  Character card's Centroid trace (one series, no legend), the Signal
 *  card's Gate trace (its own series plus `guides`) and, exported for it, the Master
 *  card's Picture block (deviceMenu.ts — five one-series strips, one per
 *  src/render/pictureMeter.ts measure) all drive one of these.
 *
 *  `guides`, when given, replaces draw()'s own fixed mid-height line with
 *  dashed horizontal lines at each entry's `at` (0..1, the same y scale the
 *  series use) — the Gate trace's two Input-card marks. Read fresh every
 *  draw() call (not cached), since a mark can move while the card is open. */
export function createTraceStrip(series: TraceStripSeries[], heightPx: number, guides?: () => TraceStripGuide[]) {
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

export interface MeterRowSpec {
  label: string;
  accent: string;
  /** Mono suffix after the digits ("%", "bpm"). */
  unit?: string;
  /** The hint that unfolds on hover/tap. Omit for a row that explains
   *  itself (the waveform) — no hint, and nothing to focus for. */
  description?: string;
  /** The colour a word in `description` stands for when it names a trace
   *  drawn in a specific colour (hintSwatches.ts) — "red" beat ticks are
   *  `BEAT_COLOR`, not the generic red. */
  hintColors?: Readonly<Record<string, string>>;
  /** Fixed marks at these fractions of the track — the dials' NEUTRAL, the
   *  Loudness row's targets. A labelled tick gets its text just under the
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
  // Labels hang below the track, past the meter's fixed height — give them
  // room so they don't sit on the (collapsed) hint.
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
  let flashed = false;
  let lastReadoutKey = "";
  // What the fill settles back to after a flash — the accent unless
  // setFillColor has moved it (the Loudness bar going hot).
  let restColor = spec.accent;

  return {
    el,
    /** The head's right-hand slot (readout + whatever else) — a caller
     *  mounts a jack (src/ui/jack.ts) beside the readout here rather than
     *  this file forking a second row shape for a jack-bearing row. */
    right,
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
  let lit = false;
  let lastLockStep = -1;
  let shownBpm = 0;
  digits.textContent = "--";

  function settle(): void {
    dot.style.backgroundColor = restColor;
    dot.style.boxShadow = "0 0 0 0 transparent";
    dot.style.transform = "scale(1)";
  }

  return {
    el,
    /** The two jacks (anim.metronome, anim.tempo) mount here — see
     *  tempoBlockStyle's own comment for why this is absolutely positioned
     *  rather than a row. */
    jackHost,
    /** Per frame. `lock` (0..1) sets the resting tint; a lit dot eases back
     *  to it on the frame after its beat. `beat` is anim.metronomeBeat, not
     *  a raw hit — the dot now flashes with the metronome, same as this
     *  card's own number ticks with it. */
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
    /** At the text tick: `bpm` is already the number to show (0 = none) —
     *  the caller picks anim.metronomeBpm normally, or the unsettled raw
     *  estimate under the RAW chip / Smoothing Off (see this file's own
     *  header) — this just formats it. Keyed so a card that isn't
     *  repainting every tick doesn't rewrite identical text. */
    setBpm(bpm: number): void {
      const next = bpm > 0 ? Math.round(bpm) : 0;
      if (next === shownBpm) return;
      shownBpm = next;
      digits.textContent = shownBpm > 0 ? String(shownBpm) : "--";
    },
  };
}

// The Hits card's own hit history: one lane each for Beat (the broadband
// onset) and Low/Mid/High (bandEnergy.ts's per-group onsets), one canvas,
// one column per CSS pixel over HISTORY_SPAN_SEC (createColumnRing above).
// A history, not just an instant reading, so a tuning session can see *why*
// a hit did or didn't count. A fifth, trace-only Surge lane sits under them
// (not part of HITS_LANES: it has no hits, strengths or fires of its own) —
// the Onset surge drive source (signals.ts's "feature.flux") drawn as a
// setting would read it.
const HITS_LANE_HEIGHT_PX = 16;
const HITS_LANE_COUNT = 5; // Beat, Low, Mid, High, Surge
const HITS_HEIGHT_PX = HITS_LANE_HEIGHT_PX * HITS_LANE_COUNT;
// A lane's ratio trace runs to HITS_RATIO_MAX — 1 (the firing line) sits
// inside the track with headroom above it, rather than pinning the lane to
// full height on every ordinary hit.
const HITS_RATIO_MAX = ONSET_METER_MAX;
// Per-column series layout in the ring: [ratio, event code, strength,
// standout, loudness] per lane (hitsLaneIdx below), plus one shared
// ground-shade series (1 - anim.gateDimmer; the room isn't per-lane, so one
// series covers every lane), plus one Surge series (the Onset surge signal's
// own 0..1 reading) between the lanes' fields and the ground. Event code is fired=3 > blocked=2 > gated=1 > 0
// — see CODE_OF_VERDICT below — so a max-hold column resolves the right
// priority on its own when a burst of rAF ticks closes into one column.
// strength/standout/loudness (src/audio/hitStrength.ts's HitParts) are only
// ever written on the tick a lane actually fires — createColumnRing's own
// NaN-lifts-the-pen convention leaves every other column blank, the same
// convention the deleted Strength history used for its own bars.
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
// Same order as HITS_LANES — the drive source each lane's own jack plugs
// in. The Surge lane under them is Onset surge's own ("feature.flux") —
// see createHitsHistory's own laneMounts.
const HITS_LANE_CHOICES: readonly DriveSourceChoice[] = ["feature.onset", "anim.lowOnset", "anim.midOnset", "anim.highOnset"];
const SURGE_CHOICE: DriveSourceChoice = "feature.flux";
const HITS_FIELDS_PER_LANE = 6; // ratio, code, strength, standout, loudness, pulse

/** Where lane `li`'s own fields sit in the ring's per-column series —
 *  factored out so createHitsHistory's own update()/draw() don't hand-roll
 *  the same `* HITS_FIELDS_PER_LANE` arithmetic in two places. */
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
    "Surge: how close Beat is to firing, as a setting fed by Onset surge sees it; the line is where Beat fires.",
    gate,
  ].join(" ");
}

function laneNote(ratio: number | null, fires: number): string {
  return `${ratio === null ? "--" : ratio.toFixed(2)} · ${fires}/${HISTORY_SPAN_SEC}s`;
}

/** The Hits card's per-lane legend note while Shape is open — that lane's
 *  last fired hit's three numbers. `anim.hitStrength.*` (see animClock.ts)
 *  always holds a valid HitParts once `anim` exists (initial zeros before
 *  that lane's very first hit, then the last one's numbers from then on),
 *  so this only reads "--" while there's no anim at all — idle, same as
 *  every other row's convention in this file. */
function hitStrengthNote(parts: HitParts | null): string {
  if (!parts) return "--";
  return `${parts.standout.toFixed(2)} · ${parts.loudness.toFixed(2)} → ${parts.strength.toFixed(2)}`;
}

/** Mounts a jack for `choice` into `host` and registers it for the shared
 *  row-level fed/dim treatment against `feedEl` (jack.ts's setRowFed) — see
 *  createAudioMeters' own mountJack for what it actually does; threaded
 *  down as a plain callback so createHitsHistory never needs to know
 *  `deps.patch`'s own shape. */
type MountJack = (choice: DriveSourceChoice, host: HTMLElement, feedEl: HTMLElement) => JackHandle;

/** The Hits card's own hit history row. Feeds: Beat from `frame.onset` (the
 *  detector edge, pre-grid — the Tempo card's Timing strip shows it against
 *  the grid) and `beatDiag` (device-local only, see AudioMeters.update's own
 *  doc — a null diag still lets `fired`/"miss" through, just with no ratio
 *  trace and no gated/blocked distinction, hence "no ratio trace on
 *  synthetic/renderer"); Low/Mid/High from `anim.lowOnset`/`midOnset`/
 *  `highOnset` and `anim.hits.low/mid/high` (always available once `anim`
 *  exists, local or remote — bandEnergy.ts runs everywhere); ground shading
 *  from `1 - anim.gateDimmer` — the same dimmer the Signal card's Gate row
 *  shows — so a half-open gate reads lighter than a shut one. A fired
 *  column's strength/standout/loudness come from `anim.hitStrength.*`
 *  (src/audio/hitStrength.ts) — see this function's own draw() for how
 *  they're used. */
function createHitsHistory(getSilenceGate: () => SilenceGateMarks, mountJack: MountJack) {
  const row = createMeterRow({
    label: "Hits",
    accent: NEUTRAL_ACCENT,
    unit: "s",
    description: `${hitsRuleHint(getSilenceGate)} A fired tick's height is its graded strength (Shape).`,
  });
  const ring = createColumnRing(HITS_SERIES_COUNT, HITS_HEIGHT_PX);
  const ctx = ring.ctx;
  // HITS_LANES' own lane jacks mount absolutely inside this wrapper rather
  // than the row itself (which is `position: relative` too, but its own top
  // edge is above the head and shifts with font metrics) — the wrapper's
  // own top edge is exactly the canvas's, so `i * HITS_LANE_HEIGHT_PX`
  // lands each jack on its own lane without measuring anything.
  const vizWrap = document.createElement("div");
  vizWrap.style.cssText = "position: relative; margin-top: 4px;";
  ring.canvas.style.marginTop = "0";
  vizWrap.appendChild(ring.canvas);
  row.el.children[1].replaceWith(vizWrap);
  row.setReadout(String(HISTORY_SPAN_SEC));

  const surgeColor = driveSourceColor(SURGE_CHOICE);
  const legend = createTraceLegend([
    ...HITS_LANES.map((l) => ({ color: l.color, label: l.label })),
    { color: surgeColor, label: "Surge" },
  ]);
  vizWrap.after(legend.el);

  // One jack per lane, at that lane's own vertical centre on the right
  // edge — feedEl is the shared row (every HITS_LANES entry lives on one
  // canvas), so the row dims/glows as a whole; laneMounts below is what
  // lets refreshPatchView pick out *which* lane to also glow.
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
  // The Surge lane's jack: the broadband detector's own approach-to-firing
  // reading (Onset surge, "feature.flux") — the old Onset row's own jack,
  // moved here now that row is gone, and onto a lane of its own so the
  // trace a patched setting reads is the one under it.
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

  // Fire timestamps per lane, for the legend's "N fires in the last span"
  // note — pruned to HISTORY_SPAN_SEC, same window the trace shows. Pruned
  // when a fire is logged as well as on read: the legend (the only reader)
  // is skipped while the Shape disclosure is open, and a log that is only
  // pruned on read would grow for as long as Shape stays open.
  const fireLog: number[][] = HITS_LANES.map(() => []);
  function pruneFires(lane: number, nowMs: number): number[] {
    const log = fireLog[lane];
    const cutoff = nowMs - HISTORY_SPAN_SEC * 1000;
    let stale = 0;
    while (stale < log.length && log[stale] < cutoff) stale++;
    if (stale > 0) log.splice(0, stale);
    return log;
  }
  function logFire(lane: number, nowMs: number): void {
    pruneFires(lane, nowMs).push(nowMs);
  }
  function firesInSpan(lane: number, nowMs: number): number {
    return pruneFires(lane, nowMs).length;
  }

  function laneTop(laneIdx: number): number {
    return laneIdx * HITS_LANE_HEIGHT_PX;
  }
  /** `frac` is already 0..1 (a graded strength/standout/loudness/Floor
   *  reading) — unlike laneY below, which still has HITS_RATIO_MAX to
   *  divide out first. */
  function laneYFrac(laneIdx: number, frac: number): number {
    return laneTop(laneIdx) + 1 + (1 - clamp(frac, 0, 1)) * (HITS_LANE_HEIGHT_PX - 2);
  }
  function laneY(laneIdx: number, ratio: number): number {
    return laneYFrac(laneIdx, ratio / HITS_RATIO_MAX);
  }

  /** `shapeOpen`/`floor` gate the Shape-only drawing in step 5 below — see
   *  createHitsHistory's own update() for who supplies them. */
  function draw(shapeOpen: boolean, floor: number): void {
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

    // 3b. The Surge lane: a filled trace of the Onset surge signal (already
    // 0..1), with a hairline where Beat fires on that scale — the same
    // line the lanes above carry at ratio == 1.
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

    // 3c. Shape open only: each lane's own decaying pulse — the very value a
    // scene reads, so a Length row's (and Smoothing's) effect on real hits
    // shows as each tick's tail, and a tail still up when the next hit
    // lands shows as overlap. Under the ticks, so they stay on top.
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

    // 4. The event tick: fired is a bar up to that hit's own graded
    // strength (0..1 of the lane height, exactly full at Dimension 0 — see
    // src/audio/hitStrength.ts); blocked (refractory) and gated (silence
    // gate) stay full-height dim/faint marks, same as before grading
    // existed.
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

    // 5. Shape open only: a dashed Floor guide per lane (the old Strength
    // history's own dash code) and each fired column's stand-out/loudness
    // parts as two small dots, the same colours that deleted history used —
    // so dragging a Shape slider shows exactly what it did to a real hit.
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
    /** `shapeOpen`/`floor` gate the extra Shape-only drawing and switch the
     *  legend's own notes between laneNote (closed) and hitStrengthNote
     *  (open) — the Curve itself is drawn separately (createHitCurve, in
     *  createAudioMeters), since it isn't part of this row's own canvas. */
    update(
      frame: FeatureFrame | null,
      anim: AnimFrame | null,
      beatDiag: OnsetDiag | null,
      nowMs: number,
      text: boolean,
      shapeOpen: boolean,
      floor: number,
    ): void {
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
        // Like the Beat ratio trace, only there with a local detector
        // (beatDiag) — anim.beatRatio is 0 on a TV/renderer, which would
        // draw a flat line that looks like silence rather than "no reading".
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
          legend.setNote(0, laneNote(beatDiag ? beatDiag.ratio : null, firesInSpan(0, nowMs)));
          legend.setNote(1, laneNote(anim ? anim.hits.low.ratio : null, firesInSpan(1, nowMs)));
          legend.setNote(2, laneNote(anim ? anim.hits.mid.ratio : null, firesInSpan(2, nowMs)));
          legend.setNote(3, laneNote(anim ? anim.hits.high.ratio : null, firesInSpan(3, nowMs)));
        }
        // The two marks in the hint can move (the Input card's Silence
        // below/Sound above rows) — recompute and only touch the DOM when
        // it actually changed.
        const hint = `${hitsRuleHint(getSilenceGate)} A fired tick's height is its graded strength (Shape).`;
        if (hint !== lastHint) {
          lastHint = hint;
          setHintText(row.el.querySelector<HTMLElement>(".vc-hint")!, hint);
        }
      }
    },
    resetColumn(): void {
      ring.resetColumn();
    },
    laneMounts,
  };
}

// The Tempo card's Timing strip: Grid/Metronome/Heard on one shared time
// axis (createColumnRing above), replacing the old separate Beat and
// Metronome rows — the point of one strip is seeing what the tracker
// predicts against what actually rang the metronome and what the detector
// actually heard, all against the same columns.
// A jack is 13px tall (createHitsHistory's own lane-centring math); a
// lane any shorter would make the Grid and Metronome lanes' jacks touch.
const TIMING_LANE_HEIGHT_PX = 14;
const TIMING_LANE_COUNT = 3; // Grid, Metronome, Heard
const TIMING_HEIGHT_PX = TIMING_LANE_HEIGHT_PX * TIMING_LANE_COUNT;
// Metronome's own pale sky, distinct from BEAT_GRID_COLOR's fuller AUTO_SKY
// so Grid and Metronome never read as the same line stacked on itself —
// lighter, not more transparent: a dimmed AUTO_SKY on the dark card was too
// faint to tell a beat tick from a bar tick.
const TIMING_METRO_COLOR = "#cfe8ff";
// The Metronome lane's jack sends Metronome bar (signals.ts's
// anim.metronomeBar), one pulse per bar, so the bar tick is the lane's own
// reading at full height and full colour; the beats between are context for
// lining Heard up against, kept short and faint so they don't read as pulses
// the jack sends too (a patched setting's "What it receives" graph shows one
// bump per bar, and a lane of equal ticks under that jack contradicted it).
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

/** The Tempo card's Timing strip. Grid: on a beatPhase wrap (the old Beat
 *  row's own prevBeatPhase logic, moved here) a tick as tall as tempoLock,
 *  else nothing — an unconfident tracker draws a short tick, same
 *  "unconfident reads as unconfident" convention the tempo dot uses. Metro:
 *  metronome.ts's own even tick: full and bright on the bar (metronomeBar,
 *  what this lane's jack sends), short and faint on the other beats
 *  (metronomeBeat). Heard: `frame.onset`, the exact edge the Hits card's
 *  Beat lane marks as fired. A detection landing under a grid tick reads as
 *  locked; one between ticks reads as a double; a grid tick with nothing
 *  under it reads as a miss. */
function createTimingStrip(mountJack: MountJack) {
  const row = createMeterRow({
    label: "Timing",
    accent: NEUTRAL_ACCENT,
    unit: "s",
    description:
      "Grid (blue) is the tracker's predicted beat, tall when it's sure; Metronome ticks steadily at the BPM above: faint on each beat, bright on the bar, and only the bar goes out its jack; Heard (red) is every beat the detector caught. Red under blue is on the beat; red alone is a double; blue with nothing under it is a miss.",
    hintColors: { red: BEAT_COLOR, blue: BEAT_GRID_COLOR },
  });
  const ring = createColumnRing(TIMING_LANES.length, TIMING_HEIGHT_PX);
  const ctx = ring.ctx;
  const vizWrap = document.createElement("div");
  vizWrap.style.cssText = "position: relative; margin-top: 4px;";
  ring.canvas.style.marginTop = "0";
  vizWrap.appendChild(ring.canvas);
  row.el.children[1].replaceWith(vizWrap);
  row.setReadout(String(HISTORY_SPAN_SEC));

  const legend = createTraceLegend(TIMING_LANES.map((l) => ({ color: l.color, label: l.label })));
  vizWrap.after(legend.el);

  // Grid's own jack (the same beat-grid choice the old Beat row mounted)
  // and Metronome's own (anim.metronomeBar), each centred on its own lane —
  // mounted absolutely inside vizWrap like createHitsHistory's own
  // laneMounts, but needing no lane glow of their own: the row-level fed
  // glow mountJack already gives every jack is enough here, since neither
  // lane shares a jack with a second choice.
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
    const w = ring.width;
    const len = ring.length;
    ctx.clearRect(0, 0, w, TIMING_HEIGHT_PX);

    // A full-height guide wherever Grid marks a tick, so a Heard tick
    // elsewhere in the same column (a double) or its absence (a miss) reads
    // against the column the grid actually predicted.
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    for (let x = 0; x <= len; x++) {
      const g = x === len ? ring.live(0) : ring.at(x, 0);
      if (!(g > 0)) continue;
      ctx.fillRect(x === len ? w - 1 : x, 0, 1, TIMING_HEIGHT_PX);
    }

    // Lane dividers.
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    for (let li = 1; li < TIMING_LANES.length; li++) {
      ctx.fillRect(0, li * TIMING_LANE_HEIGHT_PX - 0.5, w, 1);
    }

    // Ticks bottom-up per lane, height proportional to the column's own
    // value — NaN (or 0) draws nothing. A Metronome beat (anything under the
    // bar's 1) is the faint context tick, not the lane's own reading.
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
    update(frame: FeatureFrame | null, anim: AnimFrame | null, nowMs: number): void {
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
      draw();
    },
    /** Also forgets the last phase, same reasoning as the old Beat row's own
     *  fold guard — unfolding mid-track shouldn't read the jump across the
     *  fold as a wrap. */
    resetColumn(): void {
      ring.resetColumn();
      prevBeatPhase = null;
    },
  };
}

// ---- The Hits card's Shape disclosure: the Curve monitor ---------------
// (src/audio/hitStrength.ts) — the sliders it sits beside are plain
// createControlRow instances built in createAudioMeters below.

const HIT_CURVE_HEIGHT_CSS_PX = 56;

/** The knee curve — hitStandout(ratio, knee) plotted for ratio in
 *  1..ONSET_METER_MAX — plus a dot per HITS_LANES lane at that lane's own
 *  last-hit ratio, so dragging Knee shows exactly what it does to a real
 *  hit rather than just a number moving. A function plot, not a rolling
 *  history: nothing to accumulate per frame, so draw() just takes this
 *  tick's inputs and redraws from scratch (a canvas clear plus a few dozen
 *  line segments is cheap — see file header's "fills move every frame"
 *  rule). */
// ---- The Shape section's Length group ----

// A row's ms is the time a pulse takes to fall to e^-3 (about 5%) of its
// height, i.e. 3 / rate — round numbers at the base rates, and about where
// a pulse stops reading on screen.
const TAIL_FADE_TIME_CONSTANTS = 3;
/** Each lane's base pulse decay rate, per second — read from the modules
 *  that own them, never re-typed, the same rule as drives.ts's
 *  heightDecayPerSec. */
const LANE_DECAY_PER_SEC: Readonly<Record<HitLane, number>> = {
  beat: BEAT_PULSE_DECAY_PER_SEC,
  low: GROUP_TUNING.low.pulseDecayRate,
  mid: GROUP_TUNING.mid.pulseDecayRate,
  high: GROUP_TUNING.high.pulseDecayRate,
};
/** How long `lane`'s pulse takes to fade at tail multiple `tail`, in ms,
 *  before Smoothing. */
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

// Whether the Length rows move together — how you like to drag them, not
// how anything looks, so it stays on this device (syncedStores.ts's
// PRIVATE_KEYS). Absent = linked.
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

/** The Length group's Envelope monitor: each lane's pulse shape after a hit
 *  (e^(-rate·t)) over TAIL_ENVELOPE_BEATS beats, with dashed beat lines and
 *  a hairline at the fade level the rows' ms count to. Redrawn every frame
 *  while Shape is open — the last-hit dots move. */
function createTailEnvelope() {
  const canvas = document.createElement("canvas");
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
  canvas.style.cssText = `display: block; width: 100%; height: ${HIT_CURVE_HEIGHT_CSS_PX}px; margin-top: 4px;`;
  const ctx = canvas.getContext("2d")!;

  /** Same "no layout yet" guard as every other canvas in this file (see
   *  canvasSizer.ts) — a folded/closed panel has no width to draw at. */
  const sizer = createCanvasSizer(canvas, ctx, { heightCssPx: HIT_CURVE_HEIGHT_CSS_PX });

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
      // rather than a clear+stroke+rect read every frame. The size check
      // stays first so a panel resize still repaints.
      if (!sizer.ensure()) return;
      // `sizer.version` stands in for the width: resizing the backing store
      // (a new width, or a new devicePixelRatio) clears the plot.
      const key = `${sizer.version}|${knee}|${laneRatios.join(",")}`;
      if (key === lastKey) return;
      lastKey = key;
      const w = sizer.width;
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

/** The Signal card's Loudness welded block: Short-term as the big
 *  seven-segment reading (toFixed's ASCII minus renders in DSEG7), "LUFS"
 *  under it, and the Integrated reading beneath that. Digits go hot past
 *  LUFS_HOT. */
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
/** Shows or hides a Signal-card row that only exists with a local mic.
 *  Restores the element's own inline display rather than blanking it — a
 *  row built with `display: flex` in its cssText (the welded Loudness row)
 *  would otherwise fall back to block and stack its LUFS block under the bar. */
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

// The Sound/Beat/Song dividers between cards — plain `div`s appended
// straight into `root` (and, for "Sound", into deviceMenu.ts's own column
// head block above the Bands card — see meterGroupHeading's own export),
// not part of any card. Modelled on controlsKit.ts's
// own groupHeadingFirstStyle (mono, uppercase, letter-spaced, dim) rather
// than its bordered groupHeadingStyle: a border here would read as a second
// card edge sitting right under the real one, and these mark a break
// between whole cards, not a run of rows inside one. The extra top margin
// (groupHeadingFirstStyle's own is sized for sitting flush under a card's
// header) is what actually separates a heading from the card above it.
const meterGroupHeadingStyle = `${groupHeadingFirstStyle} margin: 18px 0 8px;`;

/** Exported so deviceMenu.ts can build the "Sound" heading (in its own
 *  column head block, right above the Bands card) with the identical look
 *  this file uses for "Beat"/"Song" below — one owner for the style, since
 *  the three headings mark one continuous Sound/Beat/Song sequence split
 *  only by the Bands card sitting between the first heading and the rest. */
export function meterGroupHeading(text: string): HTMLElement {
  const el = document.createElement("div");
  el.textContent = text;
  el.style.cssText = meterGroupHeadingStyle;
  return el;
}

// The Character card's dial grid (every MUSIC_DIALS entry but brightness,
// which gets its own full-width row below instead — see this file's header)
// — two columns rather than the stacked rows every other card uses, since
// seven-odd one-line dial rows made Character the tallest card by far with
// nothing but whitespace between short label/tick/hint rows to show for it.
const characterGridStyle = `display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 16px;`;

export function createAudioMeters(deps: AudioMetersDeps): AudioMeters {
  const root = document.createElement("div");
  root.className = "vc-meters vc-scroll";

  // Every jack this card mounts, plus which row/lane each one feeds when
  // lit — see jack.ts's own header. `feedEl` groups jacks that share a row
  // (the Section row's Song+Drop, every hits lane's shared Hits row) so
  // refreshPatchView below only ever writes that row's fed state once.
  const jackRegistry: { choice: DriveSourceChoice; jack: JackHandle; feedEl: HTMLElement }[] = [];
  const jackElementsMap = new Map<string, HTMLElement>();

  /** Builds one jack, wires it straight to `deps.patch`, and registers it
   *  for refreshPatchView's own row-level glow/dim pass below. `host` is
   *  where the jack's own element mounts (a row's `right` slot, or a
   *  positioning wrapper for a hits lane); `feedEl` is the row/lane that
   *  glows when this jack lights — usually the same element as `host`,
   *  different only where the jack itself is absolutely positioned inside
   *  a sub-wrapper (createHitsHistory's own vizWrap) but the glow/dim
   *  belongs to the row as a whole. */
  function mountJack(choice: DriveSourceChoice, host: HTMLElement, feedEl: HTMLElement): JackHandle {
    const jack = createJack(
      driveSourceColor(choice),
      () => deps.patch.onJackClick(choice),
      (on) => deps.patch.onJackHover(choice, on),
    );
    host.appendChild(jack.el);
    jackRegistry.push({ choice, jack, feedEl });
    jackElementsMap.set(jackKey(choice), jack.el);
    return jack;
  }

  // Set only by the returned object's setRaw — see this file's header and
  // AudioMeters.setRaw's own doc comment for why this file no longer owns a
  // RAW chip of its own.
  let showRaw = false;

  // ---- Signal: Waveform, Level, Loudness, Energy, History, Gate ----
  // Waveform leads the card — see file header. The trace takes the meter's
  // place under the head, like History/Gate's own traces below.
  const waveform = createMeterRow({
    label: "Waveform",
    accent: NEUTRAL_ACCENT,
    unit: "%",
  });
  const waveCanvas = document.createElement("canvas");
  waveCanvas.style.cssText = waveCanvasStyle;
  waveform.el.children[1].replaceWith(waveCanvas);
  const waveCtx = waveCanvas.getContext("2d")!;
  mountJack("anim.wavePeak", waveform.right, waveform.el);
  // Row + its own trailing spacer, toggled together on any device with no
  // local mic (mono === null) — see update()'s own Signal block.
  const waveformSpacer = spacer();

  const level = createMeterRow({
    label: "Level",
    accent: INPUT_GREEN,
    unit: "%",
    description:
      "How loud the room is on a fixed quiet-to-loud scale. Doesn't auto-adjust: a quiet room reads low and stays low.",
  });

  // Loudness: the broadcast measurement — BS.1770 / EBU R128 LUFS from
  // lufsAnalyser.ts (math in lufs.ts). The bar and this row's own readout
  // are Momentary (the last 400 ms); the welded block beside it is
  // Short-term (the last 3 s) over Integrated (the gated average since
  // Reset — the card header's own Reset chip below, not a row of its own).
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
  // Row + its own trailing spacer, toggled together (with the card header's
  // own Reset chip below) on any device with no local lufsAnalyser — see
  // update()'s own Signal block.
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
  // The silence gate's own live reading (src/audio/silenceGate.ts) — see
  // this file's header for what the row and its trace show, and why a
  // mic-less device (renderer, synthetic feed) reads idle here the same way
  // it does on the Hits card's own hits history. Inserted the way the
  // Character card's Centroid row inserts its own trace: the meter (Dimmer)
  // stays, a canvas is spliced in under it before the hint.
  const gateRow = createMeterRow({
    label: "Gate",
    accent: INPUT_GREEN,
    unit: "%",
    description:
      "How much of a hit's strength the silence gate is currently letting through — full: beats are detected exactly as before; empty: the room is silent and nothing can fire. Below, Level against the two Input-card marks (dashed, zoomed so the upper one sits mid-height) and the Dimmer itself over time. Hits the gate actually stops show up as faint ticks on the Hits card instead of a series here.",
  });
  // Paint order: Dimmer then Level on top — the same "Level lands last"
  // order Signal's own History uses.
  const gateHistoryStrip = createTraceStrip(
    [
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
  gateRow.el.insertBefore(gateHistoryStrip.canvas, gateRow.el.children[2]);
  const gateLegend = createTraceLegend([
    { color: HISTORY_LEVEL_COLOR, label: "Level" },
    { color: GATE_DIMMER_COLOR, label: "Dimmer" },
  ]);
  gateHistoryStrip.canvas.after(gateLegend.el);
  const signalCard = createCard({
    title: "Signal",
    accent: INPUT_GREEN,
    foldId: "signal",
    right: lufsResetChip,
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
  // Row-level visibility (mono/lufs null on a device with no local
  // analyser) — see update()'s own Signal block for the toggles and the
  // "don't accumulate a column while hidden" behaviour they carry.
  // null until the first unfolded tick applies the real state: the rows are
  // built visible, so a mic-less device (where nothing ever shows) must still
  // get its first setShown(false) rather than compare false !== false.
  let waveformShown: boolean | null = null;
  let lufsShown: boolean | null = null;

  // ---- Hits ----
  const hitsHistory = createHitsHistory(deps.getSilenceGate, mountJack);
  // Shape: the sliders that turn a fired tick's fixed height into its own
  // graded strength (src/audio/hitStrength.ts), folded away by default —
  // see createAdvancedSection's own header for why a disclosure like this
  // starts closed where a card's fold starts open. Controls and monitors
  // together: each slider's effect is exactly what the hits history's own
  // dashed Floor line/stand-out-and-loudness dots (while this is open) and
  // the Curve below show.
  const hitsShape = createAdvancedSection("hitsShape", "shape");
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

  // Length: how long each lane's pulse rings out (hitStrength.ts's
  // `shape.tail`). Stored as a multiple of that lane's own fall, shown as
  // the time it comes to (laneFadeMs), so a row reads in ms while an
  // untouched one stays exactly 1. Linked (the default) moves every lane by
  // the same ratio, so Low stays longer than High; unlinked, each row is
  // its own. The Envelope monitor draws what the rows add up to.
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
    // One ratio for every lane, narrowed so none runs past its range —
    // proportions hold even when the dragged lane would push another off
    // its end (the dragged row then snaps back to where that stops it).
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

  // Per-lane last-hit ratio, for the Curve's own dots — updated only on the
  // tick each lane fires (see the update() block below), so a dot always
  // marks a real hit rather than the ratio's live wander below the line.
  const lastHitRatio: (number | null)[] = [null, null, null, null];
  // Per-lane last-hit time, for the Envelope's own dots — same lanes and
  // same "only on the tick it fires" rule.
  const lastHitMs: (number | null)[] = [null, null, null, null];
  const sinceHitSec: (number | null)[] = [null, null, null, null];

  const hitsCard = createCard({ title: "Hits", accent: NEUTRAL_ACCENT, foldId: "hits" });
  hitsCard.body.append(hitsHistory.el, spacer(), hitsShape.el);

  // ---- Tempo ----
  const tempo = createTempoBlock(NEUTRAL_ACCENT);
  // Both mount here rather than on a row of their own — the Tempo card's
  // BPM *is* the metronome's number now, so this is the one place both
  // jacks belong (see signals.ts's own MeterRowId comment and mountJack's
  // "one mount per choice" doc below).
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

  const timingStrip = createTimingStrip(mountJack);

  // The two "shape of the beat" drives that read straight off the
  // metronome — a smooth swing rather than a hit — traced on one shared row
  // the same way createHitsHistory's own lanes share the Hits row.
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
  );
  wave.el.children[1].replaceWith(waveTrace.canvas);
  wave.setReadout(String(HISTORY_SPAN_SEC));
  mountJack("anim.beatWave", wave.right, wave.el);
  mountJack("anim.barWave", wave.right, wave.el);

  const tempoCard = createCard({ title: "Tempo", accent: NEUTRAL_ACCENT, foldId: "tempo" });
  tempoCard.body.append(tempoWelded, spacer(), timingStrip.el, spacer(), wave.el);

  // ---- Character ----
  const section = createMeterRow({
    label: "Section",
    accent: NEUTRAL_ACCENT,
    unit: "%",
    description:
      "How intense this part of the track is against the last while. Flashes red on a drop.",
  });
  mountJack("anim.sectionIntensity", section.right, section.el);
  mountJack("anim.dropOnset", section.right, section.el);
  // Every MUSIC_DIALS entry except brightness, which gets its own full-width
  // row below (with the live Centroid trace under its bar) instead of a grid
  // cell — filtered, never a hardcoded list, so a new dial lands in the grid
  // by construction.
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
  dialRows.forEach(({ row }) => dialGrid.appendChild(row.el));

  // Brightness: the dial's own meter row (readout = the slow, eased dial
  // value, same as every other dialRows entry), with spectralCentroid.ts's
  // fast, range-adapted Centroid traced directly under its bar rather than a
  // row of its own — it's the live signal Brightness is the track-level
  // summary of, not a MUSIC_DIALS entry.
  const brightnessRow = createMeterRow({
    label: DIAL_LABELS.brightness.label,
    accent: AUTO_SKY,
    description: DIAL_LABELS.brightness.description,
    ticks: [{ at: NEUTRAL.brightness }],
  });
  mountJack("anim.centroid", brightnessRow.right, brightnessRow.el);
  // Inserted before the hint (el's 3rd child), so it sits under the meter
  // like the Signal card's History. RAW briefly mixes raw/processed samples
  // in the same trace right after a toggle, until HISTORY_SPAN_SEC rolls the
  // pre-toggle column out — harmless, and self-heals. The small legend under
  // it is what tells the two readings (the bar's own Brightness value, the
  // trace's live Centroid) apart.
  const centroidTrace = createTraceStrip([{ color: AUTO_SKY, width: 1.5 }], CENTROID_TRACE_HEIGHT_CSS_PX);
  brightnessRow.el.insertBefore(centroidTrace.canvas, brightnessRow.el.children[2]);
  const centroidLegend = createTraceLegend([{ color: AUTO_SKY, label: "Centroid (live)" }]);
  centroidTrace.canvas.after(centroidLegend.el);

  const characterCard = createCard({ title: "Character", accent: AUTO_SKY, foldId: "character" });
  characterCard.body.append(section.el, spacer(), dialGrid, spacer(), brightnessRow.el);

  // Sound/Beat/Song, per the file header. Signal leads Sound: it's the raw
  // picture of the sound itself, and the first thing to check when the
  // visuals seem off.
  root.append(
    signalCard.el,
    meterGroupHeading("Beat"),
    hitsCard.el,
    tempoCard.el,
    meterGroupHeading("Song"),
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
  // layout width changes — same as spectrumStrip.ts (both via canvasSizer.ts,
  // which returns false while the canvas has no layout: the card is folded or
  // the panel is closed, so the wave history isn't rebuilt against a clamped
  // 1px). The history is one column per CSS pixel, so it's rebuilt (cleared)
  // with the width; a ratio-only change keeps it.
  const waveSizer = createCanvasSizer(waveCanvas, waveCtx, {
    heightCssPx: WAVE_HEIGHT_CSS_PX,
    onWidthChange(w) {
      histMin = new Float32Array(w);
      histMax = new Float32Array(w);
      histClip = new Uint8Array(w);
      head = 0;
    },
  });
  const ensureWaveSize = waveSizer.ensure;

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
    const w = waveSizer.width;
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

  // src/render/signals.ts's monitor anchors — populated on demand as a
  // SignalSpec starts pointing at a card/row, never exhaustively (see
  // MeterCardId/MeterRowId's own doc comments). section.el and tempo.el (and
  // lock.el) are the actual flash/scroll targets, not their shared welded
  // wrapper, so a jump highlights only the half of the welded row the
  // signal is about.
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
    ["wave", wave.el],
    ["lock", lock.el],
    ["timing", timingStrip.el],
    ["waveform", waveform.el],
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
      // Infinity there) — bypasses this file's own BPM settle the same way
      // `raw` does (animClock.ts's own wavePeak hold answers to the same
      // stop independently, off the identical `smoothing` value), so RAW
      // has nothing left to show that the processed reading doesn't already
      // match (see file header).
      const smoothingOff = !Number.isFinite(rateScale);

      // ---- Signal: Waveform, Level, Loudness, Energy, History, Gate ----
      // Level is already raw and doesn't change; Energy's raw counterpart
      // is rawBands (see file header), local-only like mono. Gate has no RAW
      // branch: it's already an instant, local reading with no pre-smoothing
      // counterpart threaded through AnimFrame to switch to.
      if (!signalCard.fold?.isFolded()) {
        // Waveform — hidden (with its own trailing spacer) on any device
        // with no local mic; see AudioMeters.update's own doc comment.
        const showWaveform = mono !== null;
        if (showWaveform !== waveformShown) {
          waveformShown = showWaveform;
          setShown(waveform.el, showWaveform);
          setShown(waveformSpacer, showWaveform);
        }
        if (mono) {
          const clipped = isClipping(mono);
          pushWave(mono, clipped, nowMs);
          drawWave();
          const instPeak = peak(mono);
          // The held reading is AnimFrame.wavePeak (animClock.ts), not local
          // state here, so this readout and the Waveform jack's own
          // `anim.wavePeak` drive source read one number. instPeak covers a
          // tick with no anim frame yet.
          if (text) {
            if (clipped)
              waveform.setReadout("CLIP", {
                textual: true,
                color: HOT_RED,
                unit: "",
              });
            else waveform.setReadout(pct(raw ? instPeak : anim ? anim.wavePeak : instPeak));
          }
        } else {
          // Don't accumulate a column while there's nothing to sample — on
          // mono's return this starts a fresh one instead of the elapsed gap
          // reading as a stall and committing a burst of catch-up columns
          // (see pushWave).
          colStartMs = null;
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
          historyStrip.push([fixedEnergy, frame.energy, frame.level], nowMs);
          historyStrip.draw();
          histLegend.setEntryEnabled(2, fixedEnergy !== null);
        }

        // Loudness — hidden (with its own trailing spacer, and the card
        // header's own Reset chip) on any device with no local lufsAnalyser.
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
        // Level plots off `frame` regardless of `gate` — it doesn't need a
        // local extractor — while Dimmer goes null wherever `gate` itself
        // does (see AudioMeters.update's own doc comment).
        if (frame || gate) {
          gateHistoryStrip.push(
            [gate ? gate.dimmer : null, frame ? frame.level / gateLevelTop(deps.getSilenceGate()) : null],
            nowMs,
          );
          gateHistoryStrip.draw();
        }
      } else {
        // Folded: don't accumulate a column while hidden, same as every
        // other trace below.
        colStartMs = null;
        historyStrip.resetColumn();
        gateHistoryStrip.resetColumn();
      }

      // ---- Hits ----
      if (!hitsCard.fold?.isFolded()) {
        const shapeOpen = hitsShape.isOpen();
        // Read fresh every draw(), like the Gate row's own marks — a slider
        // drag should move the hits history's dashed Floor line, and the
        // Curve, immediately.
        const shape = deps.hitShape.get();
        // Local diagnostic, same availability as fixedEnergy (null on a
        // mic-less renderer or the synthetic feed) — see AudioMeters.update's
        // own doc.
        hitsHistory.update(frame, anim, beatDiag, nowMs, text, shapeOpen, shape.floor);
        if (anim) {
          // Each lane's dot on the Curve tracks its own *last-hit* ratio,
          // not this tick's live reading (which wanders below the firing
          // line between hits and would put the dot somewhere a real hit
          // never landed) — only overwritten on the exact tick that lane
          // fires, same convention the hits history's own strength bars use.
          if (frame?.onset) lastHitRatio[0] = beatDiag ? beatDiag.ratio : null;
          if (anim.lowOnset) lastHitRatio[1] = anim.hits.low.ratio;
          if (anim.midOnset) lastHitRatio[2] = anim.hits.mid.ratio;
          if (anim.highOnset) lastHitRatio[3] = anim.hits.high.ratio;
          if (frame?.onset) lastHitMs[0] = nowMs;
          if (anim.lowOnset) lastHitMs[1] = nowMs;
          if (anim.midOnset) lastHitMs[2] = nowMs;
          if (anim.highOnset) lastHitMs[3] = nowMs;
        }
        // The Curve and Envelope aren't part of the hits history's own
        // canvas, so they only need drawing while Shape is actually open.
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
      } else {
        // Folded: don't accumulate a column while hidden, same as Signal's History.
        hitsHistory.resetColumn();
      }

      // ---- Tempo ----
      if (!tempoCard.fold?.isFolded()) {
        // The dot flashes on the metronome's own tick, not a raw hit — the
        // dot and digits both come from the same tempoSettle.ts reading
        // (metronome.ts's own header).
        tempo.update(anim?.tempoLock ?? 0, !!anim?.metronomeBeat);
        if (text) {
          // RAW / Smoothing Off show the unsettled raw estimate, exactly as
          // before this block's own settle pass moved into tempoSettle.ts.
          tempo.setBpm(raw || smoothingOff ? (frame?.bpm ?? 0) : (anim?.metronomeBpm ?? 0));
        }
        // Fed through SIGNALS[id].read() itself, not a hand-copied formula,
        // so this row and a setting driven by the same signal always agree
        // on the number (see this file's header and signals.ts's own).
        if (frame && anim) {
          lock.setValue(SIGNALS["anim.tempoLock"].read(frame, anim), dtSec);
        } else {
          lock.setValue(null, dtSec);
        }
        if (text) {
          lock.setReadout(anim ? pct(anim.tempoLock) : "--", anim ? {} : IDLE);
        }
        timingStrip.update(frame, anim, nowMs);
        if (frame && anim) {
          waveTrace.push([SIGNALS["anim.beatWave"].read(frame, anim), SIGNALS["anim.barWave"].read(frame, anim)], nowMs);
        } else {
          waveTrace.push([null, null], nowMs);
        }
        waveTrace.draw();
      } else {
        // Folded: don't accumulate a column while hidden, same as History
        // and Centroid — the Timing strip's own resetColumn also forgets its
        // last phase, so unfolding mid-track doesn't read the jump across
        // the fold as a wrap.
        timingStrip.resetColumn();
        waveTrace.resetColumn();
      }

      // ---- Character ----
      if (!characterCard.fold?.isFolded()) {
        const sectionVal = anim ? (raw ? anim.raw.sectionIntensity : anim.sectionIntensity) : null;
        section.setValue(sectionVal, dtSec);
        if (anim?.dropOnset) section.flash(HOT_RED);
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
        // Brightness: the dial's own value on the bar/readout, exactly like
        // every dialRows entry above; the trace under it is the live
        // Centroid instead (see this file's header).
        const brightnessVal = anim ? (raw ? anim.raw.profile.brightness : anim.profile.brightness) : null;
        brightnessRow.setValue(brightnessVal, dtSec);
        if (text)
          brightnessRow.setReadout(
            brightnessVal === null ? "--" : brightnessVal.toFixed(2),
            brightnessVal === null ? IDLE : {},
          );
        const cv = anim ? (raw ? anim.centroidRaw : anim.centroid) : null;
        centroidTrace.push([cv], nowMs);
        centroidTrace.draw();
      } else {
        // Folded: don't accumulate a column while hidden, same as History.
        centroidTrace.resetColumn();
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
      // Grouped by feedEl so a row/lane shared by several jacks (the
      // Section row's Song+Drop, a hits lane's own shared Hits row) is
      // only ever written to once.
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
      // Priority for a shared row/lane's own glow: the active preview
      // always wins (soft) over a competing pinned feed (full when
      // uncontested, faint when a different preview is live), which in
      // turn wins over the softer scene-mix fallback (deps.patch's
      // isSceneSource — a `"scene"` setting has no patch sources of its
      // own, so it never wins the preview/pinned checks above; see
      // jack.ts's setRowFed for what each kind actually draws).
      for (const [rowEl, choices] of feedGroups) {
        // The mute-aware pair — a muted source keeps its jack filled above
        // but stops lighting the row it feeds (see isPinnedActive's own
        // doc on the AudioMetersDeps interface).
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
      // The hits lanes' own fine-grained glow, on top of the Hits row's
      // shared fed/dim state above — a lane never gets the softer
      // scene-mix treatment (a hit-onset entry in `sceneSources` is rare
      // enough, and per-lane vs. per-row soft glow isn't worth a second
      // code path here). Grouped by glowEl, not a plain per-entry loop: the
      // Beat lane carries two choices sharing one glow (feature.onset and
      // feature.flux), so a later entry's weaker kind must not overwrite an
      // earlier one's stronger glow. Mirrors the same full/soft/faint
      // priority as the row-level pass above, just per lane instead of per
      // row, with "soft" (an active preview) ranked over "full"/"faint" (a
      // pinned feed) over "none".
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
    jackElements(): ReadonlyMap<string, HTMLElement> {
      return jackElementsMap;
    },
  };
}
