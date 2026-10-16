/**
 * What a number typed into a slider row's readout means as that row's value
 * (deviceMenu.ts's createControlRow, whose digits turn editable in place on a
 * click). Pure, so the rules are tested in node (tests/typedValue.test.ts).
 *
 * - `parseTyped` reads the text: an optional minus, digits, one decimal
 *   point, where a comma counts as the point (a European keypad's decimal
 *   key). Anything else, or nothing at all, is null — the edit is cancelled
 *   rather than guessed at.
 * - `fitTyped` turns that number into a value the row can hold. The typed
 *   number is what the readout shows, so a row whose readout scales its value
 *   (a % row shows value × 100) divides by its `scale` first. The result is
 *   clamped to the slider's own range — what the setting's store takes; a
 *   row that keeps a value past its ends lays that over it as a custom value
 *   (render/customValues.ts) — and a discrete row (a step of 1 or more) snaps to
 *   its nearest detent the way a drag would. A row with an Off stop
 *   (`zeroAtMin`) takes 0 or below as Off, and anything between Off and its
 *   lowest real value as that lowest value.
 *
 * `allowedChar` is the keystroke filter the editable digits apply while
 * typing, so only characters `parseTyped` can read ever reach the field.
 */

export interface TypedValueRange {
  min: number;
  max: number;
  /** A discrete row's detent — only a step of 1 or more snaps, matching the
   *  slider (createControlRow's `discrete`). */
  step?: number;
  /** The readout shows value × scale; a typed number is divided by it. */
  scale?: number;
  zeroAtMin?: boolean;
}

const NUMBER = /^-?(\d+\.?\d*|\.\d+)$/;

export function parseTyped(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!NUMBER.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function fitTyped(typed: number, range: TypedValueRange): number {
  const v = typed / (range.scale ?? 1);
  if (range.zeroAtMin && v <= 0) return 0;
  let out = Math.min(range.max, Math.max(range.min, v));
  if (range.step !== undefined && range.step >= 1) {
    out = range.min + Math.round((out - range.min) / range.step) * range.step;
    out = Math.min(range.max, out);
  }
  return out;
}

/** The characters the editable digits accept as typed — digits, one point
 *  (or a comma, turned into one), and a minus. */
export function allowedChar(ch: string): boolean {
  return /^[0-9.,-]$/.test(ch);
}
