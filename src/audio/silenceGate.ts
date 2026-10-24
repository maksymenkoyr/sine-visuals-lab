/**
 * The silence gate: two volume marks, `closed` < `open`, in FeatureFrame.level
 * units (see features.ts's LEVEL_DB_FLOOR/LEVEL_DB_CEIL — level is the one
 * absolute loudness reading the pipeline has). silenceGateDimmer() maps a
 * frame's level to a 0..1 multiplier — 0 at/below `closed`, 1 at/above
 * `open`, smoothstepped between — and hitPasses() lets an engine hit through
 * only while its strength times that dimmer is over 1. It exists because the
 * engine's hit detector (src/audio/engine/onsets.ts) is relative: it reads
 * the input against its own level and noise floor and fires on peaks over a
 * running threshold, so a near-silent room's hiss still makes peaks that
 * clear it. `level` is the one reading that still knows "quiet" from "loud"
 * in absolute terms, which is exactly what a silence gate needs to read.
 *
 * A hit's strength is how far its peak cleared the engine's threshold
 * (EngineReading in src/audio/types.ts), so it is over 1 by construction: an
 * open gate passes every hit, a half-open one only the hits that cleared
 * twice the threshold, a shut one none. The gate scales only that
 * comparison. The engine's threshold, refractory, hit naming and tempo
 * tracking never see it (if the gate shrank the signal before the threshold
 * did, both would shrink together and hiss would go on beating hiss), and the
 * strength a lane reports stays the ungated one. Level is read on the same
 * frame as the hit, not a smoothed lag of it, so a genuinely loud sound in an
 * otherwise silent room — a clap, a single loud beat — opens its own gate
 * that same tick and fires normally.
 *
 * Two marks, not one. A single on/off threshold is a switch, and a switch
 * chatters: with the firing comparison an all-or-nothing step function, a
 * level that happens to hover right at the mark (a song fading out, a mic's
 * own noise floor drifting a fraction of a dB) flips the gate open and shut
 * on every little wobble, exactly the flicker this exists to prevent. A
 * smoothstep between two marks turns that same wobble into a small change in
 * how much a hit has to stand out rather than a binary flip — the gate has
 * to be crossed by a wider margin of genuine loudness before an onset can
 * ever fire, not just brushed.
 *
 * Global per device (not per scene, unlike src/audio/sensitivity.ts and
 * src/render/sceneSettings.ts) — like autoGain.ts and bandSplit.ts, how
 * quiet this room/mic actually is describes the input, not one scene's look,
 * so it should carry across scene switches. Same in-memory-cache-over-
 * localStorage pattern as those modules: the cache is the source of truth
 * for get/set within a session, seeded once from localStorage, so behavior
 * stays correct even where localStorage is unavailable (node test env,
 * Safari private mode).
 *
 * The defaults below are placeholders, not measured against a real mic in a
 * real room: SILENCE_GATE_CLOSED_DEFAULT is set low because the room that
 * prompted this feature read Level as zero, and SILENCE_GATE_OPEN_DEFAULT is
 * set to sit at or under the quietest level src/audio/synthetic.ts's `level`
 * line ever emits, so the synthetic feed — every headless screenshot and
 * tuning tool that drives the app with `?audio=synthetic` — is never dimmed
 * by the shipped default (tests/silenceGate.test.ts pins this against the
 * real synthetic feed rather than trusting the arithmetic by eye).
 *
 * The gate governs what a scene *reacts to*, never tempo tracking. Every
 * device that draws gates the engine reading's hits itself (bandEnergy.ts,
 * run by src/render/animClock.ts) with its own marks, off the `level` of the
 * frame the hits came in (on a follower, EngineReading.hitLevel: it draws a
 * hit a tick or more later, when a short sound's level has already fallen);
 * src/app.ts also sets FeatureFrame.onset by the same rule for followers that
 * predate the reading. The tempo tracker (src/audio/engine/tempo.ts) hears
 * the audio before any gate, and the beat clock follows it: a gated tracker
 * starved tempo tracking in a room the gate read as quiet (through a mic, the
 * Metronome never started), while hiss is aperiodic and the tracker's music
 * test already rejects it (tests/tempoEval.test.ts's "through a mic" block).
 *
 * The marks are not part of a room's look: their keys are
 * net/syncedStores.ts's VOLATILE_PREFIXES, which the pop-out still mirrors
 * but `isRoomKey` refuses — unlike bandSplit.ts's crossovers, which do ride
 * in the look. So a phone's Silence gate setting doesn't decide what a
 * paired TV treats as silence; only the TV's own copy of this setting does.
 *
 * Auto mode: a room-floor tracker (feedSilenceGateMeasurement, gated by
 * STORAGE_KEY_AUTO) that can drive both marks instead of a manual drag. It
 * resolves against its own room-floor estimate rather than autoTune.ts's
 * MUSIC_DIALS, for the same reason autoGain.ts's own auto amount does: no
 * dial there describes how quiet this room's silence actually reads, only
 * what the music is doing once it's already playing. Its rule in plain
 * words is "the room is quiet when the volume holds still" — hiss is
 * steady, music is not — so it watches FeatureFrame.level for a stretch
 * that barely moves and treats that as a genuine floor reading, easing
 * `closed` to sit just above it, rather than trying to tell silence from
 * music by loudness alone. On by default, like autoGain.ts's own auto flag
 * (loadInitialAuto below) — an explicit off is what gets stored: the
 * tracker only ever eases the marks toward this room's own measured quiet,
 * seeded from whatever the manual marks already were (see `floor`'s own
 * init below), so a fresh profile starts from the shipped marks and only
 * moves once this room has actually been heard holding still. Only src/app.ts's own extractor loop
 * ever calls feedSilenceGateMeasurement — a paired TV (which keeps its own
 * entirely local copy of this module) and
 * the synthetic feed never do, so on either path the auto marks simply hold
 * at the seed (= the manual marks), same as if a manual drag had left them
 * there — this is what keeps every headless screenshot undimmed by default.
 */

