// Bundled into the Sky tuning bench page by
// docs/scenes/sky/scripts/build_bench.mjs: the scene's own fluid solver and
// GL helpers, exposed to the page's script as window.SkySim, so the clouds
// on the bench come from the same simulation as the scene's.
import { createFullscreenQuad, createProgram, drawFullscreenQuad } from "../../../../../src/render/gl.ts";
import {
  createFluidSim,
  detectSimFormat,
  MIRROR_OFF,
  simIoGlsl,
  simResolutionFor,
  SPLAT_SLOTS,
} from "../../../../../src/render/scenes/sky/skyFluidSim.ts";

(window as unknown as { SkySim: unknown }).SkySim = {
  createFullscreenQuad,
  createProgram,
  drawFullscreenQuad,
  createFluidSim,
  detectSimFormat,
  MIRROR_OFF,
  simIoGlsl,
  simResolutionFor,
  SPLAT_SLOTS,
};
