import type { SceneSetting } from "./sceneSettings.ts";
import { getSceneSetting } from "./sceneSettings.ts";
import {
  ACCELERATION_DEFAULT,
  ACCELERATION_MAX,
  ACCELERATION_MIN,
  getAcceleration,
  getSensitivity,
  getSmoothing,
  SENSITIVITY_DEFAULT,
  SENSITIVITY_MAX,
  SENSITIVITY_MIN,
  shapeAcceleration,
  SMOOTHING_DEFAULT,
  SMOOTHING_MAX,
  SMOOTHING_MIN,
} from "../audio/sensitivity.ts";
import { MUSIC_DIALS, NEUTRAL, type DialValues, type MusicDial } from "./musicProfile.ts";
import { getOverride, isAutoPinned } from "../tuning/overrides.ts";
import { getPin } from "../tuning/pins.ts";

/**
 * Layers "let the music pick a good value" on top of sceneSettings.ts's
 * manual store, without replacing it. See musicProfile.ts for the dials
 * in MUSIC_DIALS this reads and the file header there for why "everything
 * neutral" must reproduce a setting's plain default.
 *
 * Auto state is stored as exceptions: vibe.sceneAuto only ever lists the
 * params a user has taken MANUAL control of. A key absent from the store —
 * including every key on a scene added after this feature shipped — is
 * auto by default. That's the whole mechanism behind "a new scene's
 * sliders are auto from the first run with no extra work."
 *
 * A SceneSetting's `macro` field is the same displacement shape as `auto`,
 * aimed at another setting instead of the music profile: computeMacroTarget
 * mirrors computeAutoTarget exactly, with the driver's live value standing
 * in for a dial reading, and the same "driver at its own default -> exactly
 * spec.default" identity at rest. It shares this module's exceptions store
 * and slew, so dragging a macro-driven setting "goes manual" the same way
 * dragging an auto one does — see resolve() below.
 */

// Weight-authoring convention (see the `auto:` tables in caustics.ts and
// meshGrid.ts): keep |weight| in ~0.15..0.5 and the per-setting sum of
// |weight| under ~0.8. Not enforced in code — just keeps deviations from
// feeling like a different scene entirely.
//
// That "|weight| under 0.8 -> +/-40% of range" arithmetic only holds for a
// dial pinned at a true 0 or 1, which real music essentially never produces
// (musicProfile.ts's dials sit close to 0.5 most of the time — even its own
// synthetic-extreme tests only assert >0.6/<0.4). Left alone, a typical
// track's deviation from a mid-range dial reading was landing under one
// slider step — invisible. DIAL_EXPAND below (applied in computeAutoTarget)
// compensates by pushing a real-world dial reading further from 0.5 before
// it's weighted, so the same weight table now produces a genuinely visible
// swing on ordinary music, not just on synthetic extremes.
export type AutoWeights = Partial<Record<MusicDial, number>>;

// Expansion applied to each dial before weighting — see the comment above.
// Uses shapeAcceleration (audio/sensitivity.ts) because it's already exactly
// the right shape for this: an S-curve fixed at 0/0.5/1 with a finite (not
// infinite) slope through the pivot, so shapeAcceleration(0.5, k) === 0.5
// always holds — preserving the "all dials neutral -> spec.default exactly"
// invariant this whole module rests on regardless of the expansion factor.
const DIAL_EXPAND = 2.5;

const STORAGE_KEY_EXCEPTIONS = "vibe.sceneAuto";
const STORAGE_KEY_STRENGTH = "vibe.autoStrength";

export const AUTO_STRENGTH_MIN = 0;
export const AUTO_STRENGTH_MAX = 2;
export const AUTO_STRENGTH_DEFAULT = 1;

/** Reserved settings keys for the Sensitivity/Acceleration/Smoothing pseudo-
 *  params — can't collide with a real SceneSetting.key, which must be a
 *  valid GLSL identifier tail. */
export const SENSITIVITY_AUTO_KEY = "@sensitivity";
export const ACCELERATION_AUTO_KEY = "@acceleration";
export const SMOOTHING_AUTO_KEY = "@smoothing";

