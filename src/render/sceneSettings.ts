import type { SignalId, SignalLink } from "./signals.ts";
import { EXPANSION_DEFAULT, EXPANSION_MAX, EXPANSION_MIN } from "../audio/sensitivity.ts";
import { registerSyncedStore } from "../net/syncedStores.ts";
import { proUnlocked } from "./pro.ts";

/**
 * Per-scene user-tunable parameters, uploaded to the shader as `uniform float
 * u<Key>` (see fullscreenScene.ts). Mirrors src/audio/sensitivity.ts: an
 * in-memory cache seeded once from localStorage, so get/set stay correct
 * even where localStorage is unavailable (node test env, Safari private
 * mode) — only cross-reload persistence depends on it.
 *
 * Also home to the device-wide master (getSceneMaster and getSceneExpansion
 * below): the Master card's Scale dial over every numeric scene param and
 * its Expansion dial over every drive reading, each stored as a scalar rather
 * than per scene because it describes this room's taste, not one scene's —
 * the same class of preference as audio/sensitivity.ts's gain stages, so like
 * them it stays out of Looks/share codes. Their keys do ride in a room's look
 * (net/syncedStores.ts's `isRoomKey`), so a paired TV draws with the phone's
 * master dials. Storage lives here; Scale happens at the single resolve
 * choke point, resolveSceneSetting in autoTune.ts, and Expansion in the
 * drive engine (drives.ts's header, "Master Expansion"). Scale honours a per-
 * setting `masterScale: false` opt-out (see SceneSetting.masterScale below)
 * for a value the master would otherwise distort past recognition.
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
  /** A sub-grouping *inside* a group — a run of *consecutive* settings that
   *  together control one thing (e.g. Caustics' Drift speed/Speed boost/
   *  Speed pump). Rendered in the device menu purely as a shared colour —
   *  no caption, no indent: every row in the family takes the family's own
   *  accent in place of the Scene card's usual violet (deviceMenu.ts's renderSceneSettings, colours
   *  from controlsTheme.ts's FAMILY_ACCENTS). Must be a contiguous run and
   *  must not span a group boundary (tests/settingGroups.test.ts enforces
   *  both). Ignored on an `advanced` row — an advanced run already has its
   *  own disclosure, and families don't need to nest inside that too. */
  family?: string;
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
  /** The `options` that are Pro content (src/render/pro.ts). While Pro is
   *  locked, a locked option can't be stored or read back — clamp() turns
   *  it into `default`, which must itself be a free option — and the
   *  device menu shows it as a locked chip. */
  proOptions?: readonly string[];
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
   *  nothing in the audio pipeline behind it, or for a setting with `drive`
   *  below — its row's live pill is derived from the drive choice itself,
   *  so a hand-authored `reads` would just be a second, driftable claim
   *  about the same thing. */
  reads?: readonly SignalLink[];
  /** Declares this setting audio-reactive through the drive system
   *  (src/render/drives.ts): the device menu grows a source picker on its
   *  row, and the scene reads the resolved value through `<key>Drive()` in
   *  GLSL or `drives.value()`/`drives.fired()` in JS instead of a coupling
   *  fixed at build time. `default` is the source this setting reacts to
   *  until someone changes it — a plain src/render/signals.ts SignalId
   *  (reused as the drive catalogue, not a parallel enum — see that file's
   *  header), `{ source: "beat", grid }` for a beat-grid tick
   *  (src/audio/beatGrid.ts), `{ source: "line" }` for this setting's own
   *  drawn frequency line (src/audio/bandLine.ts), or `"scene"` for a
   *  coupling that mixes more than one signal and can't be reduced to a
   *  single catalogue pick without changing the look — see drives.ts's
   *  header for why `mix(sceneDefault, drive, 0)` makes that choice exactly
   *  as bit-identical as any catalogue default. `sceneLabel` names the
   *  Scene composite in the picker (e.g. "Scene: treble hits + line") —
   *  required when `default` is `"scene"`, since there's no catalogue label
   *  to fall back to. `gain` scales a catalogue source's [0,1] reading to
   *  the shape this setting's own composite otherwise expects; omit for 1
   *  (no scaling). `default` must itself react to the music — never a
   *  constant — and `"scene"` is only for a composite that genuinely reads
   *  more than one signal, never a dressed-up constant: see drives.ts's
   *  header's "Nothing plugged in" paragraph for why (and for what an
   *  unplugged jack must do instead: leave the setting exactly where its
   *  slider puts it, never collapse, vanish or run backwards). */
  drive?: {
    default: import("./drives.ts").DriveChoice;
    sceneLabel?: string;
    gain?: number;
    /** Display-only, for a `default: "scene"` setting: the meters its own
     *  composite genuinely reads (its `sceneLabel` and code are the source of
     *  truth — this just names the same things as SignalIds so the panel can
     *  draw dimmed "scene mix" cables to them). Never read at render time —
     *  changing this can't change what the scene draws, only what the panel
     *  points at — and left out entirely where the composite doesn't read
     *  anything in the src/render/signals.ts catalogue (a scene-local
     *  detector like a bespoke calm/hit-strength signal, or a bare constant).
     *  tests/drives.test.ts checks every entry against the catalogue, not
     *  against the scene's own code, so a stale list is a wrong pill rather
     *  than a broken build — keep it honest by hand. */
    sceneSources?: readonly SignalId[];
    /** Declares this setting scene-handled for its own threshold — a gate
     *  the scene applies itself to whatever this setting receives, shaped
     *  however its own signal needs (Physarum 2's Dose threshold, on
     *  rippleEmitter.ts's salience trackers, is one). The panel shows the
     *  On/Off toggle + slider right under this setting's graph
     *  (deviceMenu.ts), starting on; it's saved with the rest of this
     *  setting's patch (driveStore.ts's getDriveThresholdState), and the
     *  scene reads it with drives.threshold(key). 0..1; `default` is what an
     *  untouched setting uses. Leave this unset and the setting still gets a
     *  threshold row, starting off — the engine applies a generic adaptive
     *  gate instead (drives.ts's header's "The threshold" paragraph explains
     *  why a setting is never gated both ways). */
    threshold?: { default: number; label: string; hint: string };
  };
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
  /** Tags this setting as one instance of a scene-declared item family
   *  (src/render/sceneItems.ts's header owns the concept) rather than a
   *  hand-written control: `family` names the item group (e.g. "strain"),
   *  `index` is which item (0-based), `param` is which per-item control
   *  this is (e.g. "nutrient"), and `other` is the paired item's index for
   *  a pairwise family (defineItemPairs's `att<i><j>`, `other` = `j`).
   *  scene.ts's `Scene.panel` claims every setting whose `item.family`
   *  matches a section's own `items`, rendering it through a custom widget
   *  (src/ui/widgets/registry.ts) instead of the device menu's flat
   *  per-setting loop; src/tuning/bakeDefaults.ts also skips an
   *  `item`-tagged setting, since its default lives in the scene's own item
   *  table, not a literal `default:` in source a bake could rewrite. */
  item?: {
    family: string;
    index: number;
    param: string;
    other?: number;
  };
  /** Set false to exempt this setting from the device-wide scene master
   *  (autoTune.ts's resolveSceneSetting): a signed relation value whose
   *  meaning is its exact position (Physarum 2's att/touch pair tables, Sky's
   *  Time of day on its 24-hour clock), where ×0 or a clamped ×2 would change
   *  which relation or hour it is, and the panel would show the stored value
   *  while the scene runs the scaled one. */
  masterScale?: false;
  /** Set false for a numeric slider that does real work whenever its value
   *  moves — rebuilds geometry, reseeds a simulation — so the pop-out
   *  output's Play glide (src/net/outputGlide.ts) must switch it in one step
   *  rather than walk it through every value in between. Only plain
   *  fine-stepped sliders glide at all (outputGlide.ts's glideSafe); this is
   *  the opt-out for the few of those that shouldn't. */
  glide?: false;
}

