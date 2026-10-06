/**
 * Client half of Alt+D (see debug.ts): builds the edit list for the active
 * scene and talks to /__tuning/defaults (vite-tuning-plugin.ts), which does
 * the actual source rewrite.
 *
 * Two "why" decisions, both load-bearing:
 *
 * - buildDefaultEdits reads with getSceneSetting (the stored manual value),
 *   never resolveSceneSetting (the live auto-resolved one). autoTune.ts's
 *   computeAutoTarget/computeMacroTarget are built on "at NEUTRAL dials,
 *   resolved === spec.default bit-for-bit"; baking the live-slewed resolved
 *   value would break that identity and drift it further on every bake.
 *   tuning/params.json ships autoPin: false (resolving Auto exactly like the
 *   deployed site — see docs/tuning.md), so a session judging a setting
 *   under Auto sets autoPin: true itself; with it set, resolve() returns the
 *   manual value instead, and the two coincide.
 * - A bake never clears sceneSettings.ts's store afterward. After the reload
 *   that a write triggers, the stored value and the freshly-compiled default
 *   are the same number, so the row's displayed value, its ↺ target, and the
 *   reset chip all already agree — clearing would only mean adding a delete
 *   path to sceneSettings.ts, a prod module, purely to serve a dev feature.
 * - A setting tagged `item` (src/render/sceneItems.ts) is always skipped,
 *   pin/override or not: its `default` was generated from the scene's own
 *   item table (STRAINS, say), not typed as a literal `default:` this
 *   file's server half could find and rewrite — there's nothing in source
 *   to bake it into. `skippedGenerated` reports these separately from
 *   `skipped` (pin/override) so Alt+D's "why didn't that bake" note can
 *   name the real reason instead of a misleading "pinned/overridden".
 */
import type { SceneSetting } from "../render/sceneSettings.ts";
import { getSceneSetting } from "../render/sceneSettings.ts";
import { getCustomValue } from "../render/customValues.ts";
import { getOverride } from "./overrides.ts";

export interface DefaultEdit {
  key: string;
  from: number;
  to: number;
}

export interface BakeResult {
  key: string;
  status: string;
  found?: number;
}

export interface BakeResponse {
  ok: boolean;
  file?: string;
  error?: string;
  results?: BakeResult[];
  paths?: string[];
  /** Keys skipped because a pin/override currently shadows the stored value
   *  — see the module header. Reported so a "why didn't that bake" is never
   *  silent. */
  skipped?: string[];
  /** Keys skipped because they're `item`-tagged (generated) — see the
   *  module header. */
  skippedGenerated?: string[];
  /** The edit list this call built and sent (or would send, on a dry run) —
   *  carried back so a caller can render "key from→to" without recomputing
   *  it, and so the Alt+D confirm step can commit exactly what its preview
   *  (a prior dry run) showed via bakeEdits below. */
  edits?: DefaultEdit[];
}

function decimalsOf(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const s = String(step);
  const dot = s.indexOf(".");
  return dot === -1 ? 0 : s.length - dot - 1;
}

/**
 * Pure edit-building rule, split out so a test can drive it without touching
 * sceneSettings.ts's module-level cache. Skips a setting whose current value
 * is non-finite (shouldn't happen — getSceneSetting always clamps — but a
 * defensive floor here costs nothing) or already equal to spec.default;
 * rounds to the spec's own step precision first to keep float dust (a drag
 * landing on 0.7000000000000001) out of the source file.
 */
export function buildDefaultEdits(
  specs: readonly SceneSetting[],
  read: (spec: SceneSetting) => number,
): DefaultEdit[] {
  const edits: DefaultEdit[] = [];
  for (const spec of specs) {
    // Generated — its default lives in the scene's own item table, not a
    // literal `default:` in source (see the module header).
    if (spec.item) continue;
    const raw = read(spec);
    if (!Number.isFinite(raw)) continue;
    const decimals = decimalsOf(spec.step);
    const rounded = Number(raw.toFixed(decimals));
    if (rounded === spec.default) continue;
    edits.push({ key: spec.key, from: spec.default, to: rounded });
  }
  return edits;
}

async function post(sceneId: string, edits: DefaultEdit[], dryRun: boolean): Promise<BakeResponse> {
  const res = await fetch("/__tuning/defaults", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scene: sceneId, edits, dryRun }),
  });
  const body = (await res.json()) as BakeResponse;
  return body;
}

export interface BakeOptions {
  /** true = resolve and validate everything, but write nothing (the Alt+D
   *  preview step). Defaults to false (commit the write). */
  dryRun?: boolean;
}

/**
 * Builds edits fresh from the current scene-setting store and POSTs them.
 * Short-circuits locally (no request) when there's nothing to bake.
 */
export async function bakeDefaults(
  sceneId: string,
  specs: readonly SceneSetting[],
  opts: BakeOptions = {},
): Promise<BakeResponse> {
  const skippedGeneratedKeys = specs.filter((s) => s.item).map((s) => s.key);
  const nonGenerated = specs.filter((s) => !s.item);
  const bakeable = nonGenerated.filter(
    (spec) => getCustomValue(sceneId, spec.key) === undefined && getOverride(sceneId, spec.key) === undefined,
  );
  const skippedKeys = nonGenerated.filter((s) => !bakeable.includes(s)).map((s) => s.key);
  const edits = buildDefaultEdits(bakeable, (spec) => getSceneSetting(sceneId, spec));
  const skipFields = {
    skipped: skippedKeys.length > 0 ? skippedKeys : undefined,
    skippedGenerated: skippedGeneratedKeys.length > 0 ? skippedGeneratedKeys : undefined,
  };
  if (edits.length === 0) {
    return { ok: true, results: [], ...skipFields, edits };
  }
  const body = await post(sceneId, edits, opts.dryRun === true);
  return { ...body, ...skipFields, edits };
}

/**
 * Commits an edit list captured earlier (by a prior dry run) rather than
 * rebuilding it from the live store — this is what makes the Alt+D confirm
 * step write exactly what its preview showed, even if a slider moved in the
 * meantime.
 */
export async function bakeEdits(sceneId: string, edits: DefaultEdit[]): Promise<BakeResponse> {
  if (edits.length === 0) return { ok: true, results: [], edits };
  const body = await post(sceneId, edits, false);
  return { ...body, edits };
}
