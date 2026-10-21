/**
 * Nebula's picture, as one fragment body (createFullscreenScene's `fragBody`).
 *
 * The camera flies through a violet gas cloud. The cloud is not raymarched:
 * it is `LAYERS` flat planes of noise at different depths (flight.ts moves
 * them), drawn back to front over a dark violet ground. The reference's
 * motion measured as a flat zoom with a slow turn, not a deep tunnel
 * (docs/scenes/nebula.md, Measurements), and planes give that parallax for a
 * fraction of a raymarch's cost.
 *
 * Each plane, for each pixel:
 *
 * - Where it sits: the pixel's position is bent so that distance from the
 *   centre grows slower than position around it (`STREAK_POW`), which
 *   stretches every shape along the radius the way the reference's wisps
 *   lie, then turned by the view's turn plus the plane's own, scaled by the
 *   plane's depth, and offset by its seed.
 * - The gas: a domain-warped fbm, `n`. Above the plane's threshold (the Gas
 *   setting) is cloud; its deep inside is darker than its edge, so the
 *   bright parts are the edges, as in the reference.
 * - Its edges: a thin hot rim, white-blue, on the threshold line; a red-
 *   orange fringe just outside it; a soft magenta haze further out. Fine
 *   streaks inside the cloud come from a ridged sum taken in the same
 *   octave loop.
 * - Stars: a sparse lattice of points, drawn before the plane's own gas so
 *   the cloud hides the stars inside it.
 *
 * A plane fades in at the far end and out as it reaches the camera, so its
 * rebirth with a new seed is never seen. Far planes are dimmer.
 *
 * Every TS number that reaches the shader goes through `.toFixed(3)`, so
 * GLSL never sees an int where it wants a float. Noise coordinates stay
 * bounded: the seed offset is already reduced by flight.ts, and the churn
 * clock only ever enters through cos/sin.
 */

import { FLOAT_HASH_GLSL } from "../../noiseHash.ts";
import { LAYERS } from "./flight.ts";

/** Plane depth at the far end and at the camera, in units of the noise field's scale. */
const DEPTH_FAR = 3.2;
const DEPTH_NEAR = 0.3;
/** The noise field's scale against the screen: higher packs more cloud into the view. */
const FIELD = 0.65;
/** Below 1, shapes stretch along the radius by 1 / this. */
const STREAK_POW = 0.72;
/** How far the warp field pushes the gas, in noise cells. */
const WARP = 1.35;
/** Radius of the churn clock's circle in the warp field: how far the gas morphs on its own. */
const CHURN_R = 0.35;
/** How much light the gas blocks from what lies behind it. */
const OPACITY = 0.55;
/** A rim's half-width in units of n per unit of plane scale: about 4 px at 720p (the reference's glow e-fold is 7–13 px). */
const RIM_W = 0.007;
/** How much further than its rim an edge's light reaches into the cloud. */
const INNER_MUL = 6.0;
/** The fibre noise's frequency across and along a fibre, in noise cells. */
const FIBRE_STRETCH = [2.0, 14.0];
/** How many times brighter the rims burn on a full hit at Flare 1. */
const FLARE_GAIN = 1.8;
/** How much brighter the whole cloud gets at full drive at Glow 1. */
const GLOW_GAIN = 0.4;
/** Star lattice density, in cells per noise cell. */
const STAR_FREQ = 14.0;
/** Share of star cells lit at Stars 1. */
const STAR_SHARE = 0.16;

const f = (x: number) => x.toFixed(3);

