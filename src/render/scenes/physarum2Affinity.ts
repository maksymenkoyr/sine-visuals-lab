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
 * pad/preset helper functions land here too, alongside the Pairs widget that
 * reads them (src/ui/widgets/pairPads.ts):
 * - `PAIR_WORDS` is the *one* place every word the Pairs widget shows lives
 *   — band names, axis captions, button labels, the optional relation-name
 *   grid — so re-wording any of it never touches pairPads.ts itself. Its
 *   `showRelations` flag is off: a pad's header shows the two signed values
 *   (each coloured by its own strain), not a relation name, and the pad has
 *   no corner labels — the `relations` field per layer stays as tested,
 *   unused data for a possible later flip.
 * - `PAIR_LOOK` is the pads' colours/marker shapes — kept separate from
 *   `PAIR_WORDS` because it's look, not wording.
 * - `AFFINITY_PRESETS` replaces physarum2.ts's old `EXPERIMENT_PRESETS`: the
 *   same five Smell-only experiments (touch all zero) plus Hunt/Gardens/War,
 *   which also set the Touch table (`touchy: true`).
 * - The rest are pure helpers a pad needs and nothing else does: reading a
 *   value's band word (`wordBand`), which zone of the 3×3 relation grid a
 *   pad's (x, y) falls in (`pairZone`/`pairRelation`), turning a template
 *   string like `"{A} → {B}"` into coloured-strain tokens a widget can render
 *   without `innerHTML` (`fillTemplate`), a value's pad-square position
 *   (`padPos`/`padValue`), the six pair index combinations (`pairsOf`), a
 *   signed number with a real minus sign (`fmtSigned`), and a same-table
 *   check for the (not yet built) preset/mix-history comparison
 *   (`tablesMatch`).
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
 *  "Rivals" entry in `AFFINITY_PRESETS` below.
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

// ---------------------------------------------------------------------
// Pairs widget vocabulary — see this file's header. Every user-facing word
// the widget shows lives here; pairPads.ts never has a string literal of its
// own for anything a person reads.
// ---------------------------------------------------------------------

export type PairLayer = "smell" | "touch";

/** One band-word landmark on an axis — `at` is the value it's centred on
 *  (the tick a pad draws, and the value a keyboard Home/End-adjacent word
 *  reads closest to). Five per layer, ascending `at`. */
export interface PairBand {
  word: string;
  at: number;
}

export interface LayerWords {
  /** The Smell/Touch switch button's own heading and one-line subtitle. */
  title: string;
  subtitle: string;
  /** The paragraph under the switch explaining how to read/drive this
   *  layer's pads. */
  how: string;
  bands: readonly [PairBand, PairBand, PairBand, PairBand, PairBand];
  /** `wordBand`'s four edges between the five `bands` above, ascending. */
  bandEdges: readonly [number, number, number, number];
  /** Pad axis captions — "−" at the low end, `x`/`y` (a `fillTemplate`
   *  template, `{A}`/`{B}` the two strains) in the middle, "+" at the high
   *  end. No verbs (AGENTS.md's "Sliders: right = more" — an axis is a
   *  slider with two ends, not a sentence). */
  axis: { neg: string; pos: string; x: string; y: string };
  /** One direction's status phrase, a `fillTemplate` template taking `{A}`
   *  (the strain reading it), `{B}` (the strain it's read against) and the
   *  `word` var (that direction's lower-cased band word) —
   *  `"{word} {B}"` (Smell) or `"{word} {B}'s trail"` (Touch). */
  edge: string;
  /** Optional, unused while `PairWords.showRelations` is false — a 3×3 name
   *  grid indexed `[pairZone(x)+1][pairZone(y)+1]`, `fillTemplate` templates
   *  taking `{A}`/`{B}`, plus the four corner labels a pad would draw at its
   *  own four corners regardless of the live reading. */
  relations?: {
    zoneEdge: number;
    grid: readonly [
      readonly [string, string, string],
      readonly [string, string, string],
      readonly [string, string, string],
    ];
    corners: { tl: string; tr: string; bl: string; br: string };
  };
}

