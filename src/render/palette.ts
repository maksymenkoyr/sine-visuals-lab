import { hexToRgb, mixOklab, oklabToRgb, rgbToHex, rgbToOklab, sampleStops, type Rgb } from "./oklab.ts";

/**
 * The room palette: one choice, shared by every scene that takes its colour
 * from the room rather than drawing its own.
 *
 * **Roles.** A palette is a set of colours with jobs (`PaletteRoles`), not
 * one curve, so a scene asks for the job it needs and every palette is
 * authored to fill it:
 *
 *   - `ground` — what "black" is: backgrounds, vignettes, the dark between
 *     things.
 *   - `ramp` — scalar to colour, darkest stop first. Its lightness only ever
 *     rises, so `palRamp(0.1)` is the deep end and `palRamp(0.9)` the bright
 *     end in every palette; a scene says how bright something should be and
 *     gets this palette's colour at that brightness.
 *   - `inks` — distinct colours at similar, readable lightness, for things
 *     that need separate identities (printed layers, bands, strains). Taken
 *     by index, never sampled.
 *   - `accent` — the hit colour.
 *
 * tests/palette.test.ts holds every palette to those promises (rising ramp,
 * readable inks that stay apart, a bright accent), so a scene can rely on
 * them instead of tuning around one palette. Ramps are authored as a few
 * stops and baked to `PALETTE_RAMP_STOPS` evenly spaced colours in OKLab
 * (oklab.ts) — mixing there keeps a teal-to-orange step from going grey —
 * and the shader interpolates between the baked stops. GLSL access is
 * `PALETTE_ROLES_GLSL` below, spliced into every shader through
 * sceneCommon.ts's COMMON_UNIFORMS_GLSL and uploaded by its
 * `uploadCommonUniforms`.
 *
 * **The cosine curve.** Before roles, a palette was only Inigo Quilez's
 * cosine gradient, color(t) = a + b*cos(2*pi*(c*t+d)), which scenes sample
 * with `palette(t, uPalA, uPalB, uPalC, uPalD)` at whatever `t` they like.
 * Scenes that haven't moved to roles still do, and so do the paid scenes,
 * so every palette still carries `a, b, c, d`. The palettes that were the
 * cosine originals (the "Classic" group) keep their exact coefficients, so
 * a scene on `palette()` looks the same under them as it always has. The
 * newer palettes are authored as roles only; their curve is fitted to a
 * loop through their inks in hue order (`fitInkCycle`), which keeps the
 * palette's character for a `palette()` caller without promising more.
 *
 * Scenes with their own designed colours (Physarum 2's strains, Shards,
 * Gates, Sky…) don't read the room palette for those, and roles don't
 * change that.
 */

export type PaletteGroup = "Classic" | "Night" | "Heat" | "Neon" | "Film" | "Mineral" | "Mono";

/** Display order of the groups in the panel's palette card. */
export const PALETTE_GROUPS: readonly PaletteGroup[] = ["Classic", "Night", "Heat", "Neon", "Film", "Mineral", "Mono"];

/** `#rrggbb` colours, by job — see the header. */
export interface PaletteRoles {
  ground: string;
  /** Darkest first; lightness strictly rising. */
  ramp: readonly string[];
  inks: readonly [string, string, string, string];
  accent: string;
}

type Vec3 = [number, number, number];

export interface Palette {
  id: string;
  name: string;
  group: PaletteGroup;
  roles: PaletteRoles;
  /** Cosine-curve coefficients for `palette(t, …)` — see the header. */
  a: Vec3;
  b: Vec3;
  c: Vec3;
  d: Vec3;
}

/** How many evenly spaced colours a ramp is baked to for the shader. */
export const PALETTE_RAMP_STOPS = 9;
export const PALETTE_INK_COUNT = 4;

/**
 * A cosine curve (c = 1 on every channel) that loops once through the inks,
 * ordered around the OKLab hue circle so neighbours blend into each other
 * rather than alternating. Each channel is the first Fourier harmonic of
 * that loop — mean plus one cosine — with its swing capped so the curve
 * overshoots [0,1] by little more than the Classic palettes already do.
 */
