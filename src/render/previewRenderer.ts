import { createGL } from "./gl.ts";
import { createSceneHost, type SceneHost } from "./sceneHost.ts";
import { FULL_VIEWPORT, type Scene } from "./scene.ts";
import type { Palette } from "./palette.ts";
import type { FeatureFrame } from "../audio/types.ts";
import type { TierSettings } from "./tier.ts";
import type { AnimFrame } from "./animClock.ts";

/** Where a rendered preview frame gets copied to. Two implementations
 *  depending on what the browser gives us for the shared offscreen buffer:
 *  a GPU-side handle swap (bitmap) when the shared canvas is an
 *  OffscreenCanvas, or a plain 2D texture blit (2d) otherwise. Either way,
 *  never `readPixels`/`toDataURL` here — those stall the pipeline. */
type TileSink =
  | { kind: "bitmap"; ctx: ImageBitmapRenderingContext }
  | { kind: "2d"; ctx: CanvasRenderingContext2D };

export interface PreviewRenderer {
  readonly host: SceneHost;
  setSize(w: number, h: number): void;
  attach(canvas: HTMLCanvasElement): TileSink | null;
  drawTo(
    sink: TileSink,
    scene: Scene,
    frame: FeatureFrame,
    palette: Palette,
    anim: AnimFrame,
  ): void;
  dispose(): void;
}

/** All tiles share one offscreen GL buffer and get their own copy blitted
 *  out per frame — see fullscreenScene.ts / sceneHost.ts for why scenes
 *  can't each get their own GL context instead. Returns null if WebGL2 is
 *  unavailable at all (callers should fall back to static tiles). */
export function createPreviewRenderer(tier: TierSettings): PreviewRenderer | null {
  let width = 1;
  let height = 1;
  let shared: OffscreenCanvas | HTMLCanvasElement;
  let gl: WebGL2RenderingContext;
  let usesOffscreen: boolean;

  try {
    if (typeof OffscreenCanvas === "undefined") throw new Error("no OffscreenCanvas");
    shared = new OffscreenCanvas(width, height);
    gl = createGL(shared);
    usesOffscreen = true;
  } catch {
    try {
      shared = document.createElement("canvas");
      shared.width = width;
      shared.height = height;
      gl = createGL(shared, { preserveDrawingBuffer: true });
      usesOffscreen = false;
    } catch {
      return null;
    }
  }

  const host = createSceneHost(gl, tier);

  return {
    host,

    setSize(w: number, h: number): void {
      width = Math.max(1, Math.round(w));
      height = Math.max(1, Math.round(h));
      shared.width = width;
      shared.height = height;
    },

    attach(canvas: HTMLCanvasElement): TileSink | null {
      if (usesOffscreen) {
        const ctx = canvas.getContext("bitmaprenderer");
        if (ctx) return { kind: "bitmap", ctx };
      }
      const ctx = canvas.getContext("2d");
      return ctx ? { kind: "2d", ctx } : null;
    },

    drawTo(sink, scene, frame, palette, anim): void {
      host.mount(scene); // no-op after the first call for this scene
      gl.viewport(0, 0, width, height);
      scene.render(host.ctx, frame, FULL_VIEWPORT, palette, anim);

      if (sink.kind === "bitmap") {
        // Detaches the shared buffer each frame — safe only because every
        // tile fully re-renders every drawn frame (scenes paint an opaque
        // fullscreen triangle, so there's nothing to preserve between
        // frames). Don't add a "skip redraw if unchanged" optimization
        // without revisiting this.
        const bitmap = (shared as OffscreenCanvas).transferToImageBitmap();
        sink.ctx.transferFromImageBitmap(bitmap);
      } else {
        // Relies on the tile canvas already being sized to match the shared
        // buffer (see gallery.ts) — a plain 1:1 copy, no scaling.
        sink.ctx.drawImage(shared as HTMLCanvasElement, 0, 0);
      }
    },

    dispose(): void {
      host.unmountAll();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