export interface PairWords {
  /** False (default): a pad's header shows its two live values, each
   *  coloured by its own strain, and a pad draws no corner labels. True
   *  shows `pairRelation`'s name and each layer's four corner labels
   *  instead — kept as tested, unused data for a possible later flip. */
  showRelations: boolean;
  layers: Record<PairLayer, LayerWords>;
  ui: {
    ownTrail: string;
    /** Replaces the own-trail strip on the Touch layer, which has no
     *  own-strain meaning (`defineItemPairs`'s `diagonal: false`). */
    ownNote: string;
    pairs: string;
    /** Shown in the status line while no pad has focus/hover/drag. */
    statusIdle: string;
    random: Record<PairLayer, string>;
    nudge: string;
    keepOwn: string;
    back: string;
    presetsSmell: string;
    presetsTouch: string;
    /** The hypothesis line once the stored tables match no preset. */
    customMix: string;
    /** A pad square's `aria-label` template (`{A}`/`{B}`). */
    padAria: string;
  };
}

/** Placeholder wording, from the `affinity-studio.html` prototype
 *  (`:291-321`, `:889-892`, `:964-967`) — the one point every word the Pairs
 *  widget shows can be re-worded from. `showRelations` stays off; each
 *  layer's `relations` grid is filled in anyway (from the prototype's
 *  "Current" naming set) so `pairRelation` has real data to test even though
 *  nothing draws it yet. */
export const PAIR_WORDS: PairWords = {
  showRelations: false,
  layers: {
    smell: {
      title: "Smell",
      subtitle: "which trails it steers toward",
      how: "Each pad is one pair. Drag the dot: across is how much the first strain follows the second's trail, up is the reverse.",
      bands: [
        { word: "Flees", at: -1.2 },
        { word: "Avoids", at: -0.6 },
        { word: "Ignores", at: 0 },
        { word: "Follows", at: 0.6 },
        { word: "Loves", at: 1.1 },
      ],
      bandEdges: [-0.9, -0.3, 0.3, 0.85],
      axis: { neg: "−", pos: "+", x: "{A} → {B}", y: "{B} → {A}" },
      edge: "{word} {B}",
      relations: {
        zoneEdge: 0.3,
        grid: [
          ["Wall", "{A} shuns {B}", "{B} chases {A}"],
          ["{B} shuns {A}", "Strangers", "{B} tails {A}"],
          ["{A} chases {B}", "{A} tails {B}", "Merge"],
        ],
        corners: { tl: "MERGE", tr: "CHASE", bl: "WALL", br: "CHASE" },
      },
    },
    touch: {
      title: "Touch",
      subtitle: "what its steps do to other trails",
      how: "Same pads, second table. Across is what the first strain's steps do to the second's trail: right feeds it, left eats it. Up is the reverse.",
      bands: [
        { word: "Devours", at: -1.2 },
        { word: "Eats", at: -0.6 },
        { word: "Spares", at: 0 },
        { word: "Feeds", at: 0.6 },
        { word: "Nurtures", at: 1.1 },
      ],
      bandEdges: [-0.9, -0.3, 0.3, 0.85],
      axis: { neg: "−", pos: "+", x: "{A} → {B}", y: "{B} → {A}" },
      edge: "{word} {B}'s trail",
      relations: {
        zoneEdge: 0.3,
        grid: [
          ["War", "{A} eats {B}", "{A} preys on {B}"],
          ["{B} eats {A}", "Harmless", "{B} feeds {A}"],
          ["{B} preys on {A}", "{A} feeds {B}", "Share"],
        ],
        corners: { tl: "SHARE", tr: "PREY", bl: "WAR", br: "PREY" },
      },
    },
  },
  ui: {
    ownTrail: "Own trail",
    ownNote: "Each strain always lays its own trail. Touch is only about everyone else's.",
    pairs: "Pairs",
    statusIdle: "Hover or drag a pad to read both directions, in both tables.",
    random: { smell: "Random smell", touch: "Random touch" },
    nudge: "Nudge",
    keepOwn: "Keep own trails",
    back: "Back",
    presetsSmell: "Smell only",
    presetsTouch: "With touch",
    customMix: "Custom mix — not one of the experiments above.",
    padAria: "{A} and {B}",
  },
};

/** Colours and marker shape a pad draws with, per layer — look, not
 *  wording, so it sits next to but separate from `PAIR_WORDS`. `pos`/`neg`/
 *  `mixed` are `"r,g,b"` strings (CSS `rgba(${c},alpha)` — the prototype's
 *  own convention), reused for a pad's quadrant tints and its value-to-colour
 *  ramp. */
