import type { FeatureFrame } from "../audio/types.ts";
import type { AnimFrame } from "./animClock.ts";
import { BPM_MIN, BPM_MAX } from "../audio/features.ts";
import { DIAL_LABELS, MUSIC_DIALS, type MusicDial } from "./musicProfile.ts";

/**
 * The seam between the meters (src/ui/audioMeters.ts), scene settings
 * (src/render/sceneSettings.ts's `reads` field) and the drive system
 * (src/render/drives.ts): a catalogue of the live values a scene's own
 * JS/GLSL can be driven by, named once so a setting row, a meter row and a
 * drive source picker can all refer to the same thing instead of each
 * hand-rolling a label. Same idea as MUSIC_DIALS/DIAL_LABELS
 * (musicProfile.ts) — a keyed, self-documenting registry the panel renders
 * *from* rather than duplicates.
 *
 * A plain (non-"scene", non-grid, non-line) DriveChoice *is* a SignalId —
 * drives.ts reuses this catalogue rather than keeping a parallel list, which
 * is also why `read()` stays pure and side-effect-free: drives.ts calls it
 * every tick for every setting whose choice names a SignalId. `kind: "edge"`
 * entries pair with the one-shot boolean noted in each entry's own comment
 * (AnimFrame.lowOnset, …) — drives.ts's `fired()` reads that boolean
 * straight off the render-latched AnimFrame it's handed (see renderLatch.ts
 * and drives.ts's own header), never through `read()` here, which always
 * returns the decaying envelope instead (see the next paragraph). `kind:
 * "level"` entries have no paired edge — a sustained reading has no rising
 * instant to latch — so `fired()` on one of these instead runs the source's
 * own weighted reading through a per-source Schmitt trigger
 * (src/render/valueTrigger.ts) that turns "crossed a fire mark" into a
 * one-shot the way a real edge would, rather than falling back to whatever
 * `sceneDefaultFired` the caller passed in (the drawn line, `{ source:
 * "line" }`, is the other DriveChoice with no edge and takes the same path —
 * see drives.ts's own header).
 *
 * This is otherwise purely descriptive for the `reads` role: nothing reads
 * a `SceneSetting.reads` entry at render time — the actual driving happens
 * in each scene's own `extraUniforms` closure or shader body, in arbitrary
 * JS/GLSL no static analysis here could verify. A `reads` entry is a claim
 * by the scene's author; tests/signals.test.ts is what keeps a stale claim
 * from becoming a silently wrong label instead of a red test. A setting with
 * `SceneSetting.drive` doesn't author `reads` at all — its row's live pill
 * is derived from the drive choice itself instead (sceneSettings.ts's own
 * `drive` doc comment).
 *
 * The tempo family splits into two: `anim.metronome`/`anim.metronomeBar`
 * (and the Beat wave/Bar wave/Tempo entries, which now ride the metronome's
 * own level/phase/bpm) read metronome.ts's steady, always-evenly-spaced
 * clock; the plain Beat grid choice (drives.ts's `{source:"beat", grid}`,
 * gridPulse.ts) reads the tracker's own beat live instead, falling back to
 * raw hits whenever it isn't sure — see metronome.ts's own header for why
 * these are two different things rather than one setting.
 *
 * Populate SIGNALS on demand, not exhaustively: an entry no setting cites is
 * an unverifiable claim about where something is visible in the panel — this
 * relaxes once a drive's picker offers the *whole* catalogue on every row
 * (see drives.ts), since every entry is then reachable from the panel by
 * construction.
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
 * entry's own comment for the field it stands in for. drives.ts's GLSL/JS
 * *value* uploads (u<Key>Drive, drives.value()) go through this same
 * envelope read — only its edge-latched `fired()` needs the raw boolean.
 *
 * "All level" (`anim.energy`) and "Level" (`feature.level`) are the two
 * entries whose `read()` actually uses its `frame` argument (`frame.energy`
 * and `frame.level`, not anything off `anim`) — every other entry ignores
 * `frame` entirely. drives.ts feeds them the sensitivity-applied frame
 * (matching what a scene's own `uEnergy` sees — see that file's header), so
 * a setting driven by "All level" and a scene's plain `uEnergy` uniform read
 * the identical number. Called elsewhere (a setting row's live pill) with
 * the plain band-gained frame instead, so that pill can read very slightly
 * ahead of Sensitivity/Expansion — an accepted cosmetic gap, not a claim
 * this file makes about the render path. `level` comes through both frames
 * raw (src/audio/sensitivity.ts's applySensitivity never shapes it), which
 * is why Level, unlike All level, reads 0 in a silent room.
 *
 * The `dial.*` entries (DIAL_SIGNALS) are generated from MUSIC_DIALS, one
 * per dial, so a new dial gets a jack by construction. Each reads the eased
 * dial straight off AnimFrame.profile — the slow track description Auto
 * resolves against (musicProfile.ts) — so a wire on one moves over seconds,
 * not per hit, and does what its dial does through silence: rests at
 * NEUTRAL, except `dial.loudness`, which keeps its last reading.
 */

