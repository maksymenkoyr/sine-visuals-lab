// Silk's shader bodies — see driver.ts's header for the picture and the
// echo/tail split, and index.ts's header for the reference and the
// pass list. Everything here is injected after COMMON_UNIFORMS_GLSL, this
// scene's own setting uniforms, and the extra uniforms each pass declares
// (index.ts's buildSharpFragSource / buildTailFragSource).
import { NOISE_HASH_GLSL, NOISE_MASK } from "../../noiseHash.ts";
import { ECHO_FLOW_STRIDE, ECHO_HZ, ECHO_MAX, FIELD_OCTAVES } from "./driver.ts";

if (FIELD_OCTAVES !== 2) {
  // strandField below hand-unrolls exactly two octaves (a warp tap and a
  // two-frequency read) — a different FIELD_OCTAVES would silently draw
  // fewer/more offsets than the field actually reads.
  throw new Error("silk/glsl.ts: strandField assumes FIELD_OCTAVES === 2");
}

/** Mirror-fold a point into one wedge of an n-fold rotation, angle only —
 *  radius is untouched, so a caller may scale the *result* per echo and
 *  stay inside the same wedge (kaleido/glsl.ts's foldAngle does the same
 *  mod+abs idea for a normalised wedge fraction; this returns an actual
 *  Cartesian point instead, and is copied rather than imported — scenes
 *  don't import each other). */
const FOLD_GLSL = `
#define TWO_PI 6.28318530718

vec2 foldPoint(vec2 p, float n) {
  float r = length(p);
  float a = atan(p.y, p.x);
  float sector = TWO_PI / n;
  float halfSector = sector * 0.5;
  float u = mod(a + halfSector, sector) - halfSector;
  float af = abs(u);
  return r * vec2(cos(af), sin(af));
}

// Same fold, but re-expands the folded angle back out (af * n) before
// reconstructing a point — still exactly symmetric (af is already
// identical for every mirror copy, so af*n is too), but no longer confined
// to one narrow wedge's worth of angle. presence() below needs this: fed
// foldPoint's own narrow wedge, one noise cell can span the whole visible
// annulus (measured raw range collapsed to ~[0.20, 0.44] instead of
// [0.04, 0.93]), so Density had almost no picture below ~0.75 and then lit
// everything at once. The strand field itself must stay on the *true*
// narrow-wedge point — this is presence-only.
vec2 foldPointWide(vec2 p, float n) {
  float r = length(p);
  float a = atan(p.y, p.x);
  float sector = TWO_PI / n;
  float halfSector = sector * 0.5;
  float u = mod(a + halfSector, sector) - halfSector;
  float af = abs(u);
  float wide = af * n;
  return r * vec2(cos(wide), sin(wide));
}
`;

/** The noise field every echo reads, plus the presence gate that makes
 *  sparsity come from *which* lines light rather than from drawing fewer
 *  echoes (see driver.ts's header). `uEchoFlow` is filled JS-side
 *  (driver.ts's fillEchoFlows) so the field's drift never hands the GPU a
 *  raw, ever-growing morph phase — see noiseHash.ts. */
