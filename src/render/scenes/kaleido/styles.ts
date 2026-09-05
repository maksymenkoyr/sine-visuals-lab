// The four Kaleidoscope styles, one GLSL function each, selected by uStyle
// in index.ts's main(). Every function gets the same frame — the cell
// coordinates `c`, cell size, radius `r` (already beat-swelled), raw angle
// `a`, fold count `n`, the pixel size in p units and the palette base — and
// returns the final colour. What the styles share (fold, petal, noise, the
// scale-cycling zoom noise, the posterised read) is in glsl.ts; the tiling
// rule they must all respect is in index.ts's header: depend only on r and
// a *folded* angle, and mask any rotation to zero before r reaches cell/2.
//
// The camera zoom is index.ts's lattice zoom; what each style does inside
// its cell is the *flow* (uFlowPos): Mandala's bands stream out along a
// part-logarithmic ramp, Portal's log-spaced annuli drift outward, Prism's
// log-spiral stripes slide out and its noise warp cycles octaves (zfbm),
// Burst's log-polar shards rush out. All are exact in their own coordinates
// so the flow never runs out or repeats; the beat surge (uSurgePos) rides
// the same phase.

import { RAINBOW_BLUE } from "./glsl.ts";
import { CELL_MID } from "./glsl.ts";

/** Rotation is full inside this fraction of the cell and masks to zero at
 *  the edge (0.5), so no rotated ring ever meets a cell mirror (index.ts
 *  header) and the shear of the fade band lands between rings, not on the
 *  big outer ones. */
const EDGE_MASK_INNER = 0.3;
/** Flow phase per unit uFlowPos in the texture styles (in the octave-like
 *  units each style's z is in), and the octaves one unit of the beat
 *  surge's displacement adds (Mandala pushes its bands instead). */
const TEXTURE_FLOW = 0.3;
export const SURGE_ZOOM = 0.25;
/** Bar breathe in the texture styles: octaves the flow rocks by, once per
 *  bar while the tempo is locked. */
const BREATHE_OCTAVES = 0.12;

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

/** F units per unit radius — the base concentric ramp at Zoom = 0. */
const RING_RAMP = 3.0;
/** A logarithmic ramp blended into the linear one by LOG_MIX: F units per
 *  unit of log radius, and the radius the two ramps agree at. Bands on it
 *  sit at r = r1 * exp(F / LOG_RAMP), exponentially spaced, so the outward
 *  flow reads as a dive — bands speed up with radius and new ones are born
 *  at the centre forever. */
const LOG_RAMP = 1.6;
const LOG_R1 = 0.5;
const LOG_MIX = 0.35;
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
/** Twist: F units the bands shear across each wedge at Twist = 1. */
const TWIST_F = 0.4;
/** Corner rosette: an eight-fold gaussian ring around each cell corner, at
 *  this fraction of the cell size and width, so the cross where four cells
 *  meet reads as a designed motif. */