// The auto key from this control's previous name — see the migration in
// loadExceptions() below, and the parallel legacyKey migration for the
// manual-value store in audio/sensitivity.ts.
const LEGACY_CONTRAST_AUTO_KEY = "@contrast";

const SENSITIVITY_SPEC: SceneSetting = {
  key: SENSITIVITY_AUTO_KEY,
  label: "Sensitivity",
  min: SENSITIVITY_MIN,
  max: SENSITIVITY_MAX,
  step: 0.05,
  default: SENSITIVITY_DEFAULT,
  // Conservative on purpose — applySensitivity's gamma curve sits on top of
  // features.ts's own per-band adaptive floor/peak AGC, so this is nudging
  // an already self-correcting signal, not doing gain-staging from scratch.
  // A compressed, dense master is already pinned near the top of the AGC
  // range, so lift less; a sparse, dynamic track has headroom worth
  // lifting into.
  //
  // `loudness` (FeatureFrame.level, the one signal that survives the AGC —
  // see musicProfile.ts) is the dominant term and deliberately negative: a
  // quiet room should react harder (lift sensitivity), a loud room should
  // back off. Without it, this spec had nothing that could tell a quiet room
  // from a loud one at all — dynamics/density both measure shape, not level.
  auto: { loudness: -0.5, dynamics: 0.25, density: -0.2 },
};

const ACCELERATION_SPEC: SceneSetting = {
  key: ACCELERATION_AUTO_KEY,
  label: "Acceleration",
  min: ACCELERATION_MIN,
  max: ACCELERATION_MAX,
  step: 0.05,
  default: ACCELERATION_DEFAULT,
  // Acceleration widens/narrows the gap between quiet and loud
  // (shapeAcceleration's S-curve). A track that's already dynamic (big macro
  // swings) needs less artificial acceleration piled on top; a compressed,
  // flat one benefits from more to recover some perceived punch. Negative
  // weight on the same `dynamics` dial as Sensitivity's positive one is
  // deliberate — the two pull in opposite directions on purpose, they're not
  // redundant.
  //
  // Also negative on `loudness`, same reasoning as Sensitivity above: a
  // quiet room gets more acceleration to recover punch, a loud one gets less.
  auto: { loudness: -0.3, dynamics: -0.25 },
};

const SMOOTHING_SPEC: SceneSetting = {
  key: SMOOTHING_AUTO_KEY,
  label: "Smoothing",
  min: SMOOTHING_MIN,
  max: SMOOTHING_MAX,
  step: 0.05,
  default: SMOOTHING_DEFAULT,
  // Smoothing scales how fast the visuals chase the audio (bandEnergy.ts's
  // level slew and pulse decay, animClock.ts's beat flash decay — see
  // smoothingRateScale). A percussive track (high `attack`) reads better
  // snappier; a steady, unlocked one (low `tempo`) reads better smoother so
  // it doesn't look jittery with nothing to lock onto.
  auto: { attack: -0.3, tempo: -0.15 },
};

type ExceptionStore = Record<string, Record<string, false>>;

// One-time rewrite of the old "@contrast" auto-exception key to
// "@acceleration", in place, on whatever shape loadExceptions() handed back.
// Skipping this would silently flip any scene where Contrast had been set to
// manual back to auto after the rename — the exception simply wouldn't be
// found under its new key. Returns whether anything changed, so the caller
// can persist the rewritten shape immediately rather than re-migrating (a
// no-op, but wasted work) on every future load.
function migrateContrastKey(store: ExceptionStore): boolean {
  let changed = false;
  for (const sceneId of Object.keys(store)) {
    const sceneExceptions = store[sceneId];
    if (!(LEGACY_CONTRAST_AUTO_KEY in sceneExceptions)) continue;
    sceneExceptions[ACCELERATION_AUTO_KEY] = sceneExceptions[LEGACY_CONTRAST_AUTO_KEY];
    delete sceneExceptions[LEGACY_CONTRAST_AUTO_KEY];
    changed = true;
  }
  return changed;
}

function loadExceptions(): ExceptionStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_EXCEPTIONS);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    if (migrateContrastKey(parsed)) localStorage.setItem(STORAGE_KEY_EXCEPTIONS, JSON.stringify(parsed));
    return parsed;
  } catch {
    return {};
  }
}

