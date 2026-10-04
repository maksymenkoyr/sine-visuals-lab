import type { SceneSetting } from "../../render/sceneSettings.ts";
import {
  AFFINITY_MAX,
  AFFINITY_MIN,
  fillTemplate,
  fmtSigned,
  layerPadPos,
  layerPadValue,
  nudgeTable,
  padPos,
  padValue,
  pairRelation,
  pairSentence,
  pairsOf,
  popHistory,
  pushHistory,
  randomSmell,
  randomTouch,
  tablesMatch,
  PAIR_LOOK,
  RARELY_MEET_OVERLAP,
  type AffinityPreset,
  type AffinityTables,
  type PairLayer,
  type PairToken,
  type PairWords,
} from "../../render/scenes/physarum2Affinity.ts";
import {
  createPairCulture,
  pairContactPixelsInto,
  pairOverlap,
  trailQuantile,
  type PairCulture,
  type PairCultureInputs,
} from "../../render/scenes/physarum2Preview.ts";
import type { WidgetCtx } from "./registry.ts";
import type { PreviewEffective, PreviewSource } from "./previews.ts";
import { rowHeadStyle, rowLabelStyle, spacer } from "../controlsKit.ts";
import { SCENE_VIOLET } from "../controlsTheme.ts";
import { setHintText } from "../hintSwatches.ts";

/**
 * The Pairs widget: one live two-strain culture per pad, a Smell/Touch
 * switch, an own-trail strip (Smell only) and named presets — the
 * `itemBoxes.ts` `options.relations` block's actual DOM, replacing the old
 * `relationRows.ts`/`relationWeb.ts` pair. `buildPairPads` is a sub-builder
 * called directly by `itemBoxes.ts`, not a second `registerWidget` entry, so
 * it shares the boxes' own preview source and per-tick strain readings
 * instead of opening a second set. Affinity has no selection: the pads cover
 * every strain pair at once (see "No selection styling" below).
 *
 * Built once per widget mount (`buildPairPads` runs once) and updated in
 * place from then on — `tick` only touches text/transforms/canvas pixels — so
 * a pad's own live culture (see below) is never restarted by a click the way
 * a full rebuild would restart it.
 *
 * Every word a person reads here comes from `PairWords` (physarum2Affinity.ts)
 * — this file has no label/sentence literal of its own for anything other
 * than an `aria-label` scaffold. `PairWords.showRelations` is off by default:
 * a pad's header is hidden (the two numbers live in the cursor hint, see
 * "Clearer pads" below) and a pad draws no corner labels —
 * `pairRelation`/`relations.corners` are read only when a caller flips
 * `showRelations` on.
 *
 * **Numbers, not band words (2026-09-27 feedback).** An own-trail fader's
 * value shows a plain signed number, never a `PairWords.layers.*.bands` word
 * ("Flees"/"Devours"/…) — user testing found the band words read as confusing
 * rather than clarifying. The bands stay in `PairWords` as tested, unused
 * data (same status as `showRelations`). The pad's own words are the ones
 * "Clearer pads" added: axis-end verbs and the hint's sentences, which come
 * from each layer's `verbs` ladder, not from the bands.
 *
 * **Flat around zero (2026-09-28).** Touch pads and the own-trail faders map
 * the pointer through `padValue` (and draw through its inverse `padPos`),
 * which bends the line by `PAD_CURVE` so the stretch around a relation's sign
 * flip is fine and gentle, steeper toward the edges. Smell pads no longer do:
 * they use the squeezed `SMELL_PAD_KNOTS` map (`layerPadPos`/`layerPadValue`
 * pick between the two per layer).
 *
 * **Clearer pads (2026-10-02).** The user tried three versions of the pads on
 * a trial page (docs/scenes/physarum2/artifacts/pairs-trial.html) and picked
 * this one; that page's script is the reference behaviour. What changed, and
 * why:
 * - *Colours.* Each strain keeps its own colour and the ground the two share
 *   turns white (`pairContactPixelsInto`), each channel scaled to its own
 *   bright end — the old additive mix clipped dense paths and blended two
 *   similar hues into one (measured: docs/scenes/physarum2/scripts/
 *   padresponse.mjs). The quadrant tints and band ticks are gone; the picture
 *   itself now says which corner is which.
 * - *Squeezed Smell map.* On a Smell pad only values 0…+1 change the picture
 *   (anything below 0 looks the same, and so does anything above +1), so
 *   `SMELL_PAD_KNOTS` gives that band most of the pad and the zero lines sit
 *   off-centre. Touch keeps the flat-around-zero curve.
 * - *Words.* The axis ends say "avoids"/"follows" and "eats"/"feeds" instead
 *   of −/+ (the user: bare signs read as "not informative"), four small
 *   pictures in a Smell pad's corners show apart / together / who chases whom,
 *   and a sentence follows the cursor (`pairSentence`, e.g. "A follows B
 *   closely") with the two numbers beside it. The numbers moved there from the
 *   pad header; the status line below reads the same sentences.
 * - *Hold still, settle.* The pad under the pointer skips beat reseeds, and
 *   letting go of a drag runs its culture `PAD_SETTLE_STEPS` steps at once
 *   (violet ring for a moment) so it shows the result instead of drifting to
 *   it.
 * - *Spotlight.* While a pad is hovered, dragged or keyboard-focused, `tick`
 *   sends `command("spotlight", { a, b })` every tick and the scene dims the
 *   other strains (physarum2.ts's file header). Phone-local like every
 *   command — the pop-out output and a TV never dim.
 *

 * **Values are continuous.** Dragging a pad or an own-trail fader stores at
 * 0.01 resolution (`round01` below) — not the settings' own 0.05 `step`,
 * which only bounds a keyboard nudge and the Scene panel's generic numeric
 * input for this same setting. AGENTS.md's "Sliders: right = more" rule
 * applies on both axes: right/up always reads more of whatever the axis
 * names, never less.
 *
 * **The mix row (Phase 3).** Random/Nudge/Keep own trails/Back, every
 * preset pill and `randomize` share one rule: **push before you write**.
 * Each first snapshots both live tables (`snapshot()`) onto
 * `PairState.history` (a module-level stack, same survives-a-rebuild
 * convention as the culture cache below), then writes the new values through
 * `writeTable`, which skips any cell whose stored value already matches —
 * Random/Nudge/Back/a preset would otherwise persist all 12 (Touch) or 16
 * (Smell) settings to localStorage on every click regardless of how many
 * cells actually moved (`sceneSettings.ts`'s own per-`ctx.set` persist).
 * This card's Random and Nudge only ever touch the layer on screen;
 * `randomize`, a preset and Back write both tables. Random's button was
 * folded into the Strains card's one Random on 2026-10-03 and came back on
 * 2026-10-04 (the user: "return those buttons … but also keep global
 * random"): the Strains card's Random (itemBoxes.ts) still calls
 * `randomize` and the Strain Console's own, so this card's Back undoes just
 * its half of that roll. Keep own trails is a plain toggle (Smell only,
 * hidden on Touch like the own-trail strip itself) with no history entry of
 * its own — flipping it changes no value. None of this
 * calls `ctx.rerender()`; `tick()` already reflects a `ctx.set` on the next
 * frame the same way a slider drag does.
 *
 * **Its own card, four rows (2026-09-28).** The user: "the problem is this
 * whole card not clickable and never gets focus" (unlike every other row in
 * the panel, the block never woke on hover/focus and a press never pinned
 * it) and "also can u add some air. make this for example as separate card,
 * with gaps [pointing at the pads grid]." `itemBoxes.ts` now mounts this
 * whole widget through `ctx.mountCard` (registry.ts) instead of appending it
 * into the Scene card body after a plain `groupHeading` — a real card
 * (title "Affinity", `SCENE_VIOLET`, its own `foldId`) that sits right after
 * the Scene card and is torn down and rebuilt by `renderSceneSettings`
 * exactly like the Scene card's own contents. Inside it, the switch, the
 * own-trail strip, the pads grid and the mix row each became a plain
 * `.vc-row` (controlsTheme.ts's own wake-on-hover/focus grammar) registered
 * pinnable through `ctx.registerCard` — see that function's own doc comment
 * (registry.ts) for the synthetic-`SceneSetting` pin identity a row like the
 * pairs grid or the mix row needs, since neither edits one single setting.
 * The long per-layer `how` paragraph moved into the Layer row's own
 * `.vc-hint` (hidden until that row wakes); the pairs row's status line
 * stays outside its hint and always visible, since a value read only while
 * hovered would go blank mid-drag the moment a captured pointer left the
 * row's own box. `.vc-pads`' own gap (controlsTheme.ts) grew for the "gaps"
 * the user asked for.
 *
 * **No selection styling (2026-09-28 follow-up).** The user, after seeing
 * only three of six pads keep their normal look once a strain box was
 * selected: "why only three works? clean up this focus mess around this
 * card." The box selection (itemBoxes.ts) no longer reaches into this
 * widget at all — every pad and own-trail fader renders identically
 * regardless of which strain box is selected; the only highlights left here
 * are the `.vc-row` wake/pin rings the card work above adds and the plain
 * `:focus-visible` outline a pad/fader already had. `setSelection` and the
 * `vc-pad-sel`/`vc-pad-dim`/`vc-own-sel`/`vc-own-dim` rules it drove are
 * gone; itemBoxes.ts's own box selection (the strain rows below the boxes)
 * is unaffected.
 */

