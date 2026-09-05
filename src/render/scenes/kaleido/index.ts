import { createFullscreenScene } from "../../fullscreenScene.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import type { SignalLink } from "../../signals.ts";
import { KALEIDO_COMMON_GLSL } from "./glsl.ts";
import { BURST_GLSL, MANDALA_GLSL, PORTAL_GLSL, PRISM_GLSL, STYLE_NAMES } from "./styles.ts";

// A mirror-tiled lattice of mandalas in four styles (styles.ts): Mandala,
// nested hard-edged contour bands after the "Kaleidoscope Visuals" short
// IHRMKsTh0Sk; Portal, a disc of densely petalled annuli drifting out of
// the centre, after CPu8pZPClww; Prism, a three-mirror kaleidoscope of a
// warped, hard-posterised rainbow texture, after XDNSvjOIxQA; Burst, a
// rosette of crystal shards rushing out of a dark jagged star, after
// Lj4Ae4T3XP0. Style is the scene's variant (SceneSetting.variant): every
// other setting keeps its own value per style.
//
// How every style is framed: a mandala whose ring of petals is a ring of
// smaller mandalas, each a whole copy of it, children all the way down.
// main() finds, per pixel, the deepest mandala the pixel belongs to (a
// descent through the nearest child at each level, CHILD_RING and the
// child scale from Nesting) and hands that mandala's local coordinates —
// radius and the uSymmetry-fold mirrored angle, a cell of CELL_LOCAL so
// the disc is radius 1 — to the style, which paints one mandala's body.
// Mandala builds a scalar field F from a concentric ramp plus ring families
// and quantises it into flowing bands; the others sample noise in the
// folded wedge. Every style draws in cell-relative units (Mandala rescales
// r to CELL_MID; the others already work in r/cell).
//
// The infinite zoom is a dive into one child: the camera transform T_t
// (main()) is the continuous power of the similarity that maps the parent
// onto its top child — the fixed point of that similarity stays put on
// screen while the parent slides off and the child grows into its place —
// and because a child *is* the parent, the picture at the end of a cycle
// is the picture at its start one level deeper, and uZoomPos just keeps
// counting. The parent's own parent is drawn too (the root frame, one
// child transform up), so what surrounds the child at the end of a cycle
// is what surrounds the parent at the start.
//
// The flow, morph, spin and zoom are phase offsets accumulated JS-side
// like caustics' drift; the beat is a damped surge (advanceBeatSurge
// below) that pushes the material — Mandala's bands, the other styles'
// rings, stripes and shards, all of which ride uFlowPos, never the zoom,
// so the camera and the material don't double up — plus a swell envelope
// on the radius and brightness.
//
// What the reference videos actually do with the music, measured (frame
// log-polar registration against librosa onsets, 15 fps): every one zooms
// in continuously — the Prism short at about half a log unit per second,
// Burst at a seventh of that — with a zoom kick on every beat in Prism, and
// brightness that tracks the loudness and pops per beat in all of them
// (the Portal short is silent). Hence the Zoom slider and glsl.ts's
// beatLift; the beat surge pushes the flow (the material, not the camera),
// which reads as the kick without the lattice lurching.
//
// uSymmetry takes even values so a mandala mirrors across its own axes
// (petal centre lines and seams both land on mirror lines); the fold's
// history as a seamless-tiling rule is in git. Rotations are still masked
// to zero toward the disc edge (EDGE_MASK_INNER in styles.ts) so a mandala
// meets its parent's body with a steady rim, and a twist shears along the
// *folded* angle.
//
// Mandala's band footprint (for ink antialiasing and the moiré fade) comes
// from analytic dF/dr and dF/dangle carried alongside F, not from fwidth:
// across a mirror line the neighbouring pixel is the mirror image, so a
// screen-space derivative reads ~0 there and dotted every fold. The noise
// styles only need fwidth for an ink line, where that under-read costs a
// pixel of antialiasing, not a fade.

/** Viewport-height span of the centred coordinate system. */
const ZOOM = 2.3;
/** The cell a style is handed: the mandala's disc is radius 1 in its local
 *  frame, so the cell (whose half is the disc) is 2. */
