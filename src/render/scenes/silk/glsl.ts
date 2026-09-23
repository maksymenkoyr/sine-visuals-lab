// Silk's shader bodies — see driver.ts's header for the picture and the
// echo/tail split, and index.ts's header for the reference and the
// pass list. Everything here is injected after COMMON_UNIFORMS_GLSL, this
// scene's own setting uniforms, and the extra uniforms each pass declares
// (index.ts's buildSharpFragSource / buildTailFragSource).
import { PALETTE_GLSL } from "../../palette.ts";
import { NOISE_HASH_GLSL, NOISE_MASK } from "../../noiseHash.ts";
import { ECHO_FLOW_STRIDE, ECHO_HZ, ECHO_MAX, FIELD_OCTAVES, MAX_STRANDS } from "./driver.ts";

if (FIELD_OCTAVES !== 4) {
  // strandField below hand-unrolls exactly four octaves (a warp tap and a
  // three-frequency read) — a different FIELD_OCTAVES would silently draw
  // fewer/more offsets than the field actually reads.
  throw new Error("silk/glsl.ts: strandField assumes FIELD_OCTAVES === 4");
}

/** Field-space spacing between one strand's fine trailing threads (Round 3)
 *  — screen spacing is this divided by the local field gradient, so threads
 *  fan out exactly where the reference's "feathers/combs" do (report.md).
 *  Tuned so the spacing lands near the reference's measured ~0.017
 *  half-heights (3px @ 360) at a typical gradient magnitude. */
const THREAD_STEP = 0.022;
/** Brightness falloff per thread step out from the main strand line. */
const THREAD_FALLOFF = 0.8;
/** Most threads ever drawn per strand — `threads` setting picks a fraction
 *  of this, further capped so a full band never reaches the next strand
 *  (see the sharp pass's nThreads clamp). */
const MAX_THREADS = 10;

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
// warp from the first flow offset, then three frequencies of value noise,
// each from its own flow offset (four vnoise-group taps total; Round 2's
// two-octave version read the *shared* off1 scaled by 1.7 for its second
// frequency rather than a real third octave — that scaling changed
// discontinuously right when off1 itself wrapped 256→0 (noiseHash.ts),
// a latent seam. Every octave now gets fillEchoFlows's own properly-wrapped
// offset — see driver.ts's FIELD_OCTAVES doc.) The extra high frequency is
// what turns Round 2's smooth blobby curves into the finer curls/loops the
// reference shows.
float strandField(vec2 q, int k) {
  int base = k * ${ECHO_FLOW_STRIDE};
  vec2 off0 = vec2(uEchoFlow[base], uEchoFlow[base + 1]);
  vec2 off1 = vec2(uEchoFlow[base + 2], uEchoFlow[base + 3]);
  vec2 off2 = vec2(uEchoFlow[base + 4], uEchoFlow[base + 5]);
  vec2 off3 = vec2(uEchoFlow[base + 6], uEchoFlow[base + 7]);
  vec2 w = vec2(vnoise(q * 0.7 + off0, 11u), vnoise(q * 0.7 + off0 + 5.2, 13u));
  vec2 qw = q + (w - 0.5) * 1.15;
  float v0 = vnoise(qw * 1.6 + off1, 17u);
  float v1 = vnoise(qw * 3.3 + off2, 19u);
  float v2 = vnoise(qw * 6.9 + off3, 23u);
  return mix(mix(v0, v1, 0.5), v2, 0.28);
}

// A tiny per-index hash for shader-side per-strand picks (which strands
// take the app palette — see uTint below) — same fract(sin(x)*C) shape as
// driver.ts's hash01, just single-argument since it only ever hashes a
// small integer loop index, not a (seed, k) pair.
float stripHash(float i) {
  return fract(sin(i * 12.9898) * 43758.5453);
}