const CORNER_R0 = 0.2;
const CORNER_W = 0.06;
const CORNER_AMP = 0.35;
/** Brightness lift on the beat (glsl.ts beatLift). */
const MANDALA_LIFT = 0.25;

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
  // Cell-relative units: the field below is tuned for a cell of CELL_MID,
  // and a bigger cell must be a bigger mandala, not a wider view of it
  // (the lattice zoom, index.ts header).
  float su = ${CELL_MID.toFixed(2)} / cell;
  c *= su;
  r *= su;
  pxSize *= su;
  cell = ${CELL_MID.toFixed(2)};
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

  // The concentric ramp: part linear, part logarithmic (LOG_RAMP), so the
  // flow streams the bands out as a dive.
  float rz = max(r, 0.01);
  float F = mix(r * ${RING_RAMP.toFixed(2)}, ${LOG_RAMP.toFixed(2)} * log(rz / ${LOG_R1.toFixed(2)}) + ${(RING_RAMP * LOG_R1).toFixed(2)}, ${LOG_MIX.toFixed(2)});
  // dF/dr and dF/dangle, accumulated analytically alongside F: the band
  // footprint below needs |grad F|, and screen-space derivatives can't give
  // it — across a mirror line the neighbouring pixel is the mirror image,
  // so fwidth reads ~0 there and dotted every fold.
  float dFdr = mix(${RING_RAMP.toFixed(2)}, ${LOG_RAMP.toFixed(2)} / rz, ${LOG_MIX.toFixed(2)});
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
  // warm/cool onion cycle. The beat surge pushes the bands along.
  float bands = ${BANDS_MID.toFixed(2)} * pow(2.0, (uRings - 0.5) * ${BANDS_SPAN_OCTAVES.toFixed(2)});
  float b = F * bands - uFlowPos - uSurgePos;
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
  return beatLift(mix(col, mid, smoothstep(0.5, 1.2, w)), ${MANDALA_LIFT.toFixed(2)});
}
`;

// ---- Portal ---------------------------------------------------------------

// One mandala per cell, filling it: a disc of discrete annuli, each ring a
// row of big ornate petals — pointed lobes with nested contours inside — in
// its own hue, some rings a lace of beads instead, drifting outward with
// the flow (new rings born at the centre), with the corners outside the
// disc given to a rosette in the complementary hue — after CPu8pZPClww,
// whose disc stacks navy leaves, scalloped orange petals and zigzag lace on
// an orange ground.

/** Disc radius as a fraction of the cell (just inside the inscribed circle
 *  so the rim clears the cell edge), and the rim's width. */
const PORTAL_DISC = 0.47;
const PORTAL_RIM = 0.018;
/** Annuli per unit of log radius at Ring density = 0.5, and how far the
 *  ring widths wander (a sinusoid on the ring coordinate, kept monotonic). */
const PORTAL_RINGS_MID = 2.6;
const PORTAL_WIDTH_WANDER = 0.32;
/** Per-annulus rotation range in radians per unit uSpinPos at Spin = 1. */
const PORTAL_SPIN = 0.5;
/** Palette span the annuli's hues spread over, and the contour levels a
 *  petal's inside is stepped into (2..PORTAL_LEVELS_MAX). */
const PORTAL_SPAN = 0.4;
const PORTAL_LEVELS_MAX = 4.0;
/** Brightness lift on the beat. */
const PORTAL_LIFT = 0.2;

export const PORTAL_GLSL = `
vec3 stylePortal(vec2 c, float cell, float r, float a, float n, float pxSize, float tBase0) {
  float R = cell * ${PORTAL_DISC.toFixed(3)};
  float density = ${PORTAL_RINGS_MID.toFixed(2)} * pow(2.0, (uRings - 0.5) * 1.5);
  float z = uFlowPos * ${TEXTURE_FLOW.toFixed(2)} + uSurgePos * ${SURGE_ZOOM.toFixed(2)}
    + uBreathe * uTempoLock * ${BREATHE_OCTAVES.toFixed(2)} * (0.5 - 0.5 * cos(TWO_PI * uBarPhase));
  // Ring index grows outward; a ring's index is fixed to its material, so
  // the whole stack drifts outward as the flow phase z grows. The widths wander so the
  // stack isn't a uniform ladder.
  float rl0 = log(max(r, 1e-4) / R) * density + z;
  float rl = rl0 + ${PORTAL_WIDTH_WANDER.toFixed(2)} * sin(rl0 * 1.3 + 1.0);
  float k = floor(rl);
  float fr = fract(rl);
  float wr = fwidth(rl);
  // Each annulus rolls its petal count (an even multiple of the base count,
  // so the mirror rule holds), whether it's petals or a lace of beads, its
  // contour levels, rotation and hue.
  float h1 = hash21(vec2(k, 3.7));
  float h2 = hash21(vec2(k, 8.1));
  float h3 = hash21(vec2(k, 12.9));
  float h4 = hash21(vec2(k, 21.3));
  float multK = h1 < 0.55 ? 1.0 : (h1 < 0.85 ? 2.0 : 3.0);
  float lace = step(0.72, h4);
  float levels = 2.0 + floor(h3 * (${PORTAL_LEVELS_MAX.toFixed(1)} - 1.0));
  float edgeMask = smoothstep(cell * 0.5, cell * ${EDGE_MASK_INNER.toFixed(2)}, r);
  float rot = (h3 - 0.5) * 2.0 * ${PORTAL_SPIN.toFixed(2)} * uSpin * uSpinPos * edgeMask;
  float nk = n * multK * (1.0 + lace);
  float sgn;
  float af = foldAngle(a + rot, nk, sgn);
  // A petal is a lobe in (af, fr): the petal profile across, a rounded
  // window along the ring, sharpened toward a point by the bass. Lace rings
  // use a squat, rounder lobe: a row of beads.
  float m = mix(0.55 + 0.4 * sin(uMorphPos * 0.4 + k * 1.3), 0.1, lace);
  float sharp = 1.6 + 1.5 * uBass * uLow;
  float win = 1.0 - pow(abs(fr * 2.0 - 1.0), sharp);
  float lobe = petal(af, m) * mix(win, win * win, lace);
  float wl = fwidth(lobe) + 1e-4;
  float edge = mix(0.36, 0.5, lace);
  float inside = smoothstep(edge - wl, edge + wl, lobe);
  // Inside: nested contour levels, each stepping the hue a little and
  // outlined in ink — the reference's leaves-within-leaves.
  float qn = clamp((lobe - edge) / (1.0 - edge), 0.0, 0.999);
  float orn = fbm(vec2(af * 1.5 + k * 7.3, fr * 3.0 + k * 17.0 + uMorphPos * 0.15));
  float x = fract(k * 0.17 + 0.5);
  qn = clamp(qn + 0.12 * (orn - 0.5) * mix(1.0, sampleBands(x) * 2.0, uSpectrum), 0.0, 0.999);
  float tRing = tBase0 + mod(k, 2.0) * 0.5 + (h2 - 0.5) * ${PORTAL_SPAN.toFixed(2)};
  vec3 petalCol = posterColor(qn, levels, tRing, 0.14, 0.05 + 0.05 * uInk, min(1.0, uInk * 1.2)) * 1.15;
  // The ground between petals: the ring's complementary hue, darker, with a
  // faint lace of its own.
  float groundLace = 0.93 + 0.07 * smoothstep(0.4, 0.6, fract(af * 4.0 * multK + fr * 2.0));
  vec3 ground = mix(INK, palette(tRing + 0.5 + 0.06, uPalA, uPalB, uPalC, uPalD), 0.55) * groundLace;
  vec3 col = mix(ground, petalCol, inside);
  // Petal outline in ink.
  float outline = smoothstep(edge - 0.06 - wl, edge - 0.06 + wl, lobe) - smoothstep(edge + 0.02 + 0.06 * uInk - wl, edge + 0.02 + 0.06 * uInk + wl, lobe);
  col = mix(col, INK, outline * min(1.0, uInk * 1.4));
  // Ring boundary: an ink line with a bright hairline beside it.
  float dr = min(fr, 1.0 - fr);
  float ringLine = 1.0 - smoothstep(0.03 + 0.03 * uInk - wr, 0.03 + 0.03 * uInk + wr, dr);
  float hair = smoothstep(0.045 - wr, 0.045 + wr, dr) - smoothstep(0.065 - wr, 0.065 + wr, dr);
  col = mix(col, INK, ringLine * min(1.0, uInk * 1.5));
  col = mix(col, palette(tRing, uPalA, uPalB, uPalC, uPalD) * 1.3, hair * 0.6);
  // The centre compresses infinitely many rings: fade to ink there.
  col = mix(INK, col, 1.0 - smoothstep(0.35, 0.9, wr));

  // Outside the disc: a rosette folded around the nearest cell corner in
  // the complementary hue, and a bright rim between.
  vec2 q = abs(c) - cell * 0.5;
  float dc = length(q);
  float ac = atan(q.y, q.x);
  float sgc;
  float afc = foldAngle(ac, 8.0, sgc);
  float Fc = dc / cell * 9.0 + 0.6 * petal(afc, 0.5 + 0.5 * sin(uMorphPos * 0.3)) - uFlowPos * 0.3;
  float bc = fract(Fc);
  float wc = fwidth(Fc);
  vec3 cornerCol = palette(tBase0 + 0.5 + floor(Fc) * 0.04, uPalA, uPalB, uPalC, uPalD);
  float cornerLine = 1.0 - smoothstep(0.08 - wc, 0.08 + wc, min(bc, 1.0 - bc));
  cornerCol = mix(cornerCol, INK, cornerLine * min(1.0, uInk * 1.2));
  float edgeW = fwidth(r) * 1.5;
  float rim = smoothstep(R - ${PORTAL_RIM.toFixed(3)} * cell - edgeW, R - ${PORTAL_RIM.toFixed(3)} * cell + edgeW, r)
    - smoothstep(R - edgeW, R + edgeW, r);
  float outside = smoothstep(R - edgeW, R + edgeW, r);
  col = mix(col, cornerCol, outside);
  col = mix(col, palette(tBase0 + 0.25, uPalA, uPalB, uPalC, uPalD) * 1.2, rim);
  return beatLift(col, ${PORTAL_LIFT.toFixed(2)});
}
`;

// ---- Prism ----------------------------------------------------------------

// A mirror kaleidoscope: each rosette mirrors one wedge of a smoothly warped
// stripe field painted with a cyclic rainbow — stripes crossing the mirror
// seams are what make the chevrons and diamonds — and the stripes are log
// spirals, so a zoom is a plain shift of them and the picture dives
// forever; the warp comes from zfbm and dives with it. After XDNSvjOIxQA,
// a blue-based rainbow of chevron flowers that expand out of the centre and
// kick on every beat.

/** Stripe frequency along the log radius and across the wedge (rainbow
 *  cycles per unit), the warp's swing in stripe cycles, and the noise scale
 *  the warp is read at. */
const PRISM_STRIPE_R = 1.6;
const PRISM_STRIPE_A = 1.0;
const PRISM_WARP = 0.6;
const PRISM_SCALE = 1.6;
/** How much longer the rainbow lingers on blue than on the other hues (the
 *  reference is blue-based): a monotonic warp of the hue, 0..1 keeps it
 *  monotonic. */
const PRISM_BLUE_BIAS = 0.6;
/** Flat colour steps per rainbow cycle, and how much of each step is the
 *  transition — the reference's bands are broad flats with quick edges. */
const PRISM_STEPS = 6.0;
const PRISM_STEP_EDGE = 0.3;
/** Radius (fraction of the cell) over which the angular stripes fade in
 *  from the centre, where they would converge into a starburst. */
const PRISM_CORE_FADE = 0.12;
/** Rainbow cycles the Ring density slider spans (a multiplier on both
 *  stripe frequencies), the hue span of one cycle, and a soft ink line at
 *  each cycle's edge. */
const PRISM_DENSITY_OCTAVES = 1.5;
const PRISM_SPAN = 1.0;
/** Radians of rotation per unit uSpinPos at Spin = 1, and the spiral twist
 *  (stripe cycles of shear across the wedge at Twist = 1). */
const PRISM_SPIN = 0.3;
const PRISM_TWIST = 1.5;
const PRISM_LIFT = 0.35;

export const PRISM_GLSL = `
vec3 stylePrism(vec2 c, float cell, float r, float a, float n, float pxSize, float tBase0) {
  float sector = TWO_PI / n;
  float edgeMask = smoothstep(cell * 0.5, cell * ${EDGE_MASK_INNER.toFixed(2)}, r);
  float rot = ${PRISM_SPIN.toFixed(2)} * uSpin * uSpinPos * edgeMask;
  float sgn;
  float af = foldAngle(a + rot, n, sgn);
  float z = uFlowPos * ${TEXTURE_FLOW.toFixed(2)} + uSurgePos * ${SURGE_ZOOM.toFixed(2)}
    + uBreathe * uTempoLock * ${BREATHE_OCTAVES.toFixed(2)} * (0.5 - 0.5 * cos(TWO_PI * uBarPhase));
  float lr = log(max(r, 1e-4) / cell);
  // The wedge as a plane patch for the warp noise (zooms about the centre).
  float ang = af * sector * 0.5;
  vec2 w = exp(lr) * vec2(cos(ang), sin(ang)) * ${PRISM_SCALE.toFixed(2)} * ${CELL_MID.toFixed(2)};
  float warp = zfbm(w, z * 1.4427 + uMorphPos * 0.3, false) - 0.5;
  float warp2 = zfbm(w * 1.7 + vec2(23.0, 9.0), z * 1.4427 + uMorphPos * 0.2, false) - 0.5;
  // Log-spiral stripes: a line in (log r, angle) is scale-free, so the
  // zoom slides them outward without end. Ring density sets how many.
  float dens = pow(2.0, (uRings - 0.5) * ${PRISM_DENSITY_OCTAVES.toFixed(2)});
  float bassK = 1.0 + 0.6 * uBass * uLow;
  float coreFade = smoothstep(0.0, ${PRISM_CORE_FADE.toFixed(2)} * cell, r);
  float field = (lr - z * 0.6931) * ${PRISM_STRIPE_R.toFixed(2)} * dens
    + af * ${PRISM_STRIPE_A.toFixed(2)} * dens * (1.0 + uTwist * ${PRISM_TWIST.toFixed(2)}) * coreFade
    + ${PRISM_WARP.toFixed(2)} * bassK * (warp + 0.5 * warp2)
    * (0.8 + 0.4 * mix(1.0, sampleBands(0.3), uSpectrum));
  // Broad flats with quick edges: step the field, then linger on blue by
  // slowing the hue where the rainbow is blue.
  float fs = field * ${PRISM_STEPS.toFixed(1)};
  float stepped = (floor(fs) + smoothstep(0.5 - ${PRISM_STEP_EDGE.toFixed(2)} * 0.5, 0.5 + ${PRISM_STEP_EDGE.toFixed(2)} * 0.5, fract(fs))) / ${PRISM_STEPS.toFixed(1)};
  float t = tBase0 + stepped * ${PRISM_SPAN.toFixed(2)};
  t -= ${PRISM_BLUE_BIAS.toFixed(2)} / TWO_PI * sin(TWO_PI * (t - ${RAINBOW_BLUE.toFixed(2)}));
  vec3 col = vivid(t);
  // Sub-pixel stripes at the very centre would moiré: settle to blue there.
  col = mix(col, vivid(${RAINBOW_BLUE.toFixed(2)}) * 0.8, smoothstep(0.4, 1.0, fwidth(field)));
  // A soft ink line at each colour step, weighted by Ink.
  float f = fract(fs);
  float wf = fwidth(fs);
  float line = 1.0 - smoothstep(0.06 - wf, 0.06 + wf, min(f, 1.0 - f));
  col = mix(col, INK, line * min(1.0, uInk));
  return beatLift(col, ${PRISM_LIFT.toFixed(2)});
}
`;

// ---- Burst ----------------------------------------------------------------

// One rosette of shattered crystal rushing out of a dark jagged star: a
// Voronoi of shards in log-polar coordinates (a zoom is a shift there, so
// the dive is exact), stretched along the radius, each shard its own
// rainbow hue and brightness — a good share of them near-black — with
// radial streak highlights read a step apart per colour channel for the
// reference's chromatic smear. After Lj4Ae4T3XP0, whose black eight-
// pointed core pulses on the beat while the shards stream outward.

/** Shard density across the wedge (cells per folded-angle unit) and along
 *  the log radius at Ring density 0 and 1 (a shard is longer than wide). */
const BURST_V = 9.0;
const BURST_U_MIN = 2.5;
const BURST_U_MAX = 6.0;
/** Second, finer shard layer's scale and weight. */
const BURST_FINE = 2.1;
const BURST_FINE_MIX = 0.4;
/** Where the shards' hues centre on the spectrum (blue, like the reference)
 *  and how far they spread either side of it. */
const BURST_HUE_BASE = RAINBOW_BLUE;
const BURST_HUE_SPREAD = 0.8;
/** Fraction of shards that go dark, and how dark the shard edges go. */
const BURST_DARK_SHARE = 0.45;
const BURST_EDGE = 0.1;
/** Radial streaks: frequency across the wedge, along it, their weight, and
 *  the chromatic offset between channels in folded-angle units. */
const BURST_STREAK_V = 14.0;
const BURST_STREAK_U = 0.8;
const BURST_STREAK_MIX = 0.3;
const BURST_FRINGE = 0.015;
/** Core radius as a fraction of the cell, its star depth, and the jag. */
const BURST_CORE = 0.09;
const BURST_STAR = 0.9;
const BURST_JAG = 0.25;
/** Glow just outside the core, its reach in cells, the beat lift and spin. */
const BURST_GLOW = 0.8;
const BURST_GLOW_REACH = 0.14;
const BURST_LIFT = 0.45;
const BURST_SPIN = 0.25;

export const BURST_GLSL = `
vec3 burstShards(vec2 q, float tBase0) {
  vec3 vr = voronoi(q);
  float hue = tBase0 + ${BURST_HUE_BASE.toFixed(2)} + (vr.z - 0.5) * ${BURST_HUE_SPREAD.toFixed(2)};
  float bright = hash21(vec2(vr.z * 41.0, 2.0));
  bright = bright < ${BURST_DARK_SHARE.toFixed(2)} ? bright * 0.35 : 0.55 + 0.45 * bright;
  float edge = smoothstep(0.0, ${BURST_EDGE.toFixed(2)}, vr.y - vr.x);
  return vivid(hue) * bright * (0.35 + 0.65 * edge);
}

