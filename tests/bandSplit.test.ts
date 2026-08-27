import { describe, it, expect, beforeEach } from "vitest";
import {
  getBandSplit,
  setBandSplit,
  resetBandSplit,
  bandSplitVersion,
  LOW_MID_DEFAULT,
  MID_HIGH_DEFAULT,
} from "../src/audio/bandSplit.ts";
import { NUM_BANDS } from "../src/audio/types.ts";

// Unlike sceneSettings/sensitivity, bandSplit has no per-scene keying — it's
// one global value — so every test must reset first to avoid leaking state
// from whichever test ran before it (vitest runs a file's tests in one
// module instance, sharing the module-level cache).
describe("band split persistence", () => {
  beforeEach(() => {
    resetBandSplit();
  });

  // vitest runs under environment: "node" (vitest.config.ts), so there is no
  // localStorage global at all here — this also proves the module tolerates that.
  it("defaults reproduce today's hardcoded bandEnergy.ts split", () => {
    expect(getBandSplit()).toEqual({ lowMid: LOW_MID_DEFAULT, midHigh: MID_HIGH_DEFAULT });
  });

  it("round-trips an in-range change to one edge", () => {
    setBandSplit({ lowMid: 4 });
    expect(getBandSplit()).toEqual({ lowMid: 4, midHigh: MID_HIGH_DEFAULT });
    setBandSplit({ midHigh: 20 });
    expect(getBandSplit()).toEqual({ lowMid: 4, midHigh: 20 });
  });

  it("keeps every group non-empty: 1 <= lowMid < midHigh <= NUM_BANDS - 1", () => {
    setBandSplit({ lowMid: -5 });
    expect(getBandSplit().lowMid).toBe(1);

    setBandSplit({ midHigh: NUM_BANDS + 10 });
    expect(getBandSplit().midHigh).toBe(NUM_BANDS - 1);

    // Pushing lowMid up to (or past) midHigh must not collapse the mid group.
    resetBandSplit();
    setBandSplit({ lowMid: MID_HIGH_DEFAULT + 3 });
    const split = getBandSplit();
    expect(split.lowMid).toBeLessThan(split.midHigh);
  });

  it("falls back to the default for a non-finite value", () => {
    setBandSplit({ lowMid: NaN });
    expect(getBandSplit().lowMid).toBe(LOW_MID_DEFAULT);
  });

  it("bumps the version on every set, and on reset", () => {
    const v0 = bandSplitVersion();
    setBandSplit({ lowMid: 3 });
    const v1 = bandSplitVersion();
    expect(v1).toBeGreaterThan(v0);
    resetBandSplit();
    expect(bandSplitVersion()).toBeGreaterThan(v1);
  });
});
