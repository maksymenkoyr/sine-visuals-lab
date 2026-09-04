// The four Kaleidoscope styles, one GLSL function each, selected by uStyle
// in index.ts's main(). Every function gets the same frame — the cell
// coordinates `c`, cell size, radius `r` (already beat-swelled), raw angle
// `a`, fold count `n`, the pixel size in p units and the palette base — and
// returns the final colour. What the styles share (fold, petal, noise, the
// posterised read) is in glsl.ts; the tiling rule they must all respect is
// in index.ts's header: depend only on r and a *folded* angle, and mask any
// rotation to zero before r reaches cell/2.

// ---- Mandala -------------------------------------------------------------

// Ring families. `env` is the radial envelope: "cos" repeats at spacing
// 2pi/omega (the flowing onion rings), "ring" is one gaussian annulus at r0
// of width w (a distinct rosette at a fixed radius — the rosette-inside-a-
// rosette hierarchy the reference mandalas have). `mult` doubles the petal
// count, `amp` is the radial reach in F units, `morphRate` how fast the
// petal profile drifts round -> zigzag -> drop, `bassGain` how much a bass
// level lengthens the petals (inner rings most), `spin` the sign and rate of
// the family's counter-rotation on uSpinPos.
type Family =
  | { env: "cos"; omega: number; phi: number; mult: number; amp: number; morphRate: number; bassGain: number; spin: number }
  | { env: "ring"; r0: number; w: number; mult: number; amp: number; morphRate: number; bassGain: number; spin: number };

const FAMILIES: readonly Family[] = [
  { env: "cos", omega: 5.5, phi: 0.6, mult: 1, amp: 0.5, morphRate: 0.7, bassGain: 1.0, spin: 1.0 },
  { env: "ring", r0: 0.4, w: 0.09, mult: 1, amp: 0.5, morphRate: 0.5, bassGain: 0.7, spin: -0.6 },
  { env: "cos", omega: 8.0, phi: 2.9, mult: 2, amp: 0.3, morphRate: 1.1, bassGain: 0.8, spin: -0.8 },
  { env: "ring", r0: 0.78, w: 0.11, mult: 2, amp: 0.4, morphRate: 1.3, bassGain: 0.3, spin: 0.7 },
  { env: "cos", omega: 6.5, phi: 4.4, mult: 1, amp: 0.28, morphRate: 0.9, bassGain: 0.4, spin: -1.0 },
  { env: "cos", omega: 14.0, phi: 0.2, mult: 2, amp: 0.16, morphRate: 0.6, bassGain: 0.3, spin: 0.4 },
  { env: "cos", omega: 9.0, phi: 3.6, mult: 1, amp: 0.2, morphRate: 0.4, bassGain: 0.2, spin: -0.3 },
];
const FAMILY_COUNT = FAMILIES.length;
/** Families rendered on a low tier — the loop is unrolled, so this is just
 *  where the unrolled `if` stops. */
const FAMILIES_LOW_DETAIL = 3;

/** F units per unit radius — the base concentric ramp. */
const RING_RAMP = 3.0;
/** Bands per F unit at Ring density = 0.5, and the octave span of that slider. */
const BANDS_MID = 6.0;
const BANDS_SPAN_OCTAVES = 2.0;
/** Bands per warm/cool onion cycle, and how much of the palette one cycle
 *  covers. Negative because the cosine palettes run red -> magenta -> blue
 *  with increasing t and the reference's red -> orange -> yellow is the other
 *  way round. */
const CYCLE_BANDS = 6;
const CYCLE_SPAN = -0.22;
/** Radius over which the angular terms fade in from the centre — N folds
 *  converging on one pixel would otherwise alias into a starburst. */