const CELL_LOCAL = 2.0;
/** The recursion: children sit on a ring at this radius of the parent's
 *  disc; how many there are, from Symmetry (CHILDREN_MIN..CHILDREN_MAX);
 *  and the child scale, a fraction of the largest that keeps neighbours
 *  apart, from Nesting (CHILD_FILL_MIN..CHILD_FILL_MAX). Descent stops
 *  after CHILD_DEPTH levels or once a mandala is under CHILD_MIN_PX pixels
 *  across — its body is painted as if it had no children. Rim: the ink line
 *  a parent draws around each child, in the parent's units, and the palette
 *  step between nested levels (keyed on the absolute level, so a mandala
 *  keeps its hue as it grows into its parent's place). */
const CHILD_RING = 0.62;
const CHILDREN_MIN = 6;
const CHILDREN_MAX = 12;
const CHILD_FILL_MIN = 0.45;
const CHILD_FILL_MAX = 0.95;
const CHILD_DEPTH = 7;
const CHILD_MIN_PX = 6.0;
const CHILD_RIM = 0.012;
const LEVEL_HUE = 0.07;
/** Where a warm cycle starts in the palette — a touch above 0 so Neon's
 *  first band is a deep red rather than a pink. */
const CYCLE_BASE = 0.02;
/** Beat: how far the mandala swells (fraction of radius) at Beat surge = 1,
 *  on the swell envelope below. */
const BEAT_SWELL = 0.07;
/** Flow accumulator: bands per second at Outward flow = 0 and 1, and the
 *  extra factor a full bass level adds. Scales the rate, never the
 *  accumulated phase — see flowClock.ts for why the other way teleports. */
const FLOW_RATE_MIN = 0.2;
const FLOW_RATE_MAX = 3.0;
const FLOW_BASS_GAIN = 1.2;
/** Beat surge on the flow: a damped velocity impulse (caustics' lurch shape),
 *  not a phase jump — a jump moved every band a step in one frame, which read
 *  as the picture being redrawn rather than pushed. Total displacement per
 *  beat at Beat surge = 1 is SURGE_BANDS regardless of softness; the Surge
 *  ease slider sets how long the push lasts, from SURGE_TAU_SNAPPY to
 *  SURGE_TAU_SOFT seconds, and the swell's attack and release stretch with
 *  it (SWELL_*). The onset refractory is short enough that back-to-back
 *  fires could stack, so velocity is capped at a fixed 1.5 fires' worth of
 *  the snappiest impulse. */
const SURGE_BANDS = 0.6;
const SURGE_TAU_SNAPPY = 0.1;
const SURGE_TAU_SOFT = 0.6;
const SURGE_VEL_CAP = (SURGE_BANDS / SURGE_TAU_SNAPPY) * 1.5;
/** Swell envelope: the difference of two exponentials, so it rises from 0
 *  and releases instead of stepping to 1 on the beat tick the way beatPulse
 *  does. Attack and release times at Surge ease 0 and 1; the envelope is
 *  normalised to peak at 1 for any pair. */
const SWELL_ATTACK_SNAPPY = 0.02;
const SWELL_ATTACK_SOFT = 0.15;
const SWELL_RELEASE_SNAPPY = 0.18;
const SWELL_RELEASE_SOFT = 0.9;
const SWELL_STACK_CAP = 1.5;

/** The rates the surge runs at for a Surge ease value, and the swell peak
 *  they produce — log-interpolated so the slider feels even across its range. */
function surgeRates(ease: number) {
  const e = Math.min(1, Math.max(0, ease));
  const lerpLog = (a: number, b: number) => a * Math.pow(b / a, e);
  const tau = lerpLog(SURGE_TAU_SNAPPY, SURGE_TAU_SOFT);
  const ka = 1 / lerpLog(SWELL_ATTACK_SNAPPY, SWELL_ATTACK_SOFT);
  const kr = 1 / lerpLog(SWELL_RELEASE_SNAPPY, SWELL_RELEASE_SOFT);
  const tPeak = Math.log(ka / kr) / (ka - kr);
  const peak = Math.exp(-kr * tPeak) - Math.exp(-ka * tPeak);
  return { decay: 1 / tau, impulse: SURGE_BANDS / tau, ka, kr, peak };
}

export interface BeatSurgeState {
  /** Flow surge: velocity in bands/s and the displacement it has integrated. */
  vel: number;
  phase: number;
  /** Swell envelope's two exponentials (release minus attack). */
  rel: number;
  att: number;
}

export function createBeatSurgeState(): BeatSurgeState {
  return { vel: 0, phase: 0, rel: 0, att: 0 };
}

