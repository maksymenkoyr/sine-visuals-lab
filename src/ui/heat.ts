/**
 * Heat: how hot a reactive setting, one of its wires, or a signal runs —
 * how much of its range it swung over the meter span, made hotter by loud
 * music and colder by quiet music (docs/vocabulary.md's **heat**).
 * Heat shows in the panel four ways, all fed by the same tracks (deviceMenu.ts
 * and audioMeters.ts own the elements, this file only measures and colours):
 *   1. a thin history strip under every wired setting's graph and under every
 *      signal's monitor row, always on;
 *   2. the Heat history card in the meters column, folded by default, with one
 *      strip per wired setting and per signal jack;
 *   3. the heat lens (L, or the column head's HEAT chip): every wired
 *      setting's row and every signal jack glows in its heat colour, brighter
 *      the more it's moving right now;
 *   4. a dot after each wire's name in the wire panel, and a line in the
 *      tooltips of a port and a jack.
 * heatHistory reads the same buckets as a single reading, so the history
 * costs no extra memory.
 *
 * One HeatTrack per thing measured. It keeps a ring of one-second buckets
 * covering HISTORY_SPAN_MAX (historySpan.ts), each holding n, Σx, Σx² and
 * Σlevel, so memory stays fixed however long it runs. A bucket remembers
 * which second it holds: a stall that skips a second leaves that slot stale
 * rather than counted twice, and a slot the ring comes back round to is
 * reset before reuse.
 *
 * Over the last `span` seconds, with x the reading scaled to 0..1:
 *   swing = min(1, 2·stdev(x)) — a 0..1 value's stdev tops out at ½, so a
 *     full-range swing reads 1, a flat value 0, sparse hits low, dense hits high;
 *   loud  = smoothstep(HEAT_LEVEL_QUIET, HEAT_LEVEL_LOUD, mean(level)), level
 *     being FeatureFrame.level, the one loudness the auto-gain doesn't flatten;
 *   heat  = swing · (HEAT_LOUD_FLOOR + (1 − HEAT_LOUD_FLOOR) · loud), and 0
 *     while mean(level) is under HEAT_LEVEL_QUIET, so silence reads cold.
 *
 * Heat quantises to HEAT_STEPS colours between HEAT_COLORS' anchors. The
 * owners refresh colours at most every HEAT_REFRESH_MS, and write a style only
 * when its step changes. Nothing here is persisted or synced: the panel is the
 * only place heat shows, so none of it reaches the output window or a TV.
 */
import { HISTORY_SPAN_MAX, formatHistorySpan } from "./historySpan.ts";

/** mean(level) under this reads as silence: heat 0. */
export const HEAT_LEVEL_QUIET = 0.1;
/** mean(level) at or over this counts fully loud. */
export const HEAT_LEVEL_LOUD = 0.55;
/** The share of its swing a setting keeps on quiet music, so a value that
 *  moves a lot on quiet music still shows warm rather than dead. */
const HEAT_LOUD_FLOOR = 0.3;
/** Cold → hot anchors, readable on the dark glass panel: a dim desaturated
 *  blue, amber, red-orange. */
export const HEAT_COLORS: readonly string[] = ["#4d5b78", "#f0a830", "#ff5a26"];
/** How many colours heat steps through between HEAT_COLORS' anchors. */
export const HEAT_STEPS = 6;
/** How often a heat colour's owner refreshes it, at most. */
export const HEAT_REFRESH_MS = 1000;

export interface HeatReading {
  heat: number;
  swing: number;
  /** mean(FeatureFrame.level) over the span. */
  level: number;
  /** How many ticks the span counted. */
  samples: number;
}

export interface HeatTrack {
  /** One tick: `x` is the reading scaled to 0..1 (clamped here; a non-finite
   *  reading counts as 0), `level` FeatureFrame.level, `nowSec` seconds on
   *  any steady clock. */
  push(x: number, level: number, nowSec: number): void;
  /** The last `spanSec` seconds up to `nowSec`, counting the current
   *  part-filled second; null when nothing was recorded in that window. */
  read(spanSec: number, nowSec: number): HeatReading | null;
}

// One more than the longest span, so the slot the current second writes is
// never one the longest span still counts.
const BUCKETS = HISTORY_SPAN_MAX + 1;