import { parseSyncedNumber, registerSyncedStore } from "../net/syncedStores.ts";

const STORAGE_KEY_CLOSED = "vibe.silenceGateClosed";
const STORAGE_KEY_OPEN = "vibe.silenceGateOpen";

/** Slider range, in FeatureFrame.level units — see this file's header. */
export const SILENCE_GATE_MIN = 0;
export const SILENCE_GATE_MAX = 0.6;
/** Smallest gap the setters ever leave between the two marks — see
 *  setSilenceGateClosed/setSilenceGateOpen for how the invariant `open >=
 *  closed + SILENCE_GATE_MIN_WIDTH` is kept. */
export const SILENCE_GATE_MIN_WIDTH = 0.01;
export const SILENCE_GATE_CLOSED_DEFAULT = 0.05;
export const SILENCE_GATE_OPEN_DEFAULT = 0.15;

export interface SilenceGateMarks {
  closed: number;
  open: number;
}

/** One tick's gate reading, off one device's own capture — not the stored
 *  marks above (SilenceGateMarks), but what the gate actually did this tick.
 *  `dimmer` is silenceGateDimmer() on that tick's level, `fired` is that same
 *  tick's FeatureFrame.onset, `suppressed` is an engine hit hitPasses() stopped.
 *  One definition, shared by app.ts's `lastGate`, deviceMenu.ts's
 *  DeviceMenu.update(), and audioMeters.ts's AudioMeters.update() and
 *  Input check card's Gate row, so none of them can drift into an incompatible
 *  shape. `null`
 *  wherever a device has no local extractor to read (a renderer, the
 *  synthetic feed) — the same null-hides-itself convention
 *  lastFixedEnergy/lastFluxRatio already use. */
export interface SilenceGateReading {
  dimmer: number;
  fired: boolean;
  suppressed: boolean;
}

function clampMark(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(SILENCE_GATE_MAX, Math.max(SILENCE_GATE_MIN, value));
}

function loadMark(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return clampMark(Number(raw), fallback);
  } catch {
    return fallback;
  }
}

