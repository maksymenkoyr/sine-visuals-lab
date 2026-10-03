import { PALETTE_GLSL } from "../../palette.ts";
import { COIL_RAMP } from "./coilMotion.ts";
import { DRIVE_GLSL, ROOM_UV_GLSL, settingUniformName } from "../../sceneCommon.ts";
import type { SceneSetting } from "../../sceneSettings.ts";

/** Stripe period at Stripes = 1 (log-scale). Set from a side-by-side with the
 *  ref's frames/look_4.jpg bow-tie (~7 red lines per lobe): the first
 *  estimate from counting lines over r 0.3→0.02 (≈0.4) drew about half as
 *  many bands as the ref at the same size. The Stripes setting is
 *  `period = BASE_PERIOD / stripes`, so right = more stripes. */
export const BASE_PERIOD = 0.22;

/** Fixed loop bound the JS-uniform march count (uMaxSteps, quality's own
 *  raymarchSteps — reused rather than inventing a parallel N, same idea as
 *  every raymarched scene in this repo) can't exceed; quality.raymarchSteps
 *  tops out at 96 (quality.ts), so this only ever clips a future preset. */
export const MAX_MARCH_STEPS = 128;
const BISECT_STEPS = 5;

/** The measured ground (index.ts clears the targets to it too). */
export const GROUND_RGB: readonly [number, number, number] = [170 / 255, 133 / 255, 187 / 255]; // #aa85bb

/** How much contrast a tiled copy keeps against the ground per feedback
 *  generation. docs/scenes/coil/scripts/measure_feedback.py fits it on the
 *  reference (cur = ground + a·(tiled prev − ground)); see the record's
 *  Measurements. Without it the recursion never returns to plain ground
 *  after the coil has filled a frame. */
export const FEEDBACK_FADE = 0.7;

function glslVec3(c: readonly [number, number, number]): string {
  return `vec3(${c.map((x) => x.toFixed(3)).join(", ")})`;
}
const RAMP_STOPS = COIL_RAMP.stops.map((s) => s.toFixed(2));
function rampSpan(a: number, b: number): string {
  return (COIL_RAMP.stops[b] - COIL_RAMP.stops[a]).toFixed(4);
}

export function buildSettingUniformsGlsl(settings: readonly SceneSetting[]): string {
  return settings.map((s) => `uniform float ${settingUniformName(s.key)};`).join("\n");
}

export function buildDriveUniformsGlsl(settings: readonly SceneSetting[]): string {
  return DRIVE_GLSL(settings);
}

/** G's SDF, the flow-phase-driven stack search that picks the visible
 *  nested copy, and the two-stop-per-half palette ramp — shared by every
 *  pass that needs to know "what colour is this pixel" (today, just the
 *  scene pass; a future style pass could reuse it). See coilMotion.ts's
 *  header for the model this mirrors in JS (rollShape/stepCoil) and
 *  index.ts's header for the shape-parameter uniform names below
 *  (uShape*, uF, uL, uSpinAngle — all JS-computed per frame state, never a
 *  SceneSetting, so they're declared here rather than via
 *  buildSettingUniformsGlsl). */
