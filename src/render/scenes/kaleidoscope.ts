import { createFullscreenScene } from "../fullscreenScene.ts";
import type { SceneSetting } from "../sceneSettings.ts";
import type { SignalLink } from "../signals.ts";

// A mirror-tiled lattice of mandalas, every shape drawn as nested hard-edged
// contour bands — the "Kaleidoscope Visuals" look (YouTube short IHRMKsTh0Sk
// was the reference): petals that slowly morph between round lobes, zigzag
// stars and pointed drops, colour bands that flow outward from each centre,
// and rings that flip between warm and cool.
//
// How the picture is made: the plane is folded into square cells (p4m
// symmetry, one mandala per cell), each cell into uSymmetry mirrored
// wedges, and a scalar field F(r, foldedAngle) is built from a concentric
// ramp plus a few "ring families" — a radial cosine envelope (rings at a
// fixed spacing) times a petal profile of the folded angle. The colour is
// then just F quantised into bands and run through the room palette: the
// nested "onion" contours are level sets of F, and the flow is a phase
// offset on that quantisation, accumulated JS-side like caustics' drift.
//
// Why uSymmetry only takes even values: the field depends on r and the
// mirror-folded angle only, so it's invariant under angle -> -angle and
// angle -> angle + 2pi/N. A neighbouring cell is the mirror image across the
// shared edge, which maps angle -> pi - angle; that's a symmetry of the
// field iff pi is a multiple of 2pi/N, i.e. iff N is even. With N even the
// tiling is seamless for free — no explicit stitching at cell edges — and
// the cross/diamond motif where four cells meet is just four sets of outer
// rings meeting under that mirror.
//
// The centre of each mandala fades the angular terms out (CORE_FADE below):
// N folds converging on one pixel would otherwise alias into a starburst,
// and the reference's core reads as a plain dot inside concentric rings.
// The same concern at any radius — bands narrower than a pixel — is handled
// by fading toward the cycle's mid colour where the band footprint drops
// below a pixel, the idea caustics uses to damp its own rainbow moiré. That
// footprint comes from analytic dF/dr and dF/dangle carried alongside F, not
// from fwidth: across a mirror line the neighbouring pixel is the mirror
// image, so a screen-space derivative reads ~0 there and dotted every fold.

// Ring families. Each is one radial cosine (spacing 2pi/omega, offset phi)
// times a petal profile; `mult` doubles the petal count of that family so
// inner and outer rings don't all share one count; `amp` is the family's
// radial reach in F units (an F unit is 1/RING_RAMP of the mandala radius);
// `morphRate` is how fast this family's petal profile drifts around the
// round -> zigzag -> drop cycle relative to uMorphPos; `bassGain` is how
// much a bass level lengthens its petals — inner rings most, the reference's
// centre flower swells on the kick while the outer lace mostly holds still.
const FAMILIES = [
  { omega: 5.5, phi: 0.6, mult: 1, amp: 0.55, morphRate: 0.7, bassGain: 1.0 },
  { omega: 8.0, phi: 2.9, mult: 2, amp: 0.35, morphRate: 1.1, bassGain: 0.8 },
  { omega: 11.0, phi: 1.7, mult: 1, amp: 0.45, morphRate: 0.5, bassGain: 0.6 },
  { omega: 6.5, phi: 4.4, mult: 1, amp: 0.3, morphRate: 0.9, bassGain: 0.4 },
  { omega: 14.0, phi: 0.2, mult: 2, amp: 0.18, morphRate: 1.3, bassGain: 0.3 },
  { omega: 9.0, phi: 3.6, mult: 1, amp: 0.2, morphRate: 0.4, bassGain: 0.2 },
] as const;
const FAMILY_COUNT = FAMILIES.length;
/** Families rendered when uDetail says the device is on a low tier — the
 *  loop is a constant-bound `for` with an early break, as GLSL ES 3.0 needs. */
const FAMILIES_LOW_DETAIL = 3;

