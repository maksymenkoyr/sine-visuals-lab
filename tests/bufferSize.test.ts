import { describe, it, expect } from "vitest";
import { displayBufferSize } from "../src/render/gl.ts";
import { CAST_BUFFER_HEIGHT } from "../src/render/outputPower.ts";

describe("displayBufferSize", () => {
  it("is css size * density * scale, density capped at 2", () => {
    expect(displayBufferSize(1280, 720, 2, 1)).toEqual({ width: 2560, height: 1440 });
    expect(displayBufferSize(1280, 720, 3, 1)).toEqual({ width: 2560, height: 1440 });
    expect(displayBufferSize(1280, 720, 2, 0.5)).toEqual({ width: 1280, height: 720 });
    expect(displayBufferSize(1280, 720, 0, 1)).toEqual({ width: 1280, height: 720 });
  });

  it("never reaches zero", () => {
    expect(displayBufferSize(0, 0, 1, 1)).toEqual({ width: 1, height: 1 });
  });

  describe("under Cast", () => {
    const cast = { dpr: 1, maxHeight: CAST_BUFFER_HEIGHT };

    it("ignores the device density", () => {
      expect(displayBufferSize(1280, 720, 2, 1, cast)).toEqual({ width: 1280, height: 720 });
    });

    it("caps a big window to the cast height, keeping its aspect", () => {
      expect(displayBufferSize(3840, 2160, 2, 1, cast)).toEqual({ width: 1280, height: 720 });
      expect(displayBufferSize(2560, 1080, 1, 1, cast)).toEqual({ width: 1707, height: 720 });
    });

    it("leaves a smaller window alone, and still honours the quality scale", () => {
      expect(displayBufferSize(800, 450, 2, 1, cast)).toEqual({ width: 800, height: 450 });
      expect(displayBufferSize(3840, 2160, 2, 0.5, cast)).toEqual({ width: 1280, height: 720 });
      expect(displayBufferSize(1920, 1080, 1, 0.5, cast)).toEqual({ width: 960, height: 540 });
    });
  });
});
