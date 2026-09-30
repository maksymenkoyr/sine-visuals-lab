import { describe, it, expect, afterEach, vi } from "vitest";
import {
  getOutputPowerMode,
  getOutputQualityChoice,
  getPreviewQualityChoice,
  getPreviewSize,
  OUTPUT_POWER_MODE_DEFAULT,
  OUTPUT_QUALITY_DEFAULT,
  PREVIEW_QUALITY_DEFAULT,
  PREVIEW_SIZE_DEFAULT,
  PREVIEW_SIZE_FRACTION,
  setOutputPowerMode,
  setOutputQualityChoice,
  setPreviewQualityChoice,
  setPreviewSize,
} from "../src/render/outputPower.ts";

// Same shape as the other store tests: vitest runs under environment "node"
// (no localStorage), so the first group also proves the module tolerates
// that. The second group stubs a localStorage and re-imports the module, the
// only way to exercise the one-time seed from storage.
describe("output/preview settings", () => {
  it("defaults", () => {
    expect(OUTPUT_QUALITY_DEFAULT).toBe("high");
    expect(OUTPUT_POWER_MODE_DEFAULT).toBe("off");
    expect(PREVIEW_QUALITY_DEFAULT).toBe("floor");
    expect(PREVIEW_SIZE_DEFAULT).toBe("half");
    expect(getOutputQualityChoice()).toBe("high");
    expect(getOutputPowerMode()).toBe("off");
    expect(getPreviewQualityChoice()).toBe("floor");
    expect(getPreviewSize()).toBe("half");
  });

  it("round-trips a set", () => {
    for (const c of ["auto", "high", "mid", "low", "floor"] as const) {
      setOutputQualityChoice(c);
      expect(getOutputQualityChoice()).toBe(c);
      setPreviewQualityChoice(c);
      expect(getPreviewQualityChoice()).toBe(c);
    }
    for (const m of ["auto", "on", "off"] as const) {
      setOutputPowerMode(m);
      expect(getOutputPowerMode()).toBe(m);
    }
    for (const s of ["third", "half", "full"] as const) {
      setPreviewSize(s);
      expect(getPreviewSize()).toBe(s);
    }
  });

  it("orders the size fractions small to large", () => {
    expect(PREVIEW_SIZE_FRACTION.third).toBeLessThan(PREVIEW_SIZE_FRACTION.half);
    expect(PREVIEW_SIZE_FRACTION.half).toBeLessThan(PREVIEW_SIZE_FRACTION.full);
    expect(PREVIEW_SIZE_FRACTION.full).toBe(1);
  });
});

describe("seeding from localStorage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("reads stored values", async () => {
    const data: Record<string, string> = {
      "vibe.output.quality": "mid",
      "vibe.output.powerMode": "auto",
      "vibe.preview.quality": "auto",
      "vibe.preview.size": "full",
    };
    vi.stubGlobal("localStorage", { getItem: (k: string) => data[k] ?? null, setItem: () => undefined });
    vi.resetModules();
    const fresh = await import("../src/render/outputPower.ts");
    expect(fresh.getOutputQualityChoice()).toBe("mid");
    expect(fresh.getOutputPowerMode()).toBe("auto");
    expect(fresh.getPreviewQualityChoice()).toBe("auto");
    expect(fresh.getPreviewSize()).toBe("full");
  });

  it("falls back to the defaults on junk", async () => {
    const data: Record<string, string> = {
      "vibe.output.quality": "ultra",
      "vibe.output.powerMode": "maybe",
      "vibe.preview.quality": "",
      "vibe.preview.size": "huge",
    };
    vi.stubGlobal("localStorage", { getItem: (k: string) => data[k] ?? null, setItem: () => undefined });
    vi.resetModules();
    const fresh = await import("../src/render/outputPower.ts");
    expect(fresh.getOutputQualityChoice()).toBe("high");
    expect(fresh.getOutputPowerMode()).toBe("off");
    expect(fresh.getPreviewQualityChoice()).toBe("floor");
    expect(fresh.getPreviewSize()).toBe("half");
  });
});
