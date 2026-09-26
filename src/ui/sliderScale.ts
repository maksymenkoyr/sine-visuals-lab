/**
 * The pure math behind every slider in the controls panel — no DOM, so it's
 * unit-tested directly (tests/sliderScale.test.ts); src/ui/magnetSlider.ts is
 * the only consumer, and owns everything DOM (drawing, pointer capture,
 * keyboard, ARIA).
 *
 * A `SliderScale` is a value <-> track-position mapping (`toVal`/`toPos`,
 * position in 0..1) plus the ruled ticks along it. Every tick carries a
 * `TickLevel` — 0 (fine, the step grid), 1 (mid, round numbers), 2 (major:
 * quarters, decades, both ends) — and a tick can additionally be a `detent`:
 * a *marked value* (a row's own default, an explicit Off, a natural 1×).
 * `linearScale` builds an evenly-spaced grid from fine/mid/major spacings;
 * `logScale` reproduces createControlRow's old log-mapped gain rows exactly
 * (see its own comment below — this is where those formulas moved from);
 * `autoLinearScale` picks nice fine/mid/major spacings on its own for a row
 * that only declares min/max/step, so most callers never hand-pick spacings
 * at all.
 *
 * The panel ships one snap mode — Step: the thumb is always sitting on a
 * tick, and dragging steps it from one to the next, so a value is always a
 * clean, nameable point on the scale rather than an arbitrary float. `snap`
 * decides which tick a raw pointer position lands on: a marked value pulls
 * hardest (`DETENT_PULL_PX`), a tick's own level scales its pull
 * (`TICK_PULL_PX` × `LEVEL_PULL`), and once the thumb is *latched* onto a
 * mid/major/detent tick it holds on a bit past that reach (`HOLD_ON`) so it
 * doesn't chatter at the boundary. `MAGNETISM` is the one knob that scales
 * every reach at once. A discrete row (an integer count) always snaps to the
 * nearest tick regardless of any of this; holding Shift over a continuous
 * row bypasses the magnets entirely and returns a free (untick'd) position.
 *
 * Precision is the other half: holding the pointer still, or dragging it
 * slowly, subdivides the scale so a value between two ticks becomes
 * reachable. `pointerSpeed` reads recent pointer samples; `nextPrecisionLevel`
 * turns that into one of the levels in `PRECISION_SUB` (a fast move drops
 * back to normal immediately, holding still or slow raises the level after
 * `HOLD_MS`); `precisionValue` then quantizes a position into `sub` equal
 * steps between the two ticks bracketing it. `lens` is the visual magnifier
 * this rides under (a flat core, a compressed ring, then the plain scale);
 * `dragStep` is the pointer-to-thumb relative-motion math in precision (the
 * thumb moves at a fraction of the pointer's own motion; pull the pointer
 * more than `LEASH_PX` away and precision lets go, so the thumb catches back
 * up instead of trailing behind a pointer that's clearly going somewhere).
 */

export type TickLevel = 0 | 1 | 2;

export interface Tick {
  v: number;
  level: TickLevel;
  detent?: true;
}

/** A tick once laid out against real track pixels (layoutTicks below) — the
 *  only form magnetSlider.ts's own snapping/drawing ever touches. */
export interface PlacedTick extends Tick {
  x: number;
  /** The most `snap` may reach for this tick, in px — REACH_CAP of the gap to
   *  its nearest kept neighbour of the same or higher rank (layoutTicks). */
  reachCapPx?: number;
}

export interface SliderScale {
  min: number;
  max: number;
  /** Value -> track position, 0..1. */
  toPos(v: number): number;
  /** Track position (0..1) -> value. */
  toVal(p: number): number;
  ticks: Tick[];
  discrete: boolean;
  /** Where the track's own fill starts (the low end for every scale today,
   *  except a log row with `zeroAtMin`, which fills from its carved-out 0). */
  fillFrom: number;
}

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

/** Is `v` a whole number of `step`s from `origin`? (tick-level assignment). */
function onGrid(v: number, origin: number, step: number): boolean {
  if (!(step > 0)) return false;
  const k = (v - origin) / step;
  return Math.abs(k - Math.round(k)) < 1e-6;
}

