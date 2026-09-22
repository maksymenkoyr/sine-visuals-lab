import { NUM_BANDS, type FeatureFrame } from "../audio/types.ts";
import type { OnsetDiag } from "../audio/onsetDiag.ts";
import { createFlowClock, type FlowClock } from "./flowClock.ts";
import { createBeatClock, type BeatClock } from "./beatClock.ts";
import { createBandEnergy, type BandEnergy } from "./bandEnergy.ts";
import { createSectionIntensity, type SectionIntensity } from "./sectionIntensity.ts";
import { createMusicProfile, type MusicProfile, type DialValues } from "./musicProfile.ts";
import { createSpectralCentroid, type SpectralCentroid } from "./spectralCentroid.ts";
import { SMOOTHING_DEFAULT, smoothingRateScale } from "../audio/sensitivity.ts";
import { BEAT_GRID_DEFAULT, beatGridBeats } from "../audio/beatGrid.ts";
import { createGridPulse, type GridPulse } from "./gridPulse.ts";
import { silenceGateDimmer, type SilenceGateMarks } from "../audio/silenceGate.ts";
import { hitStrength, type HitShape, type HitParts } from "../audio/hitStrength.ts";
import { bandLineDrive, type BandLineDrive } from "../audio/bandLine.ts";

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
  /** Decaying [0,1] flash that jumps to 1 on each beat — the same beat as
   *  `onset` below, so it follows the beat grid too. */
  beatPulse: number;
  /** One-shot broadband beat edge — FeatureFrame.onset on the Hits grid, or
   *  a tick of beatClock.ts's phase-locked grid at the chosen note value
   *  (src/audio/beatGrid.ts, derived by gridPulse.ts) — true only
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
  /** Whether this frame's beat edge came from the grid rather than the
   *  detector — false on Hits and while a grid stop is still waiting for
   *  the tracker to lock (gridPulse.ts). The Rhythm card reads this. */
  onGrid: boolean;
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
  /** The sensitivity-line drive (src/audio/bandLine.ts), peak-held: it
   *  jumps to this tick's raw drive whenever that is higher and otherwise
   *  decays at LINE_DRIVE_RELEASE_PER_SEC, the same shape as beatPulse. A
   *  line drawn just above where a band rests is cleared for a frame or two
   *  per hit, which a shader can't show on its own — the release turns that
   *  poke into a visible flash while a sustained rise still reads as a
   *  level. 0 when `line` below is omitted. `frame.bands` here is already
   *  post-band-gains (app.ts applies bandGains.ts before calling advance()),
   *  so the line reads the same shaped spectrum the Bands card's faders left
   *  behind. */
  lineDrive: number;
  /** Per-band excess behind lineDrive above — null when `line` is omitted.
   *  Copied, same reason `hits` copies bandEnergy's diags: the overlay
   *  (src/ui/bandLineEditor.ts) reads this straight off the AnimFrame, and an
   *  old frame must not change under it on a later tick. */
  lineExcess: Float32Array | null;
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
   *  chip (src/ui/audioMeters.ts). `beatGrid` is the Beat grid row's stored
   *  index (src/audio/beatGrid.ts); the default is Hits, today's behaviour.
   *  `gate` (src/audio/silenceGate.ts), when given, is turned into this
   *  tick's dimmer from `frame.level` right here and threaded into
   *  bandEnergy's own advance() — animClock stays param-driven and never
   *  reads the store itself, so only the real app.ts/tv.ts entry points pass
   *  marks; omitted by every preview/gallery/probe caller, which is what
   *  leaves those ungated. `hit` (src/audio/hitStrength.ts), same rule: when
   *  given, its `shape` is threaded into bandEnergy's own advance() and
   *  grades the broadband beatPulse below too; omitted, every pulse in this
   *  frame stays a flat 1 on its onset, exactly as before that module
   *  existed. `hit.beatRatio` is the broadband detector's own OnsetDiag.ratio
   *  for *this* tick (features.ts's FeatureExtractor.fluxRatio, kept outside
   *  this module since animClock never reads a FeatureExtractor directly) —
   *  omitted or null (a device with no local extractor), the broadband grade
   *  falls back to the loudest of this same tick's three band ratios. `line`
   *  (src/audio/bandLine.ts), same rule again: when given, `heights`/
   *  `strength` feed bandLineDrive() against this tick's (already
   *  post-band-gains) `frame.bands`, producing `lineDrive`/`lineExcess`
   *  above; omitted, `lineDrive` is 0 and `lineExcess` is null, so a scene
   *  reading `uLineDrive` (sceneCommon.ts) sees nothing from every preview/
   *  gallery/probe caller that doesn't pass one. */
  advance(
    dtSec: number,
    frame: FeatureFrame,
    smoothing?: number,
    beatGrid?: number,
    gate?: SilenceGateMarks,
    hit?: { shape: HitShape; beatRatio?: number | null },
    line?: { heights: ArrayLike<number>; strength: number },
  ): AnimFrame;
}

