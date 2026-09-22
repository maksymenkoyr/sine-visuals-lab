import { type FeatureFrame } from "../audio/types.ts";
import type { OnsetDiag } from "../audio/onsetDiag.ts";
import { createFlowClock, type FlowClock } from "./flowClock.ts";
import { createBeatClock, type BeatClock } from "./beatClock.ts";
import { createBandEnergy, type BandEnergy } from "./bandEnergy.ts";
import { createSectionIntensity, type SectionIntensity } from "./sectionIntensity.ts";
import { createMusicProfile, type MusicProfile, type DialValues } from "./musicProfile.ts";
import { createSpectralCentroid, type SpectralCentroid } from "./spectralCentroid.ts";
import { SMOOTHING_DEFAULT, smoothingRateScale } from "../audio/sensitivity.ts";
import { silenceGateDimmer, type SilenceGateMarks } from "../audio/silenceGate.ts";
import { hitStrength, type HitShape, type HitParts } from "../audio/hitStrength.ts";

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
  /** Decaying [0,1] flash that jumps to 1 on each beat — raw hits, same as
   *  `onset` below (see that field's own doc for why: gridding a beat is a
   *  per-setting drive choice now, not something animClock does for every
   *  scene at once). */
  beatPulse: number;
  /** One-shot broadband beat edge — FeatureFrame.onset, true only on the
   *  tick it fired. JS-side only, same family as lowOnset/midOnset/
   *  highOnset/dropOnset below: a scene wanting a discrete trigger (not
   *  beatPulse's continuous decay) reads this instead of FeatureFrame.onset
   *  directly, so every scene goes through the render loop's edge latch
   *  (see src/render/renderLatch.ts) rather than risking a tick the render
   *  cap skipped. Raw — no grid applied. A `{ source: "beat", grid }` drive
   *  (src/render/drives.ts) grids this same edge per setting instead; a
   *  scene wanting "the whole scene's beat reactions on a grid" the way the
   *  old single per-scene Beat grid row worked no longer exists as one
   *  switch — each drive setting picks its own grid now. */
  onset: boolean;
  /** Phase-locked beat/bar clock — see beatClock.ts. Never restarts mid-beat
   *  the way FeatureFrame.onsetPhase can (that field has no reader today —
   *  this superseded it). */
  beatPhase: number;
  barPhase: number;
  tempoLock: number;
  /** beatClock.ts's own unwrapped beat count — free-running, never resets.
   *  JS-side only, like `raw`/`hits` below: src/render/drives.ts's
   *  `{ source: "beat", grid }` choice is what actually turns this into a
   *  gridded pulse per setting (src/render/gridPulse.ts), off this same
   *  field. No scene reads it directly. */
  beats: number;
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
  /** Fast, range-adapted spectral centroid — see spectralCentroid.ts for why
   *  it differs from profile.brightness (that's a slow track descriptor;
   *  this is a live signal safe to drive a scene's color/motion from). */
  centroid: number;
  /** The unsmoothed, absolute counterpart to centroid — see
   *  spectralCentroid.ts. */
  centroidRaw: number;
  /** FeatureFrame.bpm passed through unchanged — beatListener.ts's
   *  resolveHold reads this (alongside tempoLock) to size a hold in beats
   *  rather than a fixed duration. */
  bpm: number;
  /** This tick's silence-gate dimmer (src/audio/silenceGate.ts) — the same
   *  value bandEnergy.advance() was called with above, computed once here
   *  from `gate`/`frame.level` (see advance()'s own doc). 1 with no gate or
   *  a fully open room, down toward 0 the quieter the room reads. The
   *  Rhythm card's hits history reads this to shade the ground (alpha
   *  proportional to `1 - gateDimmer`, so a half-open gate reads lighter
   *  than a shut one); a BeatListener's "bass"/"mid"/"high" sources are
   *  gated by construction (lowOnset/midOnset/highOnset are already false
   *  while this sits near 0). */
  gateDimmer: number;
  /** Per-group onset diagnostics (bandEnergy.ts's lowDiag/midDiag/highDiag)
   *  — JS-only like `raw`, per-tick readings, NOT edges: unlike
   *  lowOnset/midOnset/highOnset above, these are not folded into
   *  renderLatch.ts's one-shot latch, so a scene must not read them as
   *  triggers — only the meters panel's hit history does, on its own
   *  every-rAF-tick update ahead of the render cap. A fresh snapshot each
   *  frame (unlike bandEnergy's own lowDiag/midDiag/highDiag, which alias
   *  their mutated source) so a caller holding an old AnimFrame never sees
   *  a later tick's numbers under it. */
  hits: { low: OnsetDiag; mid: OnsetDiag; high: OnsetDiag };
  /** Each detector's last graded hit — see hitStrength.ts's HitParts and
   *  the `hit` param below. Copies, same reasoning as `hits` above copying
   *  bandEnergy's own diags: these hold the *last fired hit's* numbers
   *  (they only change on that detector's own onset), which is exactly what
   *  the meters panel's Hit strength card (audioMeters.ts) wants to watch
   *  without an old AnimFrame changing under it later. */
  hitStrength: { beat: HitParts; low: HitParts; mid: HitParts; high: HitParts };
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
   *  chip (src/ui/audioMeters.ts). `gate` (src/audio/silenceGate.ts), when
   *  given, is turned into this tick's dimmer from `frame.level` right here
   *  and threaded into bandEnergy's own advance() — animClock stays
   *  param-driven and never reads the store itself, so only the real
   *  app.ts/tv.ts entry points pass marks; omitted by every preview/
   *  gallery/probe caller, which is what leaves those ungated. `hit`
   *  (src/audio/hitStrength.ts), same rule: when given, its `shape` is
   *  threaded into bandEnergy's own advance() and grades the broadband
   *  beatPulse below too; omitted, every pulse in this frame stays a flat 1
   *  on its onset, exactly as before that module existed. `hit.beatRatio` is
   *  the broadband detector's own OnsetDiag.ratio for *this* tick
   *  (features.ts's FeatureExtractor.fluxRatio, kept outside this module
   *  since animClock never reads a FeatureExtractor directly) — omitted or
   *  null (a device with no local extractor), the broadband grade falls
   *  back to the loudest of this same tick's three band ratios. No `line`/
   *  `beatGrid` params any more — gridding a beat and drawing a frequency
   *  line are both per-setting drive choices now (src/render/drives.ts),
   *  not something animClock does once for the whole scene; `onset`/
   *  `beatPulse` are the raw, ungridded hits and `beats` is the raw unwrapped
   *  count a `{ source: "beat", grid }` drive grids on its own. */
  advance(
    dtSec: number,
    frame: FeatureFrame,
    smoothing?: number,
    gate?: SilenceGateMarks,
    hit?: { shape: HitShape; beatRatio?: number | null },
  ): AnimFrame;
}

