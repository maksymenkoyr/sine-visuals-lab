import { paletteChipLitStyle, paletteChipStyle, paletteListStyle } from "../controlsKit.ts";
import { affinityRowTargets, primarySelection, valuesDiffer } from "./itemSelection.ts";

/**
 * The Affinity block's plain-word rows and experiment presets, for an
 * itemBoxes widget's `options.relations` (see itemBoxes.ts's header). Both
 * builders are pure DOM factories — no state kept here, no selection of
 * their own: "Affinity has no selector of its own; it follows the box
 * selection" (the approved v3 UX), so the caller (itemBoxes.ts) rebuilds
 * this whole block in place — clearing and refilling its own host — every
 * time the box selection changes or a row/preset click writes a new value
 * (`refreshAffinity`, itemBoxes.ts's 2026-09-27b no-redraw-on-click change);
 * this block has no deviceMenu registrations of its own to unregister, so
 * that clear-and-refill already is the scoped update.
 *
 * **Multi-selection (2026-09-27).** `selected` is every currently-selected
 * item, not just one: the row set itself is still keyed off the PRIMARY
 * (itemSelection.ts's `primarySelection` — its own diagonal, then every
 * other item in index order, same as a single selection), but each row's
 * own label groups every selected item ("PP-A1 + PP-C3 → PP-B2") and a
 * click applies to the whole set at once via `affinityRowTargets` — the
 * caller's `applyRow(rowJ, value)` is handed that row's own target index,
 * not a resolved (i, j) pair, so it can fan the edit out itself (itemBoxes.ts
 * loops `affinityRowTargets` and writes each pair through the same
 * `ctx.set` a single selection always used). A row shows a small "mixed"
 * marker when the selected items actually disagree on it
 * (itemSelection.ts's `valuesDiffer`).
 */

export interface RelationWord {
  label: string;
  value: number;
}

export interface RelationPreset {
  name: string;
  hypothesis: string;
  matrix: readonly (readonly number[])[];
}

function fmtSigned(v: number): string {
  return (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(2);
}

function nearestWordIndex(words: readonly RelationWord[], v: number): number {
  let best = 0;
  let bestDist = Infinity;
  words.forEach((w, i) => {
    const d = Math.abs(v - w.value);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

export interface RelationRowsSpec {
  count: number;
  labels: readonly string[];
  /** Ascending, never empty (itemSelection.ts's `toggleItemSelection` own
   *  invariant) — every currently-selected item, not just the primary. */
  selected: readonly number[];
  words: readonly RelationWord[];
  /** Reads the stored `i -> j` value. */
  get(i: number, j: number): number;
  /** Applies `value` to every pair this row (`rowJ`) affects across the
   *  whole `selected` set (itemSelection.ts's `affinityRowTargets`); the
   *  caller re-renders once afterward (see this file's header). */
  applyRow(rowJ: number, value: number): void;
}

/** One row per pair from the PRIMARY item, own-trail (`j === primary`)
 *  first, then every other item in index order — "PP-C3 → own trail",
 *  "PP-C3 → PP-A1", … — each row's own label naming every selected item at
 *  once for a multi-selection ("PP-A1 + PP-C3 → PP-B2"). */
export function buildRelationRows(spec: RelationRowsSpec): HTMLElement {
  const { count, labels, selected, words, get, applyRow } = spec;
  const primary = primarySelection(selected);
  const groupLabel = selected.map((i) => labels[i] ?? "").join(" + ");
  const host = document.createElement("div");
  host.className = "vc-relrows";

  const order = [primary, ...Array.from({ length: count }, (_, j) => j).filter((j) => j !== primary)];
  for (const j of order) {
    const row = document.createElement("div");
    row.className = "vc-relrow";

    const top = document.createElement("div");
    top.className = "vc-relrow-top";
    const label = document.createElement("span");
    label.className = "vc-relrow-label";
    label.textContent = j === primary ? `${groupLabel} → own trail` : `${groupLabel} → ${labels[j]}`;
    const valueEl = document.createElement("span");
    valueEl.className = "vc-relrow-value";
    top.append(label, valueEl);

    const targets = affinityRowTargets(selected, primary, j);
    if (valuesDiffer(targets.map(({ i, j: jj }) => get(i, jj)))) {
      const mixed = document.createElement("span");
      mixed.className = "vc-relrow-mixed";
      mixed.textContent = "mixed";
      mixed.title = "The selected strains disagree here.";
      top.appendChild(mixed);
    }

    const seg = document.createElement("div");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", label.textContent);
    seg.style.cssText = paletteListStyle;
    // One equal column per word so the scale never wraps onto a second line
    // (it read as two separate controls at panel width).
    seg.style.display = "grid";
    seg.style.gridTemplateColumns = `repeat(${words.length}, minmax(0, 1fr))`;

    // The primary's own reading — display and word-highlight "follow the
    // primary" even while the rest of the selection disagrees (this file's
    // header), the "mixed" marker above is what flags that disagreement.
    const value = get(primary, j);
    const activeIdx = nearestWordIndex(words, value);
    valueEl.textContent = fmtSigned(value);

    words.forEach((w, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = w.label;
      btn.style.cssText = i === activeIdx ? paletteChipLitStyle : paletteChipStyle;
      btn.style.minWidth = "0";
      btn.style.paddingInline = "2px";
      btn.style.textAlign = "center";
      btn.setAttribute("aria-pressed", String(i === activeIdx));
      btn.addEventListener("click", () => applyRow(j, w.value));
      seg.appendChild(btn);
    });

    row.append(top, seg);
    host.appendChild(row);
  }
  return host;
}

export interface RelationPresetsSpec {
  count: number;
  presets: readonly RelationPreset[];
  get(i: number, j: number): number;
  /** Applies a whole preset matrix through the same store path a slider
   *  drag uses (one `set` per pair) — the caller re-renders afterward. */
  apply(matrix: readonly (readonly number[])[]): void;
}

/** Named preset pills plus the active (or "custom mix") one-line
 *  hypothesis — matched against the *current* stored matrix each render, so
 *  a hand-tuned row correctly falls back to "not one of these" rather than
 *  a stale pressed pill. */
export function buildRelationPresets(spec: RelationPresetsSpec): HTMLElement {
  const { count, presets, get, apply } = spec;
  const host = document.createElement("div");
  host.className = "vc-relpresets";

  const matches = (m: readonly (readonly number[])[]): boolean => {
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < count; j++) {
        if (Math.abs(get(i, j) - m[i]![j]!) > 1e-6) return false;
      }
    }
    return true;
  };
  const active = presets.find((p) => matches(p.matrix));

  const pills = document.createElement("div");
  pills.className = "vc-exp-pills";
  for (const preset of presets) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "vc-exp-pill";
    b.textContent = preset.name;
    b.setAttribute("aria-pressed", String(preset === active));
    b.addEventListener("click", () => apply(preset.matrix));
    pills.appendChild(b);
  }
  const hyp = document.createElement("p");
  hyp.className = "vc-exp-hyp";
  hyp.textContent = active ? active.hypothesis : "Custom mix — not one of the experiments above.";

  host.append(pills, hyp);
  return host;
}