export const COIL_MODEL_GLSL = `
uniform float uF;
uniform float uL;
uniform float uSpinAngle;
uniform float uShapeBaseAngle;
uniform float uShapeVerm;
uniform float uShapeLobeA;
uniform float uShapeLobeB;
uniform float uShapeWobble;
uniform float uShapeTwist;
uniform float uShapeArmsBlend;

// One lobe: an ellipse (radial semi-axis a, tangential semi-axis b) centred
// uShapeVerm out along ang. The (length(n)-1)*min(a,b) form keeps the
// zero level-set exact (an ellipse boundary) while giving a reasonably
// metric-scaled SDF off it, which is what the bisection refine and the
// outer-copy edge shade both want.
float lobeSdf(vec2 q, float ca, float sa, float a, float b) {
  vec2 c = uShapeVerm * vec2(ca, sa);
  vec2 u = q - c;
  vec2 local = vec2(u.x * ca + u.y * sa, -u.x * sa + u.y * ca);
  vec2 n = local / vec2(max(a, 0.001), max(b, 0.001));
  return (length(n) - 1.0) * min(a, b);
}

// G itself: union of 4 lobes at baseAngle + j*90desg, normalised so the
// union's own outer radius reads as ~1 (outerR) — "G's own unit space" the
// model docs/scenes/coil.md describes. Lobes j=1,3 (the pair that turns a 2-arm
// shape into a 4-arm one) scale toward zero as uShapeArmsBlend -> 0, which
// is the whole arms-crossfade mechanism: never a popped lobe count, always
// a continuous shrink. wobble bends the radius by a
// cos(2*arms*phi) harmonic before the lobe test, for the pinched/bow-tie
// variety the ref's silhouettes show.
float coilSdf(vec2 q) {
  float outerR = max(uShapeVerm + max(uShapeLobeA, uShapeLobeB), 0.05);
  vec2 p = q / outerR;

  float phi = atan(p.y, p.x);
  float armsEff = mix(2.0, 4.0, uShapeArmsBlend);
  float wob = 1.0 + uShapeWobble * cos(2.0 * armsEff * phi);
  p /= max(wob, 0.2);

  // The four lobe directions are the base direction turned by 0/90/180/270
  // degrees, so one cos/sin of the base angle gives all of them.
  float c0 = cos(uShapeBaseAngle), s0 = sin(uShapeBaseAngle);
  float lobeScale13 = max(uShapeArmsBlend, 0.001);
  float d = lobeSdf(p, c0, s0, uShapeLobeA, uShapeLobeB);
  d = min(d, lobeSdf(p, -s0, c0, uShapeLobeA * lobeScale13, uShapeLobeB * lobeScale13));
  d = min(d, lobeSdf(p, -c0, -s0, uShapeLobeA, uShapeLobeB));
  d = min(d, lobeSdf(p, s0, -c0, uShapeLobeA * lobeScale13, uShapeLobeB * lobeScale13));
  return d;
}

// Copy l's own SDF at screen point p (Model section): rotate by
// R(-twist*(l-F)) then shrink by e^-l into G's unit space. Twist here is
// already the *effective* twist (rolled amount x the Twist setting) — see
// index.ts.
float copySdf(vec2 p, float l) {
  float ang = -uShapeTwist * (l - uF);
  float ca = cos(ang), sa = sin(ang);
  vec2 rp = vec2(p.x * ca - p.y * sa, p.x * sa + p.y * ca) * exp(-l);
  return coilSdf(rp);
}

// Smallest l in [lMin, L] whose copy contains p (Model section's stack
// search) — smaller copies paint on top of larger ones, so scanning from
// lMin upward and stopping at the first bracket is "smallest visible copy
// wins" by construction. lMin is a per-pixel resolution floor (a copy
// smaller than one pixel can't be told apart from its neighbours, and
// marching down to it would just burn steps). Returns false (background)
// when nothing in range contains p. found.l holds l* on success, refined by
// ${BISECT_STEPS} bisection steps once a bracket is found.
struct StackHit { bool found; float l; };

StackHit findVisibleCopy(vec2 p, float lMin, float lMax, int steps) {
  StackHit hit;
  hit.found = false;
  hit.l = lMin;
  if (lMax <= lMin) return hit;

  bool prevInside = copySdf(p, lMin) <= 0.0;
  if (prevInside) {
    hit.found = true;
    hit.l = lMin;
    return hit;
  }

  float prevL = lMin;
  float lo = lMin;
  float hi = lMin;
  bool found = false;
  for (int i = 1; i <= ${MAX_MARCH_STEPS}; i++) {
    if (i > steps) break;
    float t = float(i) / float(steps);
    float li = mix(lMin, lMax, t);
    bool inside = copySdf(p, li) <= 0.0;
    if (inside && !prevInside) {
      lo = prevL;
      hi = li;
      found = true;
      break;
    }
    prevL = li;
    prevInside = inside;
  }
  if (!found) return hit;

  for (int b = 0; b < ${BISECT_STEPS}; b++) {
    float mid = 0.5 * (lo + hi);
    if (copySdf(p, mid) <= 0.0) hi = mid; else lo = mid;
  }
  hit.found = true;
  hit.l = hi;
  return hit;
}

// One stripe period: a SHARP red edge at t=0, a solid red run, then a fade
// through pink to white by t=0.5; the same in blue through pale lilac from
// t=0.5. The run lengths give the red/blue share the ref's frames measure
// (docs/scenes/coil/scripts/palette_share.py) — the "sharp edge on one side,
// soft gradient on the other" band look.
// Measured k-means colours (index.ts's header). Generated from
// coilMotion.ts's COIL_RAMP, the table coilPaletteRGB evaluates in
// tests/coil.test.ts, so the two cannot drift apart.
vec3 paletteRamp(float t) {
  float u = fract(t);
  vec3 red = ${glslVec3(COIL_RAMP.red)};
  vec3 pink = ${glslVec3(COIL_RAMP.pink)};
  vec3 blue = ${glslVec3(COIL_RAMP.blue)};
  vec3 lilac = ${glslVec3(COIL_RAMP.lilac)};
  vec3 white = ${glslVec3(COIL_RAMP.white)};
  if (u < ${RAMP_STOPS[0]}) return red;
  if (u < ${RAMP_STOPS[1]}) return mix(red, pink, (u - ${RAMP_STOPS[0]}) / ${rampSpan(0, 1)});
  if (u < ${RAMP_STOPS[2]}) return mix(pink, white, (u - ${RAMP_STOPS[1]}) / ${rampSpan(1, 2)});
  if (u < ${RAMP_STOPS[3]}) return blue;
  if (u < ${RAMP_STOPS[4]}) return mix(blue, lilac, (u - ${RAMP_STOPS[3]}) / ${rampSpan(3, 4)});
  return mix(lilac, white, (u - ${RAMP_STOPS[4]}) / ${(1 - COIL_RAMP.stops[4]).toFixed(4)});
}
`;

