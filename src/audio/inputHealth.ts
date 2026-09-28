/**
 * Whether the live capture itself is trustworthy — a different question from
 * whether the MUSIC is quiet or loud (src/audio/silenceGate.ts's job) or how
 * the panel's meters happen to read. At a venue the input goes wrong in four
 * ways, and nothing says so today (measured 2026-09-28):
 *  - **silent:** cable not in, booth/REC level at zero, a loopback driver
 *    with nothing playing — the scene just idles;
 *  - **clipping:** a booth or master out flat-tops a cheap interface. The
 *    Scope card's CLIP readout (src/ui/audioMeters.ts) reads the mono
 *    downmix, so one clipping channel alone halves on the way into that mix
 *    and is missed — this reads left/right straight off the tap
 *    (src/audio/inputHealthTap.ts), before they're ever combined;
 *  - **skipping:** a bad USB port or cable drops buffers — Chrome counts
 *    them on `MediaStreamTrack.stats` (125+; see inputHealthTap.ts);
 *  - **hum:** mains hum off a charger/HDMI/mixer ground loop, steady enough
 *    to fire visual hits of its own with no music playing at all.
 *
 * Pure — createInputHealth's state machine and the mainsHumHz DSP it needs
 * both take plain data, no AudioContext, so both are node-testable the same
 * way silenceGate.ts's math is (tests/inputHealth.test.ts). inputHealthTap.ts
 * is the thin, impure half that feeds advance() real samples every tick from
 * src/app.ts; src/ui/deviceMenu.ts's Source row is the one place a reading
 * becomes words.
 *
 * advance() is a priority chain, most urgent first: clipping > skipping >
 * silent > hum > ok — a clip and a hum can coincide (a hot signal riding on
 * top of a ground loop) and only the more actionable one is ever reported.
 * silent and hum need their condition to hold for a stretch before they
 * first report — SILENT_AFTER_SEC, HUM_AFTER_SEC — so a mixer fade or a
 * song's quiet intro never flashes a warning; clipping and skipping report
 * on the very tick they're seen (there's no such thing as a "quiet intro"
 * false positive for either) but linger for CLIP_HOLD_SEC/SKIP_HOLD_SEC
 * after the last one, so the line doesn't flicker between individual
 * samples. silent then clears only once rmsDb has climbed a real margin
 * above SILENT_DB (SILENT_CLEAR_MARGIN_DB) rather than the instant it pokes
 * back over the entry mark — the same two-mark hysteresis silenceGate.ts
 * uses, for the same reason (a level hovering right at one mark must not
 * chatter); hum clears after HUM_CLEAR_SEC of the correlation genuinely
 * dropping out, not the first tick it does.
 */

import { rms } from "./waveform.ts";

export type InputHealthKind = "ok" | "clipping" | "skipping" | "silent" | "hum";

export interface InputHealthReading {
  kind: InputHealthKind;
  /** Which channel was clipping, held for the reading's CLIP_HOLD_SEC —
   *  "both" for a mono track (there's only ever one channel to blame), a
   *  tick where both channels rode the rail together, or a channel that
   *  clipped anywhere within the current hold after a different channel
   *  already had (accumulated, not overwritten — see createInputHealth).
   *  Only meaningful for kind "clipping". */
  channel?: "left" | "right" | "both";
  /** The mains frequency mainsHumHz() locked onto. Only meaningful for kind
   *  "hum". */
  humHz?: 50 | 60;
}

/** One tick's raw measurement — everything advance() needs, already reduced
 *  to plain numbers so the state machine itself stays free of AudioContext,
 *  AnalyserNode or MediaStreamTrack. src/app.ts assembles this each tick from
 *  inputHealthTap.ts's read() plus lastMono. */