const FIELD_GLSL = `
${NOISE_HASH_GLSL}

float vnoise(vec2 p, uint seed) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hashCell(i, ${NOISE_MASK}, seed);
  float b = hashCell(i + vec2(1.0, 0.0), ${NOISE_MASK}, seed);
  float c = hashCell(i + vec2(0.0, 1.0), ${NOISE_MASK}, seed);
  float d = hashCell(i + vec2(1.0, 1.0), ${NOISE_MASK}, seed);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

uniform float uEchoFlow[${ECHO_MAX * ECHO_FLOW_STRIDE}];

// Echo k's field at q (already folded + scaled for that echo): a small
// warp from the first flow offset, then two frequencies of value noise
// from the second — cheap (four vnoise taps), organic enough for a silk
// ribbon once seen through the strand level sets below.
float strandField(vec2 q, int k) {
  int base = k * ${ECHO_FLOW_STRIDE};
  vec2 off0 = vec2(uEchoFlow[base], uEchoFlow[base + 1]);
  vec2 off1 = vec2(uEchoFlow[base + 2], uEchoFlow[base + 3]);
  vec2 w = vec2(vnoise(q * 0.7 + off0, 11u), vnoise(q * 0.7 + off0 + 5.2, 13u));
  vec2 qw = q + (w - 0.5) * 0.9;
  float v0 = vnoise(qw * 1.6 + off1, 17u);
  float v1 = vnoise(qw * 3.3 + off1 * 1.7, 19u);
  return mix(v0, v1, 0.5);
}

// Presence: a soft brightness modulation across the field, not a hard
// on/off gate — a hard gate (an earlier version of this function) cut the
// thin strand lines into disconnected blobs, which read as confetti, not
// the reference's continuous silk ribbons. Never fully zero (floors at
// PRESENCE_FLOOR), so a line stays traceable everywhere; Density raises
// how much of it dips toward that floor. Takes foldPointWide's coordinate,
// not foldPoint's (see that function's doc) — the lo range is calibrated
// (tools/.cache/refs/vKJu9mfeDS8 tuning session) against the *realised*
// range of this exact two-octave blend sampled through foldPointWide over
// the visible annulus at fold 8: raw n ~ [0.20, 0.58].
const float PRESENCE_FLOOR = 0.3;
float presence(vec2 q) {
  float lo = mix(0.5, 0.20, clamp(uDensity, 0.0, 1.0));
  float n = 0.6 * vnoise(q * 1.3 + vec2(9.1, -3.4), 29u) + 0.4 * vnoise(q * 3.1 - vec2(4.4, 7.7), 31u);
  return mix(PRESENCE_FLOOR, 1.0, smoothstep(lo, lo + 0.2, n));
}

// Cyan-dominant ramp (measured: cyan 180° dominant, spring 150° secondary,
// azure 210° a trace at the outer edge, rare amber accents) — see
// index.ts's header for the palette-share numbers this targets. Some
// regimes in the reference blend olive/gold with the cyan continuously
// (compare.png rows at t=2.48-5.27s), not just as a bar-swell accent — the
// warm mix below ties that to the regime's own hueBias (already travels
// smoothly via driver.ts's regime interpolation) rather than gating it on
// swell alone, which only lit it for an instant (Round 2 diagnosis).
vec3 strandColor(int i, int n, float r) {
  vec3 cyan = vec3(0.255, 0.812, 0.741);
  vec3 spring = vec3(0.20, 0.83, 0.47);
  vec3 azure = vec3(0.25, 0.56, 0.88);
  vec3 gold = vec3(0.78, 0.66, 0.32);
  float t = n > 1 ? float(i) / float(n - 1) : 0.0;
  vec3 col = mix(cyan, spring, clamp(t * 0.7, 0.0, 1.0));
  col = mix(col, azure, smoothstep(0.7, 1.0, r) * 0.5);
  float warm = smoothstep(0.0, 0.7, uHueBias);
  col = mix(col, gold, warm * 0.55);
  return col;
}
`;

/** Forward-difference epsilon, room half-heights — small next to a
 *  strand's own width (0.0045 * Width) so the numeric gradient resolves
 *  the line, big enough to stay well clear of fp32 noise. */
const FIELD_EPS = 0.0015;

/** Pass 1: the sharp picture. K echoes of strandField, each at its own
 *  scale (exp(-zoomRate*k/ECHO_HZ), computed here from a single uZoomRate
 *  — no per-echo scale array needed, it's a plain function of k) and its
 *  own backdated flow phase (uEchoFlow, see FIELD_GLSL). Folded ONCE per
 *  tap — folding is scale-invariant (it only touches angle), so every
 *  echo can reuse foldPoint's *result*, just scaled — but the gradient is
 *  still taken by re-running fold+field at p+eps in each axis (never
 *  fwidth after a fold: a 2×2 quad straddling a mirror line reads its
 *  neighbour as its own mirror image and under-estimates the derivative —
 *  see kaleido-scene memory). Combined with max, not sum, so echoes lining
 *  up when the zoom reverses brighten instead of flashing. */
