import { describe, it, expect } from "vitest";
import {
  frameStats,
  motionBetween,
  displayLevel,
  createPictureMeter,
  createPictureAverager,
  PICTURE_MEASURES,
  PICTURE_GAP_RESET_MS,
  PICTURE_SAMPLE_INTERVAL_MS,
  FLASH_WINDOW_MS,
  type PictureReading,
} from "../src/render/pictureMeter.ts";

/** motionBetween over two RGBA frames, via frameStats's own luma. */
function motionBetweenFrames(a: Uint8Array, b: Uint8Array, w: number, h: number): number {
  const la = new Float32Array(w * h);
  const lb = new Float32Array(w * h);
  frameStats(a, w, h, la);
  frameStats(b, w, h, lb);
  return motionBetween(la, lb, w * h);
}

/** A solid RGBA8 frame. `a` defaults to 0 (no Detail) — alpha is no longer
 *  the unused "opaque" byte it was before pictureReadback.ts's gradient pass
 *  started packing Detail into it (see frameStats's own doc comment); a test
 *  that isn't about Detail can just leave it at the default. */
function solidFrame(w: number, h: number, r: number, g: number, b: number, a: number = 0): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    px[i * 4] = r;
    px[i * 4 + 1] = g;
    px[i * 4 + 2] = b;
    px[i * 4 + 3] = a;
  }
  return px;
}

/** A grey frame (r=g=b=v) — luma is exactly v/255 regardless of the Rec.709
 *  weights, so tests on brightness/motion/flashes can reason in plain
 *  fractions instead of the weighted sum. */
function greyFrame(w: number, h: number, v: number, a: number = 0): Uint8Array {
  return solidFrame(w, h, v, v, v, a);
}

/** Vertical stripes of period 2 — column x is white when x is even. Used to
 *  build "the same pattern, shifted by one pixel" (invert(), below): a period-
 *  2 stripe shifted by one column is its own bitwise inverse. */
function stripeFrame(w: number, h: number, invert: boolean, a: number = 0): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const even = x % 2 === 0;
      const v = even !== invert ? 255 : 0;
      px[i * 4] = v;
      px[i * 4 + 1] = v;
      px[i * 4 + 2] = v;
      px[i * 4 + 3] = a;
    }
  }
  return px;
}

describe("frameStats", () => {
  it("a black frame reads brightness/colour/detail 0", () => {
    const stats = frameStats(solidFrame(4, 4, 0, 0, 0), 4, 4, new Float32Array(16));
    expect(stats.brightness).toBe(0);
    expect(stats.colour).toBe(0);
    expect(stats.detail).toBe(0);
  });

  it("a white frame reads brightness 1, colour 0", () => {
    const stats = frameStats(solidFrame(4, 4, 255, 255, 255), 4, 4, new Float32Array(16));
    expect(stats.brightness).toBeCloseTo(1, 5);
    expect(stats.colour).toBe(0);
  });

  it("pure red reads colour 1, brightness ≈ the red luma weight", () => {
    const stats = frameStats(solidFrame(4, 4, 255, 0, 0), 4, 4, new Float32Array(16));
    expect(stats.colour).toBeCloseTo(1, 5);
    expect(stats.brightness).toBeCloseTo(0.2126, 4);
  });

  it("Detail is read from alpha — already packed in by pictureReadback.ts's gradient pass", () => {
    const w = 4;
    const h = 4;
    const detailOf = (a: number) => frameStats(solidFrame(w, h, 0, 0, 0, a), w, h, new Float32Array(w * h)).detail;
    expect(detailOf(255)).toBeCloseTo(2, 5); // the gradient pass's own max packed value
    expect(detailOf(0)).toBe(0);
    expect(detailOf(64)).toBeCloseTo(0.502, 3);
  });
});

describe("motionBetween", () => {
  it("a pattern shifted by a pixel reads well above the 0.1 floor", () => {
    const w = 8;
    const h = 8;
    const lumaA = new Float32Array(w * h);
    const lumaB = new Float32Array(w * h);
    frameStats(stripeFrame(w, h, false), w, h, lumaA);
    frameStats(stripeFrame(w, h, true), w, h, lumaB);
    expect(motionBetween(lumaA, lumaB, w * h)).toBeGreaterThan(0.1);
  });
});

