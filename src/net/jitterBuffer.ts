import { HIT_KINDS, type HitKind, NUM_BANDS } from "../audio/types.ts";
import type { WaveEnvelope, WireEngine } from "./protocol.ts";

export interface TimedFrame {
  bands: Float32Array;
  energy: number;
  onset: boolean;
  pulseOnset: boolean;
  bpm: number;
  level: number;
  hats: number;
  lead: number;
  roomTimeMs: number;
  /** The sender's waveform since its previous frame (protocol.ts's wave
   *  tail); null, or absent, when it sent none. */
  wave?: WaveEnvelope | null;
  /** The sender's engine reading (protocol.ts's engine tail), its beat ages
   *  against this frame's roomTimeMs; null, or absent, when it sent none. */
  engine?: WireEngine | null;
}

export interface Sample {
  bands: Float32Array;
  energy: number;
  bpm: number;
  level: number;
  /** FeatureFrame.hats/lead, interpolated like level; 0 when the feed sends none. */
  hats: number;
  lead: number;
  /** Not interpolated: the envelope of the frame that covers this instant,
   *  the first one at or after it, since a frame's envelope spans the time
   *  since the frame before. */
  wave: WaveEnvelope | null;
  /** The engine reading at this instant: levels interpolated like the bands,
   *  each kind's hits one-shot (the strongest that came due since the last
   *  sample), and the tracker's state from the latest frame at or before the
   *  instant, its beat ages measured to the instant itself. null when the
   *  feed sends none. */
  engine: WireEngine | null;
}

const MAX_HISTORY_MS = 2000;
/** Hits of one kind waiting to come due; the room's render delay holds a few at most. */
const PENDING_HITS = 8;

/** Hits of one kind that have arrived but not yet come due, oldest first. */
class HitQueue {
  private readonly times = new Float64Array(PENDING_HITS);
  private readonly strengths = new Float64Array(PENDING_HITS);
  private count = 0;

  add(timeMs: number, strength: number): void {
    if (this.count === PENDING_HITS) {
      this.times.copyWithin(0, 1);
      this.strengths.copyWithin(0, 1);
      this.count--;
    }
    let i = this.count;
    // Network delivery can reorder.
    while (i > 0 && this.times[i - 1] > timeMs) {
      this.times[i] = this.times[i - 1];
      this.strengths[i] = this.strengths[i - 1];
      i--;
    }
    this.times[i] = timeMs;
    this.strengths[i] = strength;
    this.count++;
  }

  /** The strongest hit due by `targetMs`, removing every one that is; 0 if none. */
  take(targetMs: number): number {
    let n = 0;
    let strongest = 0;
    while (n < this.count && this.times[n] <= targetMs) strongest = Math.max(strongest, this.strengths[n++]);
    if (n > 0) {
      this.times.copyWithin(0, n, this.count);
      this.strengths.copyWithin(0, n, this.count);
      this.count -= n;
    }
    return strongest;
  }
}

/**
 * Buffers timestamped frames (from the network, or from the host's own
 * local capture — the two are treated identically) and reconstructs a
 * smooth continuous signal at any requested room-clock instant: bands and
 * energy are linearly interpolated between the bracketing samples, and beat
 * phase is extrapolated from BPM + the last known onset time rather than
 * following the 30Hz packet cadence. This is what lets every device in a
 * room render the same visual instant regardless of when packets arrived.
 */
export class JitterBuffer {
  private frames: TimedFrame[] = [];
  private lastOnsetRoomTimeMs = -Infinity;
  private lastFiredOnsetRoomTimeMs = -Infinity;
  // Same one-shot-due-tracking pair as onset above, but for the ungated
  // pulse onset (see FeatureFrame.pulseOnset), which a follower from before
  // the engine reading tracks tempo on: the gated `onset` would starve it.
  private lastPulseRoomTimeMs = -Infinity;
  private lastFiredPulseRoomTimeMs = -Infinity;
  private bpm = 0;
  private readonly hits: Record<HitKind, HitQueue> = { kick: new HitQueue(), snare: new HitQueue(), hat: new HitQueue() };

  // Reused across sampleAt() calls to avoid a per-render-tick allocation.
  // Safe because sampleAt() is called at most once per tick (from
  // RoomConnectionBase.sample()) and the result is always consumed
  // synchronously — copied into a scene's own uniform buffer — before the
  // next call, never retained past that.
  private readonly scratchBands = new Float32Array(NUM_BANDS);
  private readonly scratchEngine: WireEngine = {
    low: 0,
    mid: 0,
    high: 0,
    kick: 0,
    snare: 0,
    hat: 0,
    surge: 0,
    surgeKind: "kick",
    blocked: false,
    music: false,
    confidence: 0,
    downbeatConfidence: 0,
    updates: 0,
    beatAgoMs: 0,
    downbeatAgoMs: 0,
  };
  private readonly scratchSample: Sample = { bands: this.scratchBands, energy: 0, bpm: 0, level: 0.5, hats: 0, lead: 0, wave: null, engine: null };

