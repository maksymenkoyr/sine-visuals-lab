import { DIAL_SIGNALS, SIGNALS, type SignalId } from "../../render/signals.ts";
import { DRIVE_EVERY_VALUES, type DriveMix, type DrivePatch, type DriveSource, type HitHeight } from "../../render/drives.ts";

/**
 * The pure arithmetic behind the Strain Console's lanes
 * (strainConsole.ts) — kept DOM-free so tests/consoleMath.test.ts can pin it.
 * A lane edits one per-item setting (a `SceneSetting.item`-tagged
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

/** One arrow-key press: 1% of the range (10% with Shift), never less than the
 *  spec's own step — a smaller move would snap straight back to where it was. */
export function arrowStep(spec: RangeSpec, shift: boolean): number {
  return Math.max(spec.step, (spec.max - spec.min) * (shift ? 0.1 : 0.01));
}

/** The new values when strain `k` is set to `v`. With `linked` every strain
 *  moves by the same amount instead (each clamped to its own range), the way
 *  Link on a lane works. */
export function applyEdit(values: readonly number[], k: number, v: number, spec: RangeSpec, linked: boolean, fine = false): number[] {
  if (!linked) return values.map((x, i) => (i === k ? quantize(v, spec, fine) : x));
  const d = quantize(v, spec, fine) - values[k]!;
  return values.map((x) => quantize(x + d, spec, fine));
}

/** A lane's readout for `v`. */
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

/** A uniform roll over the spec's whole range, snapped to its step — the
 *  console's Random (`rnd` uniform [0, 1), injected so tests can seed it). */
export function randomValue(spec: RangeSpec, rnd: () => number): number {
  return quantize(fromUnit(rnd(), spec), spec);
}

/** Whether `values` sit on `target` to within half a step each — a preset
 *  pill reads as pressed while the stored values still match it. */
export function valuesMatch(values: readonly number[], target: readonly number[], spec: RangeSpec): boolean {
  const tol = (spec.step > 0 ? spec.step : 1e-6) / 2 + 1e-9;
  return values.length === target.length && values.every((v, i) => Math.abs(v - target[i]!) <= tol);
}

/** The signals the console's Random wires a lane to: every catalogue signal
 *  but the ones that hardly move while a song plays (Tempo, Tempo lock and
 *  the slow Character dials in DIAL_SIGNALS) — wired in, they would only
 *  hold a setting off its slider. */
export const RANDOM_WIRE_SIGNALS: readonly SignalId[] = (Object.keys(SIGNALS) as SignalId[]).filter(
  (id) => id !== "anim.tempo" && id !== "anim.tempoLock" && !(DIAL_SIGNALS as readonly SignalId[]).includes(id),
);
/** How often Random gives a lane a second wire instead of one. */
export const RANDOM_SECOND_WIRE = 0.4;
/** A random wire's weight range, snapped to RANDOM_WEIGHT_STEP. */
export const RANDOM_WEIGHT_MIN = 0.4;
export const RANDOM_WEIGHT_MAX = 1.6;
const RANDOM_WEIGHT_STEP = 0.05;
const HEIGHTS: readonly HitHeight[] = ["graded", "fixed", "loud"];
const MIXES: readonly DriveMix[] = ["add", "max", "gate"];

function pick<T>(list: readonly T[], rnd: () => number): T {
  return list[Math.min(list.length - 1, Math.floor(rnd() * list.length))]!;
}

/** One random wire from `signal`: a weight, a height when it is a hit, and
 *  the beats per swing when it is Beat wave. */
function randomSource(signal: SignalId, rnd: () => number): DriveSource {
  const w = RANDOM_WEIGHT_MIN + rnd() * (RANDOM_WEIGHT_MAX - RANDOM_WEIGHT_MIN);
  const src: DriveSource = { choice: signal, weight: Number((Math.round(w / RANDOM_WEIGHT_STEP) * RANDOM_WEIGHT_STEP).toFixed(2)) };
  if (SIGNALS[signal].kind === "edge") src.height = pick(HEIGHTS, rnd);
  if (signal === "anim.beatWave") src.every = pick(DRIVE_EVERY_VALUES, rnd);
  return src;
}

/** The console's Random wiring for one lane: one wire, or (RANDOM_SECOND_WIRE
 *  of the time) two different ones under a random mix — under "Only when"
 *  the second is the condition. `rnd` uniform [0, 1), injected for tests. */
export function randomPatch(rnd: () => number, signals: readonly SignalId[] = RANDOM_WIRE_SIGNALS): DrivePatch {
  const first = pick(signals, rnd);
  const sources = [randomSource(first, rnd)];
  let mix: DriveMix = "add";
  if (signals.length > 1 && rnd() < RANDOM_SECOND_WIRE) {
    const rest = signals.filter((id) => id !== first);
    sources.push(randomSource(pick(rest, rnd), rnd));
    mix = pick(MIXES, rnd);
    if (mix === "gate") sources[1]!.when = true;
  }
  return { mix, sources };
}
