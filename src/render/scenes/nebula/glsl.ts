/**
 * Nebula's three fragment bodies: GAS_BODY marches through the gas volume
 * volume.ts bakes, into a smaller offscreen target; RESOLVE_BODY folds each
 * frame's march into a history twice as tall (history.ts); OUT_BODY scales
 * the history up to the screen. index.ts wraps all three in the common
 * uniform header, runs them in that order, and draws stars.ts's points over
 * the result.
 *
 * Why it looks like the reference: the gas glows only in a band around one
 * density level, its edge, and hardly at all inside. A ray that grazes a
 * mass runs along that band for a long way and a ray that meets it head-on
 * crosses it at once, so every silhouette lights up as a rim and the inside
 * stays a dim violet, with the edge's own folds showing through as fine
 * filaments. The band's colour runs with depth into the gas: dark red dust
 * outside, then orange, white-hot at the edge, blue just inside and violet
 * within. That is the order the reference's rims show from void inward
 * (docs/scenes/nebula.md, Measurements); it is not a lens split, whose
 * channel offset measured zero there.
 *
 * The density, per sample: the R channel at the sample, bent by the warp
 * channels (B, A) and read with a longer repeat along the flight than
 * across it (flight.ts's PERIOD_Z), so the gas streams toward the vanishing
 * point the way the reference's wisps lie; plus a finer read of the volume
 * for detail; plus, near the edge, the fine detail: the detail channel read
 * twice more at much finer scales through the volume's mip chain, the level
 * picked from a history pixel's footprint, so the edges crinkle down to a
 * few pixels as the reference's do and stay calm far off; minus a tunnel of
 * open space around the camera's path (flight.ts), so the camera flies
 * through the voids and the gas passes around it.
 *
 * The band is far thinner than a step, so each step integrates it (erf of
 * the density at both ends, taken as linear in between) rather than
 * sampling it; point samples lit whichever folds a step landed on and drew
 * wood-grain contours. With that, steps can stay long, and they are longest
 * where the density is far from the edge. The same integral lights the
 * shells inside the edge and the veins of the finer read: thin sheets that
 * show as lines where the ray runs along them.
 *
 * Long steps over a thin band still land differently from pixel to pixel,
 * worst where a ray grazes an edge, and the fine detail adds to that: one
 * frame's gas is grainy, and stretched to a Retina screen the grain read as
 * beads along every rim. So the march starts each pixel at a new offset
 * every frame and RESOLVE_BODY averages the frames, each moved to where the
 * last camera saw it by the depth its light came from.
 *
 * The gas target holds the gas already tone-mapped (1 - e^-x), and in alpha
 * the depth where the gas turns opaque, which stars.ts reads to hide the
 * stars behind it; its second attachment holds that light-weighted depth.
 *
 * Four music reactions ride on the march (reactions.ts holds their state): Inner light scales the
 * shells, veins and fill; Drop shock's front, a sphere around uShockAt, swells the gas it crosses
 * and multiplies the light of the rims, shells and veins there, and the gas behind it burns on as
 * embers; Colour tilt adds to the hue turn. Twinkle is in stars.ts.
 *
 * Every TS number that reaches the shader goes through `.toFixed()`, so
 * GLSL never sees an int where it wants a float. Nothing that grows with
 * the session reaches a noise coordinate (flight.ts's header).
 */

import { PATH_R, PATH_X, PATH_Y, PERIOD, PERIOD_Z, type PathSine } from "./flight.ts";
import { VOLUME_SIZE } from "./volume.ts";

/** Compile-time cap on march steps; the live count is uMaxSteps (quality.ts). */
const MAX_STEPS = 96;
/** Tangent of half the vertical field of view. */
export const FOV_TAN = 0.62;
/** How far the march reaches, in world units. */
export const T_MAX = 9.0;
/** Step bounds in world units; the shortest grows with distance, where detail is smaller on screen. */
const DT_MIN = 0.07;
const DT_MAX = 0.4;
/** World units of step per unit of density below or above the edge. */
const STEP_K = 1.0;
/** The gas's edge band: one band width, in density units. */
const BAND = 0.010;
/** The band's glows (dust, fringe, white-hot core, blue), in band widths from the edge: centres, widths, and gains. */
const BAND_C = [-1.7, -0.75, -0.15, 0.45];
const BAND_S = [0.8, 0.3, 0.35, 0.4];
const BAND_GAIN = [0.45, 1.4, 2.0, 2.2];
/** Edge emphasis: the band's light is scaled by how slowly the ray crosses it (band widths per
 *  world unit), within these bounds, so a grazing pass outshines a head-on one by more than its
 *  path length alone would give. The reference's rims stand far brighter over its bodies than
 *  limb brightening of a smooth shell manages. */