describe("createPictureMeter", () => {
  const W = 4;
  const H = 4;

  it("the first push has no Motion or Flashes reading", () => {
    const meter = createPictureMeter();
    const r = meter.push(greyFrame(W, H, 100), W, H, 0);
    expect(r.motion).toBeNull();
    expect(r.flashes).toBeNull();
  });

  it("a uniform brightness step reads ~0 Motion and Flashes ≈ the step", () => {
    const meter = createPictureMeter();
    const b0 = 0;
    const b1 = 200 / 255;
    meter.push(greyFrame(W, H, 0), W, H, 0);
    const r = meter.push(greyFrame(W, H, 200), W, H, 50);
    expect(r.motion).toBeCloseTo(0, 5);
    expect(r.flashes).toBeCloseTo(b1 - b0, 5);
  });

  it("a pattern shifted by a pixel reads Motion above the 0.1 floor", () => {
    const meter = createPictureMeter();
    meter.push(stripeFrame(8, 8, false), 8, 8, 0);
    const r = meter.push(stripeFrame(8, 8, true), 8, 8, 16);
    expect(r.motion).not.toBeNull();
    expect(r.motion!).toBeGreaterThan(0.1);
  });

  it("Motion is scaled to one nominal sample step, so the same change read twice as far apart counts half", () => {
    const onTime = createPictureMeter();
    onTime.push(stripeFrame(8, 8, false), 8, 8, 0);
    const a = onTime.push(stripeFrame(8, 8, true), 8, 8, PICTURE_SAMPLE_INTERVAL_MS);
    const late = createPictureMeter();
    late.push(stripeFrame(8, 8, false), 8, 8, 0);
    const b = late.push(stripeFrame(8, 8, true), 8, 8, 2 * PICTURE_SAMPLE_INTERVAL_MS);
    expect(a.motion).toBeCloseTo(motionBetweenFrames(stripeFrame(8, 8, false), stripeFrame(8, 8, true), 8, 8), 5);
    expect(b.motion!).toBeCloseTo(a.motion! / 2, 5);
  });

  it("a gap longer than PICTURE_GAP_RESET_MS drops the previous frame", () => {
    const meter = createPictureMeter();
    meter.push(greyFrame(W, H, 50), W, H, 0);
    meter.push(greyFrame(W, H, 60), W, H, 100); // a normal, non-null follow-up
    const r = meter.push(greyFrame(W, H, 70), W, H, 100 + PICTURE_GAP_RESET_MS + 1);
    expect(r.motion).toBeNull();
  });

  it("a size change drops the previous frame", () => {
    const meter = createPictureMeter();
    meter.push(greyFrame(W, H, 50), W, H, 0);
    const r = meter.push(greyFrame(W * 2, H, 60), W * 2, H, 16);
    expect(r.motion).toBeNull();
  });

  it("a flash older than FLASH_WINDOW_MS drops out of the window", () => {
    const meter = createPictureMeter();
    const b0 = 0;
    const b1 = 230 / 255;
    const b2 = 232 / 255;
    const b3 = 234 / 255;
    meter.push(greyFrame(W, H, 0), W, H, 0);
    const early = meter.push(greyFrame(W, H, 230), W, H, 100); // the big jump
    expect(early.flashes).toBeCloseTo(b1 - b0, 5);
    meter.push(greyFrame(W, H, 232), W, H, 900); // still inside the window
    const late = meter.push(greyFrame(W, H, 234), W, H, FLASH_WINDOW_MS + 150);
    // The old (0 -> 230) jump has aged out of the trailing window — only the
    // recent, much smaller step is left.
    expect(late.flashes).toBeCloseTo(b3 - b2, 5);
    expect(late.flashes!).toBeLessThan(early.flashes!);
  });

  it("latest() and lastAtMs track the most recent push", () => {
    const meter = createPictureMeter();
    expect(meter.latest()).toBeNull();
    expect(meter.lastAtMs).toBe(-Infinity);
    meter.push(greyFrame(W, H, 10), W, H, 42);
    expect(meter.lastAtMs).toBe(42);
    expect(meter.latest()?.brightness).toBeCloseTo(10 / 255, 5);
  });
});

describe("displayLevel", () => {
  const measure = PICTURE_MEASURES.find((m) => m.key === "brightness")!;

  it("clamps to [0, 1] and scales by fullScale", () => {
    expect(displayLevel(measure, measure.fullScale / 2)).toBeCloseTo(0.5, 5);
    expect(displayLevel(measure, measure.fullScale * 4)).toBe(1);
    expect(displayLevel(measure, -1)).toBe(0);
  });

  it("passes null through", () => {
    expect(displayLevel(measure, null)).toBeNull();
  });
});

describe("createPictureAverager", () => {
  it("skips nulls per measure and tracks count across every add()", () => {
    const avg = createPictureAverager();
    const a: PictureReading = { brightness: 0.2, colour: 0.1, motion: null, detail: 0.3, flashes: null };
    const b: PictureReading = { brightness: 0.4, colour: 0.3, motion: 0.05, detail: 0.1, flashes: null };
    avg.add(a);
    avg.add(b);
    expect(avg.count).toBe(2);
    const mean = avg.mean();
    expect(mean.brightness).toBeCloseTo(0.3, 5);
    expect(mean.motion).toBeCloseTo(0.05, 5); // only b had a reading
    expect(mean.flashes).toBeNull(); // neither did
  });

  it("reset() clears both the count and every sum", () => {
    const avg = createPictureAverager();
    avg.add({ brightness: 1, colour: 1, motion: 1, detail: 1, flashes: 1 });
    avg.reset();
    expect(avg.count).toBe(0);
    const mean = avg.mean();
    for (const m of PICTURE_MEASURES) expect(mean[m.key]).toBeNull();
  });
});
