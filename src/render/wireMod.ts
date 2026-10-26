/**
 * A wire's modifier: Window, Smoothness and Length on one wire from an input
 * to a scene setting (drives.ts's `DriveSource.mod`). Height is the wire's own
 * `DriveSource.height`, read before the modifier, so the window sees the
 * Graded envelope when one is picked. Window picks the stretch of the
 * input, between 0 and its own learned peak, that moves the output (Min and
 * Max, with an On/Off), reusing the generic gate in gateWindow.ts so its math
 * is never copied; Smoothness softens it, or with Window off eases the input
 * over time; Length is a straight fall after
 * each rise, in seconds, off at 0.
 *
 * A modifier belongs to its wire alone: two settings on the same input each
 * keep their own, and unplugging the wire drops it. Only a catalogue wire (a
 * SignalId) carries one: a beat grid and the drawn line have none.
 *
 * `freshWireMod()` reads exactly what the plain wire reads (window and
 * Length off), and normalizeDriveSetting drops a modifier equal to it, so an
 * untouched wire stays the plain wire it always was in storage and in a Look.
 *
 * Wires saved while modifiers were cards of their own in a middle column (a
 * `{source:"shaped", id}` choice naming a node in the `vibe.shapingNodes`
 * store, or in a Look's `h` field) become plain wires with these fields:
 * `legacyNodeFrom` reads such a node, and driveStore.ts's
 * sanitizeDriveSetting does the conversion for both.
 */
import { GATE_FORMULA_DEFAULT, GENERIC_SMOOTHNESS_DEFAULT, GENERIC_THRESHOLD_DEFAULT, GENERIC_WINDOW_MAX_DEFAULT, advanceGateTracker, createGateTracker, glideSmoothness, glideStep, parseHitHeight, windowReading, type GateFormula, type GateTrackerState, type HitHeight } from "./gateWindow.ts";
import { SIGNALS, type SignalId } from "./signals.ts";

/** Length's right end: the longest fall a wire's output can take, in seconds. */
export const WIRE_LENGTH_MAX_SEC = 1.5;

export interface WireMod {
  /** The window: Min and Max between 0 and the input's own learned peak (1). */
  windowOn: boolean;
  min: number;
  max: number;
  /** How far the window softens (gateWindow.ts windowReading); off means an exact window. */
  smoothOn: boolean;
  smoothness: number;
  /** Seconds the output takes to fall from 1 to 0 after a rise; 0 = off. */
  length: number;
}

/** A wire's modifier before anyone touched it: it reads what the plain wire reads. */
export function freshWireMod(): WireMod {
  return {
    windowOn: false,
    min: GENERIC_THRESHOLD_DEFAULT,
    max: GENERIC_WINDOW_MAX_DEFAULT,
    smoothOn: true,
    smoothness: GENERIC_SMOOTHNESS_DEFAULT,
    length: 0,
  };
}

const FRESH: WireMod = freshWireMod();

/** Absent reads as `freshWireMod()`. */
export function sameWireMod(a: WireMod | undefined, b: WireMod | undefined): boolean {
  const x = a ?? FRESH;
  const y = b ?? FRESH;
  return (
    x.windowOn === y.windowOn &&
    x.min === y.min &&
    x.max === y.max &&
    x.smoothOn === y.smoothOn &&
    x.smoothness === y.smoothness &&
    x.length === y.length
  );
}

/** Whether the modifier changes nothing the wire reads: Window and Length off,
 *  and no Smoothness above its resting value (glideSmoothness). */
export function wireModIsIdle(mod: WireMod | undefined): boolean {
  return !mod || (!mod.windowOn && mod.length <= 0 && !(mod.smoothOn && glideSmoothness(mod.smoothness) > 0));
}

