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

    // Exactly one edge for the whole swell: intensity keeps rising fast for a
    // run of consecutive ticks, and a consumer that bursts per onset (Storm's
    // strike burst) must see one drop, not one per tick of the climb.
    let onsets = 0;
    for (let i = 0; i < 90; i++) {
      s.advance(DT, 0.95);
      if (s.dropOnset) onsets++;
    }
    expect(onsets).toBe(1);
    expect(s.dropPulse).toBeGreaterThan(0);

    for (let i = 0; i < 300; i++) s.advance(DT, 0.95); // hold loud — no further onset
    expect(s.dropPulse).toBeLessThan(0.05);
  });

  it("re-arms after a swell settles, so a later second drop fires its own edge", () => {
    const s = createSectionIntensity();
    for (let i = 0; i < QUIET_SETTLE_TICKS; i++) s.advance(DT, 0.1);

    let onsets = 0;
    const count = (): void => {
      if (s.dropOnset) onsets++;
    };
    for (let i = 0; i < 300; i++) (s.advance(DT, 0.95), count()); // first swell, settles loud
    for (let i = 0; i < 600; i++) (s.advance(DT, 0.1), count()); // back to a quiet passage
    for (let i = 0; i < 300; i++) (s.advance(DT, 0.95), count()); // second swell
    expect(onsets).toBe(2);
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

  // rawIntensity feeds the meters panel's RAW chip (src/ui/audioMeters.ts):
  // it should track a step change immediately, while the slewed `intensity`
  // it's derived from lags behind on the same tick, then the two converge.
  it("rawIntensity leads intensity on a step and converges once it settles", () => {
    const s = createSectionIntensity();
    for (let i = 0; i < QUIET_SETTLE_TICKS; i++) s.advance(DT, 0.1);

    s.advance(DT, 0.95); // a single loud tick right after a quiet baseline
    expect(s.rawIntensity).toBeGreaterThan(s.intensity);

    for (let i = 0; i < 300; i++) s.advance(DT, 0.95); // hold loud until INTENSITY_SLEW settles
    expect(Math.abs(s.rawIntensity - s.intensity)).toBeLessThan(0.05);
  });

  it("keeps rawIntensity finite and in [0,1] across a long, varied run", () => {
    const s = createSectionIntensity();
    for (let i = 0; i < 3000; i++) {
      const e = 0.5 + 0.5 * Math.sin(i * 0.01);
      s.advance(DT, e);
      expect(Number.isFinite(s.rawIntensity)).toBe(true);
      expect(s.rawIntensity).toBeGreaterThanOrEqual(0);
      expect(s.rawIntensity).toBeLessThanOrEqual(1);
    }
  });

  // rateScale=Infinity is what sensitivity.ts's smoothingRateScale returns
  // at the Smoothing row's Off stop (deviceMenu.ts) — INTENSITY_SLEW must
  // assign the target directly rather than compute a Math.min(1,
  // rate*dt*scale) coefficient, so `intensity` lands on exactly the same
  // value rawIntensity already shows (the meters panel's RAW chip). See
  // sectionIntensity.ts's advance() doc.
  it("at rateScale=Infinity, intensity jumps to exactly rawIntensity every tick", () => {
    const s = createSectionIntensity();
    for (let i = 0; i < 1800; i++) s.advance(DT, 0.1, Infinity); // settle a baseline first
    s.advance(DT, 0.95, Infinity); // a hard step
    expect(s.intensity).toBe(s.rawIntensity);
  });

  it("never produces NaN at rateScale=Infinity across a long, varied run", () => {
    const s = createSectionIntensity();
    for (let i = 0; i < 3000; i++) {
      const e = 0.5 + 0.5 * Math.sin(i * 0.01);
      s.advance(DT, e, Infinity);
      expect(Number.isFinite(s.intensity)).toBe(true);
      expect(s.intensity).toBe(s.rawIntensity);
    }
  });
});