const BEAT_PULSE_DECAY_PER_SEC = 6; // matches the existing app.ts/tv.ts broadband beatPulse decay

export function createAnimClock(): AnimClock {
  const flow: FlowClock = createFlowClock();
  const beat: BeatClock = createBeatClock();
  const bandEnergy: BandEnergy = createBandEnergy();
  const section: SectionIntensity = createSectionIntensity();
  const profile: MusicProfile = createMusicProfile();
  const centroid: SpectralCentroid = createSpectralCentroid();
  let beatPulse = 0;
  // The broadband detector's own last graded hit — mutated in place by
  // hitStrength() below, same reasoning as bandEnergy.ts's own per-group
  // GroupState.hit: holds the previous hit's numbers between onsets rather
  // than resetting, and is only ever written while `hit` is given.
  const beatHit: HitParts = { standout: 0, loudness: 0, strength: 0 };

  return {
    advance(
      dtSec: number,
      frame: FeatureFrame,
      smoothing = SMOOTHING_DEFAULT,
      gate?: SilenceGateMarks,
      hit?: { shape: HitShape; beatRatio?: number | null },
    ): AnimFrame {
      const rateScale = smoothingRateScale(smoothing);
      const dimmer = gate ? silenceGateDimmer(frame.level, gate) : 1;
      const flowPhase = flow.advance(dtSec, frame.energy);
      beat.advance(dtSec, frame.bpm, frame.onset);
      bandEnergy.advance(dtSec, frame.bands, rateScale, dimmer, hit?.shape);
      section.advance(dtSec, frame.energy, rateScale);
      profile.advance(dtSec, frame, { tempoLock: beat.tempoLock, sectionIntensity: section.intensity }, rateScale);
      centroid.advance(dtSec, frame.bands, rateScale);

      // Raw hits — no grid. See AnimFrame.onset's own doc comment.
      const onset = frame.onset;
      beatPulse *= Math.exp(-dtSec * BEAT_PULSE_DECAY_PER_SEC * rateScale);
      if (onset) {
        if (hit) {
          const ratio = hit.beatRatio ?? Math.max(1, bandEnergy.lowDiag.ratio, bandEnergy.midDiag.ratio, bandEnergy.highDiag.ratio);
          const graded = hitStrength(ratio, frame.level, hit.shape, beatHit);
          beatPulse = Math.max(beatPulse, graded.strength);
        } else {
          beatPulse = 1;
        }
      }

      return {
        dtSec,
        timeSec: frame.time,
        flowPhase,
        beatPulse,
        onset,
        beatPhase: beat.beatPhase,
        barPhase: beat.barPhase,
        tempoLock: beat.tempoLock,
        beats: beat.beats,
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
        centroid: centroid.centroid,
        centroidRaw: centroid.raw,
        bpm: frame.bpm,
        gateDimmer: dimmer,
        hits: {
          low: { ...bandEnergy.lowDiag },
          mid: { ...bandEnergy.midDiag },
          high: { ...bandEnergy.highDiag },
        },
        hitStrength: {
          beat: { ...beatHit },
          low: { ...bandEnergy.lowHit },
          mid: { ...bandEnergy.midHit },
          high: { ...bandEnergy.highHit },
        },
      };
    },
  };
}
