/**
 * Portal's turn-taking (see index.ts). Every kick is handed to the next look
 * in LOOKS, round the list, so the picture changes look on each hit instead
 * of repeating one reaction. A kick counter does the handing out
 * (`advanceLooks`); how many looks take part is the Turns setting, passed in
 * per frame, and with one look every kick is the flood.
 *
 * Each look is an envelope. It starts at the size of the kick that started it
 * and falls exponentially from there, so a hit jumps to full at once and
 * decays: `lookLevel` reads the height at any time, `lookAge` the time since
 * that look last started. The blast's first moments are shaped further by
 * `blastFlicker`. Nothing rises gradually; all of it is set by the kick.
 *
 * Pure TS, no GL. tests/portalRotation.test.ts covers the hand-out and the fall.
 */

export const LOOKS = ["flood", "blast", "accent"] as const;
export type Look = (typeof LOOKS)[number];

/** Seconds for a look to fall to a quarter of its height. */
export const FALL_QUARTER_SEC = 0.4;
/** The lowest Afterglow that still scales the fall; anything lower is clamped to this. */
const MIN_FALL_SCALE = 0.05;
const QUARTER_LOG = Math.log(4);

/** The blast flicker: it runs for this long after the blast starts... */
const FLICKER_SPAN_SEC = 0.45;
/** ...at this rate (radians per second of the sine it is cut from)... */
const FLICKER_RATE = 63;
/** ...between this floor and full, swinging by FLICKER_SWING. */
const FLICKER_FLOOR = 0.55;
const FLICKER_SWING = 0.45;

export interface LookState {
  /** Kicks handed out so far; the next kick goes to LOOKS[count % turns]. */
  count: number;
  /** Time each look last started, in the caller's clock (seconds). -Infinity before any start. */
  start: Record<Look, number>;
  /** The kick size each look started with. */
  size: Record<Look, number>;
  /** The kick count each look last started at, as a number (the shader's per-hit seed). */
  seed: Record<Look, number>;
}

export function createLookState(): LookState {
  return {
    count: 0,
    start: { flood: -Infinity, blast: -Infinity, accent: -Infinity },
    size: { flood: 0, blast: 0, accent: 0 },
    seed: { flood: 0, blast: 0, accent: 0 },
  };
}

/** Called once per frame. If `fired`, hands this kick to LOOKS[count % turns]
 *  (turns rounded and clamped to between one look and every look in LOOKS),
 *  records start=nowSec, size, seed = count (as a number), increments count.
 *  Returns the look that started, or null. */
export function advanceLooks(state: LookState, fired: boolean, size: number, nowSec: number, turns: number): Look | null {
  if (!fired) return null;
  // A non-finite turns (NaN) falls back to a single look, the same as turns 0.
  const n = Math.min(LOOKS.length, Math.max(1, Math.round(turns) || 1));
  const look = LOOKS[state.count % n];
  state.start[look] = nowSec;
  state.size[look] = size;
  state.seed[look] = state.count;
  state.count++;
  return look;
}

/** Envelope height of `look` at nowSec: 0 before any start; otherwise the
 *  look's size, falling exponentially so that it reaches a quarter after
 *  FALL_QUARTER_SEC times fallScale (the Afterglow setting, clamped to at
 *  least MIN_FALL_SCALE). */
export function lookLevel(state: LookState, look: Look, nowSec: number, fallScale: number): number {
  const age = nowSec - state.start[look];
  if (age < 0) return 0;
  const scale = Math.max(MIN_FALL_SCALE, fallScale);
  return state.size[look] * Math.exp((-age * QUARTER_LOG) / (FALL_QUARTER_SEC * scale));
}

/** Seconds since `look` last started (Infinity if never). */
export function lookAge(state: LookState, look: Look, nowSec: number): number {
  return nowSec - state.start[look];
}

/** The blast's flicker: multiplies the blast level. For the first
 *  FLICKER_SPAN_SEC of its life it is a sine's absolute value riding between
 *  FLICKER_FLOOR and full (FLICKER_RATE, FLICKER_SWING); after that, 1. */
export function blastFlicker(age: number): number {
  if (age >= FLICKER_SPAN_SEC) return 1;
  return FLICKER_FLOOR + FLICKER_SWING * Math.abs(Math.sin(age * FLICKER_RATE));
}
