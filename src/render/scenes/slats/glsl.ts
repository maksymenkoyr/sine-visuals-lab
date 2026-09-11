import { settingUniformName, COMMON_UNIFORMS_GLSL } from "../../sceneCommon.ts";
import { PALETTE_GLSL } from "../../palette.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import type { SignalLink } from "../../signals.ts";

/**
 * Slats' settings table and shader sources. See index.ts's header for the
 * scene as a whole and layout.ts for the CPU-side slab/slat model these
 * shaders receive as two instanced vertex buffers (A/B, crossfaded by
 * uMorphMix — named to avoid colliding with the `morph` setting below,
 * which is seconds-per-reform, not the live crossfade progress).
 *
 * Geometry: a wall in the xz-plane facing a camera at the origin, yawed by
 * the `vanish` setting so its vanishing point sits off-centre, with a
 * shallow per-slab depth (`layers`) and a right-edge curl (`curve`). A
 * slat's own width stays a near-constant screen-pixel thickness (SLAT_HALF_WIDTH_PX
 * below) regardless of depth — only its x position and height perspective-
 * project — while `slabWidth` (layout.ts's PartitionOptions, read at
 * regeneration time in index.ts) governs how wide the slabs it's grouped
 * into are, not the slat's own thickness.
 */

export const OPACITY_DEFAULT = 0.3;

export const SETTINGS: SceneSetting[] = [
  {
    key: "slabHeight",
    label: "Band thickness",
    description: "How tall the slabs stand — the wall's overall band thickness",
    group: "Form",
    min: 0.2,
    max: 1,
    step: 0.05,
    default: 0.8,
    auto: { loudness: 0.3, dynamics: 0.2 },
  },
  {
    key: "slabWidth",
    label: "Slab width",
    description: "How wide each slab's group of slats runs",
    group: "Form",
    min: 0.1,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { density: -0.3 },
  },
  {
    key: "hair",
    label: "Hair",
    description: "Length of the thin singleton slices that fringe a slab's top and bottom",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    auto: { brightness: 0.3 },
  },
  {
    key: "layers",
    label: "Depth layers",
    description: "How many translucent copies of the wall sit behind each other",
    group: "Form",
    min: 1,
    max: 5,
    step: 1,
    default: 4,
    advanced: true,
  },
  {
    key: "pulse",
    label: "Beat kick",
    description: "Slabs grow taller and brighter on every beat",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
    auto: { pulse: 0.4, attack: 0.2 },
    reads: ["feature.onset"] satisfies readonly SignalLink[],
  },
  {
    key: "flutter",
    label: "Flutter",
    description: "Per-slat height jitter, faster as the high band rises",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    auto: { brightness: 0.25, tempo: 0.2 },
  },
  {
    key: "morph",
    label: "Reform time",
    description: "Seconds for the layout to crossfade into its next arrangement",
    group: "Motion",
    min: 0.5,
    max: 10,
    step: 0.1,
    default: 3,
    auto: { tempo: -0.3 },
  },
  {
    key: "reshuffle",
    label: "Bar reshuffle",
    description: "Chance a new bar restarts the reform early, instead of waiting out the timer",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
    advanced: true,
    auto: { dynamics: 0.25 },
  },
  {
    key: "kickDip",
    label: "Kick dip",
    description: "Brightness dips for an instant against a bass hit",
    group: "Motion",
    min: 0,
    max: 0.6,
    step: 0.05,
    default: 0.15,
    advanced: true,
    auto: { pulse: 0.2 },
    reads: ["anim.lowOnset"] satisfies readonly SignalLink[],
  },
  {
    key: "opacity",
    label: "Slat opacity",
    description: "Base translucency of a single slice — overlaps still saturate to white",
    group: "Look",
    min: 0.05,
    max: 0.8,
    step: 0.05,
    default: OPACITY_DEFAULT,
    auto: { density: 0.25 },
  },
  {
    key: "tint",
    label: "Tint",
    description: "Blends the white slats toward the room palette; 0 stays monochrome",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
  },
  {
    key: "ground",
    label: "Ground",
    description: "Brightness of the dark backdrop behind the wall",
    group: "Look",
    min: 0,
    max: 0.4,
    step: 0.02,
    default: 0.16,
    advanced: true,
  },
  {
    key: "vanish",
    label: "Vanishing point",
    description: "Shifts the camera's yaw, moving where the wall's perspective converges",
    group: "Camera",
    min: -1,
    max: 1,
    step: 0.05,
    default: -0.3,
  },
  {
    key: "curve",
    label: "Curl",
    description: "How much the wall's right edge bends toward the camera",
    group: "Camera",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
  },
  {
    key: "roll",
    label: "Roll",
    description: "A slow rotation of the whole picture about the view axis, degrees per second",
    group: "Camera",
    min: -20,
    max: 20,
    step: 1,
    default: 0,
    advanced: true,
  },
  {
    key: "glow",
    label: "Glow",
    description: "Soft halo blended over the sharp slats",
    group: "Post",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
    auto: { brightness: 0.3 },
  },
];

