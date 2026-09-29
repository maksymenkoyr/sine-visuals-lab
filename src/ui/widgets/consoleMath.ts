/**
 * The pure arithmetic behind the Strain Console's lanes and knobs
 * (strainConsole.ts) — kept DOM-free so tests/consoleMath.test.ts can pin it.
 * A lane or knob edits one per-item setting (a `SceneSetting.item`-tagged
 * spec) over that spec's own min..max; nothing here knows what the setting
 * means.
 */

/** The parts of a `SceneSetting` this file reads — a plain structural type so a
 *  test needn't build a full spec. */
export interface RangeSpec {
  min: number;
  max: number;
  step: number;
}

/** How a value is shown: `plain` two decimals (or none for whole-number
 *  steps), `degrees` a whole-degree value, `turns` a signed shift given in
 *  turns shown as degrees (the Stain slider). */
export type ValueFormat = "plain" | "degrees" | "turns";

/** Clamps `v` into the spec's range and snaps it to the spec's step, counted
 *  from `min`. `fine` snaps to a fifth of a step instead (a Shift-drag). */
export function quantize(v: number, spec: RangeSpec, fine = false): number {
  const step = fine ? spec.step / 5 : spec.step;
  const clamped = Math.max(spec.min, Math.min(spec.max, v));
  if (!(step > 0)) return clamped;
  const snapped = spec.min + Math.round((clamped - spec.min) / step) * step;
  // Round off binary-fraction noise (0.30000000000000004) at the step's own precision.
  const digits = Math.min(6, Math.max(0, Math.ceil(-Math.log10(step)) + 1));
  return Math.max(spec.min, Math.min(spec.max, Number(snapped.toFixed(digits))));
}

/** Where `v` sits in the spec's range, 0..1. */
export function toUnit(v: number, spec: RangeSpec): number {
  const span = spec.max - spec.min;
  return span > 0 ? Math.max(0, Math.min(1, (v - spec.min) / span)) : 0;
}

/** The value at 0..1 along the spec's range (not yet snapped). */
export function fromUnit(t: number, spec: RangeSpec): number {
  return spec.min + Math.max(0, Math.min(1, t)) * (spec.max - spec.min);
}

/** Pixels of pointer travel that sweep a knob's whole range. */
export const KNOB_PX = 140;

/** A knob drag's change to the value: right and up both turn it up (dx grows
 *  right, dy grows down in the DOM, so up is -dy), left and down both take
 *  away; KNOB_PX of travel sweeps the whole range and Shift is a fifth of
 *  that speed. */
export function knobDelta(dx: number, dy: number, spec: RangeSpec, fine: boolean): number {
  return ((dx - dy) / KNOB_PX) * (spec.max - spec.min) * (fine ? 0.2 : 1);
}

/** One arrow-key press: 1% of the range (10% with Shift), never less than the
 *  spec's own step — a smaller move would snap straight back to where it was. */
export function arrowStep(spec: RangeSpec, shift: boolean): number {
  return Math.max(spec.step, (spec.max - spec.min) * (shift ? 0.1 : 0.01));
}

/** The new values when strain `k` is set to `v`. With `linked` every strain
 *  moves by the same amount instead (each clamped to its own range), the way
 *  Link on a lane or Alt on a knob works. */
export function applyEdit(values: readonly number[], k: number, v: number, spec: RangeSpec, linked: boolean, fine = false): number[] {
  if (!linked) return values.map((x, i) => (i === k ? quantize(v, spec, fine) : x));
  const d = quantize(v, spec, fine) - values[k]!;
  return values.map((x) => quantize(x + d, spec, fine));
}

/** A lane/knob's readout for `v`. */
export function formatValue(v: number, fmt: ValueFormat, spec: RangeSpec): string {
  if (fmt === "degrees") return `${Math.round(v)}°`;
  if (fmt === "turns") {
    const d = Math.round(v * 360);
    return `${d > 0 ? "+" : ""}${d}°`;
  }
  return spec.step >= 1 ? String(Math.round(v)) : v.toFixed(2);
}

/** A CSS gradient across the Stain slider's own range: the strain's base hue
 *  rotated from a half turn back to a half turn forward, so a lane's rail
 *  shows the colour each position gives *this* strain. `baseHue` in turns. */
export function hueRailGradient(baseHue: number, saturation = 90, lightness = 58, stops = 7): string {
  const parts: string[] = [];
  for (let i = 0; i < stops; i++) {
    const t = i / (stops - 1);
    const h = (((baseHue + t - 0.5) % 1) + 1) % 1;
    parts.push(`hsl(${Math.round(h * 360)} ${saturation}% ${lightness}%)`);
  }
  return `linear-gradient(90deg, ${parts.join(", ")})`;
}

/** The point on a hue wheel of radius `r` (hue 0 at the top, clockwise — the
 *  way a conic-gradient ring is painted) for a hue in turns. */
export function wheelPoint(hue: number, r: number): [number, number] {
  return [Math.sin(hue * 2 * Math.PI) * r, -Math.cos(hue * 2 * Math.PI) * r];
}

/** The SVG arc path a knob's value track draws: `r` from `a0` to `a1` radians
 *  around the centre (cx, cy). */
export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p = (a: number): [number, number] => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}