// Cyclic 5-stop ramp through every measured hue (report.md: cyan 180°
// dominant, spring 150° secondary, azure 210° a trace, gold/amber accents)
// — built as a chain of smoothstep-gated mixes rather than a dynamic array
// index, which some mobile GLSL ES 3.00 compilers handle poorly in a
// fragment shader (see noiseHash.ts's header for this codebase's general
// mobile-GPU caution). Each mix only does work inside its own unit
// interval of t; outside it, its smoothstep is exactly 0 or 1, so the
// chain reads as one continuous cyclic gradient.
vec3 silkRamp(float t) {
  vec3 cyan = vec3(0.255, 0.812, 0.741);
  vec3 spring = vec3(0.20, 0.83, 0.47);
  vec3 azure = vec3(0.25, 0.56, 0.88);
  vec3 gold = vec3(0.78, 0.66, 0.32);
  vec3 amber = vec3(1.0, 0.55, 0.18);
  float tt = fract(t) * 5.0;
  vec3 col = cyan;
  col = mix(col, spring, smoothstep(0.0, 1.0, tt));
  col = mix(col, azure, smoothstep(1.0, 2.0, tt));
  col = mix(col, gold, smoothstep(2.0, 3.0, tt));
  col = mix(col, amber, smoothstep(3.0, 4.0, tt));
  col = mix(col, cyan, smoothstep(4.0, 5.0, tt));
  return col;
}

${PALETTE_GLSL}

