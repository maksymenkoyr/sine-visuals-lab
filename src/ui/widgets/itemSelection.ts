/**
 * Pure helpers behind an `itemBoxes.ts` multi-item selection — no DOM, so
 * every rule the 2026-09-27 multi-strain edit added (never-empty toggling,
 * "All", "first in code order" is the primary, whether several values
 * actually disagree, the "Mixed — …" summary line's own wording, and
 * Affinity's per-row fan-out across several selected items) is unit tested
 * directly (`tests/itemSelection.test.ts`) rather than only through a
 * headless click. `itemBoxes.ts` is the only caller today; `relationRows.ts`
 * also reaches for `affinityRowTargets` since Affinity's own fan-out rule is
 * exactly this module's concern, not that file's.
 */

/** Toggles `index` in/out of `selected`, always ascending and deduped, and
 *  always non-empty: toggling the last remaining member off is a no-op
 *  (returns an equal — not necessarily identical — array) rather than ever
 *  producing an empty selection. */
export function toggleItemSelection(selected: readonly number[], index: number): number[] {
  const has = selected.includes(index);
  if (has) {
    if (selected.length <= 1) return [...selected].sort((a, b) => a - b);
    return selected.filter((i) => i !== index).sort((a, b) => a - b);
  }
  return [...selected, index].sort((a, b) => a - b);
}

/** Every item, ascending — the "All" chip's own selection. */
export function allItemsSelected(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i);
}

/** True for two selections with the same members in the same (ascending)
 *  order — how a click decides whether it actually changed anything, so a
 *  no-op toggle never triggers a pointless `ctx.rerender()`. */
export function sameSelection(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** "The first selected in code order" — whose own rows the panel renders,
 *  and whose edits every other selected item's setting copies (see
 *  itemBoxes.ts's header). `selected` is never empty (toggleItemSelection's
 *  own invariant), so this always has an answer. */
export function primarySelection(selected: readonly number[]): number {
  return Math.min(...selected);
}

/** True once at least one value differs from the first by more than a tiny
 *  epsilon (float round-trip through a slider/localStorage) — a single-item
 *  selection (or an empty list) is trivially never "differing". */
export function valuesDiffer(values: readonly number[], eps = 1e-6): boolean {
  if (values.length < 2) return false;
  const first = values[0]!;
  return values.some((v) => Math.abs(v - first) > eps);
}

/** The "Editing …" line above the boxes: every selected item's own label
 *  joined for a partial selection, or a fixed "Editing all `itemNoun`" once
 *  the selection covers everything — `isAll` is the caller's own
 *  `selected.length === count` check (kept out of here so this stays a pure
 *  string format with no notion of "how many items exist"). */
export function editingHeading(selectedLabels: readonly string[], isAll: boolean, itemNoun: string): string {
  return isAll ? `Editing all ${itemNoun}` : `Editing ${selectedLabels.join(" + ")}`;
}

/** One "label: text" entry for `formatMixedSummary` below. */
export interface SummaryPart {
  label: string;
  text: string;
}

/** "Mixed — A: x · B: y" — the drive-summary line a linked row falls back
 *  to once its selected items' own patches actually disagree (deviceMenu.ts
 *  decides *when* to call this — sameDriveSetting across the linked specs —
 *  this only ever formats the parts it's handed). */
export function formatMixedSummary(parts: readonly SummaryPart[]): string {
  return `Mixed — ${parts.map((p) => `${p.label}: ${p.text}`).join(" · ")}`;
}

/** One Affinity pair this row edit reaches, for a multi-selection: the
 *  "→ own trail" row (`rowJ === primary`) sets every selected item's own
 *  diagonal (`att<i><i>`); every other row (`rowJ` = some other item, not
 *  necessarily itself selected) sets `att<i><rowJ>` for every selected `i`
 *  *except* `rowJ` itself — a strain can't be told to head toward its own
 *  trail through the "→ target" wording, that's what the own-trail row is
 *  for. `primary` only matters to decide which row this is; the fan-out
 *  itself always covers the whole `selected` set. */
export function affinityRowTargets(selected: readonly number[], primary: number, rowJ: number): { i: number; j: number }[] {
  if (rowJ === primary) return selected.map((i) => ({ i, j: i }));
  return selected.filter((i) => i !== rowJ).map((i) => ({ i, j: rowJ }));
}