function loadStrength(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_STRENGTH);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) ? clampStrength(value) : AUTO_STRENGTH_DEFAULT;
  } catch {
    return AUTO_STRENGTH_DEFAULT;
  }
}

function clampStrength(value: number): number {
  if (!Number.isFinite(value)) return AUTO_STRENGTH_DEFAULT;
  return Math.min(AUTO_STRENGTH_MAX, Math.max(AUTO_STRENGTH_MIN, value));
}

const exceptions: ExceptionStore = loadExceptions();
let strength = loadStrength();

function persistExceptions(): void {
  try {
    localStorage.setItem(STORAGE_KEY_EXCEPTIONS, JSON.stringify(exceptions));
  } catch {
    // Not fatal — auto/manual choices just won't persist across reloads.
  }
}

function persistStrength(): void {
  try {
    localStorage.setItem(STORAGE_KEY_STRENGTH, String(strength));
  } catch {
    // Not fatal — see persistExceptions.
  }
}

/** True unless this exact (scene, key) pair was explicitly set to manual. */
export function isAutoEnabled(sceneId: string, key: string): boolean {
  return exceptions[sceneId]?.[key] !== false;
}

export function setAutoEnabled(sceneId: string, key: string, on: boolean): void {
  if (on) {
    delete exceptions[sceneId]?.[key];
    if (exceptions[sceneId] && Object.keys(exceptions[sceneId]).length === 0) delete exceptions[sceneId];
  } else {
    (exceptions[sceneId] ??= {})[key] = false;
  }
  persistExceptions();
}

/** Whether every auto-capable setting on this scene is currently auto —
 *  drives the scene's master toggle. Settings with neither an `auto` nor a
 *  `macro` field can't be toggled, so they don't count against it. Pass
 *  Sensitivity/Acceleration/Smoothing specs alongside a scene's own settings
 *  if the master toggle should cover them too (see app.ts). */
export function isSceneAuto(sceneId: string, specs: readonly SceneSetting[]): boolean {
  const relevant = specs.filter((s) => s.auto || s.macro);
  return relevant.length > 0 && relevant.every((s) => isAutoEnabled(sceneId, s.key));
}

export function setSceneAuto(sceneId: string, specs: readonly SceneSetting[], on: boolean): void {
  for (const s of specs) if (s.auto || s.macro) setAutoEnabled(sceneId, s.key, on);
}

export function getAutoStrength(): number {
  return strength;
}

export function setAutoStrength(value: number): void {
  strength = clampStrength(value);
  persistStrength();
}

function clampToSpec(spec: SceneSetting, value: number): number {
  if (!Number.isFinite(value)) return spec.default;
  return Math.min(spec.max, Math.max(spec.min, value));
}

/**
 * Pure resolution formula: how far this setting should sit from its default
 * given the current music profile. At every dial = 0.5 (NEUTRAL) the sum is
 * exactly 0, so this returns spec.default bit-for-bit — the property that
 * makes auto safe to ship on by default for an already-tuned scene.
 */
export function computeAutoTarget(spec: SceneSetting, profile: DialValues, autoStrength: number): number {
  if (!spec.auto) return spec.default;
  let deviation = 0;
  for (const dial of MUSIC_DIALS) {
    const w = spec.auto[dial];
    if (w === undefined) continue;
    deviation += w * (shapeAcceleration(profile[dial], DIAL_EXPAND) - 0.5);
  }
  const raw = spec.default + autoStrength * deviation * (spec.max - spec.min);
  return clampToSpec(spec, raw);
}

/**
 * Same shape as computeAutoTarget, but displaced by a driver setting's value
 * instead of the music profile. At driverValue === spec.macro.driver.default
 * the displacement term is exactly 0, so this returns spec.default
 * bit-for-bit — same identity-at-rest property, same reason it's safe to
 * ship auto-following by default.
 */
export function computeMacroTarget(spec: SceneSetting, driverValue: number): number {
  const m = spec.macro;
  if (!m) return spec.default;
  const deviation = m.weight * (driverValue - m.driver.default);
  const raw = spec.default + deviation * (spec.max - spec.min);
  return clampToSpec(spec, raw);
}

