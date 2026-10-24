import { type FeatureFrame } from "../audio/types.ts";
import type { OnsetDiag } from "../audio/onsetDiag.ts";
import { createFlowClock, type FlowClock } from "./flowClock.ts";
import { BeatClock } from "../audio/engine/clock.ts";
import { LockMeter, type LockMeaning } from "./lockMeaning.ts";
import { createMetronome, type Metronome } from "./metronome.ts";
import { createBeatTrimmer, getBeatTrim, type BeatTrimmer } from "./beatTrim.ts";
import { createTapGuide, type TapGuide } from "./tapTempo.ts";
import { createBandEnergy, slewLevel, type BandEnergy } from "./bandEnergy.ts";
import { createSectionIntensity, type SectionIntensity } from "./sectionIntensity.ts";
import { createMusicProfile, type MusicProfile, type DialValues } from "./musicProfile.ts";
import { createSpectralCentroid, type SpectralCentroid } from "./spectralCentroid.ts";
import { createBandPick, type BandPick } from "./bandPick.ts";
import { getBandSplit } from "../audio/bandSplit.ts";
import { SMOOTHING_DEFAULT, smoothingRateScale } from "../audio/sensitivity.ts";
import { silenceGateDimmer, type SilenceGateMarks } from "../audio/silenceGate.ts";
import { hitStrength, pulseDecayScales, UNIT_TAILS, type HitShape, type HitParts, type HitTails } from "../audio/hitStrength.ts";