/** Advances the surge and swell in place; `fired` is the render-latched beat
 *  edge, `amount` the Beat surge slider, `ease` the Surge ease slider (0 =
 *  snappy, 1 = soft). Returns the swell envelope, 0..~1. Pure, exported for
 *  tests/kaleidoscope.test.ts. */
export function advanceBeatSurge(st: BeatSurgeState, dtSec: number, fired: boolean, amount: number, ease = 0.5): number {
  const k = surgeRates(ease);
  if (fired) {
    st.vel = Math.min(st.vel + amount * k.impulse, SURGE_VEL_CAP);
    st.rel = Math.min(st.rel + amount, SWELL_STACK_CAP);
    st.att = Math.min(st.att + amount, SWELL_STACK_CAP);
  }
  st.phase += st.vel * dtSec;
  st.vel *= Math.exp(-dtSec * k.decay);
  st.rel *= Math.exp(-dtSec * k.kr);
  st.att *= Math.exp(-dtSec * k.ka);
  return Math.max(0, st.rel - st.att) / k.peak;
}

/** Morph accumulator: radians per second at Shape drift = 0 and 1, the extra
 *  factor a loud section adds, and how much the beat swell leans on it so the
 *  petal shape ducks on a hit and recovers. */
const MORPH_RATE_MIN = 0.1;
const MORPH_RATE_MAX = 1.0;
const MORPH_SECTION_GAIN = 0.6;
const MORPH_SWELL_GAIN = 0.35;
/** Spin accumulator: units per second at Spin = 0 and 1 (styles.ts turns a
 *  unit into radians per family), and the extra factor the mids add. */
const SPIN_RATE_MIN = 0.0;
const SPIN_RATE_MAX = 0.6;
const SPIN_MID_GAIN = 0.5;
/** Palette offset a section drop adds — half a palette, so warm rings turn
 *  cool and vice versa. Accumulates: each drop flips again. */
const DROP_FLIP = 0.5;
/** Zoom accumulator: octaves per second at Zoom = 1 (the Prism reference
 *  dives at about 0.7), and the extra factor a loud section adds. */
const ZOOM_RATE_MAX = 1.2;
const ZOOM_SECTION_GAIN = 0.4;

