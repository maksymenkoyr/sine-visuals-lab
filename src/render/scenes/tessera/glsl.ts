// Tessera's GLSL: the box lattice's vertex table (mirrors lattice.ts's
// latticeLayout/instanceRingSlot/sectorArg/lobeValue/sectorHue exactly, so a
// TS test pins what this draws), the pole-axis camera projection, a dim
// backdrop dots+rays background, and the bloom chain. See index.ts's file
// header for the measured picture and lattice.ts's header for the
// geometry's shape.
//
// One instanced draw, empty VAO, BOX_VERTS (48) vertices per instance: four
// open-tube wall quads standing on the sphere normal at each (ring, slot),
// plus four thin end-cap-strip faces at the open end only -- not a cosmetic
// add-on, see below -- plus one trailing pole instance. gl_VertexID decodes
// into (face 0..7, corner 0..5) with the same 6-vertex two-triangle layout
// ambience.ts's quadCorner uses; gl_InstanceID decodes into (ring, slot) or
// the pole by walking the uRingStart table uploaded from lattice.ts's
// latticeLayout -- round 2: a constant slot count per ring shrank boxes to
// slivers near the pole and left the outer rings sparse (the sin(theta)
// azimuthal-pitch factor); latticeLayout instead grows the slot count with
// radius so every ring's own azimuthal box pitch stays close to the fixed
// meridional pitch -- a dense, roughly isotropic field at any radius, the
// reference's own measured box density (swift-weaving-parnas.md).
//
// Why the end-cap strips exist (round 2 fix): a wall's own long face is a
// flat quad whose plane contains the box's length axis N, so a camera
// looking straight down N sees it exactly edge-on -- zero projected area.
// The pole-axis camera means most of the lattice points roughly *at* the
// camera in the near/starburst view, so that's not a rare case, it's the
// dominant one; without the end caps the near view's tubes would vanish
// into thin lines exactly where the reference shows the boldest "gates"
// (frames/look_4.jpg). Each end-cap strip's own normal points along the
// tube's own axis (dirSign*N), so it faces the near-view camera essentially
// head-on regardless of which ring/slot the box sits at -- it is the "bright
// rectangular outline" the near view is judged against, not merely a rim
// colour trick.

import {
  BALL_RADIUS,
  BOX_VERTS,
  END_RIM_FRACTION,
  INTERIOR_SHADE,
  LOBE_REST_MIN,
  LOBE_SHARPNESS,
  MAX_RINGS,
  POLE_HALF,
  POLE_LEN,
  RING_THETA_MAX,
  SHELL_RADIUS,
  SWIRL_SCALE,
  WALL_SHADE_AZIMUTH,
  WALL_SHADE_MERIDIAN,
} from "./lattice.ts";
import { PALETTE_GLSL } from "../../palette.ts";
import { NUM_BANDS } from "../../../audio/types.ts";

export { BOX_VERTS };

/** A ring reads uSmoothBands, not the common uBands -- see index.ts's
 *  BAND_SMOOTH_TAU comment: uBands (FeatureFrame.bands, sampleBands() in
 *  sceneCommon.ts) is per-frame-fresh, and its swing over even a real 16ms
 *  frame is large enough that Tessera's own length-from-band formula would
 *  move a box's whole visible length, not just flicker its tip -- so this
 *  scene keeps its own slower-smoothed copy instead. Same bilinear shape as
 *  SAMPLE_BANDS_GLSL, just reading the smoothed array. */
const SAMPLE_SMOOTH_BANDS_GLSL = `
uniform float uSmoothBands[${NUM_BANDS}];
float sampleSmoothBands(float x) {
  float fi = clamp(x, 0.0, 0.999) * float(${NUM_BANDS});
  int i0 = int(floor(fi));
  int i1 = int(min(float(i0 + 1), float(${NUM_BANDS} - 1)));
  return mix(uSmoothBands[i0], uSmoothBands[i1], fract(fi));
}`;

/** Rim weight at Rim=1 -- how far toward white the box edges push. */
export const RIM_MIX = 0.22;
/** Bucket rate (Hz) the per-frame length jitter re-rolls at -- fast enough
 *  that consecutive captured frames (even a headless screenshot pair well
 *  under 60fps) land in different buckets, which is the whole point of the
 *  motion-check screenshot (fringes at box ends only). */
