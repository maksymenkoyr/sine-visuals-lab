import type { SceneSetting } from "./sceneSettings.ts";
import {
  getSceneMaster,
  getSceneSetting,
  SCENE_MASTER_DEFAULT,
  setVariantResolver,
  settingDefault,
  settingScope,
} from "./sceneSettings.ts";
import {
  EXPANSION_DEFAULT,
  EXPANSION_MAX,
  EXPANSION_MIN,
  getExpansion,
  getSensitivity,
  getSmoothing,
  SENSITIVITY_DEFAULT,
  SENSITIVITY_MAX,
  SENSITIVITY_MIN,
  shapeExpansion,
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
 * vibe.sceneAuto lists deviations from each key's own default, not simply
 * "the params currently on auto." A scene's own settings (caustics' focus,
 * mesh grid's density, …) default to manual, same as always. The Input
 * card's Sensitivity/Expansion/Smoothing pseudo-params (DEFAULT_AUTO_KEYS
 * below — see src/audio/micAuto.ts for why those three specifically) default
 * to auto instead. A key absent from the store — including every key on a
 * scene added after this feature shipped, and every key on a fresh profile —
 * resolves to whichever of those two defaults its own key has, until someone
 * explicitly switches it the other way (per-row chip, the scene's master
 * Auto button, or the Input card's own Auto button — src/audio/micAuto.ts).
 *
 * This module flipped once already, from an exceptions-store ("absent means
 * auto") design to "absent means manual"; old persisted data only ever
 * contained `false` values (the old "manual" marker), and those simply read
 * as absent-therefore-manual under that rule, so no migration was needed for
 * that flip. The mic-pseudo-params flip (this file's second one — absent now
 * means auto for exactly DEFAULT_AUTO_KEYS) reuses that same old `false`
 * marker for its new purpose: a `false` already stored against one of those
 * three keys meant "manual" before, and it still does now, so it's kept
 * as-is rather than migrated. loadAutoStore's pruneDefaultEntries drops any
 * entry that merely restates its own key's default (and the empty scope
 * objects that leaves behind) on load, so a stale entry doesn't sit in
 * storage forever.
 *
 * A SceneSetting's `macro` field is the same displacement shape as `auto`,
 * aimed at another setting instead of the music profile: computeMacroTarget
 * mirrors computeAutoTarget exactly, with the driver's live value standing
 * in for a dial reading, and the same "driver at its own default -> exactly
 * spec.default" identity at rest. It shares this module's auto-on store and
 * slew, so dragging a macro-driven setting "goes manual" the same way
 * dragging an auto one does — see resolve() below.
 *
 * This module is also where the device-wide scene master (sceneSettings.ts's
 * getSceneMaster) gets multiplied into every resolved value — see
 * resolveSceneSetting's own doc for the rules (scaled once, at the outermost
 * resolve; never on drives, enums/booleans, the Input card's gain stages, or
 * a DEV pin/override).
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
// Uses shapeExpansion (audio/sensitivity.ts) because it's already exactly
// the right shape for this: an S-curve fixed at 0/0.5/1 with a finite (not
// infinite) slope through the pivot, so shapeExpansion(0.5, k) === 0.5
// always holds — preserving the "all dials neutral -> spec.default exactly"
// invariant this whole module rests on regardless of the expansion factor.
const DIAL_EXPAND = 2.5;

const STORAGE_KEY_AUTO_ON = "vibe.sceneAuto";
const STORAGE_KEY_STRENGTH = "vibe.autoStrength";

export const AUTO_STRENGTH_MIN = 0;
export const AUTO_STRENGTH_MAX = 2;
export const AUTO_STRENGTH_DEFAULT = 1;

/** Reserved settings keys for the Sensitivity/Expansion/Smoothing pseudo-
 *  params — can't collide with a real SceneSetting.key, which must be a
 *  valid GLSL identifier tail. */
export const SENSITIVITY_AUTO_KEY = "@sensitivity";
export const EXPANSION_AUTO_KEY = "@expansion";
export const SMOOTHING_AUTO_KEY = "@smoothing";

// The Input card's "whole mic" pseudo-params (see src/audio/micAuto.ts) —
// auto by default. Every real SceneSetting key stays manual by default; see
// isAutoEnabled/setAutoEnabled below for how the store encodes that
// per-key-different default as deviations only.
const DEFAULT_AUTO_KEYS: ReadonlySet<string> = new Set([SENSITIVITY_AUTO_KEY, EXPANSION_AUTO_KEY, SMOOTHING_AUTO_KEY]);