/** Marks each of `detents` as a level-2 detent tick on `ticks` (in place),
 *  adding it if no tick already sits there, then keeps the array sorted by
 *  value — every other function here assumes that order. */
function addDetents(ticks: Tick[], detents: readonly number[]): void {
  for (const d of detents) {
    const existing = ticks.find((t) => near(t.v, d));
    if (existing) {
      existing.detent = true;
      existing.level = 2;
    } else {
      ticks.push({ v: d, level: 2, detent: true });
    }
  }
  ticks.sort((a, b) => a.v - b.v);
}

/** An evenly-spaced scale: a fine tick every `fine`, stepped up to `mid` on
 *  round numbers and `major` on quarters/ends, plus any `detents`. `discrete`
 *  marks a genuinely stepped control (an integer count) rather than a
 *  continuous one with a merely-meaningful resolution — see autoLinearScale's
 *  own comment on why that distinction matters. Tick values are rounded
 *  (`toFixed(10)`) to kill the float drift repeated addition would otherwise
 *  bake into every tick past the first few. */
export function linearScale(opts: {
  min: number;
  max: number;
  fine: number;
  mid: number;
  major: number;
  detents?: readonly number[];
  discrete?: boolean;
}): SliderScale {
  const { min, max, fine, mid, major, detents = [], discrete = false } = opts;
  const span = max - min;
  const ticks: Tick[] = [];
  const n = fine > 0 ? Math.round(span / fine) : 0;
  for (let i = 0; i <= n; i++) {
    const v = +(min + i * fine).toFixed(10);
    const level: TickLevel = onGrid(v, min, major) || i === 0 || i === n ? 2 : onGrid(v, min, mid) ? 1 : 0;
    ticks.push({ v, level });
  }
  addDetents(ticks, detents);
  return {
    min,
    max,
    discrete,
    fillFrom: min,
    toPos: (v) => (span === 0 ? 0 : (v - min) / span),
    toVal: (p) => min + p * span,
    ticks,
  };
}

/** Log-mapped so a row's own defaultValue sits away from either end rather
 *  than skewing toward the wide "more" side. Reproduces createControlRow's
 *  old `posToValue`/`valueToPos` exactly (they worked in a 0..100 slider
 *  position; `toPos`/`toVal` here divide/multiply by 100 to land back in the
 *  0..1 fraction every other scale uses) — this is where those formulas
 *  moved from. With `zeroAtMin`, position 0 is carved out as an exact,
 *  deliberate 0 (an explicit kill, DJ-mixer style) and the log curve covers
 *  positions 1..100 instead of asymptoting toward 0 across the whole track;
 *  `toVal` gives the bottom half of that one-position gap to 0 and the rest
 *  of it to `min`, so a value dragged into the gap always lands on one of
 *  the two real stops instead of some point on the curve's own asymptote. */
export function logScale(opts: { min: number; max: number; zeroAtMin?: boolean; detents?: readonly number[] }): SliderScale {
  const { min, max, zeroAtMin = false, detents = [] } = opts;
  const loPos = zeroAtMin ? 1 : 0;
  const logSpan = Math.log(max / min);
  function posToValue(pos: number): number {
    if (zeroAtMin && pos <= 0) return 0;
    const t = (pos - loPos) / (100 - loPos);
    return min * Math.pow(max / min, t);
  }
  function valueToPos(value: number): number {
    if (zeroAtMin && value <= 0) return 0;
    const t = Math.log(value / min) / logSpan;
    return loPos + t * (100 - loPos);
  }
  const ticks: Tick[] = [];
  if (zeroAtMin) ticks.push({ v: 0, level: 2, detent: true });
  // A decade's worth of ticks follows the meter's own 1-2-5 convention
  // (extended with the in-between mantissas a fine scale needs); level 2 at
  // the decade itself, level 1 at 2x/5x, level 0 at the rest.
  const mantissas = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9];
  const decLo = Math.floor(Math.log10(min));
  const decHi = Math.ceil(Math.log10(max));
  for (let dec = decLo; dec <= decHi; dec++) {
    for (const m of mantissas) {
      const v = +(m * Math.pow(10, dec)).toPrecision(10);
      if (v < min * 0.999 || v > max * 1.001) continue;
      const level: TickLevel = near(m, 1) ? 2 : near(m, 2) || near(m, 5) ? 1 : 0;
      ticks.push({ v, level });
    }
  }
  addDetents(ticks, detents);
  return {
    min: zeroAtMin ? 0 : min,
    max,
    discrete: false,
    fillFrom: zeroAtMin ? 0 : min,
    toPos: (v) => valueToPos(v) / 100,
    toVal: (p) => {
      if (zeroAtMin) {
        if (p < 0.5 / 100) return 0;
        if (p < 1 / 100) return min;
      }
      return posToValue(p * 100);
    },
    ticks,
  };
}