/** Viewport-height span of the centred coordinate system. */
const ZOOM = 2.3;
/** Cell size at Tiling = 0.5, and the per-slider-unit ratio around it. */
const CELL_MID = 1.8;
const CELL_SPAN = 2.8;
/** F units per unit radius — the base concentric ramp. */
const RING_RAMP = 3.0;
/** Bands per F unit at Ring density = 0.5, and the octave span of that slider. */
const BANDS_MID = 6.0;
const BANDS_SPAN_OCTAVES = 2.0;
/** Bands per warm/cool onion cycle, and how much of the palette one cycle covers
 *  (less than 1 so each cycle has a visible seam at the dark band). */
const CYCLE_BANDS = 6;
const CYCLE_SPAN = -0.22;
/** Where a warm cycle starts in the palette — a touch below 0 so Neon's
 *  first band is a deep red rather than a pink. The span is negative because
 *  the cosine palettes run red -> magenta -> blue with increasing t; the
 *  reference's red -> orange -> yellow is the other way round. */
const CYCLE_BASE = 0.02;
/** Radius over which the angular terms fade in from the centre. */
const CORE_FADE = 0.16;
/** Beat: how far the mandala swells (fraction of radius) and how many bands
 *  the contours snap by, at Beat snap = 1 on a fresh beat. */
const BEAT_SWELL = 0.08;
const BEAT_SNAP = 0.6;
/** Flow accumulator: bands per second at Outward flow = 0 and 1, the extra
 *  factor a full bass level adds, and the jolt (in bands) a beat adds at
 *  Beat snap = 1. Scales the rate, never the accumulated phase — see
 *  flowClock.ts for why the other way teleports. */
const FLOW_RATE_MIN = 0.2;
const FLOW_RATE_MAX = 3.0;
const FLOW_BASS_GAIN = 1.2;
const FLOW_BEAT_JOLT = 0.6;
/** Morph accumulator: radians per second at Shape drift = 0 and 1, and the
 *  extra factor a loud section adds. */
const MORPH_RATE_MIN = 0.1;
const MORPH_RATE_MAX = 1.0;
const MORPH_SECTION_GAIN = 0.6;
/** Palette offset a section drop adds — half a palette, so warm rings turn
 *  cool and vice versa. Accumulates: each drop flips again. */
const DROP_FLIP = 0.5;

const SETTINGS: SceneSetting[] = [
  {
    key: "symmetry",
    label: "Symmetry",
    description: "How many mirrored wedges each mandala folds into — even counts only, so the tiles meet without a seam",
    group: "Form",
    min: 6,
    max: 32,
    step: 2,
    default: 20,
    // Framing geometry the user picks to taste, same reasoning as caustics'
    // Caustic density — not something the music profile should redecide.
  },
  {
    key: "spread",
    label: "Tiling",
    description: "How large each mandala's cell is — small tiles many across the screen, large is a single mandala filling it",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
  },
  {
    key: "rings",
    label: "Ring density",
    description: "How many colour bands nest inside each shape — fewer, fatter bands low; a fine lace high",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // A busy, bright mix reads as finer lace; a sparse dark one as bold bands.
    auto: { density: 0.3, brightness: 0.15 },
  },
  {
    key: "spectrum",
    label: "Spectrum rings",
    description: "How much the spectrum shapes the rings — bass lengthens the inner petals, treble the outer ones",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    auto: { density: 0.2, dynamics: 0.2 },
  },
  {
    key: "bass",
    label: "Bass swell",
    description: "How far a sustained bass level stretches the centre flower",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { brightness: -0.2, loudness: 0.2 },
  },
  {
    key: "morph",
    label: "Shape drift",
    description: "How fast the petals wander between round lobes, zigzag stars and pointed drops",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    auto: { tempo: 0.2, dynamics: 0.2 },
  },
  {
    key: "flow",
    label: "Outward flow",
    description: "How fast the colour bands stream out from each centre; bass pushes them faster",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { tempo: 0.3, loudness: 0.2 },
  },
  {
    key: "pulse",
    label: "Beat snap",
    description: "Each beat swells the mandala and jolts the bands outward a step; a section drop flips every ring between warm and cool",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { pulse: 0.3, attack: 0.2 },
    reads: ["feature.onset", "anim.dropOnset"] satisfies readonly SignalLink[],
  },
  {
    key: "ink",
    label: "Ink",
    description: "Weight of the dark outlines between bands and of the navy ring that starts each cycle",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    auto: { brightness: -0.2 },
  },
  {
    key: "tint",
    label: "Tint drift",
    description: "How far a bright or dull spectrum slides every band's colour along the palette",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
    auto: { brightness: 0.2 },
    reads: ["anim.centroid"] satisfies readonly SignalLink[],
  },
];

