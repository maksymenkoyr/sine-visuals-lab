/**
 * Nebula's two fragment bodies: GAS_BODY marches through the gas volume
 * volume.ts bakes, into a smaller offscreen target; OUT_BODY scales that up
 * to the screen. index.ts wraps both in the common uniform header, runs them
 * in that order, and draws stars.ts's points over the result.
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
 * for detail; minus a tunnel of open space around the camera's path
 * (flight.ts), so the camera flies through the voids and the gas passes
 * around it.
 *
 * The band is far thinner than a step, so each step integrates it (erf of
 * the density at both ends, taken as linear in between) rather than
 * sampling it; point samples lit whichever folds a step landed on and drew
 * wood-grain contours. With that, steps can stay long, and they are longest
 * where the density is far from the edge. The same integral lights the
 * shells inside the edge and the veins of the finer read: thin sheets that
 * show as lines where the ray runs along them.
 *
 * The gas target holds the gas already tone-mapped (1 - e^-x), and in alpha
 * the depth where the gas turns opaque, which stars.ts reads to hide the
 * stars behind it.
 *
 * Every TS number that reaches the shader goes through `.toFixed()`, so
 * GLSL never sees an int where it wants a float. Nothing that grows with
 * the session reaches a noise coordinate (flight.ts's header).
 */

import { PATH_R, PATH_X, PATH_Y, PERIOD, PERIOD_Z, type PathSine } from "./flight.ts";

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
/** Radius of the churn clock's circle in the warp field, in world units. */
const CHURN_R = 0.35;
const EXPOSURE = 1.25;
/** Glare: the two mip levels blurred into it, the brightness it starts above, and its strength. */
const BLOOM_LODS = [2, 3.5];
const BLOOM_FLOOR = 0.18;
const BLOOM_GAIN = 0.8;
/** Unsharp amount against the gas target's first mip, after the cubic scale-up. Measured at Retina
 *  size (docs/scenes/nebula.md): high's `GAS_HEIGHT` target came out about as crisp as a march at
 *  the screen's full height, at a fraction of the cost; twice this turned the gas grainy. */
const SHARPEN = 0.5;