export interface PairPadsSpec {
  ctx: WidgetCtx;
  /** The Affinity card's body (`WidgetCtx.mountCard`, built by itemBoxes.ts)
   *  — this builder appends its whole DOM into it directly rather than
   *  handing an element back for the caller to place. */
  container: HTMLElement;
  family: string;
  count: number;
  /** Full display codes, e.g. "PP-A1" — the pad's `aria-label` and the
   *  status line's own strain naming. */
  labels: readonly string[];
  /** Short codes, e.g. "A1" — axis captions and pad-header values, where a
   *  full code would crowd a small square. */
  shortLabels: readonly string[];
  /** Per-item CSS colour, same order as `labels`. */
  colours: readonly string[];
  /** `item.param` of each pair table this widget edits. `touch` omitted
   *  hides the Smell/Touch switch entirely (a family with only one pair
   *  table). */
  tables: { smell: string; touch?: string };
  words: PairWords;
  presets: readonly AffinityPreset[];
  /** This item's live motion + Stain-shifted colour — the exact
   *  `PreviewSource.effective` reader itemBoxes.ts already computes for the
   *  specimen boxes' own single-strain preview, reused here so a pad's
   *  culture moves and tints exactly like the box (and the main dish)
   *  instead of a second, drifting copy of the same formula. Omitted (no
   *  registered preview source) draws every pad with a blank canvas — see
   *  `pair`, below. */
  effective?: (k: number) => PreviewEffective;
  /** A live two-strain culture per pad — see `previews.ts`'s `PreviewSource.
   *  pair`. Omitted draws every pad with a blank (never-stepped) canvas. */
  pair?: NonNullable<PreviewSource["pair"]>;
  /** `${sceneId}:${family}` — keys the module-level layer/culture state that
   *  has to survive a Look apply or a card Reset (both rebuild this widget
   *  from scratch) exactly like `itemBoxes.ts`'s own `previewCache`. */
  stateKey: string;
}

export interface PairPadsHandle {
  /** The Strains card's Random (itemBoxes.ts): rolls Smell (`randomSmell`,
   *  under this card's Keep own trails toggle) and Touch
   *  (`randomTouch`) together, as one entry on this card's Back. */
  randomize(): void;
  /** Reads live values, redraws changed pads' markers/header/status, and
   *  (every other call, visible pads only) steps + redraws each pad's live
   *  culture — called from `itemBoxes.ts`'s `ctx.onTick`. */
  tick(): void;
  dispose(): void;
}

// ---------------------------------------------------------------------
// Module-level state that must survive a full widget rebuild (a Look apply,
// a card Reset — see this file's header) — same convention as itemBoxes.ts's
// own previewCache/pipetteArmedByFamily.
// ---------------------------------------------------------------------

interface PairState {
  layer: PairLayer;
  /** Smell-only: Random/Nudge leave the own-trail diagonal untouched instead
   *  of rolling/jittering it — see `randomSmell`/`nudgeTable`. */
  keepOwn: boolean;
  /** The mix-row undo stack — see this file's header. Module-level so it
   *  survives a Look apply or a card Reset the same way `pairCultureCache`
   *  does; in memory only (a reload starts empty). */
  history: AffinityTables[];
}
const pairState = new Map<string, PairState>();

const PAIR_CULTURE_CACHE_MAX = 24;
const pairCultureCache = new Map<string, PairCulture>();

/** How fast a pad's culture runs, in steps per second of wall time — near
 *  the scene's own step rate, so a pad regrows after a beat reseed at the
 *  pace the main dish does. PAD_MAX_STEPS_PER_TICK caps the catch-up after a
 *  slow frame, so a stall never turns into a burst of CPU work. */
const PAD_STEPS_PER_SEC = 60;
const PAD_MAX_STEPS_PER_TICK = 4;
/** Every this many ticks a visible pad re-measures its picture: the bright
 *  end each channel is scaled to (`trailQuantile`) and how much ground the two
 *  strains share (`pairOverlap`). The exposure is smoothed (an EMA) so the
 *  picture never jumps when a dense patch forms or breaks up. */
const PAD_MEASURE_EVERY = 20;
/** Steps a pad's culture runs the moment a drag is released, so the pad shows
 *  where the new setting leads instead of drifting there over a few seconds. */
const PAD_SETTLE_STEPS = 120;
/** How long the settled ring (`vc-pad-settled`) stays on, in ms. */
const PAD_SETTLED_MS = 450;

function cachedCulture(key: string, size: number, agents: number, seed: number): PairCulture {
  let c = pairCultureCache.get(key);
  if (!c) {
    c = createPairCulture({ size, agents, seed });
    pairCultureCache.set(key, c);
    if (pairCultureCache.size > PAIR_CULTURE_CACHE_MAX) {
      const oldest = pairCultureCache.keys().next().value;
      if (oldest !== undefined) pairCultureCache.delete(oldest);
    }
  }
  return c;
}

// ---------------------------------------------------------------------
// Small pure helpers local to this file.
// ---------------------------------------------------------------------

function round01(v: number): number {
  return Math.round(v * 100) / 100;
}

function clampAff(v: number): number {
  return Math.max(AFFINITY_MIN, Math.min(AFFINITY_MAX, v));
}

/** Parses this codebase's own `cssColor` output (physarum2.ts), `"rgb(r, g,
 *  b)"`, back to 0..1 floats — the fallback when a spec gives no `effective`
 *  reader for a culture's render tint. */
function parseCssRgb(css: string): readonly [number, number, number] {
  const m = /rgb\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(css);
  if (!m) return [1, 1, 1];
  return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255];
}

const SVG_NS = "http://www.w3.org/2000/svg";
/** Focuses `el` for a pointer press so its arrow keys work, tagged
 *  `vc-pf` until the next key or blur. The press's preventDefault makes
 *  Chrome read the script focus as keyboard focus and draw the
 *  :focus-visible ring on a mouse press; controlsTheme.ts hides the ring
 *  while the tag is on, so it only shows for real keyboard focus. */
function pointerFocus(el: HTMLElement): void {
  el.classList.add("vc-pf");
  el.focus({ preventScroll: true });
  if (el.dataset.pfWired) return;
  el.dataset.pfWired = "1";
  el.addEventListener("keydown", () => el.classList.remove("vc-pf"));
  el.addEventListener("blur", () => el.classList.remove("vc-pf"));
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  parent?: Element,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
  for (const k in attrs) el.setAttribute(k, String(attrs[k]));
  if (parent) parent.appendChild(el);
  return el;
}