const EDGE_RATE = 3.0;
const EDGE_MIN = 0.25;
const EDGE_MAX = 2.0;
/** The dim violet inside the edge, and how many times brighter it glows where the edge burns hot:
 *  the reference's big luminous lobes. */
const FILL_GAIN = 0.05;
const FILL_HOT = 2.5;
/** Shells inside the edge, at these densities above it: seen edge-on through the gas, they are the fine veins inside the reference's masses. */
const SHELL_OFF = [0.05, 0.1, 0.16, 0.23];
const SHELL_GAIN = [0.25, 0.2, 0.14, 0.1];
/** A shell's width, in density units. */
const SHELL_W = 0.005;
/** The fibres: the gas channel (R) read at the detail's scale, which comes free with the detail
 *  fetch. How much it wrinkles the edge, and its veins' half-width and gain: the veins are its zero
 *  sheets inside the gas, integrated over each step like the edge band. */
const WRINKLE = 0.03;
const VEIN_W = 0.02;
const VEIN_GAIN = 0.45;
/** The march's erf inputs are clamped to ±ERF_CLAMP; past these e values (band widths from the edge)
 *  every band or shell input sits on that clamp. VOID_E must stay below -1, where fill, absorption
 *  and the veins are zero too, for skipping a void step to stay exact. */
const ERF_CLAMP = 4;
const VOID_E = Math.min(...BAND_C.map((c, k) => c - ERF_CLAMP * BAND_S[k]));
const BAND_TOP_E = Math.max(...BAND_C.map((c, k) => c + ERF_CLAMP * BAND_S[k]));
const SHELL_LOW_E = Math.min(...SHELL_OFF.map((o) => (o - ERF_CLAMP * SHELL_W) / BAND));
const SHELL_TOP_E = Math.max(...SHELL_OFF.map((o) => (o + ERF_CLAMP * SHELL_W) / BAND));
/** How much of the tone map keeps each colour's hue (the rest bleaches toward white per channel). */
const KEEP_HUE = 0.85;
/** How far the warp bends the gas, in world units. */
const WARP = 1.1;
/** How many times the detail channel repeats per period across the flight and along it (whole
 *  numbers, or the camera's wrap would show): fewer along it stretches the detail into fibres. */
const DETAIL_XY = 3;
const DETAIL_Z = 2;
/** The detail's weight in the density. */
const DETAIL_AMP = 0.07;
/** The fine detail: the detail channel read twice more at finer scales, each through a whole-number
 *  matrix from the position in periods to texture repeats (rows: across x, across y, along z). The
 *  off-diagonal terms turn each lattice off the axes and the others' without breaking a repeat.
 *  Along the flight they repeat several times less often than across it, so they lie as fibres
 *  along the rays, which the march's long steps can follow; isotropic, they turned to grain. */
const FINE_A = [
  [8, 4, 0],
  [-4, 8, 0],
  [0, 0, 12],
];
const FINE_B = [
  [39, -26, 0],
  [26, 39, 0],
  [3, 0, 40],
];
/** The fine detail's weight in the density, and the finer read's share of it. */
const FINE_AMP = 0.028;
const FINE_B_GAIN = 0.7;
/** How much of the fine detail the inner shells see: all of it crazed the bodies with bright lines. */
const SHELL_FINE = 0.3;
/** The most the fine detail moves the density: below the edge by more than this plus the void's
 *  reach, the detail can't light the step, so it isn't read. */
const FINE_MAX = FINE_AMP * 0.5 * (1 + FINE_B_GAIN);
/** The tunnel: its radius at rest (world units), how far it lowers the density at its axis, and
 *  the distances ahead (world units) over which it fades to half: the gas far down the flight stays,
 *  so the vanishing point holds small distant clouds as the reference's does. */