/** Snaps `x` to the "nice" grid 1/2/2.5/5 x 10^k closest to it — the classic
 *  nice-number step (d3's tickStep and kin), used by autoLinearScale below to
 *  turn a raw span into round fine/mid/major spacings. The boundaries between
 *  buckets are each pair's geometric mean, so `x` rounds to whichever of the
 *  two it's closer to on a log scale. */
function niceNumber(x: number): number {
  if (!(x > 0)) return 0;
  const exp = Math.floor(Math.log10(x));
  const base = Math.pow(10, exp);
  const f = x / base;
  const m = f < Math.SQRT2 ? 1 : f < Math.sqrt(5) ? 2 : f < Math.sqrt(12.5) ? 2.5 : f < Math.sqrt(50) ? 5 : 10;
  return +(m * base).toPrecision(10);
}

/** The smallest multiple of `step` that's >= `x` — how autoLinearScale nests
 *  mid inside fine and major inside mid, so every major tick is also a mid
 *  tick and every mid tick also a fine one. The epsilon guards a `x` that's
 *  already (up to float noise) an exact multiple from rounding up one step
 *  too far. */
function roundUpToMultiple(x: number, step: number): number {
  if (!(step > 0)) return x;
  return +(Math.ceil(x / step - 1e-9) * step).toFixed(10);
}

/** Picks fine/mid/major spacings for a row that only declares min/max/step —
 *  every scene setting and gain row goes through this rather than hand-tuning
 *  three spacings each. `fine` is a "nice" ~1%-of-span step whatever a
 *  continuous row's own `step` says — a declared `step` like 0.05 on a 0..1
 *  row would make the scale itself the twenty visible hops the paragraph
 *  below warns about (precision mode goes finer still); `mid`/`major` are
 *  "nice" ~5%/25%-of-span steps, each then rounded up to the nearest multiple
 *  of the grid below it so the levels nest (see roundUpToMultiple). `discrete`
 *  keeps createControlRow's old rule: a `step` of 1 or more is a genuinely
 *  stepped control (an integer count) — anything smaller is a continuous
 *  row's own meaningful resolution, not a detent, and snapping to it made a
 *  0..1 row jump in visible hops across the track. A discrete row's fine and
 *  mid both collapse to `step` itself (every tick is a stop). `defaultValue`
 *  is the row's own detent — see linearScale's own `detents`. */
export function autoLinearScale(opts: { min: number; max: number; step?: number; defaultValue: number }): SliderScale {
  const { min, max, step, defaultValue } = opts;
  const span = max - min;
  const discrete = step !== undefined && step >= 1;
  let fine: number;
  let mid: number;
  if (discrete) {
    fine = step;
    mid = step;
  } else {
    fine = niceNumber(span / 100);
    mid = roundUpToMultiple(niceNumber(span / 20), fine);
  }
  const major = roundUpToMultiple(niceNumber(span / 4), mid);
  return linearScale({ min, max, fine, mid, major, detents: [defaultValue], discrete });
}

// Minimum on-screen gap (px) a tick of each level needs from any tick
// already kept — layoutTicks below thins the fine grid first on a narrow
// track (a phone), so a marked value is never the one that gets crowded out.
export const MIN_GAP_PX: readonly [number, number, number] = [2.16, 3.6, 5.4];

