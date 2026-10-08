import { describe, expect, it } from "vitest";
import { BUCKET_MS, CARRY_MS, createColumnStore } from "../src/ui/columnStore.ts";
import { HISTORY_SPAN_DEFAULT, HISTORY_SPAN_MAX, HISTORY_SPANS } from "../src/ui/historySpan.ts";

const FRAME_MS = 1000 / 60;

/** Pushes one series at 60 fps for `sec` seconds from `t0`, `value(t)` per
 *  frame, and returns the time after the last push. */
function feed(store: ReturnType<typeof createColumnStore>, t0: number, sec: number, value: (t: number) => number | null): number {
  let t = t0;
  for (const end = t0 + sec * 1000; t < end; t += FRAME_MS) store.push([value(t)], t);
  return t;
}

function columns(store: ReturnType<typeof createColumnStore>, width: number, spanSec: number): number[] {
  const out = new Float32Array(width);
  store.resample(out, width, spanSec);
  return Array.from(out);
}

describe("columnStore", () => {
  it("fills every column of the default span at 60 fps, with no gaps", () => {
    const store = createColumnStore(1, HISTORY_SPAN_MAX);
    feed(store, 0, HISTORY_SPAN_DEFAULT + 1, () => 0.5);
    const cols = columns(store, 300, HISTORY_SPAN_DEFAULT);
    expect(cols.every((v) => v === 0.5)).toBe(true);
  });

  it("keeps a one-frame spike visible at every span", () => {
    const store = createColumnStore(1, HISTORY_SPAN_MAX);
    // A spike early on, then the longest span's worth of quiet after it, less a little.
    const spikeAt = 1000;
    feed(store, 0, HISTORY_SPAN_MAX - 5, (t) => (Math.abs(t - spikeAt) < FRAME_MS / 2 ? 1 : 0.1));
    for (const span of HISTORY_SPANS) {
      const cols = columns(store, 300, span);
      const shown = span >= HISTORY_SPAN_MAX - 6;
      expect(cols.includes(1), `${span}s`).toBe(shown);
    }
  });

  it("shows the same recent picture whether or not a longer span was drawn in between", () => {
    const a = createColumnStore(1, HISTORY_SPAN_MAX);
    const b = createColumnStore(1, HISTORY_SPAN_MAX);
    const wave = (t: number) => 0.5 + 0.5 * Math.sin(t / 300);
    let ta = feed(a, 0, 20, wave);
    let tb = feed(b, 0, 20, wave);
    columns(b, 300, HISTORY_SPAN_MAX); // drawing doesn't disturb recording
    ta = feed(a, ta, 5, wave);
    tb = feed(b, tb, 5, wave);
    expect(columns(a, 300, HISTORY_SPAN_DEFAULT)).toEqual(columns(b, 300, HISTORY_SPAN_DEFAULT));
  });

  it("scrolls whole columns: one column later, the picture is the same shifted by one", () => {
    const store = createColumnStore(1, HISTORY_SPAN_MAX);
    const width = 250; // 10 s / 250 px = 40 ms = 2.5 buckets per column
    let t = feed(store, 0, 12, (t) => Math.floor(t / 97) % 7);
    // Land on a column boundary, then advance exactly one column.
    const colMs = (HISTORY_SPAN_DEFAULT * 1000) / width;
    t = feed(store, t, 0.5, (t) => Math.floor(t / 97) % 7);
    const before = columns(store, width, HISTORY_SPAN_DEFAULT);
    t = feed(store, t, (colMs * 2) / 1000, (t) => Math.floor(t / 97) % 7);
    const after = columns(store, width, HISTORY_SPAN_DEFAULT);
    // Every closed column of `before` reappears in `after`, shifted by a whole number of columns.
    const body = before.slice(10, width - 10);
    let found = false;
    for (let shift = 1; shift <= 4 && !found; shift++) {
      found = body.every((v, i) => after[10 + i - shift] === v);
    }
    expect(found).toBe(true);
  });

  it("holds a slow frame's sample across the buckets it covers, but leaves a stall blank", () => {
    const store = createColumnStore(1, HISTORY_SPAN_MAX);
    let t = 0;
    // 20 fps: every frame closes ~3 buckets.
    for (; t < 11000; t += 50) store.push([0.75], t);
    expect(columns(store, 300, HISTORY_SPAN_DEFAULT).every((v) => v === 0.75)).toBe(true);
    // A hidden tab: nothing for 3 s, then frames again.
    t += 3000;
    for (const end = t + 1000; t < end; t += FRAME_MS) store.push([0.75], t);
    const cols = columns(store, 300, HISTORY_SPAN_DEFAULT);
    const blank = cols.filter((v) => Number.isNaN(v)).length;
    // About 3 s of the 10 s span is blank (minus the carry bound).
    expect(blank).toBeGreaterThan(300 * ((3000 - CARRY_MS) / 10000) - 5);
    expect(blank).toBeLessThan(300 * (3000 / 10000) + 5);
  });

  it("leaves a series with no reading blank, not zero", () => {
    const store = createColumnStore(2, HISTORY_SPAN_DEFAULT);
    let t = 0;
    for (; t < 11000; t += FRAME_MS) store.push([0.25, null], t);
    const out = new Float32Array(100 * 2);
    store.resample(out, 100, HISTORY_SPAN_DEFAULT);
    for (let x = 0; x < 100; x++) {
      expect(out[x * 2]).toBe(0.25);
      expect(out[x * 2 + 1]).toBeNaN();
    }
  });

  it("stretches rather than gaps when the width outnumbers the buckets", () => {
    const store = createColumnStore(1, HISTORY_SPAN_DEFAULT);
    feed(store, 0, 11, () => 0.375);
    const width = Math.ceil((HISTORY_SPAN_DEFAULT * 1000) / BUCKET_MS) * 2;
    expect(columns(store, width, HISTORY_SPAN_DEFAULT).every((v) => v === 0.375)).toBe(true);
  });

  it("redraws into the same buffer exactly as a fresh full redraw would, at every span", () => {
    for (const span of HISTORY_SPANS) {
      // Fed identically: `a` always redraws into one buffer, `b` into a new one.
      const a = createColumnStore(2, HISTORY_SPAN_MAX);
      const b = createColumnStore(2, HISTORY_SPAN_MAX);
      const width = 333;
      const kept = new Float32Array(width * 2);
      let t = 0;
      for (let f = 0; f < 60 * 70; f++, t += FRAME_MS + (f % 7 === 0 ? 9 : 0)) {
        const v: (number | null)[] = [Math.sin(t / 211) * 0.5 + 0.5, f % 31 === 0 ? 1 : null];
        a.push(v, t);
        b.push(v, t);
        if (f > 60 * 65) {
          a.resample(kept, width, span);
          const fresh = new Float32Array(width * 2);
          b.resample(fresh, width, span);
          expect(Array.from(kept), `${span}s frame ${f}`).toEqual(Array.from(fresh));
        }
      }
    }
  });

  it("reads the newest column from the bucket still filling", () => {
    const store = createColumnStore(1, HISTORY_SPAN_DEFAULT);
    store.push([0.125], 0);
    expect(columns(store, 50, HISTORY_SPAN_DEFAULT).at(-1)).toBe(0.125);
  });
});