export const settingsUniformsGlsl = SETTINGS.map((s) => `uniform float ${settingUniformName(s.key)};`).join("\n");

// Camera/geometry constants. See index.ts's header for the reasoning behind
// a near-flat size law (a large BASE_DEPTH relative to LAYER_GAP/CURVE_DEPTH)
// instead of a full perspective-foreshortened wall.
const FOV_Y_DEG = 60;
const FOCAL_Y = 1 / Math.tan(((FOV_Y_DEG * Math.PI) / 180) / 2);
const NEAR = 0.3;
const BASE_DEPTH = 6.0;
const LAYER_GAP = 0.55;
const CURVE_DEPTH = 2.6;
const YAW_GAIN = 0.6; // radians of camera yaw at |vanish| = 1
const WALL_HALF_WIDTH = 9.5; // world units the wall's x = ±1 maps to
const BAND_WORLD_SCALE = 4.2; // world units per normalized half-height/centre unit
const SLAT_HALF_WIDTH_PX = 0.9; // fixed screen half-width, independent of depth — see file header
const FLUTTER_RATE_BASE = 1.5;
const FLUTTER_RATE_HIGH_GAIN = 6.0;
const FLUTTER_AMP_GAIN = 0.08; // on the slab core — the reference's tops stay flat
const HAIR_FLUTTER_GAIN = 0.9; // on the hairs — they flicker every frame
const CENTRE_NOISE_AMP = 0.05;
const HEIGHT_SCALE_ENERGY_BASE = 0.85;
const HEIGHT_SCALE_ENERGY_GAIN = 0.35;
const ONSET_ALPHA_PUNCH = 0.4;
const ROLL_DEG2RAD_PER_SEC = Math.PI / 180;
const TINT_PALETTE_T = 0.5;
const GLOW_WEIGHT = 1.0;
const HIGHLIGHT_KNEE = 0.75; // linear below this, then a soft roll toward white
const HIGHLIGHT_ROLL = 4.0;
export const BLUR_STRIDE = 1.6;

// Shared vertex-shader helpers: a value-noise-driven flutter, the [-1,1]²
// corner of an instanced two-triangle quad from gl_VertexID (same idiom
// ambience.ts's quadCorner uses), and the room-space -> this device's
// viewport-slice mapping (ambience.ts's toDevice, same reasoning: the
// gallery renders every scene into one shared canvas).
const SLAT_HELPERS_GLSL = `
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float valueNoise1(float x) {
  float i = floor(x);
  float f = fract(x);
  float a = hash11(i);
  float b = hash11(i + 1.0);
  float u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u);
}

vec2 quadCorner(int vertexId) {
  int c = vertexId - (vertexId / 6) * 6;
  float x = (c == 1 || c == 2 || c == 4) ? 1.0 : -1.0;
  float y = (c == 2 || c == 4 || c == 5) ? 1.0 : -1.0;
  return vec2(x, y);
}

vec2 toDevice(vec2 ndc) {
  vec2 uv01 = (ndc * 0.5 + 0.5 - uViewport.xy) / uViewport.zw;
  return uv01 * 2.0 - 1.0;
}
`;

