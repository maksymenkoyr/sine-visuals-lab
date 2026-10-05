import { describe, expect, it } from "vitest";
import { LOOK_LIMITS } from "../server/lookDoc.ts";
import {
  LOGO_LOCAL_MAX_CHARS,
  LOGO_LOCAL_SIDES,
  LOGO_ROOM_MAX_CHARS,
  LOGO_ROOM_SIDES,
  OVERLAY_DEFAULTS,
  OVERLAY_OPACITY_MIN,
  OVERLAY_POSITIONS,
  OVERLAY_SIZE_MAX,
  OVERLAY_SIZE_MIN,
  OVERLAY_TEXT_MAX_CHARS,
  cleanOverlayLogo,
  cleanOverlayText,
  layoutOverlay,
  logoSizeCandidates,
  overlayVisible,
  parseOverlaySettings,
  type OverlayLayoutInput,
  type OverlayPosition,
} from "../src/render/overlayLayout.ts";

const PNG = "data:image/png;base64,";

function input(over: Partial<OverlayLayoutInput> = {}): OverlayLayoutInput {
  return { canvasW: 1920, canvasH: 1080, position: "bottomRight", size: 1, textAdvance: 6, logoAspect: 0, ...over };
}

describe("overlayVisible", () => {
  it("is false with no text and no logo, true with either", () => {
    expect(overlayVisible(OVERLAY_DEFAULTS)).toBe(false);
    expect(overlayVisible({ ...OVERLAY_DEFAULTS, text: "DJ" })).toBe(true);
    expect(overlayVisible({ ...OVERLAY_DEFAULTS, logo: `${PNG}AAAA` })).toBe(true);
  });
});

describe("parseOverlaySettings", () => {
  it("reads the defaults from nothing, bad JSON and a non-object", () => {
    const d = { text: "", position: OVERLAY_DEFAULTS.position, size: OVERLAY_DEFAULTS.size, opacity: OVERLAY_DEFAULTS.opacity };
    expect(parseOverlaySettings(null)).toEqual(d);
    expect(parseOverlaySettings("{nope")).toEqual(d);
    expect(parseOverlaySettings("7")).toEqual(d);
  });

  it("keeps good fields and clamps or drops bad ones one by one", () => {
    const s = parseOverlaySettings(JSON.stringify({ text: "  Club Night ", position: "topRight", size: 99, opacity: -3 }));
    expect(s).toEqual({ text: "Club Night", position: "topRight", size: OVERLAY_SIZE_MAX, opacity: OVERLAY_OPACITY_MIN });
    const t = parseOverlaySettings(JSON.stringify({ text: 5, position: "middle", size: "big", opacity: null }));
    expect(t.text).toBe("");
    expect(t.position).toBe(OVERLAY_DEFAULTS.position);
    expect(t.size).toBe(OVERLAY_DEFAULTS.size);
    expect(t.opacity).toBe(OVERLAY_DEFAULTS.opacity);
    expect(parseOverlaySettings(JSON.stringify({ size: 0 })).size).toBe(OVERLAY_SIZE_MIN);
  });
});

describe("cleanOverlayText", () => {
  it("makes one trimmed line and caps its length", () => {
    expect(cleanOverlayText("a\nb\tc")).toBe("a b c");
    expect(cleanOverlayText("x".repeat(OVERLAY_TEXT_MAX_CHARS + 20))).toHaveLength(OVERLAY_TEXT_MAX_CHARS);
    expect(cleanOverlayText(undefined)).toBe("");
  });
});

describe("cleanOverlayLogo", () => {
  it("accepts only a PNG data URL within the limit", () => {
    const ok = `${PNG}iVBORw0KGgo=`;
    expect(cleanOverlayLogo(ok, 1000)).toBe(ok);
    expect(cleanOverlayLogo(ok, ok.length - 1)).toBe("");
    expect(cleanOverlayLogo("https://example.com/logo.png", 1000)).toBe("");
    expect(cleanOverlayLogo("data:image/svg+xml;base64,AAAA", 1000)).toBe("");
    expect(cleanOverlayLogo(`${PNG}<script>`, 1000)).toBe("");
    expect(cleanOverlayLogo(`${PNG}`, 1000)).toBe("");
    expect(cleanOverlayLogo(12, 1000)).toBe("");
  });
});

