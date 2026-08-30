/**
 * Global amount, AUTO_GAIN_MIN..AUTO_GAIN_MAX, for the per-band adaptive
 * auto-gain in features.ts: how far each band's mapping is pulled from the
 * analyser's fixed dB window toward its own adaptive floor/peak window (the
 * blend itself lives in FeatureExtractor.update). AUTO_GAIN_MIN is the fixed
 * mapping alone, AUTO_GAIN_MAX the adaptive one alone; anything between
 * keeps some of the music's real bass-to-treble tilt while still converging
 * different mics/rooms toward the same look.
 *
 * Global per device (not per scene, unlike src/audio/sensitivity.ts and
 * src/render/sceneSettings.ts) — like src/audio/bandSplit.ts, how much the
 * room/mic needs auto-gain describes the input, not one scene's look, so it
 * should carry across scene switches. Same in-memory-cache-over-localStorage
 * pattern as bandSplit.ts: the cache is the source of truth for get/set
 * within a session, seeded once from localStorage, so behavior stays correct
 * even where localStorage is unavailable (node test env, Safari private mode).
 *
 * Default is AUTO_GAIN_MIN — the fixed mapping preserves the music's real
 * tilt, which the adaptive path flattens by design. This setting used to be
 * an on/off switch stored as "1"/"0" under the same key; those strings parse
 * as the two ends of the range, so nothing needs migrating.
 *
 * Auto mode below picks the amount from FeatureExtractor.bandSpanDb (the
 * room/mic's own measured dB range) rather than autoTune.ts's MUSIC_DIALS:
 * those dials describe the music, not the room, and nothing there measures
 * "how much of the analyser's window is this input actually using" — which
 * is exactly what needs fixing here, and is already tracked unconditionally
 * (see bandSpanDb's own doc comment). Unlike autoTune.ts's exceptions store
 * (absent key == auto), auto here is opt-in and defaults off: this setting's
 * own default is AUTO_GAIN_MIN specifically to preserve real tilt, and
 * flipping every existing user to auto on upgrade would quietly override
 * that choice for them.
 */

const STORAGE_KEY = "vibe.autoGain";
const STORAGE_KEY_AUTO = "vibe.autoGainAuto";
export const AUTO_GAIN_MIN = 0;
export const AUTO_GAIN_MAX = 1;
export const AUTO_GAIN_DEFAULT = AUTO_GAIN_MIN;

function clamp(value: number): number {
  if (!Number.isFinite(value)) return AUTO_GAIN_DEFAULT;
  return Math.min(AUTO_GAIN_MAX, Math.max(AUTO_GAIN_MIN, value));
}

function loadInitial(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return AUTO_GAIN_DEFAULT;
    return clamp(Number(raw));
  } catch {
    return AUTO_GAIN_DEFAULT;
  }
}

function loadInitialAuto(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY_AUTO) === "1";
  } catch {
    return false;
  }
}

let cache: number = loadInitial();
let autoOn: boolean = loadInitialAuto();
// The auto-resolved amount, eased toward autoGainForSpan()'s target by
// feedAutoGainMeasurement() — never persisted, since it's re-derived from
// the room on every session. Seeded from the manual value below (both here
// and on setAutoGainAuto(true)) so a fresh page load with auto already on
// doesn't start from a stale reading.
let eased: number = cache;

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(cache));
  } catch {
    // Not fatal — the setting just won't persist across reloads.
  }
}

function persistAuto(): void {
  try {
    localStorage.setItem(STORAGE_KEY_AUTO, autoOn ? "1" : "0");
  } catch {
    // Not fatal — the setting just won't persist across reloads.
  }
}

export function getAutoGain(): number {
  return cache;
}

export function setAutoGain(next: number): void {
  cache = clamp(next);
  persist();
}

export function isAutoGainAuto(): boolean {
  return autoOn;
}

export function setAutoGainAuto(on: boolean): void {
  if (on === autoOn) return;
  autoOn = on;
  // Seed from the manual value so the row doesn't jump on the chip click —
  // same reasoning as autoTune.ts's seedAuto for the scene-setting rows.
  if (on) eased = cache;
  persistAuto();
}

/** The value FeatureExtractor.update() should actually use this tick: the
 *  eased auto reading while auto is on, the plain manual store otherwise. */
export function resolveAutoGain(): number {
  return autoOn ? eased : cache;
}

// Span (dB) knees mapping FeatureExtractor.bandSpanDb to an auto-gain
// amount. SPAN_CRUSHED_DB sits just above features.ts's own MIN_RANGE_DB
// (12dB, the floor it clamps a band's range to for the norm calculation) —
// a room that never opens up more than that needs the adaptive path at full
// strength to use the display at all. SPAN_FULL_DB is deliberately far
// short of the fixed window's own 90dB span (ANALYSER_MAX_DB -
// ANALYSER_MIN_DB): a single band swinging even half that far across a
// track is already a genuinely wide, well-used range, and asking for the
// full 90 before backing off would mean auto never reaches AUTO_GAIN_MIN on
// real music.
const SPAN_CRUSHED_DB = 15;
const SPAN_FULL_DB = 45;

// Time constant for easing toward the target below — ~10s to reach ~63% of
// the way there, on the order of musicProfile.ts's own dial eases (e.g.
// TEMPO_EASE_RATE's ~7s). Deliberately slow: the Signal card's history
// trace (src/ui/audioMeters.ts) draws the gap this amount opens between
// Level and Energy, and a value that tracked the room in real time would
// make that gap breathe with the music instead of with the room.
const EASE_RATE = 0.1;

/** Pure mapping from a measured mean band span to the auto-gain amount that
 *  span calls for — wider room span needs less help, narrower needs more.
 *  Exported for tests; feedAutoGainMeasurement() is the only real caller. */
export function autoGainForSpan(meanSpanDb: number): number {
  if (!Number.isFinite(meanSpanDb)) return AUTO_GAIN_DEFAULT;
  if (meanSpanDb <= SPAN_CRUSHED_DB) return AUTO_GAIN_MAX;
  if (meanSpanDb >= SPAN_FULL_DB) return AUTO_GAIN_MIN;
  const t = (meanSpanDb - SPAN_CRUSHED_DB) / (SPAN_FULL_DB - SPAN_CRUSHED_DB);
  return AUTO_GAIN_MAX - t * (AUTO_GAIN_MAX - AUTO_GAIN_MIN);
}

/** Called once per tick (app.ts, right after FeatureExtractor.update()) with
 *  this tick's FeatureExtractor.bandSpanDb and the AudioContext-clock delta
 *  since the last call — never a rAF delta, which drifts frame-rate-
 *  dependent on a 120Hz display (see the render-cap-one-shots note). A
 *  no-op while auto is off, so `eased` doesn't drift out from under a
 *  manual value it isn't driving. */
export function feedAutoGainMeasurement(meanSpanDb: number, dtSec: number): void {
  if (!autoOn) return;
  const target = autoGainForSpan(meanSpanDb);
  const dt = Number.isFinite(dtSec) ? Math.max(0, dtSec) : 0;
  eased += (target - eased) * (1 - Math.exp(-EASE_RATE * dt));
}