export const SHARP_BODY = `
${FOLD_GLSL}
${FIELD_GLSL}

vec2 foldedPoint(vec2 p) {
  return mix(foldPoint(p, 8.0), foldPoint(p, 6.0), clamp(uFoldMix, 0.0, 1.0));
}

vec2 presenceCoord(vec2 p) {
  return mix(foldPointWide(p, 8.0), foldPointWide(p, 6.0), clamp(uFoldMix, 0.0, 1.0));
}

float fieldForEcho(vec2 p, int k, float scaleK) {
  vec2 q = foldedPoint(p) * scaleK * uFieldEff;
  return strandField(q, k);
}

// Returns (F, dF/dx, dF/dy) at room-space p, via forward differences of
// the *whole* pipeline (fold, scale, field) — see the file header.
vec3 fieldAndGrad(vec2 p, int k, float scaleK) {
  float f0 = fieldForEcho(p, k, scaleK);
  float fx = fieldForEcho(p + vec2(${FIELD_EPS.toFixed(4)}, 0.0), k, scaleK);
  float fy = fieldForEcho(p + vec2(0.0, ${FIELD_EPS.toFixed(4)}), k, scaleK);
  return vec3(f0, (fx - f0) / ${FIELD_EPS.toFixed(4)}, (fy - f0) / ${FIELD_EPS.toFixed(4)});
}

// Screen/lighten blend: stacks overlapping echoes into a denser, brighter
// band instead of max's "keep only the brightest one", which erased the
// reference's dense parallel-echo fringe (report.md: "feathers/combs where
// these echoes fan") down to a single visible curve — see the Silk-scene
// memory's Round 2 diagnosis. Each layer is clamped to [0,1] first so the
// result stays in [0,1] too, still saturating gracefully rather than
// flashing when echoes line up at a zoom-direction reversal — max's
// original job, kept without its density-erasing side effect.
vec3 screenBlend(vec3 base, vec3 add) {
  return 1.0 - (1.0 - base) * (1.0 - clamp(add, 0.0, 1.0));
}

void main() {
  vec2 ruv = roomUv(vUv);
  vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 p = (ruv - 0.5) * aspect * 2.0; // half-heights: |p.y| == 1 at top/bottom

  float r = length(p);
  vec2 pf0 = foldedPoint(p);
  vec2 presPf0 = presenceCoord(p);
  int nStrands = int(uStrands + 0.5);
  int kMax = int(uEchoCount + 0.5);
  float echoDecay = clamp(uEcho, 0.0, 0.995);

  vec3 combined = vec3(0.0);
  for (int k = 0; k < ${ECHO_MAX}; k++) {
    if (k >= kMax) break;
    float scaleK = exp(-uZoomRate * float(k) / ${ECHO_HZ.toFixed(1)});
    vec3 fg = fieldAndGrad(p, k, scaleK);
    float gradMag = max(length(fg.yz), 1e-3);
    float decayK = pow(echoDecay, float(k));
    float pres = presence(presPf0 * scaleK * uFieldEff);

    vec3 echoCol = vec3(0.0);
    for (int i = 0; i < 5; i++) {
      if (i >= nStrands) break;
      float ci = (float(i) + 1.0) / (float(nStrands) + 1.0) + 0.06 * uSwell;
      float d = abs(fg.x - ci) / gradMag;
      float core = exp(-pow(d / (0.0045 * max(uWidth, 0.05)), 2.0));
      float halo = exp(-d / 0.014) * 0.55;
      float side = ci - fg.x;
      float fill = smoothstep(0.0, 0.1, side) * (1.0 - smoothstep(0.1, 0.22, side)) * 0.06 * uHaze;
      vec3 col = strandColor(i, nStrands, r);
      // Amber rides the swell but only where a line is actually lit
      // (weighted by core, not the whole annulus) — a flat wash over the
      // mask read as a spreading brown glow with no strand structure
      // under it (the "amber accent wash" bug caught in the first
      // headless screenshots of this scene).
      vec3 amberTint = vec3(1.0, 0.55, 0.18) * clamp(uAccent, 0.0, 1.0) * uSwell * core;
      echoCol = screenBlend(echoCol, (core + halo + fill) * col + amberTint);
    }
    combined = screenBlend(combined, echoCol * decayK * pres);
  }

  float mask = smoothstep(uHoleEff, uHoleEff + 0.08, r) * (1.0 - smoothstep(0.78, 0.95, r));
  combined *= mask;

  vec3 ground = vec3(0.0, 0.004, 0.008);
  vec3 outCol = max(combined, ground);
  outColor = vec4(outCol, 1.0);
}
`;

/** Pass 2: the tail — the one real feedback texture, half-ish resolution,
 *  carrying only the diffuse haze beyond the K crisp echoes. Runs *after*
 *  the sharp pass each frame and reads this same frame's uSharpTex, so it
 *  lags the sharp picture by exactly one frame — invisible on a slow haze.
 *  Stored sqrt-encoded (`s = sqrt(v)`) so the per-step floor subtraction
 *  below actually reaches 0 instead of freezing above it under 8-bit
 *  rounding — see driver.ts's tailDecayStep/stepsToZero and their test.
 *  Samples outside [0,1] return black rather than the CLAMP_TO_EDGE
 *  default, which would otherwise smear the frame edge inward forever. */