let closedCache = loadMark(STORAGE_KEY_CLOSED, SILENCE_GATE_CLOSED_DEFAULT);
let openCache = loadMark(STORAGE_KEY_OPEN, SILENCE_GATE_OPEN_DEFAULT);
// The two keys are loaded independently, so a corrupted/hand-edited pair
// could violate the invariant the setters below always maintain — fix it by
// pulling `closed` down rather than pushing `open` up, so a bad stored
// `closed` can't silently widen what "open" requires.
if (openCache < closedCache + SILENCE_GATE_MIN_WIDTH) {
  closedCache = Math.max(SILENCE_GATE_MIN, openCache - SILENCE_GATE_MIN_WIDTH);
}

// Strict, one mark, for the reload hook: an absent key is the fallback, but
// text that is not a finite number keeps `current` (the mark this device
// already has), so the other mark can still apply (net/syncedStores.ts's
// parseSyncedNumber).
function reloadMark(key: string, fallback: number, current: number): number {
  try {
    const n = parseSyncedNumber(localStorage.getItem(key));
    return n === null ? fallback : clampMark(n, fallback);
  } catch {
    return current;
  }
}

// Re-seeds from localStorage for the pop-out output window (net/syncedStores.ts),
// one mark at a time — see reloadMark.
registerSyncedStore(STORAGE_KEY_CLOSED, () => {
  closedCache = reloadMark(STORAGE_KEY_CLOSED, SILENCE_GATE_CLOSED_DEFAULT, closedCache);
  openCache = reloadMark(STORAGE_KEY_OPEN, SILENCE_GATE_OPEN_DEFAULT, openCache);
  if (openCache < closedCache + SILENCE_GATE_MIN_WIDTH) {
    closedCache = Math.max(SILENCE_GATE_MIN, openCache - SILENCE_GATE_MIN_WIDTH);
  }
  snapshot = null;
  autoOn = loadInitialAuto();
});

function persist(): void {
  snapshot = null;
  try {
    localStorage.setItem(STORAGE_KEY_CLOSED, String(closedCache));
    localStorage.setItem(STORAGE_KEY_OPEN, String(openCache));
  } catch {
    // Not fatal — the setting just won't persist across reloads.
  }
}

// Rebuilt only when a mark changes (persist() is the one place every setter
// ends), not per call — app.ts and tv.ts read this every tick, and a fresh
// object per read would be steady-state garbage for no reason.
let snapshot: SilenceGateMarks | null = null;

/** A frozen snapshot — callers can't mutate the cache through it. */
export function getSilenceGate(): SilenceGateMarks {
  if (snapshot === null) snapshot = Object.freeze({ closed: closedCache, open: openCache });
  return snapshot;
}

/** Clamps to [SILENCE_GATE_MIN, SILENCE_GATE_MAX] (non-finite -> the mark's
 *  own default), then keeps `open >= closed + SILENCE_GATE_MIN_WIDTH` by
 *  dragging `open` up if this new `closed` crowds it — capped short of
 *  SILENCE_GATE_MAX by the minimum width first, so there's always room above
 *  it for `open` to sit without itself exceeding SILENCE_GATE_MAX. */
export function setSilenceGateClosed(v: number): void {
  const closed = Math.min(clampMark(v, SILENCE_GATE_CLOSED_DEFAULT), SILENCE_GATE_MAX - SILENCE_GATE_MIN_WIDTH);
  closedCache = closed;
  if (openCache < closed + SILENCE_GATE_MIN_WIDTH) openCache = closed + SILENCE_GATE_MIN_WIDTH;
  persist();
}

/** Mirror of setSilenceGateClosed: floored above SILENCE_GATE_MIN by the
 *  minimum width first, so there's always room below it for `closed` to sit
 *  without going under SILENCE_GATE_MIN, then drags `closed` down if this new
 *  `open` crowds it. */
