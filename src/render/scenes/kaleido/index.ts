import { createFullscreenScene } from "../../fullscreenScene.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import type { SignalLink } from "../../signals.ts";
import { KALEIDO_COMMON_GLSL } from "./glsl.ts";
import { BURST_GLSL, HEX_STYLE, MANDALA_GLSL, PORTAL_GLSL, PRISM_GLSL, STYLE_NAMES } from "./styles.ts";

// A mirror-tiled lattice of mandalas in four styles (styles.ts): Mandala,
// nested hard-edged contour bands after the "Kaleidoscope Visuals" short
// IHRMKsTh0Sk; Portal, a disc of densely petalled annuli drifting out of
// the centre, after CPu8pZPClww; Prism, a three-mirror kaleidoscope of a
// warped, hard-posterised rainbow texture, after XDNSvjOIxQA; Burst, a
// rosette of crystal shards rushing out of a dark jagged star, after
// Lj4Ae4T3XP0. Style is the scene's variant (SceneSetting.variant): every
// other setting keeps its own value per style.
//
// How every style is framed: the plane is folded into cells (square, p4m;
// or for Prism a hexagonal lattice, p6m — HEX_STYLE), one mandala per cell,
// each cell into uSymmetry mirrored wedges, and the style paints a function
// of the radius and the folded angle. Mandala builds a scalar field F from a
// concentric ramp plus ring families and quantises it into flowing bands;
// the others sample noise in the folded wedge. The flow, morph, spin and
// zoom are phase offsets accumulated JS-side like caustics' drift; the beat
// is a damped surge (advanceBeatSurge below) that pushes Mandala's bands
// and kicks the other styles' zoom, plus a swell envelope on the radius and
// brightness.
//
// What the reference videos actually do with the music, measured (frame
// log-polar registration against librosa onsets, 15 fps): every one zooms
// in continuously — the Prism short at about half a log unit per second,
// Burst at a seventh of that — with a zoom kick on every beat in Prism, and
// brightness that tracks the loudness and pops per beat in all of them
// (the Portal short is silent). Hence the Zoom slider, the surge routed
// into the zoom, and glsl.ts's beatLift. The infinite zoom itself is
// styles.ts's business: each style dives in whatever coordinates make the
// dive exact for it.
//
// Why uSymmetry only takes even values, and why nothing may rotate near a
// cell edge: the picture depends on r and the mirror-folded angle only, so
// it's invariant under angle -> -angle and angle -> angle + 2pi/N. A
// neighbouring cell is the mirror image across the shared edge, which maps
// angle -> pi - angle; that's a symmetry iff pi is a multiple of 2pi/N, i.e.
// iff N is even. With N even the tiling is seamless for free. On the
// hexagonal lattice the neighbours sit at multiples of 60 degrees, so the
// edge reflections are the mirror lines at 30, 90 and 150 degrees, and the
// fold needs a multiple of six — main() snaps it. A rotation offset breaks
// all this (fold(pi - a + rot) != fold(a + rot) unless 2rot is a multiple of
// the sector), so every per-ring rotation is masked to zero before r
// reaches cell/2 — inside the inscribed circle nothing touches an edge. A
// twist shears along the *folded* angle, which is mirror-safe.
//
// Mandala's band footprint (for ink antialiasing and the moiré fade) comes
// from analytic dF/dr and dF/dangle carried alongside F, not from fwidth:
// across a mirror line the neighbouring pixel is the mirror image, so a
// screen-space derivative reads ~0 there and dotted every fold. The noise
// styles only need fwidth for an ink line, where that under-read costs a
// pixel of antialiasing, not a fade.

/** Viewport-height span of the centred coordinate system. */
const ZOOM = 2.3;
/** Cell size at Tiling = 0.5, and the per-slider-unit ratio around it. */
const CELL_MID = 1.8;
const CELL_SPAN = 2.8;
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
      "Mandala: nested contour bands. Portal: a disc of petalled rings pouring out of the centre. Prism: a hexagonal mirror kaleidoscope of a rainbow texture. Burst: crystal shards rushing out of a dark star. Every other setting remembers its own value per style",
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
    description: "How many mirrored wedges each mandala folds into — even counts only, so the tiles meet without a seam; Prism's hexagonal lattice rounds it to a multiple of six",
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
    label: "Tiling",
    description: "How large each mandala's cell is — small tiles many across the screen, large is a single mandala filling it",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    variantDefaults: { Portal: 0.85, Prism: 0.85, Burst: 0.85 },
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
    description: "How fast Mandala's bands and Portal's ground stream outward; bass pushes them faster",
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
      "How hard the picture dives into itself, forever — Portal, Prism and Burst zoom in at this rate; in Mandala the bands stream faster the further out they are, new ones born at the centre",
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

void main() {
  vec2 uv = roomUv(vUv);
  vec2 aspectFix = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 p = (uv - 0.5) * aspectFix * ${ZOOM.toFixed(2)};

  // Coordinates relative to the nearest mandala centre: square cells, or
  // the hexagonal lattice for the style that wants it (header).
  float cell = ${CELL_MID.toFixed(2)} * pow(${CELL_SPAN.toFixed(2)}, (uSpread - 0.5) * 2.0);
  int style = int(uStyle + 0.5);
  float n = max(2.0, floor(uSymmetry * 0.5 + 0.5) * 2.0);
  vec2 c;
  if (style == ${HEX_STYLE}) {
    c = hexCell(p, cell);
    n = max(6.0, floor(n / 6.0 + 0.5) * 6.0);
  } else {
    c = mod(p + cell * 0.5, cell) - cell * 0.5;
  }

  float r = length(c) * (1.0 - ${BEAT_SWELL.toFixed(3)} * uBeatSwell);
  float a = atan(c.y, c.x);
  // Pixel size in p units — p is linear in vUv, so fwidth on it is exact
  // and seam-free.
  float pxSize = max(fwidth(p.x), fwidth(p.y));
  float tBase0 = ${CYCLE_BASE.toFixed(2)} + uPalShift + (uCentroid - 0.5) * uTint * 0.25;

  vec3 col;
  if (style == 1) col = stylePortal(c, cell, r, a, n, pxSize, tBase0);
  else if (style == 2) col = stylePrism(c, cell, r, a, n, pxSize, tBase0);
  else if (style == 3) col = styleBurst(c, cell, r, a, n, pxSize, tBase0);
  else col = styleMandala(c, cell, r, a, n, pxSize, tBase0);
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
