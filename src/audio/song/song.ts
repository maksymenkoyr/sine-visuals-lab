// What the song layer (songLayer.ts) reads its triggers and rangers from. Copied from audio-subsystem/v6/src/song.ts
// (2026-10-30, #798/#800), keeping only what the layer needs; tests/songLayer.test.ts and the bench check (audio-subsystem's
// bench-signals, probe app-song) hold the layer's readings equal to v6's. The reading's own field list is SongFrame in
// ../types.ts.

import type { RangedField } from "./range.ts";
import type { TriggerSpec } from "./trigger.ts";

export type TriggeredField = "kick" | "clap" | "hat" | "chord";

/** A trigger gated on `playing` fires only while it is at least this, so it stays quiet in silence. */
export const PLAYING_GATE = 0.5;

// Form, window, quantile and gate: picked over bench-signals/results/rich-v6-tune4 by v6-pick (rule v4: at most
// SILENCE_MAX_PER_MIN firings a minute in silence, then awake in every section of the line-in case unless that costs more
// than PICK_SPREAD of mic strength), seeds 1 and 2 of the rich song (#798). `riseS` triggers on the level's rise
// (./rise.ts), because under a sustained bass the level never dips under its own quantile for a hit to cross up through.
// The clap stays on its level: the rise form that held every section scored far lower and claimed four false claps to a real
// one. The hat reads the app's Hats split, which beat v4's level there by far.
export const TRIGGERS: Record<TriggeredField, TriggerSpec> = {
  kick: { windowS: 64, quantile: 0.9, gate: "playing", riseS: 0.1 },
  clap: { windowS: 64, quantile: 0.9, gate: "music" },
  hat: { windowS: 128, quantile: 0.8, gate: "music", riseS: 0.05 },
  chord: { windowS: 128, quantile: 0.98, gate: "music", riseS: 0.1 },
};

// The ranger of each ranged field (names in ./range.ts RANGERS), picked over bench-signals/results/rich-v6-tune4 by
// v6-range-pick (#798). The Hats split is 0..1 already, so `hatLevel` only needs clipping. The drop level uses `affine`,
// not tune4's best `fixed2`: both are static and keep the score, but `fixed2` sat between a third and a half of the range on
// every input, which a Drop row would draw as flat (scored in results/rich-v6d).
export const RANGES: Record<RangedField, string> = {
  loudness: "db60",
  hatLevel: "top1",
  chordLevel: "top3",
  dropLevel: "affine",
  inDrop: "minmax60",
};
