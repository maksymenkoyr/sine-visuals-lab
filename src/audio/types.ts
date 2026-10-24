export const NUM_BANDS = 24;

// Here rather than in engine/onsets.ts so the pages that only read readings
// (src/net/protocol.ts, a TV) don't pull the detector into their chunk.
export type HitKind = "kick" | "snare" | "hat";
export const HIT_KINDS: readonly HitKind[] = ["kick", "snare", "hat"];
/** A hit's strength is how far its peak cleared the threshold: 1 at the threshold, at most this. */
export const HIT_STRENGTH_MAX = 4;

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
   *  that predates `engine` reacts to, and what the Hits card's Beat lane
   *  reads on the device that hears the sound. */
  onset: boolean;
  /** The same hit before the silence gate. Kept for followers that predate
   *  `engine`: their beat clock votes on it. */
  pulseOnset: boolean;
  /** The engine's tempo in BPM, 0 while it hears no steady pulse. */
  bpm: number;
  /** The engine's beat phase [0,1) on this sender's clock. No consumer reads
   *  this today; kept for wire compatibility (see protocol.ts). */
  onsetPhase: number;
  /** The engine's reading behind this frame; null where none was measured:
   *  no capture, or a sender that predates the engine (src/net/protocol.ts).
   *  animClock treats null as nothing heard. */
  engine: EngineReading | null;
}

export type CaptureSourceKind = "mic" | "display";

export interface CaptureHandle {
  kind: CaptureSourceKind;
  context: AudioContext;
  sourceNode: AudioNode;
  stream: MediaStream;
  stop(): void;
}