/** Where every scene's stored values live: `{ scope: { key: number } }`, the
 *  scope being settingScope(). Exported for src/net/outputGlide.ts, which
 *  moves the numeric ones smoothly. */
export const SCENE_SETTINGS_KEY = "vibe.sceneSettings";
const STORAGE_KEY = SCENE_SETTINGS_KEY;

// Which setting is each scene's variant (SceneSetting.variant), registered
// by scene.ts's registerScene so the scoped reads below can find it without
// every caller threading the scene's spec list through.
const variantSpecs = new Map<string, SceneSetting>();

export function registerVariant(sceneId: string, specs: readonly SceneSetting[] | undefined): void {
  const spec = specs?.find((s) => s.variant);
  if (spec) variantSpecs.set(sceneId, spec);
  else variantSpecs.delete(sceneId);
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
 *  setting store (this one, autoTune.ts's auto-on store and slew) keys by this,
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

// Re-seeds the cache from localStorage — how the pop-out output window picks
// up a snapshot (net/syncedStores.ts).
registerSyncedStore(STORAGE_KEY, () => {
  for (const k of Object.keys(cache)) delete cache[k];
  Object.assign(cache, loadInitial());
});

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
  value = Math.min(spec.max, Math.max(spec.min, value));
  return isProLocked(spec, value) ? spec.default : value;
}

/** True when `value` is an enum option listed in `proOptions` and Pro is
 *  locked (src/render/pro.ts). */
export function isProLocked(spec: SceneSetting, value: number): boolean {
  if (!spec.proOptions?.length || !spec.options || proUnlocked()) return false;
  return spec.proOptions.includes(spec.options[Math.round(value)] ?? "");
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

// The device-wide master over every numeric scene param — see this file's
// header for why it's a scalar here rather than a per-scene entry in the
// store above. Raw multiply at resolve time: resolved' = resolved × master,
// clamped back to the spec's own [min, max] (autoTune.ts's
// resolveSceneSetting). 1 is identity; 0 collapses every numeric param to
// its floor, which is what an honest raw multiply means. No setting carries
// a sense of "more intense" for this to lean on, so to see what the master
// actually does to the picture, look at the picture — the Master card's own
// Picture block (src/ui/deviceMenu.ts), measured by src/render/pictureMeter.ts.
export const SCENE_MASTER_MIN = 0;
export const SCENE_MASTER_MAX = 2;
export const SCENE_MASTER_DEFAULT = 1;

// The master's second dial: Expansion — how far the music may pull the
// picture away from the normal line Scale sets, and how long it stays away
// (drives.ts's header, "Master Expansion"). It moves drive readings, never a
// setting's own value. Same range and log slider as the Input card's
// Expansion. 1 is identity.
export const SCENE_EXPANSION_MIN = EXPANSION_MIN;
export const SCENE_EXPANSION_MAX = EXPANSION_MAX;
export const SCENE_EXPANSION_DEFAULT = EXPANSION_DEFAULT;

// One device-wide dial: in-memory first, seeded once from localStorage —
// same cache-over-storage shape as the per-scene store above, for the same
// reasons (node test env, Safari private mode).
function createDeviceDial(storageKey: string, min: number, max: number, defaultValue: number) {
  function clamp(value: number): number {
    if (!Number.isFinite(value)) return defaultValue;
    return Math.min(max, Math.max(min, value));
  }

  function load(): number {
    try {
      const raw = localStorage.getItem(storageKey);
      // Number(null) is 0, not NaN — an absent key must mean the default
      // (identity), not a master that blanks every param.
      if (raw === null) return defaultValue;
      return clamp(Number(raw));
    } catch {
      return defaultValue;
    }
  }

  let value = load();
  registerSyncedStore(storageKey, () => {
    value = load();
  });
  return {
    get: (): number => value,
    set(next: number): void {
      value = clamp(next);
      try {
        localStorage.setItem(storageKey, String(value));
      } catch {
        // Not fatal — the dial just won't persist across reloads.
      }
    },
  };
}

/** Storage keys of the two device-wide dials — exported for src/net/outputGlide.ts. */
export const SCENE_MASTER_KEY = "vibe.sceneMaster";
export const SCENE_EXPANSION_KEY = "vibe.sceneExpansion";

const masterDial = createDeviceDial(SCENE_MASTER_KEY, SCENE_MASTER_MIN, SCENE_MASTER_MAX, SCENE_MASTER_DEFAULT);
export const getSceneMaster = masterDial.get;
export const setSceneMaster = masterDial.set;

const expansionDial = createDeviceDial(
  SCENE_EXPANSION_KEY,
  SCENE_EXPANSION_MIN,
  SCENE_EXPANSION_MAX,
  SCENE_EXPANSION_DEFAULT,
);
export const getSceneExpansion = expansionDial.get;
export const setSceneExpansion = expansionDial.set;

// Expansion's shape: how the music's distance from its usual level becomes
// the picture's (drives.ts's header, "Master Expansion"). A choice, not an
// amount, so the Master card shows it as chips. Stored as an index into
// EXPANSION_SHAPES — append new shapes, never reorder, or saved picks move.
export const EXPANSION_SHAPES = ["even", "softTop", "bigMoves", "upOnly", "downOnly"] as const;
export type ExpansionShape = (typeof EXPANSION_SHAPES)[number];
export const EXPANSION_SHAPE_DEFAULT: ExpansionShape = "even";
export const SCENE_EXPANSION_SHAPE_KEY = "vibe.sceneExpansionShape";

const shapeDial = createDeviceDial(SCENE_EXPANSION_SHAPE_KEY, 0, EXPANSION_SHAPES.length - 1, 0);
export function getSceneExpansionShape(): ExpansionShape {
  return EXPANSION_SHAPES[Math.round(shapeDial.get())] ?? EXPANSION_SHAPE_DEFAULT;
}
export function setSceneExpansionShape(shape: ExpansionShape): void {
  shapeDial.set(Math.max(0, EXPANSION_SHAPES.indexOf(shape)));
}
