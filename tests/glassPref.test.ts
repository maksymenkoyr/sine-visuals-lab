import { beforeEach, describe, expect, it, vi } from "vitest";

describe("glassPref", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("defaults to the browser's blur and round-trips every mode", async () => {
    const mod = await import("../src/ui/glassPref.ts");
    expect(mod.getGlassMode()).toBe(mod.GLASS_MODE_DEFAULT);
    expect(mod.GLASS_MODE_DEFAULT).toBe("on");
    for (const mode of ["off", "fast", "on"] as const) {
      mod.setGlassMode(mode);
      expect(mod.getGlassMode()).toBe(mode);
    }
  });

  it("reads the values stored before Fast existed", async () => {
    const { parseGlassMode } = await import("../src/ui/glassPref.ts");
    expect(parseGlassMode("1")).toBe("on");
    expect(parseGlassMode("0")).toBe("off");
    expect(parseGlassMode("fast")).toBe("fast");
    expect(parseGlassMode(null)).toBe("on");
    expect(parseGlassMode("garbage")).toBe("on");
  });

  it("writes the CSS filter from the look's numbers", async () => {
    const { glassFilterCss } = await import("../src/ui/glassPref.ts");
    expect(glassFilterCss({ blurCssPx: 12, saturate: 0.5, brightness: 0.25, contrast: 1.5 })).toBe(
      "blur(12px) saturate(0.5) brightness(0.25) contrast(1.5)",
    );
  });

  it("applyGlassBlur and setGlassDrawn are no-ops without a document", async () => {
    const mod = await import("../src/ui/glassPref.ts");
    expect(() => mod.applyGlassBlur()).not.toThrow();
    expect(() => mod.setGlassDrawn(true)).not.toThrow();
  });
});