// Picks a line's colour: normally a point on silkRamp, or — for the
// uTint share of strands (stripHash(i) < uTint, a per-strand pick so
// colours stay clean rather than mixing teal with rainbow into mud) — the
// app's own palette (src/render/palette.ts, switched from the device
// menu), so the user can push Silk past the reference's own measured hues
// with a system already wired into every scene rather than a Silk-only
// palette list (CLAUDE.md's "integrate with the existing system" rule —
// see moire/petri/slats/kaleido's own tint settings).
vec3 lineColor(float t, float tintPick) {
  return mix(silkRamp(t), palette(t, uPalA, uPalB, uPalC, uPalD), tintPick);
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

// Weighted accumulation: I (intensity) still screen-blends toward 1, so
// echoes lining up at a zoom-direction reversal saturate gracefully rather
// than flashing (max's original job) or blowing a channel out (Round 2's
// per-channel screenBlend, which let R clip to 1 while G/B kept climbing
// across stacked echoes and washed the picture to white-grey — the "why
// ours looks grey" diagnosis this round). Hue is instead a running
// weighted mean (C/W), which can never blow past any single layer's own
// saturation no matter how many layers stack. See main()'s final mix for
// the small white-hot lift applied only once, at the very end.
void accumulate(inout float I, inout vec3 C, inout float W, float w, vec3 hue) {
  float wc = clamp(w, 0.0, 1.0);
  I = 1.0 - (1.0 - I) * (1.0 - wc);
  C += hue * wc;
  W += wc;
}

void main() {
  vec2 ruv = roomUv(vUv);
  vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 p = (ruv - 0.5) * aspect * 2.0; // half-heights: |p.y| == 1 at top/bottom
  float px = 2.0 / uResolution.y; // one screen pixel, same half-height units as p

  float r = length(p);
  vec2 presPf0 = presenceCoord(p);
  int nStrands = int(uStrands + 0.5);
  int kMax = int(uEchoCount + 0.5);
  float echoDecay = clamp(uEcho, 0.0, 0.995);
  // Regime hueBias (-1..1) maps to a point on the cyclic ramp — each
  // regime leans toward a different dominant hue instead of Round 2's
  // fixed cyan-with-a-gold-mix (see silkRamp/lineColor above).
  float hueBase = 0.5 + 0.5 * clamp(uHueBias, -1.0, 1.0);
  float webRBreathed = uWebR + 0.06 * uWebBreath;
  float holeMask = smoothstep(uHoleEff, uHoleEff + 0.08, r);
  // The silk/thread annulus still closes off around r 0.78-0.95 (unchanged
  // from Round 1/2); the web reaches further out to r 1.1-1.25 so it fills
  // the corners the silk's own mask blacks out (report.md's separate,
  // dimmer corner motifs) — see the header note on the web layer below.
  float outerMaskSilk = 1.0 - smoothstep(0.78, 0.95, r);
  float outerMaskWeb = 1.0 - smoothstep(1.1, 1.25, r);

  float I = 0.0;
  vec3 C = vec3(0.0);
  float W = 0.0;

  for (int k = 0; k < ${ECHO_MAX}; k++) {
    if (k >= kMax) break;
    float scaleK = exp(-uZoomRate * float(k) / ${ECHO_HZ.toFixed(1)});
    vec3 fg = fieldAndGrad(p, k, scaleK);
    float gradMag = max(length(fg.yz), 1e-3);
    float decayK = pow(echoDecay, float(k));
    float pres = presence(presPf0 * scaleK * uFieldEff);
    int echoBase = k * ${ECHO_FLOW_STRIDE};
    vec2 echoOff0 = vec2(uEchoFlow[echoBase], uEchoFlow[echoBase + 1]);

    for (int i = 0; i < ${MAX_STRANDS}; i++) {
      if (i >= nStrands) break;
      float ci = (float(i) + 1.0) / (float(nStrands) + 1.0) + 0.06 * uSwell;
      float d = abs(fg.x - ci) / gradMag;
      float core = exp(-pow(d / (0.0045 * max(uWidth, 0.05)), 2.0));
      float halo = exp(-d / 0.014) * 0.55;
      float side = ci - fg.x;

      // Threads (Round 3): fine parallel lines trailing one side of the
      // main strand, spaced THREAD_STEP apart in field space — screen
      // spacing is that divided by the local gradient, so they fan out
      // exactly where the field is shallow (the reference's
      // "feathers/combs where echoes fan", report.md). Only the *nearest*
      // thread index is ever tested per pixel (a periodic level-set family,
      // same trick as the main strand's own single distance test), so this
      // costs one more distance test, not a loop over threads.
      float nThreadsCap = min(${MAX_THREADS.toFixed(1)}, floor(0.45 / ((float(nStrands) + 1.0) * ${THREAD_STEP.toFixed(4)})));
      float nThreads = clamp(uThreads, 0.0, 1.0) * nThreadsCap;
      float fillSpan = mix(0.22, ${MAX_THREADS.toFixed(1)} * ${THREAD_STEP.toFixed(4)}, clamp(uThreads, 0.0, 1.0));
      float fill = smoothstep(0.0, 0.1, side) * (1.0 - smoothstep(fillSpan * 0.8, fillSpan, side)) * 0.10 * uHaze;

      float tintPick = 1.0 - step(clamp(uTint, 0.0, 1.0), stripHash(float(i)));
      float tBase = hueBase + uColors * (float(i) * 0.21 + float(k) * 0.015);
      vec3 col = lineColor(tBase, tintPick);
      // Amber rides the swell but only where a line is actually lit
      // (weighted by core, not the whole annulus) — a flat wash over the
      // mask read as a spreading brown glow with no strand structure
      // under it (the "amber accent wash" bug caught in the first
      // headless screenshots of this scene). Blending the hue toward
      // amber, rather than adding a separate term on top, keeps it inside
      // the same weighted-hue accumulation as everything else.
      col = mix(col, vec3(1.0, 0.55, 0.18), clamp(uAccent, 0.0, 1.0) * uSwell * core);

      float wSilk = (core + halo + fill) * decayK * pres * holeMask * outerMaskSilk;
      accumulate(I, C, W, wSilk, col);

      float u = side / ${THREAD_STEP.toFixed(4)};
      float j = floor(u + 0.5);
      float dj = abs(u - j);
      float screenSpacing = ${THREAD_STEP.toFixed(4)} / gradMag;
      // Fades a thread band out once its screen spacing drops under ~2px,
      // so a small gallery tile or a steep gradient never turns the fan
      // into moiré instead of feathers.
      float aa = smoothstep(1.5 * px, 3.0 * px, screenSpacing);
      float gate = smoothstep(0.5, 1.0, j) * (1.0 - smoothstep(nThreads - 0.5, nThreads + 0.5, j));
      float coreW = 0.0045 * max(uWidth, 0.05);
      float thread = exp(-pow(dj * screenSpacing / (0.6 * coreW), 2.0)) * pow(${THREAD_FALLOFF.toFixed(2)}, j) * aa * gate;
      if (thread > 0.0005) {
        float tThread = tBase + j * 0.03 * uColors;
        vec3 threadCol = lineColor(tThread, tintPick);
        accumulate(I, C, W, thread * decayK * pres * holeMask * outerMaskSilk, threadCol);
      }
    }

    // The faint geometric web (Round 3): one line (a mirrored chord, which
    // reads as a star polygon) or circle (a mirrored arc, reading as a
    // rosette) per echo, folded the same way as the silk but reaching past
    // its annulus into the corners (report.md/compare.png: a thin
    // diagonal lattice or a ring of arcs visible outside the flower
    // proper, currently unmodelled). webShape/webR/webTilt travel
    // with the regime (driver.ts); webBreath adds a small independent
    // radius pulse. The wobble reuses echo k's own warp flow offset, so no
    // new flow uniform is needed for it.
    vec2 webP = foldedPoint(p) * scaleK * uFieldEff;
    vec2 wobble = (vec2(vnoise(webP * 5.0 + echoOff0, 37u), vnoise(webP * 5.0 + echoOff0 + 3.1, 41u)) - 0.5) * 0.03;
    vec2 webQ = webP + wobble;
    float chordDist = abs(dot(webQ, vec2(cos(uWebTilt), sin(uWebTilt))) - webRBreathed);
    float circleDist = abs(length(webQ - vec2(webRBreathed, 0.0)) - webRBreathed * 0.8);
    float webDist = mix(chordDist, circleDist, clamp(uWebShape, 0.0, 1.0));
    float webCore = exp(-pow(webDist / (0.5 * 0.0045 * max(uWidth, 0.05)), 2.0)) * decayK;
    float webWeight = webCore * holeMask * outerMaskWeb * clamp(uWeb, 0.0, 1.0);
    if (webWeight > 0.0005) {
      // The ramp coordinate opposite the silk's own hueBase, so the web
      // reads as gold under a cyan regime and vice versa — as in the
      // reference at 4.39s/5.27s.
      float tWeb = hueBase + 0.5 + float(k) * 0.02 * uColors;
      vec3 webHue = silkRamp(tWeb);
      accumulate(I, C, W, webWeight, webHue);
    }
  }

  vec3 hueAvg = C / max(W, 1e-4);
  // A small white-hot lift only at the very brightest cores (I close to 1)
  // — keeps the rest of the picture reading as coloured ribbons rather
  // than washing toward white the way Round 2's unbounded per-channel
  // screen blend did.
  vec3 combined = mix(hueAvg * I, vec3(I), 0.2 * I * I * I);

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
 *  than sampling glow targets this frame never rendered into.
 *  Round 2's `0.45 + ...` base stripped roughly half the sharp pass's own
 *  chroma whenever the music wasn't loud, on top of the accumulation-side
 *  grey-wash bug fixed in SHARP_BODY — raised to 0.8 so the now hue-correct
 *  picture (report.md: measured saturation 0.71) isn't muted a second time
 *  downstream; loudness still visibly pushes it further, just from a much
 *  less washed-out floor. */
export const COMPOSITE_BODY = `
void main() {
  vec3 sharp = texture(uSharpTex, vUv).rgb;
  vec3 glowA = texture(uGlowATex, vUv).rgb;
  vec3 glowB = texture(uGlowBTex, vUv).rgb;
  vec3 col = sharp + glowA * uGA + glowB * uGB;

  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  float satAmt = clamp(0.8 + 0.45 * uSatReact * uLevelS, 0.0, 1.3);
  col = mix(vec3(luma), col, satAmt);
  col *= (0.7 + 0.3 * uBrightS) * uBrightness;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
