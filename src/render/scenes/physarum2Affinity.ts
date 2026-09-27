/**
 * Physarum 2's Affinity data and pure logic — DOM-free, and never imports
 * from physarum2.ts or anything under src/ui/ (the scene and the widget both
 * import from here instead of from each other, so there is no cycle). Home
 * to:
 * - `ATTRACT_ROWS`, the default Smell (`att<i><j>`) table — re-exported from
 *   physarum2.ts, since it lives here but the scene's settings still need it
 *   as their default and tests import it from physarum2.ts.
 * - `smellWeight`, the one place Hostility (the `rivalry` setting) folds
 *   into a raw `att` value — shared between the GPU's per-step packing
 *   (physarum2.ts's `resolveStrains`) and, once the pair cultures land, the
 *   Affinity pads' own preview math, so both read the exact same formula
 *   `resolveStrainEffective` already keeps in one place for the other
 *   per-strain settings.
 * - `packTouch`, which turns the raw `touch<i><j>` values into what the GPU
 *   actually consumes: a feed row added to the deposit colour, and an eat
 *   column consumed by the diffuse pass against last step's landing counts
 *   — see physarum2.ts's file header, "Touch" paragraph, for why eating
 *   needs a second render target and feeding doesn't.
 *
 * `PAIR_WORDS` (the Pairs widget's vocabulary), `AFFINITY_PRESETS` and the
 * pad/preset helper functions land here too, in a later pass over this
 * scene — see the plan at the top of the physarum2 record's "Resume here".
 */

/** Range and step every Smell (`att<i><j>`) and Touch (`touch<i><j>`)
 *  setting shares — a signed relation value, not a plain amount, so its
 *  meaning is its exact position (see SceneSetting.masterScale). */
export const AFFINITY_MIN = -1.5;
export const AFFINITY_MAX = 1.5;
export const AFFINITY_QUANTUM = 0.05;

/** Touch's three gains, shared by the GPU packing below and (once built)
 *  the CPU pair cultures, so a pad's preview and the main dish agree.
 *  TOUCH_FEED_GAIN was lowered from the prototype's 1.0 by eye on the GPU
 *  (2026-09-27): at 1.0, the Gardens preset (all off-diagonal touch = 0.6,
 *  every strain feeding every other) roughly triples a channel's total
 *  incoming deposit and clips the whole picture to white. 0.15 keeps black
 *  dominant while feeding still visibly brightens a fed trail. Most of
 *  Gardens' remaining brightness comes from its own Symbiosis *smell* table
 *  converging strains onto shared paths — confirmed with touch forced to 0
 *  — which is a preset-tuning question for Phase 2/2.1, not this gain.
 *  TOUCH_EAT_GAIN/TOUCH_MAX_BITE are still the prototype's values, checked
 *  only against synthetic audio so far (docs/scenes/physarum2.md,
 *  Measurements/Known issues once written up in Phase 4). */
export const TOUCH_FEED_GAIN = 0.15;
export const TOUCH_EAT_GAIN = 0.3;
export const TOUCH_MAX_BITE = 0.9;

/** Row i is strain i's *default* sensing weights against every strain's
 *  trail (itself included) — the `att<i><j>` settings' own default, and the
 *  "Rivals" experiment preset (src/ui/widgets/itemBoxes.ts's panel below).
 *  Diagonal near +1 (follow own trail), off-diagonal negative (avoid
 *  everyone else's), scaled live by the Hostility setting through
 *  `smellWeight` below. Fixed, hand-picked — not derived from Fogleman's own
 *  published table, which uses different values. Re-exported from
 *  physarum2.ts, which is the module every other file (and every test)
 *  imports it from — see this file's header. */
export const ATTRACT_ROWS: readonly [number, number, number, number][] = [
  [1.0, -0.85, -1.1, -0.7],
  [-1.2, 1.1, -0.6, -0.95],
  [-0.75, -1.05, 0.9, -1.25],
  [-1.0, -0.65, -1.15, 1.05],
];

/** Hostility (`rivalry`) folded into a raw Smell value — the formula
 *  SIM_FRAG used to apply inline (`w = row * (own + (1-own)*(uRivalry*2))`)
 *  before it moved to JS packing in `resolveStrains`. The diagonal (i ===
 *  j, "own trail") is unaffected; every off-diagonal entry scales with
 *  `rivalry` doubled, so rivalry 0.5 (its default/NEUTRAL value) is the
 *  identity and rivalry 0 zeroes every off-diagonal weight. */
export function smellWeight(att: number, i: number, j: number, rivalry: number): number {
  return i === j ? att : att * rivalry * 2;
}

/** `touch` is a row-major n×n matrix (n ≤ 4; the diagonal is ignored — Touch
 *  has no own-strain meaning, see `defineItemPairs`'s `diagonal: false`).
 *  Fills two vec4-per-strain arrays for the GPU:
 *  - `feedRows[k*4 + j]`: what strain k's deposit adds to strain j's trail —
 *    1 at j===k (own trail, unconditionally), plus `TOUCH_FEED_GAIN *
 *    max(0, touch[k][j])` for j !== k. At touch = 0 this is exactly onehot,
 *    so the deposit is bit-identical to the no-Touch scene.
 *  - `eatCols[j*4 + i]`: `L_ij = -ln(1 - min(TOUCH_MAX_BITE, TOUCH_EAT_GAIN
 *    * max(0, -touch[i][j])))` — victim channel j's per-landing decay
 *    exponent against eater i, chosen so that after n landings from strain i
 *    last step, `exp(-n * L_ij) === (1 - bite_ij)^n` exactly (the diffuse
 *    pass's own per-texel exponential of a *sum* of these, one per eating
 *    strain, reduces to that same per-strain product).
 *  Returns whether anything eats at all (`eatCols` has a nonzero entry) —
 *  physarum2.ts uses this to skip the whole footprint/MRT path (lazily
 *  building its targets only the first time it's needed) whenever every
 *  Touch value is ≥ 0, which is the scene's default and every feed-only
 *  table such as the Gardens preset. */
export function packTouch(
  touch: ArrayLike<number>,
  n: number,
  feedRows: Float32Array,
  eatCols: Float32Array,
): boolean {
  feedRows.fill(0);
  eatCols.fill(0);
  let eats = false;
  for (let i = 0; i < n; i++) {
    feedRows[i * 4 + i] = 1;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const v = touch[i * n + j]!;
      if (v > 0) {
        feedRows[i * 4 + j] = v * TOUCH_FEED_GAIN;
      } else if (v < 0) {
        eatCols[j * 4 + i] = -Math.log(1 - Math.min(TOUCH_MAX_BITE, -v * TOUCH_EAT_GAIN));
        eats = true;
      }
    }
  }
  return eats;
}