const clamp01 = (v: number): number => (Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0);
const slotOf = (s: number): number => ((s % BUCKETS) + BUCKETS) % BUCKETS;

export function createHeatTrack(): HeatTrack {
  const sec = new Float64Array(BUCKETS).fill(-Infinity);
  const n = new Float64Array(BUCKETS);
  const sx = new Float64Array(BUCKETS);
  const sxx = new Float64Array(BUCKETS);
  const sl = new Float64Array(BUCKETS);
  return {
    push(x, level, nowSec) {
      const s = Math.floor(nowSec);
      const i = slotOf(s);
      if (sec[i] !== s) {
        sec[i] = s;
        n[i] = 0;
        sx[i] = 0;
        sxx[i] = 0;
        sl[i] = 0;
      }
      const v = clamp01(x);
      n[i] = n[i]! + 1;
      sx[i] = sx[i]! + v;
      sxx[i] = sxx[i]! + v * v;
      sl[i] = sl[i]! + clamp01(level);
    },
    read(spanSec, nowSec) {
      const now = Math.floor(nowSec);
      const span = Math.max(1, Math.min(HISTORY_SPAN_MAX, Math.round(spanSec)));
      let total = 0;
      let sumX = 0;
      let sumXX = 0;
      let sumL = 0;
      for (let s = now - span + 1; s <= now; s++) {
        const i = slotOf(s);
        if (sec[i] !== s) continue;
        total += n[i]!;
        sumX += sx[i]!;
        sumXX += sxx[i]!;
        sumL += sl[i]!;
      }
      if (total === 0) return null;
      const mean = sumX / total;
      const swing = Math.min(1, 2 * Math.sqrt(Math.max(0, sumXX / total - mean * mean)));
      const level = sumL / total;
      return { heat: heatOf(swing, level), swing, level, samples: total };
    },
  };
}

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** 0..1: how loud `level` (a mean FeatureFrame.level) counts. */
function heatLoudness(level: number): number {
  return smoothstep(HEAT_LEVEL_QUIET, HEAT_LEVEL_LOUD, level);
}

/** The heat formula in this file's header. */
function heatOf(swing: number, level: number): number {
  if (level < HEAT_LEVEL_QUIET) return 0;
  return swing * (HEAT_LOUD_FLOOR + (1 - HEAT_LOUD_FLOOR) * heatLoudness(level));
}

/** 0 (coldest) .. HEAT_STEPS − 1 (hottest). */
export function heatStep(heat: number): number {
  return Math.min(HEAT_STEPS - 1, Math.max(0, Math.floor(clamp01(heat) * HEAT_STEPS)));
}

// HEAT_STEPS colours spread evenly across HEAT_COLORS' anchors, mixed in RGB.
const STEP_COLORS: readonly string[] = Array.from({ length: HEAT_STEPS }, (_, step) => {
  const t = (step / (HEAT_STEPS - 1)) * (HEAT_COLORS.length - 1);
  const i = Math.min(HEAT_COLORS.length - 2, Math.floor(t));
  const f = t - i;
  const a = hexRgb(HEAT_COLORS[i]!);
  const b = hexRgb(HEAT_COLORS[i + 1]!);
  return "#" + a.map((c, k) => Math.round(c + (b[k]! - c) * f).toString(16).padStart(2, "0")).join("");
});

