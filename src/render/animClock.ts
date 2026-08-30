import type { FeatureFrame } from "../audio/types.ts";
import { createFlowClock, type FlowClock } from "./flowClock.ts";
import { createBeatClock, type BeatClock } from "./beatClock.ts";
import { createBandEnergy, type BandEnergy } from "./bandEnergy.ts";
import { createSectionIntensity, type SectionIntensity } from "./sectionIntensity.ts";
import { createMusicProfile, type MusicProfile, type DialValues } from "./musicProfile.ts";
import { SMOOTHING_DEFAULT, smoothingRateScale } from "../audio/sensitivity.ts";

// Bundles every per-frame renderer-side clock a scene might want, so
// Scene.render() takes one object instead of an ever-growing positional
// argument list. See flowClock.ts, beatClock.ts, bandEnergy.ts and
// sectionIntensity.ts for what each field means and why it's derived rather
// than read straight off FeatureFrame.
export interface AnimFrame {
  dtSec: number;
  timeSec: number;
  /** Monotonic, audio-warped clock — see flowClock.ts. */
  flowPhase: number;
  /** Decaying [0,1] flash that jumps to 1 on each beat. */
  beatPulse: number;
  /** One-shot broadband onset edge, mirroring FeatureFrame.onset — true only
   *  on the tick it fired. JS-side only, same family as lowOnset/midOnset/
   *  highOnset/dropOnset below: a scene wanting a discrete trigger (not
   *  beatPulse's continuous decay) reads this instead of FeatureFrame.onset
   *  directly, so every scene goes through the render loop's edge latch
   *  (see src/render/renderLatch.ts) rather than risking a tick the render
   *  cap skipped. */
  onset: boolean;
  /** Phase-locked beat/bar clock — see beatClock.ts. Never restarts mid-beat
   *  the way FeatureFrame.onsetPhase can (that field has no reader today —
   *  this superseded it). */
  beatPhase: number;
  barPhase: number;
  tempoLock: number;
  /** Slewed low/mid/high band levels and their onset pulses — see bandEnergy.ts. */
  low: number;
  mid: number;
  high: number;
  lowPulse: number;
  midPulse: number;
  highPulse: number;
  /** One-shot edges, true only on the tick each group's onset fired. JS-side
   *  only (not uploaded as uniforms) — for scenes that want to trigger a
   *  discrete JS-side effect (e.g. a ripple) rather than read a continuous
   *  pulse in the shader. */
  lowOnset: boolean;
  midOnset: boolean;
  highOnset: boolean;
  /** Section-level loudness trend and drop flash — see sectionIntensity.ts. */
  sectionIntensity: number;
  dropPulse: number;
  dropOnset: boolean;
  /** The dials in MUSIC_DIALS' description of the track's character — see
   *  musicProfile.ts.
   *  What autoTune.ts resolves scene settings against; also the hook future
   *  VJ-autopilot features (auto palette, auto scene switching) read. */
  profile: DialValues;
  /** Pre-smoothing counterparts of sectionIntensity/profile above, for the
   *  meters panel's RAW chip (src/ui/audioMeters.ts). JS-side only — never
   *  uploaded as uniforms, the same way lowOnset/midOnset aren't. */
  raw: { sectionIntensity: number; profile: DialValues };
}

export interface AnimClock {
  /** Advances every underlying clock by dtSec and returns the combined
   *  frame. Call once per render tick, using the frame that's actually
   *  driving the visuals this tick. `smoothing` defaults to 1x (today's
   *  behavior) — see sensitivity.ts's smoothingRateScale. Its derived
   *  rateScale now reaches bandEnergy, sectionIntensity's INTENSITY_SLEW and
   *  musicProfile's eases alike, so `smoothing` at the Smoothing row's Off
   *  stop (0 -> Infinity) makes sectionIntensity/profile land exactly on the
   *  `raw` counterparts already exposed below — see the meters panel's RAW
   *  chip (src/ui/audioMeters.ts). */
  advance(dtSec: number, frame: FeatureFrame, smoothing?: number): AnimFrame;
}

const BEAT_PULSE_DECAY_PER_SEC = 6; // matches the existing app.ts/tv.ts broadband beatPulse decay

export function createAnimClock(): AnimClock {
  const flow: FlowClock = createFlowClock();
  const beat: BeatClock = createBeatClock();
  const bandEnergy: BandEnergy = createBandEnergy();
  const section: SectionIntensity = createSectionIntensity();
  const profile: MusicProfile = createMusicProfile();
  let beatPulse = 0;

  return {
    advance(dtSec: number, frame: FeatureFrame, smoothing = SMOOTHING_DEFAULT): AnimFrame {
      const rateScale = smoothingRateScale(smoothing);
      const flowPhase = flow.advance(dtSec, frame.energy);
      beat.advance(dtSec, frame.bpm, frame.onset);
      bandEnergy.advance(dtSec, frame.bands, rateScale);
      section.advance(dtSec, frame.energy, rateScale);
      profile.advance(dtSec, frame, { tempoLock: beat.tempoLock, sectionIntensity: section.intensity }, rateScale);

      beatPulse *= Math.exp(-dtSec * BEAT_PULSE_DECAY_PER_SEC * rateScale);
      if (frame.onset) beatPulse = 1;

      return {
        dtSec,
        timeSec: frame.time,
        flowPhase,
        beatPulse,
        onset: frame.onset,
        beatPhase: beat.beatPhase,
        barPhase: beat.barPhase,
        tempoLock: beat.tempoLock,
        low: bandEnergy.low,
        mid: bandEnergy.mid,
        high: bandEnergy.high,
        lowPulse: bandEnergy.lowPulse,
        midPulse: bandEnergy.midPulse,
        highPulse: bandEnergy.highPulse,
        lowOnset: bandEnergy.lowOnset,
        midOnset: bandEnergy.midOnset,
        highOnset: bandEnergy.highOnset,
        sectionIntensity: section.intensity,
        dropPulse: section.dropPulse,
        dropOnset: section.dropOnset,
        profile: {
          pulse: profile.pulse,
          tempo: profile.tempo,
          brightness: profile.brightness,
          density: profile.density,
          dynamics: profile.dynamics,
          attack: profile.attack,
          loudness: profile.loudness,
        },
        raw: {
          sectionIntensity: section.rawIntensity,
          profile: { ...profile.targets },
        },
      };
    },
  };
}