// Glides the resolved value toward its target over a few seconds so a
// section change reads as a swell, not a snap — the same reasoning as
// sectionIntensity.ts's INTENSITY_SLEW. ~2s time constant.
const AUTO_SLEW_RATE = 0.5;

let latestDt = 1 / 60;
let latestProfile: DialValues = { ...NEUTRAL };
const slewed = new Map<string, number>();

function slewKey(sceneId: string, key: string): string {
  return `${sceneId}/${key}`;
}

/** Advances the shared music profile snapshot every scene's resolve() reads
 *  from. Call once per rAF tick from app.ts / tv.ts — NOT from inside
 *  animClock.ts, since gallery preview tiles each run their own AnimClock
 *  and would otherwise slew this singleton N times too fast. */
export function advanceAutoTune(dtSec: number, profile: DialValues): void {
  latestDt = Math.max(1e-4, dtSec);
  latestProfile = profile;
}

function resolve(sceneId: string, spec: SceneSetting, manualValue: number): number {
  // Dev-only tuning override — see tuning/overrides.ts. Wrapped in DEV so a
  // prod build never pays for the check and the override module tree-shakes
  // out entirely (Vite replaces import.meta.env.DEV with a literal false).
  // A pin (tuning/pins.ts — a typed-in out-of-range value, persisted) beats
  // auto-pin but loses to a file override: applyTuningParams clears every
  // override and rewrites only the keys in its payload, so a stale pin from
  // an earlier manual session must never shadow a key a scripted run
  // explicitly set.
  if (import.meta.env.DEV) {
    const override = getOverride(sceneId, spec.key);
    if (override !== undefined) return override;
    const pin = getPin(sceneId, spec.key);
    if (pin !== undefined) return pin;
    if (isAutoPinned()) return manualValue;
  }

  if ((!spec.auto && !spec.macro) || !isAutoEnabled(sceneId, spec.key)) return manualValue;

  // A macro-driven setting has no auto weights of its own — its target
  // tracks the driver's own resolved value (itself auto/override/manual as
  // usual), not the music profile directly. Drivers don't carry a `macro` of
  // their own, so this recurses exactly one level deep.
  const target = spec.auto
    ? computeAutoTarget(spec, latestProfile, strength)
    : computeMacroTarget(spec, resolveSceneSetting(sceneId, spec.macro!.driver));
  const key = slewKey(sceneId, spec.key);
  const current = slewed.get(key);
  // First time this param is seen, snap to target rather than gliding from
  // an arbitrary seed — switching scenes shouldn't produce a visible glide-in.
  const next = current === undefined ? target : current + (target - current) * Math.min(1, AUTO_SLEW_RATE * latestDt);
  slewed.set(key, next);
  return next;
}

/** The effective value for a scene setting: its auto target if auto, the
 *  manually-stored value otherwise. Drop-in replacement for getSceneSetting
 *  at every render-time read site. */
export function resolveSceneSetting(sceneId: string, spec: SceneSetting): number {
  return resolve(sceneId, spec, getSceneSetting(sceneId, spec));
}

/** Same idea for the Sensitivity/Acceleration/Smoothing pseudo-params, which
 *  live in their own store (audio/sensitivity.ts) rather than
 *  sceneSettings.ts. */
export function resolveSensitivity(sceneId: string): number {
  return resolve(sceneId, SENSITIVITY_SPEC, getSensitivity(sceneId));
}

export function resolveAcceleration(sceneId: string): number {
  return resolve(sceneId, ACCELERATION_SPEC, getAcceleration(sceneId));
}

export function resolveSmoothing(sceneId: string): number {
  return resolve(sceneId, SMOOTHING_SPEC, getSmoothing(sceneId));
}

/** Explicitly re-seeds a param's glide, e.g. when handing it back to auto —
 *  so it eases off the current display value instead of jumping. */
export function seedAuto(sceneId: string, key: string, value: number): void {
  slewed.set(slewKey(sceneId, key), value);
}

export function getSensitivitySpec(): SceneSetting {
  return SENSITIVITY_SPEC;
}

export function getAccelerationSpec(): SceneSetting {
  return ACCELERATION_SPEC;
}

export function getSmoothingSpec(): SceneSetting {
  return SMOOTHING_SPEC;
}
