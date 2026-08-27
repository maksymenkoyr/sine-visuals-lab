export interface ClockSample {
  t0: number; // client send time (ms)
  t1: number; // server time at receipt, echoed back (ms)
  t2: number; // client receive time (ms)
}

/**
 * Picks the lowest-RTT sample — the one least likely to have been skewed by
 * queuing/congestion on either leg — and returns its midpoint estimate of
 * (server clock - client clock), assuming symmetric latency for that one
 * sample. Classic NTP-style offset estimation.
 */
export function pickBestOffset(samples: ClockSample[]): number {
  if (samples.length === 0) return 0;
  let best = samples[0];
  let bestRtt = best.t2 - best.t0;
  for (let i = 1; i < samples.length; i++) {
    const s = samples[i];
    const rtt = s.t2 - s.t0;
    if (rtt < bestRtt) {
      best = s;
      bestRtt = rtt;
    }
  }
  return best.t1 - (best.t0 + best.t2) / 2;
}

const BURST_COUNT = 5;
const BURST_SPACING_MS = 150;
const RESYNC_INTERVAL_MS = 3000;
const SAMPLE_HISTORY = 8;

/**
 * Estimates this device's offset from the room's (the Durable Object's)
 * wall clock via ping/pong round trips, so every device can compute the
 * same `roomNow()` regardless of its own clock skew.
 */
export class ClockSync {
  private samples: ClockSample[] = [];
  private offset = 0;
  private burstTimers: ReturnType<typeof setTimeout>[] = [];
  private resyncTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly sendPing: (t0: number) => void) {}

  start(): void {
    for (let i = 0; i < BURST_COUNT; i++) {
      this.burstTimers.push(setTimeout(() => this.sendPing(Date.now()), i * BURST_SPACING_MS));
    }
    this.resyncTimer = setInterval(() => this.sendPing(Date.now()), RESYNC_INTERVAL_MS);
  }

  stop(): void {
    for (const t of this.burstTimers) clearTimeout(t);
    this.burstTimers = [];
    if (this.resyncTimer !== null) clearInterval(this.resyncTimer);
    this.resyncTimer = null;
  }

  onPong(t0: number, t1: number): void {
    const t2 = Date.now();
    this.samples.push({ t0, t1, t2 });
    if (this.samples.length > SAMPLE_HISTORY) this.samples.shift();
    this.offset = pickBestOffset(this.samples);
  }

  get sampleCount(): number {
    return this.samples.length;
  }

  /** Best current estimate of the room's (server) wall-clock time, in ms. */
  roomNow(): number {
    return Date.now() + this.offset;
  }
}