/** Pass 1 — the "scene" pass (index.ts's header): per pixel, the coil
 *  colour if some nested copy contains it, else the tiled ½-scale
 *  90°-rotated previous frame (the recursive background). Renders into an
 *  offscreen target sized to the canvas (capped by quality) rather than the
 *  default framebuffer, because this frame's own output has to be sampled
 *  back as next frame's "previous frame" — see index.ts's render(). */
export function buildSceneFrag(settings: readonly SceneSetting[], commonUniformsGlsl: string): string {
  return `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${commonUniformsGlsl}
${buildSettingUniformsGlsl(settings)}
${buildDriveUniformsGlsl(settings)}
${ROOM_UV_GLSL}
${PALETTE_GLSL}
${COIL_MODEL_GLSL}
uniform sampler2D uPrevB;

void main() {
  vec2 uv = roomUv(vUv);
  vec2 p0 = (uv - 0.5) * 2.0;
  p0.x *= uResolution.x / max(uResolution.y, 1.0);
  float ca = cos(uSpinAngle), sa = sin(uSpinAngle);
  vec2 p = vec2(p0.x * ca - p0.y * sa, p0.x * sa + p0.y * ca);

  float lMin = log(2.0 / max(uResolution.y, 1.0)) - 0.5;
  // No copy reaches past rMax: copy l's silhouette sits within
  // outerR * outerR * (1 + |wobble|) of its centre in its own unit space
  // (lobes reach verm + max(a, b) = outerR, undone by coilSdf's own divide
  // and wobble), and scaling by e^l for the largest copy l = uL gives the
  // screen radius (a few percent of margin on top). A pixel outside it is
  // background without marching — most of the frame right after a reset,
  // when uL is small, and every corner pixel.
  float outerR = max(uShapeVerm + max(uShapeLobeA, uShapeLobeB), 0.05);
  float rMax = exp(uL) * outerR * outerR * (1.0 + abs(uShapeWobble)) * 1.05;
  StackHit hit;
  hit.found = false;
  hit.l = lMin;
  if (length(p) <= rMax) hit = findVisibleCopy(p, lMin, uL, int(uMaxSteps));

  if (hit.found) {
    float period = ${BASE_PERIOD.toFixed(4)} / max(uStripes, 0.05);
    float m = (hit.l - uF) / period;
    vec3 measured = paletteRamp(m);
    vec3 appPal = palette(fract(m), uPalA, uPalB, uPalC, uPalD);
    vec3 col = mix(measured, appPal, clamp(uColours, 0.0, 1.0));

    // Darken lightly toward the outer copy's own edge so the shape reads
    // as lifted off the ground, like the reference.
    float outerEdge = copySdf(p, uL);
    float lift = smoothstep(0.0, 0.06, abs(outerEdge));
    col *= mix(0.93, 1.0, lift);

    outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  } else {
    // The tiling lives in screen space (p0), not the spun coil space: the
    // ref's tiles stay on a fixed grid while the coil turns.
    vec2 C = floor(p0) + 0.5;
    vec2 d = clamp(p0 - C, -0.5, 0.5);
    // R90 (screen CCW, matching the reference's measured +rotation sign)
    // applied to the doubled tile-local offset -- see index.ts's header for
    // why this is always inside [-1,1]^2 (a 2x minification, hence the
    // explicit textureLod bias below).
    vec2 s = vec2(-d.y, d.x) * 2.0;
    // s is in half-heights; only the previous frame's central square is
    // sampled, so x is divided by the aspect (a landscape frame's sides
    // never recurse).
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 uvSample = clamp(vec2(0.5 + 0.5 * s.x / aspect, 0.5 + 0.5 * s.y), 0.0, 1.0);
    vec3 bg = textureLod(uPrevB, uvSample, 1.0).rgb;
    // Each generation fades toward the ground, so deep recursions settle
    // back to plain lavender instead of the averaged stripe colour.
    vec3 ground = vec3(${GROUND_RGB.map((c) => c.toFixed(4)).join(", ")});
    bg = mix(ground, bg, ${FEEDBACK_FADE.toFixed(3)});
    outColor = vec4(bg, 1.0);
  }
}
`;
}

/** Pass 2 — a plain copy of the just-rendered offscreen target onto the
 *  screen (index.ts's header). No roomUv here: pass 1 already applied it
 *  while computing this device's own picture, so this texture already *is*
 *  this device's exact final image; re-mapping it would double up the
 *  offset. */
export const BLIT_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uFrame;
void main() {
  outColor = texture(uFrame, vUv);
}
`;
