import { describe, it, expect } from "vitest";
import { WireDecimator } from "../src/net/wireDecimator.ts";

const INTERVAL = 1000 / 30;

/** 60 Hz ticks stamped with integer milliseconds, as Date.now() gives them
 *  (16 and 17 alternating), which is what made a strict interval test slip
 *  to every third tick. */
function ticks(seconds: number, start = 1_000_000): number[] {
  const out: number[] = [];
  for (let i = 0; i < seconds * 60; i++) out.push(start + Math.round((i * 1000) / 60));
  return out;
}

describe("WireDecimator", () => {
  it("holds the wire rate at 30 Hz on integer-millisecond 60 Hz ticks", () => {
    const d = new WireDecimator(INTERVAL);
    let sends = 0;
    const ts = ticks(2);
    for (const t of ts) if (d.offer(t, false, false).send) sends++;
    expect(Math.abs(sends - 60)).toBeLessThanOrEqual(1);
  });

  it("sends on the first call", () => {
    expect(new WireDecimator(INTERVAL).offer(5000, false, false).send).toBe(true);
  });

  it("carries a flag raised on a skipped tick to the next send, once", () => {
    const d = new WireDecimator(INTERVAL);
    expect(d.offer(0, false, false).send).toBe(true);
    const skipped = d.offer(16, true, false);
    expect(skipped.send).toBe(false);
    const next = d.offer(33, false, false);
    expect(next.send).toBe(true);
    expect(next.onset).toBe(true);
    expect(next.pulseOnset).toBe(false);
    d.offer(50, false, false);
    const after = d.offer(67, false, false);
    expect(after.send).toBe(true);
    expect(after.onset).toBe(false);
  });

  it("does the same for the pulse onset, independently", () => {
    const d = new WireDecimator(INTERVAL);
    d.offer(0, false, false);
    d.offer(16, false, true);
    const next = d.offer(33, false, false);
    expect(next.send).toBe(true);
    expect(next.pulseOnset).toBe(true);
    expect(next.onset).toBe(false);
  });

  it("a flag on a sending tick goes out with it", () => {
    const d = new WireDecimator(INTERVAL);
    d.offer(0, false, false);
    d.offer(16, false, false);
    expect(d.offer(33, true, true)).toEqual({ send: true, onset: true, pulseOnset: true });
  });

  it("after a long gap sends once, with no burst of catch-up sends", () => {
    const d = new WireDecimator(INTERVAL);
    d.offer(0, false, false);
    expect(d.offer(1000, false, false).send).toBe(true);
    expect(d.offer(1016, false, false).send).toBe(false);
    expect(d.offer(1033, false, false).send).toBe(true);
  });

  it("restarts its schedule when the room clock steps backwards", () => {
    const d = new WireDecimator(INTERVAL);
    d.offer(1000, false, false);
    expect(d.offer(400, false, false).send).toBe(true);
    expect(d.offer(416, false, false).send).toBe(false);
    expect(d.offer(433, false, false).send).toBe(true);
  });
});
