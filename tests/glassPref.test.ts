import { beforeEach, describe, expect, it, vi } from "vitest";

describe("glassPref", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("defaults to blur on and round-trips", async () => {
    const mod = await import("../src/ui/glassPref.ts");
    expect(mod.getGlassBlur()).toBe(mod.GLASS_BLUR_DEFAULT);
    expect(mod.GLASS_BLUR_DEFAULT).toBe(true);
    mod.setGlassBlur(true);
    expect(mod.getGlassBlur()).toBe(true);
    mod.setGlassBlur(false);
    expect(mod.getGlassBlur()).toBe(false);
  });

  it("applyGlassBlur is a no-op without a document", async () => {
    const mod = await import("../src/ui/glassPref.ts");
    expect(() => mod.applyGlassBlur()).not.toThrow();
  });
});