export const FRAG = `
${FLOAT_HASH_GLSL}

const vec3 GROUND = vec3(0.070, 0.038, 0.110);
const vec3 VIOLET = vec3(0.26, 0.13, 0.68);
const vec3 MAGENTA = vec3(0.54, 0.17, 0.80);
const vec3 RIM = vec3(0.36, 0.48, 1.00);
const vec3 HOT = vec3(0.92, 0.90, 1.00);
const vec3 FRINGE = vec3(1.00, 0.42, 0.22);
const vec3 ROSE = vec3(1.00, 0.28, 0.55);

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 t = fract(p);
  vec2 u = t * t * (3.0 - 2.0 * t);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}

vec2 vnoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 t = fract(p);
  vec2 u = t * t * (3.0 - 2.0 * t);
  return mix(mix(hash22(i), hash22(i + vec2(1.0, 0.0)), u.x),
             mix(hash22(i + vec2(0.0, 1.0)), hash22(i + vec2(1.0, 1.0)), u.x), u.y);
}

// Each octave is turned so the lattice's axes never line up into a grid.
const mat2 OCT = mat2(1.6, 1.2, -1.2, 1.6);

int octaves() { return 3 + int(uDetail * 2.0 + 0.5); }

vec2 warpField(vec2 p) {
  vec2 s = vec2(0.0);
  float a = 0.5;
  int n = octaves() - 1;
  for (int o = 0; o < 5; o++) {
    if (o >= n) break;
    s += a * vnoise2(p);
    p = OCT * p;
    a *= 0.5;
  }
  return s;
}

// The gas (x) and a ridged sum (y) that lights fine filaments inside it.
vec2 gasField(vec2 p) {
  float s = 0.0;
  float r = 0.0;
  float a = 0.5;
  int n = octaves();
  for (int o = 0; o < 6; o++) {
    if (o >= n) break;
    float v = vnoise(p);
    s += a * v;
    r += a * (1.0 - abs(2.0 * v - 1.0));
    p = OCT * p;
    a *= 0.5;
  }
  return vec2(s, r);
}

vec2 rot(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

vec3 hueTurn(vec3 c, float deg) {
  float a = radians(deg);
  vec3 k = vec3(0.57735);
  return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
}

void main() {
  vec2 p = roomUv(vUv) - 0.5;
  p.x *= uResolution.x / uResolution.y;
  float r = length(p);
  vec2 ps = r > 1e-4 ? p * (pow(r, ${f(STREAK_POW)}) / r) : p;

  float th = mix(0.66, 0.44, uGas);
  float rimK = 1.0 + ${f(FLARE_GAIN)} * uFlare * flareDrive(uLowPulse);
  float bright = uGlow * (1.0 + ${f(GLOW_GAIN)} * glowDrive(uEnergy));
  float starLit = 1.0 - ${f(STAR_SHARE)} * uStars;

  vec3 col = GROUND * (1.0 + 0.35 * exp(-r * r * 3.0));

  for (int k = 0; k < ${LAYERS}; k++) {
    vec4 L = uLayer[k];
    float z = L.x;
    float fade = smoothstep(0.0, 0.25, z) * (1.0 - smoothstep(0.78, 1.0, z));
    if (fade < 0.002) continue;
    float depth = mix(${f(DEPTH_FAR)}, ${f(DEPTH_NEAR)}, z);
    float scale = depth * ${f(FIELD)};
    vec2 lp = rot(ps, uTurn + L.w) * scale + L.yz;
    float near = mix(0.55, 1.0, z);

    // Stars, behind this plane's own gas.
    vec2 g = lp * ${f(STAR_FREQ)};
    vec2 cell = floor(g);
    float sh = hash21(cell + 0.5);
    if (sh > starLit) {
      vec2 sp = cell + 0.2 + 0.6 * hash22(cell + 7.5);
      float d = length(g - sp) / (${f(STAR_FREQ)} * scale);
      float size = 0.0018 * (1.0 + 0.5 / depth);
      float lum = pow(hash21(cell + 3.5), 3.0);
      col += mix(vec3(0.6, 0.75, 1.0), vec3(1.0), lum) * exp(-d * d / (size * size)) * fade * near * (0.35 + 1.4 * lum);
    }

    vec2 w = warpField(lp * 0.55 + ${f(CHURN_R)} * vec2(cos(uChurn + L.w), sin(uChurn + L.w)));
    vec2 q = lp + ${f(WARP)} * (w - 0.5);
    vec2 gr = gasField(q);
    float n = gr.x;
    // A rim's width in units of n grows with the plane's scale, so on screen
    // it stays a few pixels wide on a near plane and a far one alike.
    float wn = scale * ${f(RIM_W)};
    float body = smoothstep(th, th + 0.12, n);
    float inside = smoothstep(th + 0.10, th + 0.30, n);
    float e = (n - th) / wn;
    float rim = exp(-e * e);
    // Lit volume, not a line: the edge's light fades slowly into the cloud and fast out of it.
    float edgeIn = exp(-max(n - th, 0.0) / (wn * ${f(INNER_MUL)})) * smoothstep(th - wn, th, n);
    float ef = (n - th + wn * 1.8) / wn;
    float fringe = exp(-ef * ef);
    float haze = exp(-max(th - n, 0.0) / 0.06) * (1.0 - body);
    float streak = smoothstep(0.45, 0.9, gr.y);
    // Fibres: one noise stretched along the plane's own axis and bent by the warp, so they follow the gas.
    float fv = vnoise(q * vec2(${f(FIBRE_STRETCH[0])}, ${f(FIBRE_STRETCH[1])}) + w * 3.0);
    float fibre = pow(1.0 - abs(2.0 * fv - 1.0), 10.0);
    // Some stretches of an edge burn hot and some barely glow, as in the reference.
    float heat = mix(0.25, 1.3, smoothstep(0.3, 0.75, w.y));

    vec3 gas = mix(VIOLET, MAGENTA, smoothstep(0.35, 0.65, w.x));
    vec3 rimCol = mix(RIM, HOT, smoothstep(0.9, 1.6, heat * rimK));
    vec3 fringeCol = mix(ROSE, FRINGE, smoothstep(0.3, 0.7, w.x));
    vec3 emit = gas * body * (0.16 + 0.30 * (1.0 - inside) + 0.55 * streak)
      + mix(gas, RIM, 0.5) * fibre * body * (1.0 - 0.4 * inside) * 0.6 * heat
      + mix(gas, RIM, 0.5) * edgeIn * (0.45 + 1.8 * fibre) * heat * rimK
      + rimCol * rim * 1.15 * heat * rimK
      + fringeCol * fringe * 0.8 * heat * rimK
      + gas * haze * 0.10;
    col = col * (1.0 - body * ${f(OPACITY)} * fade) + emit * fade * near * bright;
  }

  col = hueTurn(col, uHue);
  col = 1.0 - exp(-col * 1.1);
  col *= 1.0 - 0.3 * dot(p, p);
  outColor = vec4(max(col, 0.0), 1.0);
}
`;
