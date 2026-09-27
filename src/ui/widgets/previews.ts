import { STRAINS, DEPOSIT, resolveStrainEffective, type StrainRawValues, type StrainDriveValues } from "../../render/scenes/physarum2.ts";
import type { StrainPreviewMotion } from "../../render/scenes/physarum2Preview.ts";
import type { SceneSetting } from "../../render/sceneSettings.ts";
import type { WidgetCtx } from "./registry.ts";

/**
 * Maps an `itemBoxes.ts` `options.preview` id (see that file's header) to a
 * live source for one specimen box's preview — size/agent count, plus one
 * function that turns the current device-menu state into that strain's
 * `StrainPreviewMotion` + colour. A registration lives entirely on the UI
 * side (this file only ever imports `../../render/*` and other `src/ui/`
 * modules) even though it reads a concrete scene's exported pure helpers —
 * the constraint sceneItems.ts's header cares about is the other direction
 * (`src/render/` never importing `src/ui/`), which this doesn't cross.
 */

export interface PreviewEffective {
  motion: StrainPreviewMotion;
  color: readonly [number, number, number];
}

export interface PreviewSource {
  size: number;
  agents: number;
  /** `index` is the item's index within its family (itemBoxes.ts's own box
   *  order) — for physarum2 this is the strain index `k`. */
  effective(ctx: WidgetCtx, index: number): PreviewEffective;
}

const sources = new Map<string, PreviewSource>();

export function registerPreviewSource(id: string, source: PreviewSource): void {
  sources.set(id, source);
}

export function getPreviewSource(id: string): PreviewSource | undefined {
  return sources.get(id);
}

// ---------------------------------------------------------------------
// "physarum2" — the only registration today. Prototype values (size 96,
// 4500 agents per box — docs/scenes/physarum2/artifacts/lab.src.html's own
// createStrainPreview call).
// ---------------------------------------------------------------------

/** A box shows a patch of the field, not the whole thing: this converts
 *  physarum2.ts's `resolveStrainEffective` (reference-texel units, the same
 *  1024-wide reference space SIM_FRAG works in regardless of the real
 *  trail map's actual size) into this preview's own small torus's cell
 *  units. Picked, then checked by eye (headless screenshot,
 *  docs/scenes/physarum2.md's Phase 3 entry) so a box's grain reads like a
 *  zoomed-in patch of the strain's real network rather than either the
 *  whole field shrunk down or a meaninglessly tight zoom. */
const REF_TEXELS_PER_PREVIEW_CELL = 4;

const STRAIN_PARAMS = ["nutrient", "excite", "sensor", "turn", "stride", "stain"] as const;
type StrainParam = (typeof STRAIN_PARAMS)[number];

function strainSpecs(ctx: WidgetCtx, k: number): Record<StrainParam, SceneSetting | undefined> {
  const specs = ctx.specsFor("strain", k);
  const out = {} as Record<StrainParam, SceneSetting | undefined>;
  for (const p of STRAIN_PARAMS) out[p] = specs.find((s) => s.item?.param === p);
  return out;
}

registerPreviewSource("physarum2", {
  size: 96,
  agents: 4500,
  effective(ctx, k): PreviewEffective {
    const specs = strainSpecs(ctx, k);
    const raw: StrainRawValues = {
      nutrient: specs.nutrient ? ctx.get(specs.nutrient) : 0,
      excite: specs.excite ? ctx.get(specs.excite) : 0,
      sensor: specs.sensor ? ctx.get(specs.sensor) : 0,
      turn: specs.turn ? ctx.get(specs.turn) : 0,
      stride: specs.stride ? ctx.get(specs.stride) : 0,
      stain: specs.stain ? ctx.get(specs.stain) : 0,
    };
    // ctx.driveValue reads the exact same thing each control's own
    // sparkline shows — 0 while still on "Scene" (see WidgetCtx.driveValue's
    // own doc comment), the real reading once patched.
    const drive: StrainDriveValues = {
      nutrient: specs.nutrient ? ctx.driveValue(specs.nutrient) : 0,
      excite: specs.excite ? ctx.driveValue(specs.excite) : 0,
      sensor: specs.sensor ? ctx.driveValue(specs.sensor) : 0,
      turn: specs.turn ? ctx.driveValue(specs.turn) : 0,
      stride: specs.stride ? ctx.driveValue(specs.stride) : 0,
      stain: specs.stain ? ctx.driveValue(specs.stain) : 0,
    };
    const eff = resolveStrainEffective(k, raw, drive);
    const motion: StrainPreviewMotion = {
      sensorAngle: STRAINS[k]!.sensorAngleRad,
      reach: eff.sensorDist / REF_TEXELS_PER_PREVIEW_CELL,
      turn: eff.rotationRad,
      step: eff.stepDist / REF_TEXELS_PER_PREVIEW_CELL,
      deposit: DEPOSIT * eff.feed,
    };
    return { motion, color: eff.color };
  },
});