const BEAT_PULSE_DECAY_PER_SEC = 6; // matches the existing app.ts/tv.ts broadband beatPulse decay
const LINE_DRIVE_RELEASE_PER_SEC = 6; // lineDrive's peak-hold release — see AnimFrame.lineDrive

export function createAnimClock(): AnimClock {
  const flow: FlowClock = createFlowClock();
  const beat: BeatClock = createBeatClock();
  const bandEnergy: BandEnergy = createBandEnergy();
  const section: SectionIntensity = createSectionIntensity();
  const profile: MusicProfile = createMusicProfile();
  const centroid: SpectralCentroid = createSpectralCentroid();
  const grid: GridPulse = createGridPulse();
  let beatPulse = 0;
  let lineDrive = 0;
  // The broadband detector's own last graded hit — mutated in place by
  // hitStrength() below, same reasoning as bandEnergy.ts's own per-group
  // GroupState.hit: holds the previous hit's numbers between onsets rather
  // than resetting, and is only ever written while `hit` is given.
  const beatHit: HitParts = { standout: 0, loudness: 0, strength: 0 };
  // Per-instance scratch for bandLineDrive() below — bandLine.ts's own
  // default scratch is module-shared, which would let two AnimClock
  // instances (app.ts and tv.ts each own one; tests make many) clobber each
  // other's excess array. lineExcess on the returned AnimFrame is still a
  // fresh copy of this every tick (see that field's own doc comment).
  const lineDriveScratch: BandLineDrive = { drive: 0, excess: new Float32Array(NUM_BANDS) };

  return {
    advance(
      dtSec: number,
      frame: FeatureFrame,
      smoothing = SMOOTHING_DEFAULT,
      beatGrid = BEAT_GRID_DEFAULT,
      gate?: SilenceGateMarks,
      hit?: { shape: HitShape; beatRatio?: number | null },
      line?: { heights: ArrayLike<number>; strength: number },
    ): AnimFrame {
      const rateScale = smoothingRateScale(smoothing);
      const dimmer = gate ? silenceGateDimmer(frame.level, gate) : 1;
      const flowPhase = flow.advance(dtSec, frame.energy);
      beat.advance(dtSec, frame.bpm, frame.onset);
      bandEnergy.advance(dtSec, frame.bands, rateScale, dimmer, hit?.shape);
      section.advance(dtSec, frame.energy, rateScale);
      profile.advance(dtSec, frame, { tempoLock: beat.tempoLock, sectionIntensity: section.intensity }, rateScale);
      centroid.advance(dtSec, frame.bands, rateScale);

      // The beat clock itself always tracks the raw detector (above) — the
      // grid is a view over it, not a feedback into it.
      const onset = grid.advance(beat.beats, beat.tempoLock, beatGridBeats(beatGrid), frame.onset);
      beatPulse *= Math.exp(-dtSec * BEAT_PULSE_DECAY_PER_SEC * rateScale);
      if (onset) {
        if (hit) {
          // frame.onset is the raw detector's own edge this tick (pre-grid);
          // a grid-only tick (a beat/bar/etc pulse the tracker predicted with
          // no detection behind it this exact frame) has nothing to grade,
          // so it reads as a bare trigger (null ratio -> stand-out 1), same
          // as hitStrength.ts's own null-ratio convention everywhere else.
          const ratio = frame.onset
            ? hit.beatRatio ?? Math.max(1, bandEnergy.lowDiag.ratio, bandEnergy.midDiag.ratio, bandEnergy.highDiag.ratio)
            : null;
          const graded = hitStrength(ratio, frame.level, hit.shape, beatHit);
          beatPulse = Math.max(beatPulse, graded.strength);
        } else {
          beatPulse = 1;
        }
      }

      // frame.bands here is already post-band-gains — see this field's own
      // doc comment on AnimFrame.lineDrive.
      const lineResult = line ? bandLineDrive(frame.bands, line.heights, line.strength, lineDriveScratch) : null;
      lineDrive *= Math.exp(-dtSec * LINE_DRIVE_RELEASE_PER_SEC * rateScale);
      if (lineResult && lineResult.drive > lineDrive) lineDrive = lineResult.drive;
      if (!lineResult) lineDrive = 0;

      return {
        dtSec,
        timeSec: frame.time,
        flowPhase,
        beatPulse,
        onset,
        beatPhase: beat.beatPhase,
        barPhase: beat.barPhase,
        tempoLock: beat.tempoLock,
        onGrid: grid.onGrid,
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
        lineDrive,
        lineExcess: lineResult ? Float32Array.from(lineResult.excess) : null,
      };
    },
  };
}