const TUNNEL_R = 1.0;
const TUNNEL_DEPTH = 0.16;
const TUNNEL_NEAR = 1.5;
const TUNNEL_FAR = 4.5;
/** Light per world unit of ray in the band, before exposure. */
const EMIT = 3.2;
/** How much light the gas inside the edge blocks per world unit. */
const ABSORB = 0.6;
/** Transmittance below which the gas hides the stars behind it. */
export const OCCLUDE = 0.3;
/** How many times brighter the white-hot core burns on a full hit at Flare 1. */
const FLARE_GAIN = 1.6;
/** How much brighter the whole cloud gets at full drive at Glow 1. */
const GLOW_GAIN = 0.35;
const EXPOSURE = 1.25;
/** Glare: the two mip levels blurred into it, the brightness it starts above, and its strength. */
const BLOOM_LODS = [2, 3.5];
const BLOOM_FLOOR = 0.18;
const BLOOM_GAIN = 0.8;
/** Unsharp amount after the cubic scale-up, against four reads of the history `SHARP_R` history
 *  pixels off diagonally. Compared at Retina size (docs/scenes/nebula.md, 2026-11-07): less left the
 *  crinkles soft, more turned them crunchy. */
const SHARPEN = 0.5;
const SHARP_R = 1.5;
/** Inner light: how many times brighter the shells and veins glow, and the dim fill, at full drive at
 *  Inner light 1. Most of it goes to the veins: lifting the fill as much turned the bodies milky in
 *  the prototype (docs/scenes/nebula.md, 2026-10-30). */
const INNER_GAIN = 4.5;
const INNER_FILL = 1.2;
/** Drop shock's front: its half-width (world units), how far it swells the gas (density units), how
 *  many times brighter the rims, shells and veins it crosses burn, and the light it gives the body. */
const SHOCK_W = 0.22;
const SHOCK_SWELL = 0.02;
const SHOCK_GAIN = 6.0;
const SHOCK_BODY = 0.3;
/** Behind the front the gas keeps burning, cooling from white through orange to deep red over
 *  IGNITE_LEN world units: its gain on the rims and on the body. */
const IGNITE_LEN = 4.0;
const IGNITE_RIM = 2.5;
const IGNITE_FILL = 0.6;
/** Colour tilt: degrees of hue at a full lean at Colour tilt 1. */
const TILT_DEG = 42;

const f = (x: number, d = 4) => x.toFixed(d);
// Built from rows, for `p * M`: GLSL takes a matrix's columns, and a row vector times it dots each one.
const rowsGlsl = (m: number[][]) => `mat3(${m.map((r) => `vec3(${r.map((v) => f(v, 1)).join(", ")})`).join(", ")})`;
const texelsPerUnit = (m: number[][]) => (Math.hypot(m[0][0], m[0][1]) * VOLUME_SIZE) / PERIOD;

// Each sine's phase at the camera comes in uPath (flight.ts's pathUniforms); the shader adds its own advance over dz.
function pathGlsl(name: string, sines: readonly PathSine[], phases: string[]): string {
  const terms = sines
    .map((s, k) => `${f(s.amp)} * sin(${phases[k]} + ${f((Math.PI * 2) / s.wavelength, 5)} * dz)`)
    .join(" + ");
  return `float ${name}(float dz) { return ${terms}; }`;
}

/** Uniforms both passes read, beyond the common header and the settings. */
export const EXTRA_UNIFORMS = `
uniform highp sampler3D uVol;
uniform sampler2D uGasTex;
uniform vec4 uCam[4];
uniform vec4 uPath[2];
uniform float uHueDrift;
uniform vec3 uChurn;
uniform vec4 uShockAt;
uniform float uShockAmp;
uniform float uIgnite;
uniform float uInnerLevel;
uniform float uTiltLean;
uniform sampler2D uAuxTex;
uniform sampler2D uHistTex;
uniform vec2 uJitter;
uniform float uFrameNoise;
uniform float uPixel;
uniform vec4 uPrevCam[4];
uniform float uHistOk;
`;

const VIEW_RAY = `
// The ray through uv: uCam is flight.ts's cameraUniforms (position, right, up, forward).
vec3 viewRay(vec2 uv, out vec2 p) {
  p = roomUv(uv) - 0.5;
  p.x *= uResolution.x / uResolution.y;
  return normalize(uCam[3].xyz + (p.x * uCam[1].xyz + p.y * uCam[2].xyz) * ${f(2 * FOV_TAN)});
}
`;