export interface PairLook {
  pos: string;
  neg: string;
  mixed: string;
  marker: "dot" | "diamond";
}
export const PAIR_LOOK: Record<PairLayer, PairLook> = {
  smell: { pos: "140,230,160", neg: "239,106,106", mixed: "249,185,108", marker: "dot" },
  touch: { pos: "89,187,251", neg: "255,146,72", mixed: "195,165,249", marker: "diamond" },
};

/** Which of a layer's five `bands` a value falls in — inclusivity picks the
 *  band *farther from zero* exactly on an edge (`<=` on the negative pair of
 *  edges, `<` on the positive pair), so nudging a value that lands exactly on
 *  a landmark never silently rounds it toward the middle. */
export function wordBand(v: number, edges: readonly [number, number, number, number]): 0 | 1 | 2 | 3 | 4 {
  if (v <= edges[0]) return 0;
  if (v <= edges[1]) return 1;
  if (v < edges[2]) return 2;
  if (v < edges[3]) return 3;
  return 4;
}

/** Which side of centre a value reads as, for the 3×3 relation grid —
 *  strictly greater/less than `edge` (0 in the dead zone between). */
export function pairZone(v: number, edge: number): -1 | 0 | 1 {
  if (v > edge) return 1;
  if (v < -edge) return -1;
  return 0;
}

/** The relation name for a pad's current `(x, y)` reading, straight from
 *  `words.relations.grid` — `undefined` while relations aren't defined for
 *  this layer (or `PairWords.showRelations` is off, which the caller checks
 *  itself; this function doesn't read that flag). Still a template string
 *  (`{A}`/`{B}` unresolved) — the caller runs it through `fillTemplate`. */
export function pairRelation(words: LayerWords, x: number, y: number): string | undefined {
  const rel = words.relations;
  if (!rel) return undefined;
  const xZone = pairZone(x, rel.zoneEdge);
  const yZone = pairZone(y, rel.zoneEdge);
  return rel.grid[xZone + 1]?.[yZone + 1];
}

/** One piece of a filled template — either literal text or a strain index to
 *  render in that strain's own colour. Lets a widget build a relation/edge
 *  phrase as real DOM spans instead of `innerHTML`. */
export type PairToken = { text: string } | { strain: number };

const TEMPLATE_TOKEN_RE = /\{([A-Za-z]+)\}/g;

/** Splits `tpl` on `{A}`/`{B}` (resolved to `a`/`b`, coloured strain tokens)
 *  and any other `{name}` found in `vars` (resolved to plain text — the
 *  `edge` template's `{word}`) into a token list a caller renders itself. An
 *  unknown `{name}` with no matching `vars` entry passes through literally
 *  (bracket text kept as-is) rather than throwing, since every template here
 *  is this module's own data. */
export function fillTemplate(tpl: string, a: number, b: number, vars?: Record<string, string>): PairToken[] {
  const tokens: PairToken[] = [];
  let last = 0;
  for (const m of tpl.matchAll(TEMPLATE_TOKEN_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) tokens.push({ text: tpl.slice(last, idx) });
    const name = m[1]!;
    if (name === "A") tokens.push({ strain: a });
    else if (name === "B") tokens.push({ strain: b });
    else tokens.push({ text: vars?.[name] ?? m[0] });
    last = idx + m[0].length;
  }
  if (last < tpl.length) tokens.push({ text: tpl.slice(last) });
  return tokens;
}

/** A signed value with a real minus sign (U+2212, not a hyphen) — every
 *  numeric readout the Pairs widget draws next to a strain code. */
export function fmtSigned(v: number): string {
  return (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(2);
}

/** A value's position across a pad square, as a percentage (0..100, centred
 *  on 50 at v=0) — the prototype's own `pc`. 42, not 50, leaves room for the
 *  marker's own radius/ring at the extremes without clipping against the
 *  pad's border. */
export function padPos(v: number): number {
  return 50 + (v / AFFINITY_MAX) * 42;
}

/** `padPos`'s inverse, clamped to `[AFFINITY_MIN, AFFINITY_MAX]` — a pointer
 *  position outside the pad's own drawn range still yields a valid, clamped
 *  value (the prototype's own `pv`). */
export function padValue(pct: number): number {
  const v = ((pct - 50) / 42) * AFFINITY_MAX;
  return Math.max(AFFINITY_MIN, Math.min(AFFINITY_MAX, v));
}

/** Every unordered pair over `0..n-1`, ascending — the six pads' own (a, b)
 *  order for `n = SPECIES_COUNT`. */
export function pairsOf(n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) out.push([i, j]);
  }
  return out;
}