const f = (x: number, d = 4) => x.toFixed(d);

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
uniform float uChurn;
`;

const VIEW_RAY = `
// This pixel's ray: uCam is flight.ts's cameraUniforms (position, right, up, forward).
vec3 viewRay(out vec2 p) {
  p = roomUv(vUv) - 0.5;
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

${pathGlsl("pathX", PATH_X, ["uPath[0].x", "uPath[0].y"])}
${pathGlsl("pathY", PATH_Y, ["uPath[0].z", "uPath[0].w"])}
${pathGlsl("pathR", PATH_R, ["uPath[1].x", "uPath[1].y"])}
${VIEW_RAY}

// erf, near enough for a glow (tanh form, error under 1e-3); inputs are clamped to ±4.
vec4 erfA(vec4 x) { return tanh(1.1283792 * x + 0.1009 * x * x * x); }
float erfA(float x) { return tanh(1.1283792 * x + 0.1009 * x * x * x); }

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
  vec3 dir = viewRay(p);
  vec3 cam = uCam[0].xyz;
  vec2 here = vec2(pathX(0.0), pathY(0.0));

  float th = mix(0.69, 0.55, uGas);
  float hot = 1.0 + ${f(FLARE_GAIN)} * uFlare * flareDrive(uLowPulse);
  float bright = uGlow * (1.0 + ${f(GLOW_GAIN)} * glowDrive(uEnergy));
  vec3 churn = ${f(CHURN_R)} * vec3(cos(uChurn), sin(uChurn), 0.0);

  // Interleaved gradient noise: a fixed per-pixel start offset that turns step banding into fine grain.
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));

  vec3 col = vec3(0.0);
  float T = 1.0;
  float tOcc = ${f(T_MAX)};
  float t = jitter * ${f(DT_MIN)};
  float tPrev = 0.0;
  float ePrev = 0.0;
  vec4 erfPrev = vec4(0.0);
  vec4 erfSPrev = vec4(0.0);
  float fibPrev = 0.5;
  float erfVPrev = 0.0;
  float fillPrev = 0.0;
  float sigmaPrev = 0.0;
  int steps = min(int(uMaxSteps), ${MAX_STEPS});
  for (int i = 0; i < ${MAX_STEPS}; i++) {
    if (i >= steps || t > ${f(T_MAX)} || T < 0.03) break;

    vec3 rel = dir * t;
    vec3 wp = cam + rel;
    vec4 wv = texture(uVol, (wp + churn) * BASE_SCALE);
    vec3 qw = wp + ${f(WARP)} * vec3(wv.z - 0.5, wv.w - 0.5, wv.z - wv.w);
    vec2 fine = texture(uVol, qw * DETAIL_SCALE).rg;
    float det = fine.y;
    float fib = fine.x;
    float dens = texture(uVol, qw * BASE_SCALE).r + ${f(DETAIL_AMP)} * (det - 0.5) + ${f(WRINKLE)} * (fib - 0.5);

    vec2 axis = vec2(pathX(rel.z), pathY(rel.z)) - here;
    float rad = ${f(TUNNEL_R)} * (1.0 + pathR(rel.z));
    float carve = ${f(TUNNEL_DEPTH)} * (0.5 + 0.5 * smoothstep(${f(TUNNEL_FAR)}, ${f(TUNNEL_NEAR)}, rel.z));
    dens -= carve * exp(-dot(rel.xy - axis, rel.xy - axis) / (rad * rad));

    float e = (dens - th) / ${f(BAND)};
    vec4 x = clamp((e - BAND_C) / BAND_S, -4.0, 4.0);
    vec4 erfX = erfA(x);
    vec4 xs = clamp((e * ${f(BAND)} - SHELL_OFF) / ${f(SHELL_W)}, -4.0, 4.0);
    vec4 erfS = erfA(xs);
    float fill = smoothstep(0.5, 2.5, e);
    float xv = clamp((fib - 0.5) / ${f(VEIN_W)}, -4.0, 4.0);
    float erfV = erfA(xv);
    float sigma = ${f(ABSORB)} * smoothstep(-1.0, 1.5, e);

    if (i > 0) {
      float de = e - ePrev;
      vec4 avg = abs(de) > 1e-3 ? 0.8862269 * BAND_S * (erfX - erfPrev) / de : exp(-x * x);
      float ds = de * ${f(BAND / SHELL_W)};
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
      vec3 emit = DUST * avg.x * ${f(BAND_GAIN[0])}
        + (mix(ROSE, FRINGE, burn) * avg.y * ${f(BAND_GAIN[1])}
          + mix(mix(HOT, body, 0.2), WARM, burn) * avg.z * ${f(BAND_GAIN[2])} * hot
          + mix(BLUE, body, 0.2) * avg.w * ${f(BAND_GAIN[3])}) * heat * edge
        + mix(body, BLUE, 0.7 * burn) * inside * ${f(FILL_GAIN)} * (1.0 + ${f(FILL_HOT)} * burn)
        + mix(VEIN, body, 0.4) * (dot(avgS, SHELL_GAIN) * heat + avgV * ${f(VEIN_GAIN)} * heat * smoothstep(-1.0, 1.0, e));
      col += T * emit * (${f(EMIT)} * fade * bright * dt);
      T *= exp(-0.5 * (sigma + sigmaPrev) * dt);
      if (T < ${f(OCCLUDE)} && tOcc >= ${f(T_MAX)}) tOcc = t;
    }
    ePrev = e;
    erfPrev = erfX;
    erfSPrev = erfS;
    fibPrev = fib;
    erfVPrev = erfV;
    fillPrev = fill;
    sigmaPrev = sigma;
    tPrev = t;
    t += clamp(abs(dens - th) * ${f(STEP_K)}, ${f(DT_MIN)} * (1.0 + 0.2 * t), ${f(DT_MAX)});
  }

  col += GROUND * T;
  col = max(hueTurn(col, uHue + uHueDrift), 0.0);
  // Mapping each channel on its own bleaches every bright colour toward white;
  // mapping by the brightest channel keeps the reference's saturated blues and
  // magentas, and a share of the per-channel map still whitens the hottest cores.
  float m = max(max(col.r, col.g), max(col.b, 1e-4));
  vec3 keep = col * ((1.0 - exp(-m * ${f(EXPOSURE)})) / m);
  vec3 bleach = 1.0 - exp(-col * ${f(EXPOSURE)});
  outColor = vec4(mix(bleach, keep, ${f(KEEP_HUE)}), tOcc / ${f(T_MAX)});
}
`;

export const OUT_BODY = `
// Catmull-Rom, not the hardware's bilinear: the target is stretched several times over on a Retina
// screen, where bilinear smears every rim. The clamp drops the filter's overshoot past black and white.
vec4 crWeights(float t) {
  return 0.5 * vec4(t * (t * (2.0 - t) - 1.0), t * t * (3.0 * t - 5.0) + 2.0, t * (t * (4.0 - 3.0 * t) + 1.0), t * t * (t - 1.0));
}
vec3 gasCubic(vec2 uv) {
  ivec2 size = textureSize(uGasTex, 0);
  vec2 c = uv * vec2(size) - 0.5;
  vec2 i = floor(c);
  vec4 wx = crWeights(c.x - i.x), wy = crWeights(c.y - i.y);
  vec3 sum = vec3(0.0);
  for (int y = 0; y < 4; y++) {
    for (int x = 0; x < 4; x++) {
      sum += texelFetch(uGasTex, clamp(ivec2(i) + ivec2(x - 1, y - 1), ivec2(0), size - 1), 0).rgb * wx[x] * wy[y];
    }
  }
  return clamp(sum, 0.0, 1.0);
}

void main() {
  vec2 p = roomUv(vUv) - 0.5;
  p.x *= uResolution.x / uResolution.y;
  vec3 col = gasCubic(vUv);
  col = clamp(col + ${f(SHARPEN)} * (col - textureLod(uGasTex, vUv, 1.0).rgb), 0.0, 1.0);
  // Glare from the gas target's mip chain (index.ts rebuilds it each frame): the reference's rims
  // and hot spots sit in a soft halo, glow e-fold about 10 px at 720p.
  vec3 glow = 0.5 * (textureLod(uGasTex, vUv, ${f(BLOOM_LODS[0], 1)}).rgb + textureLod(uGasTex, vUv, ${f(BLOOM_LODS[1], 1)}).rgb);
  glow = max(glow - ${f(BLOOM_FLOOR)}, 0.0) * ${f(BLOOM_GAIN)};
  col = 1.0 - (1.0 - col) * (1.0 - min(glow, 1.0));
  col *= 1.0 - 0.25 * dot(p, p);
  outColor = vec4(col, 1.0);
}
`;