const CORE_FADE = 0.16;
/** Counter-rotation: radians of rotation per unit uSpinPos at spin 1. */
const SPIN_RADIANS = 0.35;
/** Rotation is full inside this fraction of the cell and masks to zero at
 *  the edge (0.5), so no rotated ring ever meets a cell mirror (index.ts
 *  header) and the shear of the fade band lands between rings, not on the
 *  big outer ones. */
const EDGE_MASK_INNER = 0.3;
/** Twist: F units the bands shear across each wedge at Twist = 1. */
const TWIST_F = 0.4;
/** Corner rosette: an eight-fold gaussian ring around each cell corner, at
 *  this fraction of the cell size and width, so the cross where four cells
 *  meet reads as a designed motif. */
const CORNER_R0 = 0.2;
const CORNER_W = 0.06;
const CORNER_AMP = 0.35;

const familyGlsl = FAMILIES.map((f, j) => {
  const env =
    f.env === "cos"
      ? `float ph = r * ${f.omega.toFixed(2)} + ${f.phi.toFixed(2)};
      float env = 0.5 + 0.5 * cos(ph);
      float envD = -0.5 * ${f.omega.toFixed(2)} * sin(ph);`
      : `float e = (r - ${f.r0.toFixed(3)}) / ${f.w.toFixed(3)};
      float env = exp(-e * e);
      float envD = env * (-2.0 * e / ${f.w.toFixed(3)});`;
  const nm = `n * ${f.mult.toFixed(1)}`;
  return `
    if (${j} < fam) {
      float x = ${((j + 0.5) / FAMILY_COUNT).toFixed(4)};
      float rot = ${f.spin.toFixed(2)} * ${SPIN_RADIANS.toFixed(2)} * uSpin * uSpinPos * edgeMask;
      float rotD = ${f.spin.toFixed(2)} * ${SPIN_RADIANS.toFixed(2)} * uSpin * uSpinPos * edgeMaskD;
      float sgn1, sgn2;
      float af1 = foldAngle(a + rot, ${nm}, sgn1);
      float af2 = foldAngle(a + rot, ${nm} * 2.0, sgn2);
      float m = 0.5 + 0.5 * sin(uMorphPos * ${f.morphRate.toFixed(2)} + ${(j * 1.7).toFixed(2)});
      float shape = mix(petal(af1, m), petal(af2, m), split);
      float shapeD = mix(petalD(af1, m) * sgn1 * (${nm} / PI), petalD(af2, m) * sgn2 * (${nm} * 2.0 / PI), split);
      ${env}
      float amp = ${f.amp.toFixed(3)}
        * (0.5 + 0.5 * mix(1.0, sampleBands(x), uSpectrum))
        * (1.0 + uBass * uLow * ${f.bassGain.toFixed(2)})
        * outer
        * ${f.mult === 2 ? "core2" : "core"};
      F += amp * env * shape;
      dFdr += amp * (envD * shape + env * shapeD * rotD);
      dFda += amp * env * shapeD;
    }`;
}).join("\n");

