// The audio engine behind two calls: push() with captured audio as it
// arrives, read() once per rendered frame. Audio is analysed as it is pushed,
// so the results don't depend on the frame rate; a read gives the band levels
// over exactly the audio since the read before, the strongest hit of each
// kind since then, how close the onset detector came to firing, and the tempo
// tracker's latest state. Plain arithmetic on Float32Arrays, so it runs the
// same in the browser (src/audio/engineSource.ts feeds it) and in Node (the
// tests and tests/tempoEval/).
//
// The beat clock (clock.ts) doesn't run here. Every device runs its own off
// the reading (src/render/animClock.ts), so a TV following this device keeps
// time the same way it does: the reading rides the frame (src/audio/types.ts)
// and the wire (src/net/protocol.ts). docs/audio-engine.md has where each
// stage's ideas came from and what they measured.

import type { EngineReading } from "../types.ts";
import { BandMeter, type BandSpec, DEFAULT_BANDS } from "./bands.ts";
import { type HitKind, OnsetDetector, type OnsetSink } from "./onsets.ts";
import { TempoTracker } from "./tempo.ts";

export class AudioEngine implements OnsetSink {
  readonly sampleRate: number;
  private readonly meter: BandMeter;
  private readonly onsets: OnsetDetector;
  private readonly tracker: TempoTracker;
  private kick = 0;
  private snare = 0;
  private hat = 0;
  private surge = 0;
  private surgeKind: HitKind = "kick";
  private blocked = false;
  private readonly reading: EngineReading = {
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
    beatTime: 0,
    downbeatTime: 0,
    downbeatConfidence: 0,
    updates: 0,
  };

  constructor(sampleRate: number, bands: readonly BandSpec[] = DEFAULT_BANDS) {
    this.sampleRate = sampleRate;
    this.meter = new BandMeter(sampleRate, bands);
    this.onsets = new OnsetDetector(sampleRate, this);
    this.tracker = new TempoTracker(this.onsets.rate);
  }

  /** Mono samples whose first one was captured at `time` (seconds, the clock read() times frames on). */
  // @per-frame
  push(samples: Float32Array, time: number): void {
    this.meter.push(samples);
    this.onsets.push(samples, time);
  }

  /** The tracker's tempo, 0 while it hears no steady pulse. */
  get bpm(): number {
    const st = this.tracker.state;
    return st.music ? st.bpm : 0;
  }

  /** Moves the band crossovers (bands.ts's BandMeter.retune). */
  retune(bands: readonly BandSpec[]): void {
    this.meter.retune(bands);
  }

  /** The reading for a frame `dt` seconds after the previous one. The returned object is reused. */
  // @per-frame
  read(dt: number): EngineReading {
    const levels = this.meter.read(dt).values;
    const r = this.reading;
    r.low = levels[0];
    r.mid = levels[1];
    r.high = levels[2];
    r.kick = this.kick;
    r.snare = this.snare;
    r.hat = this.hat;
    r.surge = this.surge;
    r.surgeKind = this.surgeKind;
    r.blocked = this.blocked;
    this.kick = this.snare = this.hat = this.surge = 0;
    this.blocked = false;
    const st = this.tracker.state;
    r.music = st.music;
    r.confidence = st.confidence;
    r.beatTime = st.beatTime;
    r.downbeatTime = st.downbeatTime;
    r.downbeatConfidence = st.downbeatConfidence;
    r.updates = st.updates;
    return r;
  }

  envelope(time: number, flux: number, low: number): void {
    this.tracker.push(time, flux, low);
  }

  hit(_time: number, kind: HitKind, strength: number): void {
    if (strength > this[kind]) this[kind] = strength;
  }

  rise(ratio: number, kind: HitKind, blocked: boolean): void {
    if (ratio > this.surge) {
      this.surge = ratio;
      this.surgeKind = kind;
    }
    if (blocked) this.blocked = true;
  }
}
