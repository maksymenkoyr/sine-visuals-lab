// The pair-comb tempo estimator the song layer's tempo analyzer and feature extractor use is the app's own, which equals
// the one in audio-subsystem/v6/src/song/v4 (2026-10-30, #798/#800) line for line, comments aside; the bench check
// (bench-signals' probe app-song) holds the readings equal to v6. What the app's file lacks is v4's decay constant below,
// kept here so the copied files that import it stay as copied.

export { BPM_MAX, BPM_MIN, estimateTempo } from "../../../tempoComb.ts";

/** How long a caller holds its tempo after the last onset before letting it decay to 0; v4's value. */
export const TEMPO_DECAY_SEC = 3;