const familyGlsl = FAMILIES.map(
  (f, j) => `
    if (${j} < fam) {
      float x = ${((j + 0.5) / FAMILY_COUNT).toFixed(4)};
      float sgn;
      float af = foldAngle(a, n * ${f.mult.toFixed(1)}, sgn);
      float m = 0.5 + 0.5 * sin(uMorphPos * ${f.morphRate.toFixed(2)} + ${(j * 1.7).toFixed(2)});
      float shape = petal(af, m);
      float phase = r * ${f.omega.toFixed(2)} + ${f.phi.toFixed(2)};
      float env = 0.5 + 0.5 * cos(phase);
      float amp = ${f.amp.toFixed(3)}
        * (0.5 + 0.5 * mix(1.0, sampleBands(x), uSpectrum))
        * (1.0 + uBass * uLow * ${f.bassGain.toFixed(2)})
        * outer
        * ${f.mult === 2 ? "core2" : "core"};
      F += amp * env * shape;
      dFdr += amp * -0.5 * ${f.omega.toFixed(2)} * sin(phase) * shape;
      dFda += amp * env * petalD(af, m) * sgn * (n * ${f.mult.toFixed(1)} / PI);
    }`,
).join("\n");

const FRAG = `
#define PI 3.14159265359
#define TWO_PI 6.28318530718

// Mirror-fold an angle into wedge [0,1]: 0 on a petal's centre line, 1 on
// the seam between two petals.
float foldAngle(float a, float n, out float sgn) {
  float sector = TWO_PI / n;
  float u = mod(a + sector * 0.5, sector) - sector * 0.5;
  sgn = u < 0.0 ? -1.0 : 1.0;
  return abs(u) / (sector * 0.5);
}

// Petal profile over the folded angle, morphing round -> zigzag -> drop as
// m goes 0 -> 0.5 -> 1.
float petal(float af, float m) {
  float rnd = 0.5 + 0.5 * cos(af * PI);
  float zig = 1.0 - af;
  float spk = zig * zig * zig;
  return m < 0.5 ? mix(rnd, zig, m * 2.0) : mix(zig, spk, (m - 0.5) * 2.0);
}

// d petal / d af, for the analytic band-width estimate in main().
float petalD(float af, float m) {
  float rndD = -0.5 * PI * sin(af * PI);
  float zigD = -1.0;
  float z = 1.0 - af;
  float spkD = -3.0 * z * z;
  return m < 0.5 ? mix(rndD, zigD, m * 2.0) : mix(zigD, spkD, (m - 0.5) * 2.0);
}

void main() {
  vec2 uv = roomUv(vUv);
  vec2 aspectFix = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 p = (uv - 0.5) * aspectFix * ${ZOOM.toFixed(2)};

  // Square cells, coordinates relative to the nearest mandala centre.
  float cell = ${CELL_MID.toFixed(2)} * pow(${CELL_SPAN.toFixed(2)}, (uSpread - 0.5) * 2.0);
  vec2 c = mod(p + cell * 0.5, cell) - cell * 0.5;

  float r = length(c) * (1.0 - ${BEAT_SWELL.toFixed(3)} * uPulse * uBeatPulse);
  float a = atan(c.y, c.x);
  float n = max(2.0, floor(uSymmetry * 0.5 + 0.5) * 2.0);
  float core = smoothstep(0.0, ${CORE_FADE.toFixed(3)}, r);
  float core2 = smoothstep(0.0, ${(CORE_FADE * 2.5).toFixed(3)}, r);
  // Outer rings settle toward plain circles so the motif where four cells
  // meet stays a small diamond, as in the reference, not a second flower.
  float outer = 1.0 / (1.0 + 0.5 * r * r);
  int fam = uDetail < 0.5 ? ${FAMILIES_LOW_DETAIL} : ${FAMILY_COUNT};

  float F = r * ${RING_RAMP.toFixed(2)};
  // dF/dr and dF/dangle, accumulated analytically alongside F: the band
  // footprint below needs |grad F|, and screen-space derivatives can't
  // give it — across a mirror line the neighbouring pixel is the mirror
  // image, so fwidth reads ~0 there and left dotted seams on every fold.
  float dFdr = ${RING_RAMP.toFixed(2)};
  float dFda = 0.0;
  ${familyGlsl}
  F += ${BEAT_SNAP.toFixed(2)} * uPulse * uBeatPulse;

  // Quantise F into flowing bands; colour each band from its place in a
  // warm/cool onion cycle.
  float bands = ${BANDS_MID.toFixed(2)} * pow(2.0, (uRings - 0.5) * ${BANDS_SPAN_OCTAVES.toFixed(2)});
  float b = F * bands - uFlowPos;
  // Bands per pixel (the band footprint, inverted): |grad F| from the
  // analytic derivatives above, times the pixel size in p units — p is
  // linear in vUv, so fwidth on it is exact and seam-free.
  float pxSize = max(fwidth(p.x), fwidth(p.y));
  float gradF = length(vec2(dFdr, dFda / max(r, 1e-3)));
  float w = bands * gradF * pxSize;
  float i = floor(b);
  float f = fract(b);
  float cyc = mod(i, ${CYCLE_BANDS.toFixed(1)});
  float grp = mod(floor(i / ${CYCLE_BANDS.toFixed(1)}), 2.0);
  float tBase = ${CYCLE_BASE.toFixed(2)} + uPalShift + (uCentroid - 0.5) * uTint * 0.25 + grp * 0.5;
  float t = tBase + cyc / ${CYCLE_BANDS.toFixed(1)} * ${CYCLE_SPAN.toFixed(2)};
  vec3 col = palette(t, uPalA, uPalB, uPalC, uPalD);

  // Ink: the first band of every cycle goes dark, and every band boundary
  // gets a dark line, both antialiased on the band's own pixel footprint.
  vec3 dark = vec3(0.05, 0.04, 0.11);
  float navy = min(1.0, uInk * 1.5) * step(cyc, 0.5);
  float d = min(f, 1.0 - f);
  float lineHalf = 0.05 + 0.07 * uInk;
  float line = 1.0 - smoothstep(lineHalf - w, lineHalf + w, d);
  col = mix(col, dark, max(navy, line * min(1.0, uInk * 1.4)));

  // Sub-pixel bands would moiré: fade to this cycle's mid colour where they do.
  vec3 mid = palette(tBase + ${(CYCLE_SPAN * 0.5).toFixed(3)}, uPalA, uPalB, uPalC, uPalD) * 0.7;
  col = mix(col, mid, smoothstep(0.5, 1.2, w));

  outColor = vec4(col, 1.0);
}
`;