/** True once every cell of two same-shaped tables agrees within `eps` — the
 *  prototype's own tolerance (a slider/localStorage float round-trip), used
 *  to decide whether the stored tables match a named preset. */
export function tablesMatch(a: readonly (readonly number[])[], b: readonly (readonly number[])[], eps = 0.011): boolean {
  return a.every((row, i) => row.every((v, j) => Math.abs(v - b[i]![j]!) < eps));
}

// ---------------------------------------------------------------------
// Presets — replaces physarum2.ts's old EXPERIMENT_PRESETS (Smell-only) with
// the same five plus three that also set Touch (`touchy: true`).
// ---------------------------------------------------------------------

export interface AffinityPreset {
  name: string;
  hypothesis: string;
  smell: readonly (readonly number[])[];
  touch: readonly (readonly number[])[];
  touchy: boolean;
}

const ZERO_TOUCH: readonly (readonly number[])[] = [
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
];

/** `v` off the diagonal, 0 on it — Gardens'/War's own Touch table. */
function offDiagTouch(v: number): number[][] {
  return [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => (i === j ? 0 : v)));
}

const SYMBIOSIS_SMELL: readonly (readonly number[])[] = [
  [1, 0.35, 0.2, 0.1],
  [0.3, 1, 0.35, 0.15],
  [0.15, 0.3, 1, 0.35],
  [0.35, 0.15, 0.25, 1],
];

const CHASE_SMELL: readonly (readonly number[])[] = [
  [0.6, 1.2, 0, -1.2],
  [-1.2, 0.6, 1.2, 0],
  [0, -1.2, 0.6, 1.2],
  [1.2, 0, -1.2, 0.6],
];

/** Copied from the approved "Physarum Lab" prototype
 *  (docs/scenes/physarum2/artifacts/lab.src.html's EXPERIMENTS) — matrices
 *  and one-line hypotheses, unchanged, plus Hunt/Gardens/War (2026-09-27,
 *  the user's Pairs + Touch decision — see docs/scenes/physarum2.md). "Rivals"
 *  is this scene's own `ATTRACT_ROWS` default. */
export const AFFINITY_PRESETS: readonly AffinityPreset[] = [
  { name: "Rivals", hypothesis: "Every strain guards its own territory.", smell: ATTRACT_ROWS, touch: ZERO_TOUCH, touchy: false },
  { name: "Symbiosis", hypothesis: "Strains share each other's routes.", smell: SYMBIOSIS_SMELL, touch: ZERO_TOUCH, touchy: false },
  { name: "Chase", hypothesis: "Each strain hunts the next and flees the last.", smell: CHASE_SMELL, touch: ZERO_TOUCH, touchy: false },
  {
    name: "Mob",
    hypothesis: "Everyone piles onto everyone's trails.",
    smell: [
      [1, 0.8, 0.8, 0.8],
      [0.8, 1, 0.8, 0.8],
      [0.8, 0.8, 1, 0.8],
      [0.8, 0.8, 0.8, 1],
    ],
    touch: ZERO_TOUCH,
    touchy: false,
  },
  {
    name: "Self-avoid",
    hypothesis: "Like real slime mould, each strain shuns its own old slime and explores.",
    smell: [
      [-0.6, 0, 0, 0],
      [0, -0.6, 0, 0],
      [0, 0, -0.6, 0],
      [0, 0, 0, -0.6],
    ],
    touch: ZERO_TOUCH,
    touchy: false,
  },
  {
    name: "Hunt",
    hypothesis: "Each strain chases the next and eats the trail it chases.",
    smell: CHASE_SMELL,
    touch: [
      [0, -1.2, 0, 0],
      [0, 0, -1.2, 0],
      [0, 0, 0, -1.2],
      [-1.2, 0, 0, 0],
    ],
    touchy: true,
  },
  {
    name: "Gardens",
    hypothesis: "Strains share routes and feed each other's trails.",
    smell: SYMBIOSIS_SMELL,
    touch: offDiagTouch(0.6),
    touchy: true,
  },
  {
    name: "War",
    hypothesis: "Every strain guards its ground and eats everyone else's trail.",
    smell: ATTRACT_ROWS,
    touch: offDiagTouch(-0.9),
    touchy: true,
  },
];
