import type { SignalLink } from "./signals.ts";
import { isBeatRate, type BeatRate } from "./beatGrid.ts";

/**
 * Per-scene user-tunable parameters, uploaded to the shader as `uniform float
 * u<Key>` (see fullscreenScene.ts). Mirrors src/audio/sensitivity.ts: an
 * in-memory cache seeded once from localStorage, so get/set stay correct
 * even where localStorage is unavailable (node test env, Safari private
 * mode) — only cross-reload persistence depends on it.
 *
 * A setting that opts into `rate` (see that field's own doc comment) gets a
 * second, independent choice alongside its amount: which beat multiple or
 * subdivision it reacts on. getSceneSettingRate/setSceneSettingRate/
 * resetSceneSettings manage that choice in its own store, the same
 * cache-seeded-from-localStorage shape as the amount store above — see
 * beatGrid.ts for what a chosen rate actually changes at render time.
 */

/**
 * The shared vocabulary for `SceneSetting.group`. A heading answers "what
 * part of the picture does this change?" — never "what drives it": a knob
 * that pulses geometry on the beat is Motion, one that pulses brightness is
 * Look, and the row's own `reads` chip already says it's beat-driven, so a
 * driver-named group would just restate that. Apply this ladder, first
 * match wins, whenever a setting's group is unclear:
 *
 *   moves the viewpoint?                  -> Camera
 *   applied to the already-drawn image?   -> Post
 *   changes *where things are* over time? -> Motion
 *   changes *colour or light*?            -> Look
 *   otherwise (shape, structure, scale)   -> Form
 *
 * Camera outranks Motion on purpose — something like "camera bob" moves over
 * time, but belongs with the rest of the framing controls, not the scene's
 * internal motion. Scene-specific nouns (a scene's "Plate", "Sand",
 * "Sparkle") don't get their own group; they stay in the row labels instead,
 * so every scene reuses this same five-word vocabulary. Order here is
 * render order for a scene that uses every group — see the positional
 * grouping note on `group` below.
 */
export const SETTING_GROUPS = ["Form", "Motion", "Look", "Camera", "Post"] as const;
export type SettingGroup = (typeof SETTING_GROUPS)[number];

export interface SceneSetting {
  /** Uniform suffix — "focus" becomes uFocus. Keep it a valid GLSL identifier tail. */
  key: string;
  /** Shown in the device menu. */
  label: string;
  /** One-line plain-language note shown under the slider. Omit for no caption. */
  description?: string;
  /** Optional section heading, from SETTING_GROUPS above. Consecutive
   *  settings sharing a group render under one heading in the device menu;
   *  omit entirely for a flat list. Rendering is positional — a group is a
   *  run of *consecutive* array entries, so a scene using more than one
   *  group must keep each group's settings contiguous and in
   *  SETTING_GROUPS order (tests/settingGroups.test.ts enforces this). */
  group?: SettingGroup;
  min: number;
  max: number;
  step: number;
  default: number;
  /** "boolean" renders as a checkbox (still stored/uploaded as 0/1) instead
   *  of a range slider; "enum" renders as a row of named chips whose index
   *  is the stored/uploaded value (set `options`, and min/max/step to
   *  0/options.length-1/1). Omit for the default numeric slider. */
  type?: "boolean" | "enum";
  /** The names an "enum" setting picks between, in value order. */
  options?: readonly string[];
  /** How this parameter responds to music character. Signed weights per dial;
   *  omit for a parameter that should stay manual. See autoTune.ts. Inline
   *  type-only import avoids a runtime cycle with autoTune.ts, which imports
   *  SceneSetting from this file. */
  auto?: import("./autoTune.ts").AutoWeights;
  /** This setting follows another setting (its "macro" driver) instead of
   *  the music profile — moving the driver displaces this one from its own
   *  `default` by `weight * (driverValue - driver.default)`, scaled to this
   *  setting's own range. At the driver's own default the displacement is
   *  exactly zero, so this resolves to `default` bit-for-bit — the same
   *  identity-at-rest property `auto` has at NEUTRAL dials (see autoTune.ts).
   *  `driver` is the driver's own spec object, not its key: specs live in one
   *  module per scene, so a direct reference needs no lookup table and can't
   *  form a cycle. Mutually exclusive with `auto` in practice — the resolver
   *  only reads one, and `auto` wins if a spec somehow set both. */
  macro?: { driver: SceneSetting; weight: number };
  /** Rendered collapsed under a per-scene "show N more" disclosure instead of
   *  inline in its group. For settings that are real but rarely touched —
   *  the fine constants a `macro` driver's sub-params redistribute, say —
   *  where doubling every group's slider count would drown out the settings
   *  people actually reach for. */
  advanced?: boolean;
  /** The live signals this setting's effect is driven by — see
   *  src/render/signals.ts (SignalLink's own doc comment there covers the
   *  `activeWhen` shape). Purely descriptive: the device menu uses it to
   *  show a live reading beside the row and point at the meter that
   *  displays it. Nothing reads this at render time — the actual driving
   *  happens in the scene's own JS/GLSL — so a stale entry is a wrong label
   *  rather than a broken scene, which is what tests/signals.test.ts exists
   *  to catch. Omit for a setting that's pure geometry or colour, with
   *  nothing in the audio pipeline behind it. */
  reads?: readonly SignalLink[];
  /** This setting reacts on a chosen multiple/subdivision of the beat
   *  instead of always on whatever it rested on before this field existed —
   *  see beatGrid.ts for the grid math and the identity the whole feature
   *  rests on. `rest` is the BeatRate that reproduces this setting's plain
   *  behavior bit for bit — 1 for a setting driven straight off the beat
   *  (most of them), 4 for one already locked to the bar (BEATS_PER_BAR in
   *  beatClock.ts) — and it's this scene's own job to actually honor that
   *  identity in its render code; this field only records which value means
   *  "don't touch the grid." Manual-only, deliberately not next to `auto`:
   *  the chosen rate is a musical intent, not a response to the track's
   *  character, so autoTune.ts never resolves it and a scene never needs a
   *  live-resolved reading the way `resolveSceneSetting` gives it for the
   *  amount. Renders as a chip strip under the row's hint. */
  rate?: { rest: BeatRate };
}

