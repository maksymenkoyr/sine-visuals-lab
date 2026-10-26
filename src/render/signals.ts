import type { FeatureFrame } from "../audio/types.ts";
import type { AnimFrame } from "./animClock.ts";
import { MIN_BPM as BPM_MIN, MAX_BPM as BPM_MAX, NUM_BANDS } from "../audio/types.ts";
import { bandCenterHz, formatHz, nominalBandEdgesHz } from "../audio/bandScale.ts";
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
 * "Level" (`anim.energy`) and "Input level" (`feature.level`) are the two
 * entries whose `read()` actually uses its `frame` argument (`frame.energy`
 * and `frame.level`, not anything off `anim`) — every other entry but the
 * band entries below ignores `frame` entirely. drives.ts feeds them the sensitivity-applied frame
 * (matching what a scene's own `uEnergy` sees — see that file's header), so
 * a setting driven by "Level" and a scene's plain `uEnergy` uniform read
 * the identical number. Called elsewhere (a setting row's live pill) with
 * the plain band-gained frame instead, so that pill can read very slightly
 * ahead of Sensitivity/Expansion — an accepted cosmetic gap, not a claim
 * this file makes about the render path. `level` comes through both frames
 * raw (src/audio/sensitivity.ts's applySensitivity never shapes it), which
 * is why Input level, unlike Level, reads 0 in a silent room.
 *
 * The `dial.*` entries (DIAL_SIGNALS) are generated from MUSIC_DIALS, one
 * per dial, so a new dial gets a jack by construction. Each reads the eased
 * dial straight off AnimFrame.profile — the slow track description Auto
 * resolves against (musicProfile.ts) — so a wire on one moves over seconds,
 * not per hit, and does what its dial does through silence: rests at
 * NEUTRAL, except `dial.loudness`, which keeps its last reading.
 *
 * The `band.<n>` entries (BAND_SIGNALS) are one per analyser band, all of
 * them static rather than added when one is picked: heat tracks, jacks and
 * saved-wire validation are all built once from SIGNALS. Each reads that
 * band's auto-gained level (FeatureFrame.bands, what the spectrum strip
 * draws) dimmed by the silence gate the way Kick band is. The id is the
 * band number, not its Hz: the ladder's ceiling is capped below Nyquist at
 * the usual sample rates (bandScale.ts's MAX_HZ_CAP), so band n is the same
 * Hz everywhere and the Hz is only its label. The Sound card shows a band's
 * row once it's picked on the spectrum or wired (audioMeters.ts).
 */

/** Every card src/ui/audioMeters.ts mounts, keyed by its own `foldId`.
 *  Populated on demand: add an id here only once some SignalSpec below
 *  actually points at that card. "sound" is the first meter, the Sound card;
 *  "stems" follows it with Lead, Hats and the Kick band. */
export type MeterCardId = "sound" | "stems" | "hits" | "beat" | "song";

/** A row within a card, for the same anchor — only rows a SignalSpec
 *  currently points at need an id (see MeterCardId above). "tempo" is the
 *  BPM-digits/beat-dot block (audioMeters.ts's own createTempoBlock), the
 *  anchor for `anim.tempo`, whose jack mounts there. "bar" is the Beat card's
 *  bar ruler (audioMeters.ts's createBarRuler), the anchor for `anim.metronome`
 *  and `anim.metronomeBar`. "wave"/"lock" are the plain meter rows
 *  `anim.beatWave`/`anim.barWave`/`anim.tempoLock` point at instead.
 *  "energy", "low", "mid" and "high" are the Sound card's Level, Bass, Mid and
 *  Treble rows. "lead", "hats" and "kick" (the Kick band) are the Stems
 *  card's own rows. Each dial's own cell in the Song
 *  card's strip is its DialSignalId. */
export type MeterRowId =
  | "section"
  | "tempo"
  | "hits"
  | "wave"
  | "lock"
  | "bar"
  | "energy"
  | "low"
  | "mid"
  | "high"
  | "kick"
  | "lead"
  | "hats"
  | DialSignalId
  | BandSignalId;

/** One dial as a signal — see this file's header. */
export type DialSignalId = `dial.${MusicDial}`;

export function dialSignalId(dial: MusicDial): DialSignalId {
  return `dial.${dial}`;
}

/** Every dial signal, in MUSIC_DIALS order. */
export const DIAL_SIGNALS: readonly DialSignalId[] = MUSIC_DIALS.map(dialSignalId);

/** One analyser band as a signal — see this file's header. */
export type BandSignalId = `band.${number}`;

export function bandSignalId(band: number): BandSignalId {
  return `band.${band}`;
}

/** Every band signal, in band order. */
export const BAND_SIGNALS: readonly BandSignalId[] = Array.from({ length: NUM_BANDS }, (_, n) => bandSignalId(n));

export type SignalId =
  | DialSignalId
  | BandSignalId
  | "feature.onset"
  | "feature.flux"
  | "feature.level"
  | "anim.lowOnset"
  | "anim.kickBand"
  | "anim.midOnset"
  | "anim.highOnset"
  | "anim.dropOnset"
  | "anim.low"
  | "anim.mid"
  | "anim.high"
  | "anim.hats"
  | "anim.lead"
  | "anim.energy"
  | "anim.sectionIntensity"
  | "anim.centroid"
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
   *  deviceMenu.ts) — resolved against bandSplit.ts's BAND_SPLIT by the
   *  caller. "all" for a broadband read (features.ts's flux
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
 *  reads 1. Exported so the Surge lane can mark where Any hit
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
 *  settings that way for the typed-entry path (src/render/customValues.ts). */
export type SignalLink =
  | SignalId
  | {
      signal: SignalId;
      activeWhen: (get: (key: string) => number) => boolean;
    };

export const SIGNALS: Record<SignalId, SignalSpec> = {
  "feature.onset": signal({
    id: "feature.onset",
    label: "Any hit",
    description:
      "The broadband onset flag straight off the audio pipeline (FeatureFrame.onset) — read here as AnimFrame.beatPulse, its decaying continuous form (animClock.ts). The Any lane of the hits history marks every one it fired.",
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
  "anim.kickBand": signal({
    id: "anim.kickBand",
    label: "Kick band",
    description:
      "The level of the single low band (below the Bands split) that has gone up and down the most over the last few seconds (AnimFrame.kickBand, bandPick.ts) — one narrow band, re-picked by itself when the music changes, unlike Bass level's average over the whole low group.",
    kind: "level",
    read: (_frame, anim) => anim.kickBand,
    monitor: { card: "stems", row: "kick" },
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
    monitor: { card: "sound", row: "low" },
    bandRange: "low",
  }),
  "anim.mid": signal({
    id: "anim.mid",
    label: "Mid level",
    description: "The slewed mid-band level (AnimFrame.mid) — sustained, unlike Mid hit's onset-only pulse.",
    kind: "level",
    read: (_frame, anim) => anim.mid,
    monitor: { card: "sound", row: "mid" },
    bandRange: "mid",
  }),
  "anim.high": signal({
    id: "anim.high",
    label: "Treble level",
    description: "The slewed high-band level (AnimFrame.high) — sustained, unlike Treble hit's onset-only pulse.",
    kind: "level",
    read: (_frame, anim) => anim.high,
    monitor: { card: "sound", row: "high" },
    bandRange: "high",
  }),
  "anim.hats": signal({
    id: "anim.hats",
    label: "Hats",
    description:
      "The drum part of the treble range (AnimFrame.hats, src/audio/stemSplit.ts) — hi-hats and cymbals with held bright sounds taken out, against all the treble's recent peak, unlike Treble level, which re-levels within seconds.",
    kind: "level",
    read: (_frame, anim) => anim.hats,
    monitor: { card: "stems", row: "hats" },
    bandRange: "high",
  }),
  "anim.lead": signal({
    id: "anim.lead",
    label: "Lead",
    description:
      "The held part of the mid range (AnimFrame.lead, src/audio/stemSplit.ts) — vocals, synths and guitar with the drums taken out, so it doesn't jump on a snare the way Mid level does.",
    kind: "level",
    read: (_frame, anim) => anim.lead,
    monitor: { card: "stems", row: "lead" },
    bandRange: "mid",
  }),
  "anim.energy": signal({
    id: "anim.energy",
    label: "Level",
    description:
      "The plain mean of every band (FeatureFrame.energy) — see this file's header for why this is the one entry whose read() actually uses its `frame` argument.",
    kind: "level",
    read: (frame) => frame.energy,
    monitor: { card: "sound", row: "energy" },
    bandRange: "all",
  }),
  "feature.level": signal({
    id: "feature.level",
    label: "Input level",
    description:
      "The input's absolute loudness on a fixed quiet-to-loud scale (FeatureFrame.level), never auto-gained, so a silent room reads 0 where Level's auto-gain lifts mic hiss back to mid-range.",
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
    monitor: { card: "song", row: "section" },
  }),
  "anim.dropOnset": signal({
    id: "anim.dropOnset",
    label: "Drop",
    description:
      "A section-level loudness drop (AnimFrame.dropOnset), read here as sectionIntensity's dropPulse — its decaying flash, the same reasoning as Bass hit.",
    kind: "edge",
    read: (_frame, anim) => anim.dropPulse,
    edge: (anim) => anim.dropOnset,
    monitor: { card: "song", row: "section" },
  }),
  "anim.centroid": signal({
    id: "anim.centroid",
    label: "Centroid",
    description:
      "The live spectral centroid (AnimFrame.centroid, spectralCentroid.ts) — a fast, range-adapted counterpart to the slow Tone dial.",
    kind: "level",
    read: (_frame, anim) => anim.centroid,
  }),
  "anim.beatWave": signal({
    id: "anim.beatWave",
    label: "Beat wave",
    description:
      "A smooth swing at the metronome's own tempo, once per beat (AnimFrame.metronomeLevel times a cosine over AnimFrame.metronomePhase) — 1 on every metronome beat, 0 halfway between, fading out on its own once the metronome stops (metronome.ts) rather than needing a separate gate.",
    kind: "level",
    read: (_frame, anim) => anim.metronomeLevel * (0.5 + 0.5 * Math.cos(2 * Math.PI * anim.metronomePhase)),
    monitor: { card: "beat", row: "wave" },
  }),
  "anim.barWave": signal({
    id: "anim.barWave",
    label: "Bar wave",
    description: "The same swing as Beat wave, once per bar instead of once per beat (AnimFrame.metronomeBarPhase).",
    kind: "level",
    read: (_frame, anim) => anim.metronomeLevel * (0.5 + 0.5 * Math.cos(2 * Math.PI * anim.metronomeBarPhase)),
    monitor: { card: "beat", row: "wave" },
  }),
  "anim.tempo": signal({
    id: "anim.tempo",
    label: "Tempo",
    description:
      "Where the BPM (AnimFrame.metronomeBpm — the metronome ticks at exactly this) sits in the range this tracker actually searches (MIN_BPM..MAX_BPM in audio/types.ts, engine/tempo.ts's range), log-scaled since tempo is felt in ratios, not raw BPM — 0 while the BPM reads '--'.",
    kind: "level",
    read: (_frame, anim) =>
      anim.metronomeBpm > 0 ? clamp01(Math.log2(anim.metronomeBpm / BPM_MIN) / Math.log2(BPM_MAX / BPM_MIN)) : 0,
    monitor: { card: "beat", row: "tempo" },
  }),
  "anim.tempoLock": signal({
    id: "anim.tempoLock",
    label: "Tempo lock",
    description:
      "How confidently the beat clock has locked onto the tempo — the same number the tempo dot brightens with.",
    kind: "level",
    read: (_frame, anim) => anim.tempoLock,
    monitor: { card: "beat", row: "lock" },
  }),
  "anim.metronome": signal({
    id: "anim.metronome",
    label: "Metronome",
    description:
      "A tick on every beat at the BPM (AnimFrame.metronomeBeat, metronome.ts) — read here as its decaying metronomePulse. The same flat pulse every beat; silent while the BPM reads '--'.",
    kind: "edge",
    read: (_frame, anim) => anim.metronomePulse,
    edge: (anim) => anim.metronomeBeat,
    monitor: { card: "beat", row: "bar" },
  }),
  "anim.metronomeBar": signal({
    id: "anim.metronomeBar",
    label: "Metronome bar",
    description: "The same steady tick as Metronome, once per bar instead of once per beat.",
    kind: "edge",
    read: (_frame, anim) => anim.metronomeBarPulse,
    edge: (anim) => anim.metronomeBar,
    monitor: { card: "beat", row: "bar" },
  }),
  ...dialSignals(),
  ...bandSignals(),
};

function dialSignals(): Record<DialSignalId, SignalSpec> {
  const out = {} as Record<DialSignalId, SignalSpec>;
  for (const dial of MUSIC_DIALS) {
    const id = dialSignalId(dial);
    out[id] = signal({
      id,
      label: DIAL_LABELS[dial].label,
      description: `The ${DIAL_LABELS[dial].label} dial (AnimFrame.profile.${dial}, musicProfile.ts) — the eased track description Auto resolves against and its dial cell shows (under RAW the cell shows the pre-ease target; the wire still reads the eased one), so it moves over seconds rather than per hit.`,
      kind: "level",
      read: (_frame, anim) => anim.profile[dial],
      monitor: { card: "song", row: id },
    });
  }
  return out;
}

function bandSignals(): Record<BandSignalId, SignalSpec> {
  const out = {} as Record<BandSignalId, SignalSpec>;
  const edges = nominalBandEdgesHz();
  BAND_SIGNALS.forEach((id, n) => {
    out[id] = signal({
      id,
      label: `Band ${formatHz(bandCenterHz(edges, n))}`,
      description:
        "One analyser band on its own (FeatureFrame.bands, the same auto-gained bands the spectrum strip draws), dimmed by the silence gate like Kick band — its row shows once picked on the Sound card's spectrum.",
      kind: "level",
      read: (frame, anim) => (frame.bands[n] ?? 0) * anim.gateDimmer,
      monitor: { card: "sound", row: id },
    });
  });
  return out;
}