  push(frame: TimedFrame): void {
    // Network delivery can reorder; insert in timestamp order rather than
    // assuming push order.
    let i = this.frames.length;
    while (i > 0 && this.frames[i - 1].roomTimeMs > frame.roomTimeMs) i--;
    this.frames.splice(i, 0, frame);

    const cutoff = frame.roomTimeMs - MAX_HISTORY_MS;
    while (this.frames.length > 2 && this.frames[0].roomTimeMs < cutoff) this.frames.shift();

    if (frame.onset) this.lastOnsetRoomTimeMs = frame.roomTimeMs;
    if (frame.pulseOnset) this.lastPulseRoomTimeMs = frame.roomTimeMs;
    if (frame.bpm > 0) this.bpm = frame.bpm;
    const e = frame.engine;
    if (e) for (const kind of HIT_KINDS) if (e[kind] > 0) this.hits[kind].add(frame.roomTimeMs, e[kind]);
  }

  sampleAt(targetMs: number): Sample | null {
    const n = this.frames.length;
    if (n === 0) return null;
    if (targetMs <= this.frames[0].roomTimeMs) return this.pick(this.frames[0], targetMs);
    if (targetMs >= this.frames[n - 1].roomTimeMs) return this.pick(this.frames[n - 1], targetMs);

    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.frames[mid].roomTimeMs <= targetMs) lo = mid;
      else hi = mid;
    }
    const a = this.frames[lo];
    const b = this.frames[hi];
    const span = b.roomTimeMs - a.roomTimeMs;
    const t = span > 0 ? (targetMs - a.roomTimeMs) / span : 0;

    for (let i = 0; i < NUM_BANDS; i++) {
      this.scratchBands[i] = a.bands[i] + (b.bands[i] - a.bands[i]) * t;
    }
    this.scratchSample.bands = this.scratchBands;
    this.scratchSample.energy = a.energy + (b.energy - a.energy) * t;
    this.scratchSample.bpm = t < 0.5 ? a.bpm : b.bpm;
    this.scratchSample.level = a.level + (b.level - a.level) * t;
    this.scratchSample.hats = a.hats + (b.hats - a.hats) * t;
    this.scratchSample.lead = a.lead + (b.lead - a.lead) * t;
    this.scratchSample.wave = b.wave ?? null;
    this.scratchSample.engine = this.engineAt(a, b, t, targetMs);
    return this.scratchSample;
  }

  private pick(f: TimedFrame, targetMs: number): Sample {
    this.scratchSample.bands = f.bands;
    this.scratchSample.energy = f.energy;
    this.scratchSample.bpm = f.bpm;
    this.scratchSample.level = f.level;
    this.scratchSample.hats = f.hats;
    this.scratchSample.lead = f.lead;
    this.scratchSample.wave = f.wave ?? null;
    this.scratchSample.engine = this.engineAt(f, f, 0, targetMs);
    return this.scratchSample;
  }

  /** The engine reading at `targetMs`, `t` of the way from frame `a` (at or before it) to `b`. */
  private engineAt(a: TimedFrame, b: TimedFrame, t: number, targetMs: number): WireEngine | null {
    const ea = a.engine ?? null;
    const eb = b.engine ?? null;
    const state = ea ?? eb;
    if (!state) return null;
    const stateMs = ea ? a.roomTimeMs : b.roomTimeMs;
    const from = ea ?? state;
    const to = eb ?? state;
    const out = this.scratchEngine;
    out.low = from.low + (to.low - from.low) * t;
    out.mid = from.mid + (to.mid - from.mid) * t;
    out.high = from.high + (to.high - from.high) * t;
    out.kick = this.hits.kick.take(targetMs);
    out.snare = this.hits.snare.take(targetMs);
    out.hat = this.hits.hat.take(targetMs);
    out.surge = state.surge;
    out.surgeKind = state.surgeKind;
    out.blocked = state.blocked;
    out.music = state.music;
    out.confidence = state.confidence;
    out.downbeatConfidence = state.downbeatConfidence;
    out.updates = state.updates;
    out.beatAgoMs = targetMs - (stateMs - state.beatAgoMs);
    out.downbeatAgoMs = targetMs - (stateMs - state.downbeatAgoMs);
    return out;
  }

  beatPhaseAt(targetMs: number): number {
    if (this.bpm <= 0 || this.lastOnsetRoomTimeMs === -Infinity) return 0;
    const beatDurMs = 60000 / this.bpm;
    const phase = ((targetMs - this.lastOnsetRoomTimeMs) / beatDurMs) % 1;
    return phase < 0 ? phase + 1 : phase;
  }

  /** One-shot: true the first time `targetMs` has caught up to a not-yet-fired onset. */
  consumeOnsetIfDue(targetMs: number): boolean {
    if (this.lastOnsetRoomTimeMs <= this.lastFiredOnsetRoomTimeMs) return false;
    if (targetMs < this.lastOnsetRoomTimeMs) return false;
    this.lastFiredOnsetRoomTimeMs = this.lastOnsetRoomTimeMs;
    return true;
  }

  /** Same one-shot shape as consumeOnsetIfDue above, off the ungated pulse
   *  onset instead — what a host/renderer/TV's own beat clock must read for
   *  tempo tracking (see this class's lastPulseRoomTimeMs doc). */
  consumePulseIfDue(targetMs: number): boolean {
    if (this.lastPulseRoomTimeMs <= this.lastFiredPulseRoomTimeMs) return false;
    if (targetMs < this.lastPulseRoomTimeMs) return false;
    this.lastFiredPulseRoomTimeMs = this.lastPulseRoomTimeMs;
    return true;
  }
}
