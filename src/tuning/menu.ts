/**
 * The dev-only half of src/ui/deviceMenu.ts: the optional hooks that turn the
 * shipped settings panel into a tuning surface. Kept here rather than in
 * deviceMenu.ts so the menu stays a production module that merely accepts a
 * few extra deps, and so this whole file drops out of a prod build with the
 * rest of the tuning kit (see app.ts's import.meta.env.DEV branch).
 *
 * Two behaviours:
 *  - focus: report which rows a tuning session has spotlighted (focus.ts);
 *  - scrub: take a slider drag away from the saved-settings store and into
 *    the override layer, then report the value back to disk.
 */
import { focusFor, onFocusChange } from "./focus.ts";
import { setOverride } from "./overrides.ts";
import { isTuningSession } from "./session.ts";
import type { SceneSetting } from "../render/sceneSettings.ts";

/** Long enough that a drag posts once on settling rather than per input
 *  event, short enough that letting go feels like it landed. */
const WRITE_BACK_DEBOUNCE_MS = 250;

let pendingScene: string | null = null;
let pending: Record<string, number> = {};
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
  flushTimer = null;
  const scene = pendingScene;
  const settings = pending;
  pendingScene = null;
  pending = {};
  if (!scene || Object.keys(settings).length === 0) return;
  // Fire-and-forget: a failed write-back costs the session a reported value,
  // not the value itself — the override is already applied and on screen.
  fetch("/__tuning/params", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scene, settings }),
  }).catch(() => {});
}

function queueWriteBack(sceneId: string, key: string, value: number): void {
  // A scene switch mid-drag would otherwise post one scene's keys under
  // another's name; flush what's pending first.
  if (pendingScene !== null && pendingScene !== sceneId) flush();
  pendingScene = sceneId;
  pending[key] = value;
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, WRITE_BACK_DEBOUNCE_MS);
}

export interface TuningMenuHooks {
  getFocus?: (key: string) => { note?: string; from?: number; to?: number } | undefined;
  onFocusChange?: (listener: () => void) => () => void;
  onSceneSettingScrub?: (sceneId: string, spec: SceneSetting, value: number) => void;
}

export function createTuningMenuHooks(): TuningMenuHooks {
  const hooks: TuningMenuHooks = {
    getFocus: (key) => focusFor(key),
    onFocusChange,
  };

  // Only a page that asked to be a tuning session gets its slider drags
  // diverted. Without this, plain `npm run dev` would stop persisting scene
  // settings, which is a surprising thing for a dev build to do.
  if (isTuningSession()) {
    hooks.onSceneSettingScrub = (sceneId, spec, value) => {
      setOverride(sceneId, spec.key, value);
      queueWriteBack(sceneId, spec.key, value);
    };
  }

  return hooks;
}
