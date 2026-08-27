/**
 * Dev-only channel: vite-tuning-plugin.ts broadcasts tuning/params.json's
 * contents over Vite's existing HMR websocket every time that file changes
 * on disk. This applies the payload to the override layer (overrides.ts),
 * so the render loop picks it up on the very next frame — no reload, no
 * shader rebuild, audio never stops.
 */
import { clearAllOverrides, setAutoPinned, setOverride } from "./overrides.ts";
import { setFocus, type FocusEntry } from "./focus.ts";
import { DEFAULT_SLOT, tuningSlot } from "./session.ts";

export interface TuningParams {
  /** Which session this payload belongs to (see session.ts). The HMR socket
   *  is shared by every connected page, so a payload for another slot has to
   *  be ignored rather than applied. */
  slot?: string;
  /** Which scene's settings block applies. Absent/mismatched scene id ->
   *  settings are ignored (there's nothing to override on a scene that
   *  isn't currently mounted). */
  scene?: string;
  autoPin?: boolean;
  settings?: Record<string, number>;
  /** Settings to spotlight in the device menu — see focus.ts. Unlike
   *  `settings`, this changes nothing about the render; it just says which
   *  dials are under discussion so you can find them without hunting. */
  focus?: FocusEntry[];
}

/** Exported for debug.ts's window.__viz.setParams, which needs the exact
 *  same apply logic for a Playwright-driven push as for a file-watch push. */
export function applyTuningParams(params: TuningParams): void {
  clearAllOverrides();
  if (typeof params.autoPin === "boolean") setAutoPinned(params.autoPin);
  const sceneId = params.scene;
  if (sceneId && params.settings) {
    for (const [key, value] of Object.entries(params.settings)) {
      if (typeof value === "number" && Number.isFinite(value)) setOverride(sceneId, key, value);
    }
  }
  // Unscoped by scene on purpose: focus is advisory, and a list written just
  // before a scene switch should still be waiting when that scene mounts.
  setFocus(Array.isArray(params.focus) ? params.focus.filter((e) => e && typeof e.key === "string") : []);
}

export function initTuningBus(): void {
  const mySlot = tuningSlot() ?? DEFAULT_SLOT;

  // Picks up whatever's already on disk immediately, rather than waiting for
  // the next edit — the socket below only ever delivers changes made after
  // this page connects. Fire-and-forget: a fetch failure just means this
  // session starts with no overrides, same as if the params file were still
  // at its defaults.
  fetch(`/__tuning/params?slot=${encodeURIComponent(mySlot)}`)
    .then((res) => res.json())
    .then((params: TuningParams) => applyTuningParams(params))
    .catch(() => {});

  if (!import.meta.hot) return;
  import.meta.hot.on("viz:params", (params: TuningParams) => {
    // One socket, every connected page. Applying another slot's payload would
    // clear this page's overrides — the exact collision slots exist to stop.
    if ((params.slot ?? DEFAULT_SLOT) !== mySlot) return;
    applyTuningParams(params);
  });
}
