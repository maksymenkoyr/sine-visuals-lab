/**
 * Dev-only channel: vite-tuning-plugin.ts broadcasts tuning/params.json's
 * contents over Vite's existing HMR websocket every time that file changes
 * on disk. This applies the payload to the override layer (overrides.ts),
 * so the render loop picks it up on the very next frame — no reload, no
 * shader rebuild, audio never stops.
 */
import { clearAllOverrides, setAutoPinned, setOverride } from "./overrides.ts";

export interface TuningParams {
  /** Which scene's settings block applies. Absent/mismatched scene id ->
   *  settings are ignored (there's nothing to override on a scene that
   *  isn't currently mounted). */
  scene?: string;
  autoPin?: boolean;
  settings?: Record<string, number>;
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
}

export function initTuningBus(): void {
  // Picks up whatever's already on disk immediately, rather than waiting for
  // the next edit — the socket below only ever delivers changes made after
  // this page connects. Fire-and-forget: a fetch failure just means this
  // session starts with no overrides, same as if tuning/params.json were
  // still at its defaults.
  fetch("/__tuning/params")
    .then((res) => res.json())
    .then((params: TuningParams) => applyTuningParams(params))
    .catch(() => {});

  if (!import.meta.hot) return;
  import.meta.hot.on("viz:params", (params: TuningParams) => applyTuningParams(params));
}
