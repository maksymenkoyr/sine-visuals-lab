// The Chladni plate's second sand colour, for Powder colour. Pure, no GL.
//
// The plate sorts a mixed bed by weight: grit walks to the still lines while
// powder light enough for the air streaming heaps on the antinodes (see
// chladni.ts's header). Powder colour draws that powder in a second colour so
// the sorting shows. Grit keeps the colours it always had, the bright half of
// the room palette's ramp (gritColour, the curve POINT_VERT draws grains on),
// so the second colour has to be one that curve never passes near.
//
// Which colour. A palette has no "second sand" role, and no fixed role works
// for every palette: in some the accent or an ink sits on the ramp (Sunset's
// first ink is a ramp stop), and the single-hue ones (Fire, Amber, Phosphor)
// have no ink far from it at all. So powderInk looks at the palette's own
// distinct colours, its inks and accent, and takes the one farthest in OKLab
// from every colour on the grit curve, among those light enough to read as
// small dust on the dark plate (POWDER_L_MIN). If even that one is closer than
// POWDER_MIN_DISTANCE, it makes one instead: the grit's own hue turned by
// POWDER_HUE_TURN at POWDER_FALLBACK_L and up to POWDER_FALLBACK_C chroma,
// so a single-hue palette gets the colour opposite its hue.
//
// Far apart as they are, and far apart as they show. POINT_VERT multiplies a
// grain's colour by a brightness gain well above 1, which clips grit toward
// white, while powder is scaled back into range so it keeps its hue. That can
// pull two colours together (a pale ink washes out to the same near-white as
// the grit) or push them apart (a saturated blue next to grit that whitens).
// So the distance is the smaller of the two: the colours as they are, which is
// what a low Grain brightness shows, and both lit at POWDER_LIT_GAIN.
// tests/chladni.test.ts holds every library palette to both promises.

import { paletteVecs, PALETTE_RAMP_STOPS, type Palette } from "../palette.ts";
import { hexToRgb, oklabDistance, oklabToRgb, rgbToOklab, type Rgb } from "../oklab.ts";

/** Grit takes palRamp(GRIT_RAMP_LO + GRIT_RAMP_SPAN * motion): settled grains
 *  mid-ramp, thrown ones at its brightest end. Read by POINT_VERT. */
export const GRIT_RAMP_LO = 0.55;
export const GRIT_RAMP_SPAN = 0.45;
/** How far settled grit is greyed toward its own luma (none when thrown). */
export const GRIT_CHALK = 0.15;

/** The powder colour stays at least this far (OKLab) from every grit colour. */
export const POWDER_MIN_DISTANCE = 0.1;
/** ...and at least this light (OKLab L), since powder is drawn small. */
export const POWDER_L_MIN = 0.55;
/** About the brightness gain POINT_VERT gives a grain at the default Grain
 *  brightness: what the "lit" comparison in distanceFromGrit assumes. */
export const POWDER_LIT_GAIN = 1.8;
/** The made colour when no ink or accent qualifies: see the header. */
export const POWDER_HUE_TURN = Math.PI;
export const POWDER_FALLBACK_L = 0.62;
export const POWDER_FALLBACK_C = 0.16;

/** palRamp(t) as the shader reads it: linear between the baked stops. */
function rampAt(ramp: Float32Array, t: number): Rgb {
  const x = Math.min(1, Math.max(0, t)) * (PALETTE_RAMP_STOPS - 1);
  const i = Math.min(Math.floor(x), PALETTE_RAMP_STOPS - 2);
  const f = x - i;
  const c = (k: number): number => ramp[i * 3 + k] + (ramp[(i + 1) * 3 + k] - ramp[i * 3 + k]) * f;
  return [c(0), c(1), c(2)];
}

/** A grit grain's colour under `p` at `motion` (0 settled .. 1 fully thrown),
 *  before brightness. Mirrors the grit colour in POINT_VERT. */
export function gritColour(p: Palette, motion: number): Rgb {
  const m = Math.min(1, Math.max(0, motion));
  const c = rampAt(paletteVecs(p).ramp, GRIT_RAMP_LO + GRIT_RAMP_SPAN * m);
  const grey = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  const k = GRIT_CHALK * (1 - m);
  return [c[0] + (grey - c[0]) * k, c[1] + (grey - c[1]) * k, c[2] + (grey - c[2]) * k];
}

/** Grit lit by this gain, clipped per channel, as POINT_VERT does. */
export function litGrit(c: Rgb, gain = POWDER_LIT_GAIN): Rgb {
  return [Math.min(1, c[0] * gain), Math.min(1, c[1] * gain), Math.min(1, c[2] * gain)];
}

/** Powder at the bed's brightest shade, lit by this gain and scaled back into
 *  range as POINT_VERT does, so it keeps its hue. */
export function litPowder(c: Rgb, gain = POWDER_LIT_GAIN): Rgb {
  const s = Math.max(1, c[0] * gain, c[1] * gain, c[2] * gain);
  return [(c[0] * gain) / s, (c[1] * gain) / s, (c[2] * gain) / s];
}

const GRIT_SAMPLES = 17;

/** How close `c` comes (OKLab) to any colour grit takes under `p`, both as
 *  the colours are and as they show once lit (see the header). */
export function distanceFromGrit(p: Palette, c: Rgb): number {
  const lit = litPowder(c);
  let d = Infinity;
  for (let i = 0; i < GRIT_SAMPLES; i++) {
    const g = gritColour(p, i / (GRIT_SAMPLES - 1));
    d = Math.min(d, oklabDistance(c, g), oklabDistance(lit, litGrit(g)));
  }
  return d;
}

/** The grit's hue turned by POWDER_HUE_TURN, at the most chroma up to
 *  POWDER_FALLBACK_C that stays inside sRGB. */
function turnedFromGrit(p: Palette): Rgb {
  // The grit curve's hue, chroma-weighted so near-white thrown grains barely count.
  let a = 0;
  let b = 0;
  for (let i = 0; i < GRIT_SAMPLES; i++) {
    const lab = rgbToOklab(gritColour(p, i / (GRIT_SAMPLES - 1)));
    a += lab[1];
    b += lab[2];
  }
  const h = Math.atan2(b, a) + POWDER_HUE_TURN;
  for (let c = POWDER_FALLBACK_C; c > 0; c -= 0.005) {
    const lab = [POWDER_FALLBACK_L, c * Math.cos(h), c * Math.sin(h)] as const;
    const rgb = oklabToRgb(lab);
    // oklabToRgb clips per channel; in gamut means the clip changed nothing.
    const back = rgbToOklab(rgb);
    if (Math.hypot(back[0] - lab[0], back[1] - lab[1], back[2] - lab[2]) < 1e-3) return rgb;
  }
  return oklabToRgb([POWDER_FALLBACK_L, 0, 0]);
}

const cache = new WeakMap<Palette, Rgb>();

/** The powder colour for `p` (sRGB, 0..1) — see the header. Cached per
 *  palette, since palettes are static module data. */
export function powderInk(p: Palette): Rgb {
  let out = cache.get(p);
  if (!out) {
    let best: Rgb | null = null;
    let bestD = -1;
    for (const hex of [...p.roles.inks, p.roles.accent]) {
      const c = hexToRgb(hex);
      if (rgbToOklab(c)[0] < POWDER_L_MIN) continue;
      const d = distanceFromGrit(p, c);
      if (d > bestD) {
        best = c;
        bestD = d;
      }
    }
    out = best && bestD >= POWDER_MIN_DISTANCE ? best : turnedFromGrit(p);
    cache.set(p, out);
  }
  return out;
}