// The auto keys from this control's previous names — see the migration in
// loadAutoStore() below, and the parallel legacyKeys migration for the
// manual-value store in audio/sensitivity.ts.
const LEGACY_EXPANSION_AUTO_KEYS = ["@acceleration", "@contrast"] as const;

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

const EXPANSION_SPEC: SceneSetting = {
  key: EXPANSION_AUTO_KEY,
  label: "Expansion",
  min: EXPANSION_MIN,
  max: EXPANSION_MAX,
  step: 0.05,
  default: EXPANSION_DEFAULT,
  // Expansion widens/narrows the gap between quiet and loud
  // (shapeExpansion's S-curve). A track that's already dynamic (big macro
  // swings) needs less artificial expansion piled on top; a compressed,
  // flat one benefits from more to recover some perceived punch. Negative
  // weight on the same `dynamics` dial as Sensitivity's positive one is
  // deliberate — the two pull in opposite directions on purpose, they're not
  // redundant.
  //
  // Also negative on `loudness`, same reasoning as Sensitivity above: a
  // quiet room gets more expansion to recover punch, a loud one gets less.
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

type AutoStore = Record<string, Record<string, boolean>>;

// One-time rewrite of any LEGACY_EXPANSION_AUTO_KEYS auto-on key to
// EXPANSION_AUTO_KEY, in place, on whatever shape loadAutoStore() handed
// back. Skipping this would silently drop a scene's auto choice for the
// control back to manual after the rename — the entry simply wouldn't be
// found under its new key. Returns whether anything changed, so the caller
// can persist the rewritten shape immediately rather than re-migrating (a
// no-op, but wasted work) on every future load.
function migrateLegacyExpansionKeys(store: AutoStore): boolean {
  let changed = false;
  for (const sceneId of Object.keys(store)) {
    const sceneEntry = store[sceneId];
    for (const legacyKey of LEGACY_EXPANSION_AUTO_KEYS) {
      if (!(legacyKey in sceneEntry)) continue;
      if (!(EXPANSION_AUTO_KEY in sceneEntry)) sceneEntry[EXPANSION_AUTO_KEY] = sceneEntry[legacyKey];
      delete sceneEntry[legacyKey];
      changed = true;
    }
  }
  return changed;
}

// Drops any entry that just restates its own key's default (and any scope
// object left empty by that) — deviations only, per this module's header.
// For a key in DEFAULT_AUTO_KEYS (default auto) the deviation marker is
// `false`, so anything else stored against it — a `true`, or any other
// stray value — restates the default and gets dropped. For every other key
// (default manual) the deviation marker is `true`, so anything else —
// including a `false` written by the pre-flip "exceptions" scheme, back
// when absent meant auto — restates the default and gets dropped. A
// lingering `false` on one of DEFAULT_AUTO_KEYS from that same old scheme is
// the one case NOT dropped: it meant "manual" under the old scheme too, and
// it still does under the new one, so it's kept as-is rather than migrated.
// Returns whether anything changed, so the caller only re-persists when
// pruning actually did something.
function pruneDefaultEntries(store: AutoStore): boolean {
  let changed = false;
  for (const sceneId of Object.keys(store)) {
    const sceneEntry = store[sceneId];
    for (const key of Object.keys(sceneEntry)) {
      const restatesDefault = DEFAULT_AUTO_KEYS.has(key) ? sceneEntry[key] !== false : sceneEntry[key] !== true;
      if (restatesDefault) {
        delete sceneEntry[key];
        changed = true;
      }
    }
    if (Object.keys(sceneEntry).length === 0) {
      delete store[sceneId];
      changed = true;
    }
  }
  return changed;
}

function loadAutoStore(): AutoStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_AUTO_ON);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const migrated = migrateLegacyExpansionKeys(parsed);
    const pruned = pruneDefaultEntries(parsed);
    if (migrated || pruned) localStorage.setItem(STORAGE_KEY_AUTO_ON, JSON.stringify(parsed));
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

const autoOn: AutoStore = loadAutoStore();
let strength = loadStrength();

function persistAutoStore(): void {
  try {
    localStorage.setItem(STORAGE_KEY_AUTO_ON, JSON.stringify(autoOn));
  } catch {
    // Not fatal — auto/manual choices just won't persist across reloads.
  }
}

