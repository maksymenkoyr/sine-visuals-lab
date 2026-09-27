import { describe, it, expect } from "vitest";
import { createTempoSettle, TEMPO_SETTLE_SEC, TEMPO_HOLD_BPM, type TempoSettle } from "../src/render/tempoSettle.ts";

const DT = 1 / 60;

/** Steps `settle` for `sec` seconds at DT, pushing `bpmAt(t)` each tick (`t`
 *  the elapsed time before this tick's own push, matching a real caller). */
function run(settle: TempoSettle, sec: number, bpmAt: (t: number) => number): void {
  let t = 0;
  const steps = Math.round(sec / DT);
  for (let i = 0; i < steps; i++) {
    settle.push(bpmAt(t), DT);
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
});