export const SLAT_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aSlatA0; // x, slabHalfHeight, slabCentre, alpha
layout(location = 1) in vec4 aSlatA1; // layer, hairExtra, seed, slabIndex
layout(location = 2) in vec4 aSlatB0;
layout(location = 3) in vec4 aSlatB1;
${COMMON_UNIFORMS_GLSL}
${settingsUniformsGlsl}
uniform float uMorphMix; // A->B crossfade progress, eased — see file header for why not uMorph
uniform float uOnsetEnv; // layout.ts's OnsetEnvelope, fast-decay beat kick
out float vAlpha;
${SLAT_HELPERS_GLSL}

const float FOCAL_Y = ${FOCAL_Y.toFixed(6)};
const float NEAR = ${NEAR.toFixed(3)};
const float BASE_DEPTH = ${BASE_DEPTH.toFixed(3)};
const float LAYER_GAP = ${LAYER_GAP.toFixed(3)};
const float CURVE_DEPTH = ${CURVE_DEPTH.toFixed(3)};
const float YAW_GAIN = ${YAW_GAIN.toFixed(4)};
const float WALL_HALF_WIDTH = ${WALL_HALF_WIDTH.toFixed(3)};
const float BAND_WORLD_SCALE = ${BAND_WORLD_SCALE.toFixed(3)};
const float SLAT_HALF_WIDTH_PX = ${SLAT_HALF_WIDTH_PX.toFixed(3)};
const float FLUTTER_RATE_BASE = ${FLUTTER_RATE_BASE.toFixed(3)};
const float FLUTTER_RATE_HIGH_GAIN = ${FLUTTER_RATE_HIGH_GAIN.toFixed(3)};
const float FLUTTER_AMP_GAIN = ${FLUTTER_AMP_GAIN.toFixed(3)};
const float HAIR_FLUTTER_GAIN = ${HAIR_FLUTTER_GAIN.toFixed(3)};
const float CENTRE_NOISE_AMP = ${CENTRE_NOISE_AMP.toFixed(4)};
const float HEIGHT_SCALE_ENERGY_BASE = ${HEIGHT_SCALE_ENERGY_BASE.toFixed(3)};
const float HEIGHT_SCALE_ENERGY_GAIN = ${HEIGHT_SCALE_ENERGY_GAIN.toFixed(3)};
const float ROLL_DEG2RAD_PER_SEC = ${ROLL_DEG2RAD_PER_SEC.toFixed(8)};