export const JITTER_RATE_HZ = 40.0;
export const BLOOM_THRESHOLD = 0.45;
export const BLUR_STRIDE_X = 2.0;
export const BLUR_STRIDE_Y = 1.0;

const HASH_GLSL = `
float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float hashLattice(float i, float j, float k) {
  return fract(sin(i * 127.1 + j * 311.7 + k * 74.7 + 13.7) * 43758.5453);
}
`;

/** roomAspect() -- meshGrid.ts's CAMERA_GLSL formula verbatim, so Panorama
 *  slices stay correct instead of a naked drawingBuffer width/height ratio. */
const ROOM_ASPECT_GLSL = `
float roomAspect() {
  return (uResolution.x / max(uViewport.z, 0.0001)) / (uResolution.y / max(uViewport.w, 0.0001));
}
`;

const LATTICE_CONST_GLSL = `
#define PI 3.14159265359
#define BALL_RADIUS ${BALL_RADIUS.toFixed(3)}
#define SHELL_RADIUS ${SHELL_RADIUS.toFixed(3)}
#define END_RIM_FRACTION ${END_RIM_FRACTION.toFixed(3)}
#define INTERIOR_SHADE ${INTERIOR_SHADE.toFixed(3)}
#define WALL_SHADE_AZIMUTH ${WALL_SHADE_AZIMUTH.toFixed(3)}
#define WALL_SHADE_MERIDIAN ${WALL_SHADE_MERIDIAN.toFixed(3)}
#define POLE_HALF ${POLE_HALF.toFixed(4)}
#define POLE_LEN ${POLE_LEN.toFixed(4)}
#define RING_THETA_MAX ${RING_THETA_MAX.toFixed(4)}
#define JITTER_RATE ${JITTER_RATE_HZ.toFixed(1)}
#define MAX_RINGS ${MAX_RINGS}
#define SWIRL_SCALE ${SWIRL_SCALE.toFixed(2)}
#define LOBE_REST_MIN ${LOBE_REST_MIN.toFixed(3)}
#define LOBE_SHARPNESS ${LOBE_SHARPNESS.toFixed(2)}
`;

/** The dim background: sparse hash dots and four faint axis rays, held in
 *  the ball's own rotating frame (rotated by -uRoll before hashing) so they
 *  read as fixed against the spinning lattice rather than swimming past it
 *  -- the same trick shards.ts's star field uses with uRollBg. Covers the
 *  whole frame every tick (previewRenderer.ts: the gallery never clears). */
export function bgFrag(commonUniforms: string, settingsUniforms: string, roomUv: string): string {
  return `#version 300 es
precision highp float;
in vec2 vUv;
${commonUniforms}
${settingsUniforms}
${roomUv}
${HASH_GLSL}
${ROOM_ASPECT_GLSL}
${LATTICE_CONST_GLSL}
uniform float uRoll;
uniform float uBallScreenR;
out vec4 outColor;

void main() {
  vec2 r = roomUv(vUv);
  vec2 p = (r - 0.5) * vec2(roomAspect(), 1.0) * 2.0;
  float c = cos(-uRoll);
  float s = sin(-uRoll);
  p = mat2(c, -s, s, c) * p;
  float rad = length(p);
  float ang = atan(p.y, p.x);
  vec3 col = vec3(0.0);

  // Four faint axis rays, only in the gap just outside the ball's own edge.
  float m = mod(ang, PI * 0.5);
  float rayCloseness = 1.0 - smoothstep(0.0, 0.06, min(m, PI * 0.5 - m));
  float rGate = smoothstep(uBallScreenR * 1.02, uBallScreenR * 1.15, rad)
              * (1.0 - smoothstep(uBallScreenR * 3.2, uBallScreenR * 4.5, rad));
  col += vec3(0.55, 0.6, 0.7) * rayCloseness * rGate * 0.4;

  // Sparse hash dots, further out still.
  const float CELLS = 26.0;
  vec2 g = p * CELLS;
  vec2 id = floor(g);
  vec2 f = fract(g);
  float h = hash21(id + 11.3);
  float dotGate = smoothstep(uBallScreenR * 1.1, uBallScreenR * 1.4, rad);
  if (h < 0.05 && dotGate > 0.001) {
    vec2 sp = vec2(hash21(id + 3.3), hash21(id + 7.7));
    float d = length(f - sp);
    float b = 0.35 + 0.65 * hash21(id + 5.5);
    col += vec3(1.0) * b * (1.0 - smoothstep(0.05, 0.18, d)) * 0.55 * dotGate;
  }
  outColor = vec4(col, 1.0);
}
`;
}