export const kaleidoscopeScene = createFullscreenScene("kaleidoscope", "Kaleidoscope", FRAG, {
  settings: SETTINGS,
  extraUniformDecls: `uniform float uFlowPos;\nuniform float uMorphPos;\nuniform float uPalShift;`,
  extraUniforms: (() => {
    let flowPos = 0;
    let morphPos = 0;
    let palShift = 0;
    let prevDropOnset = false;
    return (_frame, anim, getSetting) => {
      const flow = getSetting("flow");
      const pulse = getSetting("pulse");
      const flowRate = (FLOW_RATE_MIN + (FLOW_RATE_MAX - FLOW_RATE_MIN) * flow) * (1.0 + FLOW_BASS_GAIN * anim.low);
      flowPos += anim.dtSec * flowRate;
      // anim.onset, not frame.onset: the render cap can skip the tick the
      // feature fired on (see AnimFrame's doc and renderLatch.ts).
      if (anim.onset) flowPos += FLOW_BEAT_JOLT * pulse;
      const morphRate =
        (MORPH_RATE_MIN + (MORPH_RATE_MAX - MORPH_RATE_MIN) * getSetting("morph")) *
        (1.0 + MORPH_SECTION_GAIN * anim.sectionIntensity);
      morphPos += anim.dtSec * morphRate;
      const drop = anim.dropOnset && !prevDropOnset;
      prevDropOnset = anim.dropOnset;
      if (drop && pulse > 0) palShift += DROP_FLIP;
      return { uFlowPos: flowPos, uMorphPos: morphPos, uPalShift: palShift };
    };
  })(),
});
