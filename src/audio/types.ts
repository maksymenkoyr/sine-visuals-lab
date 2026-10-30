export const NUM_BANDS = 24;

// Here rather than in engine/onsets.ts so the pages that only read readings
// (src/net/protocol.ts, a TV) don't pull the detector into their chunk.
export type HitKind = "kick" | "snare" | "hat";
export const HIT_KINDS: readonly HitKind[] = ["kick", "snare", "hat"];
/** A hit's strength is how far its peak cleared the threshold: 1 at the threshold, at most this. */
export const HIT_STRENGTH_MAX = 4;
// The tempo range engine/tempo.ts searches. Here for the same reason: the
// Tempo signal (render/signals.ts) and tap tempo (render/tapTempo.ts) read it
// on pages that never run the tracker.
export const MIN_BPM = 55;
export const MAX_BPM = 215;

/**
 * What the audio engine (src/audio/engine/engine.ts) heard over the audio
 * since the frame before. Made by the device that hears the sound and carried
 * with its frames to the pop-out and over the wire, so every device's anim
 * clock (src/render/animClock.ts) builds the same levels, hits and beat from
 * it.
 */
export interface EngineReading {
  /** Auto-ranged band levels [0,1] (engine/bands.ts). */
  low: number;
  mid: number;
  high: number;
  /** The strongest hit of each kind since the frame before: from 1 (at the
   *  threshold) up to HIT_STRENGTH_MAX; 0 = none. Before any silence gate. */
  kick: number;
  snare: number;
  hat: number;
  /** On a follower (the pop-out, a TV), the `level` of the frame these hits
   *  arrived with, which the silence gate judges them on: a follower draws a
   *  hit a tick or more after that frame, when a short sound's level has
   *  already fallen. Not on the wire; absent where the hits are the frame's own. */
  hitLevel?: number;
  /** The largest rise over the hit threshold since the frame before (1 = at
   *  it), and the kind that rise was nearest. */
  surge: number;
  surgeKind: HitKind;
  /** A rise peaked over the threshold inside the hit refractory since the
   *  frame before: a hit blocked rather than missed. */
  blocked: boolean;
  /** A steady pulse is playing (engine/tempo.ts). */
  music: boolean;
  /** How periodic the recent onsets are, [0,1]. */
  confidence: number;
  /** The tracker's latest beat and bar start on its fitted grid, on this
   *  frame's own clock (FeatureFrame.time). */
  beatTime: number;
  downbeatTime: number;
  /** How clearly one beat of the bar carries more bass than the others, [0,1]. */
  downbeatConfidence: number;
  /** Changes whenever the tracker refreshes its estimate. */
  updates: number;
}

/**
 * What the song layer (audio v6, #798) heard over the audio since the frame
 * before: edges that are true on the read the layer fired, and levels in
 * [0,1]. Made by the device that hears the sound and carried with its frames
 * like EngineReading; animClock eases it into AnimFrame.song.
 */
export interface SongFrame {
  /** Kick hits. */
  kick: boolean;
  /** Clap hits. */
  clap: boolean;
  /** Closed hats. */
  hat: boolean;
  /** Chord changes. */
  chord: boolean;
  /** Clap hits' loudness. */
  clapLevel: number;
  /** Closed hats, as a level: it rises on each. */
  hatLevel: number;
  /** Chord changes, as a level: it rises on each. */
  chordLevel: number;
  /** The keys' loudness. */
  keys: number;
  /** The song's overall loudness. */
  loudness: number;
  /** Rises at a drop's start. */
  dropLevel: number;
  /** Music is playing. */
  playing: number;
}

/** The song layer's edges, and its levels in the order they travel (src/net/protocol.ts). */
export const SONG_EDGES = ["kick", "clap", "hat", "chord"] as const;
export const SONG_LEVELS = ["clapLevel", "hatLevel", "chordLevel", "keys", "loudness", "dropLevel", "playing"] as const;

/**
 * The single interface every renderer consumes, regardless of whether the
 * data came from a local mic, tab-audio capture, or a remote room feed.
 */
export interface FeatureFrame {
  /** Room/monotonic time this frame represents, in seconds. */
  time: number;
  /** Normalized [0,1] energy per log-spaced band, low -> high. */
  bands: Float32Array; // length NUM_BANDS
  /** Overall normalized loudness [0,1]. */
  energy: number;
  /** Absolute input loudness [0,1], mapped from raw mic dB against a fixed
   *  window — NOT run through the adaptive floor/peak AGC that normalizes
   *  `bands`/`energy`. That AGC re-adapts in ~1.25s and erases quiet-vs-loud
   *  by design; this is the one field that survives it, so auto mode (see
   *  render/musicProfile.ts) has something to actually react to when the
   *  room gets quieter or louder. */
  level: number;
  /** Hats [0,1]: the drum part of the Treble range, from src/audio/stemSplit.ts
   *  on the device that hears the sound, sent to followers in the frame. 0
   *  wherever there is no split to read (no analyser, a sender that predates
   *  it). Unslewed and ungated here; AnimFrame.hats is the eased, gated form. */
  hats: number;
  /** Lead [0,1]: the held part of the Mid range (vocals, synths, guitar), the
   *  same way as `hats`. */
  lead: number;
  /** True on the frame the engine heard a hit of any kind, after this
   *  sender's silence gate (src/audio/silenceGate.ts). A follower builds its
   *  own hits from `engine` with its own gate; this flag is what a follower
   *  that predates `engine` reacts to, and what the Hits drum roll's Any
   *  track reads on the device that hears the sound. */
  onset: boolean;
  /** The same hit before the silence gate. Kept for followers that predate
   *  `engine`: their beat clock votes on it. */
  pulseOnset: boolean;
  /** True when the sender's source isn't a mic, so no device gates this
   *  frame's hits (src/audio/silenceGate.ts). Absent reads as a mic. */
  gateOff?: boolean;
  /** The engine's tempo in BPM, 0 while it hears no steady pulse. */
  bpm: number;
  /** The engine's beat phase [0,1) on this sender's clock. No consumer reads
   *  this today; kept for wire compatibility (see protocol.ts). */
  onsetPhase: number;
  /** The engine's reading behind this frame; null where none was measured:
   *  no capture, or a sender that predates the engine (src/net/protocol.ts).
   *  animClock treats null as nothing heard. */
  engine: EngineReading | null;
  /** The song layer's reading behind this frame (src/net/protocol.ts's song
   *  tail); null where none was measured: no song layer yet, no engine, or a
   *  sender that predates it. animClock treats null as nothing heard. */
  song: SongFrame | null;
}

export type CaptureSourceKind = "mic" | "display";

export interface CaptureHandle {
  kind: CaptureSourceKind;
  context: AudioContext;
  sourceNode: AudioNode;
  stream: MediaStream;
  stop(): void;
}