const STORAGE_KEY = "vibe.sceneSettings";

type Store = Record<string, Record<string, number>>;

function loadInitial(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const cache: Store = loadInitial();

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Not fatal — settings just won't persist across reloads.
  }
}

function clamp(spec: SceneSetting, value: number): number {
  if (!Number.isFinite(value)) return spec.default;
  // An enum's value is an index — a stored 0.7 must not linger between chips.
  if (spec.type === "enum") value = Math.round(value);
  return Math.min(spec.max, Math.max(spec.min, value));
}

export function getSceneSetting(sceneId: string, spec: SceneSetting): number {
  const value = cache[sceneId]?.[spec.key];
  return typeof value === "number" ? clamp(spec, value) : spec.default;
}

export function setSceneSetting(sceneId: string, spec: SceneSetting, value: number): void {
  (cache[sceneId] ??= {})[spec.key] = clamp(spec, value);
  persist();
}

// A setting's chosen beat rate — see the `rate` field's own doc comment
// above. Kept in its own store, the same cache-seeded-from-localStorage
// shape as `cache` above, rather than folded into it: `cache`'s values are
// always numbers in a spec's own [min,max], and a rate is neither.
const RATE_STORAGE_KEY = "vibe.sceneBeatRate";

type RateStore = Record<string, Record<string, BeatRate>>;

function loadInitialRates(): RateStore {
  try {
    const raw = localStorage.getItem(RATE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const rateCache: RateStore = loadInitialRates();

function persistRates(): void {
  try {
    localStorage.setItem(RATE_STORAGE_KEY, JSON.stringify(rateCache));
  } catch {
    // Not fatal — same as persist() above.
  }
}

/** `spec.rate.rest` for a setting with no `rate` field at all, or no stored
 *  choice yet — the same "absent means default" shape `getSceneSetting`
 *  uses, so a scene added before this feature (or after, but never touched)
 *  costs nothing extra to read. */
export function getSceneSettingRate(sceneId: string, spec: SceneSetting): BeatRate {
  if (!spec.rate) return 1;
  const value = rateCache[sceneId]?.[spec.key];
  return typeof value === "number" && isBeatRate(value) ? value : spec.rate.rest;
}

export function setSceneSettingRate(sceneId: string, spec: SceneSetting, rate: BeatRate): void {
  if (!spec.rate) return;
  (rateCache[sceneId] ??= {})[spec.key] = rate;
  persistRates();
}

export function resetSceneSettings(sceneId: string, specs: SceneSetting[]): void {
  for (const spec of specs) {
    setSceneSetting(sceneId, spec, spec.default);
    if (spec.rate) setSceneSettingRate(sceneId, spec, spec.rate.rest);
  }
}
