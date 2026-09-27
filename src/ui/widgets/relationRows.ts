import { paletteChipLitStyle, paletteChipStyle, paletteListStyle } from "../controlsKit.ts";

/**
 * The Affinity block's plain-word rows and experiment presets, for an
 * itemBoxes widget's `options.relations` (see itemBoxes.ts's header). Both
 * builders are pure DOM factories — no state kept here, no selection of
 * their own: "Affinity has no selector of its own; it follows the box
 * selection" (the approved v3 UX), so the caller (itemBoxes.ts) re-renders
 * this whole block through the same `ctx.rerender()` a box click uses.
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
  selected: number;
  words: readonly RelationWord[];
  /** Reads the stored `i -> j` value. */
  get(i: number, j: number): number;
  /** Writes it through the same store path a slider drag uses; the caller
   *  re-renders (see this file's header). */
  set(i: number, j: number, value: number): void;
}

/** One row per pair from the selected item, own-trail (`i === j`) first,
 *  then every other item in index order — "PP-C3 → own trail", "PP-C3 →
 *  PP-A1", … */
export function buildRelationRows(spec: RelationRowsSpec): HTMLElement {
  const { count, labels, selected, words, get, set } = spec;
  const host = document.createElement("div");
  host.className = "vc-relrows";

  const order = [selected, ...Array.from({ length: count }, (_, j) => j).filter((j) => j !== selected)];
  for (const j of order) {
    const row = document.createElement("div");
    row.className = "vc-relrow";

    const top = document.createElement("div");
    top.className = "vc-relrow-top";
    const label = document.createElement("span");
    label.className = "vc-relrow-label";
    label.textContent = j === selected ? `${labels[selected]} → own trail` : `${labels[selected]} → ${labels[j]}`;
    const valueEl = document.createElement("span");
    valueEl.className = "vc-relrow-value";
    top.append(label, valueEl);

    const seg = document.createElement("div");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", label.textContent);
    seg.style.cssText = paletteListStyle;

    const value = get(selected, j);
    const activeIdx = nearestWordIndex(words, value);
    valueEl.textContent = fmtSigned(value);

    words.forEach((w, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = w.label;
      btn.style.cssText = i === activeIdx ? paletteChipLitStyle : paletteChipStyle;
      btn.setAttribute("aria-pressed", String(i === activeIdx));
      btn.addEventListener("click", () => set(selected, j, w.value));
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