export function setSilenceGateOpen(v: number): void {
  const open = Math.max(clampMark(v, SILENCE_GATE_OPEN_DEFAULT), SILENCE_GATE_MIN + SILENCE_GATE_MIN_WIDTH);
  openCache = open;
  if (closedCache > open - SILENCE_GATE_MIN_WIDTH) closedCache = open - SILENCE_GATE_MIN_WIDTH;
  persist();
}

export function resetSilenceGate(): void {
  closedCache = SILENCE_GATE_CLOSED_DEFAULT;
  openCache = SILENCE_GATE_OPEN_DEFAULT;
  persist();
}

// ---- Auto mode -------------------------------------------------------
// See this file's header for the why. Same on-by-default/seed-on-enable/
// no-op-while-off shape as autoGain.ts's own auto mode, just with two
// derived marks instead of one amount.

const STORAGE_KEY_AUTO = "vibe.silenceGateAuto";

function loadInitialAuto(): boolean {
  try {
    // Missing key means ON (see this file's header) — only a stored "0"
    // (persistAuto's explicit off) turns it off.
    return localStorage.getItem(STORAGE_KEY_AUTO) !== "0";
  } catch {
    return true;
  }
}

let autoOn = loadInitialAuto();

function persistAuto(): void {
  try {
    localStorage.setItem(STORAGE_KEY_AUTO, autoOn ? "1" : "0");
  } catch {
    // Not fatal — the setting just won't persist across reloads.
  }
}

export function isSilenceGateAuto(): boolean {
  return autoOn;
}

// Placeholders, not measured against a real mic in a real room — same
// caveat as SILENCE_GATE_CLOSED_DEFAULT/OPEN_DEFAULT above.
//
// SILENCE_GATE_AUTO_MARGIN is how far above the tracked floor `closed`
// sits once the room settles: wide enough that the floor estimate's own
// residual wobble can't cross it back open, narrow enough that a room that
// has genuinely gone quiet gates promptly rather than after a long fade.
// SILENCE_GATE_AUTO_CLOSED_FLOOR keeps auto `closed` off SILENCE_GATE_MIN
// itself, which silenceGateDimmer reads as "gate off" — auto should always
// be gating *something*, never silently disabling itself just because the
// room read as dead silent for a moment. SILENCE_GATE_AUTO_CLOSED_CEIL is
// the mirror case: it keeps a sustained drone (a fan, an AC hum, mains
// hum) from ever pushing auto `closed` high enough to gate real music
// out — well under SILENCE_GATE_MAX, the ceiling only a deliberate manual
// drag can still reach.
const SILENCE_GATE_AUTO_MARGIN = 0.02;
const SILENCE_GATE_AUTO_CLOSED_FLOOR = 0.01;
const SILENCE_GATE_AUTO_CLOSED_CEIL = 0.3;

// How long a "has the room held still" window looks back, and how tightly
// level has to hold inside it to count as steady. Implemented below as a
// leaky min/max envelope rather than a literal ring buffer of samples: a
// new extreme snaps the envelope open immediately (so one loud transient
// is never mistaken for the room's floor), and otherwise it relaxes back
// toward the current level with this window as its time constant — which
// "forgets" an old extreme once it's genuinely that far in the past,
// without ever storing a sample to compute a real sliding window from.
const SILENCE_GATE_AUTO_WINDOW_SEC = 2;
const SILENCE_GATE_AUTO_STEADY_SPAN = 0.02;
const ENVELOPE_DECAY_RATE = 1 / SILENCE_GATE_AUTO_WINDOW_SEC;

// Time constants for easing the floor estimate toward a steady window's
// mean (slow — seconds-scale, like autoGain.ts's own EASE_RATE, and changed
// to the same ~4s alongside it) versus following a level that's dropped
// below the current estimate (fast — the room just proved it can be
// quieter, so there's no reason to keep gating on a stale high estimate for
// another several seconds). No warmStart.ts warm-up here, unlike
// autoGain.ts/musicProfile.ts: this floor only ever rises during a steady
// window it has to wait to observe in the first place, and it already drops
// to a new low in ~1s, so there's no slow start-up this rate is otherwise
// forced to double as.
const FLOOR_RISE_RATE = 0.25;
const FLOOR_DROP_RATE = 1;