function hexRgb(hex: string): number[] {
  return [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
}

export function heatColor(step: number): string {
  return STEP_COLORS[Math.min(HEAT_STEPS - 1, Math.max(0, step))]!;
}

/** How many cells a heat history strip has at most (a longer span makes each cell cover more seconds). */
export const HEAT_HISTORY_CELLS = 60;
/** The shortest stretch one history cell's heat is measured over, in seconds; a single second's stdev is too noisy. */
const HEAT_HISTORY_WINDOW_SEC = 5;
/** A history cell with nothing recorded. */
const HEAT_HISTORY_EMPTY = "rgba(255,255,255,0.06)";
/** How many brightness levels the lens glow has; it's written only when the level changes. */
const HEAT_GLOW_LEVELS = 12;

/** The heat steps of a history strip: up to `cells` cells across the last
 *  `spanSec` seconds, oldest first, each the heat over the
 *  HEAT_HISTORY_WINDOW_SEC (or one cell, if longer) ending at that cell's
 *  second; null where nothing was recorded. */
export function heatHistory(track: HeatTrack, spanSec: number, nowSec: number, cells: number): (number | null)[] {
  const n = Math.max(1, Math.min(cells, Math.round(spanSec)));
  const cellSec = spanSec / n;
  const win = Math.max(HEAT_HISTORY_WINDOW_SEC, Math.ceil(cellSec));
  const out: (number | null)[] = [];
  for (let j = 0; j < n; j++) {
    const r = track.read(win, nowSec - (n - 1 - j) * cellSec);
    out.push(r ? heatStep(r.heat) : null);
  }
  return out;
}

/** A CSS background drawing `steps` as hard-edged cells, left to right; runs
 *  of the same colour merge into one stop pair. */
export function heatStripBackground(steps: readonly (number | null)[]): string {
  if (!steps.length) return HEAT_HISTORY_EMPTY;
  const stops: string[] = [];
  let runStart = 0;
  for (let j = 1; j <= steps.length; j++) {
    if (j < steps.length && steps[j] === steps[runStart]) continue;
    const s = steps[runStart];
    const color = s === null || s === undefined ? HEAT_HISTORY_EMPTY : heatColor(s);
    const a = ((runStart / steps.length) * 100).toFixed(2);
    const b = ((j / steps.length) * 100).toFixed(2);
    stops.push(`${color} ${a}% ${b}%`);
    runStart = j;
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

/** The lens glow's strength for a live reading `x` (0..1), quantised to HEAT_GLOW_LEVELS. */
export function heatGlowLevel(x: number): number {
  return Math.round(clamp01(x) * HEAT_GLOW_LEVELS) / HEAT_GLOW_LEVELS;
}

/** The plain word for a heat, in step with its colour. */
const HEAT_WORDS = ["cold", "cool", "warm", "hot"] as const;
function heatWord(heat: number): string {
  return HEAT_WORDS[Math.min(HEAT_WORDS.length - 1, Math.floor((heatStep(heat) * HEAT_WORDS.length) / HEAT_STEPS))]!;
}

const HEAT_SCALE_TEXT = "Colder = barely moves, hotter = big moves on loud music.";

/** The tooltip line: plain words, with direction words at the end. */
export function heatText(reading: HeatReading | null, spanSec: number): string {
  if (!reading) return `Heat: not measured yet. ${HEAT_SCALE_TEXT}`;
  const { swing, level } = reading;
  const moved = swing < 0.1 ? "Barely moved" : swing < 0.3 ? "Moved a little" : swing < 0.6 ? "Moved a fair amount" : "Moved a lot";
  const loud = heatLoudness(level);
  const music =
    level < HEAT_LEVEL_QUIET ? "in silence" : loud < 1 / 3 ? "on quiet music" : loud < 2 / 3 ? "on fairly loud music" : "on loud music";
  return `Heat: ${heatWord(reading.heat)}. ${moved} over the last ${formatHistorySpan(spanSec)}, ${music}. ${HEAT_SCALE_TEXT}`;
}

/** A heat pip: the dot after a wire's name in the wire panel (controlsTheme.ts's
 *  .vc-heat-pip rules place it). */
export interface HeatPip {
  el: HTMLSpanElement;
  /** Recolours only when the step changes; keeps `hintEl`'s data-hint current
   *  when given. */
  set(reading: HeatReading | null, spanSec: number): void;
}

export function createHeatPip(hintEl?: HTMLElement): HeatPip {
  const el = document.createElement("span");
  el.className = "vc-heat-pip vc-heat-pip-wire";
  el.setAttribute("aria-hidden", "true");
  let step = -1;
  let text: string | null = null;
  const setStep = (next: number): void => {
    if (next === step) return;
    step = next;
    el.style.setProperty("--heat", heatColor(next));
  };
  setStep(0);
  return {
    el,
    set(reading, spanSec) {
      setStep(heatStep(reading?.heat ?? 0));
      const next = heatText(reading, spanSec);
      if (next !== text) {
        text = next;
        if (hintEl) hintEl.dataset.hint = next;
      }
    },
  };
}