describe("logo limits", () => {
  it("keeps a room-sized logo well inside the look document and one stored value", () => {
    expect(LOGO_ROOM_MAX_CHARS).toBeLessThan(LOOK_LIMITS.maxDocBytes / 2);
    expect(LOGO_ROOM_MAX_CHARS).toBeLessThanOrEqual(LOOK_LIMITS.maxValueBytes);
    expect(LOGO_LOCAL_MAX_CHARS).toBeGreaterThan(LOGO_ROOM_MAX_CHARS);
  });

  it("lists sizes largest first, never upscales and never repeats a size", () => {
    const c = logoSizeCandidates(1000, 500, LOGO_ROOM_SIDES);
    expect(c[0].w).toBe(LOGO_ROOM_SIDES[0]);
    expect(c[0].h).toBe(LOGO_ROOM_SIDES[0] / 2);
    for (let i = 1; i < c.length; i++) expect(c[i].w).toBeLessThan(c[i - 1].w);

    const small = logoSizeCandidates(100, 60, LOGO_LOCAL_SIDES);
    expect(small).toEqual([{ w: 100, h: 60 }]);
    expect(logoSizeCandidates(0, 0, LOGO_ROOM_SIDES).length).toBeGreaterThan(0);
  });
});

describe("layoutOverlay", () => {
  it("draws nothing for nothing, or for an empty canvas", () => {
    expect(layoutOverlay(input({ textAdvance: 0, logoAspect: 0 }))).toBeNull();
    expect(layoutOverlay(input({ canvasH: 0 }))).toBeNull();
  });

  it("keeps the block inside the canvas in every position, text and logo alike", () => {
    for (const p of OVERLAY_POSITIONS) {
      for (const size of [OVERLAY_SIZE_MIN, 1, OVERLAY_SIZE_MAX]) {
        const l = layoutOverlay(input({ position: p.id, size, logoAspect: 2.5 }))!;
        expect(l.box.x).toBeGreaterThanOrEqual(0);
        expect(l.box.y).toBeGreaterThanOrEqual(0);
        expect(l.box.x + l.box.w).toBeLessThanOrEqual(1920);
        expect(l.box.y + l.box.h).toBeLessThanOrEqual(1080);
      }
    }
  });

  it("puts each position in its own part of the canvas", () => {
    const at = (position: OverlayPosition) => layoutOverlay(input({ position }))!.box;
    expect(at("topLeft").x).toBeLessThan(960);
    expect(at("topLeft").y).toBeLessThan(540);
    expect(at("topRight").x).toBeGreaterThan(960);
    expect(at("topRight").y).toBeLessThan(540);
    expect(at("bottomLeft").x).toBeLessThan(960);
    expect(at("bottomLeft").y).toBeGreaterThan(540);
    expect(at("bottomRight").x).toBeGreaterThan(960);
    expect(at("bottomRight").y).toBeGreaterThan(540);
    const c = at("centre");
    expect(c.x + c.w / 2).toBeCloseTo(960, 0);
    expect(c.y + c.h / 2).toBeCloseTo(540, 0);
  });

  it("scales with the canvas height: the same look on a 4K TV and a laptop", () => {
    const small = layoutOverlay(input({ canvasW: 1280, canvasH: 720 }))!;
    const big = layoutOverlay(input({ canvasW: 3840, canvasH: 2160 }))!;
    expect(big.fontPx / small.fontPx).toBeCloseTo(3, 1);
  });

  it("grows with Size", () => {
    const a = layoutOverlay(input({ size: 1 }))!;
    const b = layoutOverlay(input({ size: 2 }))!;
    expect(b.fontPx).toBeGreaterThan(a.fontPx);
  });

  it("shrinks a line that is too long instead of running off the edge", () => {
    const l = layoutOverlay(input({ textAdvance: 80, size: OVERLAY_SIZE_MAX }))!;
    expect(l.fontPx * 80).toBeLessThanOrEqual(1920);
    expect(l.box.x).toBeGreaterThanOrEqual(0);
  });

  it("orders a logo and text by side, and stacks them at the centre", () => {
    const left = layoutOverlay(input({ position: "bottomLeft", logoAspect: 1 }))!;
    expect(left.logo!.x).toBeLessThan(left.textX);
    const right = layoutOverlay(input({ position: "bottomRight", logoAspect: 1 }))!;
    expect(right.logo!.x).toBeGreaterThan(right.textX);
    const centre = layoutOverlay(input({ position: "centre", logoAspect: 1 }))!;
    expect(centre.logo!.y + centre.logo!.h).toBeLessThanOrEqual(centre.textMidY);
  });

  it("caps a very wide logo", () => {
    const l = layoutOverlay(input({ textAdvance: 0, logoAspect: 40, size: OVERLAY_SIZE_MAX }))!;
    expect(l.logo!.w).toBeLessThanOrEqual(1920 * 0.4 + 1e-6);
    expect(l.logo!.w / l.logo!.h).toBeCloseTo(40, 3);
  });

  it("gives a logo-only block no text position to draw at the logo's expense", () => {
    const l = layoutOverlay(input({ textAdvance: 0, logoAspect: 1 }))!;
    expect(l.logo).not.toBeNull();
  });
});
