// Copied from audio-subsystem/v6/src/song/v4 (2026-10-30, #798/#800), which is v4's code with the browser-storage reads and writes cut; the bench check (bench-signals' probe app-song) holds it equal to v6. Edits: unused code removed, `engine` and `song` set to null in the frame it makes.

/**
 * Per-scene mic sensitivity, expansion, and smoothing: three visual gain
 * stages on top of FeatureExtractor's auto-normalized [0,1] output. The
 * extractor's leaky floor/peak tracker already adapts to a room's
 * quiet/loud levels, so none of these is a gain-staging fix — they're a
 * user preference ("react harder" / "calm down", "more punch" / "flatter",
 * "snappier" / "smoother") remembered per scene, since each scene's shader
 * weights uEnergy/uBands differently.
 *
 * Smoothing is a multiplier on the pipeline's own easing, not the easing
 * itself — SMOOTHING_DEFAULT (1x) means "the designed amount", not "none",
 * and nothing in [SMOOTHING_MIN, SMOOTHING_MAX] ever reaches zero (see
 * smoothingRateScale below). Only the Smoothing row's explicit Off stop
 * (zeroAtMin in deviceMenu.ts, stored as 0 — below SMOOTHING_MIN, which
 * stays the slider's log-curve floor) reaches genuinely unsmoothed: at 0,
 * smoothingRateScale returns Infinity, and every stage it reaches
 * (features.ts's envelope, sectionIntensity.ts's INTENSITY_SLEW,
 * musicProfile.ts's eases, audioMeters.ts's BPM settle and waveform
 * peak-hold) snaps straight to its target that same tick. That's what makes
 * the meters panel's RAW chip a true no-op: RAW already shows each of those
 * targets, so at Smoothing Off (with band gains at 1x and auto-gain off —
 * Sensitivity/Expansion don't reach the meters at all, see src/app.ts) there
 * is nothing left for RAW to bypass.
 */



export const SMOOTHING_DEFAULT = 1;








/**
 * Smoothing scales every visual envelope's decay/slew rate — how fast the
 * visuals chase the audio, independent of Sensitivity's gain and
 * Expansion's curve. The slow half (smoothing > 1) is linear: 4x smoothing means
 * quarter-rate, so a scene fully settles into a calm swell. The fast half
 * is square-rooted instead of linear: at 0.25x this is only 2x the rate,
 * not 4x. That asymmetry is deliberate, not stylistic — the level slew this
 * feeds (bandEnergy.ts's LEVEL_SLEW_PER_SEC) doubles as the strobe guard
 * that keeps geometry-driving uniforms from jumping most of the way to a
 * new value in one frame, so "snappier" gets a shorter leash than
 * "smoother". Continuous at 1x (both branches equal 1 there).
 *
 * At 0 (the Smoothing row's Off stop) this is 1/sqrt(0) = Infinity — every
 * stage it reaches is written to treat a non-finite scale as "assign the
 * target directly" rather than compute a coefficient, so Off means exactly
 * unsmoothed, not merely fast.
 */
export function smoothingRateScale(smoothing: number): number {
  return smoothing >= 1 ? 1 / smoothing : 1 / Math.sqrt(smoothing);
}


