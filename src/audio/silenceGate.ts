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
 * Each device that draws holds its own marks, and they are never a setting.
 * Only src/app.ts's capture loop hears this room (feedSilenceGateMeasurement),
 * so only it moves them; the pop-out takes the main window's marks with every
 * frame (net/outputSync.ts's `gate`), and a paired TV and the synthetic feed
 * hold SILENCE_GATE_SEED.
 *
 * Music opens the gate too. Through a quiet laptop mic a song's `level` sits
 * under the marks, so they read music and room alike as silence and drop
 * most of its hits (#578). The engine's tempo tracker still hears that music:
 * how periodic the onsets are (EngineReading.confidence) doesn't depend on
 * level. So once the engine hears a steady pulse (EngineReading.music) with
 * confidence at SILENCE_GATE_MUSIC_OPEN, every hit counts, until confidence
 * falls under SILENCE_GATE_MUSIC_CLOSE or the pulse stops (musicHoldsGate;
 * each device that draws keeps its own last answer, off the reading its
 * frames carry, so a TV and the pop-out open with the laptop). The tracker
 * hears the audio before any gate, so reading it closes no loop. Before the
 * tracker finds the beat (seconds into a song, a beatless intro throughout),
 * a quiet mic is still gated by level alone. Opening on loudness over the
 * quietest room heard was measured too and dropped: a steady noise that
 * starts later (a noise video, a fan) then fires as if there were no gate.
 *
 * Only a mic is gated. A tab share, a line in or a loopback carries no room
 * hiss, and there the gate only ever dropped quiet music's hits: the floor
 * tracker read a steady stretch of a clean source as the room's floor (#777).
 * A frame off any other source carries FeatureFrame.gateOff, and every device
 * that draws it gates it with SILENCE_GATE_OFF, a TV by the frame's gate-off
 * bit (src/net/protocol.ts). The tracker hears only a mic, so a share in
 * between leaves the room it learned as it was.
 *
 * SILENCE_GATE_SEED is a placeholder, not measured against a real mic in a
 * real room: `closed` is low because the room that prompted this feature read
 * Level as zero, and `open` sits at or under the quietest level
 * src/audio/synthetic.ts's `level` line ever emits, so the synthetic feed —
 * every headless screenshot and tuning tool that drives the app with
 * `?audio=synthetic` — is never dimmed (tests/silenceGate.test.ts pins this
 * against the real synthetic feed rather than trusting the arithmetic by eye).
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
 * The room-floor tracker resolves against its own floor estimate rather than
 * autoTune.ts's MUSIC_DIALS: no dial there describes how quiet this room's
 * silence reads, only what the music is doing once it plays. Its rule in
 * plain words is "the room is quiet when the volume holds still" — hiss is
 * steady, music is not — so it watches FeatureFrame.level for a stretch that
 * barely moves and treats that as a floor reading, easing `closed` to sit just
 * above it, rather than telling silence from music by loudness alone.
 */

import type { EngineReading } from "./types.ts";

export interface SilenceGateMarks {
  closed: number;
  open: number;
}

// The music path (this file's header). Tuned 2026-10-28 on the mic-gap takes
// (#578): an empty room's confidence peaks a little over tempo.ts's MUSIC_ON,
// enough to set `music` now and then, but never reaches OPEN, while a song
// with a clear beat holds over it for most of its length. CLOSE lets a song
// whose confidence dips keep its hits, and shuts within a couple of seconds
// of the music stopping, sooner than `music` itself drops. Any lower OPEN let
// rooms or the end of a set fire.
export const SILENCE_GATE_MUSIC_OPEN = 0.5;
export const SILENCE_GATE_MUSIC_CLOSE = 0.22;

/** Whether music holds the gate open this tick (this file's header). `held`
 *  is what this returned for the caller's previous tick. */
export function musicHoldsGate(engine: EngineReading | null | undefined, held: boolean): boolean {
  if (!engine?.music) return false;
  return engine.confidence >= (held ? SILENCE_GATE_MUSIC_CLOSE : SILENCE_GATE_MUSIC_OPEN);
}

/** In FeatureFrame.level units — see this file's header. */
export const SILENCE_GATE_MIN = 0;

/** The marks before this room has been heard holding still, and for good on
 *  a device that never hears it (this file's header). */
export const SILENCE_GATE_SEED: SilenceGateMarks = Object.freeze({ closed: 0.05, open: 0.15 });

/** Marks that gate nothing (silenceGateDimmer's `closed` at SILENCE_GATE_MIN),
 *  for a frame whose source isn't a mic. */
export const SILENCE_GATE_OFF: SilenceGateMarks = Object.freeze({ closed: SILENCE_GATE_MIN, open: SILENCE_GATE_SEED.open });

/** One tick's gate reading, off one device's own capture — not the marks
 *  (SilenceGateMarks), but what the gate actually did this tick.
 *  `dimmer` is silenceGateDimmer() on that tick's level, `fired` is that same
 *  tick's FeatureFrame.onset, `suppressed` is an engine hit hitPasses() stopped.
 *  One definition, shared by app.ts's `lastGate`, deviceMenu.ts's
 *  DeviceMenu.update(), and audioMeters.ts's AudioMeters.update(), so none of
 *  them can drift into an incompatible shape. `null`
 *  wherever a device has no local extractor to read (a renderer, the
 *  synthetic feed) — the same null-hides-itself convention
 *  lastFixedEnergy/lastFluxRatio already use. */
export interface SilenceGateReading {
  dimmer: number;
  fired: boolean;
  suppressed: boolean;
}

// Placeholders, not measured against a real mic in a real room — same
// caveat as SILENCE_GATE_SEED above.
//
// SILENCE_GATE_AUTO_MARGIN is how far above the tracked floor `closed`
// sits once the room settles: wide enough that the floor estimate's own
// residual wobble can't cross it back open, narrow enough that a room that
// has genuinely gone quiet gates promptly rather than after a long fade.
// SILENCE_GATE_AUTO_CLOSED_FLOOR keeps `closed` off SILENCE_GATE_MIN, which
// silenceGateDimmer reads as "gate nothing" — the gate should always be
// gating *something*, never silently disabling itself just because the
// room read as dead silent for a moment. SILENCE_GATE_AUTO_CLOSED_CEIL is
// the mirror case: it keeps a sustained drone (a fan, an AC hum, mains
// hum) from ever pushing `closed` high enough to gate real music out.
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
// mean (slow — seconds-scale, like autoGain.ts's own EASE_RATE) versus
// following a level that's dropped below the current estimate (fast — the
// room just proved it can be quieter, so there's no reason to keep gating
// on a stale high estimate for another several seconds). No warmStart.ts
// warm-up here, unlike autoGain.ts/musicProfile.ts: this floor only ever
// rises during a steady window it has to wait to observe in the first
// place, and it already drops to a new low in ~1s, so there's no slow
// start-up this rate is otherwise forced to double as.
const FLOOR_RISE_RATE = 0.25;
const FLOOR_DROP_RATE = 1;

/** Pure — this tracker's floor estimate to the two gate marks that follow
 *  from it. Exported for tests; feedSilenceGateMeasurement is the only real
 *  caller. Keeps SILENCE_GATE_SEED's gap, so the tracker moves where the two
 *  marks sit, not how wide the smoothstep between them is. */
export function silenceGateMarksForFloor(floor: number): SilenceGateMarks {
  const safeFloor = Number.isFinite(floor) ? floor : SILENCE_GATE_SEED.closed;
  const closed = Math.min(
    SILENCE_GATE_AUTO_CLOSED_CEIL,
    Math.max(SILENCE_GATE_AUTO_CLOSED_FLOOR, safeFloor + SILENCE_GATE_AUTO_MARGIN),
  );
  return { closed, open: closed + (SILENCE_GATE_SEED.open - SILENCE_GATE_SEED.closed) };
}

// Never persisted: re-derived from the room fresh every session. `floor` is
// backed out of the seed through the margin, so the first marks are exactly
// SILENCE_GATE_SEED.
let floor = SILENCE_GATE_SEED.closed - SILENCE_GATE_AUTO_MARGIN;
let envelopeMin = Infinity;
let envelopeMax = -Infinity;

// Rebuilt only when the marks have moved by more than this: resolveSilenceGate()
// runs every tick while the floor eases continuously, so a fresh object on
// every call would be steady-state garbage for no reason.
const SNAPSHOT_EPS = 1e-4;
let snapshot: SilenceGateMarks | null = null;

/** The marks app.ts's extractor/animClock should use this tick. */
export function resolveSilenceGate(): SilenceGateMarks {
  const marks = silenceGateMarksForFloor(floor);
  if (
    snapshot === null ||
    Math.abs(marks.closed - snapshot.closed) > SNAPSHOT_EPS ||
    Math.abs(marks.open - snapshot.open) > SNAPSHOT_EPS
  ) {
    snapshot = Object.freeze(marks);
  }
  return snapshot;
}

/** A fresh envelope with `closed` at the given mark (SILENCE_GATE_SEED's by
 *  default), for tests and the tempo eval. */
export function resetSilenceGateTracker(closed = SILENCE_GATE_SEED.closed): void {
  floor = closed - SILENCE_GATE_AUTO_MARGIN;
  envelopeMin = Infinity;
  envelopeMax = -Infinity;
  snapshot = null;
}

/**
 * The room-floor tracker. Eases `floor` — this module's best guess at how
 * quiet this room's silence actually reads on FeatureFrame.level — toward
 * whatever the mic has settled on lately, so resolveSilenceGate() can place
 * `closed` just above it. In plain words: **the room is quiet when the
 * volume holds still.** Hiss is steady; music is not — so a stretch where
 * `level` barely moves is treated as a genuine floor reading, and a stretch
 * that's bouncing around (a beat, a phrase, anything actually playing) is
 * left alone.
 *
 * Call once per tick (app.ts, right after FeatureExtractor.update(), next
 * to feedAutoGainMeasurement) with this tick's FeatureFrame.level and the
 * AudioContext-clock delta since the last call — see
 * feedAutoGainMeasurement's own doc comment for why that's the right clock.
 *
 * Non-finite input (no mic yet, a NaN dt) is ignored outright rather than
 * folded in as a bad sample — the tracker just holds its last estimate,
 * the same fail-open instinct as silenceGateDimmer's own non-finite check.
 */
export function feedSilenceGateMeasurement(level: number, dtSec: number): void {
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
 * `musicHeld` is musicHoldsGate()'s answer this tick: music holds it at 1.
 *
 * Two special cases:
 * - `marks.closed <= SILENCE_GATE_MIN` gates nothing: always returns 1.
 *   Nothing is quieter than level zero. The tracker never puts `closed`
 *   there (SILENCE_GATE_AUTO_CLOSED_FLOOR), but a frame from an older main
 *   window can carry a gate its user switched off.
 * - A non-finite `level` returns 1 (fail open). Bad data reaching this
 *   function must never be the reason the visuals go silent.
 */
export function silenceGateDimmer(level: number, marks: SilenceGateMarks, musicHeld = false): number {
  if (musicHeld || marks.closed <= SILENCE_GATE_MIN) return 1;
  if (!Number.isFinite(level)) return 1;
  const span = marks.open - marks.closed;
  if (span <= 0) return 1;
  const t = clamp01((level - marks.closed) / span);
  return t * t * (3 - 2 * t);
}

/** Whether an engine hit of this strength gets through a gate at this dimmer
 *  (see this file's header). A strength of 0 (no hit) never passes. */
export function hitPasses(strength: number, dimmer: number): boolean {
  return strength * dimmer > 1;
}