export const MANDALA_GLSL = `
vec3 styleMandala(vec2 c, float cell, float r, float a, float n, float pxSize, float tBase0) {
  float core = smoothstep(0.0, ${CORE_FADE.toFixed(3)}, r);
  float core2 = smoothstep(0.0, ${(CORE_FADE * 2.5).toFixed(3)}, r);
  // Outer rings settle toward plain circles so the corner motif below owns
  // the region where four cells meet.
  float outer = 1.0 / (1.0 + 0.5 * r * r);
  // Rotation fades out before the cell edge — a rotated ring crossing a
  // cell mirror would break the seamless tiling (index.ts header).
  float edge0 = cell * 0.5;
  float edge1 = cell * ${EDGE_MASK_INNER.toFixed(2)};
  float edgeMask = smoothstep(edge0, edge1, r);
  float edgeMaskD = smoothstepD(edge0, edge1, r);
  // Bar breathe: petals split in two and rejoin once per bar while the
  // tempo is locked; hold still when it isn't.
  float split = uBreathe * uTempoLock * (0.5 - 0.5 * cos(TWO_PI * uBarPhase));
  int fam = uDetail < 0.5 ? ${FAMILIES_LOW_DETAIL} : ${FAMILY_COUNT};

  float F = r * ${RING_RAMP.toFixed(2)};
  // dF/dr and dF/dangle, accumulated analytically alongside F: the band
  // footprint below needs |grad F|, and screen-space derivatives can't give
  // it — across a mirror line the neighbouring pixel is the mirror image,
  // so fwidth reads ~0 there and dotted every fold.
  float dFdr = ${RING_RAMP.toFixed(2)};
  float dFda = 0.0;
  ${familyGlsl}

  // Twist: shear the bands across each wedge (a function of the folded
  // angle, so mirror-safe) — chevrons that spiral as they flow.
  {
    float sgnT;
    float afT = foldAngle(a, n, sgnT);
    F -= uTwist * ${TWIST_F.toFixed(2)} * afT;
    dFda -= uTwist * ${TWIST_F.toFixed(2)} * sgnT * (n / PI);
  }

  // Corner rosette, in its own polar frame around the nearest cell corner;
  // its gradient competes with the centre frame's as a max — adding them
  // over-read and blurred the whole corner region into the moiré fade.
  float gradExtra = 0.0;
  if (uDetail >= 0.5) {
    vec2 q = abs(c) - cell * 0.5;
    float dc = length(q);
    float ac = atan(q.y, q.x);
    float sgc;
    float afc = foldAngle(ac, 8.0, sgc);
    float mc = 0.5 + 0.5 * sin(uMorphPos * 0.6 + 2.0);
    float wC = ${CORNER_W.toFixed(3)} * cell;
    float e = (dc - ${CORNER_R0.toFixed(3)} * cell) / wC;
    float env = exp(-e * e);
    float envD = env * (-2.0 * e / wC);
    float shapeC = petal(afc, mc);
    F += ${CORNER_AMP.toFixed(3)} * env * shapeC;
    gradExtra = ${CORNER_AMP.toFixed(3)} * length(vec2(envD * shapeC, env * petalD(afc, mc) * sgc * (8.0 / PI) / max(dc, 1e-3)));
  }

  // Quantise F into flowing bands; colour each band from its place in a
  // warm/cool onion cycle.
  float bands = ${BANDS_MID.toFixed(2)} * pow(2.0, (uRings - 0.5) * ${BANDS_SPAN_OCTAVES.toFixed(2)});
  float b = F * bands - uFlowPos;
  float gradF = max(length(vec2(dFdr, dFda / max(r, 1e-3))), gradExtra);
  float w = bands * gradF * pxSize;
  float i = floor(b);
  float f = fract(b);
  float cyc = mod(i, ${CYCLE_BANDS.toFixed(1)});
  float grp = mod(floor(i / ${CYCLE_BANDS.toFixed(1)}), 2.0);
  float tBase = tBase0 + grp * 0.5;
  float t = tBase + cyc / ${CYCLE_BANDS.toFixed(1)} * ${CYCLE_SPAN.toFixed(2)};
  vec3 col = palette(t, uPalA, uPalB, uPalC, uPalD);

  // Ink: the first band of every cycle goes dark, and every band boundary
  // gets a dark line, both antialiased on the band's own pixel footprint.
  float navy = min(1.0, uInk * 1.5) * step(cyc, 0.5);
  float d = min(f, 1.0 - f);
  float lineHalf = 0.05 + 0.07 * uInk;
  float line = 1.0 - smoothstep(lineHalf - w, lineHalf + w, d);
  col = mix(col, INK, max(navy, line * min(1.0, uInk * 1.4)));

  // Sub-pixel bands would moiré: fade to this cycle's mid colour where they do.
  vec3 mid = palette(tBase + ${(CYCLE_SPAN * 0.5).toFixed(3)}, uPalA, uPalB, uPalC, uPalD) * 0.7;
  return mix(col, mid, smoothstep(0.5, 1.2, w));
}
`;

