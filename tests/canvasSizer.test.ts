import { afterEach, describe, expect, it, vi } from "vitest";
import { createCanvasSizer } from "../src/ui/canvasSizer.ts";

// A canvas stub: a settable layout width (what getBoundingClientRect reports)
// and a recording 2d context.
function stubCanvas(initialWidth: number) {
  const canvas = {
    width: 0,
    height: 0,
    rectWidth: initialWidth,
    getBoundingClientRect() {
      return { width: this.rectWidth };
    },
  };
  const ctx = { setTransform: vi.fn() };
  return { canvas: canvas as unknown as HTMLCanvasElement, ctx: ctx as unknown as CanvasRenderingContext2D, raw: canvas, setTransform: ctx.setTransform };
}

function setDpr(dpr: number) {
  vi.stubGlobal("window", { devicePixelRatio: dpr });
}

afterEach(() => vi.unstubAllGlobals());

describe("createCanvasSizer (rect-reading mode)", () => {
  it("reports no layout while the canvas has no width, and touches nothing", () => {
    setDpr(2);
    const { canvas, ctx, raw, setTransform } = stubCanvas(0);
    const onWidthChange = vi.fn();
    const sizer = createCanvasSizer(canvas, ctx, { heightCssPx: 40, observe: false, onWidthChange });
    expect(sizer.ensure()).toBe(false);
    expect(raw.width).toBe(0);
    expect(setTransform).not.toHaveBeenCalled();
    expect(onWidthChange).not.toHaveBeenCalled();
    expect(sizer.version).toBe(0);
  });

  it("sizes the backing store to width x ratio and rebuilds on a width change", () => {
    setDpr(2);
    const { canvas, ctx, raw, setTransform } = stubCanvas(300);
    const onWidthChange = vi.fn();
    const sizer = createCanvasSizer(canvas, ctx, { heightCssPx: 40, observe: false, onWidthChange });
    expect(sizer.ensure()).toBe(true);
    expect([raw.width, raw.height, sizer.width]).toEqual([600, 80, 300]);
    expect(setTransform).toHaveBeenLastCalledWith(2, 0, 0, 2, 0, 0);
    expect(onWidthChange).toHaveBeenCalledTimes(1);
    expect(onWidthChange).toHaveBeenCalledWith(300);

    // Same width and ratio: nothing to do.
    expect(sizer.ensure()).toBe(true);
    expect(sizer.version).toBe(1);
    expect(onWidthChange).toHaveBeenCalledTimes(1);

    raw.rectWidth = 250;
    sizer.ensure();
    expect([raw.width, sizer.width, sizer.version]).toEqual([500, 250, 2]);
    expect(onWidthChange).toHaveBeenCalledTimes(2);
  });

  it("follows a devicePixelRatio change at the same width without rebuilding history", () => {
    setDpr(1);
    const { canvas, ctx, raw, setTransform } = stubCanvas(300);
    const onWidthChange = vi.fn();
    const sizer = createCanvasSizer(canvas, ctx, { heightCssPx: 40, observe: false, onWidthChange });
    sizer.ensure();
    expect([raw.width, raw.height]).toEqual([300, 40]);

    setDpr(2);
    expect(sizer.ensure()).toBe(true);
    expect([raw.width, raw.height]).toEqual([600, 80]);
    expect(setTransform).toHaveBeenLastCalledWith(2, 0, 0, 2, 0, 0);
    // The pixels were cleared (version moved) but the width never changed,
    // so a history buffer keyed on it is left alone.
    expect(sizer.version).toBe(2);
    expect(onWidthChange).toHaveBeenCalledTimes(1);
  });

  it("keeps its size while the canvas is hidden again", () => {
    setDpr(1);
    const { canvas, ctx, raw } = stubCanvas(300);
    const onWidthChange = vi.fn();
    const sizer = createCanvasSizer(canvas, ctx, { heightCssPx: 40, observe: false, onWidthChange });
    sizer.ensure();
    raw.rectWidth = 0;
    expect(sizer.ensure()).toBe(false);
    raw.rectWidth = 300;
    expect(sizer.ensure()).toBe(true);
    expect(sizer.version).toBe(1);
    expect(onWidthChange).toHaveBeenCalledTimes(1);
  });
});

describe("createCanvasSizer (observed mode)", () => {
  it("takes the width from the observer, not the rect, and ignores a hidden 0", () => {
    setDpr(1);
    let fire: ResizeObserverCallback = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: ResizeObserverCallback) {
          fire = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    const { canvas, ctx, raw } = stubCanvas(999); // the rect must not be read
    const getRect = vi.spyOn(raw, "getBoundingClientRect");
    const sizer = createCanvasSizer(canvas, ctx, { heightCssPx: 40 });

    // Before the observer's first report there is no width yet.
    expect(sizer.ensure()).toBe(false);
    fire([{ contentRect: { width: 320.4 } } as ResizeObserverEntry], {} as ResizeObserver);
    expect(sizer.ensure()).toBe(true);
    expect([raw.width, sizer.width]).toEqual([320, 320]);

    fire([{ contentRect: { width: 0 } } as ResizeObserverEntry], {} as ResizeObserver);
    expect(sizer.ensure()).toBe(false);
    expect(getRect).not.toHaveBeenCalled();
  });
});