/** Renders a `fillTemplate` token list into `host` as real DOM (a plain text
 *  node per `{text}` token, a coloured `<span>` per `{strain}` token) — never
 *  `innerHTML`, so a strain's short code needs no HTML-escaping. */
function renderTokens(host: HTMLElement, tokens: readonly PairToken[], shortLabels: readonly string[], colours: readonly string[]): void {
  host.replaceChildren();
  for (const t of tokens) {
    if ("strain" in t) {
      const span = document.createElement("span");
      span.style.color = colours[t.strain] ?? "#fff";
      span.textContent = shortLabels[t.strain] ?? "";
      host.appendChild(span);
    } else {
      host.appendChild(document.createTextNode(t.text));
    }
  }
}

function findPairSpec(ctx: WidgetCtx, family: string, param: string, i: number, j: number): SceneSetting | undefined {
  return ctx.specsFor(family, i).find((s) => s.item?.param === param && s.item.other === j);
}

/** A synthetic pin identity for one of this widget's four rows — see
 *  `WidgetCtx.registerCard`'s own doc comment (registry.ts) for why a
 *  non-drive `SceneSetting`-shaped token, not a real per-cell `att`/`touch`
 *  spec, is the right choice: a row here can touch many cells at once (the
 *  whole pads grid, the mix buttons), so no single real spec would honestly
 *  name it. `key` only ever needs to be unique within this one widget mount
 *  (`stateKey` already is, per-scene-per-family) — never read by
 *  `ctx.get`/`ctx.set`, never part of `ctx.specs`/`ctx.specsFor`. */
function rowSpec(stateKey: string, part: string, label: string): SceneSetting {
  return { key: `${stateKey}:row:${part}`, label, min: 0, max: 1, step: 1, default: 0 };
}

/** One of this card's four `.vc-row`s: a `.vc-label` head, a body the caller
 *  fills, and a `.vc-hint` that unfolds on hover/focus like any other row
 *  (controlsTheme.ts) — pinnable through `ctx.registerCard` with `row`
 *  itself as its own "value control" (registry.ts's own doc comment), so a
 *  press anywhere in it — a pad, a fader, a button — pins it. */
function buildRow(ctx: WidgetCtx, spec: SceneSetting, title: string, hint: string): { row: HTMLElement; body: HTMLElement; hintEl: HTMLElement } {
  const row = document.createElement("div");
  row.className = "vc-row";
  row.style.setProperty("--vc-accent", SCENE_VIOLET);
  const head = document.createElement("div");
  head.style.cssText = rowHeadStyle;
  const label = document.createElement("div");
  label.className = "vc-label";
  label.style.cssText = rowLabelStyle;
  label.textContent = title;
  head.appendChild(label);
  const body = document.createElement("div");
  const hintEl = document.createElement("div");
  hintEl.className = "vc-hint";
  setHintText(hintEl, hint);
  row.append(head, body, hintEl);
  ctx.registerCard(row, spec);
  return { row, body, hintEl };
}

// ---------------------------------------------------------------------
// The builder.
// ---------------------------------------------------------------------