export const GAS_BODY = `
const vec3 GROUND = vec3(0.085, 0.045, 0.130);
const vec3 DUST = vec3(0.20, 0.06, 0.32);
const vec3 FRINGE = vec3(1.00, 0.38, 0.20);
const vec3 ROSE = vec3(1.00, 0.25, 0.50);
const vec3 WARM = vec3(1.00, 0.92, 0.85);
const vec3 HOT = vec3(0.75, 0.85, 1.00);
const vec3 BLUE = vec3(0.22, 0.34, 1.00);
const vec3 SHOCK_WHITE = vec3(0.95, 0.90, 1.00);
const vec3 EMBER = vec3(0.55, 0.06, 0.12);
// The gas's own colour drifts across space between these three, as the reference's does.
const vec3 BODY_BLUE = vec3(0.16, 0.16, 0.90);
const vec3 BODY_VIOLET = vec3(0.31, 0.11, 0.82);
const vec3 BODY_MAGENTA = vec3(0.62, 0.14, 0.78);

// The edge band's four glows over e (density from the edge, in band widths):
// dust, fringe, white-hot core, blue. Centres and widths.
const vec4 BAND_C = vec4(${BAND_C.map((v) => f(v)).join(", ")});
const vec4 BAND_S = vec4(${BAND_S.map((v) => f(v)).join(", ")});
const vec4 SHELL_OFF = vec4(${SHELL_OFF.map((v) => f(v)).join(", ")});
const vec4 SHELL_GAIN = vec4(${SHELL_GAIN.map((v) => f(v)).join(", ")});
const vec3 VEIN = vec3(0.48, 0.55, 1.00);
// World to volume texture: one repeat per period, so the gas is stretched along the flight.
const vec3 BASE_SCALE = vec3(${f(1 / PERIOD, 6)}, ${f(1 / PERIOD, 6)}, ${f(1 / PERIOD_Z, 6)});
const vec3 DETAIL_SCALE = vec3(${f(DETAIL_XY / PERIOD, 6)}, ${f(DETAIL_XY / PERIOD, 6)}, ${f(DETAIL_Z / PERIOD_Z, 6)});
const mat3 FINE_A = ${rowsGlsl(FINE_A)};
const mat3 FINE_B = ${rowsGlsl(FINE_B)};

${pathGlsl("pathX", PATH_X, ["uPath[0].x", "uPath[0].y"])}
${pathGlsl("pathY", PATH_Y, ["uPath[0].z", "uPath[0].w"])}
${pathGlsl("pathR", PATH_R, ["uPath[1].x", "uPath[1].y"])}
${VIEW_RAY}

// erf, near enough for a glow (tanh form, error under 1e-3). tanh is spelled out through exp because
// Metal's built-in tanh cost a quarter of the march (gpu-bench, docs/scenes/nebula.md).
vec4 erfA(vec4 x) { return 1.0 - 2.0 / (exp(2.0 * (1.1283792 * x + 0.1009 * x * x * x)) + 1.0); }
float erfA(float x) { return 1.0 - 2.0 / (exp(2.0 * (1.1283792 * x + 0.1009 * x * x * x)) + 1.0); }

vec3 bodyColour(float w) {
  return mix(mix(BODY_BLUE, BODY_VIOLET, smoothstep(0.48, 0.54, w)), BODY_MAGENTA, smoothstep(0.57, 0.64, w));
}

vec3 hueTurn(vec3 c, float deg) {
  float a = radians(deg);
  vec3 k = vec3(0.57735);
  return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
}

void main() {
  vec2 p;
  vec3 dir = viewRay(vUv + uJitter / uResolution, p);
  vec3 cam = uCam[0].xyz;
  vec2 here = vec2(pathX(0.0), pathY(0.0));

  float th = mix(0.69, 0.55, uGas);
  float hot = 1.0 + ${f(FLARE_GAIN)} * uFlare * flareDrive(uKickPulse);
  float bright = uGlow * (1.0 + ${f(GLOW_GAIN)} * glowDrive(uEnergy));
  float innerLit = uInner * uInnerLevel;
  float innerK = 1.0 + ${f(INNER_GAIN)} * innerLit;
  float innerFill = 1.0 + ${f(INNER_FILL)} * innerLit;

  // Interleaved gradient noise: a per-pixel start offset that turns step banding into fine grain, moved
  // on every frame so RESOLVE_BODY averages the grain away.
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uFrameNoise);
  float lodA = log2(max(uPixel * ${f(texelsPerUnit(FINE_A), 3)}, 1e-6));
  float lodB = log2(max(uPixel * ${f(texelsPerUnit(FINE_B), 3)}, 1e-6));
  float depthSum = 0.0;
  float lightSum = 0.0;

  vec3 col = vec3(0.0);
  float T = 1.0;
  float tOcc = ${f(T_MAX)};
  float t = jitter * ${f(DT_MIN)};
  float tPrev = 0.0;
  float ePrev = 0.0;
  float eSPrev = 0.0;
  vec4 erfPrev = vec4(0.0);
  vec4 erfSPrev = vec4(0.0);
  float fibPrev = 0.5;
  float erfVPrev = 0.0;
  bool prevLive = false;
  float fillPrev = 0.0;
  float sigmaPrev = 0.0;
  int steps = min(int(uMaxSteps), ${MAX_STEPS});
  for (int i = 0; i < ${MAX_STEPS}; i++) {
    if (i >= steps || t > ${f(T_MAX)} || T < 0.03) break;

    vec3 rel = dir * t;
    vec3 wp = cam + rel;
    // Level 0 throughout but for the fine reads: in this loop's uneven control flow the implicit
    // derivatives that would pick a mip level are undefined.
    vec4 wv = textureLod(uVol, (wp + uChurn) * BASE_SCALE, 0.0);
    vec3 qw = wp + ${f(WARP)} * vec3(wv.z - 0.5, wv.w - 0.5, wv.z - wv.w);
    vec2 fine = textureLod(uVol, qw * DETAIL_SCALE, 0.0).rg;
    float det = fine.y;
    float fib = fine.x;
    float dens = textureLod(uVol, qw * BASE_SCALE, 0.0).r + ${f(DETAIL_AMP)} * (det - 0.5) + ${f(WRINKLE)} * (fib - 0.5);
    float fineD = 0.0;
    if (uFine > 0.001 && dens > th + ${f(VOID_E * BAND)} - ${f(FINE_MAX)} * uFine) {
      vec3 pq = qw * BASE_SCALE;
      float lt = log2(max(t, 0.05));
      float fa = textureLod(uVol, pq * FINE_A, lodA + lt).g - 0.5;
      float fb = textureLod(uVol, pq * FINE_B, lodB + lt).g - 0.5;
      fineD = ${f(FINE_AMP)} * uFine * (fa + ${f(FINE_B_GAIN)} * fb);
      dens += fineD;
    }

    vec2 axis = vec2(pathX(rel.z), pathY(rel.z)) - here;
    float rad = ${f(TUNNEL_R)} * (1.0 + pathR(rel.z));
    float carve = ${f(TUNNEL_DEPTH)} * (0.5 + 0.5 * smoothstep(${f(TUNNEL_FAR)}, ${f(TUNNEL_NEAR)}, rel.z));
    dens -= carve * exp(-dot(rel.xy - axis, rel.xy - axis) / (rad * rad));

    // Drop shock: where this sample sits against the front, negative behind it. The front swells the gas it crosses.
    float sr = 99.0;
    float front = 0.0;
    if (uShockAmp > 0.002 || uIgnite > 0.002) {
      sr = length(rel - uShockAt.xyz) - uShockAt.w;
      front = uShockAmp * exp(-sr * sr / ${f(SHOCK_W * SHOCK_W)});
      dens += ${f(SHOCK_SWELL)} * front;
    }

    float e = (dens - th) / ${f(BAND)};
    float eS = e - ${f(1 - SHELL_FINE)} * fineD / ${f(BAND)};
    // Most steps lie in empty space, where every erf below sits on its clamp; branching to the clamped
    // value instead of evaluating it is exact and halves the march.
    vec4 x = vec4(-4.0), xs = vec4(-4.0), erfX = vec4(-1.0), erfS = vec4(-1.0);
    float fill = 0.0, sigma = 0.0;
    if (e > ${f(VOID_E)}) {
      x = clamp((e - BAND_C) / BAND_S, -4.0, 4.0);
      erfX = e >= ${f(BAND_TOP_E)} ? vec4(1.0) : erfA(x);
      xs = clamp((eS * ${f(BAND)} - SHELL_OFF) / ${f(SHELL_W)}, -4.0, 4.0);
      erfS = eS <= ${f(SHELL_LOW_E)} ? vec4(-1.0) : (eS >= ${f(SHELL_TOP_E)} ? vec4(1.0) : erfA(xs));
      fill = smoothstep(0.5, 2.5, e);
      sigma = ${f(ABSORB)} * smoothstep(-1.0, 1.5, e);
    }
    float xv = clamp((fib - 0.5) / ${f(VEIN_W)}, -4.0, 4.0);
    // A step whose both ends are void adds no light and absorbs nothing, so it is skipped whole.
    bool live = i > 0 && max(e, ePrev) > ${f(VOID_E)};
    float erfV = 0.0;
    if (live) {
      erfV = erfA(xv);
      if (!prevLive) erfVPrev = erfA(clamp((fibPrev - 0.5) / ${f(VEIN_W)}, -4.0, 4.0));
    }

    if (live) {
      float de = e - ePrev;
      vec4 avg = abs(de) > 1e-3 ? 0.8862269 * BAND_S * (erfX - erfPrev) / de : exp(-x * x);
      float ds = (eS - eSPrev) * ${f(BAND / SHELL_W)};
      vec4 avgS = abs(ds) > 1e-3 ? 0.8862269 * (erfS - erfSPrev) / ds : exp(-xs * xs);
      float dv = (fib - fibPrev) / ${f(VEIN_W)};
      float avgV = abs(dv) > 1e-3 ? 0.8862269 * (erfV - erfVPrev) / dv : exp(-xv * xv);
      float dt = t - tPrev;
      float fade = smoothstep(0.08, 0.6, t) * smoothstep(${f(T_MAX)}, ${f(T_MAX * 0.45)}, t);
      // Some stretches of edge burn hot and some barely glow, as in the reference.
      float heat = mix(0.35, 1.35, smoothstep(0.35, 0.7, wv.z));
      // Hue drifts over the coarse warp and the finer detail both, so one view holds several.
      vec3 body = bodyColour(clamp(0.5 + 0.5 * (wv.w - 0.5) + 1.2 * (det - 0.5), 0.0, 1.0));
      float inside = 0.5 * (fill + fillPrev);
      float edge = clamp(${f(EDGE_RATE)} * dt / max(abs(de), 1e-3), ${f(EDGE_MIN)}, ${f(EDGE_MAX)});
      float burn = smoothstep(1.0, 1.3, heat);
      float shockHot = 1.0 + ${f(SHOCK_GAIN)} * front;
      vec3 emit = DUST * avg.x * ${f(BAND_GAIN[0])}
        + (mix(ROSE, FRINGE, burn) * avg.y * ${f(BAND_GAIN[1])}
          + mix(mix(HOT, body, 0.2), WARM, burn) * avg.z * ${f(BAND_GAIN[2])} * hot
          + mix(BLUE, body, 0.2) * avg.w * ${f(BAND_GAIN[3])}) * heat * edge * shockHot
        + mix(body, BLUE, 0.7 * burn) * inside * ${f(FILL_GAIN)} * (1.0 + ${f(FILL_HOT)} * burn) * innerFill
        + mix(mix(VEIN, body, 0.4), WARM, 0.25 * innerLit) * (dot(avgS, SHELL_GAIN) * heat + avgV * ${f(VEIN_GAIN)} * heat * smoothstep(-1.0, 1.0, e)) * innerK * shockHot
        + SHOCK_WHITE * front * inside * ${f(SHOCK_BODY)};
      // Ignite: the gas the front has crossed keeps burning, cooling from white to orange to deep red with distance behind it.
      if (sr < 0.0 && uIgnite > 0.002) {
        float cool = clamp(-sr / ${f(IGNITE_LEN)}, 0.0, 1.0);
        vec3 ember = cool < 0.3 ? mix(WARM, FRINGE, cool / 0.3) : mix(FRINGE, EMBER, (cool - 0.3) / 0.7);
        float rims = (avg.y * ${f(BAND_GAIN[1])} + avg.z * ${f(BAND_GAIN[2])} + avg.w * ${f(BAND_GAIN[3])}) * heat * edge;
        emit += ember * uIgnite * pow(1.0 - cool, 1.5) * (rims * ${f(IGNITE_RIM)} + inside * ${f(IGNITE_FILL)});
      }
      vec3 lit = T * emit * (${f(EMIT)} * fade * bright * dt);
      col += lit;
      float litSum = lit.r + lit.g + lit.b;
      depthSum += litSum * t;
      lightSum += litSum;
      T *= exp(-0.5 * (sigma + sigmaPrev) * dt);
      if (T < ${f(OCCLUDE)} && tOcc >= ${f(T_MAX)}) tOcc = t;
    }
    ePrev = e;
    eSPrev = eS;
    erfPrev = erfX;
    erfSPrev = erfS;
    fibPrev = fib;
    erfVPrev = erfV;
    fillPrev = fill;
    sigmaPrev = sigma;
    tPrev = t;
    prevLive = live;
    t += clamp(abs(dens - th) * ${f(STEP_K)}, ${f(DT_MIN)} * (1.0 + 0.2 * t), ${f(DT_MAX)});
  }

  col += GROUND * T;
  col = max(hueTurn(col, uHue + uHueDrift + ${f(TILT_DEG)} * uTilt * uTiltLean), 0.0);
  // Mapping each channel on its own bleaches every bright colour toward white;
  // mapping by the brightest channel keeps the reference's saturated blues and
  // magentas, and a share of the per-channel map still whitens the hottest cores.
  float m = max(max(col.r, col.g), max(col.b, 1e-4));
  vec3 keep = col * ((1.0 - exp(-m * ${f(EXPOSURE)})) / m);
  vec3 bleach = 1.0 - exp(-col * ${f(EXPOSURE)});
  outColor = vec4(mix(bleach, keep, ${f(KEEP_HUE)}), tOcc / ${f(T_MAX)});
  // Where the light came from, weighted by it: the depth RESOLVE_BODY moves this pixel by.
  outAux = vec4(lightSum > 1e-5 ? depthSum / lightSum / ${f(T_MAX)} : 1.0, 0.0, 0.0, 1.0);
}
`;

