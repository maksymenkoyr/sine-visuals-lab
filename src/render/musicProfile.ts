import { NUM_BANDS, type FeatureFrame } from "../audio/types.ts";
import { warmRate } from "../audio/warmStart.ts";

/**
 * Describes *the track*, not the current instant — the continuous [0,1]
 * dials in MUSIC_DIALS, each easing toward its latest measurement over a long (multi-
 * second to half-minute) window so a single loud drum fill or one quiet bar
 * doesn't masquerade as a change in what's playing. Every dial starts at,
 * and holds at while there's nothing to measure, NEUTRAL (0.5) — so cold
 * start and silence both read as "unremarkable" rather than pinning to an
 * extreme. This is what autoTune.ts multiplies against each SceneSetting's
 * weights; see that file for why all-dials-neutral must resolve to a
 * setting's plain default.
 *
 * `loudness` is the one deliberate exception to "holds at NEUTRAL through
 * silence": it describes a state (how loud the room is right now), not a
 * trait of the track, so on silence it FREEZES at its last reading instead
 * of easing back to 0.5 — see its handling below.
 *
 * Derived from FeatureFrame plus the beat/section clocks animClock.ts
 * already computes from the same frame. `loudness` reads FeatureFrame.level
 * directly — the one field that survives features.ts's adaptive floor/peak
 * AGC — so this produces identical dials whether frames arrive from a local
 * mic or a relayed room feed.
 *
 * Every dial ease below, plus the DYNAMICS_MEAN_RATE/DYNAMICS_MAD_RATE
 * trackers dynamics rides on, runs its steady-state rate through
 * src/audio/warmStart.ts's warmRate() first, keyed off `signalSec` — seconds
 * of actual signal this profile has seen (see hasSignal/the increment at the
 * end of advance()), not wall-clock time, so a stretch of silence never
 * "uses up" the warm-up. This doesn't change what a dial does through
 * silence — it still holds at NEUTRAL exactly as before — or how it behaves
 * once settled: the steady-state rates above are exactly what shipped, just
 * no longer also standing in for a start-up rate. All warmRate() shortens is
 * how long a fresh session (or one just past a silent stretch) takes to
 * catch up to the track, the same fix autoGain.ts's own EASE_RATE got.
 */
export type MusicDial = "pulse" | "tempo" | "brightness" | "density" | "dynamics" | "attack" | "loudness";

export const MUSIC_DIALS: readonly MusicDial[] = [
  "pulse",
  "tempo",
  "brightness",
  "density",
  "dynamics",
  "attack",
  "loudness",
];

export type DialValues = Record<MusicDial, number>;

/** Plain-language name and one-line explanation per dial, for the meters in
 *  src/ui/audioMeters.ts. Keyed by MusicDial so a new dial can't ship
 *  without its copy. The derivations these describe are commented below. */
export const DIAL_LABELS: Readonly<Record<MusicDial, { label: string; description: string }>> = {
  pulse: {
    label: "Pulse",
    description: "How steadily the beat is hitting. These dials are what Auto listens to.",
  },
  tempo: {
    label: "Tempo",
    description: "Slow to fast on a dance-music scale — the middle is house tempo.",
  },
  brightness: {
    label: "Brightness",
    description: "Dark and bassy to bright and airy.",
  },
  density: {
    label: "Density",
    description: "Sparse and open to wall-of-sound busy.",
  },
  dynamics: {
    label: "Dynamics",
    description: "Flat and even to big swings between quiet and loud.",
  },
  attack: {
    label: "Attack",
    description: "Soft swells to sharp hits.",
  },
  loudness: {
    label: "Loudness",
    description: "How loud the room is right now — the one dial that keeps its last reading through silence.",
  },
};

export const NEUTRAL: Readonly<DialValues> = {
  pulse: 0.5,
  tempo: 0.5,
  brightness: 0.5,
  density: 0.5,
  dynamics: 0.5,
  attack: 0.5,
  loudness: 0.5,
};

/** The pieces of the other renderer-side clocks this needs, passed in
 *  rather than recomputed — animClock.ts already derives both from the
 *  same frame this advance() call receives. */