export interface InputMeasure {
  /** Max |sample| this tick, left (or the only) channel. */
  peakL: number;
  /** Max |sample| this tick, right channel — null for a mono track. */
  peakR: number | null;
  /** Mono-downmix RMS in dBFS. −Infinity for digital silence, same
   *  zero-guarded convention as inputPreview.ts's own dB read. */
  rmsDb: number;
  /** mainsHumHz() of the same mono buffer rmsDb was measured from. */
  humHz: 50 | 60 | null;
  /** Cumulative dropped-frame count since the capture opened
   *  (inputHealthTap.ts's read of MediaStreamTrack.stats), or null wherever
   *  that API isn't available — advance() treats null as "no evidence
   *  either way", never as "zero glitches". */
  glitchFrames: number | null;
}

export interface InputHealth {
  /** Call once per tick with the AudioContext-clock delta since the last
   *  call (src/app.ts feeds FeatureExtractor.dtSec, the same clock
   *  feedAutoGainMeasurement/feedSilenceGateMeasurement already use) and
   *  this tick's measurement. Returns this tick's reading — never throws,
   *  never needs a warm-up call before it means something (every hold/entry
   *  timer starts at zero, i.e. "ok"). */
  advance(dtSec: number, m: InputMeasure): InputHealthReading;
  /** Clears every hold/entry timer back to "ok" — call on every capture
   *  swap or end (src/app.ts's onCaptureEnded and attachCapture) so a stale
   *  reading from the previous input never survives onto a new one. */
  reset(): void;
}

// ---- Clipping --------------------------------------------------------
/** A sample at or beyond this fraction of full scale counts as clipped.
 *  Close to but under 1.0 for the same float-rounding reason
 *  waveform.ts's CLIP_THRESHOLD is — a true digital clip rides the rail for
 *  several consecutive samples but rarely lands on the exact integer
 *  boundary on the way in. */
export const CLIP_LEVEL = 0.99;
/** How long a "clipping" reading lingers after the last clipped sample. */
export const CLIP_HOLD_SEC = 3;

// ---- Skipping ----------------------------------------------------------
/** How long a "skipping" reading lingers after the last detected buffer
 *  drop. */
export const SKIP_HOLD_SEC = 5;

// ---- Silent --------------------------------------------------------------
/** Below this mono RMS, in dBFS, there's no real signal — just a floor of
 *  hiss or nothing at all. */
export const SILENT_DB = -75;
/** rmsDb must stay under SILENT_DB continuously this long before "silent"
 *  first reports — long enough that a song's quiet intro or a fade between
 *  tracks is never mistaken for a dead input. */
export const SILENT_AFTER_SEC = 8;
/** Once "silent" is reported, it clears only when rmsDb climbs this many dB
 *  above SILENT_DB — not the instant it pokes back over SILENT_DB itself —
 *  the same two-mark hysteresis silenceGate.ts's closed/open marks use, so a
 *  level hovering right at the edge can't chatter the line on and off. */
export const SILENT_CLEAR_MARGIN_DB = 6;

// ---- Hum -------------------------------------------------------------
/** humHz must read non-null continuously this long before "hum" first
 *  reports. */
export const HUM_AFTER_SEC = 4;
/** Once "hum" is reported, it clears after this long without a humHz
 *  reading — not the first tick it drops out — so one buffer that happens to
 *  land on a bad phase doesn't flicker the line off. */
export const HUM_CLEAR_SEC = 2;

// ---- mainsHumHz's own thresholds --------------------------------------
/** Normalized autocorrelation at or above this counts as "locked" — see
 *  mainsHumHz. */
export const HUM_CORR = 0.9;
/** Below this mono RMS, in dBFS, there's nothing periodic to find — same
 *  reasoning as SILENT_DB, just a stricter floor so a near-silent hum isn't
 *  mistaken for hum riding on genuine silence. */
export const HUM_FLOOR_DB = -80;
/** Half-width, in seconds of lag, for mainsHumHz's local-maximum check — see
 *  that function for why HUM_CORR alone isn't enough. The mains grid holds
 *  50/60 Hz within about ±0.2 Hz — under 4 samples of lag drift at audio
 *  sample rates — so real hum's autocorrelation peak sits right at (or a
 *  couple of samples from) the nominal 50/60 Hz lag; a musical note whose
 *  period happens to land near a whole cycle count at that same lag peaks
 *  well away from it, at its OWN period instead — tens of samples off. A
 *  span scaled to the sample rate (12 samples at 48 kHz, 11 at 44.1 kHz)
 *  comfortably covers the mains drift while staying well short of a real
 *  note's own peak. */