/** Every card src/ui/audioMeters.ts mounts, keyed by its own `foldId`.
 *  Populated on demand: add an id here only once some SignalSpec below
 *  actually points at that card. */
export type MeterCardId = "signal" | "hits" | "tempo" | "character";

/** A row within a card, for the same anchor — only rows a SignalSpec
 *  currently points at need an id (see MeterCardId above). "tempo" is the
 *  Tempo card's BPM-digits/beat-dot block (audioMeters.ts's own
 *  createTempoBlock) — the anchor for both `anim.metronome` and
 *  `anim.tempo`, whose jacks mount there (the card *is* the metronome's
 *  number, ticking; see metronome.ts's own header). "wave"/"lock" are the
 *  plain meter rows `anim.beatWave`/`anim.barWave`/`anim.tempoLock` point at
 *  instead; "timing" is the Tempo card's own Timing strip
 *  (createTimingStrip), the anchor for `anim.metronomeBar`. "waveform" is
 *  the Dynamics card's own Waveform row, first in its body (audioMeters.ts's
 *  `waveform` meter row) — `anim.wavePeak`'s anchor, not to be confused with
 *  "wave" above (the beat/bar swing trace, a different row entirely).
 *  "centroid" is the Character card's Brightness row (dialRows' own
 *  `brightness` entry) — `anim.centroid`'s anchor, since its trace now
 *  draws directly under that dial's bar rather than a row of its own. Each
 *  dial's own cell is its DialSignalId, "dial.brightness" naming the same
 *  Brightness row as "centroid". */
export type MeterRowId = "section" | "tempo" | "hits" | "centroid" | "wave" | "lock" | "timing" | "waveform" | DialSignalId;

/** One Character-card dial as a signal — see this file's header. */
export type DialSignalId = `dial.${MusicDial}`;

export function dialSignalId(dial: MusicDial): DialSignalId {
  return `dial.${dial}`;
}

/** Every dial signal, in MUSIC_DIALS order. */
export const DIAL_SIGNALS: readonly DialSignalId[] = MUSIC_DIALS.map(dialSignalId);

export type SignalId =
  | DialSignalId
  | "feature.onset"
  | "feature.flux"
  | "feature.level"
  | "anim.lowOnset"
  | "anim.midOnset"
  | "anim.highOnset"
  | "anim.dropOnset"
  | "anim.low"
  | "anim.mid"
  | "anim.high"
  | "anim.energy"
  | "anim.sectionIntensity"
  | "anim.centroid"
  | "anim.wavePeak"
  | "anim.beatWave"
  | "anim.barWave"
  | "anim.tempo"
  | "anim.tempoLock"
  | "anim.metronome"
  | "anim.metronomeBar";

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
  /** For a `kind: "edge"` entry, the render-latched one-shot boolean
   *  `read()`'s own envelope decays from (AnimFrame.onset, .lowOnset, …) —
   *  what drives.ts's fired() reads for a plain catalogue choice. Required
   *  for every `kind: "edge"` entry (tests/signals.test.ts checks this);
   *  absent for `kind: "level"` entries, which have no natural edge —
   *  drives.ts's fired() converts one of these through a Schmitt trigger
   *  (valueTrigger.ts) instead, per this file's header. */
  edge?: (anim: AnimFrame) => boolean;
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
   *  sums every band); "low"/"mid"/"high" for that group's own range
   *  (bandEnergy.ts). Omit for a signal that isn't a frequency read at all
   *  (anim.dropOnset is section loudness) — no highlight for those. */
  bandRange?: "all" | "low" | "mid" | "high";
}

