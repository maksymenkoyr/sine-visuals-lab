import { registerSyncedStore } from "../net/syncedStores.ts";
import type { SceneSetting } from "./sceneSettings.ts";

/**
 * Custom values: a scene setting typed past its slider's ends (deviceMenu.ts's
 * typed readout), kept apart from sceneSettings.ts's store. That store clamps
 * on both read and write, and should go on doing so: it is what pulls an old
 * saved value back into range when a scene's range changes. A custom value is
 * the one deliberate exception, set by hand and shown with a ⚠ by the number
 * for as long as it lasts.
 *
 * How it plays with the rest:
 * - autoTune.ts's resolve() returns a custom value ahead of auto (after only
 *   a dev tuning override), and resolveSceneSetting leaves it out of Master
 *   Scale, whose clamp would pull it straight back into range.
 * - Any write to the setting itself (setSceneSetting: a drag, ↺, the Scene
 *   card's Reset, a Look, a phone in the room) drops it, so it never shadows
 *   a later edit. The typed path writes the slider's nearest end first, then
 *   lays the custom value over it, so a reader that doesn't know about
 *   custom values (an older app on a room's TV) still sees the nearest end.
 * - It is part of the room look (net/syncedStores.ts), so a room's TV and the
 *   pop-out output show it too, and sceneLooks.ts carries it in a Look.
 *
 * The slider stretches to fit it. Typing 1.5 into a 0..1 slider (or applying
 * a Look that carries 1.5) stretches the slider to 0..1.5 with the thumb at
 * its end, and the stretch (`s`, saved beside the value `v`) outlives the
 * value: dragging back inside 0..1 drops the custom value but keeps the
 * stretch, so the thumb can go back out. Typing another value past the end
 * moves the end there. Only a reset takes it away (resetCustomValue: ↺, the
 * Scene card's Reset, Auto taking the setting, emptying the typed field, or
 * a Look without a custom value for it).
 *
 * How far: `customReach` allows one more slider's width past either end, and
 * never below 0 for a slider that starts at 0 or above (a negative glow or
 * size is a shader's NaN, not a look). Only continuous settings: a toggle,
 * an option, or a step of 1 or more (a count) takes none, whose max is usually a hard limit in the
 * scene's code. The bound matters because the value persists — a typo that
 * stalls the GPU would stall it again on every load. Dev builds lift it for
 * tuning (`unbounded`), as the old dev-only pins did.
 */

const STORAGE_KEY = "vibe.customValues";

/** One setting's entry: `v` its custom value, `s` where its slider is
 *  stretched to. Either may be absent — dragging back inside the slider's
 *  own range drops `v` and keeps `s`. */
interface Entry {
  v?: number;
  s?: number;
}

type Store = Record<string, Record<string, Entry>>;

let cache: Store | null = null;

function loadInitial(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // Matches sceneSettings.ts: no localStorage global at all (Vitest's node
    // env), storage disabled, or a corrupt blob — start empty either way.
    return {};
  }
}

function store(): Store {
  if (cache === null) cache = loadInitial();
  return cache;
}

// Re-seeds from localStorage once a snapshot lands — how the pop-out output
// and a room's TV pick up a custom value (net/syncedStores.ts).
registerSyncedStore(STORAGE_KEY, () => {
  cache = null;
});

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store()));
  } catch {
    // Not fatal — custom values just won't survive a reload.
  }
}

function finite(x: unknown): number | undefined {
  return typeof x === "number" && Number.isFinite(x) ? x : undefined;
}

function entry(sceneId: string, key: string): Entry | undefined {
  const e = store()[sceneId]?.[key];
  return e && typeof e === "object" ? e : undefined;
}

function write(sceneId: string, key: string, patch: Entry): void {
  const s = store();
  const scene = (s[sceneId] ??= {});
  scene[key] = { ...entry(sceneId, key), ...patch };
  persist();
}