/** The box lattice's vertex shader -- see the file header. */
export function boxVert(commonUniforms: string, settingsUniforms: string): string {
  return `#version 300 es
precision highp float;
${commonUniforms}
${settingsUniforms}
${HASH_GLSL}
${ROOM_ASPECT_GLSL}
${LATTICE_CONST_GLSL}
${PALETTE_GLSL}
${SAMPLE_SMOOTH_BANDS_GLSL}
uniform vec3 uCamPos;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamFwd;
uniform float uFocal;
uniform float uHueClock;
uniform float uShell;     // 0 = the ball, 1 = the dim backdrop shell
uniform float uShellVis;  // distance-based fade for the shell only
// The lattice layout (lattice.ts's latticeLayout), uploaded once per frame:
// ring i occupies instances [uRingStart[i], uRingStart[i+1]) with
// uRingSlots[i] slots; the trailing pole instance is uRingStart[uRingCount].
uniform float uRingStart[MAX_RINGS + 1];
uniform float uRingSlots[MAX_RINGS];
uniform float uRingCount;
flat out vec3 vColour;
flat out float vShade;
out float vAlong;    // 0 at the wall's base, 1 at its open end -- see END_RIM_FRACTION
flat out float vIsCap; // 1 on an end-cap-strip face (always the rim), 0 on a long wall face

void main() {
  int vid = gl_VertexID;
  int face = vid / 6;      // 0..3 long wall faces, 4..7 their end-cap strips
  int corner = vid - face * 6;
  bool isEndCap = face >= 4;
  int wall = isEndCap ? face - 4 : face;
  float cu = (corner == 1 || corner == 2 || corner == 4) ? 1.0 : 0.0;
  float cv = (corner == 2 || corner == 4 || corner == 5) ? 1.0 : -1.0;

  int inst = gl_InstanceID;
  int ringCount = clamp(int(uRingCount), 0, MAX_RINGS);
  bool isShell = uShell > 0.5;
  int ringTotal = ringCount > 0 ? int(uRingStart[ringCount]) : 0;
  bool isPole = !isShell && inst >= ringTotal;

  vec3 N, e1, e2;
  float halfWidthAz, halfDepthMer, baseR, boxLen;
  bool isAxis = false;
  float hueT = 0.0;

  if (isPole) {
    N = vec3(0.0, 1.0, 0.0);
    e1 = vec3(1.0, 0.0, 0.0);
    e2 = vec3(0.0, 0.0, 1.0);
    halfWidthAz = POLE_HALF;
    halfDepthMer = POLE_HALF;
    baseR = BALL_RADIUS;
    boxLen = POLE_LEN;
  } else {
    // Bounded loop over MAX_RINGS (GLSL ES 3.00 wants a constant loop
    // bound) with a runtime break -- finds the ring i whose own
    // [uRingStart[i], uRingStart[i+1]) span contains this instance.
    int ring = 0;
    int ringBase = 0;
    int slotCount = 1;
    for (int i = 0; i < MAX_RINGS; i++) {
      if (i >= ringCount) break;
      int startI = int(uRingStart[i]);
      int nextI = int(uRingStart[i + 1]);
      if (inst >= startI && inst < nextI) {
        ring = i;
        ringBase = startI;
        slotCount = int(uRingSlots[i]);
        break;
      }
    }
    int slot = inst - ringBase;
    // theta_k = k * pitch, k = ring+1 (lattice.ts's latticeLayout, 1-indexed
    // rings) -- uPitch is the Pitch setting's own uniform (settingsUniforms).
    float theta = float(ring + 1) * uPitch;
    float phi = (2.0 * PI * float(slot)) / float(slotCount);
    float st = sin(theta);
    float ct = cos(theta);
    float sp = sin(phi);
    float cp = cos(phi);
    N = vec3(st * cp, ct, st * sp);
    e1 = vec3(-sp, 0.0, cp);
    e2 = vec3(ct * cp, -st, ct * sp);

    baseR = isShell ? SHELL_RADIUS : BALL_RADIUS;
    // Constant ARC-LENGTH spacing (round 2): the azimuthal half-width comes
    // from this ring's OWN slot angle (2*pi*sin(theta)/slotCount, which
    // latticeLayout picked to sit close to pitch*SLOT_PITCH_RATIO already),
    // not a naive angular-only term -- that's what used to shrink boxes to
    // slivers near the pole. The meridional half-depth is just the fixed
    // Pitch itself, since rings sit at constant theta spacing by
    // construction.
    float slotAngle = 2.0 * PI * st / float(slotCount);
    halfWidthAz = 0.5 * uFill * slotAngle * baseR;
    halfDepthMer = 0.5 * uFill * uPitch * baseR;

    float ringFraction = clamp(theta / RING_THETA_MAX, 0.0, 0.999);
    float band = sampleSmoothBands(ringFraction);
    // Continuous in latitude (round 2): was swirl*ringIndex, a step
    // function of the old fixed ring spacing -- theta is what actually
    // varies smoothly here, so the twist has to ride it directly (see
    // lattice.ts's SWIRL_SCALE comment for why this constant, not swirl
    // alone, keeps the same per-ring twist size at the default Pitch).
    float A = uFold * phi + uSwirl * theta * SWIRL_SCALE;
    // Round 5's "petal shells" fix (lattice.ts's lobeValue/LOBE_REST_MIN
    // header): lobe01 is a clean 0..1 cosine, sharpened by LOBE_SHARPNESS so
    // each petal has a distinct tip and a real dark gap, not a shallow wave.
    // It drives BOTH the resting length (blended between LOBE_REST_MIN and
    // 1 of lenBase, so the dome is visibly 8 scalloped shells even in
    // silence) and the audio gain on top -- the reference shows no onset
    // flash, so the shape can't live only in the audio term.
    float lobeRaw = 0.5 + 0.5 * cos(A);
    float lobe01 = pow(max(lobeRaw, 0.0), LOBE_SHARPNESS);
    float jseed = floor(uTime * JITTER_RATE);
    float jit = hashLattice(float(ring), float(slot), jseed) - 0.5;
    float len = uLenBase * (LOBE_REST_MIN + (1.0 - LOBE_REST_MIN) * lobe01) + uLenAudio * band * lobe01 + jit * uJitter;

    float slotWidthAng = 2.0 * PI / float(slotCount);
    float m = mod(phi, PI * 0.5);
    isAxis = (m < slotWidthAng * 0.5) || (m > PI * 0.5 - slotWidthAng * 0.5);
    if (isAxis) len += uCrossGain * uLenBase;
    boxLen = max(len, 0.02 * BALL_RADIUS);

    float sector = floor(A / (2.0 * PI));
    hueT = mod(sector, 2.0) * 0.5;
  }

  vec3 normalDir, acrossDir;
  float offsetHalf, acrossHalf;
  if (wall == 0) { normalDir = e1; acrossDir = e2; offsetHalf = halfWidthAz; acrossHalf = halfDepthMer; }
  else if (wall == 1) { normalDir = -e1; acrossDir = e2; offsetHalf = halfWidthAz; acrossHalf = halfDepthMer; }
  else if (wall == 2) { normalDir = e2; acrossDir = e1; offsetHalf = halfDepthMer; acrossHalf = halfWidthAz; }
  else { normalDir = -e2; acrossDir = e1; offsetHalf = halfDepthMer; acrossHalf = halfWidthAz; }

  float dirSign = isShell ? -1.0 : 1.0;
  vec3 base = N * baseR;
  // A wall's own thickness (its end-cap-strip's radial reach), sized off the
  // tube's *smaller* cross-section dimension by the Wall setting -- round 5:
  // raised well past a hairline so the mouth reads as the reference's own
  // narrow dark SLIT down the middle of a bright bar, not a wide dark hole
  // in a thin frame. The pole box is the one exception: its own end-cap-
  // strips reach all the way to the centre (wallThick = offsetHalf), so its
  // four quadrants tile into one solid white cap instead of leaving the same
  // open bore a ring box's tiny scale would otherwise turn into a stray dark
  // fleck.
  float wallThick = isPole ? offsetHalf : uWall * (2.0 * min(halfWidthAz, halfDepthMer));

  vec3 world;
  if (isEndCap) {
    // A thin strip at the open end (u=1) only, spanning the wall's own
    // across extent and reaching wallThick inward from its outer surface --
    // see the file header for why this, not the long face, is what makes a
    // tube viewed near end-on read as a bright rectangular outline.
    float radialPos = offsetHalf - cu * wallThick;
    world = base + dirSign * N * boxLen + normalDir * radialPos + acrossDir * (cv * acrossHalf);
  } else {
    world = base + dirSign * N * (cu * boxLen) + normalDir * offsetHalf + acrossDir * (cv * acrossHalf);
  }

  // Facing test (round 3): a long wall is a flat quad, so which side the
  // camera sits on is a per-face constant -- outer (the normalDir side) is
  // this face's OWN OUTER surface and reads at its flat emissive shade;
  // inner reads at the dim interior floor. Evaluated at the wall's own base
  // point (any point on the wall's plane gives the same sign: offsetting
  // along the box's length axis N is orthogonal to normalDir by the tangent
  // frame's own construction, so it never flips the dot product's sign).
  // This is what gives each tube a bright pole-facing wall and a dark
  // inside without any angle-dependent (Lambert) falloff -- a continuous
  // angle-to-camera term is exactly what used to black out a grazing-angle
  // annulus in the near view.
  vec3 wallPoint = base + normalDir * offsetHalf;
  bool outer = dot(normalDir, uCamPos - wallPoint) > 0.0;
  float shade = isEndCap ? 1.0 : (outer ? (wall <= 1 ? WALL_SHADE_AZIMUTH : WALL_SHADE_MERIDIAN) : INTERIOR_SHADE);

  vec3 colour;
  if (isPole) {
    colour = vec3(1.0);
    shade = 1.0;
  } else {
    float irid = uIridescence * 0.12 * dot(normalDir, vec3(0.3, 0.85, 0.25));
    float t = uHueClock + hueT + irid;
    colour = max(palette(t, uPalA, uPalB, uPalC, uPalD), 0.0);
    // Pastel: pulled toward a light pearl (luminance ~0.8, not a mid grey --
    // the reference's own frame-mean saturation is measured over mostly-dark
    // ground, so the lit boxes themselves sit paler than that mean).
    vec3 pearl = vec3(0.90, 0.84, 0.66);
    colour = mix(colour, pearl, mix(0.25, 0.8, uPastel));
    if (isAxis) colour = mix(colour, vec3(1.0), 0.75);
  }
  if (isShell) shade *= uShellGain * uShellVis;

  vColour = colour;
  vShade = shade;
  vAlong = isEndCap ? 1.0 : cu;
  vIsCap = isEndCap ? 1.0 : 0.0;

  vec3 rel = world - uCamPos;
  vec3 view = vec3(dot(rel, uCamRight), dot(rel, uCamUp), dot(rel, uCamFwd));
  float aspect = roomAspect();
  float NEARZ = 0.08;
  // Far past anything the scene ever draws (SHELL_RADIUS is 2.6) -- with a
  // 16-bit depth renderbuffer that wasted most of its precision on empty
  // space no geometry ever reaches, and at high Fill values hundreds of
  // near-touching, near-coplanar tube walls a few hundredths of a unit apart
  // lose the z-fight, dropping out into a sparse, thin-looking result. A far
  // plane that actually bounds the geometry gives the same 16 bits far more
  // to work with.
  float FARZ = 8.0;
  // Tessera's Dolly deliberately brings the camera close to the ball
  // surface, and a loud passage's length reactivity can push a near-pole
  // box's tip close to or past that point. An unclamped view.z there divides
  // a near-camera vertex's x/y by something near (or through) zero, blowing
  // one triangle up into a huge, wrongly-wound quad that can win the depth
  // test across most of the frame (meshGrid.ts's toClip clamps the same way,
  // for the same reason).
  float clampedZ = max(view.z, NEARZ);
  float zc = (clampedZ * (FARZ + NEARZ) - 2.0 * FARZ * NEARZ) / (FARZ - NEARZ);
  gl_Position = vec4(view.x * uFocal / aspect, view.y * uFocal, zc, clampedZ);
}
`;
}