// ---- Portal ---------------------------------------------------------------

/** Annuli per unit of log radius at Ring density = 0.5, and its octave span. */
const PORTAL_RINGS_MID = 3.0;
/** How fast the annuli drift inward per unit uFlowPos (positive = inward:
 *  the boundary of ring n sits at r = exp((n - flow)/density)). */
const PORTAL_FLOW = 0.35;
/** Per-annulus rotation range in radians per unit uSpinPos at Spin = 1. */
const PORTAL_SPIN = 0.5;
/** Posterise levels inside an annulus, and the palette span they cover. */
const PORTAL_LEVELS = 5.0;
const PORTAL_SPAN = -0.2;

export const PORTAL_GLSL = `
vec3 stylePortal(vec2 c, float cell, float r, float a, float n, float pxSize, float tBase0) {
  float density = ${PORTAL_RINGS_MID.toFixed(2)} * pow(2.0, (uRings - 0.5) * 1.5);
  float rl = log(max(r, 1e-3)) * density + uFlowPos * ${PORTAL_FLOW.toFixed(2)};
  // Vary the annulus widths so the rings aren't a uniform ladder.
  rl += 0.3 * sin(rl * 1.7 + 0.4);
  float k = floor(rl);
  float fr = fract(rl);
  // Each annulus rolls its own petal count (an even multiple of the base
  // count, so the mirror rule holds), rotation and texture seed.
  float h = hash21(vec2(k, 3.7));
  float multK = h < 0.33 ? 1.0 : (h < 0.66 ? 2.0 : 3.0);
  float edgeMask = smoothstep(cell * 0.5, cell * ${EDGE_MASK_INNER.toFixed(2)}, r);
  float rot = (hash21(vec2(k, 8.1)) - 0.5) * 2.0 * ${PORTAL_SPIN.toFixed(2)} * uSpin * uSpinPos * edgeMask;
  float sgn;
  float af = foldAngle(a + rot, n * multK, sgn);
  // Texture in the folded wedge: continuous across the wedge seam (mirror),
  // discontinuous across the annulus boundary — that's where the ring line
  // goes.
  float m = 0.5 + 0.5 * sin(uMorphPos * 0.5 + k * 1.3);
  float pet = petal(af, m);
  float tex = fbm(vec2(af * 1.2 + k * 7.3, fr * 1.6 + k * 17.0 + uMorphPos * 0.1));
  // Spectrum: each annulus's contrast follows one band, bass inside.
  float x = fract(k * 0.17 + 0.5);
  float contrast = 0.6 + 0.6 * mix(1.0, sampleBands(x), uSpectrum);
  tex = clamp(0.5 + (tex - 0.5) * contrast + 0.45 * (pet - 0.5) * (1.0 + uBass * uLow), 0.0, 0.999);
  float grp = mod(k, 2.0);
  vec3 col = posterColor(tex, ${PORTAL_LEVELS.toFixed(1)}, tBase0 + grp * 0.5, ${PORTAL_SPAN.toFixed(2)}, 0.05 + 0.06 * uInk, min(1.0, uInk * 1.4));
  // Annulus boundary line.
  float wr = fwidth(rl);
  float dr = min(fr, 1.0 - fr);
  float ringLine = 1.0 - smoothstep(0.03 + 0.05 * uInk - wr, 0.03 + 0.05 * uInk + wr, dr);
  col = mix(col, INK, ringLine * min(1.0, uInk * 1.5));
  // The centre compresses infinitely many rings: fade to ink there.
  return mix(INK, col, smoothstep(0.02, 0.09, r));
}
`;

// ---- Prism ----------------------------------------------------------------

