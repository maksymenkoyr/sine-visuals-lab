import { NUM_BANDS, type FeatureFrame } from "./types.ts";

/**
 * Per-scene mic sensitivity, acceleration, and smoothing: three visual gain
 * stages on top of FeatureExtractor's auto-normalized [0,1] output. The
 * extractor's leaky floor/peak tracker already adapts to a room's
 * quiet/loud levels, so none of these is a gain-staging fix — they're a
 * user preference ("react harder" / "calm down", "more punch" / "flatter",
 * "snappier" / "smoother") remembered per scene, since each scene's shader
 * weights uEnergy/uBands differently.
 */

export const SENSITIVITY_MIN = 0.25;
export const SENSITIVITY_MAX = 4;
export const SENSITIVITY_DEFAULT = 1;

export const ACCELERATION_MIN = 0.25;
export const ACCELERATION_MAX = 4;
export const ACCELERATION_DEFAULT = 1;

export const SMOOTHING_MIN = 0.25;
export const SMOOTHING_MAX = 4;
export const SMOOTHING_DEFAULT = 1;

// In-memory cache is the source of truth for get/set within a session, seeded
// once from localStorage on module load. That keeps get/set correct even where
// localStorage is unavailable (node test env, Safari private mode) — only
// cross-reload persistence depends on it, not same-session behavior.
//
// legacyKey: if the storageKey has nothing saved yet but an old key (from a
// prior rename) does, migrate that data over once rather than losing it —
// see the Acceleration store below, migrating off "vibe.dynamics".
//
// Exported for src/audio/bandGains.ts, which uses the same per-scene
// float-in-localStorage shape for each of its stores.
export function createPerSceneSetting(
  storageKey: string,
  min: number,
  max: number,
  defaultValue: number,
  legacyKey?: string,
) {
  function loadInitial(): Record<string, number> {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
      }
      if (!legacyKey) return {};
      const legacyRaw = localStorage.getItem(legacyKey);
      if (!legacyRaw) return {};
      const legacyParsed = JSON.parse(legacyRaw);
      const migrated = legacyParsed && typeof legacyParsed === "object" ? legacyParsed : {};
      localStorage.setItem(storageKey, JSON.stringify(migrated));
      localStorage.removeItem(legacyKey);
      return migrated;
    } catch {
      return {};
    }
  }

  const cache: Record<string, number> = loadInitial();

  function persist(): void {
    try {
      localStorage.setItem(storageKey, JSON.stringify(cache));
    } catch {
      // Not fatal — the setting just won't persist across reloads.
    }
  }

  function clamp(value: number): number {
    if (!Number.isFinite(value)) return defaultValue;
    return Math.min(max, Math.max(min, value));
  }

  return {
    get(sceneId: string): number {
      const value = cache[sceneId];
      return typeof value === "number" ? clamp(value) : defaultValue;
    },
    set(sceneId: string, value: number): void {
      cache[sceneId] = clamp(value);
      persist();
    },
  };
}

const sensitivityStore = createPerSceneSetting(
  "vibe.sensitivity",
  SENSITIVITY_MIN,
  SENSITIVITY_MAX,
  SENSITIVITY_DEFAULT,
);
export const getSensitivity = sensitivityStore.get;
export const setSensitivity = sensitivityStore.set;

// "vibe.dynamics" is the storage key from this control's *first* name
// (Dynamics, later renamed to Contrast, now Acceleration) — migrated once
// via legacyKey rather than frozen in place a second time, so scenes tuned
// under either earlier name keep their saved values.
const accelerationStore = createPerSceneSetting(
  "vibe.acceleration",
  ACCELERATION_MIN,
  ACCELERATION_MAX,
  ACCELERATION_DEFAULT,
  "vibe.dynamics",
);
export const getAcceleration = accelerationStore.get;
export const setAcceleration = accelerationStore.set;

const smoothingStore = createPerSceneSetting("vibe.smoothing", SMOOTHING_MIN, SMOOTHING_MAX, SMOOTHING_DEFAULT);
export const getSmoothing = smoothingStore.get;
export const setSmoothing = smoothingStore.set;

/**
 * The sensitivity response curve applied to a single [0,1] level: out = in^(1/s).
 * Fixed at 0 and 1, so this reshapes detail in between rather than clipping
 * like a plain multiply would. s > 1 lifts quiet detail (more reactive);
 * s < 1 pushes it down (calmer). Shared by applySensitivity (render path) and
 * the device menu's level wash (UI path) so the two can't drift.
 */