/** Flat colour times its lit factor, blended toward near-white over the last
 *  END_RIM_FRACTION of a wall's own length -- the open end's own lit rim --
 *  and forced fully white on the end-cap-strip faces (vIsCap), which *are*
 *  the tube's rim geometrically (see the file header). Rim's own slider
 *  scales how far into the wall that blend reaches, on top of the fixed
 *  END_RIM_FRACTION floor, so Rim=0 still shows the geometric cap. */
export function boxFrag(commonUniforms: string, settingsUniforms: string): string {
  return `#version 300 es
precision highp float;
flat in vec3 vColour;
flat in float vShade;
in float vAlong;
flat in float vIsCap;
${commonUniforms}
${settingsUniforms}
${LATTICE_CONST_GLSL}
out vec4 outColor;

void main() {
  float rimSpan = END_RIM_FRACTION * (1.0 + 2.0 * uRim);
  float endRim = smoothstep(1.0 - rimSpan, 1.0, vAlong);
  float rim = max(endRim, vIsCap);
  // Rim/white mixing must never light up a face's INTERIOR (back) side --
  // vIsCap is 1 for every end-cap fragment regardless of which side of it is
  // actually facing the camera, so without this gate every interior-facing
  // cap (the far side of a tube, or one seen from inside) got mixed toward
  // white anyway, giving even the darkest pixel a flat ~RIM_MIX floor.
  rim *= step(INTERIOR_SHADE + 0.05, vShade);
  vec3 col = vColour * vShade;
  col = mix(col, vec3(1.0), rim * ${RIM_MIX.toFixed(2)});
  outColor = vec4(col, 1.0);
}
`;
}