void main() {
  vec4 p0 = mix(aSlatA0, aSlatB0, uMorphMix);
  vec4 p1 = mix(aSlatA1, aSlatB1, uMorphMix);
  float xNorm = p0.x;
  float slabHalfHeight = p0.y;
  float slabCentre = p0.z;
  float slabAlpha = p0.w;
  float layer = p1.x;
  float hairExtra = p1.y;
  float seed = p1.z;

  float flutterPhase = seed * 13.7 + uTime * (FLUTTER_RATE_BASE + FLUTTER_RATE_HIGH_GAIN * uHigh);
  float flutterN = valueNoise1(flutterPhase) * 2.0 - 1.0;
  float centreN = valueNoise1(flutterPhase * 0.63 + 31.7) * 2.0 - 1.0;

  float heightScale = uSlabHeight * (HEIGHT_SCALE_ENERGY_BASE + HEIGHT_SCALE_ENERGY_GAIN * uEnergy)
    * (1.0 + uPulse * uOnsetEnv);
  float hairN = valueNoise1(flutterPhase * 1.7 + 77.3);
  float hair = hairExtra * uHair * (1.0 - uFlutter * HAIR_FLUTTER_GAIN * hairN);
  float halfHeight = (slabHalfHeight * (1.0 + uFlutter * FLUTTER_AMP_GAIN * flutterN) + hair) * heightScale;
  float centreY = slabCentre + uFlutter * CENTRE_NOISE_AMP * centreN;

  float worldX = xNorm * WALL_HALF_WIDTH;
  float curveT = smoothstep(-0.2, 1.0, xNorm);
  float curl = curveT * curveT * curveT;
  float worldZ = BASE_DEPTH + layer * LAYER_GAP - uCurve * CURVE_DEPTH * curl;

  float yaw = uVanish * YAW_GAIN;
  float cy = cos(yaw);
  float sy = sin(yaw);
  float viewX = worldX * cy + worldZ * sy;
  float viewZ = max(-worldX * sy + worldZ * cy, NEAR);

  float worldYc = centreY * BAND_WORLD_SCALE;
  float halfHeightWorld = halfHeight * BAND_WORLD_SCALE;

  float aspect = uResolution.x / uResolution.y;
  vec2 ndcCenter = vec2(viewX * FOCAL_Y / aspect, worldYc * FOCAL_Y) / viewZ;
  float halfHeightNdc = halfHeightWorld * FOCAL_Y / viewZ;
  float halfWidthNdc = SLAT_HALF_WIDTH_PX * (2.0 / uResolution.x);

  vec2 corner = quadCorner(gl_VertexID);
  vec2 ndc = ndcCenter + vec2(corner.x * halfWidthNdc, corner.y * halfHeightNdc);

  float rollAngle = uRoll * ROLL_DEG2RAD_PER_SEC * uTime;
  float cr = cos(rollAngle);
  float sr = sin(rollAngle);
  vec2 rolled = vec2(ndc.x * cr - ndc.y * sr, ndc.x * sr + ndc.y * cr);

  vAlpha = slabAlpha;
  gl_Position = vec4(toDevice(rolled), 0.0, 1.0);
}
`;

export const SLAT_FRAG = `#version 300 es
precision highp float;
in float vAlpha;
${COMMON_UNIFORMS_GLSL}
${settingsUniformsGlsl}
${PALETTE_GLSL}
uniform float uOnsetEnv;
out vec4 outColor;

const float OPACITY_DEFAULT = ${OPACITY_DEFAULT.toFixed(3)};
const float TINT_PALETTE_T = ${TINT_PALETTE_T.toFixed(3)};
const float ONSET_ALPHA_PUNCH = ${ONSET_ALPHA_PUNCH.toFixed(3)};

void main() {
  vec3 tinted = mix(vec3(1.0), palette(TINT_PALETTE_T, uPalA, uPalB, uPalC, uPalD), uTint);
  float a = vAlpha * (uOpacity / OPACITY_DEFAULT);
  a *= 1.0 + ONSET_ALPHA_PUNCH * uOnsetEnv;
  a *= 1.0 - uKickDip * uLowPulse;
  a = clamp(a, 0.0, 1.0);
  outColor = vec4(tinted * a, a);
}
`;

export const BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uBlurStep;
// Subtracted from every tap before weighting — the first pass strips the
// ground grey so the glow is the slats' halo, not a lift of the whole frame.
uniform float uSubtract;

vec3 tap(vec2 uv) {
  return max(texture(uTex, uv).rgb - uSubtract, 0.0);
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

export const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${settingsUniformsGlsl}
uniform sampler2D uSharpTex;
uniform sampler2D uBlurTex;

const float GLOW_WEIGHT = ${GLOW_WEIGHT.toFixed(3)};
const float HIGHLIGHT_KNEE = ${HIGHLIGHT_KNEE.toFixed(3)};
const float HIGHLIGHT_ROLL = ${HIGHLIGHT_ROLL.toFixed(3)};

void main() {
  vec3 sharp = texture(uSharpTex, vUv).rgb;
  vec3 blur = texture(uBlurTex, vUv).rgb;
  // A soft knee on sharp+glow together, not glow alone, so a dense stack of
  // slats that's already near white eases into it rather than clipping hard
  // once the halo lands on top — the "saturate to white, no hard edge" look.
  vec3 col = sharp + blur * uGlow * GLOW_WEIGHT;
  vec3 over = max(col - HIGHLIGHT_KNEE, 0.0);
  col = min(col, HIGHLIGHT_KNEE) + (1.0 - HIGHLIGHT_KNEE) * (1.0 - exp(-over * HIGHLIGHT_ROLL));
  outColor = vec4(col, 1.0);
}
`;