export const HUM_PEAK_SPAN_SEC = 0.00025;

/** Normalized autocorrelation of `x` against itself, shifted by `lag`
 *  samples, over the overlapping region — 1.0 for a perfectly periodic
 *  signal at that lag, ~0 for anything uncorrelated with itself at that
 *  shift. */
function autocorrelation(x: Float32Array, lag: number): number {
  if (lag <= 0 || lag >= x.length) return 0;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i + lag < x.length; i++) {
    const a = x[i];
    const b = x[i + lag];
    num += a * b;
    denA += a * a;
    denB += b * b;
  }
  const den = Math.sqrt(denA * denB);
  return den > 0 ? num / den : 0;
}

/**
 * Mains hum detector: normalized autocorrelation of `mono` against itself,
 * one period later, at 50 Hz and at 60 Hz — a steady hum (with whatever
 * harmonics on top) lines back up almost exactly with itself a period on;
 * music generally doesn't. Returns whichever of the two clears HUM_CORR AND
 * is a genuine local maximum there (see HUM_PEAK_SPAN_SEC), preferring the
 * higher correlation when both do; null when the buffer is quieter than
 * HUM_FLOOR_DB (nothing to correlate) or neither qualifies.
 *
 * HUM_CORR alone isn't enough: a musical note whose frequency happens to put
 * a near-whole number of its own cycles inside the 50/60 Hz lag also clears
 * it. A held D3 (146.83 Hz) puts 2.937 cycles inside the 50 Hz lag at 48kHz
 * — r ≈ 0.92, comfortably over HUM_CORR — even though D3's OWN
 * autocorrelation peak sits at 981 samples (3 full cycles), 21 samples away.
 * B3 (246.94 Hz) does the same at ≈0.93. Requiring the candidate lag to
 * itself be a local peak (not just above the bar) rejects both without
 * touching a real hum's own reading, since real hum's peak IS at that lag.
 *
 * Known limit: a note within about a semitone of 50/60 Hz can still slip
 * through — its own peak would then sit within HUM_PEAK_SPAN_SEC of the
 * nominal lag too. createInputHealth's HUM_AFTER_SEC hold is what keeps a
 * single held note like that from reading as hum: a bass note that long and
 * that steady is already an unusual mix choice, and a real ground loop hum,
 * unlike a bass note, never stops.
 */
export function mainsHumHz(mono: Float32Array, sampleRate: number): 50 | 60 | null {
  if (mono.length < 2 || sampleRate <= 0) return null;
  const level = rms(mono);
  const levelDb = level > 0 ? 20 * Math.log10(level) : -Infinity;
  if (levelDb < HUM_FLOOR_DB) return null;

  const peakSpan = Math.max(1, Math.round(sampleRate * HUM_PEAK_SPAN_SEC));
  const isMainsPeak = (lag: number, r: number): boolean =>
    r >= autocorrelation(mono, lag - peakSpan) && r >= autocorrelation(mono, lag + peakSpan);

  const lag50 = Math.round(sampleRate / 50);
  const lag60 = Math.round(sampleRate / 60);
  const r50 = autocorrelation(mono, lag50);
  const r60 = autocorrelation(mono, lag60);

  let best: 50 | 60 | null = null;
  let bestR = HUM_CORR;
  if (r50 >= bestR && isMainsPeak(lag50, r50)) {
    best = 50;
    bestR = r50;
  }
  if (r60 >= bestR && isMainsPeak(lag60, r60)) {
    best = 60;
    bestR = r60;
  }
  return best;
}

