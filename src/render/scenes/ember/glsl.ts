/**
 * Ember's picture: stacked fronts of red fire rising out of black, each with
 * a thin glowing crest line, the deeper ones showing as fainter crests
 * inside the body of the one above.
 *
 * A front is a height line across the screen (fbm in x and a slow morph
 * phase), with a ridged term that turns its peaks into sharp upward tips
 * while the valleys stay round. The whole picture is first pushed through a
 * two-stage domain warp whose noise climbs the screen, which is what makes
 * the fronts curl over and seem to rise while their mean height holds.
 * Distance to a front is measured in pixels from the field's own screen
 * derivatives, so the crest line keeps one width at any resolution.
 *
 * Every phase that reaches a noise coordinate is wrapped on the JS side
 * (src/render/noiseHash.ts's header); the octaves double exactly and shift by
 * whole cells, so the wrap stays invisible in every octave.
 */

import { NOISE_HASH_GLSL, NOISE_MASK } from "../../noiseHash.ts";

/** Most fronts the shader draws; the Layers setting picks how many. */
export const MAX_LAYERS = 4;
/** Noise cells per screen height for the warp; index.ts scales the climb phase by it. */
export const WARP_SCALE = 1.1;

export const FRAG = `
${NOISE_HASH_GLSL}

const int MAX_LAYERS = ${MAX_LAYERS};
const int NOISE_MASK = ${NOISE_MASK};
const int MAX_OCTAVES = 3;
// Noise cells per screen height for the crests.
const float WARP_SCALE = ${WARP_SCALE.toFixed(3)};
const float CREST_FREQ = 1.5;
// Screen heights: how far a crest swings, the gap between stacked fronts.
const float CREST_AMP = 0.22;
const float LAYER_GAP = 0.13;
// How far the swell lifts the fire: at its peak the reference's fire fills
// nearly the whole frame, the black only coming back at the loop's seam.
const float SWELL_RISE = 0.24;

float vnoise(vec2 p, uint seed) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hashCell(i, NOISE_MASK, seed);
  float b = hashCell(i + vec2(1.0, 0.0), NOISE_MASK, seed);
  float c = hashCell(i + vec2(0.0, 1.0), NOISE_MASK, seed);
  float d = hashCell(i + vec2(1.0, 1.0), NOISE_MASK, seed);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}

vec2 vnoise2(vec2 p, uint seed) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 a = hash2Cell(i, NOISE_MASK, seed);
  vec2 b = hash2Cell(i + vec2(1.0, 0.0), NOISE_MASK, seed);
  vec2 c = hash2Cell(i + vec2(0.0, 1.0), NOISE_MASK, seed);
  vec2 d = hash2Cell(i + vec2(1.0, 1.0), NOISE_MASK, seed);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}

// Few octaves on purpose: the reference's fronts are large smooth lobes.
int octaves() { return 2 + int(uDetail + 0.5); }

float fbm(vec2 p, uint seed) {
  float s = 0.0;
  float a = 0.5;
  int n = octaves();
  for (int k = 0; k < MAX_OCTAVES; k++) {
    if (k >= n) break;
    s += a * vnoise(p, seed);
    // Exact doubling plus a whole-cell shift keeps every octave periodic in
    // the wrapped phase.
    p = p * 2.0 + vec2(17.0, 31.0);
    a *= 0.5;
  }
  return s;
}

vec2 fbm2(vec2 p, uint seed) {
  vec2 s = vec2(0.0);
  float a = 0.5;
  int n = octaves();
  for (int k = 0; k < MAX_OCTAVES; k++) {
    if (k >= n) break;
    s += a * vnoise2(p, seed);
    p = p * 2.0 + vec2(23.0, 11.0);
    a *= 0.5;
  }
  return s;
}

// Height of point q above front i, in screen heights: x with the tips, y
// without them — the body's depth is read from y, since a tip's crease
// would otherwise run straight down through the body as a seam.
vec2 frontField(vec2 q, float i, float lift) {
  vec2 c = vec2(q.x * CREST_FREQ, uMorphPh) + vec2(0.0, 13.0 * i);
  float n = fbm(c, 5u + uint(i));
  float r = 1.0 - abs(n);
  float tip = pow(r, 6.0);
  float base = uLevel + SWELL_RISE * uSwell + lift * 0.12 - i * LAYER_GAP;
  float smoothH = base + CREST_AMP * 0.6 * n;
  float h = smoothH + CREST_AMP * (uTips * (1.7 * tip - 0.45) + lift * 0.6 * tip);
  return vec2(q.y - h, q.y - smoothH);
}

void main() {
  vec2 uv = roomUv(vUv);
  float aspect = uResolution.x / uResolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float px = uResolution.y / 720.0;

  float churn = uChurn * (0.85 + 0.6 * churnDrive(uSectionIntensity));
  float lift = uLiftLvl;

  vec2 wp = p * WARP_SCALE - vec2(0.0, uRisePh);
  vec2 w1 = fbm2(wp, 1u);
  vec2 w2 = fbm2(wp + 1.6 * w1 + vec2(1.7, 9.2), 3u);
  vec2 q = p + churn * 0.22 * w2;
  // Dark pockets and hot patches inside the body, climbing with the warp.
  float tex = smoothstep(-0.45, 0.45, fbm(wp + 0.8 * w1 + vec2(3.0, 5.0), 7u));
  // Wide, soft dark lanes curling through the body along the warp.
  float fn = fbm(wp + 1.2 * w2 + vec2(9.0, 4.0), 9u);
  float fold = mix(1.0, smoothstep(0.0, 0.3, abs(fn)), 0.6);

  // At rest (silence) heat and churn sit where the silent reference does;
  // the music only adds.
  float heat = uHeat * (0.85 + 0.6 * heatDrive(uLow));
  // The swell mostly moves the fire's height; the body only dims a little.
  float bodyAmt = heat * (0.45 + 0.55 * uSwell);
  // Bare crests read brighter against a dark body, as in the reference's dark phase.
  float ridgeAmt = 0.8 * uRidge * (1.0 - 0.3 * uSwell) * (1.0 + 0.5 * lift);

  // Each front is a glowing sheet, brightest just under its own rim and
  // fading down, so a darker fold shows above the next rim; sheets combine
  // like light (screen), never past white.
  float dark = 1.0;
  float rims = 0.0;
  float inside0 = 0.0;
  float f0 = 0.0;
  int layers = int(uLayers + 0.5);
  for (int k = 0; k < MAX_LAYERS; k++) {
    if (k >= layers) break;
    float i = float(k);
    vec2 ff = frontField(q, i, lift);
    float f = ff.x;
    // Capped: below a steep tip the slope would shrink the estimate all the
    // way down the body and leak the crest's glow into a vertical streak.
    float g = clamp(length(vec2(dFdx(f), dFdy(f))), 1e-5, 4.0 / uResolution.y);
    float d = f / g;
    float inside = smoothstep(6.0 * px, -26.0 * px, d);
    if (k == 0) {
      inside0 = inside;
      f0 = f;
    }
    float depth = max(-ff.y, 0.0);
    float sheet = inside * (0.3 + 0.7 * exp(-depth / 0.18));
    float w = 1.0 / (1.0 + 0.45 * i);
    float shown = k == 0 ? 1.0 : inside0;
    dark *= 1.0 - w * sheet * shown;
    float ad = abs(d);
    float core = smoothstep(8.0 * px, 1.5 * px, ad);
    // The glow falls off slower into the body than out into the dark.
    float glow = exp(-ad / ((d < 0.0 ? 40.0 : 10.0) * px)) * (d < 0.0 ? 1.4 : 1.0);
    rims += (0.45 * core + 0.6 * glow) * w * shown;
  }
  // The base of the fire glows from below.
  dark *= 1.0 - 0.6 * inside0 * exp(-p.y / 0.35);
  float body = (1.0 - dark) * mix(0.25, 1.9, tex * tex) * fold;
  float lum = body * bodyAmt + rims * ridgeAmt * mix(0.45, 1.2, tex);
  // A faint smoke trails off the top front into the dark.
  lum += (1.0 - inside0) * exp(-max(f0, 0.0) / 0.07) * 0.1 * bodyAmt;

  float L = 1.0 - exp(-1.3 * lum);
  vec3 own = max(vec3(1.0, 0.03, 0.012) * L, vec3(0.027, 0.0, 0.0));
  vec3 room = mix(uPalGround, palRamp(L), clamp(L * 4.0, 0.0, 1.0));
  outColor = vec4(mix(own, room, uRoomColor), 1.0);
}
`;