export function fitInkCycle(inks: readonly string[]): Pick<Palette, "a" | "b" | "c" | "d"> {
  const labs = inks.map((h) => rgbToOklab(hexToRgb(h)));
  labs.sort((p, q) => Math.atan2(p[2], p[1]) - Math.atan2(q[2], q[1]));
  const samples = 64;
  const loop: Rgb[] = [];
  for (let k = 0; k < samples; k++) {
    const x = (k / samples) * labs.length;
    const i = Math.floor(x);
    const f = x - i;
    const p = labs[i];
    const q = labs[(i + 1) % labs.length];
    loop.push(oklabToRgb([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f]));
  }
  const a: Vec3 = [0, 0, 0];
  const b: Vec3 = [0, 0, 0];
  const d: Vec3 = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    let mean = 0;
    let cosSum = 0;
    let sinSum = 0;
    for (let k = 0; k < samples; k++) {
      const angle = (2 * Math.PI * k) / samples;
      const v = loop[k][ch];
      mean += v;
      cosSum += v * Math.cos(angle);
      sinSum += v * Math.sin(angle);
    }
    mean /= samples;
    const p = (2 * cosSum) / samples;
    const q = (2 * sinSum) / samples;
    a[ch] = mean;
    b[ch] = Math.min(Math.hypot(p, q), mean + 0.08, 1.08 - mean);
    // b*cos(2πt + 2πd) = p*cos(2πt) + q*sin(2πt)  =>  d = atan2(-q, p) / 2π
    d[ch] = Math.atan2(-q, p) / (2 * Math.PI);
  }
  return { a, b, c: [1, 1, 1], d };
}

function rolePalette(id: string, name: string, group: PaletteGroup, roles: PaletteRoles): Palette {
  return { id, name, group, roles, ...fitInkCycle(roles.inks) };
}

export const PALETTES: Palette[] = [
  {
    id: "neon",
    name: "Neon",
    group: "Classic",
    a: [0.5, 0.5, 0.5],
    b: [0.5, 0.5, 0.5],
    c: [1.0, 1.0, 1.0],
    d: [0.0, 0.33, 0.67],
    roles: {
      ground: "#07040f",
      ramp: ["#160a3a", "#5828fd", "#ca01b6", "#f92368", "#ffb3d0", "#fff0f6"],
      inks: ["#f92368", "#1870f3", "#18f370", "#cab601"],
      accent: "#00f0ff",
    },
  },
  {
    id: "sunset",
    name: "Sunset",
    group: "Classic",
    a: [0.6, 0.35, 0.3],
    b: [0.4, 0.35, 0.3],
    c: [1.0, 0.8, 0.6],
    d: [0.0, 0.15, 0.3],
    roles: {
      ground: "#0c0406",
      ramp: ["#1f070d", "#6a1a12", "#d54e12", "#ff8e35", "#ffdcc0"],
      inks: ["#ff8e35", "#d4507a", "#8e5ac8", "#ffd27a"],
      accent: "#ffb35c",
    },
  },
  {
    id: "acid",
    name: "Acid",
    group: "Classic",
    a: [0.4, 0.5, 0.3],
    b: [0.5, 0.5, 0.3],
    c: [1.2, 0.9, 0.6],
    d: [0.1, 0.4, 0.6],
    roles: {
      ground: "#06030a",
      ramp: ["#10081c", "#4e0330", "#006469", "#3fca8a", "#ddfd98"],
      inks: ["#e0302a", "#15ab81", "#c3fe99", "#c3c087"],
      accent: "#b6ff3a",
    },
  },
  {
    id: "ice",
    name: "Ice",
    group: "Classic",
    a: [0.35, 0.45, 0.55],
    b: [0.3, 0.35, 0.4],
    c: [0.8, 0.9, 1.0],
    d: [0.5, 0.55, 0.6],
    roles: {
      ground: "#03070f",
      ramp: ["#0d1e3a", "#214f8c", "#5499df", "#97ccdf", "#eef8ff"],
      inks: ["#5499df", "#a0c8c8", "#a0996d", "#e0f2ff"],
      accent: "#bfefff",
    },
  },
  {
    id: "fire",
    name: "Fire",
    group: "Classic",
    a: [0.6, 0.35, 0.2],
    b: [0.5, 0.35, 0.2],
    c: [1.0, 0.7, 0.4],
    d: [0.0, 0.05, 0.15],
    roles: {
      ground: "#080202",
      ramp: ["#200710", "#720305", "#e42300", "#ff9a46", "#fff1c8"],
      inks: ["#ff3300", "#ff9a46", "#ffd36b", "#c07a39"],
      accent: "#ffc04d",
    },
  },
  // Sodium-vapour streetlight over a night river.
  rolePalette("sodium", "Sodium", "Night", {
    ground: "#06080d",
    ramp: ["#0a0f1d", "#123a52", "#1f7a7a", "#e0892f", "#ffe0ae"],
    inks: ["#2a9d9a", "#e58a2b", "#5a82c8", "#f4d7a1"],
    accent: "#ffb347",
  }),
  // Bioluminescence: deep water, cyan and violet light.
  rolePalette("abyss", "Abyss", "Night", {
    ground: "#01050a",
    ramp: ["#02101c", "#063a4f", "#0d8a8a", "#3fe0c5", "#e2fff7"],
    inks: ["#3fe0c5", "#3a86ff", "#9d7bff", "#c8fff2"],
    accent: "#7cffd9",
  }),
  rolePalette("ember", "Ember", "Heat", {
    ground: "#070302",
    ramp: ["#1a0603", "#6e1408", "#d1410f", "#ff9a3c", "#fff1d6"],
    inks: ["#e0501a", "#ffa94a", "#d0457a", "#ffe6c0"],
    accent: "#ffc46b",
  }),
  rolePalette("arcade", "Arcade", "Neon", {
    ground: "#07020d",
    ramp: ["#12051f", "#4b0f6b", "#c4259a", "#ff7ad1", "#d9fbff"],
    inks: ["#ff2bd6", "#2bf3ff", "#ffe94d", "#8c5bff"],
    accent: "#2bf3ff",
  }),
  // Tungsten film: teal shadows, red-orange halation round the highlights.
  rolePalette("halation", "Halation", "Film", {
    ground: "#04070a",
    ramp: ["#061418", "#0f3d45", "#3b7f86", "#f0a35e", "#ffe7cf"],
    inks: ["#3fa3b0", "#f0a35e", "#ff5a3c", "#d9e4e8"],
    accent: "#ff5a3c",
  }),
  rolePalette("malachite", "Malachite", "Mineral", {
    ground: "#020806",
    ramp: ["#03140e", "#0b3d2c", "#1e7a55", "#5cc795", "#e8f7e6"],
    inks: ["#2a9a6a", "#8fe0b0", "#d9b13a", "#3a92b0"],
    accent: "#f0d36b",
  }),
  rolePalette("amethyst", "Amethyst", "Mineral", {
    ground: "#06030a",
    ramp: ["#120822", "#3a1660", "#7a3fb0", "#c79bf0", "#fbefff"],
    inks: ["#9a5cd6", "#d6b0f5", "#e0a24a", "#5a7ae0"],
    accent: "#ffcf7a",
  }),
  // P1 green CRT phosphor.
  rolePalette("phosphor", "Phosphor", "Mono", {
    ground: "#010402",
    ramp: ["#010a03", "#063d14", "#14a03a", "#5cff8a", "#e6ffe9"],
    inks: ["#1fa646", "#5cff8a", "#c8ffd6", "#3ad6b0"],
    accent: "#5cff8a",
  }),
  // P3 amber CRT phosphor.
  rolePalette("amber", "Amber", "Mono", {
    ground: "#050200",
    ramp: ["#0d0500", "#4a1f00", "#b35c00", "#ffb000", "#fff0c8"],
    inks: ["#d07000", "#ffb000", "#ffe1a0", "#ff8a3a"],
    accent: "#ffc23d",
  }),
];