/** Noise scale of the mirrored texture, and the warp strength. */
const PRISM_SCALE = 3.0;
const PRISM_WARP = 0.6;
/** Posterise levels at Ring density 0 and 1, and the palette span. */
const PRISM_LEVELS_MIN = 4.0;
const PRISM_LEVELS_MAX = 12.0;
const PRISM_SPAN = 0.9;

export const PRISM_GLSL = `
vec3 stylePrism(vec2 c, float cell, float r, float a, float n, float pxSize, float tBase0) {
  // Classic mirror kaleidoscope: fold the point into the fundamental wedge
  // and sample a texture there. Depends only on r and the folded angle.
  float sector = TWO_PI / n;
  float sgn;
  float af = foldAngle(a, n, sgn);
  float ang = af * sector * 0.5;
  vec2 w = r * vec2(cos(ang), sin(ang)) * ${PRISM_SCALE.toFixed(2)};
  float warp = fbm(w * 0.7 + uMorphPos * 0.15);
  float tex = fbm(w + ${PRISM_WARP.toFixed(2)} * (1.0 + uBass * uLow) * warp + vec2(uFlowPos * 0.05, 0.0));
  tex = clamp(0.5 + (tex - 0.5) * (1.4 + 0.8 * mix(1.0, sampleBands(0.3), uSpectrum)), 0.0, 0.999);
  float levels = mix(${PRISM_LEVELS_MIN.toFixed(1)}, ${PRISM_LEVELS_MAX.toFixed(1)}, uRings);
  return posterColor(tex, levels, tBase0, ${PRISM_SPAN.toFixed(2)}, 0.04 + 0.05 * uInk, min(1.0, uInk * 0.9));
}
`;

// ---- Burst ----------------------------------------------------------------

/** Streak density along log radius at Ring density 0 and 1. */
const BURST_STREAK_MIN = 2.0;
const BURST_STREAK_MAX = 6.0;
/** Noise frequency across the wedge (v) and along the radius (u): high
 *  across, low along, so the noise reads as radial shards. */
const BURST_V = 1.8;
const BURST_U = 0.6;
/** Core radius, its star depth, and the posterise levels. */
const BURST_CORE = 0.16;
const BURST_STAR = 0.35;
const BURST_LEVELS = 8.0;
const BURST_SPAN = 0.9;

export const BURST_GLSL = `
vec3 styleBurst(vec2 c, float cell, float r, float a, float n, float pxSize, float tBase0) {
  float streak = mix(${BURST_STREAK_MIN.toFixed(1)}, ${BURST_STREAK_MAX.toFixed(1)}, uRings);
  float u = log(max(r, 1e-3)) * streak - uFlowPos * 0.6;
  float sgn;
  float af = foldAngle(a, n, sgn);
  float v = af * ${BURST_V.toFixed(1)};
  float tex = fbm(vec2(v * 2.5 + uMorphPos * 0.1, u * ${BURST_U.toFixed(2)}));
  tex = clamp(0.5 + (tex - 0.5) * (1.6 + 0.8 * mix(1.0, sampleBands(0.7), uSpectrum)), 0.0, 0.999);
  vec3 col = posterColor(tex, ${BURST_LEVELS.toFixed(1)}, tBase0, ${BURST_SPAN.toFixed(2)}, 0.03 + 0.04 * uInk, min(1.0, uInk));
  // Push saturation toward the reference's neon.
  col = pow(col, vec3(1.3));
  // Dark star core: the petal profile points it at each wedge's centre line.
  float coreR = ${BURST_CORE.toFixed(3)} * (1.0 + ${BURST_STAR.toFixed(2)} * petal(af, 0.5)) * (1.0 + 0.5 * uBass * uLow + 0.3 * uBeatSwell);
  float coreEdge = fwidth(r) * 1.5;
  return mix(INK, col, smoothstep(coreR - coreEdge, coreR + coreEdge, r));
}
`;

export const STYLE_NAMES = ["Mandala", "Portal", "Prism", "Burst"] as const;