export const TAIL_BODY = `
uniform sampler2D uPrevTail;
uniform sampler2D uSharpTex;

const float TAIL_FLOOR = ${(1 / 255).toFixed(6)};

void main() {
  // roomUv, not vUv directly, so this pass's room-space math lines up with
  // the sharp pass's under uViewport room-slicing too — texture(..., vUv)
  // below stays plain vUv on purpose: both targets are our own, sampled at
  // the same texture-space coordinate regardless of room mode.
  vec2 ruv = roomUv(vUv);
  vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 p = (ruv - 0.5) * aspect * 2.0;

  float s1 = exp(uZoomRate / ${ECHO_HZ.toFixed(1)});
  vec2 pPrev = p * s1;
  // Back through roomUv's own mapping, not straight to vUv: uPrevTail is
  // this device's own private target, indexed by its local vUv, which
  // only equals room-space uv when uViewport is the full {0,0,1,1} (true
  // outside a multi-device room). A point that would sample past this
  // device's own captured slice has nothing to read, same as off [0,1].
  vec2 ruvPrev = pPrev / (aspect * 2.0) + 0.5;
  vec2 uvPrev = (ruvPrev - uViewport.xy) / uViewport.zw;

  vec3 sOld = vec3(0.0);
  if (uvPrev.x >= 0.0 && uvPrev.x <= 1.0 && uvPrev.y >= 0.0 && uvPrev.y <= 1.0) {
    sOld = texture(uPrevTail, uvPrev).rgb;
  }
  float tailDecay = mix(0.85, 0.97, clamp(uEcho, 0.0, 1.0));
  vec3 sDecayed = max(sOld * sqrt(tailDecay) - vec3(TAIL_FLOOR), vec3(0.0));
  vec3 vDecayed = sDecayed * sDecayed;

  float r = length(p);
  float holeGate = smoothstep(uHoleEff * 0.8, uHoleEff, r);
  float emitGain = 0.35 * clamp(uHaze, 0.0, 1.0);
  vec3 vEmit = texture(uSharpTex, vUv).rgb * emitGain;

  vec3 vNew = (vDecayed + vEmit) * holeGate;
  outColor = vec4(sqrt(clamp(vNew, 0.0, 1.0)), 1.0);
}
`;

/** Pass 3: two-level separable Gaussian bloom — verbatim from
 *  crystal/glsl.ts's BLUR_FRAG (itself from powder.ts's chain). */
export const BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uBlurStep;

void main() {
  vec3 c = texture(uTex, vUv).rgb * 0.2270270;
  c += (texture(uTex, vUv + uBlurStep).rgb + texture(uTex, vUv - uBlurStep).rgb) * 0.1945946;
  c += (texture(uTex, vUv + uBlurStep * 2.0).rgb + texture(uTex, vUv - uBlurStep * 2.0).rgb) * 0.1216216;
  c += (texture(uTex, vUv + uBlurStep * 3.0).rgb + texture(uTex, vUv - uBlurStep * 3.0).rgb) * 0.0540541;
  c += (texture(uTex, vUv + uBlurStep * 4.0).rgb + texture(uTex, vUv - uBlurStep * 4.0).rgb) * 0.0162162;
  outColor = vec4(c, 1.0);
}
`;

/** Pass 4: sharp + two glow levels, then saturation from the level
 *  envelope (uLevelS — frame.level, not an auto-gained band, so this
 *  fades out with the song, per the reference's "saturation follows
 *  loudness continuously" finding) and brightness from the mid envelope
 *  (uBrightS — no onset term: the reference's brightness never flashes on
 *  a beat). uGA/uGB are computed in index.ts like crystal's own composite,
 *  so a quality preset with no bloom passes can zero them outright rather
 *  than sampling glow targets this frame never rendered into. */
export const COMPOSITE_BODY = `
void main() {
  vec3 sharp = texture(uSharpTex, vUv).rgb;
  vec3 glowA = texture(uGlowATex, vUv).rgb;
  vec3 glowB = texture(uGlowBTex, vUv).rgb;
  vec3 col = sharp + glowA * uGA + glowB * uGB;

  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  float satAmt = clamp(0.45 + uSatReact * uLevelS, 0.0, 1.4);
  col = mix(vec3(luma), col, satAmt);
  col *= (0.7 + 0.3 * uBrightS) * uBrightness;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