function drop(sceneId: string, key: string, field: keyof Entry | null): void {
  const scene = store()[sceneId];
  const e = scene?.[key];
  if (!scene || !e) return;
  if (field) delete e[field];
  if (!field || (e.v === undefined && e.s === undefined)) delete scene[key];
  if (Object.keys(scene).length === 0) delete store()[sceneId];
  persist();
}

export function getCustomValue(sceneId: string, key: string): number | undefined {
  return finite(entry(sceneId, key)?.v);
}

/** Stores `value` as given — callers fit it first (fitCustom). Rejects a
 *  non-finite number rather than storing it. Leaves the slider's stretch
 *  alone: a drag inside a stretched slider sets values without moving its
 *  end. stretchSlider is the separate call that moves it. */
export function setCustomValue(sceneId: string, key: string, value: number): void {
  if (!Number.isFinite(value)) return;
  write(sceneId, key, { v: value });
}

/** Drops the custom value, keeping the slider's stretch — what any write to
 *  the setting does (sceneSettings.ts's setSceneSetting). */
export function clearCustomValue(sceneId: string, key: string): void {
  drop(sceneId, key, "v");
}

/** Where the setting's slider is stretched to: past one end of its own range,
 *  so the slider covers [min, max] plus this. Undefined when it isn't. */
export function getSliderStretch(sceneId: string, key: string): number | undefined {
  return finite(entry(sceneId, key)?.s);
}

/** Moves the slider's stretched end to `to` — a typed custom value, or one a
 *  Look brings, lands with the thumb at the slider's end. */
export function stretchSlider(sceneId: string, key: string, to: number): void {
  if (!Number.isFinite(to)) return;
  write(sceneId, key, { s: to });
}

/** Drops the custom value and the stretch: ↺, the Scene card's Reset, Auto
 *  taking the setting, a Look without one for it. */
export function resetCustomValue(sceneId: string, key: string): void {
  drop(sceneId, key, null);
}

/** Drops every custom value on every scene — for debug.ts's
 *  window.__viz.clearPins(), so a headless run starts clean. */
export function clearAllCustomValues(): void {
  cache = {};
  persist();
}

/** Every custom value set, keyed `sceneId:key` — for the numeric probe. */
export function customValueSnapshot(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [sceneId, scene] of Object.entries(store())) {
    for (const key of Object.keys(scene)) {
      const v = getCustomValue(sceneId, key);
      if (v !== undefined) out[`${sceneId}:${key}`] = v;
    }
  }
  return out;
}

/** The slider's span with its stretch and any custom value folded in — what
 *  the panel draws the slider over (deviceMenu.ts's createControlRow). */
export function sliderSpan(range: { min: number; max: number }, ...extra: (number | undefined)[]): { lo: number; hi: number } {
  let lo = range.min;
  let hi = range.max;
  for (const x of extra) {
    if (x === undefined) continue;
    lo = Math.min(lo, x);
    hi = Math.max(hi, x);
  }
  return { lo, hi };
}

type Range = Pick<SceneSetting, "min" | "max" | "step" | "type">;

/** The span a custom value may take for this setting, or null when it takes
 *  none (a toggle, an option, or — outside a dev build — a count). See the
 *  header. */
export function customReach(range: Range, unbounded = false): { lo: number; hi: number } | null {
  if (range.type !== undefined) return null;
  if (unbounded) return { lo: -Infinity, hi: Infinity };
  if (range.step !== undefined && range.step >= 1) return null;
  const span = range.max - range.min;
  return { lo: range.min >= 0 ? Math.max(0, range.min - span) : range.min - span, hi: range.max + span };
}

/** `value` as a custom value for this setting: inside the slider's own range
 *  it is no custom value at all (null — the store takes it), past an end it
 *  is clamped into customReach, and a setting with no reach gets null. */
export function fitCustom(range: Range, value: number, unbounded = false): number | null {
  if (!Number.isFinite(value) || (value >= range.min && value <= range.max)) return null;
  const reach = customReach(range, unbounded);
  if (!reach) return null;
  return Math.min(reach.hi, Math.max(reach.lo, value));
}