function persistStrength(): void {
  try {
    localStorage.setItem(STORAGE_KEY_STRENGTH, String(strength));
  } catch {
    // Not fatal — see persistAutoStore.
  }
}

/** Whether this exact (scene, key) pair currently resolves to auto — either
 *  because it was explicitly switched to auto, or because nothing's been
 *  stored for it and its key defaults to auto (DEFAULT_AUTO_KEYS above).
 *  Keyed by sceneSettings.ts's settingScope, so a scene with a variant keeps
 *  one auto/manual state per variant option, like its values. */
export function isAutoEnabled(sceneId: string, key: string): boolean {
  const stored = autoOn[settingScope(sceneId, key)]?.[key];
  if (stored === undefined) return DEFAULT_AUTO_KEYS.has(key);
  return stored === true;
}

export function setAutoEnabled(sceneId: string, key: string, on: boolean): void {
  const scope = settingScope(sceneId, key);
  // The store holds only deviations from each key's own default (see this
  // module's header): a DEFAULT_AUTO_KEYS key's default is auto, so writing
  // `on` (true) is a no-op deviation-wise and just clears any stored
  // manual override, while `off` (false) is the deviation and gets written.
  // Every other key's default is manual, so it's the mirror image.
  const deviatesFromDefault = DEFAULT_AUTO_KEYS.has(key) ? !on : on;
  if (deviatesFromDefault) {
    (autoOn[scope] ??= {})[key] = on;
  } else {
    delete autoOn[scope]?.[key];
    if (autoOn[scope] && Object.keys(autoOn[scope]).length === 0) delete autoOn[scope];
  }
  persistAutoStore();
}

/** Whether every auto-capable setting on this scene is currently auto —
 *  drives the scene's master toggle. Settings with neither an `auto` nor a
 *  `macro` field can't be toggled, so they don't count against it. Pass
 *  Sensitivity/Expansion/Smoothing specs alongside a scene's own settings
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

function clampToSpec(spec: SceneSetting, value: number, base = spec.default): number {
  if (!Number.isFinite(value)) return base;
  return Math.min(spec.max, Math.max(spec.min, value));
}

/**
 * Pure resolution formula: how far this setting should sit from its default
 * given the current music profile. At every dial = 0.5 (NEUTRAL) the sum is
 * exactly 0, so this returns the default bit-for-bit — the property that
 * makes switching a setting to auto never jump (a quiet/neutral profile
 * resolves to the same value the manual default already showed) instead of
 * snapping somewhere else the instant the chip is flipped. `base` is that
 * default: spec.default unless the scene's variant says otherwise
 * (sceneSettings.ts's settingDefault), which resolve() passes in.
 */
export function computeAutoTarget(spec: SceneSetting, profile: DialValues, autoStrength: number, base = spec.default): number {
  if (!spec.auto) return base;
  let deviation = 0;
  for (const dial of MUSIC_DIALS) {
    const w = spec.auto[dial];
    if (w === undefined) continue;
    deviation += w * (shapeExpansion(profile[dial], DIAL_EXPAND) - 0.5);
  }
  const raw = base + autoStrength * deviation * (spec.max - spec.min);
  return clampToSpec(spec, raw, base);
}

/**
 * Same shape as computeAutoTarget, but displaced by a driver setting's value
 * instead of the music profile. At driverValue === spec.macro.driver.default
 * the displacement term is exactly 0, so this returns spec.default
 * bit-for-bit — same identity-at-rest property, same reason switching this
 * setting to auto (or its driver) never produces a visible jump.
 */
export function computeMacroTarget(
  spec: SceneSetting,
  driverValue: number,
  base = spec.default,
  driverBase = spec.macro?.driver.default ?? 0,
): number {
  const m = spec.macro;
  if (!m) return base;
  const deviation = m.weight * (driverValue - driverBase);
  const raw = base + deviation * (spec.max - spec.min);
  return clampToSpec(spec, raw, base);
}

// Glides the resolved value toward its target over a few seconds so a
// section change reads as a swell, not a snap — the same reasoning as
// sectionIntensity.ts's INTENSITY_SLEW. ~2s time constant.
const AUTO_SLEW_RATE = 0.5;

let latestDt = 1 / 60;
let latestProfile: DialValues = { ...NEUTRAL };
const slewed = new Map<string, number>();

