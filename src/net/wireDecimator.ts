import type { EngineReading } from "../audio/types.ts";
import type { WaveEnvelope } from "./protocol.ts";

/** Broadcast rate over the wire; local (own-screen) rendering stays at full framerate. */
export const BROADCAST_INTERVAL_MS = 1000 / 30;

/**
 * Thins the host's per-render-tick frames to the wire rate
 * (BROADCAST_INTERVAL_MS, which room.ts decimates to; the room's frame budget
 * is sized from it) without losing the one-tick edges.
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
 * skipped tick still reaches a follower's Waveform row. So is the engine
 * reading's per-frame part: the strongest hit of each kind, the largest
 * surge (with its kind) and any blocked hit since the last send; the rest of
 * the reading (levels, the tracker's state) is the sending tick's own. A
 * follower gates hits on the level of the frame they came in
 * (EngineReading.hitLevel), so the loudest level a carried hit was heard at
 * goes out too (`hitLevel`): a short sound's level has often fallen by the
 * next tick, and the follower would gate a hit the host let through.
 */
export class WireDecimator {
  private lastSentMs = -Infinity;
  private pendingOnset = false;
  private pendingPulse = false;
  private pendingWave: WaveEnvelope | null = null;
  private pendingHitLevel = 0;
  private readonly pendingHits: Pick<EngineReading, "kick" | "snare" | "hat" | "surge" | "surgeKind" | "blocked"> = {
    kick: 0,
    snare: 0,
    hat: 0,
    surge: 0,
    surgeKind: "kick",
    blocked: false,
  };

  constructor(
    private readonly intervalMs: number,
    private readonly toleranceMs = 4,
  ) {}

  /** Call once per render tick. When `send` is true, put `onset`,
   *  `pulseOnset`, `wave` and `engine` (latched since the last send, not the
   *  tick's own) on the wire. `wave` is this tick's envelope, null with no
   *  samples; the sent one is null only if no tick since the last send had
   *  one. The sent `engine` is a copy, null when this tick has none.
   *  `hitLevel` is the highest `level` a tick with a hit had since the last
   *  send, 0 with no hit; the frame sent carries at least that level. */
  offer(
    nowMs: number,
    onset: boolean,
    pulseOnset: boolean,
    wave: WaveEnvelope | null = null,
    engine: EngineReading | null = null,
    level = 0,
  ): { send: boolean; onset: boolean; pulseOnset: boolean; wave: WaveEnvelope | null; engine: EngineReading | null; hitLevel: number } {
    this.pendingOnset = this.pendingOnset || onset;
    this.pendingPulse = this.pendingPulse || pulseOnset;
    if (wave) {
      const p = this.pendingWave;
      this.pendingWave = p ? { min: Math.min(p.min, wave.min), max: Math.max(p.max, wave.max) } : { min: wave.min, max: wave.max };
    }
    const h = this.pendingHits;
    if (engine) {
      h.kick = Math.max(h.kick, engine.kick);
      h.snare = Math.max(h.snare, engine.snare);
      h.hat = Math.max(h.hat, engine.hat);
      if (engine.surge > h.surge) {
        h.surge = engine.surge;
        h.surgeKind = engine.surgeKind;
      }
      h.blocked = h.blocked || engine.blocked;
      if (engine.kick > 0 || engine.snare > 0 || engine.hat > 0) this.pendingHitLevel = Math.max(this.pendingHitLevel, level);
    }
    const since = nowMs - this.lastSentMs;
    // `since < 0`: the room clock was corrected backwards (a fresh offset
    // estimate) — restart the schedule rather than going quiet until it
    // catches up.
    if (since >= 0 && since < this.intervalMs - this.toleranceMs) return { send: false, onset: false, pulseOnset: false, wave: null, engine: null, hitLevel: 0 };
    const sent = engine ? { ...engine, kick: h.kick, snare: h.snare, hat: h.hat, surge: h.surge, surgeKind: h.surgeKind, blocked: h.blocked } : null;
    const out = { send: true, onset: this.pendingOnset, pulseOnset: this.pendingPulse, wave: this.pendingWave, engine: sent, hitLevel: this.pendingHitLevel };
    this.pendingOnset = false;
    this.pendingPulse = false;
    this.pendingWave = null;
    this.pendingHitLevel = 0;
    h.kick = h.snare = h.hat = h.surge = 0;
    h.blocked = false;
    this.lastSentMs = since < 0 || since > 2 * this.intervalMs ? nowMs : this.lastSentMs + this.intervalMs;
    return out;
  }
}
