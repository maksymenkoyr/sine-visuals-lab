/**
 * Amount, AUTO_GAIN_MIN..AUTO_GAIN_MAX, for the per-band adaptive auto-gain
 * in features.ts: how far each band's mapping is pulled from the analyser's
 * fixed dB window toward its own adaptive floor/peak window (the blend itself
 * lives in FeatureExtractor.update). AUTO_GAIN_MIN is the fixed mapping
 * alone, which keeps the music's real bass-to-treble tilt; AUTO_GAIN_MAX the
 * adaptive one alone, which flattens it by design.
 *
 * Never a setting: the amount follows FeatureExtractor.bandSpanDb, the
 * room/mic's own measured dB range, rather than autoTune.ts's MUSIC_DIALS.
 * Those dials describe the music, not the room, and nothing there measures
 * "how much of the analyser's window is this input actually using" — which
 * is exactly what needs fixing here. That span reading is what makes
 * different mics and rooms converge toward the same look. Blind spot: a
 * compressed loud track reads as narrow a span as a quiet mic.
 *
 * One amount per device, not per scene: how much the input needs describes
 * the input, not one scene's look. Only app.ts's capture loop feeds it.
 */

import { warmRate } from "./warmStart.ts";

export const AUTO_GAIN_MIN = 0;
export const AUTO_GAIN_MAX = 1;

// The amount before the room has been measured: the fixed mapping, so the
// first seconds keep the music's real tilt.
let eased = AUTO_GAIN_MIN;
// Seconds fed to feedAutoGainMeasurement this session. Feeds warmStart.ts's
// warmRate() below.
let warmSec = 0;

/** The amount FeatureExtractor.update() should use this tick. */
export function resolveAutoGain(): number {
  return eased;
}

/** Back to the unmeasured amount and a fresh warm-up, for tests. */
export function resetAutoGain(): void {
  eased = AUTO_GAIN_MIN;
  warmSec = 0;
}

// Span (dB) knees mapping FeatureExtractor.bandSpanDb to an auto-gain
// amount. SPAN_CRUSHED_DB sits just above features.ts's own MIN_RANGE_DB
// (the floor it clamps a band's range to for the norm calculation) — a room
// that never opens up more than that needs the adaptive path at full
// strength to use the display at all. SPAN_FULL_DB is deliberately far
// short of the fixed window's own span (ANALYSER_MAX_DB - ANALYSER_MIN_DB):
// a single band swinging even half that far across a track is already a
// genuinely wide, well-used range, and asking for the full window before
// backing off would mean the amount never reaches AUTO_GAIN_MIN on real
// music.
const SPAN_CRUSHED_DB = 15;
const SPAN_FULL_DB = 45;

// Steady-state time constant for easing toward the target below — ~4s to
// reach ~63% of the way there. Deliberately slower than the music: a value
// that tracked the room in real time would make the gap this amount opens
// between auto-gained and fixed-mapping energy (features.ts's fixedEnergy)
// breathe with the music instead of with the room. warmStart.ts's warmRate()
// handles the first seconds (see `warmSec` above), so this constant
// describes only the steady-state averaging.
const EASE_RATE = 0.25;

/** Pure mapping from a measured mean band span to the auto-gain amount that
 *  span calls for — wider room span needs less help, narrower needs more.
 *  Exported for tests; feedAutoGainMeasurement() is the only real caller. */
export function autoGainForSpan(meanSpanDb: number): number {
  if (!Number.isFinite(meanSpanDb)) return AUTO_GAIN_MIN;
  if (meanSpanDb <= SPAN_CRUSHED_DB) return AUTO_GAIN_MAX;
  if (meanSpanDb >= SPAN_FULL_DB) return AUTO_GAIN_MIN;
  const t = (meanSpanDb - SPAN_CRUSHED_DB) / (SPAN_FULL_DB - SPAN_CRUSHED_DB);
  return AUTO_GAIN_MAX - t * (AUTO_GAIN_MAX - AUTO_GAIN_MIN);
}

/** Called once per tick (app.ts, right after FeatureExtractor.update()) with
 *  this tick's FeatureExtractor.bandSpanDb and the AudioContext-clock delta
 *  since the last call — never a rAF delta, which drifts frame-rate-
 *  dependent on a 120Hz display (see the render-cap-one-shots note). */
export function feedAutoGainMeasurement(meanSpanDb: number, dtSec: number): void {
  const target = autoGainForSpan(meanSpanDb);
  const dt = Number.isFinite(dtSec) ? Math.max(0, dtSec) : 0;
  eased += (target - eased) * (1 - Math.exp(-warmRate(EASE_RATE, warmSec) * dt));
  warmSec += dt;
}