/** 9-tap separable Gaussian with a threshold on the first pass, same shape
 *  as shards'/powder's own local copy (no scene imports another scene's
 *  GLSL, per CLAUDE.md's independent-work rule). */
export const BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uBlurStep;
uniform float uThreshold;

vec3 tap(vec2 uv) {
  return max(texture(uTex, uv).rgb - uThreshold, 0.0);
}

void main() {
  vec3 c = tap(vUv) * 0.2270270;
  c += (tap(vUv + uBlurStep) + tap(vUv - uBlurStep)) * 0.1945946;
  c += (tap(vUv + uBlurStep * 2.0) + tap(vUv - uBlurStep * 2.0)) * 0.1216216;
  c += (tap(vUv + uBlurStep * 3.0) + tap(vUv - uBlurStep * 3.0)) * 0.0540541;
  c += (tap(vUv + uBlurStep * 4.0) + tap(vUv - uBlurStep * 4.0)) * 0.0162162;
  outColor = vec4(c, 1.0);
}
`;

/** Sharp frame plus its halo, tonemapped with 1-exp(-x) -- exactly 0 at
 *  input 0, so true black stays black (only the bright end compresses). */
export function compositeFrag(commonUniforms: string, settingsUniforms: string): string {
  return `#version 300 es
precision highp float;
in vec2 vUv;
${commonUniforms}
${settingsUniforms}
uniform sampler2D uSharpTex;
uniform sampler2D uBlurTex;
out vec4 outColor;

void main() {
  vec3 sharp = texture(uSharpTex, vUv).rgb;
  vec3 halo = texture(uBlurTex, vUv).rgb;
  vec3 col = sharp + halo * uGlow * 0.9;
  col = 1.0 - exp(-col * 1.15);
  outColor = vec4(col, 1.0);
}
`;
}
