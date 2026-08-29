import { NUM_BANDS, type FeatureFrame } from "../audio/types.ts";

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
  advance(dtSec: number, frame: FeatureFrame, inputs: ProfileInputs): void;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0.5;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function ease(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * Math.min(1, rate * dt);
}

// How fast each dial eases toward its latest measurement. All slow on
// purpose — these describe the track, not the instant (see file header).
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
// swing, not one section change.
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
    advance(dtSec: number, frame: FeatureFrame, inputs: ProfileInputs): void {
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

      // --- pulse ---
      onsetRate *= Math.exp(-dt * ONSET_RATE_DECAY);
      if (frame.beat) onsetRate += 1;
      const pulseTarget = hasSignal
        ? clamp01(0.4 * clamp01(onsetRate / ONSET_RATE_REF) + 0.6 * tempoLock)
        : 0.5;
      pulse = ease(pulse, pulseTarget, PULSE_EASE_RATE, dt);
      targets.pulse = pulseTarget;

      // --- tempo ---
      const bpmNorm = clamp01((frame.bpm - BPM_LOW) / (BPM_HIGH - BPM_LOW));
      const tempoTarget = 0.5 + (bpmNorm - 0.5) * tempoLock; // folds toward neutral while unlocked
      tempo = ease(tempo, tempoTarget, TEMPO_EASE_RATE, dt);
      targets.tempo = tempoTarget;

      // --- brightness (spectral centroid) & density (active-band fraction) ---
      const brightnessTarget = bandSum > 1e-4 ? clamp01(weightedSum / bandSum / (NUM_BANDS - 1)) : 0.5;
      brightness = ease(brightness, brightnessTarget, BRIGHTNESS_EASE_RATE, dt);
      targets.brightness = brightnessTarget;

      let densityTarget = 0.5;
      if (hasSignal) {
        let active = 0;
        const threshold = peak * ACTIVE_FRACTION;
        for (let b = 0; b < NUM_BANDS; b++) if (frame.bands[b] > threshold) active++;
        densityTarget = clamp01(active / NUM_BANDS);
      }
      density = ease(density, densityTarget, DENSITY_EASE_RATE, dt);
      targets.density = densityTarget;

      // --- dynamics ---
      const intensity = clamp01(inputs.sectionIntensity);
      dynMean += (intensity - dynMean) * Math.min(1, DYNAMICS_MEAN_RATE * dt);
      dynMad += (Math.abs(intensity - dynMean) - dynMad) * Math.min(1, DYNAMICS_MAD_RATE * dt);
      const dynamicsTarget = hasSignal ? clamp01(dynMad / DYNAMICS_MAD_REF) : 0.5;
      dynamics = ease(dynamics, dynamicsTarget, DYNAMICS_EASE_RATE, dt);
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

        fluxFast += (flux - fluxFast) * Math.min(1, FLUX_FAST_RATE * dt);
        fluxSlow += (flux - fluxSlow) * Math.min(1, FLUX_SLOW_RATE * dt);
        const ratio = fluxSlow > 1e-4 ? fluxFast / fluxSlow : 1;
        const attackTarget = hasSignal ? clamp01((ratio - 1) / (ATTACK_REF - 1)) : 0.5;
        attack = ease(attack, attackTarget, ATTACK_EASE_RATE, dt);
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
        loudness = ease(loudness, loudnessTarget, LOUDNESS_EASE_RATE, dt);
        targets.loudness = loudnessTarget;
      }

      (state as { pulse: number }).pulse = pulse;
      (state as { tempo: number }).tempo = tempo;
      (state as { brightness: number }).brightness = brightness;
      (state as { density: number }).density = density;
      (state as { dynamics: number }).dynamics = dynamics;
      (state as { attack: number }).attack = attack;
      (state as { loudness: number }).loudness = loudness;
    },
  };

  return state;
}