// Bundles every per-frame renderer-side clock a scene might want, so
// Scene.render() takes one object instead of an ever-growing positional
// argument list. See flowClock.ts, metronome.ts, bandEnergy.ts and
// sectionIntensity.ts for what each field means and why it's derived rather
// than read straight off FeatureFrame.
//
// The beat clock is the engine's (src/audio/engine/clock.ts), run here on
// every device off the reading each frame carries (FeatureFrame.engine), on
// this clock's own timeline (`clockSec`): the reading's beat times are turned
// into ages against the frame's time, so a TV's jitter-buffered frames and a
// solo capture's AudioContext times both work. Lock (`tempoLock`) is one of
// lockMeaning.ts's meanings, picked per clock. metronome.ts sits on top of the
// beat clock, advanced right after it off its bpm/beats and Lock.
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
  /** One-shot "Any hit" edge — any of lowOnset/midOnset/highOnset, true
   *  only on the tick it fired. JS-side only, same family as lowOnset/midOnset/
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
  /** The engine's largest rise over its hit threshold since the frame before
   *  (EngineReading.surge; 0 with no reading). Unlike `onset`, this never
   *  gates on refractory/threshold — it's the raw "how close is the detector
   *  to firing right now" reading (1 at a bare trigger, above 1 the harder a
   *  hit cleared). src/render/drives.ts's `feature.flux` catalogue source
   *  ("Onset surge") reads this so a scene can lean into a build-up before
   *  the beat actually lands, not just react after. */
  beatRatio: number;
  /** The raw mic waveform's peak |sample| this tick, peak-held — jumps to a
   *  louder peak at once, then falls at WAVE_PEAK_FALL_PER_SEC times this
   *  tick's smoothing rateScale (so Smoothing's Off stop, rateScale =
   *  Infinity, makes it exactly the instantaneous peak, same as the Waveform
   *  row's RAW reading). It's the one number the Input check card's Waveform
   *  readout shows and the `anim.wavePeak` drive source (signals.ts) reads —
   *  computed here once so both read the same thing. Linear amplitude [0,1]
   *  of the raw capture (before auto-gain/sensitivity), not normalized. On a
   *  device following another one's input, the capture is that device's, off
   *  the frame's wave tail (src/net/protocol.ts; app.ts's waveSamples). 0
   *  whenever `hit.wavePeak` is omitted/null (no mic and no wave from the
   *  feed, previews). */
  wavePeak: number;
  /** The engine's beat/bar clock (src/audio/engine/clock.ts), corrected by
   *  beatTrim.ts (a bar resync, a ×2/÷2 tracking-error fix, a small
   *  earlier/later nudge; see that file for why and the math). Never
   *  restarts mid-beat the way FeatureFrame.onsetPhase can (that field has
   *  no reader today — this superseded it). */
  beatPhase: number;
  barPhase: number;
  /** Lock: how sure the beat clock is of its beat, 0..1, in the meaning
   *  this clock was created with (lockMeaning.ts). 0 with no music. */
  tempoLock: number;
  /** The beat clock's unwrapped beat count, corrected by beatTrim.ts (see
   *  beatPhase above) — free-running, never resets. JS-side only, like
   *  `raw`/`hits` below: src/render/drives.ts's `{ source: "beat", grid }`
   *  choice is what actually turns this into a gridded pulse per setting
   *  (src/render/gridPulse.ts), off this same field. No scene reads it
   *  directly. */
  beats: number;
  /** The beat clock's tempo — the bpm its phase is actually running at,
   *  coasting to 0 with no music — × beatTrim.ts's own multiplier
   *  (1 by default), as opposed to `bpm` below (the raw FeatureFrame/wire
   *  passthrough, also × that multiplier — see its own doc).
   *  src/render/signals.ts's "Tempo" signal reads this. */
  tempoBpm: number;
  /** Slewed low/mid/high band levels and their onset pulses — see bandEnergy.ts. */
  low: number;
  mid: number;
  high: number;
  lowPulse: number;
  midPulse: number;
  highPulse: number;
  /** FeatureFrame.hats/lead (src/audio/stemSplit.ts), eased with the same
   *  slew as `low`/`mid`/`high` and multiplied by the silence gate's dimmer
   *  (`gateDimmer`), so a quiet room's hiss never reads as hats or a melody:
   *  the split's own scale is relative and has no idea what silence is. */
  hats: number;
  lead: number;
  /** One-shot edges, true only on the tick each group's onset fired. JS-side
   *  only (not uploaded as uniforms) — for scenes that want to trigger a
   *  discrete JS-side effect (e.g. a ripple) rather than read a continuous
   *  pulse in the shader. */
  lowOnset: boolean;
  midOnset: boolean;
  highOnset: boolean;
  /** The one low band that pulses most clearly right now, its level (silence-gate dimmed like low/mid/high) and its index — see bandPick.ts. src/render/signals.ts's "Kick band" reads kickBand. */
  kickBand: number;
  kickBandIndex: number;
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
  /** FeatureFrame.bpm × beatTrim.ts's own multiplier (1 by default — see
   *  that file), folded onto a tapped tempo first while `tapGuided` (see
   *  tapTempo.ts's fold()) — beatListener.ts's resolveHold reads this
   *  (alongside tempoLock) to size a hold in beats rather than a fixed
   *  duration, so a hold sized in beats keeps its real-time length in step
   *  with a ×2/÷2 correction or a tap. The BPM card's RAW mode reads
   *  FeatureFrame.bpm directly instead of this field — deliberately left
   *  raw/unmultiplied. */
  bpm: number;
  /** True while a tap tempo guides the tracker: from the tap taking effect
   *  until the tracker moves on to a tempo of its own (tapTempo.ts's
   *  follow()). Always false on a clock whose advance() is never given
   *  `tapNowMs`. */
  tapGuided: boolean;
  /** metronome.ts's own flywheel clock, also corrected by beatTrim.ts (its
   *  own second BeatTrimmer instance, "metroTrim" — see animClock.ts's own
   *  wiring and beatTrim.ts's header) — see metronome.ts's file header for
   *  why this exists alongside beatPhase/beats/tempoBpm above: those follow
   *  the tracker live (gridPulse.ts falls back to raw hits when unsure, and
   *  the beat clock's phase wavers/stalls with the estimate); these are
   *  "always evenly spaced, always at the song's tempo" once adopted, and
   *  free-run through an unsure patch rather than reacting to it.
   *  `metronomeOn` is metronome.ts's own `running`. */
  metronomeOn: boolean;
  /** The tempo it's actually ticking at, × beatTrim.ts's own multiplier —
   *  0 while `!metronomeOn`. */
  metronomeBpm: number;
  /** Unwrapped beat count, free-running like `beats` above, but off the
   *  metronome's own (corrected) flywheel rather than the live clock. */
  metronomeBeats: number;
  /** [0,1) position within the current beat/bar — the metronome's own
   *  (corrected) counterparts to `beatPhase`/`barPhase`. */
  metronomePhase: number;
  metronomeBarPhase: number;
  /** 0..1, eases in while running and out while idle (metronome.ts's own
   *  `level`) — for a scene/signal that wants to fade with the metronome
   *  rather than snap on/off. */
  metronomeLevel: number;
  /** One-shot edges, true only on the tick beatTrim.ts's own metroTrim
   *  crossed a whole beat/bar AND metronome.ts is actually running (a
   *  multiplier/resync change while idle can move metroTrim's own anchor
   *  with no real tick to show for it — see beatTrim.ts) — same family as
   *  `onset`/`lowOnset` above: read through renderLatch.ts, never straight
   *  off a tick a render-capped scene might skip. */
  metronomeBeat: boolean;
  metronomeBar: boolean;
  /** Decaying [0,1] envelopes that jump to 1 on metronomeBeat/metronomeBar
   *  — the metronome's own counterparts to `beatPulse` above, at the same
   *  BEAT_PULSE_DECAY_PER_SEC rate. JS-side continuous reads for a signal
   *  that wants the metronome's pulse without consuming its one-shot edge. */
  metronomePulse: number;
  metronomeBarPulse: number;
  /** Each lane's pulseDecayScale for this tick's HitShape (all 1 when none
   *  was passed): the factor that lane's pulse decay rate carries, here so
   *  drives.ts's Fixed/Loud heights and grid pulses can fall at the same
   *  stretched rate as the pulses they stand in for. */
  hitTail: HitTails;
  /** This tick's silence-gate dimmer (src/audio/silenceGate.ts) — the same
   *  value bandEnergy.advance() was called with above, computed once here
   *  from `gate`/`frame.level` (see advance()'s own doc). 1 with no gate or
   *  a fully open room, down toward 0 the quieter the room reads. The Hits
   *  card's hits history reads this to shade the ground (alpha
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
   *  the Hits card's own Shape section (audioMeters.ts) wants to watch
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
   *  threaded into bandEnergy's own advance() and grades the "Any hit"
   *  beatPulse below too, from the strongest lane hit that passed; omitted,
   *  every pulse in this frame stays a flat 1 on its onset. No `line`/
   *  `beatGrid` params any more — gridding a beat and drawing a frequency
   *  line are both per-setting drive choices now (src/render/drives.ts),
   *  not something animClock does once for the whole scene; `onset`/
   *  `beatPulse` are the raw, ungridded hits and `beats` is the raw unwrapped
   *  count a `{ source: "beat", grid }` drive grids on its own.
   *  `hit.wavePeak` is this tick's instantaneous waveform peak
   *  (src/audio/waveform.ts's `peak()` over app.ts's lastMono) — solo/host
   *  only, feeding AnimFrame.wavePeak's own peak-hold. `tapNowMs` is this
   *  tick's performance.now(): given, this clock follows the tap-tempo
   *  store (tapTempo.ts — a tap seeds the beat clock and the metronome, and the
   *  raw bpm folds onto the tapped tempo while it guides); omitted, taps
   *  are ignored entirely. Only app.ts's live clock passes it — the beat
   *  keys' own reach, see tapTempo.ts's header. */
  advance(
    dtSec: number,
    frame: FeatureFrame,
    smoothing?: number,
    gate?: SilenceGateMarks,
    hit?: { shape: HitShape; wavePeak?: number | null },
    tapNowMs?: number,
  ): AnimFrame;
  /** Every Lock meaning's reading this tick, whichever one `tempoLock` hands on (for tests/tempoEval/run.ts). */
  lockReadings(): Readonly<Record<LockMeaning, number>>;
}