const SETTINGS: SceneSetting[] = [
  {
    key: "style",
    label: "Style",
    description:
      "Mandala: nested contour bands. Portal: a disc of petalled rings pouring out of the centre. Prism: a mirror kaleidoscope of a rainbow texture. Burst: crystal shards rushing out of a dark star. Every other setting remembers its own value per style",
    group: "Form",
    type: "enum",
    options: STYLE_NAMES,
    min: 0,
    max: STYLE_NAMES.length - 1,
    step: 1,
    default: 0,
    variant: true,
  },
  {
    key: "symmetry",
    label: "Symmetry",
    description: "How many mirrored wedges each mandala folds into, and with it how many child mandalas sit on its ring",
    group: "Form",
    min: 6,
    max: 32,
    step: 2,
    default: 20,
    variantDefaults: { Portal: 16, Prism: 6, Burst: 8 },
    // Framing geometry the user picks to taste, same reasoning as caustics'
    // Caustic density — not something the music profile should redecide.
  },
  {
    key: "spread",
    label: "Nesting",
    description: "How big the child mandalas on each ring are — small beads at the low end, nearly touching at the high end; each is a whole copy of its parent, and the dive goes into one of them",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
  },
  {
    key: "rings",
    label: "Ring density",
    description: "How finely the picture is banded — fewer, fatter bands, rings or colour steps low; a fine lace high",
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
    description: "How much the spectrum shapes the rings — bass lengthens the inner petals, treble the outer ones; in the texture styles it drives the contrast",
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
    description: "How far a sustained bass level stretches the centre flower, warps the texture, or grows the core",
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
    description: "How fast the petals wander between round lobes, zigzag stars and pointed drops, and the textures churn",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    auto: { tempo: 0.2, dynamics: 0.2 },
  },
  {
    key: "flow",
    label: "Flow",
    description: "How fast the bands, rings, stripes or shards stream out of every centre; bass pushes them faster",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { tempo: 0.3, loudness: 0.2 },
  },
  {
    key: "zoom",
    label: "Zoom",
    description:
      "How fast the camera dives into the top child mandala — it grows into its parent's place, its own children grow into its rings, and so on forever",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.25,
    variantDefaults: { Portal: 0.25, Prism: 0.6, Burst: 0.4 },
    auto: { tempo: 0.2, loudness: 0.15 },
  },
  {
    key: "pulse",
    label: "Beat surge",
    description: "Each beat swells the mandala, pushes the bands along or kicks the zoom, and lifts the brightness; a section drop flips every ring between warm and cool",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { pulse: 0.3, attack: 0.2 },
    reads: ["feature.onset", "anim.dropOnset"] satisfies readonly SignalLink[],
  },
  {
    key: "ease",
    label: "Surge ease",
    description: "How soft each beat's push and swell are — a quick snap at the low end, a long roll at the high end; the distance travelled per beat stays the same",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    // Soft swells suit soft music; sharp hits suit a snap.
    auto: { attack: -0.3 },
  },
  {
    key: "spin",
    label: "Spin",
    description: "How fast alternate rings counter-rotate inside each cell; the mids speed it up",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
    auto: { tempo: 0.2 },
  },
  {
    key: "breathe",
    label: "Bar breathe",
    description: "Once per bar, while the tempo is locked, Mandala's petals split in two and rejoin and the other styles' zoom rocks forward and back",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { pulse: 0.3 },
  },
  {
    key: "twist",
    label: "Twist",
    description: "Shears the bands or texture across each wedge into chevrons and spirals",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.25,
    // Framing, like Symmetry — a look the user picks.
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
    variantDefaults: { Prism: 0.15, Burst: 0.3 },
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

const FRAG = `
${KALEIDO_COMMON_GLSL}
${MANDALA_GLSL}
${PORTAL_GLSL}
${PRISM_GLSL}
${BURST_GLSL}

vec3 styleAt(int style, vec2 c, float cell, float n, float pxSize, float tBase) {
  float r = length(c) * (1.0 - ${BEAT_SWELL.toFixed(3)} * uBeatSwell);
  float a = atan(c.y, c.x);
  if (style == 1) return stylePortal(c, cell, r, a, n, pxSize, tBase);
  if (style == 2) return stylePrism(c, cell, r, a, n, pxSize, tBase);
  if (style == 3) return styleBurst(c, cell, r, a, n, pxSize, tBase);
  return styleMandala(c, cell, r, a, n, pxSize, tBase);
}

vec2 rot2(vec2 v, float t) {
  float cs = cos(t);
  float sn = sin(t);
  return vec2(cs * v.x - sn * v.y, sn * v.x + cs * v.y);
}

void main() {
  vec2 uv = roomUv(vUv);
  vec2 aspectFix = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 q = (uv - 0.5) * aspectFix * ${ZOOM.toFixed(2)};
  // Pixel size in screen units — q is linear in vUv, so fwidth on it is
  // exact.
  float pxScreen = max(fwidth(q.x), fwidth(q.y));
  float tBase0 = ${CYCLE_BASE.toFixed(2)} + uPalShift + (uCentroid - 0.5) * uTint * 0.25;
  int style = int(uStyle + 0.5);
  float n = max(2.0, floor(uSymmetry * 0.5 + 0.5) * 2.0);

  // The recursion's shape (header): M children on a ring, the top one the
  // dive target, each child's frame turned to point outward.
  float m = clamp(floor(n * 0.5 + 0.5), ${CHILDREN_MIN.toFixed(1)}, ${CHILDREN_MAX.toFixed(1)});
  float sector = TWO_PI / m;
  float sMax = ${CHILD_RING.toFixed(3)} * sin(sector * 0.5);
  float s = sMax * mix(${CHILD_FILL_MIN.toFixed(2)}, ${CHILD_FILL_MAX.toFixed(2)}, uSpread);
  vec2 cTop = vec2(0.0, ${CHILD_RING.toFixed(3)});

  // The camera: t in [0,1) through the cycle, the similarity parent -> top
  // child raised to the power t, about its fixed point f. At t = 1 the
  // screen frame is the child's frame exactly, which is the start of the
  // next cycle one level down.
  float cycle = log2(1.0 / s);
  float turns = floor(uZoomPos / cycle);
  float t = (uZoomPos - turns * cycle) / cycle;
  vec2 f = cTop / (1.0 - s);
  float st = pow(s, t);
  vec2 pWorld = f + st * (q - f);
  // The root frame is the parent's parent: the parent is the root's top
  // child, so what surrounds the parent is drawn too.
  vec2 pp = cTop + s * pWorld;
  float px = pxScreen * st * s;
  float depth = -1.0;

  // Descend: at each level, is the point inside the nearest child's disc?
  // Then the point belongs to that child (or something deeper).
  float rimD = 1e9;
  for (int d = 0; d < ${CHILD_DEPTH}; d++) {
    rimD = 1e9;
    float r = length(pp);
    if (r > 1.0) break;
    float ang = atan(pp.y, pp.x) - PI * 0.5;
    float k = floor(ang / sector + 0.5);
    float thk = PI * 0.5 + k * sector;
    vec2 ck = ${CHILD_RING.toFixed(3)} * vec2(cos(thk), sin(thk));
    vec2 dlt = pp - ck;
    float dist = length(dlt);
    if (dist > s) { rimD = dist - s; break; }
    if (px / s > 1.0 / ${CHILD_MIN_PX.toFixed(1)}) break;
    pp = rot2(dlt, -k * sector) / s;
    px /= s;
    depth += 1.0;
  }

  // Paint this mandala's body in its own frame.
  vec2 c = pp * ${(CELL_LOCAL * 0.5).toFixed(1)};
  float tBase = tBase0 + (turns + depth) * ${LEVEL_HUE.toFixed(3)};
  vec3 col = styleAt(style, c, ${CELL_LOCAL.toFixed(1)}, n, px * ${(CELL_LOCAL * 0.5).toFixed(1)}, tBase);
  // The parent's ink rim around each child, and each mandala's own rim at
  // its disc edge — what makes a child read as set into its parent.
  float rimW = ${CHILD_RIM.toFixed(3)};
  float rimOut = 1.0 - smoothstep(rimW - px, rimW + px, rimD);
  float rimIn = 1.0 - smoothstep(rimW - px, rimW + px, abs(length(pp) - 1.0));
  col = mix(col, INK, max(rimOut, rimIn) * min(1.0, uInk * 1.2));
  outColor = vec4(col, 1.0);
}
`;

export const kaleidoscopeScene = createFullscreenScene("kaleidoscope", "Kaleidoscope", FRAG, {
  settings: SETTINGS,
  extraUniformDecls: `uniform float uFlowPos;\nuniform float uMorphPos;\nuniform float uSpinPos;\nuniform float uZoomPos;\nuniform float uSurgePos;\nuniform float uPalShift;\nuniform float uBeatSwell;`,
  extraUniforms: (() => {
    let flowPos = 0;
    let morphPos = 0;
    let spinPos = 0;
    let zoomPos = 0;
    let palShift = 0;
    let prevDropOnset = false;
    const surge = createBeatSurgeState();
    return (_frame, anim, getSetting) => {
      const flow = getSetting("flow");
      const pulse = getSetting("pulse");
      const flowRate = (FLOW_RATE_MIN + (FLOW_RATE_MAX - FLOW_RATE_MIN) * flow) * (1.0 + FLOW_BASS_GAIN * anim.low);
      flowPos += anim.dtSec * flowRate;
      // anim.onset, not frame.onset: the render cap can skip the tick the
      // feature fired on (see AnimFrame's doc and renderLatch.ts).
      const swell = advanceBeatSurge(surge, anim.dtSec, anim.onset, pulse, getSetting("ease"));
      const morphRate =
        (MORPH_RATE_MIN + (MORPH_RATE_MAX - MORPH_RATE_MIN) * getSetting("morph")) *
        (1.0 + MORPH_SECTION_GAIN * anim.sectionIntensity + MORPH_SWELL_GAIN * swell);
      morphPos += anim.dtSec * morphRate;
      const spinRate = (SPIN_RATE_MIN + (SPIN_RATE_MAX - SPIN_RATE_MIN) * getSetting("spin")) * (1.0 + SPIN_MID_GAIN * anim.mid);
      spinPos += anim.dtSec * spinRate;
      const zoomRate = ZOOM_RATE_MAX * getSetting("zoom") * (1.0 + ZOOM_SECTION_GAIN * anim.sectionIntensity);
      zoomPos += anim.dtSec * zoomRate;
      const drop = anim.dropOnset && !prevDropOnset;
      prevDropOnset = anim.dropOnset;
      if (drop && pulse > 0) palShift += DROP_FLIP;
      return {
        uFlowPos: flowPos,
        uMorphPos: morphPos,
        uSpinPos: spinPos,
        uZoomPos: zoomPos,
        uSurgePos: surge.phase,
        uPalShift: palShift,
        uBeatSwell: swell,
      };
    };
  })(),
});
