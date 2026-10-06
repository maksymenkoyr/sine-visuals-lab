import type { WaveEnvelope } from "./protocol.ts";

/**
 * Thins the host's per-render-tick frames to the wire rate (room.ts's
 * BROADCAST_INTERVAL_MS) without losing the one-tick edges.
 *
 * `onset` and `pulseOnset` are true on exactly one render tick, so a plain
 * "send every Nth tick" drops most of them: at 60 Hz down to 30 Hz, a hit
 * landing on a skipped tick never reached the TV. The decimator latches both
 * flags across the skipped ticks and hands them over on the next send, then
 * clears them, so each hit crosses the wire once.
 *
 * It also absorbs the clock's integer milliseconds. Two 60 Hz ticks are 33 ms
 * apart, which is less than a 1000/30 interval, so a strict `>= interval`
 * test slipped to every third tick (20 Hz). A send is due once the interval
 * minus `toleranceMs` has passed, and the next is scheduled from the previous
 * *slot* rather than from now, so the rate holds at the target instead of
 * drifting down to whatever the tick spacing happens to round to. After a
 * long gap (more than two intervals) the schedule restarts from now, so a
 * stall is one send, never a burst of catch-up sends.
 *
 * The waveform envelope (protocol.ts's wave tail) is folded the same way: the
 * min and max of every tick's samples since the last send, so a peak on a
 * skipped tick still reaches a follower's Waveform row.
 */
export class WireDecimator {
  private lastSentMs = -Infinity;
  private pendingOnset = false;
  private pendingPulse = false;
  private pendingWave: WaveEnvelope | null = null;

  constructor(
    private readonly intervalMs: number,
    private readonly toleranceMs = 4,
  ) {}

  /** Call once per render tick. When `send` is true, put `onset`,
   *  `pulseOnset` and `wave` (latched since the last send, not the tick's
   *  own) on the wire. `wave` is this tick's envelope, null with no samples;
   *  the sent one is null only if no tick since the last send had one. */
  offer(
    nowMs: number,
    onset: boolean,
    pulseOnset: boolean,
    wave: WaveEnvelope | null = null,
  ): { send: boolean; onset: boolean; pulseOnset: boolean; wave: WaveEnvelope | null } {
    this.pendingOnset = this.pendingOnset || onset;
    this.pendingPulse = this.pendingPulse || pulseOnset;
    if (wave) {
      const p = this.pendingWave;
      this.pendingWave = p ? { min: Math.min(p.min, wave.min), max: Math.max(p.max, wave.max) } : { min: wave.min, max: wave.max };
    }
    const since = nowMs - this.lastSentMs;
    // `since < 0`: the room clock was corrected backwards (a fresh offset
    // estimate) — restart the schedule rather than going quiet until it
    // catches up.
    if (since >= 0 && since < this.intervalMs - this.toleranceMs) return { send: false, onset: false, pulseOnset: false, wave: null };
    const out = { send: true, onset: this.pendingOnset, pulseOnset: this.pendingPulse, wave: this.pendingWave };
    this.pendingOnset = false;
    this.pendingPulse = false;
    this.pendingWave = null;
    this.lastSentMs = since < 0 || since > 2 * this.intervalMs ? nowMs : this.lastSentMs + this.intervalMs;
    return out;
  }
}