export function getPalette(id: string): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}

export function randomPalette(excludeId?: string): Palette {
  const options = excludeId ? PALETTES.filter((p) => p.id !== excludeId) : PALETTES;
  return options[Math.floor(Math.random() * options.length)];
}

/** The ramp baked to `n` evenly spaced `#rrggbb` stops, for drawing a
 *  swatch of it outside GL. */
export function paletteRampHex(p: Palette, n: number): string[] {
  const stops = p.roles.ramp.map(hexToRgb);
  return Array.from({ length: n }, (_, i) => rgbToHex(sampleStops(stops, n === 1 ? 0 : i / (n - 1))));
}

/** `from` walked toward `to` by `t` (0..1), for a held Play's palette fade
 *  (net/outputGlide.ts's createPaletteFade). Roles mix in OKLab, the ramps
 *  baked to PALETTE_RAMP_STOPS first so ramps of different lengths line up
 *  stop for stop. The cosine curve dissolves rather than sweeping: each
 *  channel is a + b·cos(2π(c·x + d)), and two cosines of one frequency `c`
 *  add up to one cosine, so `b` and `d` come from adding the two as phasors
 *  (length b, angle 2πd). With equal `c` that is exactly the two curves'
 *  blend, as a crossfade would show it; lerping `d` instead would walk the
 *  hue through colours neither palette has. A `c` that differs moves
 *  linearly. The mix carries `to`'s id, name and group. */
