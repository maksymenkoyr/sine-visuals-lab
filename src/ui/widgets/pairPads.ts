import type { SceneSetting } from "../../render/sceneSettings.ts";
import {
  AFFINITY_MAX,
  AFFINITY_MIN,
  fillTemplate,
  fmtSigned,
  nudgeTable,
  padPos,
  padValue,
  pairRelation,
  pairsOf,
  popHistory,
  pushHistory,
  randomSmell,
  randomTouch,
  tablesMatch,
  PAIR_LOOK,
  type AffinityPreset,
  type AffinityTables,
  type PairLayer,
  type PairToken,
  type PairWords,
} from "../../render/scenes/physarum2Affinity.ts";
import { createPairCulture, type PairCulture } from "../../render/scenes/physarum2Preview.ts";
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
 * a pad's header always shows its own two live values, each coloured by its
 * own strain (x = A→B, the first value; y = B→A, the second), and a pad
 * draws no corner labels — `pairRelation`/`relations.corners` are read only
 * when a caller flips `showRelations` on.
 *
 * **Numbers only, no band words (2026-09-27 feedback).** An own-trail
 * fader's value and the pad-hover status line both show a plain signed
 * number, never a `PairWords.layers.*.bands` word ("Flees"/"Devours"/…) —
 * user testing found the words read as confusing rather than clarifying. The
 * bands stay in `PairWords` as tested, unused data (same status as
 * `showRelations`), and a pad's tick marks stay unlabelled marks at each
 * band's `at` value rather than being deleted along with the words. The
 * status line reads `"{A} → {B} {value} · {B} → {A} {value}"` for the layer
 * on screen, then the same for the other table when one exists — the axis
 * captions a pad's own body already draws with, not a word phrase.
 *
 * **Flat around zero (2026-09-28).** Pads and own-trail faders both map the
 * pointer through `padValue` (and draw through its inverse `padPos`), which
 * bends the line by `PAD_CURVE` so the stretch around a relation's sign flip
 * is fine and gentle, steeper toward the edges.
 *
 * **Values are continuous.** Dragging a pad or an own-trail fader stores at
 * 0.01 resolution (`round01` below) — not the settings' own 0.05 `step`,
 * which only bounds a keyboard nudge and the Scene panel's generic numeric
 * input for this same setting. AGENTS.md's "Sliders: right = more" rule
 * applies on both axes: right/up always reads more of whatever the axis
 * names, never less.
 *
 * **The mix row (Phase 3).** Random/Nudge/Keep own trails/Back and every
 * preset pill share one rule: **push before you write**. Each first snapshots
 * both live tables (`snapshot()`) onto `PairState.history` (a module-level
 * stack, same survives-a-rebuild convention as the culture cache below), then
 * writes the new values through `writeTable`, which skips any cell whose
 * stored value already matches — Random/Nudge/Back/a preset would otherwise
 * persist all 12 (Touch) or 16 (Smell) settings to localStorage on every
 * click regardless of how many cells actually moved (`sceneSettings.ts`'s own
 * per-`ctx.set` persist). Random and Nudge only ever touch the layer on
 * screen; a preset and Back write both tables. Keep own trails and Rivals
 * (2026-10-02: Random's lean toward a territorial table, on by default — see
 * `randomSmell`) are plain toggles (Smell only, hidden on Touch like the
 * own-trail strip itself) with no history entry of their own — flipping one
 * changes no value. None of this
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
  /** Smell-only: Random leans every roll toward rivals — own trail followed,
   *  everyone else's avoided (`randomSmell`'s `rivals`). On by default. */
  rivals: boolean;
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
    state = { layer: "smell", keepOwn: false, rivals: true, history: [] };
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
    xValEl: HTMLElement;
    yValEl: HTMLElement;
    marker: SVGGElement;
    guideX: SVGLineElement;
    guideY: SVGLineElement;
    lastX: number | undefined;
    lastY: number | undefined;
    visible: boolean;
  }

  const pads: PadHandle[] = [];
  let focusIdx = -1;
  const pairs = pairsOf(count);

  pairs.forEach(([a, b], idx) => {
    const padEl = document.createElement("div");
    padEl.className = "vc-pad";

    const headEl = document.createElement("div");
    headEl.className = "vc-pad-head";
    const xValEl = document.createElement("span");
    const yValEl = document.createElement("span");
    headEl.append(xValEl, yValEl);

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
      xValEl,
      yValEl,
      marker: svgEl("g", {}),
      guideX: svgEl("line", {}),
      guideY: svgEl("line", {}),
      lastX: undefined,
      lastY: undefined,
      visible: false,
    };
    pads.push(pad);

    let dragging = false;
    const fromPointer = (e: PointerEvent): void => {
      const r = sq.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const xPct = ((e.clientX - r.left) / r.width) * 100;
      const yPct = ((e.clientY - r.top) / r.height) * 100;
      setVal(state!.layer, a, b, padValue(xPct));
      setVal(state!.layer, b, a, padValue(100 - yPct));
      redrawPad(pad);
    };
    sq.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      pointerFocus(sq);
      sq.setPointerCapture(e.pointerId);
      dragging = true;
      focusIdx = idx;
      fromPointer(e);
    });
    sq.addEventListener("pointermove", (e) => {
      if (dragging) fromPointer(e);
    });
    sq.addEventListener("pointerup", () => {
      dragging = false;
    });
    sq.addEventListener("pointercancel", () => {
      dragging = false;
    });
    sq.addEventListener("pointerenter", () => {
      focusIdx = idx;
    });
    sq.addEventListener("pointerleave", () => {
      if (!dragging && focusIdx === idx) focusIdx = -1;
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

  /** Redraws everything about a pad's SVG/canvas layout that depends on the
   *  active layer (quadrant tints, ticks, marker shape) — called on mount
   *  and on every layer switch, never per-tick (see this file's header). */
  function drawPadChrome(pad: PadHandle): void {
    const w = words.layers[state!.layer];
    const look = PAIR_LOOK[state!.layer];
    const svg = pad.sq.querySelector("svg")!;
    svg.replaceChildren();
    svgEl("rect", { x: 50, y: 0, width: 50, height: 50, fill: `rgba(${look.pos},0.1)` }, svg);
    svgEl("rect", { x: 0, y: 50, width: 50, height: 50, fill: `rgba(${look.neg},0.1)` }, svg);
    svgEl("rect", { x: 0, y: 0, width: 50, height: 50, fill: `rgba(${look.mixed},0.05)` }, svg);
    svgEl("rect", { x: 50, y: 50, width: 50, height: 50, fill: `rgba(${look.mixed},0.05)` }, svg);
    svgEl("line", { x1: 50, y1: 0, x2: 50, y2: 100, class: "vc-pad-axis" }, svg);
    svgEl("line", { x1: 0, y1: 50, x2: 100, y2: 50, class: "vc-pad-axis" }, svg);
    for (const band of w.bands) {
      if (band.at === 0) continue;
      const p = padPos(band.at);
      svgEl("line", { x1: p, y1: 48.5, x2: p, y2: 51.5, class: "vc-pad-tick" }, svg);
      svgEl("line", { x1: 48.5, y1: 100 - p, x2: 51.5, y2: 100 - p, class: "vc-pad-tick" }, svg);
    }
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
    const x = getVal(state!.layer, pad.a, pad.b);
    const y = getVal(state!.layer, pad.b, pad.a);
    if (pad.lastX === x && pad.lastY === y) return;
    pad.lastX = x;
    pad.lastY = y;
    const X = padPos(x);
    const Y = 100 - padPos(y);
    pad.marker.setAttribute("transform", `translate(${X} ${Y})`);
    pad.guideX.setAttribute("x1", String(X));
    pad.guideX.setAttribute("y1", String(Y));
    pad.guideX.setAttribute("x2", String(X));
    pad.guideX.setAttribute("y2", "50");
    pad.guideY.setAttribute("x1", String(X));
    pad.guideY.setAttribute("y1", String(Y));
    pad.guideY.setAttribute("x2", "50");
    pad.guideY.setAttribute("y2", String(Y));

    if (words.showRelations) {
      const rel = pairRelation(words.layers[state!.layer], x, y);
      pad.headEl.replaceChildren();
      const beh = document.createElement("span");
      beh.className = "vc-pad-beh";
      if (rel) renderTokens(beh, fillTemplate(rel, pad.a, pad.b), shortLabels, colours);
      pad.headEl.appendChild(beh);
    } else {
      pad.xValEl.textContent = fmtSigned(x);
      pad.xValEl.style.color = colours[pad.a] ?? "#fff";
      pad.yValEl.textContent = fmtSigned(y);
      pad.yValEl.style.color = colours[pad.b] ?? "#fff";
    }
  }

  // --- Row 4: mix row (Phase 3: Random / Nudge / Keep own trails / Back) +
  // presets --------------------------------------------------------------
  const mixSectionRow = buildRow(ctx, rowSpec(stateKey, "mix", "Affinity mix"), words.ui.mixTitle, words.ui.mixHint);

  const mixRow = document.createElement("div");
  mixRow.className = "vc-mix-row";
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
  const rivalsBtn = document.createElement("button");
  rivalsBtn.type = "button";
  rivalsBtn.setAttribute("aria-pressed", "false");
  rivalsBtn.textContent = words.ui.rivals;
  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.disabled = true;
  backBtn.textContent = words.ui.back;
  mixRow.append(randomBtn, nudgeBtn, keepOwnBtn, rivalsBtn, backBtn);
  mixSectionRow.body.appendChild(mixRow);

  /** Reflects `state.history`/`state.keepOwn`/`state.rivals` onto the mix
   *  row's own button state — called after every action that can change one
   *  (push, pop, a toggle) and once at mount, since all survive a rebuild. */
  function refreshMixRow(): void {
    backBtn.disabled = state!.history.length === 0;
    keepOwnBtn.setAttribute("aria-pressed", String(state!.keepOwn));
    rivalsBtn.setAttribute("aria-pressed", String(state!.rivals));
  }

  function pushSnapshot(): void {
    state!.history = pushHistory(state!.history, snapshot());
  }

  randomBtn.addEventListener("click", () => {
    pushSnapshot();
    if (state!.layer === "smell") writeTable("smell", randomSmell(tableOf("smell"), state!.keepOwn, Math.random, state!.rivals));
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
  rivalsBtn.addEventListener("click", () => {
    state!.rivals = !state!.rivals;
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
    rivalsBtn.style.display = layer === "smell" ? "" : "none";
    setHintText(layerRow.hintEl, words.layers[layer].how);
    randomBtn.textContent = words.ui.random[layer];
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
    // says changed, not on every tick the pointer rests on a pad.
    if (focusIdx >= 0 && pads[focusIdx]) {
      const { a, b } = pads[focusIdx]!;
      const layer = state!.layer;
      const otherLayer: PairLayer = layer === "smell" ? "touch" : "smell";
      const sig =
        `${focusIdx}|${layer}|${fmtSigned(getVal(layer, a, b))}|${fmtSigned(getVal(layer, b, a))}` +
        (hasTouch ? `|${fmtSigned(getVal(otherLayer, a, b))}|${fmtSigned(getVal(otherLayer, b, a))}` : "");
      if (sig !== lastStatusSig) {
        lastStatusSig = sig;
        statusEl.replaceChildren();
        appendEdgeNumbers(statusEl, a, b, layer);
        if (hasTouch) {
          statusEl.appendChild(document.createTextNode(" · "));
          appendEdgeNumbers(statusEl, a, b, otherLayer);
        }
      }
    } else if (lastStatusSig !== "idle") {
      lastStatusSig = "idle";
      statusEl.textContent = words.ui.statusIdle;
    }

    refreshPresetHighlight();

    if (pair && effective) {
      for (const pad of pads) {
        if (!pad.culture || !pad.offscreen || !pad.imgBuf || !pad.img || !pad.visible) continue;
        if (seedNow) pad.culture.seedColony(probeData?.seedDose ?? 0, probeData?.seedRadius ?? 0);
        if (steps === 0 && !seedNow) continue;
        if (steps > 0) {
          const w = pair.weights(ctx, pad.a, pad.b);
          const inputs = {
            motion: [effective(pad.a).motion, effective(pad.b).motion] as const,
            smell: w.smell,
            touch: w.touch,
          };
          for (let s = 0; s < steps; s++) pad.culture.step(inputs);
        }
        pad.culture.pixelsInto(pad.imgBuf, [colorFor(pad.a), colorFor(pad.b)]);
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
    }
  }

  /** Appends `"{A} → {B} {value} · {B} → {A} {value}"` for one table/layer —
   *  numbers only (2026-09-27 feedback), reusing the same axis-caption
   *  templates a pad's own body draws with (`w.axis.x`/`w.axis.y`) rather
   *  than a band word, so the status line never says anything a pad doesn't
   *  already show. `tick()`'s caller appends this once per table, current
   *  layer first, when a second table exists. */
  function appendEdgeNumbers(host: HTMLElement, a: number, b: number, layer: PairLayer): void {
    const w = words.layers[layer];
    const xEl = document.createElement("span");
    renderTokens(xEl, fillTemplate(w.axis.x, a, b), shortLabels, colours);
    host.appendChild(xEl);
    host.appendChild(document.createTextNode(` ${fmtSigned(getVal(layer, a, b))} · `));
    const yEl = document.createElement("span");
    renderTokens(yEl, fillTemplate(w.axis.y, a, b), shortLabels, colours);
    host.appendChild(yEl);
    host.appendChild(document.createTextNode(` ${fmtSigned(getVal(layer, b, a))}`));
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
  }

  return { tick, dispose };
}
