import { describe, it, expect } from "vitest";
import {
  createTempoSettle,
  TEMPO_SETTLE_SEC,
  TEMPO_HOLD_BPM,
  RETUNE_LOCK,
  RETUNE_UNSURE_SEC,
  type TempoSettle,
} from "../src/render/tempoSettle.ts";

const DT = 1 / 60;

/** Steps `settle` for `sec` seconds at DT, pushing `bpmAt(t)` each tick (`t`
 *  the elapsed time before this tick's own push, matching a real caller). */
function run(settle: TempoSettle, sec: number, bpmAt: (t: number) => number, lock?: number): void {
  let t = 0;
  const steps = Math.round(sec / DT);
  for (let i = 0; i < steps; i++) {
    settle.push(bpmAt(t), DT, lock);
    t += DT;
  }
}

describe("tempoSettle", () => {
  it("settles a steady input within ~TEMPO_SETTLE_SEC", () => {
    const settle = createTempoSettle();
    run(settle, TEMPO_SETTLE_SEC * 1.3, () => 120);
    expect(settle.bpm).toBeCloseTo(120, 5);
  });

  it("ignores ±1 bpm jitter once settled", () => {
    const settle = createTempoSettle();
    run(settle, TEMPO_SETTLE_SEC * 1.3, () => 120);
    const held = settle.bpm;
    expect(held).toBeCloseTo(120, 5);

    let sign = 1;
    run(settle, 3, () => {
      sign = -sign;
      return 120 + sign; // alternates 119/121
    });
    expect(settle.bpm).toBe(held);
  });

  it("adopts a real, sustained change of at least TEMPO_HOLD_BPM", () => {
    const settle = createTempoSettle();
    run(settle, TEMPO_SETTLE_SEC * 1.3, () => 120);
    expect(settle.bpm).toBeCloseTo(120, 5);

    expect(Math.abs(130 - 120)).toBeGreaterThanOrEqual(TEMPO_HOLD_BPM);
    run(settle, TEMPO_SETTLE_SEC * 1.3, () => 130);
    expect(settle.bpm).toBeCloseTo(130, 5);
  });

  it("reads 0 once the raw estimate has been silent for a full window", () => {
    const settle = createTempoSettle();
    run(settle, TEMPO_SETTLE_SEC * 1.3, () => 120);
    expect(settle.bpm).toBeGreaterThan(0);

    run(settle, TEMPO_SETTLE_SEC * 1.3, () => 0);
    expect(settle.bpm).toBe(0);
  });

  it("a minority of outliers doesn't move the held value", () => {
    const settle = createTempoSettle();
    run(settle, TEMPO_SETTLE_SEC * 1.3, () => 120);
    const held = settle.bpm;

    let i = 0;
    run(settle, 3, () => {
      i++;
      return i % 20 === 0 ? 60 : 120; // 5% outliers, well outside TEMPO_SETTLE_TOL
    });
    expect(settle.bpm).toBe(held);
  });

  it("a tempo the tracker was sure of ignores a short unsure excursion to another", () => {
    const settle = createTempoSettle();
    run(settle, TEMPO_SETTLE_SEC * 2, () => 124, 1);
    expect(settle.bpm).toBeCloseTo(124, 5);
    // A drums-out breakdown: the raw estimate wanders to a wrong candidate
    // for a couple of seconds while the tracker is unsure.
    run(settle, 2.5, () => 155, 0.05);
    expect(settle.bpm).toBeCloseTo(124, 5);
    run(settle, TEMPO_SETTLE_SEC * 2, () => 124, 1);
    expect(settle.bpm).toBeCloseTo(124, 5);
  });

  it("a tempo the tracker was sure of still moves after RETUNE_UNSURE_SEC of an unsure one", () => {
    const settle = createTempoSettle();
    run(settle, TEMPO_SETTLE_SEC * 2, () => 124, 1);
    run(settle, TEMPO_SETTLE_SEC + RETUNE_UNSURE_SEC + 0.5, () => 100, 0.05);
    expect(settle.bpm).toBeCloseTo(100, 5);
  });

  it("a tempo the tracker was never sure of is replaced as soon as the window agrees on another", () => {
    const settle = createTempoSettle();
    run(settle, TEMPO_SETTLE_SEC * 1.3, () => 120, RETUNE_LOCK / 2);
    expect(settle.bpm).toBeCloseTo(120, 5);
    run(settle, TEMPO_SETTLE_SEC * 1.3, () => 90, RETUNE_LOCK / 2);
    expect(settle.bpm).toBeCloseTo(90, 5);
  });
});
