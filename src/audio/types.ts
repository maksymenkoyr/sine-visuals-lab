export const NUM_BANDS = 24;

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
  /** True on the frame a spectral-flux onset was detected — broadband, no
   *  tempo attached (see features.ts). Not the same concept as a musical
   *  beat: that's AnimFrame.beatPhase/tempoLock (render/beatClock.ts), which
   *  this fires into as raw evidence. Gated by src/audio/silenceGate.ts —
   *  this is the flag every scene's visual hit reacts to, and it should stay
   *  quiet in a silent room. For tempo tracking (registerOnset's vote and
   *  the beat clock's phase comb) use `pulseOnset` below instead — see its
   *  own doc for why. */
  onset: boolean;
  /** The same broadband spectral-flux detector's onset edge, before the
   *  silence gate dims the firing comparison (see features.ts and
   *  silenceGate.ts) — its own refractory, never gated. A real beat in a
   *  quiet room is still a beat the tempo tracker needs to see; a noise hit
   *  is aperiodic and the pair-comb/confidence machinery downstream already
   *  rejects it on its own merits, so nothing here needs the gate's help.
   *  registerOnset (the render-tick tempo vote, features.ts) and the beat
   *  clock's phase comb (render/animClock.ts, whenever no fixed-hop
   *  tempoHits feed is live) both read this instead of `onset` — silencing
   *  visuals in a quiet room must never also starve tempo tracking (see the
   *  PR that added this field for the measured failure: host/TV and the
   *  render-tick fallback ran the Metronome only ~21-26% of the time on real
   *  songs through a simulated mic, against solo mode's ~94%, because their
   *  only feed was the gated `onset`). */
  pulseOnset: boolean;
  /** Estimated tempo in BPM — 0 until locked, and again once
   *  TEMPO_DECAY_SEC (tempoComb.ts) has passed with no onset registering.
   *  Two possible sources, both on the same decay rule: features.ts's own
   *  render-tick estimate (this frame's own value, unless overwritten), or
   *  — app.ts's solo/host modes, whenever a fixed-hop AudioWorklet tempo
   *  source (src/audio/tempoSource.ts) is live — that source's own bpm,
   *  written in over features.ts's before this frame leaves currentVisual().
   *  A renderer/TV frame (sampleToVisual) just carries whichever of the two
   *  the sending device already picked, over the wire. */
  bpm: number;
  /** Phase since the last onset, [0,1) — resets on every onset, unlike
   *  AnimFrame.beatPhase, which never restarts mid-beat. No consumer reads
   *  this today; kept for wire compatibility (see protocol.ts). */
  onsetPhase: number;
}

export type CaptureSourceKind = "mic" | "display" | "device";

export interface CaptureHandle {
  kind: CaptureSourceKind;
  context: AudioContext;
  sourceNode: AudioNode;
  stream: MediaStream;
  stop(): void;
}