/** Places `scale.ticks` against real track pixels (`x0`..`x1`) and thins them
 *  to fit: kept in level order (majors and detents first), each dropped only
 *  if it would land within `MIN_GAP_PX[level]` of a tick already kept — a
 *  detent is never dropped. The result is sorted back into track order,
 *  which every consumer (snap's nearest-tick walk, precisionValue's bracket
 *  search) relies on. Each kept tick also gets its `reachCapPx`. */
export function layoutTicks(scale: SliderScale, x0: number, x1: number): PlacedTick[] {
  const w = x1 - x0;
  const all: PlacedTick[] = scale.ticks.map((t) => ({ ...t, x: x0 + scale.toPos(t.v) * w }));
  const rank = (t: PlacedTick): number => (t.detent ? 3 : t.level);
  const order = all.slice().sort((a, b) => rank(b) - rank(a));
  const kept: PlacedTick[] = [];
  for (const t of order) {
    if (t.detent || kept.every((k) => Math.abs(k.x - t.x) >= MIN_GAP_PX[t.level])) kept.push(t);
  }
  // A detent is capped against majors too — it rarely has another detent near
  // enough to bound it.
  const capRank = (t: PlacedTick): number => Math.min(rank(t), 2);
  for (const t of kept) {
    let gap = Infinity;
    for (const k of kept) if (k !== t && capRank(k) >= capRank(t)) gap = Math.min(gap, Math.abs(k.x - t.x));
    t.reachCapPx = gap * REACH_CAP;
  }
  return kept.sort((a, b) => a.x - b.x);
}

// A tick may pull from at most this share of the gap to its nearest
// neighbour of the same or higher rank — the pixel reaches below are sized
// for a wide desktop track, and on a narrow one (the patch bay's weight
// slider, a phone) they'd otherwise cover every step between two ticks.
export const REACH_CAP = 0.35;

// Feel constants — one place, so re-tuning the pull never means hunting
// through magnetSlider.ts's drag math. MAGNETISM scales every reach in
// `snap` at once; a marked value (DETENT_PULL_PX) pulls hardest, then a
// tick's own level (TICK_PULL_PX x LEVEL_PULL); HOLD_ON is how far past its
// own reach a tick the thumb is already latched to keeps holding, so the
// latch doesn't chatter right at the boundary.
export const MAGNETISM = 1.1;
export const TICK_PULL_PX = 4;
export const LEVEL_PULL: readonly [number, number, number] = [1, 1.5, 2.2];
export const DETENT_PULL_PX = 14;
export const HOLD_ON = 1.5;

/** The nearest tick to `x` — also `snap`'s own fallback once nothing is in
 *  reach, and the pointerdown landing tick (see magnetSlider.ts). Assumes
 *  `ticks` is non-empty, true of every scale layoutTicks produces (a scale
 *  always keeps both its ends). */
export function nearestTick(x: number, ticks: readonly PlacedTick[]): PlacedTick {
  let nearest = ticks[0];
  let nd = Infinity;
  for (const t of ticks) {
    const d = Math.abs(x - t.x);
    if (d < nd) {
      nd = d;
      nearest = t;
    }
  }
  return nearest;
}

/** Where the thumb lands for a raw pointer position `x`, in the panel's one
 *  snap mode (Step — see this file's own header). `discrete` always snaps to
 *  the nearest tick, ignoring `bypass`: an integer count has no free
 *  position to bypass into. Otherwise `bypass` (Shift, on a continuous row)
 *  returns null — a free position, unsnapped. A tick the thumb is already
 *  `latched` to (major/detent only — a mid tick holding on as well swallowed
 *  every fine step between two mids) holds on past its own reach, scaled by
 *  HOLD_ON, so passing exactly at the boundary doesn't chatter. Every reach
 *  is also capped by the tick's own `reachCapPx` (layoutTicks) so a pull
 *  sized in pixels never covers the steps between ticks on a narrow track.
 *  Failing that,
 *  the best-scoring tick within reach wins (a detent outranks any level,
 *  which outranks plain distance); failing *that*, the nearest tick — Step
 *  mode never leaves the thumb free. */
