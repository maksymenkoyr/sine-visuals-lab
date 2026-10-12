// How long each baked plate takes in yardstick units, the measure behind
// `BAKE_UNITS_MAX` in tests/chladniPlates.test.ts (the 2026-10-12 bake-test
// line in the record's Measurements). Prints four rounds of every baked
// plate: bake ms / yardstick ms = units. The first round reads higher while
// V8 warms up. The yardstick is a copy of that test's `yardstickMs()`; keep
// the two the same, or the units here won't match the limit there.
// Lives here, not in tests/, so CI doesn't run it; to run, copy it into
// tests/ and:
//   node node_modules/vitest/vitest.mjs run tests/bake-units-measure.test.ts
// To see it under load, start a few busy node loops first.
import { it } from "vitest";
import { CLAMPED, DECAGON, HEXAGON, PLATE_SHAPES, ROUND, TRIANGLE, bakePlate } from "../src/render/scenes/chladniPlates.ts";

function yardstickMs(): number {
  const out = new Float32Array(1 << 20);
  const t0 = performance.now();
  for (let i = 0; i < out.length; i++) {
    const x = i * 1e-4;
    out[i] = Math.sin(x) * Math.exp(-x * 1e-3) + Math.cos(3 * x);
  }
  return performance.now() - t0;
}

it("bake units per plate", () => {
  for (let round = 0; round < 4; round++) {
    const line: string[] = [];
    for (const shape of [ROUND, HEXAGON, TRIANGLE, DECAGON, CLAMPED]) {
      const unit = yardstickMs();
      const t0 = performance.now();
      bakePlate(shape);
      const ms = performance.now() - t0;
      line.push(`${PLATE_SHAPES[shape]} ${ms.toFixed(0)}ms/${unit.toFixed(1)}=${(ms / unit).toFixed(1)}`);
    }
    console.log(line.join("  "));
  }
});
