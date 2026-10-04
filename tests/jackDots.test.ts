import { describe, expect, it } from "vitest";
import { useDotLayout } from "../src/ui/jack";

describe("useDotLayout", () => {
  it("keeps full-size dots at a fixed step while they fit one turn", () => {
    const one = useDotLayout(1);
    const turn = useDotLayout(Math.round(360 / one.stepDeg));
    expect(turn).toEqual(one);
  });

  it("past one turn, spreads dots evenly and shrinks them so they never pass the ring", () => {
    const full = useDotLayout(1);
    const perTurn = Math.round(360 / full.stepDeg);
    let prev = full.sizePx;
    for (let n = perTurn + 1; n <= perTurn * 4; n++) {
      const { stepDeg, sizePx } = useDotLayout(n);
      expect(stepDeg * n).toBeCloseTo(360);
      expect(sizePx).toBeLessThanOrEqual(prev);
      prev = sizePx;
    }
    expect(prev).toBeLessThan(full.sizePx);
  });
});