// Catmull-Rom, not the hardware's bilinear: OUT_BODY stretches the history over a Retina screen, where
// bilinear smears every rim, and RESOLVE_BODY reads it back every frame, where bilinear would blur it a
// little more each time. Per axis the two middle weights are both positive, so one bilinear read at
// their balance point takes both texels: nine reads for the sixteen. The texture must filter LINEAR.
// The clamp drops the filter's overshoot past black and white.
const CUBIC = `
vec3 cubicRgb(sampler2D tex, vec2 uv) {
  vec2 size = vec2(textureSize(tex, 0));
  vec2 c = uv * size - 0.5;
  vec2 i = floor(c);
  vec2 t = c - i;
  vec2 w0 = 0.5 * t * (t * (2.0 - t) - 1.0);
  vec2 w1 = 0.5 * (t * t * (3.0 * t - 5.0) + 2.0);
  vec2 w2 = 0.5 * t * (t * (4.0 - 3.0 * t) + 1.0);
  vec2 w3 = 0.5 * t * t * (t - 1.0);
  vec2 wm = w1 + w2;
  vec2 p0 = (i - 0.5) / size;
  vec2 pm = (i + 0.5 + w2 / wm) / size;
  vec2 p3 = (i + 2.5) / size;
  vec3 sum = (textureLod(tex, vec2(p0.x, p0.y), 0.0).rgb * w0.x + textureLod(tex, vec2(pm.x, p0.y), 0.0).rgb * wm.x
      + textureLod(tex, vec2(p3.x, p0.y), 0.0).rgb * w3.x) * w0.y
    + (textureLod(tex, vec2(p0.x, pm.y), 0.0).rgb * w0.x + textureLod(tex, vec2(pm.x, pm.y), 0.0).rgb * wm.x
      + textureLod(tex, vec2(p3.x, pm.y), 0.0).rgb * w3.x) * wm.y
    + (textureLod(tex, vec2(p0.x, p3.y), 0.0).rgb * w0.x + textureLod(tex, vec2(pm.x, p3.y), 0.0).rgb * wm.x
      + textureLod(tex, vec2(p3.x, p3.y), 0.0).rgb * w3.x) * w3.y;
  return clamp(sum, 0.0, 1.0);
}
`;

