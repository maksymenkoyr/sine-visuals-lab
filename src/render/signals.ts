import type { FeatureFrame } from "../audio/types.ts";
import type { AnimFrame } from "./animClock.ts";

/**
 * The seam between the meters (src/ui/audioMeters.ts) and scene settings
 * (src/render/sceneSettings.ts's `reads` field): a catalogue of the live
 * values a scene's own JS/GLSL can be driven by, named once so a setting row
 * and a meter row can refer to the same thing instead of each hand-rolling a
 * label. Same idea as MUSIC_DIALS/DIAL_LABELS (musicProfile.ts) — a keyed,
 * self-documenting registry the panel renders *from* rather than duplicates.
 *
 * This is purely descriptive. Nothing here is read by a scene at render
 * time — the actual driving happens in each scene's own `extraUniforms`
 * closure or shader body, in arbitrary JS/GLSL no static analysis here could
 * verify. A `SceneSetting.reads` entry is a claim by the scene's author;
 * tests/signals.test.ts is what keeps a stale claim from becoming a silently
 * wrong label instead of a red test.
 *
 * Populate SIGNALS on demand, not exhaustively: an entry no setting cites is
 * an unverifiable claim about where something is visible in the panel.
 *
 * A note on `kind: "edge"`: deviceMenu.ts's DeviceMenu.update() is called
 * every rAF tick (src/app.ts:904), ahead of the render-rate cap
 * (shouldRenderFrame, framePace.ts) that gates scene.render() itself. So a
 * one-shot boolean like AnimFrame.lowOnset can fire on a tick the meters see
 * but a rate-capped scene's render() never does — reading the raw boolean
 * here would make a signal pill blink on triggers the scene silently
 * dropped, which is confusing without context. Every `read()` below returns
 * the matching *pulse envelope* instead (already decaying 0..1 on its own,
 * e.g. bandEnergy's lowPulse) so a pill stays visibly accurate regardless of
 * the render cap, and its blink is just that decay made visible — see each
 * entry's own comment for the field it stands in for.
 */

/** Every card src/ui/audioMeters.ts mounts, keyed by its own `foldId`.
 *  Populated on demand: add an id here only once some SignalSpec below
 *  actually points at that card. */
export type MeterCardId = "scope" | "signal" | "lufs" | "rhythm" | "character";

/** A row within a card, for the same anchor — only rows a SignalSpec
 *  currently points at need an id (see MeterCardId above). */
export type MeterRowId = "section" | "tempo" | "hits" | "centroid";

export type SignalId = "feature.onset" | "anim.lowOnset" | "anim.dropOnset" | "anim.centroid";

export interface SignalSpec {
  id: SignalId;
  /** What the panel calls it — matches its meter row's own label. */
  label: string;
  /** One line: what this measures, and why it isn't the obvious neighbour. */
  description: string;
  /** "level" is a sustained reading; "edge" is a one-shot trigger, read here
   *  as its decaying pulse envelope rather than a boolean — see file header. */
  kind: "level" | "edge";
  read(frame: FeatureFrame, anim: AnimFrame): number;
  /** The meter row that displays this, if any — see MeterCardId/MeterRowId's
   *  own doc comments above for why this is a small, hand-maintained set
   *  rather than every row in the panel. Omit for a signal nothing shows
   *  yet: the setting row's pill still renders its own live value, it just
   *  offers no jump. */
  monitor?: { card: MeterCardId; row: MeterRowId };
  /** Which bands this signal actually watches, for the spectrum strip's
   *  hover highlight (spectrumStrip.ts's setHighlight, wired in
   *  deviceMenu.ts) — resolved against the live band split (bandSplit.ts)
   *  by the caller, not a fixed index range, since the split is
   *  user-configurable. "all" for a broadband read (features.ts's flux
   *  sums every band); "low" for the low group bandEnergy.ts tracks (bands
   *  [0, split.lowMid)). Omit for a signal that isn't a frequency read at
   *  all (anim.dropOnset is section loudness) — no highlight for those. */
  bandRange?: "all" | "low";
}

function signal(spec: SignalSpec): SignalSpec {
  return spec;
}

/** One entry in `SceneSetting.reads` (sceneSettings.ts) — either just a
 *  signal id (this setting always responds to it), or a signal id plus
 *  `activeWhen`, for a setting that only responds while some other setting
 *  sits on a particular side of its own range. Caustics' Ripple source
 *  switching which of Beat ripple's triggers actually fires a ring is the
 *  motivating case: Beat ripple lists all three signals, Bass hit
 *  unconditional and Beat gated on `rippleSrc < 0.5`; Ripple source itself
 *  lists the same two signals with the matching (and complementary)
 *  predicates, so dragging it shows which trigger it just switched onto.
 *  `get` reads a sibling setting's resolved value (auto-aware, the same
 *  number the shader sees) by key rather than by spec object, since the
 *  device menu already keys its settings that way for the pin/typed-entry
 *  path (src/tuning/pins.ts). */
export type SignalLink =
  | SignalId
  | {
      signal: SignalId;
      activeWhen: (get: (key: string) => number) => boolean;
    };

export const SIGNALS: Record<SignalId, SignalSpec> = {
  "feature.onset": signal({
    id: "feature.onset",
    label: "Beat",
    description:
      "The broadband onset flag straight off the audio pipeline (FeatureFrame.onset) — read here as AnimFrame.beatPulse, its decaying continuous form (animClock.ts), which is also what the Rhythm card's beat dot lights from and its Hits row's Beat bar tracks.",
    kind: "edge",
    read: (_frame, anim) => anim.beatPulse,
    monitor: { card: "rhythm", row: "hits" },
    bandRange: "all",
  }),
  "anim.lowOnset": signal({
    id: "anim.lowOnset",
    label: "Bass hit",
    description:
      "The low-band (kick) onset edge (AnimFrame.lowOnset), read here as bandEnergy's lowPulse — its decaying envelope, so the pill stays accurate even on a render-capped tick the edge itself never reaches a scene through.",
    kind: "edge",
    read: (_frame, anim) => anim.lowPulse,
    monitor: { card: "rhythm", row: "hits" },
    bandRange: "low",
  }),
  "anim.dropOnset": signal({
    id: "anim.dropOnset",
    label: "Drop",
    description:
      "A section-level loudness drop (AnimFrame.dropOnset), read here as sectionIntensity's dropPulse — its decaying flash, the same reasoning as Bass hit.",
    kind: "edge",
    read: (_frame, anim) => anim.dropPulse,
    monitor: { card: "rhythm", row: "section" },
  }),
  "anim.centroid": signal({
    id: "anim.centroid",
    label: "Centroid",
    description:
      "The live spectral centroid (AnimFrame.centroid, spectralCentroid.ts) — a fast, range-adapted counterpart to the slow Brightness dial above it on the Character card.",
    kind: "level",
    read: (_frame, anim) => anim.centroid,
    monitor: { card: "character", row: "centroid" },
  }),
};
