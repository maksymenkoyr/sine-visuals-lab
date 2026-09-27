/**
 * Pure helpers behind an `itemBoxes.ts` multi-item selection — no DOM, so
 * every rule the 2026-09-27 multi-strain edit added (never-empty toggling,
 * "All", "first in code order" is the primary, and the "Mixed — …" summary
 * line's own wording) is unit tested directly (`tests/itemSelection.test.ts`)
 * rather than only through a headless click. `itemBoxes.ts` is the only
 * caller.
 *
 * **Solo vs. group (2026-09-27b).** A plain tap on a box body (or a web
 * node) no longer toggles membership — it *solos* (`soloSelection`),
 * replacing the whole selection with just that one item, even when a group
 * was active. Only a per-box checkbox (ticked = in the group) or a
 * Shift/Cmd/Ctrl-modified tap still calls `toggleItemSelection` to build a
 * multi-item group; `itemBoxes.ts` reads the modifier keys off the DOM event
 * itself (this module stays DOM-free) and picks which of the two to call.
 */

/** Replaces the whole selection with exactly `index` — a plain tap on a box
 *  body or web node (see this file's header's Solo paragraph). Always
 *  non-empty by construction, same invariant `toggleItemSelection` keeps. */
export function soloSelection(index: number): number[] {
  return [index];
}

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