export interface ProfileInputs {
  /** beatClock's tempoLock: ramps in while a tempo is held, out with no beat. */
  tempoLock: number;
  /** sectionIntensity's phrase-level loudness trend. */
  sectionIntensity: number;
}

export interface MusicProfile extends DialValues {
  /** This tick's pre-ease measurement for every dial — what each `ease()`
   *  call above is chasing, before the multi-second smoothing. attack holds
   *  NEUTRAL on the un-primed first frame (no flux to measure yet); loudness
   *  freezes at its last target through silence, matching the dial itself
   *  (see the loudness comment below). For the meters panel's RAW chip
   *  (src/ui/audioMeters.ts). */
  readonly targets: DialValues;
  /** rateScale multiplies every PULSE_EASE_RATE..LOUDNESS_EASE_RATE ease
   *  below only — sensitivity.ts's smoothingRateScale, defaulting to 1
   *  (today's behavior). The internal trackers (onsetRate, dynMean/dynMad,
   *  fluxFast/fluxSlow) stay at their own fixed rates regardless: they feed
   *  `targets`, which the meters panel's RAW chip already shows unsmoothed.
   *  Non-finite (Smoothing's Off stop) makes every dial land exactly on its
   *  target — see ease() below. */
  advance(dtSec: number, frame: FeatureFrame, inputs: ProfileInputs, rateScale?: number): void;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0.5;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// Non-finite scale (Smoothing's Off stop, see sensitivity.ts's
// smoothingRateScale) assigns `target` directly rather than computing a
// Math.min(1, rate*dt*scale) coefficient of 1 — `current + (target -
// current) * 1` isn't always bit-identical to `target` in IEEE754, and the
// meters panel's RAW chip (audioMeters.ts) reads `targets` directly, so Off
// must make the eased dial land on exactly the same value, not merely close.
function ease(current: number, target: number, rate: number, dt: number, scale: number): number {
  if (!Number.isFinite(scale)) return target;
  return current + (target - current) * Math.min(1, rate * dt * scale);
}

// How fast each dial eases toward its latest measurement, once warmed up.
// All slow on purpose — these describe the track, not the instant (see file
// header) — and all run through warmRate() in advance() below, so a fresh
// profile (or one just past a silent stretch) starts faster than this and
// eases into exactly this rate as `signalSec` grows.
const PULSE_EASE_RATE = 0.3; // ~3s
const TEMPO_EASE_RATE = 0.15; // ~7s — bpm lock is already gated by tempoLock below
const BRIGHTNESS_EASE_RATE = 0.2; // ~5s
const DENSITY_EASE_RATE = 0.2; // ~5s
const DYNAMICS_EASE_RATE = 0.08; // ~12s, stacked on an already-slow MAD estimator
const ATTACK_EASE_RATE = 0.25; // ~4s
const LOUDNESS_EASE_RATE = 0.3; // ~3s — faster than the others on purpose: a
// state (how loud is it right now), not a slow-to-establish trait of the track.

// pulse: blends how often onsets are firing with how confidently they've
// locked to a steady tempo. tempoLock already *is* a regularity signal — it
// only ramps up while beatClock keeps re-confirming the same interval —
// so this doesn't need its own IOI-variance calculation.
const ONSET_RATE_DECAY = 2.5; // per second, leaky onset-density tracker
const ONSET_RATE_REF = 1.0; // steady-state value for a beat holding around ~150bpm

// tempo: bpm normalized across a dance-music range, folded toward NEUTRAL
// while unlocked so a momentary bad guess doesn't push the dial to an
// extreme — the same spirit as FeatureExtractor folding octave errors.
const BPM_LOW = 70;
const BPM_HIGH = 180;

// density: fraction of the 24 bands sitting within ACTIVE_FRACTION of the
// frame's own peak band. A solo instrument lights up a handful of bands; a
// full mix lights up most of them, regardless of overall loudness.
const ACTIVE_FRACTION = 0.35;

// Shared silence gate: below this peak-band level there's nothing to
// measure. brightness/density fall back to their own neutral targets below
// this threshold; pulse/dynamics/attack additionally use it (see hasSignal)
// so all three hold at NEUTRAL through genuine silence instead of reading
// "no signal" as an extreme (no pulse, fully compressed, no attack).
const SILENCE_PEAK = 0.03;

// dynamics: leaky mean + mean-absolute-deviation of sectionIntensity, the
// same leaky-estimator shape used everywhere else in this codebase instead
// of a ring buffer. The MAD rate is deliberately slower than
// sectionIntensity's own floor/ceiling so this reflects a whole song's
// swing, not one section change. Both rates are steady-state, like the
// dial eases above — advance() runs them through warmRate() too, so these
// two trackers also warm up fast rather than crawling up from 0 for their
// own ~10s/~25s.
const DYNAMICS_MEAN_RATE = 0.1; // ~10s
const DYNAMICS_MAD_RATE = 0.04; // ~25s
const DYNAMICS_MAD_REF = 0.16; // MAD at/above this reads as "fully dynamic"

// attack: fast/slow envelope pair over summed positive band-to-band flux —
// the same flux features.ts computes for onset detection, recomputed here
// from FeatureFrame.bands rather than threaded through the wire frame (see
// file header). A transient-heavy track keeps flashing fast above its own
// slow floor; a sustained one doesn't.
const FLUX_FAST_RATE = 6; // ~0.17s, tracks the moment
const FLUX_SLOW_RATE = 0.5; // ~2s, tracks the sustained floor
const ATTACK_REF = 1.4; // fastFlux/slowFlux ratio that reads as "fully percussive"

export function createMusicProfile(): MusicProfile {
  let pulse = 0.5;
  let tempo = 0.5;
  let brightness = 0.5;
  let density = 0.5;
  let dynamics = 0.5;
  let attack = 0.5;
  let loudness = 0.5;

  let onsetRate = 0;
  let dynMean = 0;
  let dynMad = 0;
  let fluxFast = 0;
  let fluxSlow = 0;
  const prevBands = new Float32Array(NUM_BANDS);
  let primed = false;
  // Seconds of actual signal this profile has seen — advances only on ticks
  // where hasSignal is true (see the increment at the end of advance()), so
  // a stretch of silence never counts toward warming up. Feeds every
  // warmRate() call below; see the file header for why elapsed-signal-time
  // rather than wall-clock time.
  let signalSec = 0;
  const targets: DialValues = {
    pulse: 0.5,
    tempo: 0.5,
    brightness: 0.5,
    density: 0.5,
    dynamics: 0.5,
    attack: 0.5,
    loudness: 0.5,
  };

  const state: MusicProfile = {
    pulse,
    tempo,
    brightness,
    density,
    dynamics,
    attack,
    loudness,
    targets,
    advance(dtSec: number, frame: FeatureFrame, inputs: ProfileInputs, rateScale = 1): void {
      const dt = Math.max(1e-4, dtSec);
      const tempoLock = clamp01(inputs.tempoLock);

      let bandSum = 0;
      let weightedSum = 0;
      let peak = 0;
      for (let b = 0; b < NUM_BANDS; b++) {
        const v = frame.bands[b];
        bandSum += v;
        weightedSum += b * v;
        if (v > peak) peak = v;
      }
      const hasSignal = peak > SILENCE_PEAK;
      // Read before this tick's increment (at the end of advance()) so every
      // warmRate() call below — and dynMean/dynMad's own — sees the same
      // elapsed-signal-time, not a value that crept forward mid-tick.
      const warmSec = signalSec;

      // --- pulse ---
      onsetRate *= Math.exp(-dt * ONSET_RATE_DECAY);
      if (frame.onset) onsetRate += 1;
      const pulseTarget = hasSignal
        ? clamp01(0.4 * clamp01(onsetRate / ONSET_RATE_REF) + 0.6 * tempoLock)
        : 0.5;
      pulse = ease(pulse, pulseTarget, warmRate(PULSE_EASE_RATE, warmSec), dt, rateScale);
      targets.pulse = pulseTarget;

      // --- tempo ---
      const bpmNorm = clamp01((frame.bpm - BPM_LOW) / (BPM_HIGH - BPM_LOW));
      const tempoTarget = 0.5 + (bpmNorm - 0.5) * tempoLock; // folds toward neutral while unlocked
      tempo = ease(tempo, tempoTarget, warmRate(TEMPO_EASE_RATE, warmSec), dt, rateScale);
      targets.tempo = tempoTarget;

      // --- brightness (spectral centroid) & density (active-band fraction) ---
      const brightnessTarget = bandSum > 1e-4 ? clamp01(weightedSum / bandSum / (NUM_BANDS - 1)) : 0.5;
      brightness = ease(brightness, brightnessTarget, warmRate(BRIGHTNESS_EASE_RATE, warmSec), dt, rateScale);
      targets.brightness = brightnessTarget;

      let densityTarget = 0.5;
      if (hasSignal) {
        let active = 0;
        const threshold = peak * ACTIVE_FRACTION;
        for (let b = 0; b < NUM_BANDS; b++) if (frame.bands[b] > threshold) active++;
        densityTarget = clamp01(active / NUM_BANDS);
      }
      density = ease(density, densityTarget, warmRate(DENSITY_EASE_RATE, warmSec), dt, rateScale);
      targets.density = densityTarget;

      // --- dynamics ---
      const intensity = clamp01(inputs.sectionIntensity);
      dynMean += (intensity - dynMean) * Math.min(1, warmRate(DYNAMICS_MEAN_RATE, warmSec) * dt);
      dynMad += (Math.abs(intensity - dynMean) - dynMad) * Math.min(1, warmRate(DYNAMICS_MAD_RATE, warmSec) * dt);
      const dynamicsTarget = hasSignal ? clamp01(dynMad / DYNAMICS_MAD_REF) : 0.5;
      dynamics = ease(dynamics, dynamicsTarget, warmRate(DYNAMICS_EASE_RATE, warmSec), dt, rateScale);
      targets.dynamics = dynamicsTarget;

      // --- attack ---
      if (!primed) {
        prevBands.set(frame.bands);
        primed = true;
        targets.attack = 0.5; // no flux measurement yet
      } else {
        let flux = 0;
        for (let b = 0; b < NUM_BANDS; b++) flux += Math.max(0, frame.bands[b] - prevBands[b]);
        prevBands.set(frame.bands);
        flux /= NUM_BANDS;

        // FLUX_FAST_RATE/FLUX_SLOW_RATE stay bare — already fast (~0.17s/~2s,
        // see their own comments above), so no warm-up fix applies here.
        fluxFast += (flux - fluxFast) * Math.min(1, FLUX_FAST_RATE * dt);
        fluxSlow += (flux - fluxSlow) * Math.min(1, FLUX_SLOW_RATE * dt);
        const ratio = fluxSlow > 1e-4 ? fluxFast / fluxSlow : 1;
        const attackTarget = hasSignal ? clamp01((ratio - 1) / (ATTACK_REF - 1)) : 0.5;
        attack = ease(attack, attackTarget, warmRate(ATTACK_EASE_RATE, warmSec), dt, rateScale);
        targets.attack = attackTarget;
      }

      // --- loudness ---
      // Unlike every other dial, this does NOT fall back to a neutral target
      // through silence — genuine silence really is quiet, and easing toward
      // 0.5 (or 0) between tracks would yank the mic block's auto values
      // around for no musical reason. Just hold the last reading — and hold
      // targets.loudness too, so RAW mode doesn't contradict that freeze.
      if (hasSignal) {
        const loudnessTarget = clamp01(frame.level);
        loudness = ease(loudness, loudnessTarget, warmRate(LOUDNESS_EASE_RATE, warmSec), dt, rateScale);
        targets.loudness = loudnessTarget;
      }

      // Advance signal-time only now that every warmRate() call above has
      // read `warmSec` — and only on a tick that actually had signal, so a
      // silent stretch never counts toward warming up (see the file header
      // and `signalSec`'s own comment above).
      if (hasSignal) signalSec += dt;

      state.pulse = pulse;
      state.tempo = tempo;
      state.brightness = brightness;
      state.density = density;
      state.dynamics = dynamics;
      state.attack = attack;
      state.loudness = loudness;
    },
  };

  return state;
}