export function createInputHealth(): InputHealth {
  // Clipping — re-armed to the full hold on every clipped tick; counts down
  // only once clipping stops.
  let clipHoldSec = 0;
  let clipChannel: "left" | "right" | "both" = "both";

  // Skipping — same re-armed-hold shape as clipping.
  let skipHoldSec = 0;
  // The last glitchFrames reading advance() saw, so a rise can be detected —
  // null both before the first reading and whenever readings themselves are
  // null (a track with no MediaStreamTrack.stats never leaves this null).
  let prevGlitchFrames: number | null = null;

  // Silent — silentSec is the entry timer (continuous time under SILENT_DB,
  // reset the moment rmsDb climbs back over it); isSilent is the latched,
  // reported state, which only clears past SILENT_DB + SILENT_CLEAR_MARGIN_DB.
  let silentSec = 0;
  let isSilent = false;

  // Hum — humSec is the entry timer (continuous time with a non-null
  // humHz), humClearSec counts time without one while already reporting hum.
  let humSec = 0;
  let humClearSec = 0;
  let isHum = false;
  let humHzLatched: 50 | 60 = 50;

  function reset(): void {
    clipHoldSec = 0;
    clipChannel = "both";
    skipHoldSec = 0;
    prevGlitchFrames = null;
    silentSec = 0;
    isSilent = false;
    humSec = 0;
    humClearSec = 0;
    isHum = false;
  }

  function advance(dtSec: number, m: InputMeasure): InputHealthReading {
    const dt = Number.isFinite(dtSec) && dtSec > 0 ? dtSec : 0;

    // ---- clipping ----
    const clippedL = m.peakL >= CLIP_LEVEL;
    const clippedR = m.peakR !== null && m.peakR >= CLIP_LEVEL;
    if (clippedL || clippedR) {
      const side: "left" | "right" | "both" = m.peakR === null || (clippedL && clippedR) ? "both" : clippedL ? "left" : "right";
      // A clip on the OTHER side while still inside a previous clip's hold
      // accumulates to "both" instead of overwriting it — left/right/both
      // is over the whole hold, not just this tick. clipHoldSec here is
      // still last tick's value (checked before it's re-armed below), so
      // this only accumulates while a hold was actually still running; once
      // it's fully expired the next clip starts fresh from its own side.
      clipChannel = clipHoldSec > 0 && clipChannel !== side ? "both" : side;
      clipHoldSec = CLIP_HOLD_SEC;
    } else if (clipHoldSec > 0) {
      clipHoldSec = Math.max(0, clipHoldSec - dt);
    }

    // ---- skipping ----
    let glitched = false;
    if (m.glitchFrames !== null) {
      if (prevGlitchFrames !== null && m.glitchFrames > prevGlitchFrames) glitched = true;
      prevGlitchFrames = m.glitchFrames;
    }
    if (glitched) skipHoldSec = SKIP_HOLD_SEC;
    else if (skipHoldSec > 0) skipHoldSec = Math.max(0, skipHoldSec - dt);

    // ---- silent ----
    if (m.rmsDb < SILENT_DB) {
      silentSec += dt;
    } else {
      silentSec = 0;
      if (m.rmsDb >= SILENT_DB + SILENT_CLEAR_MARGIN_DB) isSilent = false;
    }
    if (silentSec >= SILENT_AFTER_SEC) isSilent = true;

    // ---- hum ----
    if (m.humHz !== null) {
      humSec += dt;
      humClearSec = 0;
      humHzLatched = m.humHz;
    } else {
      humSec = 0;
      if (isHum) {
        humClearSec += dt;
        if (humClearSec >= HUM_CLEAR_SEC) isHum = false;
      }
    }
    if (humSec >= HUM_AFTER_SEC) isHum = true;

    // ---- priority: clipping > skipping > silent > hum > ok ----
    if (clipHoldSec > 0) return { kind: "clipping", channel: clipChannel };
    if (skipHoldSec > 0) return { kind: "skipping" };
    if (isSilent) return { kind: "silent" };
    if (isHum) return { kind: "hum", humHz: humHzLatched };
    return { kind: "ok" };
  }

  return { advance, reset };
}
