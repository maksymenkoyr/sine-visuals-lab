/**
 * Colour maths in OKLab (Björn Ottosson's perceptual space), for anything
 * that mixes or interpolates colours on the CPU: palette.ts bakes its ramps
 * and fits its cosine fallback here. Mixing sRGB values channel by channel
 * goes muddy and dark in the middle (teal to orange passes through grey);
 * mixing in OKLab keeps lightness and hue moving evenly, which is why
 * palettes are authored as a few stops and filled in here rather than in
 * the shader.
 *
 * Every colour that crosses this module's boundary is display sRGB in
 * [0,1], the same space the shaders write straight to the framebuffer, so a
 * result can be uploaded as a uniform as-is. Conversions back from OKLab
 * clip to the sRGB gamut per channel.
 *
 * Pure, no DOM, no GL.
 */

export type Rgb = readonly [number, number, number];
export type Lab = readonly [number, number, number];

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toGamma = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/** `#rrggbb` -> sRGB in [0,1]. */
export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** sRGB in [0,1] (clamped) -> `#rrggbb`. */
export function rgbToHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(clamp01(c) * 255).toString(16).padStart(2, "0")).join("")}`;
}

export function rgbToOklab(rgb: Rgb): Lab {
  const r = toLinear(rgb[0]);
  const g = toLinear(rgb[1]);
  const b = toLinear(rgb[2]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToRgb(lab: Lab): Rgb {
  const [L, A, B] = lab;
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    clamp01(toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    clamp01(toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    clamp01(toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
  ];
}

/** Perceptual lightness, 0 (black) to 1 (white). */
export function oklabLightness(rgb: Rgb): number {
  return rgbToOklab(rgb)[0];
}

/** Euclidean distance in OKLab: roughly how different two colours look.
 *  About 0.02 is a just-visible difference. */
export function oklabDistance(a: Rgb, b: Rgb): number {
  const p = rgbToOklab(a);
  const q = rgbToOklab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** `a` at t=0 to `b` at t=1, interpolated in OKLab. */
export function mixOklab(a: Rgb, b: Rgb, t: number): Rgb {
  const p = rgbToOklab(a);
  const q = rgbToOklab(b);
  return oklabToRgb([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]);
}

/** Evenly spaced stops, read at t in [0,1] (clamped) with OKLab
 *  interpolation between the two stops either side. */
export function sampleStops(stops: readonly Rgb[], t: number): Rgb {
  if (stops.length === 1) return stops[0];
  const x = clamp01(t) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return mixOklab(stops[i], stops[i + 1], x - i);
}
