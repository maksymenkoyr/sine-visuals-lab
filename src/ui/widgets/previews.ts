import { STRAINS, DEPOSIT, LIFE_DEFAULT, NUTRIENT_REST, hueRotateRGB, resolveStrainEffective, type StrainRawValues, type StrainDriveValues } from "../../render/scenes/physarum2.ts";
import type { StrainPreviewMotion, PairCultureInputs } from "../../render/scenes/physarum2Preview.ts";
import { smellWeight } from "../../render/scenes/physarum2Affinity.ts";
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
 *
 * `PreviewSource.pair` (2026-09-27, the Pairs widget) is the two-strain
 * twin: a Pairs pad's own live culture (`createPairCulture`,
 * physarum2Preview.ts) needs `att`/`touch` read for one *pair* rather than
 * `resolveStrainEffective`'s single-strain motion, so it's a separate,
 * smaller reader instead of a second `effective()`-shaped function — it only
 * ever supplies `smell`/`touch`, never motion/colour (pairPads.ts already
 * has those from the same `effective()` this file's main registration
 * builds). `ctx.get`, not an Auto-resolved read — see `WidgetCtx.get`'s own
 * doc comment (registry.ts) — matches every other reader in this file.
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
  /** A Pairs pad's own live two-strain culture, if this family has a pairwise
   *  affinity table — see this file's header. Omitted (no registration) means
   *  the Pairs widget draws its pads with no live culture behind them. */
  pair?: {
    size: number;
    agents: number;
    /** `a`/`b` are two item indices (not necessarily adjacent) — the pad's
     *  own pair. Returns just enough for `PairCultureInputs`: local 2x2
     *  `smell`/`touch`, indexed `[0][*]` = `a`, `[1][*]` = `b`. */
    weights(ctx: WidgetCtx, a: number, b: number): Pick<PairCultureInputs, "smell" | "touch">;
  };
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

const STRAIN_PARAMS = ["nutrient", "excite", "sensor", "turn", "stride", "stain", "angle", "life"] as const;
/** The params that have a drive reading (a jack) — Sensor angle and Trail life have none. */
type DrivenParam = Exclude<StrainParam, "angle" | "life">;
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
      angle: specs.angle ? ctx.get(specs.angle) : STRAINS[k]!.sensorAngleRad / (Math.PI / 180),
      life: specs.life ? ctx.get(specs.life) : LIFE_DEFAULT,
    };
    // The drive readings the scene itself applied last frame (its probe()'s
    // drive_<param><k>), Scene defaults included — a band on Nutrient, the
    // beat pulse on Excitability — so a preview moves with the music the
    // way the dish does. ctx.driveValue, the fallback when the scene isn't
    // reporting, reads 0 while a control is still on "Scene" (see
    // WidgetCtx.driveValue's own doc comment), which left every preview
    // running without the music. Nutrient's fallback passes its own rest
    // (NUTRIENT_REST's doc): unplugged, its neutral isn't 0.
    const live = ctx.probe();
    const dv = (p: DrivenParam, rest = 0): number => {
      const v = live?.[`drive_${p}${k}`];
      if (typeof v === "number") return v;
      const spec = specs[p];
      return spec ? ctx.driveValue(spec, rest) : rest;
    };
    const drive: StrainDriveValues = {
      nutrient: dv("nutrient", NUTRIENT_REST),
      excite: dv("excite"),
      sensor: dv("sensor"),
      turn: dv("turn"),
      stride: dv("stride"),
      stain: dv("stain"),
    };
    const eff = resolveStrainEffective(k, raw, drive);
    const motion: StrainPreviewMotion = {
      sensorAngle: eff.sensorAngleRad,
      reach: eff.sensorDist / REF_TEXELS_PER_PREVIEW_CELL,
      turn: eff.rotationRad,
      step: eff.stepDist / REF_TEXELS_PER_PREVIEW_CELL,
      deposit: DEPOSIT * eff.feed,
      decayMul: eff.decayMul,
    };
    // Stain Synergy pulls the four stains toward a harmony in the dish; the
    // scene reports each stain as shown (probe's shownStain<k>), so the box
    // is the colour the dish actually runs, not the one set.
    const shown = live?.[`shownStain${k}`];
    const color =
      typeof shown === "number" ? hueRotateRGB(STRAINS[k]!.color, shown + (eff.stainShift - raw.stain)) : eff.color;
    return { motion, color };
  },
  pair: {
    // The prototype's own pair-culture numbers (affinity-studio.html's
    // `ensurePairCultures`) — six of these run at once, so smaller/fewer
    // agents than the four specimen boxes' own 96/4500.
    size: 72,
    agents: 1600,
    weights(ctx, a, b) {
      const attSpec = (i: number, j: number): SceneSetting | undefined =>
        ctx.specsFor("strain", i).find((s) => s.item?.param === "att" && s.item.other === j);
      const touchSpec = (i: number, j: number): SceneSetting | undefined =>
        ctx.specsFor("strain", i).find((s) => s.item?.param === "touch" && s.item.other === j);
      const rivalrySpec = ctx.specs.find((s) => s.key === "rivalry");
      const rivalry = rivalrySpec ? ctx.get(rivalrySpec) : 0.5;
      const att = (i: number, j: number): number => {
        const spec = attSpec(i, j);
        return spec ? smellWeight(ctx.get(spec), i, j, rivalry) : 0;
      };
      const touch = (i: number, j: number): number => {
        const spec = touchSpec(i, j);
        return spec ? ctx.get(spec) : 0;
      };
      return {
        smell: [
          [att(a, a), att(a, b)],
          [att(b, a), att(b, b)],
        ],
        touch: [
          [0, touch(a, b)],
          [touch(b, a), 0],
        ],
      };
    },
  },
});