export function shapeLevel(level: number, sensitivity: number): number {
  return Math.pow(level, 1 / sensitivity);
}

// Steepness at the far ends of the slider. 3 puts 4× at roughly the old
// pow-based curve's overall strength, so per-scene values saved under that
// curve still feel about right after the swap.
const ACCELERATION_K = 3;

/**
 * The acceleration response curve: a tanh S-curve pivoting at the midpoint
 * (0.5). Unlike shapeLevel (which lifts or lowers everything together), this
 * pushes values *above* the midpoint higher and values *below* it lower —
 * widening the gap between quiet and loud, so the visual response ramps
 * more sharply as the music gets louder — at intensity `acceleration`.
 * Fixed at 0, 0.5, and 1. acceleration > 1 widens the gap (more punch);
 * acceleration < 1 narrows it (flatter, more compressed); 1 is identity.
 *
 * Chosen over a plain power curve (the old shapeDynamics) because a power
 * curve has infinite slope right at the pivot: a level drifting across 0.5
 * slams from one side to the other. tanh has a finite, steepest-at-the-middle
 * slope that tapers smoothly into both ends instead.
 */
export function shapeAcceleration(level: number, acceleration: number): number {
  const s = Math.log(acceleration); // 0 at 1x -> identity
  if (Math.abs(s) < 1e-6) return level;
  const k = Math.abs(s) * ACCELERATION_K;
  const half = Math.tanh(k / 2);
  if (s > 0) {
    // > 1x expands: steep-but-finite through the pivot, easing into 0 and 1.
    return 0.5 + Math.tanh(k * (level - 0.5)) / (2 * half);
  }
  // < 1x compresses: the exact inverse of the expand branch, so e.g. 2x
  // followed by 0.5x undoes back to the original level. shapeLevel's
  // Math.pow can feed this values slightly outside [0,1], which would send
  // atanh's argument out of (-1, 1) — clamp to keep it finite.
  const c = (2 * level - 1) * half;
  return 0.5 + Math.atanh(Math.min(1 - 1e-12, Math.max(-1 + 1e-12, c))) / k;
}

/**
 * Smoothing scales every visual envelope's decay/slew rate — how fast the
 * visuals chase the audio, independent of Sensitivity's gain and
 * Acceleration's curve. The slow half (smoothing > 1) is linear: 4x smoothing means
 * quarter-rate, so a scene fully settles into a calm swell. The fast half
 * is square-rooted instead of linear: at 0.25x this is only 2x the rate,
 * not 4x. That asymmetry is deliberate, not stylistic — the level slew this
 * feeds (bandEnergy.ts's LEVEL_SLEW_PER_SEC) doubles as the strobe guard
 * that keeps geometry-driving uniforms from jumping most of the way to a
 * new value in one frame, so "snappier" gets a shorter leash than
 * "smoother". Continuous at 1x (both branches equal 1 there).
 */
export function smoothingRateScale(smoothing: number): number {
  return smoothing >= 1 ? 1 / smoothing : 1 / Math.sqrt(smoothing);
}

// Reused across calls to avoid a per-frame allocation in the render loop.
const scratchBands = new Float32Array(NUM_BANDS);

/**
 * Applies the sensitivity gain and then the acceleration curve to a frame's
 * [0,1] band/energy values. beat/bpm/beatPhase/time/level pass through
 * untouched — both are a visual gain, not a beat-detection threshold, and
 * `level` specifically must stay the raw, un-gained reading: it's auto
 * mode's input signal for driving these very sliders (see musicProfile.ts),
 * so shaping it here would feed the gain stage its own output.
 */
export function applySensitivity(frame: FeatureFrame, sensitivity: number, acceleration: number): FeatureFrame {
  if (sensitivity === SENSITIVITY_DEFAULT && acceleration === ACCELERATION_DEFAULT) return frame;

  for (let b = 0; b < NUM_BANDS; b++) {
    scratchBands[b] = shapeAcceleration(shapeLevel(frame.bands[b], sensitivity), acceleration);
  }

  return {
    time: frame.time,
    bands: scratchBands,
    energy: shapeAcceleration(shapeLevel(frame.energy, sensitivity), acceleration),
    beat: frame.beat,
    bpm: frame.bpm,
    beatPhase: frame.beatPhase,
    level: frame.level,
  };
}