/** RESOLVE_BODY's reconstruction: this frame's samples weigh exp(-k d²) at d gas-target pixels. */
const RECON_K = 2.5;
/** How much of this frame goes into the history where one of its samples lands on the history
 *  pixel, and the share of that where none comes near: about the last eight frames are averaged. */
const HIST_NEW = 0.12;
const HIST_FAR = 0.35;

export const RESOLVE_BODY = `
${CUBIC}
${VIEW_RAY}
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  ivec2 size = textureSize(uGasTex, 0);
  // This frame's samples sit uJitter off their pixels' centres; s is where this history pixel falls among them.
  vec2 s = uv * vec2(size) - 0.5 - uJitter;
  ivec2 c = ivec2(floor(s + 0.5));
  vec3 sum = vec3(0.0);
  float wSum = 0.0;
  vec3 lo = vec3(1.0);
  vec3 hi = vec3(0.0);
  float depth = 1.0;
  float near = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      ivec2 k = c + ivec2(x, y);
      ivec2 kc = clamp(k, ivec2(0), size - 1);
      vec3 v = texelFetch(uGasTex, kc, 0).rgb;
      vec2 d = vec2(k) - s;
      float w = exp(${f(-RECON_K)} * dot(d, d));
      sum += v * w;
      wSum += w;
      near = max(near, w);
      lo = min(lo, v);
      hi = max(hi, v);
      // The nearest light around: a rim in front of far gas moves with the rim.
      depth = min(depth, texelFetch(uAuxTex, kc, 0).r);
    }
  }
  vec3 cur = sum / wSum;
  outColor = vec4(cur, 1.0);
  if (uHistOk < 0.5) return;

  // The same gas a frame ago, seen from the last camera: uPrevCam[0] is how far this camera has moved
  // from that one, less how far the gas itself streamed (flight.ts's flow).
  vec2 p;
  vec3 q = viewRay(uv, p) * (depth * ${f(T_MAX)}) + uPrevCam[0].xyz;
  float z = dot(q, uPrevCam[3].xyz);
  if (z < 1e-3) return;
  vec2 pp = vec2(dot(q, uPrevCam[1].xyz), dot(q, uPrevCam[2].xyz)) / (z * ${f(2 * FOV_TAN)});
  pp.x /= uResolution.x / uResolution.y;
  vec2 prevUv = (pp + 0.5 - uViewport.xy) / uViewport.zw;
  if (any(lessThan(prevUv, vec2(0.0))) || any(greaterThan(prevUv, vec2(1.0)))) return;

  // Held to what this frame shows around the pixel, so gas that moved off it doesn't trail behind.
  vec3 hist = clamp(cubicRgb(uHistTex, prevUv), lo, hi);
  vec3 blend = mix(hist, cur, ${f(HIST_NEW)} * mix(${f(HIST_FAR)}, 1.0, near));
  // The history is 8-bit: rounding by a moving dither, not to nearest, lets it creep by less than a step a frame.
  float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uFrameNoise) - 0.5;
  outColor = vec4(blend + n / 255.0, 1.0);
}
`;