export function buildPairPads(spec: PairPadsSpec): PairPadsHandle {
  const { ctx, container, family, count, labels, shortLabels, colours, tables, words, presets, effective, pair, stateKey } = spec;

  let state = pairState.get(stateKey);
  if (!state) {
    state = { layer: "smell", keepOwn: false, history: [] };
    pairState.set(stateKey, state);
  }
  const hasTouch = !!tables.touch;

  // Resolved once, not on every read: `ctx.specsFor` filters the scene's
  // *whole* settings list, and `specFor` used to call it (then `.find`) on
  // every single value read — tableOf() alone did 32 of those a tick just to
  // build a preset-match signature. Under CPU throttling that showed up as a
  // real cost (padcost.mjs: p95 grew ~17 ms with pads scrolled fully
  // off-screen, so it was never the cultures' own step/draw work) — a plain
  // `(SceneSetting | undefined)[][]` per layer, built once here, turns every
  // read back into an array index.
  const specGrid: Record<PairLayer, (SceneSetting | undefined)[][]> = { smell: [], touch: [] };
  for (const layer of ["smell", "touch"] as const) {
    const param = layer === "smell" ? tables.smell : tables.touch;
    if (!param) continue;
    for (let i = 0; i < count; i++) {
      const row: (SceneSetting | undefined)[] = [];
      for (let j = 0; j < count; j++) row.push(findPairSpec(ctx, family, param, i, j));
      specGrid[layer][i] = row;
    }
  }
  function specFor(layer: PairLayer, i: number, j: number): SceneSetting | undefined {
    return specGrid[layer][i]?.[j];
  }
  function getVal(layer: PairLayer, i: number, j: number): number {
    const s = specFor(layer, i, j);
    return s ? ctx.get(s) : 0;
  }
  function setVal(layer: PairLayer, i: number, j: number, v: number): void {
    const s = specFor(layer, i, j);
    if (s) ctx.set(s, round01(clampAff(v)));
  }
  function tableOf(layer: PairLayer): number[][] {
    const out: number[][] = [];
    for (let i = 0; i < count; i++) {
      const row: number[] = [];
      for (let j = 0; j < count; j++) {
        // Touch's diagonal has no setting at all (`diagonal: false`) and every
        // preset/random/nudge table encodes it as exactly 0 — reading it back
        // as 0 here (not Smell's own-trail value) is what lets `tablesMatch`
        // against `AFFINITY_PRESETS`' touch tables (and a pushed snapshot's
        // round trip through Back) actually agree on the diagonal.
        row.push(i === j ? (layer === "smell" ? getVal("smell", i, j) : 0) : getVal(layer, i, j));
      }
      out.push(row);
    }
    return out;
  }
  function snapshot(): AffinityTables {
    return { smell: tableOf("smell"), touch: tableOf("touch") };
  }
  /** Writes `table` into `layer`'s settings, skipping any cell whose stored
   *  value already matches within `round01`'s own resolution — see this
   *  file's header, "The mix row". Touch's diagonal cells have no backing
   *  setting; `setVal` already no-ops when `specFor` finds none, so no
   *  special-case is needed here. */
  function writeTable(layer: PairLayer, table: readonly (readonly number[])[]): void {
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < count; j++) {
        const v = round01(clampAff(table[i]![j]!));
        if (Math.abs(getVal(layer, i, j) - v) < 0.005) continue;
        setVal(layer, i, j, v);
      }
    }
  }

  const root = document.createElement("div");
  root.className = "vc-pair";

  // --- Row 1: Smell / Touch switch ---------------------------------------
  const layerRow = buildRow(ctx, rowSpec(stateKey, "layer", "Affinity layer"), words.ui.layer, "");
  const layerBtns = new Map<PairLayer, HTMLButtonElement>();
  if (hasTouch) {
    const layersEl = document.createElement("div");
    layersEl.className = "vc-pair-layers";
    layersEl.setAttribute("role", "radiogroup");
    layersEl.setAttribute("aria-label", words.ui.pairs);
    (["smell", "touch"] as const).forEach((ly) => {
      const w = words.layers[ly];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "radio");
      btn.className = `vc-pair-layer vc-pair-layer-${ly}`;
      const b = document.createElement("b");
      b.textContent = w.title;
      const s = document.createElement("span");
      s.textContent = w.subtitle;
      btn.append(b, s);
      btn.addEventListener("click", () => setLayer(ly));
      layerBtns.set(ly, btn);
      layersEl.appendChild(btn);
    });
    layerRow.body.appendChild(layersEl);
  }

  // --- Row 2: own-trail strip (Smell only) -------------------------------
  const ownRow = buildRow(ctx, rowSpec(stateKey, "own", "Own trail"), words.ui.ownTrail, words.ui.ownHint);
  const ownStripEl = document.createElement("div");
  ownStripEl.className = "vc-own-strip";
  const ownNoteEl = document.createElement("p");
  ownNoteEl.className = "vc-own-note";
  ownNoteEl.textContent = words.ui.ownNote;
  ownRow.body.append(ownStripEl, ownNoteEl);

  interface OwnFader {
    thumb: HTMLElement;
    fill: HTMLElement;
    valueEl: HTMLElement;
    k: number;
  }
  const ownFaders: OwnFader[] = [];
  for (let k = 0; k < count; k++) {
    const box = document.createElement("div");
    box.className = "vc-own";
    box.style.setProperty("--c", colours[k] ?? "#fff");
    const code = document.createElement("div");
    code.className = "vc-own-code";
    code.textContent = shortLabels[k] ?? "";
    code.style.color = colours[k] ?? "#fff";

    const fader = document.createElement("div");
    fader.className = "vc-vfader";
    fader.tabIndex = 0;
    fader.setAttribute("role", "slider");
    fader.setAttribute("aria-orientation", "vertical");
    fader.setAttribute("aria-label", `${labels[k] ?? ""} own trail`);
    fader.setAttribute("aria-valuemin", String(AFFINITY_MIN));
    fader.setAttribute("aria-valuemax", String(AFFINITY_MAX));
    const track = document.createElement("div");
    track.className = "vc-vfader-track";
    const fill = document.createElement("div");
    fill.className = "vc-vfader-fill";
    const thumb = document.createElement("div");
    thumb.className = "vc-vfader-thumb";
    fader.append(track, fill, thumb);

    const own = specFor("smell", k, k);
    const defaultVal = own ? own.default : 1;
    let dragging = false;
    const fromPointer = (e: PointerEvent): void => {
      const r = fader.getBoundingClientRect();
      const t = r.height > 0 ? 1 - (e.clientY - r.top) / r.height : 0.5;
      // padValue, the inverse of the padPos the thumb is drawn with: the
      // thumb stays under the pointer, and the fader shares the pads' flat
      // stretch around zero (PAD_CURVE).
      setVal("smell", k, k, padValue(t * 100));
    };
    fader.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      pointerFocus(fader);
      fader.setPointerCapture(e.pointerId);
      dragging = true;
      fromPointer(e);
    });
    fader.addEventListener("pointermove", (e) => {
      if (dragging) fromPointer(e);
    });
    fader.addEventListener("pointerup", () => {
      dragging = false;
    });
    fader.addEventListener("pointercancel", () => {
      dragging = false;
    });
    fader.addEventListener("dblclick", () => setVal("smell", k, k, defaultVal));
    fader.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 0.25 : 0.05;
      const d = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step }[e.key];
      if (d !== undefined) {
        setVal("smell", k, k, getVal("smell", k, k) + d);
        e.preventDefault();
      } else if (e.key === "Home") {
        setVal("smell", k, k, AFFINITY_MIN);
        e.preventDefault();
      } else if (e.key === "End") {
        setVal("smell", k, k, AFFINITY_MAX);
        e.preventDefault();
      }
    });

    const valueEl = document.createElement("div");
    valueEl.className = "vc-own-val";

    box.append(code, fader, valueEl);
    ownStripEl.appendChild(box);
    ownFaders.push({ thumb, fill, valueEl, k });
  }

  // --- Row 3: pairs status + pads grid ------------------------------------
  const pairsRow = buildRow(ctx, rowSpec(stateKey, "pairs", "Affinity pairs"), words.ui.pairs, words.ui.pairsHint);

  const statusEl = document.createElement("p");
  statusEl.className = "vc-pair-status";
  statusEl.id = `${stateKey.replace(/[^a-zA-Z0-9]/g, "-")}-pair-status`;
  statusEl.setAttribute("aria-live", "polite");
  pairsRow.body.appendChild(statusEl);

  const padsGrid = document.createElement("div");
  padsGrid.className = "vc-pads";
  pairsRow.body.appendChild(padsGrid);

  interface PadHandle {
    a: number;
    b: number;
    el: HTMLElement;
    sq: HTMLElement;
    canvas: HTMLCanvasElement;
    offscreen: HTMLCanvasElement | undefined;
    culture: PairCulture | undefined;
    imgBuf: Uint8ClampedArray | undefined;
    /** Owns `imgBuf` (its `data`), made once — `pixelsInto` fills the buffer
     *  and putImageData reads it back through this, with no per-tick copy. */
    img: ImageData | undefined;
    headEl: HTMLElement;
    marker: SVGGElement;
    guideX: SVGLineElement;
    guideY: SVGLineElement;
    lastX: number | undefined;
    lastY: number | undefined;
    visible: boolean;
    /** The pointer is over the pad / a drag on it is live — the spotlight, the
     *  cursor hint and the hold-still rule (no beat reseed) read these. */
    hot: boolean;
    dragging: boolean;
    /** Each channel's bright end the contact picture scales to
     *  (`trailQuantile(…, 0.98)`, smoothed) and the share of ground the two
     *  strains have in common (`pairOverlap`) — see `measurePad`. */
    exposure: [number, number];
    overlap: number;
    settleTimer: number | undefined;
  }

  const pads: PadHandle[] = [];
  let focusIdx = -1;
  // The cursor hint's subject and pointer position (see `refreshHint`), and
  // whether the last tick told the scene to spotlight a pair.
  let hintPad: PadHandle | undefined;
  let hintX = 0;
  let hintY = 0;
  let spotOn = false;
  const pairs = pairsOf(count);

  pairs.forEach(([a, b], idx) => {
    const padEl = document.createElement("div");
    padEl.className = "vc-pad";

    const headEl = document.createElement("div");
    headEl.className = "vc-pad-head";
    // The two numbers moved into the cursor hint ("Clearer pads"); the header
    // only has content while `words.showRelations` names the relation. A plain
    // style toggle, not `hidden`: `.vc-pad-head` has its own authored `display`.
    if (!words.showRelations) headEl.style.display = "none";

    const bodyEl = document.createElement("div");
    bodyEl.className = "vc-pad-body";
    const ycap = document.createElement("div");
    ycap.className = "vc-pad-ycap";
    const xcap = document.createElement("div");
    xcap.className = "vc-pad-xcap";

    const sq = document.createElement("div");
    sq.className = "vc-pad-sq";
    sq.tabIndex = 0;
    sq.setAttribute("role", "group");
    sq.setAttribute("aria-label", fillTemplate(words.ui.padAria, a, b).map((t) => ("text" in t ? t.text : labels[t.strain] ?? "")).join(""));
    sq.setAttribute("aria-describedby", statusEl.id);

    const canvas = document.createElement("canvas");
    canvas.className = "vc-pad-canvas";
    canvas.setAttribute("aria-hidden", "true");
    const svg = svgEl("svg", { viewBox: "0 0 100 100", preserveAspectRatio: "none" });
    svg.setAttribute("aria-hidden", "true");
    sq.append(canvas, svg);

    bodyEl.append(ycap, sq, xcap);
    padEl.append(headEl, bodyEl);
    padsGrid.appendChild(padEl);

    let offscreen: HTMLCanvasElement | undefined;
    let culture: PairCulture | undefined;
    let imgBuf: Uint8ClampedArray | undefined;
    let img: ImageData | undefined;
    if (pair) {
      culture = cachedCulture(`${stateKey}:pair:${a}${b}`, pair.size, pair.agents, 2000 + idx * 131);
      offscreen = document.createElement("canvas");
      offscreen.width = pair.size;
      offscreen.height = pair.size;
      img = new ImageData(pair.size, pair.size);
      imgBuf = img.data;
    }

    // Placeholder guide/marker elements, detached — `drawPadChrome` (called
    // at the end of this loop body, and again on every layer switch) always
    // builds and attaches the real ones, so these never actually draw
    // anything; they only exist so `PadHandle`'s fields have a value before
    // that first call.
    const pad: PadHandle = {
      a,
      b,
      el: padEl,
      sq,
      canvas,
      offscreen,
      culture,
      imgBuf,
      img,
      headEl,
      marker: svgEl("g", {}),
      guideX: svgEl("line", {}),
      guideY: svgEl("line", {}),
      lastX: undefined,
      lastY: undefined,
      visible: false,
      hot: false,
      dragging: false,
      exposure: culture ? [trailQuantile(culture.trails()[0], 0.98), trailQuantile(culture.trails()[1], 0.98)] : [0, 0],
      overlap: culture && pair ? pairOverlap(culture.trails(), pair.size) : 0,
      settleTimer: undefined,
    };
    pads.push(pad);

    const fromPointer = (e: PointerEvent): void => {
      const r = sq.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const xPct = ((e.clientX - r.left) / r.width) * 100;
      const yPct = ((e.clientY - r.top) / r.height) * 100;
      setVal(state!.layer, a, b, layerPadValue(state!.layer, xPct));
      setVal(state!.layer, b, a, layerPadValue(state!.layer, 100 - yPct));
      redrawPad(pad);
    };
    sq.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      pointerFocus(sq);
      sq.setPointerCapture(e.pointerId);
      pad.dragging = true;
      focusIdx = idx;
      hintPad = pad;
      hintX = e.clientX;
      hintY = e.clientY;
      fromPointer(e);
      refreshHint();
    });
    sq.addEventListener("pointermove", (e) => {
      hintX = e.clientX;
      hintY = e.clientY;
      if (pad.dragging) fromPointer(e);
      if (hintPad === pad) placeHint();
    });
    // pointerup and pointercancel both end the drag; only a real release
    // settles the culture (a cancelled gesture did not choose that value).
    const endDrag = (settle: boolean): void => {
      if (!pad.dragging) return;
      pad.dragging = false;
      if (settle) settlePad(pad);
      if (!pad.hot && hintPad === pad) hintPad = undefined;
      refreshHint();
    };
    sq.addEventListener("pointerup", () => endDrag(true));
    sq.addEventListener("pointercancel", () => endDrag(false));
    sq.addEventListener("pointerenter", (e) => {
      pad.hot = true;
      focusIdx = idx;
      hintPad = pad;
      hintX = e.clientX;
      hintY = e.clientY;
      refreshHint();
    });
    sq.addEventListener("pointerleave", () => {
      pad.hot = false;
      if (!pad.dragging) {
        if (focusIdx === idx) focusIdx = -1;
        if (hintPad === pad) hintPad = undefined;
        refreshHint();
      }
    });
    sq.addEventListener("focus", () => {
      focusIdx = idx;
    });
    sq.addEventListener("keydown", (e) => {
      const s = e.shiftKey ? 0.25 : 0.05;
      if (e.key === "ArrowRight") setVal(state!.layer, a, b, getVal(state!.layer, a, b) + s);
      else if (e.key === "ArrowLeft") setVal(state!.layer, a, b, getVal(state!.layer, a, b) - s);
      else if (e.key === "ArrowUp") setVal(state!.layer, b, a, getVal(state!.layer, b, a) + s);
      else if (e.key === "ArrowDown") setVal(state!.layer, b, a, getVal(state!.layer, b, a) - s);
      else return;
      e.preventDefault();
      redrawPad(pad);
    });
    sq.addEventListener("dblclick", () => {
      const sSpec = specFor(state!.layer, a, b);
      const tSpec = specFor(state!.layer, b, a);
      setVal(state!.layer, a, b, sSpec ? sSpec.default : 0);
      setVal(state!.layer, b, a, tSpec ? tSpec.default : 0);
      redrawPad(pad);
    });

    drawPadChrome(pad);
  });

  /** One of the four corner pictures on a Smell pad: apart, together, or who
   *  chases whom — drawn in the two strains' own colours. `aChasesB` is the
   *  bottom-right corner (A's pull on B high, B's on A low), `bChasesA` the
   *  top-left. The same shapes as the trial page's `icon()`. */
  function cornerIcon(kind: "apart" | "together" | "aChasesB" | "bChasesA", corner: string, a: number, b: number): HTMLSpanElement {
    const ca = colours[a] ?? "#fff";
    const cb = colours[b] ?? "#fff";
    const span = document.createElement("span");
    span.className = `vc-pad-ic vc-pad-ic-${corner}`;
    span.setAttribute("aria-hidden", "true");
    const svg = svgEl("svg", { viewBox: "0 0 22 12" }, span);
    svg.setAttribute("aria-hidden", "true");
    const arrow = (): void => {
      svgEl(
        "path",
        {
          d: "M8.5 6h5m-2-2.2 2.2 2.2-2.2 2.2",
          stroke: "rgba(255,255,255,.75)",
          "stroke-width": 1.2,
          fill: "none",
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        },
        svg,
      );
    };
    if (kind === "apart") {
      svgEl("circle", { cx: 4, cy: 6, r: 3.2, fill: ca }, svg);
      svgEl("path", { d: "M11 1.5v9", stroke: "rgba(255,255,255,.6)", "stroke-width": 1.2 }, svg);
      svgEl("circle", { cx: 18, cy: 6, r: 3.2, fill: cb }, svg);
    } else if (kind === "together") {
      svgEl("circle", { cx: 9, cy: 6, r: 3.8, fill: ca }, svg);
      svgEl("circle", { cx: 13, cy: 6, r: 3.8, fill: cb, "fill-opacity": 0.85 }, svg);
    } else if (kind === "aChasesB") {
      svgEl("circle", { cx: 4, cy: 6, r: 3.2, fill: ca }, svg);
      arrow();
      svgEl("circle", { cx: 18, cy: 6, r: 3.2, fill: cb }, svg);
    } else {
      svgEl("circle", { cx: 4, cy: 6, r: 3.2, fill: cb }, svg);
      arrow();
      svgEl("circle", { cx: 18, cy: 6, r: 3.2, fill: ca }, svg);
    }
    return span;
  }

  /** Redraws everything about a pad's SVG/canvas layout that depends on the
   *  active layer (zero axes, corner pictures, marker shape) — called on mount
   *  and on every layer switch, never per-tick (see this file's header). */
  function drawPadChrome(pad: PadHandle): void {
    const layer = state!.layer;
    const w = words.layers[layer];
    const look = PAIR_LOOK[layer];
    // `:scope > svg`, not a plain "svg": the corner pictures each hold an svg
    // of their own and sit before this one, so a descendant search would find
    // a picture's svg on every redraw after the first.
    const svg = pad.sq.querySelector(":scope > svg")!;
    svg.replaceChildren();
    // The four corner pictures are HTML, not part of the stretched svg
    // (preserveAspectRatio="none" would squash them), and sit behind it so the
    // marker draws over them. Smell only: Touch has no chase to picture.
    for (const old of Array.from(pad.sq.querySelectorAll(".vc-pad-ic"))) old.remove();
    if (layer === "smell") {
      pad.sq.insertBefore(cornerIcon("bChasesA", "tl", pad.a, pad.b), svg);
      pad.sq.insertBefore(cornerIcon("together", "tr", pad.a, pad.b), svg);
      pad.sq.insertBefore(cornerIcon("apart", "bl", pad.a, pad.b), svg);
      pad.sq.insertBefore(cornerIcon("aChasesB", "br", pad.a, pad.b), svg);
    }
    // The zero lines sit where the layer's own map puts 0 (off-centre on Smell).
    const zero = layerPadPos(layer, 0);
    svgEl("line", { x1: zero, y1: 0, x2: zero, y2: 100, class: "vc-pad-axis" }, svg);
    svgEl("line", { x1: 0, y1: 100 - zero, x2: 100, y2: 100 - zero, class: "vc-pad-axis" }, svg);
    if (words.showRelations && w.relations) {
      const c = w.relations.corners;
      const corner = (x: number, y: number, anchor: string, text: string): void => {
        const t = svgEl("text", { x, y, "text-anchor": anchor, class: "vc-pad-corner" }, svg);
        t.textContent = text;
      };
      corner(96, 9, "end", c.tr);
      corner(4, 96, "start", c.bl);
      corner(96, 96, "end", c.br);
      corner(4, 9, "start", c.tl);
    }
    pad.guideX = svgEl("line", { class: "vc-pad-guide" }, svg);
    pad.guideY = svgEl("line", { class: "vc-pad-guide" }, svg);
    pad.marker = svgEl("g", { class: "vc-pad-marker" }, svg);
    if (state!.layer === "touch") {
      svgEl("path", { d: "M0,-6.6 L6.6,0 L0,6.6 L-6.6,0 Z", fill: colours[pad.a] ?? "#fff" }, pad.marker);
      svgEl("path", { d: "M0,-6.6 L6.6,0 L0,6.6 Z", fill: colours[pad.b] ?? "#fff" }, pad.marker);
      svgEl("path", {
        d: "M0,-7.6 L7.6,0 L0,7.6 L-7.6,0 Z",
        fill: "none",
        stroke: `rgb(${look.pos})`,
        "stroke-width": 1.2,
        class: "vc-pad-ring",
      }, pad.marker);
    } else {
      svgEl("circle", { r: 5.6, fill: colours[pad.a] ?? "#fff" }, pad.marker);
      svgEl("path", { d: "M0,-5.6 A5.6,5.6 0 0 1 0,5.6 Z", fill: colours[pad.b] ?? "#fff" }, pad.marker);
      svgEl("circle", { r: 6.4, fill: "none", class: "vc-pad-ring-white" }, pad.marker);
    }
    pad.lastX = undefined;
    pad.lastY = undefined;

    pad.el.querySelector(".vc-pad-ycap")!.replaceChildren();
    const ycapNeg = document.createElement("span");
    ycapNeg.className = "vc-pad-sign";
    ycapNeg.textContent = w.axis.neg;
    const ycapMid = document.createElement("span");
    renderTokens(ycapMid, fillTemplate(w.axis.y, pad.a, pad.b), shortLabels, colours);
    const ycapPos = document.createElement("span");
    ycapPos.className = "vc-pad-sign";
    ycapPos.textContent = w.axis.pos;
    pad.el.querySelector(".vc-pad-ycap")!.append(ycapNeg, ycapMid, ycapPos);

    pad.el.querySelector(".vc-pad-xcap")!.replaceChildren();
    const xcapNeg = document.createElement("span");
    xcapNeg.className = "vc-pad-sign";
    xcapNeg.textContent = w.axis.neg;
    const xcapMid = document.createElement("span");
    renderTokens(xcapMid, fillTemplate(w.axis.x, pad.a, pad.b), shortLabels, colours);
    const xcapPos = document.createElement("span");
    xcapPos.className = "vc-pad-sign";
    xcapPos.textContent = w.axis.pos;
    pad.el.querySelector(".vc-pad-xcap")!.append(xcapNeg, xcapMid, xcapPos);
  }

  /** Updates one pad's marker position/guides/header — cheap, called
   *  whenever that pad's own (x, y) changed (a drag, a keypress, or the
   *  per-tick read below). */
  function redrawPad(pad: PadHandle): void {
    const layer = state!.layer;
    const x = getVal(layer, pad.a, pad.b);
    const y = getVal(layer, pad.b, pad.a);
    if (pad.lastX === x && pad.lastY === y) return;
    pad.lastX = x;
    pad.lastY = y;
    const X = layerPadPos(layer, x);
    const Y = 100 - layerPadPos(layer, y);
    const Z = layerPadPos(layer, 0);
    pad.marker.setAttribute("transform", `translate(${X} ${Y})`);
    pad.guideX.setAttribute("x1", String(X));
    pad.guideX.setAttribute("y1", String(Y));
    pad.guideX.setAttribute("x2", String(X));
    pad.guideX.setAttribute("y2", String(100 - Z));
    pad.guideY.setAttribute("x1", String(X));
    pad.guideY.setAttribute("y1", String(Y));
    pad.guideY.setAttribute("x2", String(Z));
    pad.guideY.setAttribute("y2", String(Y));

    if (words.showRelations) {
      const rel = pairRelation(words.layers[layer], x, y);
      pad.headEl.replaceChildren();
      const beh = document.createElement("span");
      beh.className = "vc-pad-beh";
      if (rel) renderTokens(beh, fillTemplate(rel, pad.a, pad.b), shortLabels, colours);
      pad.headEl.appendChild(beh);
    }
  }

  // --- Row 4: mix row (Phase 3: Random / Nudge / Keep own trails / Back) +
  // presets --------------------------------------------------------------
  const mixSectionRow = buildRow(ctx, rowSpec(stateKey, "mix", "Affinity mix"), words.ui.mixTitle, words.ui.mixHint);

  const mixRow = document.createElement("div");
  mixRow.className = "vc-mix-row";
  // This card's own Random rolls the layer on screen (back 2026-10-04); the
  // Strains card's Random still rolls both through `randomize`.
  const randomBtn = document.createElement("button");
  randomBtn.type = "button";
  randomBtn.textContent = words.ui.random[state.layer];
  const nudgeBtn = document.createElement("button");
  nudgeBtn.type = "button";
  nudgeBtn.textContent = words.ui.nudge;
  const keepOwnBtn = document.createElement("button");
  keepOwnBtn.type = "button";
  keepOwnBtn.setAttribute("aria-pressed", "false");
  keepOwnBtn.textContent = words.ui.keepOwn;
  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.disabled = true;
  backBtn.textContent = words.ui.back;
  mixRow.append(randomBtn, nudgeBtn, keepOwnBtn, backBtn);
  mixSectionRow.body.appendChild(mixRow);

  /** Reflects `state.history`/`state.keepOwn` onto the mix
   *  row's own button state — called after every action that can change one
   *  (push, pop, a toggle) and once at mount, since all survive a rebuild. */
  function refreshMixRow(): void {
    backBtn.disabled = state!.history.length === 0;
    keepOwnBtn.setAttribute("aria-pressed", String(state!.keepOwn));
  }

  function pushSnapshot(): void {
    state!.history = pushHistory(state!.history, snapshot());
  }

  function randomize(): void {
    pushSnapshot();
    writeTable("smell", randomSmell(tableOf("smell"), state!.keepOwn, Math.random));
    if (hasTouch) writeTable("touch", randomTouch(count, Math.random));
    refreshAll();
    refreshMixRow();
  }
  randomBtn.addEventListener("click", () => {
    pushSnapshot();
    if (state!.layer === "smell") writeTable("smell", randomSmell(tableOf("smell"), state!.keepOwn, Math.random));
    else writeTable("touch", randomTouch(count, Math.random));
    refreshAll();
    refreshMixRow();
  });
  nudgeBtn.addEventListener("click", () => {
    pushSnapshot();
    writeTable(state!.layer, nudgeTable(tableOf(state!.layer), state!.layer, state!.keepOwn, Math.random));
    refreshAll();
    refreshMixRow();
  });
  keepOwnBtn.addEventListener("click", () => {
    state!.keepOwn = !state!.keepOwn;
    refreshMixRow();
  });
  backBtn.addEventListener("click", () => {
    const [rest, item] = popHistory(state!.history);
    if (!item) return;
    state!.history = rest;
    writeTable("smell", item.smell);
    if (hasTouch) writeTable("touch", item.touch);
    refreshAll();
    refreshMixRow();
  });

  // --- Presets ------------------------------------------------------------
  const presetsEl = document.createElement("div");
  presetsEl.className = "vc-pair-presets";
  const smellPresets = presets.filter((p) => !p.touchy);
  const touchyPresets = presets.filter((p) => p.touchy);
  const smellGroup = document.createElement("div");
  smellGroup.className = "vc-exp-pills";
  const touchyGroup = document.createElement("div");
  touchyGroup.className = "vc-exp-pills";
  const hypEl = document.createElement("p");
  hypEl.className = "vc-exp-hyp";

  function currentMatchesPreset(preset: AffinityPreset): boolean {
    if (!tablesMatch(tableOf("smell"), preset.smell)) return false;
    if (hasTouch && !tablesMatch(tableOf("touch"), preset.touch)) return false;
    return true;
  }

  function applyPreset(preset: AffinityPreset): void {
    pushSnapshot();
    writeTable("smell", preset.smell);
    if (hasTouch) writeTable("touch", preset.touch);
    refreshAll();
    refreshMixRow();
  }

  function buildPresetGroup(host: HTMLElement, list: readonly AffinityPreset[]): Map<AffinityPreset, HTMLButtonElement> {
    const map = new Map<AffinityPreset, HTMLButtonElement>();
    for (const preset of list) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "vc-exp-pill";
      b.textContent = preset.name;
      b.addEventListener("click", () => applyPreset(preset));
      host.appendChild(b);
      map.set(preset, b);
    }
    return map;
  }
  const smellPills = buildPresetGroup(smellGroup, smellPresets);
  const touchyPills = hasTouch ? buildPresetGroup(touchyGroup, touchyPresets) : new Map<AffinityPreset, HTMLButtonElement>();

  const smellPresetsLabel = document.createElement("div");
  smellPresetsLabel.className = "vc-pair-label";
  smellPresetsLabel.textContent = words.ui.presetsSmell;
  presetsEl.append(smellPresetsLabel, smellGroup);
  if (hasTouch) {
    const touchyLabel = document.createElement("div");
    touchyLabel.className = "vc-pair-label";
    touchyLabel.textContent = words.ui.presetsTouch;
    presetsEl.append(touchyLabel, touchyGroup);
  }
  presetsEl.appendChild(hypEl);
  mixSectionRow.body.appendChild(presetsEl);

  let lastSig = "";
  function refreshPresetHighlight(): void {
    const sig = JSON.stringify([tableOf("smell"), hasTouch ? tableOf("touch") : null]);
    if (sig === lastSig) return;
    lastSig = sig;
    let active: AffinityPreset | undefined;
    for (const preset of presets) {
      if (currentMatchesPreset(preset)) {
        active = preset;
        break;
      }
    }
    for (const [preset, btn] of smellPills) btn.setAttribute("aria-pressed", String(preset === active));
    for (const [preset, btn] of touchyPills) btn.setAttribute("aria-pressed", String(preset === active));
    hypEl.textContent = active ? active.hypothesis : words.ui.customMix;
  }

  // --- Layer switching ------------------------------------------------
  function setLayer(layer: PairLayer): void {
    state!.layer = layer;
    layerRow.row.dataset.layer = layer;
    for (const [ly, btn] of layerBtns) btn.setAttribute("aria-checked", String(ly === layer));
    // A plain style toggle, not the `hidden` attribute: `.vc-own-strip` has
    // its own authored `display: grid`, which would outrank the UA
    // stylesheet's `[hidden] { display: none }` rule and leave it visible
    // regardless of the attribute (deviceMenu.ts's own drive-add-groups
    // comment documents this same gotcha).
    ownStripEl.style.display = layer === "smell" ? "grid" : "none";
    ownNoteEl.style.display = layer === "smell" || !hasTouch ? "none" : "block";
    // Keep own trails only means anything on Smell (Touch's diagonal has no
    // setting to preserve at all) — same visibility rule as the strip itself.
    keepOwnBtn.style.display = layer === "smell" ? "" : "none";
    randomBtn.textContent = words.ui.random[layer];
    setHintText(layerRow.hintEl, words.layers[layer].how);
    focusIdx = -1;
    for (const pad of pads) {
      drawPadChrome(pad);
      redrawPad(pad);
    }
    lastSig = "";
    refreshPresetHighlight();
  }
  setLayer(state.layer);

  // --- Culture rendering ------------------------------------------------
  const io = pair
    ? new IntersectionObserver(
        (entries) => {
          for (const en of entries) {
            const pad = pads.find((p) => p.canvas === en.target);
            if (pad) pad.visible = en.isIntersecting;
          }
        },
        { threshold: 0.05 },
      )
    : undefined;
  if (io) for (const pad of pads) io.observe(pad.canvas);

  function colorFor(k: number): readonly [number, number, number] {
    return effective ? effective(k).color : parseCssRgb(colours[k] ?? "rgb(255,255,255)");
  }

  // The cultures step on a time budget (PAD_STEPS_PER_SEC, carried across
  // ticks, capped per tick) rather than once every other panel tick: the
  // panel ticks at the display's frame rate, so "every other tick" left a
  // pad at a quarter of the scene's own pace on a 30 fps device and its
  // network visibly frozen. They also mirror the scene's automatic beat
  // reseed (probe()'s seedEpoch/seedDose/seedRadius) with seedColony, which
  // is what keeps the scene's own networks being rebuilt.
  let stepDebt = 0;
  let lastTickMs = -1;
  let lastStatusSig = "";
  let lastSeedEpoch: number | undefined;
  let tickCount = 0;
  function tick(): void {
    const nowMs = performance.now();
    const dtSec = lastTickMs < 0 ? 0 : Math.min(0.1, (nowMs - lastTickMs) / 1000);
    lastTickMs = nowMs;
    stepDebt = Math.min(PAD_MAX_STEPS_PER_TICK, stepDebt + dtSec * PAD_STEPS_PER_SEC);
    const steps = Math.floor(stepDebt);
    stepDebt -= steps;
    const probeData = ctx.probe();
    const epoch = probeData?.seedEpoch;
    let seedNow = false;
    if (typeof epoch === "number") {
      // A reset (the scene restarting its counter) just re-arms.
      if (lastSeedEpoch !== undefined && epoch > lastSeedEpoch) seedNow = true;
      lastSeedEpoch = epoch;
    }

    for (const pad of pads) redrawPad(pad);

    if (state!.layer === "smell") {
      for (const f of ownFaders) {
        const v = getVal("smell", f.k, f.k);
        const p = padPos(v); // same 0..100 mapping the pad squares use, read as "bottom: n%"
        f.thumb.style.bottom = `${p}%`;
        f.fill.style.bottom = `${Math.min(50, p)}%`;
        f.fill.style.height = `${Math.abs(p - 50)}%`;
        // Numbers only (2026-09-27 feedback: the band words read as
        // "very confusing") — PAIR_WORDS' bands stay as data (like
        // showRelations, unused by default) rather than deleted.
        f.valueEl.textContent = fmtSigned(v);
      }
    }

    // The status line is an aria-live region: rewrite it only when what it
    // says changed, not on every tick the pointer rests on a pad. It reads
    // the pad's two directions as sentences for the layer on screen — the
    // same sentences the cursor hint shows, plus the screen reader's copy of
    // them.
    if (focusIdx >= 0 && pads[focusIdx]) {
      const { a, b } = pads[focusIdx]!;
      const layer = state!.layer;
      const lw = words.layers[layer];
      const sx = pairSentence(lw, words.ui, a, b, getVal(layer, a, b));
      const sy = pairSentence(lw, words.ui, b, a, getVal(layer, b, a));
      const sig = JSON.stringify([sx, sy]);
      if (sig !== lastStatusSig) {
        lastStatusSig = sig;
        statusEl.replaceChildren();
        const xEl = document.createElement("span");
        renderTokens(xEl, sx, shortLabels, colours);
        const yEl = document.createElement("span");
        renderTokens(yEl, sy, shortLabels, colours);
        statusEl.append(xEl, document.createTextNode(" · "), yEl);
      }
    } else if (lastStatusSig !== "idle") {
      lastStatusSig = "idle";
      statusEl.textContent = words.ui.statusIdle;
    }

    refreshPresetHighlight();

    // Spotlight: while a pad is hovered, dragged, or holds real keyboard focus
    // (a mouse press leaves focus on the pad too, tagged `vc-pf`, and that
    // must not keep the dish dim), tell the scene which pair to keep bright —
    // every tick, since the scene lets it lapse a moment after the last
    // message (physarum2.ts's SPOT_HOLD_MS).
    const active =
      pads.find((p) => p.dragging) ??
      pads.find((p) => p.hot) ??
      pads.find((p) => p.sq === document.activeElement && !p.sq.classList.contains("vc-pf"));
    if (active) {
      ctx.command("spotlight", { a: active.a, b: active.b });
      spotOn = true;
    } else if (spotOn) {
      ctx.command("spotlight", { a: -1, b: -1 });
      spotOn = false;
    }
    refreshHint();

    tickCount++;
    if (pair && effective) {
      for (const pad of pads) {
        if (!pad.culture || !pad.offscreen || !pad.imgBuf || !pad.img || !pad.visible) continue;
        // Hold still: the pad under the pointer keeps its network through a
        // beat reseed, so what a drag is doing stays readable.
        const reseed = seedNow && !pad.hot && !pad.dragging;
        if (reseed) pad.culture.seedColony(probeData?.seedDose ?? 0, probeData?.seedRadius ?? 0);
        if (tickCount % PAD_MEASURE_EVERY === 0) measurePad(pad);
        if (steps === 0 && !reseed) continue;
        if (steps > 0) {
          const inputs = padInputs(pad);
          for (let s = 0; s < steps; s++) pad.culture.step(inputs);
        }
        paintPad(pad);
      }
    }
  }

  /** What a pad's culture steps with right now: its two strains' live motion
   *  and the pair's Smell/Touch weights. Only called when `pair`/`effective`
   *  exist. */
  function padInputs(pad: PadHandle): PairCultureInputs {
    const w = pair!.weights(ctx, pad.a, pad.b);
    return {
      motion: [effective!(pad.a).motion, effective!(pad.b).motion] as const,
      smell: w.smell,
      touch: w.touch,
    };
  }

  /** Re-measures a pad's picture: each channel's bright end (smoothed 50/50
   *  with the last reading, so a dense patch forming never jumps the
   *  exposure; an unmeasured, zero reading is replaced outright) and how much
   *  ground the two strains share. */
  function measurePad(pad: PadHandle): void {
    if (!pad.culture || !pair) return;
    const trails = pad.culture.trails();
    for (let k = 0; k < 2; k++) {
      const next = trailQuantile(trails[k]!, 0.98);
      pad.exposure[k] = pad.exposure[k]! > 0 ? 0.5 * pad.exposure[k]! + 0.5 * next : next;
    }
    pad.overlap = pairOverlap(trails, pair.size);
  }

  /** Draws a pad's contact-colour picture (physarum2Preview.ts's
   *  `pairContactPixelsInto`) into its canvas. */
  function paintPad(pad: PadHandle): void {
    if (!pad.culture || !pad.offscreen || !pad.imgBuf || !pad.img || !pair) return;
    pairContactPixelsInto(pad.culture.trails(), pair.size, pad.imgBuf, [colorFor(pad.a), colorFor(pad.b)], pad.exposure);
    const octx = pad.offscreen.getContext("2d");
    if (octx) octx.putImageData(pad.img, 0, 0);
    const w = Math.round(pad.canvas.clientWidth);
    const h = Math.round(pad.canvas.clientHeight);
    if (w > 0 && h > 0) {
      if (pad.canvas.width !== w) pad.canvas.width = w;
      if (pad.canvas.height !== h) pad.canvas.height = h;
      const vctx = pad.canvas.getContext("2d");
      if (vctx) {
        vctx.imageSmoothingEnabled = true;
        vctx.imageSmoothingQuality = "high";
        vctx.clearRect(0, 0, pad.canvas.width, pad.canvas.height);
        vctx.drawImage(pad.offscreen, 0, 0, pad.canvas.width, pad.canvas.height);
      }
    }
  }

  /** Letting go of a drag: run the pad's culture `PAD_SETTLE_STEPS` steps on
   *  the spot with the new setting, so it shows where it leads instead of
   *  drifting there over a few seconds, and flash the settled ring. Nothing to
   *  do without a pair source. */
  function settlePad(pad: PadHandle): void {
    if (!pair || !effective || !pad.culture) return;
    const inputs = padInputs(pad);
    for (let s = 0; s < PAD_SETTLE_STEPS; s++) pad.culture.step(inputs);
    measurePad(pad);
    paintPad(pad);
    pad.sq.classList.add("vc-pad-settled");
    if (pad.settleTimer !== undefined) window.clearTimeout(pad.settleTimer);
    pad.settleTimer = window.setTimeout(() => {
      pad.sq.classList.remove("vc-pad-settled");
      pad.settleTimer = undefined;
    }, PAD_SETTLED_MS);
  }

  // --- The cursor hint -----------------------------------------------------
  // One element on <body> (a pad's own box is overflow-hidden and the panel
  // scrolls), shown while a pad is hovered or dragged: what each direction is
  // set to as a sentence with its number, and on Touch a note when the pair
  // rarely meets. aria-hidden — the status line above carries the sentences
  // for assistive tech.
  const hintEl = document.createElement("div");
  hintEl.className = "vc-pad-hint";
  hintEl.hidden = true;
  hintEl.setAttribute("aria-hidden", "true");
  const hintLines = [0, 1].map(() => {
    const ln = document.createElement("div");
    ln.className = "vc-pad-hint-ln";
    const text = document.createElement("span");
    const value = document.createElement("span");
    value.className = "vc-pad-hint-v";
    ln.append(text, value);
    hintEl.appendChild(ln);
    return { text, value };
  });
  const hintNote = document.createElement("div");
  hintNote.className = "vc-pad-hint-note";
  hintNote.textContent = words.ui.rarelyMeet;
  hintNote.hidden = true;
  hintEl.appendChild(hintNote);
  document.body.appendChild(hintEl);
  let hintSig = "";

  /** Shows, hides or refills the hint for `hintPad`. Rebuilds the DOM only
   *  when what it says changed. */
  function refreshHint(): void {
    const pad = hintPad;
    if (!pad) {
      hintEl.hidden = true;
      hintSig = "";
      return;
    }
    const layer = state!.layer;
    const lw = words.layers[layer];
    const x = getVal(layer, pad.a, pad.b);
    const y = getVal(layer, pad.b, pad.a);
    const note = layer === "touch" && pad.overlap < RARELY_MEET_OVERLAP && (x < -0.02 || y < -0.02);
    const sig = `${pad.a}${pad.b}|${layer}|${x}|${y}|${note}`;
    if (sig !== hintSig) {
      hintSig = sig;
      renderTokens(hintLines[0]!.text, pairSentence(lw, words.ui, pad.a, pad.b, x), shortLabels, colours);
      hintLines[0]!.value.textContent = fmtSigned(x);
      renderTokens(hintLines[1]!.text, pairSentence(lw, words.ui, pad.b, pad.a, y), shortLabels, colours);
      hintLines[1]!.value.textContent = fmtSigned(y);
      hintNote.hidden = !note;
    }
    hintEl.hidden = false;
    placeHint();
  }

  /** 16 px right of and 14 px above the pointer, flipped to the left near the
   *  viewport's right edge and below the pointer near its top. */
  function placeHint(): void {
    if (hintEl.hidden) return;
    const r = hintEl.getBoundingClientRect();
    let left = hintX + 16;
    let top = hintY - r.height - 14;
    if (left + r.width > window.innerWidth - 8) left = hintX - r.width - 16;
    if (top < 8) top = hintY + 22;
    hintEl.style.left = `${Math.max(8, left)}px`;
    hintEl.style.top = `${Math.max(8, top)}px`;
  }

  function refreshAll(): void {
    for (const pad of pads) redrawPad(pad);
    lastSig = "";
    lastStatusSig = "";
    refreshPresetHighlight();
  }
  refreshAll();
  refreshMixRow(); // reflect state.history/keepOwn, which can predate this mount

  root.append(layerRow.row, spacer(), ownRow.row, spacer(), pairsRow.row, spacer(), mixSectionRow.row);
  container.appendChild(root);

  function dispose(): void {
    io?.disconnect();
    hintEl.remove();
    for (const pad of pads) {
      if (pad.settleTimer !== undefined) window.clearTimeout(pad.settleTimer);
      pad.settleTimer = undefined;
    }
    // Never leave the dish dimmed by a panel that is going away.
    ctx.command("spotlight", { a: -1, b: -1 });
    spotOn = false;
  }

  return { randomize, tick, dispose };
}
