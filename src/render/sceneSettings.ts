import type { SignalLink } from "./signals.ts";

/**
 * Per-scene user-tunable parameters, uploaded to the shader as `uniform float
 * u<Key>` (see fullscreenScene.ts). Mirrors src/audio/sensitivity.ts: an
 * in-memory cache seeded once from localStorage, so get/set stay correct
 * even where localStorage is unavailable (node test env, Safari private
 * mode) — only cross-reload persistence depends on it.
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
  /** This enum is the scene's *variant*: the one setting that decides what
   *  the rest of the settings are even acting on (Kaleidoscope's Style).
   *  Every other setting then keeps a separate stored value, auto/manual
   *  state and default per variant option — a profile per option — so
   *  tuning one look never disturbs another, and switching back restores
   *  what was there. A scene may mark at most one setting this way, and it
   *  must be an enum (tests/settingGroups.test.ts). The scoping itself is
   *  done here (settingScope) and in autoTune.ts, keyed by the option's
   *  *name*, so reordering options can't swap profiles; sceneLooks.ts
   *  applies the variant before anything else so a Look lands in the right
   *  profile. */
  variant?: boolean;
  /** Per-variant defaults, keyed by the variant option's name, for a
   *  setting in a scene that has a `variant`: the value this setting rests
   *  at under that option, where `default` is what it rests at under every
   *  option not listed. Read through settingDefault() — never `default`
   *  directly — at every place a default matters (reset, Looks, the auto
   *  identity at NEUTRAL, the panel's reset arrow). */
  variantDefaults?: Readonly<Record<string, number>>;
}

const STORAGE_KEY = "vibe.sceneSettings";

// Which setting is each scene's variant (SceneSetting.variant), registered
// by scene.ts's registerScene so the scoped reads below can find it without
// every caller threading the scene's spec list through.
const variantSpecs = new Map<string, SceneSetting>();

export function registerVariant(sceneId: string, specs: readonly SceneSetting[] | undefined): void {
  const spec = specs?.find((s) => s.variant);
  if (spec) variantSpecs.set(sceneId, spec);
  else variantSpecs.delete(sceneId);
}

export function getVariantSpec(sceneId: string): SceneSetting | undefined {
  return variantSpecs.get(sceneId);
}

// How the variant's *effective* value is read. The stored value by default;
// autoTune.ts swaps in its resolver at load, so a dev override or pin on
// the variant (tuning/overrides.ts, pins.ts) switches profiles the same way
// a chip click does — the profile in effect is always the one the shader
// is drawing. A callback rather than an import: autoTune.ts imports this
// module, and the reverse edge would be a cycle.
let variantValue: (sceneId: string, spec: SceneSetting) => number = getSceneSetting;

export function setVariantResolver(fn: (sceneId: string, spec: SceneSetting) => number): void {
  variantValue = fn;
}

/** The name of the variant option a scene currently sits on, or undefined
 *  for a scene without a variant. */
export function currentVariant(sceneId: string): string | undefined {
  const spec = variantSpecs.get(sceneId);
  if (!spec?.options) return undefined;
  return spec.options[clamp(spec, variantValue(sceneId, spec))];
}

/** The storage id a (scene, setting) pair lives under: the scene id itself
 *  for a scene with no variant and for the variant setting itself, else the
 *  scene id qualified by the current variant option's name. Every per-
 *  setting store (this one, autoTune.ts's exceptions and slew) keys by this,
 *  which is what makes a variant's profile one thing rather than several. */
export function settingScope(sceneId: string, key: string): string {
  const spec = variantSpecs.get(sceneId);
  if (!spec || spec.key === key) return sceneId;
  return `${sceneId}@${currentVariant(sceneId)}`;
}

/** A setting's resting value under the scene's current variant — see
 *  SceneSetting.variantDefaults. */
export function settingDefault(sceneId: string, spec: SceneSetting): number {
  if (!spec.variantDefaults) return spec.default;
  const variant = currentVariant(sceneId);
  const value = variant === undefined ? undefined : spec.variantDefaults[variant];
  return value === undefined ? spec.default : value;
}

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
  const value = cache[settingScope(sceneId, spec.key)]?.[spec.key];
  return typeof value === "number" ? clamp(spec, value) : settingDefault(sceneId, spec);
}

export function setSceneSetting(sceneId: string, spec: SceneSetting, value: number): void {
  (cache[settingScope(sceneId, spec.key)] ??= {})[spec.key] = clamp(spec, value);
  persist();
}

/** Every listed spec back to its default — within the current variant's
 *  profile, so resetting Prism leaves Mandala's tuning alone. The variant
 *  itself is reset too, first, so what follows lands in the default
 *  option's profile. */
export function resetSceneSettings(sceneId: string, specs: SceneSetting[]): void {
  for (const spec of variantFirst(specs)) setSceneSetting(sceneId, spec, settingDefault(sceneId, spec));
}

/** The specs with the scene's variant (if any) moved to the front: anything
 *  that writes a whole scene's settings must set the variant before the
 *  rest, or the rest lands in the profile of the option being left. */
export function variantFirst(specs: readonly SceneSetting[]): SceneSetting[] {
  const variant = specs.find((s) => s.variant);
  return variant ? [variant, ...specs.filter((s) => s !== variant)] : [...specs];
}