vec3 styleBurst(vec2 c, float cell, float r, float a, float n, float pxSize, float tBase0) {
  float edgeMask = smoothstep(cell * 0.5, cell * ${EDGE_MASK_INNER.toFixed(2)}, r);
  float rot = ${BURST_SPIN.toFixed(2)} * uSpin * uSpinPos * edgeMask;
  float sgn;
  float af = foldAngle(a + rot, n, sgn);
  float z = uFlowPos * ${TEXTURE_FLOW.toFixed(2)} + uSurgePos * ${SURGE_ZOOM.toFixed(2)}
    + uBreathe * uTempoLock * ${BREATHE_OCTAVES.toFixed(2)} * (0.5 - 0.5 * cos(TWO_PI * uBarPhase));
  float lr = log(max(r, 1e-4) / cell);
  // Log-polar shard field: u along the radius (shifted by the zoom), v
  // across the wedge; the twist shears one into the other for a spiral.
  float u = lr - z;
  float v = af + uTwist * 0.5 * u;
  float dens = mix(${BURST_U_MIN.toFixed(2)}, ${BURST_U_MAX.toFixed(2)}, uRings);
  vec2 q = vec2(v * ${BURST_V.toFixed(2)}, u * dens + uMorphPos * 0.03);
  vec3 col = burstShards(q, tBase0);
  col = mix(col, burstShards(q * ${BURST_FINE.toFixed(2)} + vec2(5.0, 3.0), tBase0 + 0.3), ${BURST_FINE_MIX.toFixed(2)});
  // Radial streak highlights, each colour channel a hair apart across the
  // wedge — the smear the reference's shards carry.
  vec2 sq = vec2(v * ${BURST_STREAK_V.toFixed(2)}, u * ${BURST_STREAK_U.toFixed(2)} * dens);
  float dv = ${BURST_FRINGE.toFixed(3)} * ${BURST_STREAK_V.toFixed(2)} * (1.0 + uBeatSwell * uPulse);
  vec3 streak = vec3(
    1.0 - abs(fbm(sq - vec2(dv, 0.0)) * 2.0 - 1.0),
    1.0 - abs(fbm(sq) * 2.0 - 1.0),
    1.0 - abs(fbm(sq + vec2(dv, 0.0)) * 2.0 - 1.0));
  streak = pow(streak, vec3(3.0));
  float gain = 0.8 + 0.5 * mix(1.0, sampleBands(0.7), uSpectrum);
  col = col * (0.7 + 0.6 * gain) + streak * ${BURST_STREAK_MIX.toFixed(2)} * gain * (0.4 + col);
  // Dark star core: pointed at each wedge's centre line, jagged with noise,
  // grown by the bass and the beat.
  float spike = pow(1.0 - af, 2.0);
  float jag = ${BURST_JAG.toFixed(2)} * (vnoise(vec2(af * 6.0, uMorphPos * 0.2 + 3.0)) - 0.5);
  float coreR = ${BURST_CORE.toFixed(3)} * cell * (1.0 + ${BURST_STAR.toFixed(2)} * spike + jag)
    * (1.0 + 0.4 * uBass * uLow + 0.35 * uBeatSwell * uPulse);
  float coreEdge = fwidth(r) * 1.5;
  float outside = smoothstep(coreR - coreEdge, coreR + coreEdge, r);
  // Bright halo just outside the core, the shards' light source.
  float halo = exp(-max(r - coreR, 0.0) / (${BURST_GLOW_REACH.toFixed(3)} * cell));
  col = col * (0.8 + ${BURST_GLOW.toFixed(2)} * halo) + vec3(0.85, 0.95, 1.0) * halo * halo * 0.3;
  col = mix(INK * 0.5, col, outside);
  // Ink: the darkest shards sink toward black with it.
  col *= mix(1.0, 0.8, uInk * 0.5);
  return beatLift(col, ${BURST_LIFT.toFixed(2)});
}
`;

export const STYLE_NAMES = ["Mandala", "Portal", "Prism", "Burst"] as const;