export function mixPalettes(from: Palette, to: Palette, t: number): Palette {
  const mix = (a: string, b: string): string => rgbToHex(mixOklab(hexToRgb(a), hexToRgb(b), t));
  const mixVec = (a: Vec3, b: Vec3): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const rampFrom = paletteRampHex(from, PALETTE_RAMP_STOPS);
  const rampTo = paletteRampHex(to, PALETTE_RAMP_STOPS);
  const b: Vec3 = [0, 0, 0];
  const d: Vec3 = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    const p = 2 * Math.PI * from.d[ch];
    const q = 2 * Math.PI * to.d[ch];
    const x = (1 - t) * from.b[ch] * Math.cos(p) + t * to.b[ch] * Math.cos(q);
    const y = (1 - t) * from.b[ch] * Math.sin(p) + t * to.b[ch] * Math.sin(q);
    b[ch] = Math.hypot(x, y);
    d[ch] = Math.atan2(y, x) / (2 * Math.PI);
  }
  return {
    id: to.id,
    name: to.name,
    group: to.group,
    roles: {
      ground: mix(from.roles.ground, to.roles.ground),
      ramp: rampFrom.map((h, i) => mix(h, rampTo[i])),
      inks: from.roles.inks.map((h, i) => mix(h, to.roles.inks[i])) as unknown as PaletteRoles["inks"],
      accent: mix(from.roles.accent, to.roles.accent),
    },
    a: mixVec(from.a, to.a),
    b,
    c: mixVec(from.c, to.c),
    d,
  };
}

export interface PaletteVecs {
  a: Float32Array;
  b: Float32Array;
  c: Float32Array;
  d: Float32Array;
  ground: Float32Array;
  accent: Float32Array;
  /** PALETTE_INK_COUNT vec3s, for `uniform3fv` on an array uniform. */
  inks: Float32Array;
  /** PALETTE_RAMP_STOPS vec3s, baked in OKLab. */
  ramp: Float32Array;
}

// Palettes are static module data that only change on user action, so their
// flattened-and-sliced uniform views are safe to compute once and reuse for
// the life of the page — recomputing them (the OKLab ramp bake included)
// every scene render would be pure per-frame work, and in the gallery
// that's once per tile per tick.
const vecsCache = new WeakMap<Palette, PaletteVecs>();

/** Cached views ready for direct `uniform3fv` upload — see the caching
 *  note above. */
export function paletteVecs(p: Palette): PaletteVecs {
  let cached = vecsCache.get(p);
  if (!cached) {
    const stops = p.roles.ramp.map(hexToRgb);
    const ramp: number[] = [];
    for (let i = 0; i < PALETTE_RAMP_STOPS; i++) ramp.push(...sampleStops(stops, i / (PALETTE_RAMP_STOPS - 1)));
    const buf = new Float32Array([
      ...p.a,
      ...p.b,
      ...p.c,
      ...p.d,
      ...hexToRgb(p.roles.ground),
      ...hexToRgb(p.roles.accent),
      ...p.roles.inks.flatMap((h) => [...hexToRgb(h)]),
      ...ramp,
    ]);
    const inksAt = 18; // after a, b, c, d, ground and accent
    const rampAt = inksAt + PALETTE_INK_COUNT * 3;
    cached = {
      a: buf.subarray(0, 3),
      b: buf.subarray(3, 6),
      c: buf.subarray(6, 9),
      d: buf.subarray(9, 12),
      ground: buf.subarray(12, 15),
      accent: buf.subarray(15, 18),
      inks: buf.subarray(inksAt, rampAt),
      ramp: buf.subarray(rampAt, rampAt + PALETTE_RAMP_STOPS * 3),
    };
    vecsCache.set(p, cached);
  }
  return cached;
}

export const PALETTE_GLSL = `
vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(6.28318 * (c * t + d));
}`;

/** The roles in GLSL: uniforms plus `palRamp(t)`. Spliced into every shader
 *  by sceneCommon.ts's COMMON_UNIFORMS_GLSL; a shader that never reads them
 *  pays nothing, since the compiler drops unused uniforms. */
export const PALETTE_ROLES_GLSL = `
uniform vec3 uPalGround;
uniform vec3 uPalAccent;
uniform vec3 uPalInk[${PALETTE_INK_COUNT}];
uniform vec3 uPalRamp[${PALETTE_RAMP_STOPS}];
vec3 palRamp(float t) {
  float x = clamp(t, 0.0, 1.0) * ${(PALETTE_RAMP_STOPS - 1).toFixed(1)};
  int i = int(min(floor(x), ${(PALETTE_RAMP_STOPS - 2).toFixed(1)}));
  return mix(uPalRamp[i], uPalRamp[i + 1], x - float(i));
}`;
