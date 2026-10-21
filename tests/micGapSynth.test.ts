import { describe, it, expect } from "vitest";
import { renderCalibration, encodeWav } from "../tools/mic-gap-synth.ts";
import { SR } from "./tempoEval/synth.ts";

// The calibration track that tools/mic-gap-synth.ts writes: its truth must put
// every hit in its own section, its WAV must be as long as song.json says, and
// a second render must give the same bytes, since later runs are compared to it.
const first = renderCalibration();

describe("mic-gap calibration track", () => {
  it("places every truth hit inside its own section", () => {
    for (const hit of first.truth.hits) {
      const section = first.truth.sections.find((s) => s.name === hit.section);
      expect(section, hit.section).toBeDefined();
      expect(hit.time).toBeGreaterThanOrEqual(section!.from);
      expect(hit.time).toBeLessThan(section!.to);
    }
  });

  it("writes a WAV as long as the song's duration", () => {
    const wav = encodeWav(first.mono);
    expect(wav.readUInt32LE(24)).toBe(SR);
    expect(wav.readUInt32LE(40) / 2 / SR).toBeCloseTo(first.song.duration, 6);
    expect(wav.length).toBe(44 + first.mono.length * 2);
  });

  it("renders the same bytes on a second run", () => {
    const again = encodeWav(renderCalibration().mono);
    expect(again.equals(encodeWav(first.mono))).toBe(true);
  }, 30_000);
});
