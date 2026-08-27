import { NUM_BANDS } from "../audio/types.ts";

export interface TimedFrame {
  bands: Float32Array;
  energy: number;
  beat: boolean;
  bpm: number;
  level: number;
  roomTimeMs: number;
}

export interface Sample {
  bands: Float32Array;
  energy: number;
  bpm: number;
  level: number;
}

const MAX_HISTORY_MS = 2000;

/**
 * Buffers timestamped frames (from the network, or from the host's own
 * local capture — the two are treated identically) and reconstructs a
 * smooth continuous signal at any requested room-clock instant: bands and
 * energy are linearly interpolated between the bracketing samples, and beat
 * phase is extrapolated from BPM + the last known beat time rather than
 * following the 30Hz packet cadence. This is what lets every device in a
 * room render the same visual instant regardless of when packets arrived.
 */
export class JitterBuffer {
  private frames: TimedFrame[] = [];
  private lastBeatRoomTimeMs = -Infinity;
  private lastFiredBeatRoomTimeMs = -Infinity;
  private bpm = 0;

  // Reused across sampleAt() calls to avoid a per-render-tick allocation.
  // Safe because sampleAt() is called at most once per tick (from
  // RoomConnectionBase.sample()) and the result is always consumed
  // synchronously — copied into a scene's own uniform buffer — before the
  // next call, never retained past that.
  private readonly scratchBands = new Float32Array(NUM_BANDS);
  private readonly scratchSample: Sample = { bands: this.scratchBands, energy: 0, bpm: 0, level: 0.5 };

  push(frame: TimedFrame): void {
    // Network delivery can reorder; insert in timestamp order rather than
    // assuming push order.
    let i = this.frames.length;
    while (i > 0 && this.frames[i - 1].roomTimeMs > frame.roomTimeMs) i--;
    this.frames.splice(i, 0, frame);

    const cutoff = frame.roomTimeMs - MAX_HISTORY_MS;
    while (this.frames.length > 2 && this.frames[0].roomTimeMs < cutoff) this.frames.shift();

    if (frame.beat) this.lastBeatRoomTimeMs = frame.roomTimeMs;
    if (frame.bpm > 0) this.bpm = frame.bpm;
  }

  get size(): number {
    return this.frames.length;
  }

  sampleAt(targetMs: number): Sample | null {
    const n = this.frames.length;
    if (n === 0) return null;
    if (targetMs <= this.frames[0].roomTimeMs) return this.pick(this.frames[0]);
    if (targetMs >= this.frames[n - 1].roomTimeMs) return this.pick(this.frames[n - 1]);

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
    return this.scratchSample;
  }

  private pick(f: TimedFrame): Sample {
    this.scratchSample.bands = f.bands;
    this.scratchSample.energy = f.energy;
    this.scratchSample.bpm = f.bpm;
    this.scratchSample.level = f.level;
    return this.scratchSample;
  }

  beatPhaseAt(targetMs: number): number {
    if (this.bpm <= 0 || this.lastBeatRoomTimeMs === -Infinity) return 0;
    const beatDurMs = 60000 / this.bpm;
    const phase = ((targetMs - this.lastBeatRoomTimeMs) / beatDurMs) % 1;
    return phase < 0 ? phase + 1 : phase;
  }

  /** One-shot: true the first time `targetMs` has caught up to a not-yet-fired beat. */
  consumeBeatIfDue(targetMs: number): boolean {
    if (this.lastBeatRoomTimeMs <= this.lastFiredBeatRoomTimeMs) return false;
    if (targetMs < this.lastBeatRoomTimeMs) return false;
    this.lastFiredBeatRoomTimeMs = this.lastBeatRoomTimeMs;
    return true;
  }

  get currentBpm(): number {
    return this.bpm;
  }
}