/** Pure — this tracker's current floor estimate to the two gate marks that
 *  follow from it. Exported for tests, like autoGain.ts's autoGainForSpan;
 *  feedSilenceGateMeasurement is the only real caller. Keeps the same gap
 *  width the shipped manual defaults use (SILENCE_GATE_OPEN_DEFAULT -
 *  SILENCE_GATE_CLOSED_DEFAULT) rather than inventing a second one, so
 *  switching Silence gate to auto changes where the two marks sit, not how
 *  wide the smoothstep between them is. */
export function silenceGateMarksForFloor(floor: number): SilenceGateMarks {
  const safeFloor = Number.isFinite(floor) ? floor : SILENCE_GATE_CLOSED_DEFAULT;
  const closed = Math.min(
    SILENCE_GATE_AUTO_CLOSED_CEIL,
    Math.max(SILENCE_GATE_AUTO_CLOSED_FLOOR, safeFloor + SILENCE_GATE_AUTO_MARGIN),
  );
  const open = Math.min(SILENCE_GATE_MAX, closed + (SILENCE_GATE_OPEN_DEFAULT - SILENCE_GATE_CLOSED_DEFAULT));
  return { closed, open };
}

// The tracker's own state — never persisted, since (like autoGain.ts's
// `eased`) it's re-derived from the room fresh every session. `floor` is
// the tracker's current guess at the room's quiet level, seeded from
// closedCache (the stored manual closed mark, or its default) backed out
// through SILENCE_GATE_AUTO_MARGIN — same reasoning as setSilenceGateAuto's
// own on-enable seed below, needed here too now that auto can be on from
// module load without setSilenceGateAuto(true) ever running. envelopeMin/Max
// are the leaky min/max envelope feedSilenceGateMeasurement reads "is the
// room holding still" from (see the constants above).
let floor = closedCache - SILENCE_GATE_AUTO_MARGIN;
let envelopeMin = Infinity;
let envelopeMax = -Infinity;

export function setSilenceGateAuto(on: boolean): void {
  if (on === autoOn) return;
  autoOn = on;
  if (on) {
    // Seed from the manual marks so the rows don't jump on the chip click —
    // same reasoning as autoGain.ts's setAutoGainAuto. Backed out through
    // silenceGateMarksForFloor's own margin (rather than caching `closed`
    // directly) so the very next feedSilenceGateMeasurement() call eases
    // forward from a floor estimate consistent with what that function
    // would already show, not a `closed` value the formula could never
    // itself have produced. The envelope resets too, so a stale window from
    // a much earlier auto session (or one left mid-track) can't bias the
    // very first "is the room steady" read after re-enabling.
    floor = closedCache - SILENCE_GATE_AUTO_MARGIN;
    envelopeMin = Infinity;
    envelopeMax = -Infinity;
    autoSnapshot = null;
  }
  persistAuto();
}

// Rebuilt only when the auto marks have moved by more than this — same
// reasoning as the manual snapshot above (persist() being the one place
// every setter ends): resolveSilenceGate() runs every tick while the floor
// eases continuously, so a fresh object on every call would be steady-state
// garbage for no reason.
const AUTO_SNAPSHOT_EPS = 1e-4;
let autoSnapshot: SilenceGateMarks | null = null;

/** The value app.ts's extractor/animClock should actually use this tick:
 *  the room-floor tracker's marks while auto is on, getSilenceGate()
 *  otherwise. */
export function resolveSilenceGate(): SilenceGateMarks {
  if (!autoOn) return getSilenceGate();
  const marks = silenceGateMarksForFloor(floor);
  if (
    autoSnapshot === null ||
    Math.abs(marks.closed - autoSnapshot.closed) > AUTO_SNAPSHOT_EPS ||
    Math.abs(marks.open - autoSnapshot.open) > AUTO_SNAPSHOT_EPS
  ) {
    autoSnapshot = Object.freeze(marks);
  }
  return autoSnapshot;
}

