import { describe, it, expect } from "vitest";
import { createSectionIntensity } from "../src/render/sectionIntensity.ts";

const DT = 1 / 60;

describe("section intensity", () => {
  // The floor/ceiling trackers deliberately settle slowly (~12-20s time
  // constants — see sectionIntensity.ts) so a single loud phrase doesn't
  // masquerade as a new baseline; give them a full settle window before
  // asserting on the steady-state value.
  const QUIET_SETTLE_TICKS = 1800; // 30s

  it("stays low through a sustained quiet section", () => {
    const s = createSectionIntensity();
    for (let i = 0; i < QUIET_SETTLE_TICKS; i++) s.advance(DT, 0.1);
    expect(s.intensity).toBeLessThan(0.3);
  });

  it("rises toward 1 after a sustained loud section following a quiet one", () => {
    const s = createSectionIntensity();
    for (let i = 0; i < QUIET_SETTLE_TICKS; i++) s.advance(DT, 0.1); // settle a quiet baseline
    for (let i = 0; i < 600; i++) s.advance(DT, 0.9); // then a sustained loud section
    expect(s.intensity).toBeGreaterThan(0.6);
  });

  it("fires a one-shot dropOnset edge and a decaying dropPulse on a fast quiet-to-loud jump", () => {
    const s = createSectionIntensity();
    for (let i = 0; i < QUIET_SETTLE_TICKS; i++) s.advance(DT, 0.1);

    let onsets = 0;
    for (let i = 0; i < 90; i++) {
      s.advance(DT, 0.95);
      if (s.dropOnset) onsets++;
    }
    expect(onsets).toBeGreaterThanOrEqual(1);
    expect(s.dropPulse).toBeGreaterThan(0);

    for (let i = 0; i < 300; i++) s.advance(DT, 0.95); // hold loud — no further onset
    expect(s.dropPulse).toBeLessThan(0.05);
  });

  it("never produces NaN or out-of-range intensity across a long, varied run", () => {
    const s = createSectionIntensity();
    for (let i = 0; i < 3000; i++) {
      const e = 0.5 + 0.5 * Math.sin(i * 0.01);
      s.advance(DT, e);
      expect(Number.isFinite(s.intensity)).toBe(true);
      expect(s.intensity).toBeGreaterThanOrEqual(0);
      expect(s.intensity).toBeLessThanOrEqual(1);
    }
  });
});
