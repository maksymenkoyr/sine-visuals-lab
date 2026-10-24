import { describe, expect, it } from "vitest";
import {
  BUSY_CPU,
  BUSY_FPS_FRACTION,
  BUSY_GPU_FRACTION,
  OVER_CPU,
  OVER_FPS_FRACTION,
  OVER_GPU_FRACTION,
  loadLevel,
} from "../src/ui/loadChip.ts";

const CAP_MS = 1000 / 60;
const CAP_FPS = 1000 / CAP_MS;

describe("loadLevel", () => {
  it("is null while nothing has been measured", () => {
    expect(loadLevel({ fps: 0, cpuLoad: 0.9, gpuMs: 50 }, CAP_MS)).toBeNull();
  });

  it("is ok at the cap with light CPU and GPU", () => {
    expect(loadLevel({ fps: CAP_FPS, cpuLoad: 0.1, gpuMs: 1 }, CAP_MS)).toBe("ok");
  });

  it("reads busy and over on frame rate alone", () => {
    const none = { cpuLoad: null, gpuMs: null };
    expect(loadLevel({ fps: CAP_FPS * ((BUSY_FPS_FRACTION + OVER_FPS_FRACTION) / 2), ...none }, CAP_MS)).toBe("busy");
    expect(loadLevel({ fps: CAP_FPS * (OVER_FPS_FRACTION / 2), ...none }, CAP_MS)).toBe("over");
  });

  it("reads busy and over on main-thread load alone", () => {
    const fps = { fps: CAP_FPS, gpuMs: null };
    expect(loadLevel({ ...fps, cpuLoad: (BUSY_CPU + OVER_CPU) / 2 }, CAP_MS)).toBe("busy");
    expect(loadLevel({ ...fps, cpuLoad: (OVER_CPU + 1) / 2 }, CAP_MS)).toBe("over");
  });

  it("reads busy and over on GPU time alone", () => {
    const fps = { fps: CAP_FPS, cpuLoad: null };
    expect(loadLevel({ ...fps, gpuMs: CAP_MS * ((BUSY_GPU_FRACTION + OVER_GPU_FRACTION) / 2) }, CAP_MS)).toBe("busy");
    expect(loadLevel({ ...fps, gpuMs: CAP_MS * ((OVER_GPU_FRACTION + 1) / 2) }, CAP_MS)).toBe("over");
  });

  it("ignores unknown CPU and GPU readings", () => {
    expect(loadLevel({ fps: CAP_FPS, cpuLoad: null, gpuMs: null }, CAP_MS)).toBe("ok");
  });

  it("reads a steady 30 fps as ok against a 30 fps cap", () => {
    expect(loadLevel({ fps: 30, cpuLoad: 0.2, gpuMs: 5 }, 1000 / 30)).toBe("ok");
  });
});
