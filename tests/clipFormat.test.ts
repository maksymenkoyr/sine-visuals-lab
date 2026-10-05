import { describe, expect, it } from "vitest";
import {
  RECORD_ASPECTS,
  RECORD_FORMATS,
  RECORD_SIZES,
  clipFileName,
  cropRect,
  extForMime,
  formatElapsed,
  nextRecordAspect,
  parseRecordAspect,
  pickRecordFormat,
} from "../src/ui/clipFormat.ts";

describe("pickRecordFormat", () => {
  it("prefers MP4 when the browser can write it", () => {
    expect(pickRecordFormat(() => true)).toBe(RECORD_FORMATS[0]);
    expect(pickRecordFormat((m) => m.startsWith("video/mp4"))?.ext).toBe("mp4");
  });

  it("falls to WebM VP9, then VP8", () => {
    expect(pickRecordFormat((m) => m.startsWith("video/webm"))?.mimeType).toBe("video/webm;codecs=vp9,opus");
    expect(pickRecordFormat((m) => m.includes("vp8"))?.mimeType).toBe("video/webm;codecs=vp8,opus");
  });

  it("says null when nothing is supported", () => {
    expect(pickRecordFormat(() => false)).toBeNull();
  });
});

describe("extForMime", () => {
  it("reads the container off the mime type", () => {
    expect(extForMime("video/mp4;codecs=avc1.42E01E,mp4a.40.2")).toBe("mp4");
    expect(extForMime("video/webm;codecs=vp9,opus")).toBe("webm");
    expect(extForMime("")).toBe("webm");
  });
});

describe("cropRect", () => {
  it("cuts the sides off a wide canvas for a portrait clip", () => {
    const { w, h } = RECORD_SIZES["9:16"];
    const r = cropRect(1920, 1080, w, h);
    expect(r.sh).toBe(1080);
    expect(r.sw).toBe(Math.round(1080 * (w / h)));
    expect(r.sy).toBe(0);
    expect(r.sx).toBe(Math.floor((1920 - r.sw) / 2));
  });

  it("cuts the top and bottom off a tall canvas for a square clip", () => {
    expect(cropRect(1000, 2000, 1080, 1080)).toEqual({ sx: 0, sy: 500, sw: 1000, sh: 1000 });
  });

  it("keeps a picture that already has the shape", () => {
    expect(cropRect(1080, 1920, 1080, 1920)).toEqual({ sx: 0, sy: 0, sw: 1080, sh: 1920 });
  });

  it("stays inside the source", () => {
    for (const [w, h] of [[1280, 720], [3840, 2160], [701, 333], [333, 701]]) {
      for (const size of Object.values(RECORD_SIZES)) {
        const r = cropRect(w, h, size.w, size.h);
        expect(r.sx).toBeGreaterThanOrEqual(0);
        expect(r.sy).toBeGreaterThanOrEqual(0);
        expect(r.sx + r.sw).toBeLessThanOrEqual(w);
        expect(r.sy + r.sh).toBeLessThanOrEqual(h);
      }
    }
  });
});

describe("clipFileName", () => {
  it("names scene and local time", () => {
    expect(clipFileName("storm", new Date(2026, 9, 5, 7, 4, 9), "mp4")).toBe("sine-visuals-lab-storm-2026-10-05-070409.mp4");
  });

  it("keeps odd characters out of the name", () => {
    expect(clipFileName("a/b c", new Date(2026, 0, 1, 0, 0, 0), "webm")).toBe("sine-visuals-lab-abc-2026-01-01-000000.webm");
    expect(clipFileName("", new Date(2026, 0, 1, 0, 0, 0), "webm")).toContain("-scene-");
  });
});

describe("formatElapsed", () => {
  it("reads m:ss, then h:mm:ss", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(4_999)).toBe("0:04");
    expect(formatElapsed(65_000)).toBe("1:05");
    expect(formatElapsed(3_723_000)).toBe("1:02:03");
    expect(formatElapsed(-5)).toBe("0:00");
  });
});

describe("aspect choice", () => {
  it("cycles through every choice and back", () => {
    let a = RECORD_ASPECTS[0];
    const seen = [a];
    for (let i = 0; i < RECORD_ASPECTS.length; i++) {
      a = nextRecordAspect(a);
      seen.push(a);
    }
    expect(seen.slice(0, RECORD_ASPECTS.length)).toEqual([...RECORD_ASPECTS]);
    expect(seen[seen.length - 1]).toBe(RECORD_ASPECTS[0]);
  });

  it("falls back to Screen on anything unknown", () => {
    expect(parseRecordAspect("9:16")).toBe("9:16");
    expect(parseRecordAspect("4:3")).toBe("screen");
    expect(parseRecordAspect(null)).toBe("screen");
  });
});
