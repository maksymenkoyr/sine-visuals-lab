/**
 * The one pure rule left from `itemBoxes.ts`'s old multi-item selection: the
 * wording of the "Mixed — …" drive-summary line a linked row (the `linked`
 * option of `WidgetCtx.appendRow`/`mountRows`, registry.ts) falls back to once
 * its linked items' own patches disagree. The selection itself — solo, group,
 * "All", the "Editing …" heading — is gone (itemBoxes.ts's header, "No
 * selection"), and no widget supplies `linked` today; deviceMenu.ts is the
 * only caller. Unit tested in `tests/itemSelection.test.ts`.
 */

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
