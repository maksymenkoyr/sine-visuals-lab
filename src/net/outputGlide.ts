import { mixPalettes, type Palette } from "../render/palette.ts";
import type { SceneSetting } from "../render/sceneSettings.ts";
import {
  SCENE_EXPANSION_DEFAULT,
  SCENE_EXPANSION_KEY,
  SCENE_MASTER_DEFAULT,
  SCENE_MASTER_KEY,
  SCENE_SETTINGS_KEY,
} from "../render/sceneSettings.ts";
import type { OutputParams, OutputState } from "./outputSync.ts";

/**
 * The output window's smooth arrival: Play held for a moment sends the look
 * across over several seconds instead of switching at once (the hold gesture
 * itself is src/ui/outputKeys.ts; the output page, src/output.ts, drives
 * this every frame). The safe version — a glide only ever touches values
 * that are known to be fine to walk through:
 *  - a plain numeric slider of the scene on screen (glideSafe below);
 *  - the two device-wide Master dials (Scale and Expansion);
 *  - the resolved Sensitivity / Expansion / Smoothing (`OutputParams`).
 * Everything else — toggles, choice chips, a scene's Style (its variant),
 * per-item widgets, whole-number steppers, a slider that declares
 * `glide: false`, every other stored key — stays exactly as the output had it
 * for the whole glide and switches to the new value in one step when the
 * glide ends. A different scene is never glided: createGlide returns null for
 * it, and the output crossfades into it instead (render/compositor.ts, over
 * the same length the hold earned — outputBridge.ts's go passes it through).
 *
 * The palette fades on its own clock, createPaletteFade below, over the same
 * length: a palette is only colours, so every step between two is a fine
 * picture, and it fades whether or not createGlide found anything to walk —
 * a palette-only Play included, and across a scene's crossfade too. The page
 * keeps the look's palette id as it was; only what it draws with moves.
 *
 * Pure: no DOM, no clock of its own — `lookAt(nowMs)` is the look to show then.
 */

/** Longest glide the hold gesture may ask for. */
export const GLIDE_MAX_MS = 30_000;
/** Shortest; a hold that barely passed the tap threshold still reads as a glide. */
export const GLIDE_MIN_MS = 1_000;

/** A setting the glide may walk through: a plain, fine-stepped slider. A
 *  whole-number stepper is usually a count or a seed, which does work every
 *  time it changes — it switches in one step instead. */
export function glideSafe(spec: SceneSetting): boolean {
  return (
    spec.glide !== false &&
    spec.type === undefined &&
    !spec.variant &&
    !spec.variantDefaults &&
    !spec.item &&
    spec.step < 1
  );
}

export interface GlideStep {
  /** The look to show at this moment. */
  state: OutputState;
  /** True once the glide has arrived — `state` is then exactly the target. */
  done: boolean;
}

export interface Glide {
  lookAt(nowMs: number): GlideStep;
}

type SceneStore = Record<string, Record<string, unknown>>;

function parseStore(raw: string | undefined): SceneStore {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as SceneStore) : {};
  } catch {
    return {};
  }
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, e: number): number {
  return a + (b - a) * e;
}

interface SettingChannel {
  scope: string;
  key: string;
  from: number;
  to: number;
}

interface DialChannel {
  key: string;
  from: number;
  to: number;
}

const DIALS: ReadonlyArray<{ key: string; fallback: number }> = [
  { key: SCENE_MASTER_KEY, fallback: SCENE_MASTER_DEFAULT },
  { key: SCENE_EXPANSION_KEY, fallback: SCENE_EXPANSION_DEFAULT },
];

/** Plans a glide from what the output shows (`from`) to the new look (`to`),
 *  or null when there is nothing to glide: another scene, or no glide-safe
 *  value that actually differs. `specs` are the on-screen scene's settings. */
export function createGlide(
  from: OutputState,
  to: OutputState,
  specs: readonly SceneSetting[],
  startMs: number,
  durMs: number,
): Glide | null {
  if (from.scene !== to.scene) return null;
  const dur = Math.min(GLIDE_MAX_MS, Math.max(1, durMs));

  const fromStore = parseStore(from.storage[SCENE_SETTINGS_KEY]);
  const toStore = parseStore(to.storage[SCENE_SETTINGS_KEY]);
  const scene = from.scene;
  const safe = specs.filter(glideSafe);

  const settings: SettingChannel[] = [];
  const scopes = new Set([...Object.keys(fromStore), ...Object.keys(toStore)]);
  for (const scope of scopes) {
    if (scope !== scene && !scope.startsWith(`${scene}@`)) continue;
    for (const spec of safe) {
      const a = num(fromStore[scope]?.[spec.key]) ?? spec.default;
      const b = num(toStore[scope]?.[spec.key]) ?? spec.default;
      if (a !== b) settings.push({ scope, key: spec.key, from: a, to: b });
    }
  }

  const dials: DialChannel[] = [];
  for (const { key, fallback } of DIALS) {
    const a = from.storage[key] === undefined ? fallback : Number(from.storage[key]);
    const b = to.storage[key] === undefined ? fallback : Number(to.storage[key]);
    if (Number.isFinite(a) && Number.isFinite(b) && a !== b) dials.push({ key, from: a, to: b });
  }

  const paramsDiffer =
    from.params.sens !== to.params.sens || from.params.exp !== to.params.exp || from.params.smoothing !== to.params.smoothing;
  if (settings.length === 0 && dials.length === 0 && !paramsDiffer) return null;

  return {
    lookAt(nowMs) {
      const t = Math.min(1, Math.max(0, (nowMs - startMs) / dur));
      if (t >= 1) return { state: to, done: true };
      const e = smoothstep(t);

      const storage: Record<string, string> = { ...from.storage };
      if (settings.length > 0) {
        const store: SceneStore = {};
        for (const scope of Object.keys(fromStore)) store[scope] = { ...fromStore[scope] };
        for (const c of settings) (store[c.scope] ??= {})[c.key] = lerp(c.from, c.to, e);
        storage[SCENE_SETTINGS_KEY] = JSON.stringify(store);
      }
      for (const c of dials) storage[c.key] = String(lerp(c.from, c.to, e));

      const params: OutputParams = {
        sens: lerp(from.params.sens, to.params.sens, e),
        exp: lerp(from.params.exp, to.params.exp, e),
        smoothing: lerp(from.params.smoothing, to.params.smoothing, e),
      };
      return { state: { scene: from.scene, palette: from.palette, storage, params }, done: false };
    },
  };
}

export interface PaletteFade {
  /** The palette to draw with at `nowMs`: `to` itself once the fade is over. */
  paletteAt(nowMs: number): Palette;
}

/** Fades the colours from `from` (what the screen draws with now, a fade's
 *  half-way mix included) to `to`, on the same curve and clamp as a glide, or
 *  null when they are the same palette. */
export function createPaletteFade(from: Palette, to: Palette, startMs: number, durMs: number): PaletteFade | null {
  if (from === to) return null;
  const dur = Math.min(GLIDE_MAX_MS, Math.max(1, durMs));
  return {
    paletteAt(nowMs) {
      const t = Math.min(1, Math.max(0, (nowMs - startMs) / dur));
      return t >= 1 ? to : mixPalettes(from, to, smoothstep(t));
    },
  };
}
