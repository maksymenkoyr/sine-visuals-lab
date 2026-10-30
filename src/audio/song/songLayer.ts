// The song layer: audio v6's readings of the music (SongFrame), made beside the audio engine from the same samples.
// It runs on the device that hears the music, on the main thread, fed from the same capture quanta the engine gets
// (src/audio/engineSource.ts), and fills FeatureFrame.song. The code beside this file is v6's, copied; the bench check
// in audio-subsystem's bench-signals (probe app-song) holds it equal to v6, whose windows, quantiles, gates and
// rangers were picked in its rich-song test (#798, #800).
//
// read() does what v6's AudioEngine.frame does after its band meter, in the same order and from the same inputs;
// v6's kick level is v5's low band, which is EngineReading.low (v6 leaves its band gain at 1).
// Several of these modules keep state at module level (song/v4/), so two layers must not run at once; a new one
// starts from a fresh module's state.

import type { EngineReading, SongFrame } from "../types.ts";
import { HatsSplit } from "./hats.ts";
import { Loudness } from "./loudness.ts";
import { Playing } from "./playing.ts";
import { makeRanger, type RangedField, type Ranger } from "./range.ts";
import { Rise } from "./rise.ts";
import { PLAYING_GATE, RANGES, TRIGGERS, type TriggeredField } from "./song.ts";
import { Trigger } from "./trigger.ts";
import { V21 } from "./v21.ts";
import { resetV4State, V4Lanes } from "./v4lanes.ts";

/** Where each trigger fires on its level's displayed scale, 0..1; NaN while it has no history to set a mark from. */
export interface SongMarks {
  kick: number;
  clap: number;
  hat: number;
  chord: number;
}

type RangedLevel = Extract<RangedField, "loudness" | "hatLevel" | "chordLevel" | "dropLevel">;

const unit = (x: number): number => (x > 0 ? (x < 1 ? x : 1) : 0);

export class SongLayer {
  /** The panel's firing marks (they do not travel); the object is reused. */
  readonly marks: SongMarks = { kick: NaN, clap: NaN, hat: NaN, chord: NaN };
  /** The last reading, filled by read(); all zero and false before the first. */
  readonly reading: SongFrame = {
    kick: false, clap: false, hat: false, chord: false,
    clapLevel: 0, hatLevel: 0, chordLevel: 0, keys: 0, loudness: 0, dropLevel: 0, playing: 0,
  };
  private readonly loudness: Loudness;
  private readonly playing: Playing;
  private readonly v21: V21;
  private readonly v4: V4Lanes;
  private readonly hats: HatsSplit;
  private readonly triggers: Record<TriggeredField, Trigger>;
  private readonly rises: Record<TriggeredField, Rise | null>;
  private readonly rangers: Record<RangedLevel, Ranger>;
  /** The rise stage's running minimum under each trigger's last input; 0 for a trigger with no rise stage. */
  private readonly lows: Record<TriggeredField, number> = { kick: 0, clap: 0, hat: 0, chord: 0 };
  private playingNow = 0;

  constructor(sampleRate: number) {
    resetV4State();
    this.loudness = new Loudness(sampleRate);
    this.playing = new Playing(sampleRate);
    this.v21 = new V21(sampleRate);
    this.v4 = new V4Lanes(sampleRate);
    this.hats = new HatsSplit(sampleRate);
    const t = (k: TriggeredField) => new Trigger(TRIGGERS[k].windowS, TRIGGERS[k].quantile);
    this.triggers = { kick: t("kick"), clap: t("clap"), hat: t("hat"), chord: t("chord") };
    const r = (k: TriggeredField) => {
      const riseS = TRIGGERS[k].riseS;
      return riseS === undefined ? null : new Rise(riseS);
    };
    this.rises = { kick: r("kick"), clap: r("clap"), hat: r("hat"), chord: r("chord") };
    const g = (k: RangedLevel) => makeRanger(RANGES[k], k);
    this.rangers = { loudness: g("loudness"), hatLevel: g("hatLevel"), chordLevel: g("chordLevel"), dropLevel: g("dropLevel") };
  }

  /** Mono samples whose first one was captured at `time` (seconds, the clock read() gets). */
  // @per-frame
  push(samples: Float32Array, time: number): void {
    this.loudness.push(samples);
    this.playing.push(samples);
    this.v21.push(samples);
    this.v4.push(samples, time);
    this.hats.push(samples);
  }

  /** The trigger always steps, so its window keeps filling while the gate is shut. */
  private fire(k: TriggeredField, level: number, now: number, engine: EngineReading): boolean {
    const rise = this.rises[k];
    let input = level;
    if (rise) {
      input = rise.step(level, now);
      this.lows[k] = level - input;
    }
    const fired = this.triggers[k].step(input, now);
    const gate = TRIGGERS[k].gate;
    if (gate === "playing") return fired && this.playingNow >= PLAYING_GATE;
    if (gate === "music") return fired && engine.music;
    return fired;
  }

  /** The trigger's firing mark on the level's own scale, before the level is ranged. */
  private markOf(k: TriggeredField): number {
    const threshold = this.triggers[k].threshold;
    return Number.isFinite(threshold) ? (this.rises[k] ? this.lows[k] + threshold : threshold) : NaN;
  }

  /**
   * The reading for the frame at `now`, `dt` seconds after the previous one, with the engine's own reading of the same
   * frame. The returned object is reused.
   */
  // @per-frame
  read(now: number, dt: number, engine: EngineReading): SongFrame {
    const s = this.reading;
    const m = this.marks;
    const kickLevel = engine.low;
    this.playingNow = this.playing.update(dt);
    s.kick = this.fire("kick", kickLevel, now, engine);
    this.v21.advance(dt);
    const loudness = this.loudness.value;
    const dropLevel = this.v21.buildup;
    this.v4.frame(now, dt);
    const clapLevel = this.v4.clapLevel;
    s.clap = this.fire("clap", clapLevel, now, engine);
    const hatLevel = this.hats.level(now);
    s.hat = this.fire("hat", hatLevel, now, engine);
    const chordLevel = this.v4.chordLevel;
    s.chord = this.fire("chord", chordLevel, now, engine);

    const rg = this.rangers;
    s.loudness = rg.loudness.step(loudness, dt);
    s.hatLevel = rg.hatLevel.step(hatLevel, dt);
    s.chordLevel = rg.chordLevel.step(chordLevel, dt);
    s.dropLevel = rg.dropLevel.step(dropLevel, dt);
    s.clapLevel = unit(clapLevel);
    s.keys = unit(this.v4.keys);
    s.playing = unit(this.playingNow);

    // The hat and chord levels are ranged by static rangers (RANGES), which map a value the same whatever they are
    // asked, so asking for a mark does not move them.
    const kick = this.markOf("kick");
    const clap = this.markOf("clap");
    const hat = this.markOf("hat");
    const chord = this.markOf("chord");
    m.kick = Number.isNaN(kick) ? NaN : unit(kick);
    m.clap = Number.isNaN(clap) ? NaN : unit(clap);
    m.hat = Number.isNaN(hat) ? NaN : rg.hatLevel.step(hat, 0);
    m.chord = Number.isNaN(chord) ? NaN : rg.chordLevel.step(chord, 0);
    return s;
  }
}