function clampTo(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** `mod` with every number in its range and Min ≤ Max. */
export function clampWireMod(mod: WireMod): WireMod {
  const min = clampTo(mod.min, 0, 1);
  return {
    windowOn: mod.windowOn,
    min,
    max: Math.max(clampTo(mod.max, 0, 1), min),
    smoothOn: mod.smoothOn,
    smoothness: clampTo(mod.smoothness, 0, 1),
    length: clampTo(mod.length, 0, WIRE_LENGTH_MAX_SEC),
  };
}

/** The compact stored form, one array per wire: `[windowOn, min, max,
 *  smoothOn, smoothness, length]`, the switches as 0/1. A share link carries
 *  it, so the order never changes. */
export type StoredWireMod = [number, number, number, number, number, number];

export function encodeWireMod(mod: WireMod): StoredWireMod {
  return [mod.windowOn ? 1 : 0, mod.min, mod.max, mod.smoothOn ? 1 : 0, mod.smoothness, mod.length];
}

/** `raw` as a WireMod, or null when it is not the stored form. Numbers are
 *  clamped rather than rejected. */
export function decodeWireMod(raw: unknown): WireMod | null {
  if (!Array.isArray(raw) || raw.length !== 6) return null;
  if (!raw.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const [w, min, max, s, smoothness, length] = raw as number[];
  if ((w !== 0 && w !== 1) || (s !== 0 && s !== 1)) return null;
  return clampWireMod({ windowOn: w === 1, min: min!, max: max!, smoothOn: s === 1, smoothness: smoothness!, length: length! });
}

/** A modifier card from before modifiers moved onto wires: its input, its
 *  Height and its modifier fields. */
export interface LegacyNode {
  src: SignalId;
  height: HitHeight;
  mod: WireMod;
}

// The catalogue ids as a Set: SIGNALS is a plain object, so a lookup on it
// would also accept "toString" or "__proto__" from corrupt storage or a
// crafted Look.
const SIGNAL_IDS: ReadonlySet<string> = new Set(Object.keys(SIGNALS));

/** One node of the retired `vibe.shapingNodes` store or a Look's `h` field,
 *  or null when any field has the wrong type. */
export function legacyNodeFrom(raw: unknown): LegacyNode | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const { src, windowOn, min, max, smoothOn, smoothness, height, length } = r;
  if (typeof src !== "string" || !SIGNAL_IDS.has(src)) return null;
  if (typeof windowOn !== "boolean" || typeof smoothOn !== "boolean") return null;
  for (const n of [min, max, smoothness, length]) if (typeof n !== "number" || !Number.isFinite(n)) return null;
  // A node saved "graded" meant the plain pulse, which is Fixed now.
  const legacyHeight = height === "graded" ? "fixed" : parseHitHeight(height);
  if (legacyHeight === null) return null;
  return {
    src: src as SignalId,
    height: legacyHeight,
    mod: clampWireMod({ windowOn, min: min as number, max: max as number, smoothOn, smoothness: smoothness as number, length: length as number }),
  };
}

export const LEGACY_NODE_ID_RE = /^n[1-9]\d{0,5}$/;

/** The retired node store's nodes by id, read once at load: wires saved
 *  before modifiers moved onto them still name these ids. */
export function readLegacyNodes(): ReadonlyMap<string, LegacyNode> {
  const out = new Map<string, LegacyNode>();
  try {
    const raw = JSON.parse(localStorage.getItem("vibe.shapingNodes") ?? "null") as { nodes?: unknown } | null;
    if (!raw || !Array.isArray(raw.nodes)) return out;
    for (const item of raw.nodes) {
      const id = (item as { id?: unknown } | null)?.id;
      if (typeof id !== "string" || !LEGACY_NODE_ID_RE.test(id)) continue;
      const node = legacyNodeFrom(item);
      if (node) out.set(id, node);
    }
  } catch {
    // No storage, or unreadable text: there is nothing to convert.
  }
  return out;
}

// ---- pure math ----------------------------------------------------------

export interface WireModState {
  /** The value the window sees: the wire's own reading, Height applied. */
  input: number;
  output: number;
  /** The window's Min and Max lines on the input's scale (tracker.line/top); 0 while the window is off. */
  line: number;
  top: number;
  tracker: GateTrackerState;
  /** Length's falling envelope. */
  env: number;
  /** Smoothness's eased input while Window is off; NaN until its first step. */
  glide: number;
}

export function createWireModState(): WireModState {
  return { input: 0, output: 0, line: 0, top: 0, tracker: createGateTracker(), env: 0, glide: Number.NaN };
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** One step of a wire's modifier on `input`, the wire's plain reading. The
 *  output is clamped to 0..1, the scale every monitor draws. Length's fall is
 *  a straight line at 1/length per second, so it is frame-rate independent.
 *  `formula` is Smoothness's formula (gateWindow.ts GATE_FORMULAS). */
export function stepWireMod(st: WireModState, mod: WireMod, dtSec: number, input: number, formula: GateFormula): number {
  st.input = input;
  let y = input;
  if (mod.windowOn) {
    const s = mod.smoothOn ? mod.smoothness : 0;
    advanceGateTracker(st.tracker, dtSec, input, mod.min, mod.max, formula, s);
    y = windowReading(st.tracker, input, s, formula);
    st.line = st.tracker.line;
    st.top = st.tracker.top;
  } else {
    st.line = 0;
    st.top = 0;
    // With no window to soften, Smoothness eases the input itself. The glide
    // keeps following the input while it is off, so switching it on never jumps.
    st.glide = glideStep(st.glide, input, mod.smoothOn ? glideSmoothness(mod.smoothness) : 0, dtSec);
    y = st.glide;
  }
  if (mod.length > 0) {
    st.env = Math.max(y, st.env - dtSec / mod.length);
    y = st.env;
  } else {
    st.env = y;
  }
  st.output = clamp01(y);
  return st.output;
}

/** The modifier's static transfer at input `x`, the input's peak taken as 1:
 *  what the wire sends on for a held input once the peak has settled. Length
 *  only shapes the fall over time, so it leaves the curve alone. */
export function wireModCurve(mod: WireMod, x: number): number {
  if (!mod.windowOn) return clamp01(x);
  const s = mod.smoothOn ? mod.smoothness : 0;
  // A first step at input 1 seeds the tracker's peak at 1 and sets its Min
  // and Max lines from the modifier, the way stepWireMod's tracker sets them.
  const tr = createGateTracker();
  advanceGateTracker(tr, 0, 1, mod.min, mod.max, GATE_FORMULA_DEFAULT, s);
  return clamp01(windowReading(tr, x, s, GATE_FORMULA_DEFAULT));
}