function signal(spec: SignalSpec): SignalSpec {
  return spec;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** "Onset surge" is the broadband flux ratio (1 = the detector's bare
 *  trigger) rescaled so SURGE_RATIO_FLOOR reads 0 and SURGE_RATIO_CEIL
 *  reads 1. Exported so the Hits card's Surge lane can mark where Beat
 *  fires on that same scale (surgeAtThreshold) instead of copying the
 *  numbers. */
const SURGE_RATIO_FLOOR = 0.6;
const SURGE_RATIO_CEIL = 2.0;
export const surgeAtThreshold = clamp01((1 - SURGE_RATIO_FLOOR) / (SURGE_RATIO_CEIL - SURGE_RATIO_FLOOR));

/** One entry in `SceneSetting.reads` (sceneSettings.ts) — either just a
 *  signal id (this setting always responds to it), or a signal id plus
 *  `activeWhen`, for a setting that only responds while some other setting
 *  sits on a particular side of its own range. Shards' Cut on
 *  (src/render/scenes/shards/index.ts) is the motivating case: an enum
 *  setting whose choice decides which of two signals actually drives the
 *  cut, so its own `reads` lists both with complementary predicates —
 *  dragging the picker shows which one it just switched onto. Caustics'
 *  old Ripple source dial used to be this file's other example, before its
 *  trigger became a drive choice instead (SceneSetting.drive, drives.ts) —
 *  a discrete pick doesn't need `activeWhen` at all, since only one source
 *  is ever "active" by construction. `get` reads a sibling setting's
 *  resolved value (auto-aware, the same number the shader sees) by key
 *  rather than by spec object, since the device menu already keys its
 *  settings that way for the pin/typed-entry path (src/tuning/pins.ts). */
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
      "The broadband onset flag straight off the audio pipeline (FeatureFrame.onset) — read here as AnimFrame.beatPulse, its decaying continuous form (animClock.ts). The Hits card's Beat lane marks every one it fired.",
    kind: "edge",
    read: (_frame, anim) => anim.beatPulse,
    edge: (anim) => anim.onset,
    monitor: { card: "hits", row: "hits" },
    bandRange: "all",
  }),
  "feature.flux": signal({
    id: "feature.flux",
    label: "Onset surge",
    description:
      "How close the broadband onset detector is to firing right now (AnimFrame.beatRatio, features.ts's own unclamped fluxRatio), rescaled so 0.6 (a clear near-miss) reads 0 and 2.0 reads 1 — the same flux 'Beat' fires on, read continuously instead of as a one-shot, so a scene can lean into an approaching hit rather than only ever react after it lands.",
    kind: "level",
    read: (_frame, anim) => clamp01((anim.beatRatio - SURGE_RATIO_FLOOR) / (SURGE_RATIO_CEIL - SURGE_RATIO_FLOOR)),
    monitor: { card: "hits", row: "hits" },
    bandRange: "all",
  }),
  "anim.lowOnset": signal({
    id: "anim.lowOnset",
    label: "Bass hit",
    description:
      "The low-band (kick) onset edge (AnimFrame.lowOnset), read here as bandEnergy's lowPulse — its decaying envelope, so the pill stays accurate even on a render-capped tick the edge itself never reaches a scene through.",
    kind: "edge",
    read: (_frame, anim) => anim.lowPulse,
    edge: (anim) => anim.lowOnset,
    monitor: { card: "hits", row: "hits" },
    bandRange: "low",
  }),
  "anim.midOnset": signal({
    id: "anim.midOnset",
    label: "Mid hit",
    description:
      "The mid-band onset edge (AnimFrame.midOnset), read here as bandEnergy's midPulse — same reasoning as Bass hit.",
    kind: "edge",
    read: (_frame, anim) => anim.midPulse,
    edge: (anim) => anim.midOnset,
    monitor: { card: "hits", row: "hits" },
    bandRange: "mid",
  }),
  "anim.highOnset": signal({
    id: "anim.highOnset",
    label: "Treble hit",
    description:
      "The high-band onset edge (AnimFrame.highOnset), read here as bandEnergy's highPulse — same reasoning as Bass hit.",
    kind: "edge",
    read: (_frame, anim) => anim.highPulse,
    edge: (anim) => anim.highOnset,
    monitor: { card: "hits", row: "hits" },
    bandRange: "high",
  }),
  "anim.low": signal({
    id: "anim.low",
    label: "Bass level",
    description: "The slewed low-band level (AnimFrame.low) — sustained, unlike Bass hit's onset-only pulse.",
    kind: "level",
    read: (_frame, anim) => anim.low,
    bandRange: "low",
  }),
  "anim.mid": signal({
    id: "anim.mid",
    label: "Mid level",
    description: "The slewed mid-band level (AnimFrame.mid) — sustained, unlike Mid hit's onset-only pulse.",
    kind: "level",
    read: (_frame, anim) => anim.mid,
    bandRange: "mid",
  }),
  "anim.high": signal({
    id: "anim.high",
    label: "Treble level",
    description: "The slewed high-band level (AnimFrame.high) — sustained, unlike Treble hit's onset-only pulse.",
    kind: "level",
    read: (_frame, anim) => anim.high,
    bandRange: "high",
  }),
  "anim.energy": signal({
    id: "anim.energy",
    label: "All level",
    description:
      "The plain mean of every band (FeatureFrame.energy) — see this file's header for why this is the one entry whose read() actually uses its `frame` argument.",
    kind: "level",
    read: (frame) => frame.energy,
    bandRange: "all",
  }),
  "feature.level": signal({
    id: "feature.level",
    label: "Level",
    description:
      "The input's absolute loudness on a fixed quiet-to-loud scale (FeatureFrame.level), the Dynamics card's Level row — never auto-gained, so a silent room reads 0 where All level's auto-gain lifts mic hiss back to mid-range.",
    kind: "level",
    read: (frame) => frame.level,
    bandRange: "all",
  }),
  "anim.sectionIntensity": signal({
    id: "anim.sectionIntensity",
    label: "Section",
    description:
      "The phrase-level loudness trend (AnimFrame.sectionIntensity, sectionIntensity.ts) — a slow climb into a chorus/drop, not a per-hit pulse.",
    kind: "level",
    read: (_frame, anim) => anim.sectionIntensity,
  }),
  "anim.dropOnset": signal({
    id: "anim.dropOnset",
    label: "Drop",
    description:
      "A section-level loudness drop (AnimFrame.dropOnset), read here as sectionIntensity's dropPulse — its decaying flash, the same reasoning as Bass hit.",
    kind: "edge",
    read: (_frame, anim) => anim.dropPulse,
    edge: (anim) => anim.dropOnset,
    monitor: { card: "character", row: "section" },
  }),
  "anim.centroid": signal({
    id: "anim.centroid",
    label: "Centroid",
    description:
      "The live spectral centroid (AnimFrame.centroid, spectralCentroid.ts) — a fast, range-adapted counterpart to the slow Brightness dial, traced directly under its bar on the Character card.",
    kind: "level",
    read: (_frame, anim) => anim.centroid,
    monitor: { card: "character", row: "centroid" },
  }),
  "anim.wavePeak": signal({
    id: "anim.wavePeak",
    label: "Waveform",
    description:
      "The Dynamics card's own Waveform reading (AnimFrame.wavePeak) — the raw mic wave's peak, held and falling like the readout, the same number the card shows as a percentage; raw amplitude before auto-gain, so unlike All level it gets bigger when the room actually gets louder. 0 on a device with no local mic (the TV).",
    kind: "level",
    read: (_frame, anim) => anim.wavePeak,
    monitor: { card: "signal", row: "waveform" },
    bandRange: "all",
  }),
  "anim.beatWave": signal({
    id: "anim.beatWave",
    label: "Beat wave",
    description:
      "A smooth swing at the metronome's own tempo, once per beat (AnimFrame.metronomeLevel times a cosine over AnimFrame.metronomePhase) — 1 on every metronome beat, 0 halfway between, fading out on its own once the metronome stops (metronome.ts) rather than needing a separate gate.",
    kind: "level",
    read: (_frame, anim) => anim.metronomeLevel * (0.5 + 0.5 * Math.cos(2 * Math.PI * anim.metronomePhase)),
    monitor: { card: "tempo", row: "wave" },
  }),
  "anim.barWave": signal({
    id: "anim.barWave",
    label: "Bar wave",
    description: "The same swing as Beat wave, once per bar instead of once per beat (AnimFrame.metronomeBarPhase).",
    kind: "level",
    read: (_frame, anim) => anim.metronomeLevel * (0.5 + 0.5 * Math.cos(2 * Math.PI * anim.metronomeBarPhase)),
    monitor: { card: "tempo", row: "wave" },
  }),
  "anim.tempo": signal({
    id: "anim.tempo",
    label: "Tempo",
    description:
      "Where the Tempo card's own BPM (AnimFrame.metronomeBpm — the metronome ticks at exactly this) sits in the range this tracker actually searches (features.ts's BPM_MIN..BPM_MAX), log-scaled since tempo is felt in ratios, not raw BPM — 0 while the card reads '--'.",
    kind: "level",
    read: (_frame, anim) =>
      anim.metronomeBpm > 0 ? clamp01(Math.log2(anim.metronomeBpm / BPM_MIN) / Math.log2(BPM_MAX / BPM_MIN)) : 0,
    monitor: { card: "tempo", row: "tempo" },
  }),
  "anim.tempoLock": signal({
    id: "anim.tempoLock",
    label: "Tempo lock",
    description:
      "How confidently the beat clock has locked onto the tempo (AnimFrame.tempoLock, beatClock.ts) — the same number the Tempo card's tempo dot brightens with.",
    kind: "level",
    read: (_frame, anim) => anim.tempoLock,
    monitor: { card: "tempo", row: "lock" },
  }),
  "anim.metronome": signal({
    id: "anim.metronome",
    label: "Metronome",
    description:
      "A tick on every beat at the Tempo card's own BPM (AnimFrame.metronomeBeat, metronome.ts) — read here as its decaying metronomePulse. The same flat pulse every beat; silent while the card reads '--'.",
    kind: "edge",
    read: (_frame, anim) => anim.metronomePulse,
    edge: (anim) => anim.metronomeBeat,
    monitor: { card: "tempo", row: "tempo" },
  }),
  "anim.metronomeBar": signal({
    id: "anim.metronomeBar",
    label: "Metronome bar",
    description: "The same steady tick as Metronome, once per bar instead of once per beat.",
    kind: "edge",
    read: (_frame, anim) => anim.metronomeBarPulse,
    edge: (anim) => anim.metronomeBar,
    monitor: { card: "tempo", row: "timing" },
  }),
  ...dialSignals(),
};

function dialSignals(): Record<DialSignalId, SignalSpec> {
  const out = {} as Record<DialSignalId, SignalSpec>;
  for (const dial of MUSIC_DIALS) {
    const id = dialSignalId(dial);
    out[id] = signal({
      id,
      label: DIAL_LABELS[dial].label,
      description: `The ${DIAL_LABELS[dial].label} dial (AnimFrame.profile.${dial}, musicProfile.ts) — the eased track description Auto resolves against and its Character-card cell shows (under RAW the cell shows the pre-ease target; the wire still reads the eased one), so it moves over seconds rather than per hit.`,
      kind: "level",
      read: (_frame, anim) => anim.profile[dial],
      monitor: { card: "character", row: id },
    });
  }
  return out;
}