export function snap(
  x: number,
  ticks: readonly PlacedTick[],
  latched: PlacedTick | null,
  discrete: boolean,
  bypass: boolean,
): PlacedTick | null {
  if (discrete) return nearestTick(x, ticks);
  if (bypass) return null;
  const pull = (t: PlacedTick): number =>
    Math.min(MAGNETISM * (t.detent ? DETENT_PULL_PX : TICK_PULL_PX * LEVEL_PULL[t.level]), t.reachCapPx ?? Infinity);
  if (latched && (latched.detent || latched.level === 2) && Math.abs(x - latched.x) <= pull(latched) * HOLD_ON) {
    return latched;
  }
  let best: PlacedTick | null = null;
  let bestScore = -Infinity;
  for (const t of ticks) {
    const d = Math.abs(x - t.x);
    if (d > pull(t)) continue;
    const score = (t.detent ? 10 : t.level) * 100 - d;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best ?? nearestTick(x, ticks);
}

// Precision constants — see this file's own header. PRECISION_SUB[level] is
// both how many equal steps precisionValue quantizes into and how much the
// lens magnifies by; HOLD_MS[level] is how long a slow/still pointer must
// hold before reaching that level; SLOW_PX_S/FAST_PX_S bound "holding still"
// and "moving fast enough to drop straight back to normal"; LEASH_PX is how
// far the pointer may wander from the thumb in precision before precision
// lets go (small wiggles near the thumb are fine-tuning, a longer pull means
// "move it"); HOLD_STILL_PX_S is the stricter "still" a drag needs to
// re-enter precision after that — without it a slow steady drag would open
// precision, snap the leash, and reopen it over and over; CATCH_UP is how much of any leftover gap closes per
// pixel of motion once back at normal speed; LENS_CORE_PX/LENS_EDGE_PX are
// the magnifier's own flat core and the point it rejoins the plain scale.
export const PRECISION_SUB: readonly [number, number, number] = [1, 5, 10];
export const SLOW_PX_S = 40;
export const FAST_PX_S = 220;
export const HOLD_MS: readonly [number, number, number] = [0, 308, 1210];
export const SPEED_WINDOW_MS = 120;
export const LEASH_PX = 24;
export const HOLD_STILL_PX_S = 8;
export const CATCH_UP = 0.5;
export const LENS_CORE_PX = 60;
export const LENS_EDGE_PX = 96;

/** Pointer speed in px/s, from samples within the last SPEED_WINDOW_MS —
 *  under 2 samples in that window (just started dragging, or the pointer
 *  hasn't moved) reads as stopped. The 40 ms floor under the elapsed time
 *  keeps two almost-simultaneous samples from reporting a wild instantaneous
 *  speed off a near-zero denominator. */
export function pointerSpeed(samples: readonly { t: number; x: number }[], now: number): number {
  const recent = samples.filter((p) => now - p.t <= SPEED_WINDOW_MS);
  if (recent.length < 2) return 0;
  const first = recent[0];
  const last = recent[recent.length - 1];
  return (Math.abs(last.x - first.x) / Math.max(40, now - first.t)) * 1000;
}

/** Advances the precision level for one tick of `dt` ms at pointer `speed`:
 *  a fast move drops straight back to 0 (and resets the hold clock); slower
 *  than SLOW_PX_S accumulates `slowMs`, which raises the level once it
 *  passes HOLD_MS for that level. The level otherwise never decreases on its
 *  own (only a fast move drops it) — called with `dt` 0 from a pointermove
 *  event (see magnetSlider.ts) this can only ever trigger that fast-move
 *  drop, letting precision leave immediately rather than waiting for the
 *  next animation frame; the real rise happens from the per-frame call with
 *  a real `dt`. */
export function nextPrecisionLevel(
  level: TickLevel,
  speed: number,
  slowMs: number,
  dt: number,
  slowPxS: number = SLOW_PX_S,
): { level: TickLevel; slowMs: number } {
  if (speed > FAST_PX_S) return { level: 0, slowMs: 0 };
  const nextSlowMs = speed < slowPxS ? slowMs + dt : slowMs;
  const achievable: TickLevel = nextSlowMs >= HOLD_MS[2] ? 2 : nextSlowMs >= HOLD_MS[1] ? 1 : 0;
  return { level: Math.max(level, achievable) as TickLevel, slowMs: nextSlowMs };
}

/** Quantizes track position `u` to `sub` equal steps between the two ticks
 *  bracketing it — precision mode's actual value, once the lens has opened.
 *  `ticks` is the same track-ordered, already-thinned list every other
 *  consumer here uses (layoutTicks' output), so "the two ticks bracketing
 *  it" mean whichever pair the *visible* scale shows, not the raw grid. */
export function precisionValue(u: number, ticks: readonly PlacedTick[], sub: number): number {
  if (ticks.length < 2) return ticks[0]?.v ?? 0;
  let i = 0;
  while (i < ticks.length - 2 && ticks[i + 1].x < u) i++;
  const a = ticks[i];
  const b = ticks[i + 1];
  const k = Math.round(Math.max(0, Math.min(1, (u - a.x) / (b.x - a.x))) * sub);
  return +(a.v + ((b.v - a.v) * k) / sub).toPrecision(10);
}

/** The precision lens: a flat magnified core around `center` (radius
 *  LENS_CORE_PX/mag in real track pixels), a compressed ring out to
 *  LENS_EDGE_PX, then the plain scale (`fade` 1) beyond it. `fade` in the
 *  ring lets the plain scale's own ticks dim smoothly as they're swallowed
 *  into the lens rather than popping in and out at a hard edge. */
export function lens(x: number, center: number, mag: number): { x: number; fade: number } {
  const d = x - center;
  const ad = Math.abs(d);
  if (mag <= 1.001 || ad >= LENS_EDGE_PX) return { x, fade: 1 };
  const c = LENS_CORE_PX / mag;
  if (ad <= c) return { x: center + d * mag, fade: 1 };
  const k = (LENS_EDGE_PX - LENS_CORE_PX) / (LENS_EDGE_PX - c);
  return { x: center + Math.sign(d) * (LENS_CORE_PX + (ad - c) * k), fade: 0.35 + 0.65 * Math.min(1, k) };
}

/** A thumb's own track position and its pointer "grab" offset, threaded
 *  through dragStep below — kept as one pair since precision's leash and
 *  normal speed's catch-up both resolve to the same shape (a new `u`, a new
 *  `grabOffset`), just by different rules. */
export interface DragPos {
  u: number;
  grabOffset: number;
  /** Set when this step pulled the pointer past LEASH_PX in precision — the
   *  caller drops back to normal speed so the thumb catches up. */
  released?: boolean;
}

/** One drag step's relative-motion math, shared by every precision level
 *  (`sub` from PRECISION_SUB): at `sub` 1 (normal speed) the thumb tracks the
 *  pointer directly, offset by `grabOffset` (bled off at CATCH_UP toward
 *  `homeOffset` — 0 outside precision — so the thumb settles back under the
 *  pointer as it moves rather than staying offset from a precision drag that
 *  just ended). At `sub` > 1 the thumb moves at `1/sub` of the pointer's own
 *  motion (so a tick still passes every few pixels of a slow drag); once the
 *  pointer gets more than LEASH_PX from the thumb the step reports
 *  `released` and puts the thumb straight back under the pointer (the caller
 *  drops to normal speed). CATCH_UP only closes a gap left by leaving
 *  precision with a fast move. */
export function dragStep(
  pos: DragPos,
  fx: number,
  dx: number,
  sub: number,
  x0: number,
  x1: number,
  homeOffset: number,
): DragPos {
  const clamp = (x: number): number => Math.max(x0, Math.min(x1, x));
  if (sub > 1) {
    let u = clamp(pos.u + dx / sub);
    const drift = u - fx - homeOffset;
    if (Math.abs(drift) > LEASH_PX) {
      // Let go: the thumb goes straight back under the pointer (the display
      // eases it there) rather than creeping after it at catch-up speed.
      return { u: clamp(fx + homeOffset), grabOffset: homeOffset, released: true };
    }
    return { u, grabOffset: u - fx };
  }
  const gap = pos.grabOffset - homeOffset;
  const grabOffset = gap === 0 ? pos.grabOffset : pos.grabOffset - Math.sign(gap) * Math.min(Math.abs(gap), Math.abs(dx) * CATCH_UP);
  return { u: clamp(fx + grabOffset), grabOffset };
}
