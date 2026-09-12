import { describe, it, expect } from "vitest";
import { analysisContextOptions } from "../src/audio/capture.ts";

// capture.ts's getUserMedia/AudioContext callers need a browser; only the
// pure choice of context options is tested here. The point of the choice:
// run the analysis context at the captured track's own rate, so no
// resampling FIFO sits between the mic and the analyser (see the
// analysisContextOptions doc comment for why that FIFO is pure delay).
describe("analysisContextOptions", () => {
  it("always asks for the lowest-latency context", () => {
    expect(analysisContextOptions(undefined).latencyHint).toBe("interactive");
    expect(analysisContextOptions(48000).latencyHint).toBe("interactive");
  });

  it("pins the context to the track's reported rate", () => {
    expect(analysisContextOptions(48000).sampleRate).toBe(48000);
    expect(analysisContextOptions(16000).sampleRate).toBe(16000);
  });

  it("leaves the rate to the browser when the track reports none", () => {
    expect(analysisContextOptions(undefined)).not.toHaveProperty("sampleRate");
    expect(analysisContextOptions(0)).not.toHaveProperty("sampleRate");
    expect(analysisContextOptions(Number.NaN)).not.toHaveProperty("sampleRate");
  });
});