export const OUT_BODY = `
${CUBIC}
void main() {
  vec2 p = roomUv(vUv) - 0.5;
  p.x *= uResolution.x / uResolution.y;
  vec3 col = cubicRgb(uHistTex, vUv);
  vec2 px = ${f(SHARP_R, 1)} / vec2(textureSize(uHistTex, 0));
  vec3 soft = 0.25 * (texture(uHistTex, vUv + px).rgb + texture(uHistTex, vUv - px).rgb
    + texture(uHistTex, vUv + vec2(px.x, -px.y)).rgb + texture(uHistTex, vUv + vec2(-px.x, px.y)).rgb);
  col = clamp(col + ${f(SHARPEN)} * (col - soft), 0.0, 1.0);
  // Glare from the gas target's mip chain (index.ts rebuilds it each frame): the reference's rims
  // and hot spots sit in a soft halo, glow e-fold about 10 px at 720p.
  vec3 glow = 0.5 * (textureLod(uGasTex, vUv, ${f(BLOOM_LODS[0], 1)}).rgb + textureLod(uGasTex, vUv, ${f(BLOOM_LODS[1], 1)}).rgb);
  glow = max(glow - ${f(BLOOM_FLOOR)}, 0.0) * ${f(BLOOM_GAIN)};
  col = 1.0 - (1.0 - col) * (1.0 - min(glow, 1.0));
  col *= 1.0 - 0.25 * dot(p, p);
  outColor = vec4(col, 1.0);
}
`;