// Exported so src/render/drives.ts's Fixed/Loud hit heights can decay a
// broadband ("Any hit") source at exactly this same rate rather than
// hand-duplicating it (its own header explains why: "read it from
// animClock/bandEnergy; don't invent one").
export const BEAT_PULSE_DECAY_PER_SEC = 6; // matches the existing app.ts/tv.ts broadband beatPulse decay

// AnimFrame.wavePeak's own fall rate — matches the meters' own peak-hold
// fall (audioMeters.ts's PEAK_FALL_PER_SEC, spectrumStrip.ts's peak-hold
// decay), so moving the hold in here (from audioMeters.ts's own local state)
// doesn't change how the Input check card's Waveform readout looks or feels.
export const WAVE_PEAK_FALL_PER_SEC = 1.2;

/** The strongest lane hit that passed this tick: each passing lane's diag
 *  ratio is its hit's strength (bandEnergy.ts). */
function strongestPassed(b: BandEnergy): number {
  let s = 0;
  if (b.lowOnset) s = Math.max(s, b.lowDiag.ratio);
  if (b.midOnset) s = Math.max(s, b.midDiag.ratio);
  if (b.highOnset) s = Math.max(s, b.highDiag.ratio);
  return s;
}

export function createAnimClock(opts: { lockMeaning?: LockMeaning } = {}): AnimClock {
  const lockMeaning = opts.lockMeaning ?? "stability";
  const flow: FlowClock = createFlowClock();
  const clock = new BeatClock();
  const lockMeter = new LockMeter();
  // The beat clock's own timeline; see the file header.
  let clockSec = 0;
  let lastUpdates = -1;
  // The beat clock's count at the previous tick, where a tap's seed lands.
  let lastClockBeats = 0;
  const metronome: Metronome = createMetronome();
  // beatTrim.ts's correction layer — one trimmer per clock (see that
  // file's header for why two, and its exact wiring below). `wasRunning`
  // catches the tick metronome.ts's own `running` turns true so metroTrim
  // can adopt clockTrim's current multiplier/anchor right then, the same
  // tick the raw metronome itself adopts clock.beats.
  const clockTrim: BeatTrimmer = createBeatTrimmer();
  const metroTrim: BeatTrimmer = createBeatTrimmer();
  let wasRunning = false;
  // tapTempo.ts's guide — see that file's header for why a tap meets the
  // tracker here: a seed into the beat clock and metronome and a fold of the
  // raw bpm.
  const tapGuide: TapGuide = createTapGuide();
  const bandEnergy: BandEnergy = createBandEnergy();
  const kickBand: BandPick = createBandPick();
  // AnimFrame.hitTail, cached against the HitShape it was built from.
  let tailShape: HitShape | undefined;
  let tailScales: HitTails = UNIT_TAILS;
  const section: SectionIntensity = createSectionIntensity();
  const profile: MusicProfile = createMusicProfile();
  const centroid: SpectralCentroid = createSpectralCentroid();
  let beatPulse = 0;
  let hats = 0;
  let lead = 0;
  let metronomePulse = 0;
  let metronomeBarPulse = 0;
  // AnimFrame.wavePeak's own held state — see that field's own doc comment.
  let wavePeak = 0;
  // The "Any hit" lane's last graded hit — mutated in place by
  // hitStrength() below, same reasoning as bandEnergy.ts's own per-lane
  // LaneState.hit: holds the previous hit's numbers between onsets rather
  // than resetting, and is only ever written while `hit` is given.
  const beatHit: HitParts = { standout: 0, loudness: 0, strength: 0 };

  return {
    advance(
      dtSec: number,
      frame: FeatureFrame,
      smoothing = SMOOTHING_DEFAULT,
      gate?: SilenceGateMarks,
      hit?: { shape: HitShape; wavePeak?: number | null },
      tapNowMs?: number,
    ): AnimFrame {
      const rateScale = smoothingRateScale(smoothing);
      // getHitShape() hands back the same frozen snapshot until a field
      // changes, so this rebuilds only on an edit, not every tick.
      if (hit?.shape !== tailShape) {
        tailShape = hit?.shape;
        tailScales = pulseDecayScales(tailShape);
      }
      const hitTail = tailScales;
      // AnimFrame.wavePeak's own peak-hold — see that field's own doc
      // comment. `hit.wavePeak` omitted/null (no mic, no feed wave) holds nothing:
      // it snaps straight to 0. Otherwise a
      // finite `inst` minus a non-finite Infinity rateScale (Smoothing's Off
      // stop) is exactly -Infinity (IEEE754), so Math.max against that lands
      // on `inst` exactly — no separate smoothingOff branch needed, the same
      // reasoning audioMeters.ts's own former peak-hold relied on.
      const inst = hit?.wavePeak;
      wavePeak = inst == null ? 0 : Math.max(inst, wavePeak - WAVE_PEAK_FALL_PER_SEC * rateScale * dtSec);
      const dimmer = gate ? silenceGateDimmer(frame.level, gate) : 1;
      // A follower's hits carry the level of the frame they came in (EngineReading.hitLevel).
      const hitLevel = frame.engine?.hitLevel;
      const hitDimmer = gate && hitLevel !== undefined ? silenceGateDimmer(hitLevel, gate) : dimmer;
      const flowPhase = flow.advance(dtSec, frame.energy);
      bandEnergy.advance(dtSec, frame, rateScale, hitDimmer, hit?.shape);
      kickBand.advance(dtSec, frame.bands, getBandSplit().lowMid);
      hats = slewLevel(hats, frame.hats * dimmer, dtSec, rateScale);
      lead = slewLevel(lead, frame.lead * dimmer, dtSec, rateScale);
      const beatRatio = frame.engine?.surge ?? 0;
      // Tap tempo (tapTempo.ts's header). The seed lands before either
      // clock advances, so its phase is the tapped beat's at the previous
      // tick: this tick carries both clocks on to now, and a tapped beat
      // falling inside it ticks like any other. `bpmIn` is frame.bpm itself,
      // and the clock judges whole beats, unless a tap guides the tracker.
      const tap = tapNowMs !== undefined ? tapGuide.poll(tapNowMs - dtSec * 1000) : null;
      if (tap) {
        clock.seed(tap.bpm, tap.beatPhase, clockSec);
        metronome.seed(tap.bpm, tap.beatPhase, lastClockBeats);
      }
      const bpmIn = tapGuide.fold(frame.bpm);
      clock.setDivision(tapGuide.division);
      clockSec += dtSec;
      const engine = frame.engine;
      let phaseError: number | null = null;
      if (engine && engine.updates !== lastUpdates) {
        lastUpdates = engine.updates;
        phaseError = clock.follow(
          {
            bpm: bpmIn,
            music: engine.music,
            beatTime: clockSec - (frame.time - engine.beatTime),
            downbeatTime: clockSec - (frame.time - engine.downbeatTime),
            downbeatConfidence: engine.downbeatConfidence,
            updates: engine.updates,
          },
          clockSec,
        );
      }
      const c = clock.tick(clockSec, dtSec);
      lastClockBeats = c.beats;
      lockMeter.update(dtSec, c, phaseError, engine);
      const tempoLock = lockMeter.values[lockMeaning];
      metronome.advance(dtSec, { bpm: c.bpm, beats: c.beats, tempoLock }, bpmIn);
      tapGuide.follow(metronome.running, metronome.bpm);
      // beatTrim.ts's correction layer, one trimmer per clock — see that
      // file's header and this module's own AnimFrame field docs. Both
      // trimmers read the same settings snapshot this tick.
      const trim = getBeatTrim();
      const trimmed = clockTrim.advance(c.beats, c.bpm, trim);
      if (metronome.running && !wasRunning) {
        // The raw metronome itself just adopted clock.beats this same
        // tick (metronome.ts's own `beats = clock.beats`) — mirror that on
        // the corrected count before advancing metroTrim, and arm it so
        // that adoption jump isn't mistaken for beats actually crossed.
        metroTrim.adoptFrom(clockTrim);
        metroTrim.rearm();
      } else if (metronome.barMoved) {
        metroTrim.rearm();
      }
      const mt = metroTrim.advance(metronome.beats, metronome.bpm, trim);
      wasRunning = metronome.running;
      section.advance(dtSec, frame.energy, rateScale);
      profile.advance(dtSec, frame, { tempoLock, sectionIntensity: section.intensity }, rateScale);
      centroid.advance(dtSec, frame.bands, rateScale);

      // Raw hits — no grid. See AnimFrame.onset's own doc comment.
      const onset = bandEnergy.lowOnset || bandEnergy.midOnset || bandEnergy.highOnset;
      beatPulse *= Math.exp(-dtSec * BEAT_PULSE_DECAY_PER_SEC * rateScale * hitTail.beat);
      if (onset) {
        if (hit) {
          const graded = hitStrength(strongestPassed(bandEnergy), frame.level, hit.shape, beatHit);
          beatPulse = Math.max(beatPulse, graded.strength);
        } else {
          beatPulse = 1;
        }
      }
      metronomePulse *= Math.exp(-dtSec * BEAT_PULSE_DECAY_PER_SEC * rateScale * hitTail.beat);
      if (mt.beatTick) metronomePulse = 1;
      metronomeBarPulse *= Math.exp(-dtSec * BEAT_PULSE_DECAY_PER_SEC * rateScale * hitTail.beat);
      if (mt.barTick) metronomeBarPulse = 1;

      return {
        dtSec,
        timeSec: frame.time,
        flowPhase,
        beatPulse,
        onset,
        beatRatio,
        wavePeak,
        beatPhase: trimmed.beatPhase,
        barPhase: trimmed.barPhase,
        tempoLock,
        beats: trimmed.beats,
        tempoBpm: trimmed.bpm,
        low: bandEnergy.low,
        mid: bandEnergy.mid,
        high: bandEnergy.high,
        lowPulse: bandEnergy.lowPulse,
        midPulse: bandEnergy.midPulse,
        highPulse: bandEnergy.highPulse,
        hats,
        lead,
        lowOnset: bandEnergy.lowOnset,
        midOnset: bandEnergy.midOnset,
        highOnset: bandEnergy.highOnset,
        kickBand: kickBand.value * dimmer,
        kickBandIndex: kickBand.band,
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
        bpm: bpmIn * trim.multiplier,
        tapGuided: tapGuide.guided,
        metronomeOn: metronome.running,
        metronomeBpm: mt.bpm,
        metronomeBeats: mt.beats,
        metronomePhase: mt.beatPhase,
        metronomeBarPhase: mt.barPhase,
        metronomeLevel: metronome.level,
        metronomeBeat: metronome.running && mt.beatTick,
        metronomeBar: metronome.running && mt.barTick,
        metronomePulse,
        metronomeBarPulse,
        hitTail,
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
    lockReadings() {
      return lockMeter.values;
    },
  };
}