/**
 * The room-floor tracker. Eases `floor` — this module's best guess at how
 * quiet this room's silence actually reads on FeatureFrame.level — toward
 * whatever the mic has settled on lately, so resolveSilenceGate() can place
 * `closed` just above it without anyone ever dragging a slider. In plain
 * words: **the room is quiet when the volume holds still.** Hiss is steady;
 * music is not — so a stretch where `level` barely moves is treated as a
 * genuine floor reading, and a stretch that's bouncing around (a beat, a
 * phrase, anything actually playing) is left alone.
 *
 * Call once per tick (app.ts, right after FeatureExtractor.update(), next
 * to feedAutoGainMeasurement) with this tick's FeatureFrame.level and the
 * AudioContext-clock delta since the last call — see
 * feedAutoGainMeasurement's own doc comment for why that's the right clock.
 * A no-op while auto is off, so the tracker doesn't drift out from under a
 * manual value it isn't driving — and since only app.ts's own extractor
 * loop ever calls this (see this file's header), a paired TV or the
 * synthetic feed never advances it at all, holding whatever marks
 * setSilenceGateAuto(true) last seeded.
 *
 * Non-finite input (no mic yet, a NaN dt) is ignored outright rather than
 * folded in as a bad sample — the tracker just holds its last estimate,
 * the same fail-open instinct as silenceGateDimmer's own non-finite check.
 */
export function feedSilenceGateMeasurement(level: number, dtSec: number): void {
  if (!autoOn) return;
  if (!Number.isFinite(level) || !Number.isFinite(dtSec)) return;
  const dt = Math.max(0, dtSec);
  const decay = 1 - Math.exp(-ENVELOPE_DECAY_RATE * dt);

  // Leaky min/max envelope standing in for a real sliding window — see the
  // constants above.
  envelopeMax = level > envelopeMax ? level : envelopeMax + (level - envelopeMax) * decay;
  envelopeMin = level < envelopeMin ? level : envelopeMin + (level - envelopeMin) * decay;

  if (level < floor) {
    // The room just proved it can be quieter than the current estimate —
    // follow it down fast rather than waiting out the slow steadiness ease
    // below, so one misjudged-high floor doesn't keep gating real quiet
    // passages for the rest of the session.
    floor += (level - floor) * (1 - Math.exp(-FLOOR_DROP_RATE * dt));
  } else if (envelopeMax - envelopeMin < SILENCE_GATE_AUTO_STEADY_SPAN) {
    const candidate = (envelopeMax + envelopeMin) / 2;
    floor += (candidate - floor) * (1 - Math.exp(-FLOOR_RISE_RATE * dt));
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Pure — takes `marks` explicitly rather than reading the store, so
 * features.ts's FeatureExtractor (which must stay store-free) and
 * bandEnergy.ts can both call it without becoming stateful about it
 * themselves. Smoothstepped (t*t*(3-2t), not a linear ramp) so the
 * multiplier's own rate of change eases in and out at each mark instead of
 * kinking there.
 *
 * Two special cases:
 * - `marks.closed <= SILENCE_GATE_MIN` means the gate is OFF: always returns
 *   1. Nothing is quieter than level zero, so there is nothing left to call
 *   silence — dragging Closed all the way down is how a user disables the
 *   gate entirely.
 * - A non-finite `level` returns 1 (fail open). Bad data reaching this
 *   function must never be the reason the visuals go silent.
 */
export function silenceGateDimmer(level: number, marks: SilenceGateMarks): number {
  if (marks.closed <= SILENCE_GATE_MIN) return 1;
  if (!Number.isFinite(level)) return 1;
  const span = marks.open - marks.closed;
  if (span <= 0) return 1; // degenerate marks shouldn't reach here via the exported setters — fail open
  const t = clamp01((level - marks.closed) / span);
  return t * t * (3 - 2 * t);
}

/** Whether an engine hit of this strength gets through a gate at this dimmer
 *  (see this file's header). A strength of 0 (no hit) never passes. */
export function hitPasses(strength: number, dimmer: number): boolean {
  return strength * dimmer > 1;
}