function slewKey(sceneId: string, key: string): string {
  return `${settingScope(sceneId, key)}/${key}`;
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
  // their own, so this recurses exactly one level deep. The driver read here
  // is resolveUnscaled, NOT resolveSceneSetting: the scene master (below)
  // must touch each param exactly once, at the outermost resolve — feeding
  // the scaled driver into this displacement and then scaling the sub-param
  // too would square the master's effect across a macro group like Caustics'
  // Sparkle.
  const target = spec.auto
    ? computeAutoTarget(spec, latestProfile, strength, settingDefault(sceneId, spec))
    : computeMacroTarget(
        spec,
        resolveUnscaled(sceneId, spec.macro!.driver),
        settingDefault(sceneId, spec),
        settingDefault(sceneId, spec.macro!.driver),
      );
  const key = slewKey(sceneId, spec.key);
  const current = slewed.get(key);
  // First time this param is seen, snap to target rather than gliding from
  // an arbitrary seed — switching scenes shouldn't produce a visible glide-in.
  const next = current === undefined ? target : current + (target - current) * Math.min(1, AUTO_SLEW_RATE * latestDt);
  slewed.set(key, next);
  return next;
}

/** Resolve without the scene master applied — the inner rung. Only the
 *  public resolveSceneSetting below scales, and the macro recursion inside
 *  resolve() reads drivers through here so a param is never scaled twice. */
function resolveUnscaled(sceneId: string, spec: SceneSetting): number {
  return resolve(sceneId, spec, getSceneSetting(sceneId, spec));
}

/** The effective value for a scene setting: its auto target if auto, the
 *  manually-stored value otherwise — then the device-wide scene master
 *  (sceneSettings.ts's getSceneMaster) multiplied in: value × master,
 *  clamped back to the spec's own [min, max]. Drop-in replacement for
 *  getSceneSetting at every render-time read site, which is what makes one
 *  scale here cover the shader upload (sceneCommon.ts), every scene's own
 *  settingFor/JS reads, and the panel's live readouts alike.
 *
 *  Rules the master keeps:
 *  - applied to the final resolved value only — manual, auto and macro
 *    outcomes alike — and never to a drive reading (u<Key>Drive stays the
 *    raw signal; gates and combines must not move — drives.ts's header);
 *  - never to an enum or boolean (their values are chip indices / 0-1
 *    flags, not amounts), so the variant setting is naturally exempt too;
 *  - never to Sensitivity/Expansion/Smoothing, which resolve through
 *    resolveSensitivity and friends below and are audio gain, not scene
 *    params;
 *  - never over a DEV override or pin: those are deliberately typed,
 *    often out-of-range values (tuning/overrides.ts, tuning/pins.ts), and
 *    clamping them back in would break the tuning affordance.
 *  master === 1 returns the resolved value untouched, so every identity
 *  test (auto at NEUTRAL, drives at defaults) stays bit-for-bit. */
export function resolveSceneSetting(sceneId: string, spec: SceneSetting): number {
  const value = resolveUnscaled(sceneId, spec);
  const master = getSceneMaster();
  if (master === SCENE_MASTER_DEFAULT) return value;
  if (spec.type === "boolean" || spec.type === "enum") return value;
  if (import.meta.env.DEV && (getOverride(sceneId, spec.key) !== undefined || getPin(sceneId, spec.key) !== undefined)) {
    return value;
  }
  return clampToSpec(spec, value * master);
}

// A scene's variant (SceneSetting.variant) is read through this resolver
// too, so a dev override on it selects the matching profile — see
// sceneSettings.ts's setVariantResolver.
setVariantResolver(resolveSceneSetting);

/** Same idea for the Sensitivity/Expansion/Smoothing pseudo-params, which
 *  live in their own store (audio/sensitivity.ts) rather than
 *  sceneSettings.ts. */
export function resolveSensitivity(sceneId: string): number {
  return resolve(sceneId, SENSITIVITY_SPEC, getSensitivity(sceneId));
}

export function resolveExpansion(sceneId: string): number {
  return resolve(sceneId, EXPANSION_SPEC, getExpansion(sceneId));
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

export function getExpansionSpec(): SceneSetting {
  return EXPANSION_SPEC;
}

export function getSmoothingSpec(): SceneSetting {
  return SMOOTHING_SPEC;
}
