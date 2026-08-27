/**
 * Palettes as Inigo Quilez cosine-gradient coefficients:
 * color(t) = a + b*cos(2*pi*(c*t+d))
 * Cheap to evaluate per-pixel in GLSL and gives smooth, non-muddy gradients.
 */
export interface Palette {
  id: string;
  name: string;
  a: [number, number, number];
  b: [number, number, number];
  c: [number, number, number];
  d: [number, number, number];
}

export const PALETTES: Palette[] = [
  {
    id: "neon",
    name: "Neon",
    a: [0.5, 0.5, 0.5],
    b: [0.5, 0.5, 0.5],
    c: [1.0, 1.0, 1.0],
    d: [0.0, 0.33, 0.67],
  },
  {
    id: "sunset",
    name: "Sunset",
    a: [0.6, 0.35, 0.3],
    b: [0.4, 0.35, 0.3],
    c: [1.0, 0.8, 0.6],
    d: [0.0, 0.15, 0.3],
  },
  {
    id: "acid",
    name: "Acid",
    a: [0.4, 0.5, 0.3],
    b: [0.5, 0.5, 0.3],
    c: [1.2, 0.9, 0.6],
    d: [0.1, 0.4, 0.6],
  },
  {
    id: "ice",
    name: "Ice",
    a: [0.35, 0.45, 0.55],
    b: [0.3, 0.35, 0.4],
    c: [0.8, 0.9, 1.0],
    d: [0.5, 0.55, 0.6],
  },
  {
    id: "fire",
    name: "Fire",
    a: [0.6, 0.35, 0.2],
    b: [0.5, 0.35, 0.2],
    c: [1.0, 0.7, 0.4],
    d: [0.0, 0.05, 0.15],
  },
];

export function getPalette(id: string): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}

export function randomPalette(excludeId?: string): Palette {
  const options = excludeId ? PALETTES.filter((p) => p.id !== excludeId) : PALETTES;
  return options[Math.floor(Math.random() * options.length)];
}

export interface PaletteVecs {
  a: Float32Array;
  b: Float32Array;
  c: Float32Array;
  d: Float32Array;
}

// Palettes are static module data that only change on user action, so their
// flattened-and-sliced uniform views are safe to compute once and reuse for
// the life of the page — recomputing them (a Float32Array + 4 spreads + 4
// subarray views) every scene render was pure per-frame allocation, and in
// the gallery that's once per tile per tick.
const vecsCache = new WeakMap<Palette, PaletteVecs>();

/** Cached vec3 views into a flattened [a,b,c,d] buffer, ready for direct
 *  `uniform3fv` upload — see the caching note above. */
export function paletteVecs(p: Palette): PaletteVecs {
  let cached = vecsCache.get(p);
  if (!cached) {
    const buf = new Float32Array([...p.a, ...p.b, ...p.c, ...p.d]);
    cached = {
      a: buf.subarray(0, 3),
      b: buf.subarray(3, 6),
      c: buf.subarray(6, 9),
      d: buf.subarray(9, 12),
    };
    vecsCache.set(p, cached);
  }
  return cached;
}

export const PALETTE_GLSL = `
vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(6.28318 * (c * t + d));
}`;
