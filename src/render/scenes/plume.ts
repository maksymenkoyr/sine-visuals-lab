import { NUM_BANDS } from "../../audio/types.ts";
import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../gl.ts";
import { PALETTE_GLSL } from "../palette.ts";
import type { SceneSetting } from "../sceneSettings.ts";
import { resolveSceneSetting } from "../autoTune.ts";
import type { Scene, SceneContext } from "../scene.ts";
import { COMMON_UNIFORMS_GLSL, ROOM_UV_GLSL, settingUniformName, uploadCommonUniforms } from "../sceneCommon.ts";

// Plume — a beat-burst particle cloud hanging in a dark room, built from a
// short UE4 audio-visualizer reference (Fatboy Slim, leomediaart): a dense
// cloud of tiny cubic particles, pale blue body with a hot red core, swirls
// like a fluid while a spring pulls it back toward the centre; on a beat the
// core bursts outward and re-condenses. This extends chladni.ts's ping-pong
// RGBA8 state pattern from 2D grain positions to full 3D position + velocity.
//
// State. Three RGBA8 textures, side x side texels (particleTextureSide),
// written together in one sim pass via MRT (gl.drawBuffers across
// COLOR_ATTACHMENT0..2 — new to this repo: it's per-FBO state, set once in
// init() while that FBO — never the default framebuffer — is bound). Packing
// is chladni's packPos/unpackPos generalised off its [-1,1] position-only
// range into plain unit-range pack2([0,1])/unpack2 (texelFetch on an RGBA8
// sampler already returns normalised floats, which is what makes the unpack
// side exact), then wrapped by mapPos/mapVel for the position
// ([-WORLD_HALF, WORLD_HALF]) and velocity ([-VEL_MAX, VEL_MAX]) ranges:
//   tex0 = pack2(pos.x, pos.y)   tex1 = pack2(pos.z, vel.x)   tex2 = pack2(vel.y, vel.z)
// RGBA8 costs no EXT_color_buffer_float dependency (the webOS/Tizen targets
// vite.config.ts builds for lack it) — same reasoning as chladni's header.
//
// dt for the sim comes from frame.time deltas, not anim.dtSec: the anim
// clock free-runs every rAF tick while render() is frame-pace-capped, so
// dtSec under-counts the wall time a rendered frame actually covers (see
// chladni.ts's header for the fuller version of this argument).
//
// Walls. Positions are clamped to the room box every sim step; a particle
// that hits a face loses most of its velocity along that axis instead of
// bouncing, so it stalls at the wall for a beat or two before the centring
// spring (Attraction) drags it back — that stall-and-drift is what reads as
// the reference video's speckled walls, with no separate wall-particle
// system.
//
// Emission. Forces alone can't give the cloud structure: curl noise is
// divergence-free and the spring is radial, so a uniform ball stays a
// uniform ball. Instead the cloud is a continuous emission (see SIM_FRAG's
// respawn block): particles die at a Churn-set rate and are reborn just off
// the centre with a small outward push, so density peaks at the core and
// the flow draws fresh particles out along streamlines; a beat reburns a
// large share at once, faster, which is the reference's core splatter.
//
// Rendering. Sprites are drawn partially opaque with premultiplied alpha
// (POINT_FRAG) and lit by one directional light from the particle's
// direction off the cloud's centre (POINT_VERT's vShade), so the mass reads
// as a solid, shaded volume the way the reference's cubes do — an additive
// point cloud was tried first and could only ever be a fog that clips to
// white in the core. Colour is the room palette: a pale body at Hue and a
// hot stop two-thirds around the gradient for fast or core particles.
//
// pointGain(count) is chladni's grainGain shape, re-anchored at
// REFERENCE_PARTICLES, applied to sprite *size*: a cloud rendered at a
// fraction of the reference count (a low/floor quality tier, or the gallery
// preview's own further-reduced maxParticles — see gallery.ts's
// reducedPreviewQuality) keeps its coverage by drawing each surviving
// particle sqrt(reference/count) bigger, so it reads as a chunkier cloud
// rather than an empty one.
const ID = "plume";

/** Half-extent of the room box particles live in, along every axis. */
const WORLD_HALF = 1.0;
/** Per-axis velocity clamp. */
const VEL_MAX = 4.0;
/** Radius of the sphere particles are seeded into at init. */
const SEED_RADIUS = 0.35;

// Sim-force constants — see PLUME_GLSL/SIM_FRAG below for how each is used.
// Tuned against the reference video with the headless beat-synced
// screenshot loop (docs/tuning.md): the flow (TURB_K) dominates transport
// and the spring (ATTRACT_K) is only a leash, since the emission (Churn)
// is what keeps the cloud compact.
const ATTRACT_K = 5.0;
const SWIRL_K = 1.8;
const TURB_K = 2.5;
const TURB_SCALE = 2.5;
const PUFF_K = 4.0;
const BURST_K = 2.0;
// Emission (see SIM_FRAG's respawn block): a reborn particle starts inside a
// sphere of SPAWN_RADIUS at SPAWN_SPEED outward; on a beat, a share of the
// whole cloud (BEAT_SPAWN_SHARE at Beat Burst 1) is reborn at once with the
// burst impulse added to its speed — that is the reference's core splatter.
const SPAWN_RADIUS = 0.12;
const SPAWN_SPEED = 0.35;
const BEAT_SPAWN_SHARE = 0.3;
/** How strongly a beat's random direction (uBurstDir) bends the burst. */
const BURST_ANISO = 1.2;
/** Extra burst multiplier on a detected section drop, on top of a plain beat. */
const DROP_BURST_MULT = 1.8;
/** Half-width of the curl-noise numerical-derivative step. */
const CURL_EPS = 0.05;
// Opacity of one sprite — see POINT_FRAG.
const SPRITE_ALPHA = 0.6;

const CAM_FOCAL = 1.6;
const CAM_NEAR = 0.1;

/** Side of the square state texture that holds `count` particles. */
export function particleTextureSide(count: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(Math.max(1, count))));
}

/** Packs one unit-range [0,1] scalar into the [hi, lo] byte pair PLUME_GLSL's
 *  pack2 expects in a texel's R,G (or B,A) channel pair — see pack2/unpack2
 *  there for the GLSL half of this split. The +0.5 round can push `lo` to
 *  256 (e.g. at v01 = 0.5 exactly, which is every seeded particle's velocity
 *  — see seedState): pack2's GLSL twin never needs the clamp below because
 *  the GPU clamps an out-of-range float write to an RGBA8 target for free,
 *  but a Uint8Array assignment wraps 256 to 0 instead of clamping, so this
 *  JS side has to clamp explicitly. */
export function encode16(v01: number): [number, number] {
  const v = Math.max(0, Math.min(1, v01)) * 65535;
  const hi = Math.min(255, Math.floor(v / 256));
  const lo = Math.min(255, Math.floor(v - hi * 256 + 0.5));
  return [hi, lo];
}

/** Inverse of encode16. */
export function decode16(hi: number, lo: number): number {
  return (hi * 256 + lo) / 65535;
}

function mapPosToUnit(p: number): number {
  return Math.max(0, Math.min(1, (p / WORLD_HALF) * 0.5 + 0.5));
}

function mapVelToUnit(v: number): number {
  return Math.max(0, Math.min(1, v / (2 * VEL_MAX) + 0.5));
}

/** Initial state for a `side` x `side` particle grid: positions uniform in a
 *  sphere of radius SEED_RADIUS, velocities zero. Matches the sim shader's
 *  tex0/tex1/tex2 packing (see file header) so init() can upload this
 *  straight into the seed textures. */
export function seedState(side: number): { tex0: Uint8Array; tex1: Uint8Array; tex2: Uint8Array } {
  const n = side * side;
  const tex0 = new Uint8Array(n * 4);
  const tex1 = new Uint8Array(n * 4);
  const tex2 = new Uint8Array(n * 4);
  const [hv, lv] = encode16(mapVelToUnit(0));

  for (let i = 0; i < n; i++) {
    let x = 0;
    let y = 0;
    let z = 0;
    let d2 = 1;
    do {
      x = Math.random() * 2 - 1;
      y = Math.random() * 2 - 1;
      z = Math.random() * 2 - 1;
      d2 = x * x + y * y + z * z;
    } while (d2 > 1 || d2 === 0);

    const [hx, lx] = encode16(mapPosToUnit(x * SEED_RADIUS));
    const [hy, ly] = encode16(mapPosToUnit(y * SEED_RADIUS));
    const [hz, lz] = encode16(mapPosToUnit(z * SEED_RADIUS));

    const o = i * 4;
    tex0[o] = hx;
    tex0[o + 1] = lx;
    tex0[o + 2] = hy;
    tex0[o + 3] = ly;
    tex1[o] = hz;
    tex1[o + 1] = lz;
    tex1[o + 2] = hv;
    tex1[o + 3] = lv;
    tex2[o] = hv;
    tex2[o + 1] = lv;
    tex2[o + 2] = hv;
    tex2[o + 3] = lv;
  }
  return { tex0, tex1, tex2 };
}

/** Per-particle brightness gain so a sparse low/floor-quality cloud (or the
 *  gallery preview's further-reduced maxParticles) reads about as bright as
 *  one rendered at the reference count — chladni's grainGain shape,
 *  re-anchored here. */
export const REFERENCE_PARTICLES = 200_000;
export function pointGain(count: number): number {
  return Math.max(0.5, Math.min(6, Math.sqrt(REFERENCE_PARTICLES / Math.max(1, count))));
}

const SETTINGS: SceneSetting[] = [
  {
    key: "attraction",
    label: "Attraction",
    description: "How hard the cloud's spring pulls particles back toward the centre — soft at the core, firmer toward the rim",
    group: "Cloud",
    min: 0.2,
    max: 3,
    step: 0.05,
    default: 1.0,
    auto: { density: 0.2 },
  },
  {
    key: "turbulence",
    label: "Turbulence",
    description: "How much curl-noise flow stirs the cloud, on top of the spring and swirl",
    group: "Cloud",
    min: 0,
    max: 3,
    step: 0.05,
    default: 1.0,
    auto: { density: 0.25, brightness: 0.2 },
  },
  {
    key: "swirl",
    label: "Swirl",
    description: "Speed of the slow precessing vortex that keeps the cloud turning",
    group: "Cloud",
    min: 0,
    max: 2,
    step: 0.05,
    default: 0.6,
    auto: { tempo: 0.25 },
  },
  {
    key: "damping",
    label: "Damping",
    description: "How quickly a particle's own velocity bleeds off — low feels weightless, high settles fast",
    group: "Cloud",
    min: 0.2,
    max: 5,
    step: 0.1,
    default: 2.5,
  },
  {
    key: "churn",
    label: "Churn",
    description: "How fast particles die off and are reborn in the core -- the cloud is a continuous emission, so higher is a tighter, brighter core with shorter streaks, lower lets particles drift further before they are recycled",
    group: "Cloud",
    min: 0,
    max: 3,
    step: 0.05,
    default: 0.8,
    auto: { density: 0.2 },
  },
  {
    key: "burst",
    label: "Beat Burst",
    description: "How hard a detected beat kicks particles outward from the core",
    group: "Beat",
    min: 0,
    max: 3,
    step: 0.05,
    default: 1.2,
    auto: { pulse: 0.3, attack: 0.2 },
    reads: ["feature.onset"],
  },
  {
    key: "bassPuff",
    label: "Bass Puff",
    description: "A continuous outward push from bass energy, between beats",
    group: "Beat",
    min: 0,
    max: 2,
    step: 0.05,
    default: 0.5,
    auto: { pulse: 0.2 },
    reads: ["anim.lowOnset"],
  },
  {
    key: "heat",
    label: "Heat",
    description: "How readily fast-moving particles switch from the pale body colour to the hot core colour",
    group: "Beat",
    min: 0,
    max: 3,
    step: 0.05,
    default: 1.0,
    auto: { dynamics: 0.25 },
  },
  {
    key: "hue",
    label: "Hue",
    description: "Base hue the cloud's body and core colours sit at on the room palette",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.33,
  },
  {
    key: "size",
    label: "Particle Size",
    description: "On-screen size of each particle",
    group: "Look",
    min: 0.5,
    max: 6,
    step: 0.1,
    default: 2.2,
  },
  {
    key: "brightness",
    label: "Brightness",
    description: "Overall particle brightness",
    group: "Look",
    min: 0.2,
    max: 3,
    step: 0.05,
    default: 1.0,
    auto: { loudness: 0.2 },
  },
  {
    key: "cameraDistance",
    label: "Camera Distance",
    description: "How far back the camera orbits from the cloud",
    group: "Look",
    min: 1.5,
    max: 6,
    step: 0.1,
    default: 3.0,
  },
  {
    key: "orbit",
    label: "Orbit",
    description: "Speed of the camera's slow drift around the cloud",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.15,
  },
  {
    key: "room",
    label: "Room",
    description: "Brightness of the room's speckled walls",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
  },
];

function settingFor(key: string): SceneSetting {
  const s = SETTINGS.find((x) => x.key === key);
  if (!s) throw new Error(`plume: unknown setting ${key}`);
  return s;
}

const SETTINGS_UNIFORMS_GLSL = SETTINGS.map((s) => `uniform float ${settingUniformName(s.key)};`).join("\n");

// Shared by every program: packing/unpacking, the hash/noise family the sim
// and the room speckle both use, and the orbit camera the point pass
// projects through. Requires COMMON_UNIFORMS_GLSL and SETTINGS_UNIFORMS_GLSL
// to already be declared (roomAspect/camPos read uResolution/uViewport/
// uOrbit/uCameraDistance/uTime) — every program below emits this after both.
const PLUME_GLSL = `
const float WORLD_HALF = ${WORLD_HALF.toFixed(2)};
const float VEL_MAX = ${VEL_MAX.toFixed(2)};

// Two independent unit-range [0,1] scalars packed as 16-bit fixed point
// across an RGBA8 texel — chladni.ts's packPos/unpackPos generalised off its
// [-1,1] position-only range so the same scheme can also carry velocity.
// texelFetch on an RGBA8 sampler already returns normalised floats, which is
// what makes the unpack side exact.
vec4 pack2(vec2 v01) {
  vec2 v = clamp(v01, 0.0, 1.0) * 65535.0;
  vec2 hi = floor(v / 256.0);
  vec2 lo = floor(v - hi * 256.0 + 0.5);
  return vec4(hi.x, lo.x, hi.y, lo.y) / 255.0;
}
vec2 unpack2(vec4 c) {
  vec4 b = floor(c * 255.0 + 0.5);
  return vec2(b.r * 256.0 + b.g, b.b * 256.0 + b.a) / 65535.0;
}

// pack2's unit range wrapped by the state's own physical ranges.
float mapPos(float p) { return clamp(p / WORLD_HALF * 0.5 + 0.5, 0.0, 1.0); }
float unmapPos(float u) { return (u - 0.5) * 2.0 * WORLD_HALF; }
float mapVel(float v) { return clamp(v / (2.0 * VEL_MAX) + 0.5, 0.0, 1.0); }
float unmapVel(float u) { return (u - 0.5) * 2.0 * VEL_MAX; }

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
vec2 hash22(vec2 p) {
  return vec2(hash21(p), hash21(p + 17.13));
}
float hash31(vec3 p) {
  p = fract(p * vec3(123.34, 456.21, 789.92));
  p += dot(p, p.yzx + 45.32);
  return fract((p.x + p.y) * p.z);
}

// Value noise: a full trilinear blend of hash31 at the 8 corners of the unit
// cell (a 2D-only blend would seam badly across the axis the swirl/turbulence
// terms push particles through).
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash31(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash31(i + vec3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  float nxy0 = mix(nx00, nx10, f.y);
  float nxy1 = mix(nx01, nx11, f.y);
  return mix(nxy0, nxy1, f.z);
}

// Three decorrelated noise fields; curlNoise takes their numerical curl as a
// divergence-free flow (so it stirs the cloud without ever compressing it).
vec3 potential(vec3 p) {
  return vec3(vnoise(p), vnoise(p + vec3(31.7, 0.0, 0.0)), vnoise(p + vec3(0.0, 47.3, 0.0)));
}

vec3 curlNoise(vec3 p) {
  const float e = ${CURL_EPS.toFixed(2)};
  vec3 dx = potential(p + vec3(e, 0.0, 0.0)) - potential(p - vec3(e, 0.0, 0.0));
  vec3 dy = potential(p + vec3(0.0, e, 0.0)) - potential(p - vec3(0.0, e, 0.0));
  vec3 dz = potential(p + vec3(0.0, 0.0, e)) - potential(p - vec3(0.0, 0.0, e));
  return vec3(dy.z - dz.y, dz.x - dx.z, dx.y - dy.x) / (2.0 * e);
}

// Aspect of the full room-space canvas, not this device's slice of it —
// copied verbatim from meshGrid.ts's CAMERA_GLSL so a Panorama wall's slices
// agree on the same frustum.
float roomAspect() {
  return (uResolution.x / max(uViewport.z, 0.0001)) / (uResolution.y / max(uViewport.w, 0.0001));
}

const float CAM_FOCAL = ${CAM_FOCAL.toFixed(2)};
const float CAM_NEAR = ${CAM_NEAR.toFixed(2)};

// Orbit camera: yaw around Y at a fixed radius (Camera Distance), always
// looking back at the room's centre.
vec3 camPos() {
  float yaw = uTime * uOrbit * 0.5;
  float s = sin(yaw);
  float c = cos(yaw);
  return vec3(-uCameraDistance * s, 0.15, -uCameraDistance * c);
}

vec3 toView(vec3 world) {
  vec3 cp = camPos();
  vec3 forward = normalize(-cp);
  vec3 right = normalize(cross(forward, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, forward);
  return (world - cp) * mat3(right, up, forward); // row-vector form: dot with each column
}

// Room-space clip xy plus view-space depth in .w (matching meshGrid's toClip
// convention). The caller does the Panorama slice remap and the clip.w
// multiply-back itself, since that needs uViewport applied post-divide.
vec4 projectClip(vec3 view) {
  float viewZ = max(view.z, CAM_NEAR);
  float aspect = roomAspect();
  return vec4(view.x * CAM_FOCAL / aspect, view.y * CAM_FOCAL, 0.0, viewZ);
}
`;

const SIM_FRAG = `#version 300 es
precision highp float;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
uniform sampler2D uTex0;
uniform sampler2D uTex1;
uniform sampler2D uTex2;
uniform float uSimDt;
uniform float uSeed;
uniform float uBurstImpulse;
uniform vec3 uBurstDir; // random unit vector per beat (JS) -- each burst is a lobe, not a shell
const float BURST_ANISO = ${BURST_ANISO.toFixed(2)};
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
const float ATTRACT_K = ${ATTRACT_K.toFixed(2)};
const float SWIRL_K = ${SWIRL_K.toFixed(2)};
const float TURB_K = ${TURB_K.toFixed(2)};
const float TURB_SCALE = ${TURB_SCALE.toFixed(2)};
const float PUFF_K = ${PUFF_K.toFixed(2)};
${PLUME_GLSL}

void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  vec2 t0 = unpack2(texelFetch(uTex0, texel, 0));
  vec2 t1 = unpack2(texelFetch(uTex1, texel, 0));
  vec2 t2 = unpack2(texelFetch(uTex2, texel, 0));
  vec3 pos = vec3(unmapPos(t0.x), unmapPos(t0.y), unmapPos(t1.x));
  vec3 vel = vec3(unmapVel(t1.y), unmapVel(t2.x), unmapVel(t2.y));

  vec2 seed = gl_FragCoord.xy * 0.173 + uSeed;
  vec3 hash3 = vec3(hash21(seed), hash21(seed + 17.13), hash21(seed + 31.7));
  float hash1 = hash3.x;

  vec3 p = pos, v = vel;
  float r = length(p);
  vec3 acc = -p * uAttraction * ATTRACT_K * (0.5 + r); // spring: soft core, firm rim
  vec3 axis = normalize(vec3(0.4 * sin(uTime * 0.13), 1.0, 0.4 * cos(uTime * 0.11)));
  acc += cross(axis, p) * uSwirl * SWIRL_K; // slow precessing vortex
  // Two octaves: the base scale sets the cloud's big swirls, the finer one
  // (at half strength, scrolled the other way) tears them into filaments.
  vec3 turb = curlNoise(p * TURB_SCALE + vec3(0.0, uFlowPhase * 0.15, 0.0))
            + 0.5 * curlNoise(p * TURB_SCALE * 2.7 + vec3(uFlowPhase * 0.1, 0.0, 5.0));
  acc += turb * uTurbulence * TURB_K * (0.4 + 0.6 * uEnergy + 0.5 * uMidPulse);
  vec3 dir = normalize(p + (hash3 - 0.5) * 0.3 + vec3(1e-4)); // outward, jittered
  // One-frame beat kick (JS sets uBurstImpulse), leaning toward this beat's
  // random direction so the cloud lurches one way rather than swelling.
  v += normalize(dir + uBurstDir * BURST_ANISO) * uBurstImpulse * (0.3 + 0.7 * hash1);
  acc += dir * uBassPuff * uLowPulse * PUFF_K; // continuous bass push
  v += acc * uSimDt;
  v *= exp(-uDamping * uSimDt);
  p += v * uSimDt;

  // Walls: clamp to the room box and kill most of the velocity on any axis
  // that hit — the particle stalls at the wall for a beat or two before the
  // centring spring above drags it back. See file header.
  bvec3 hit = greaterThan(abs(p), vec3(WORLD_HALF));
  p = clamp(p, vec3(-WORLD_HALF), vec3(WORLD_HALF));
  v = mix(v, v * 0.08, vec3(hit));

  // Emission. A divergence-free flow plus a spring keeps a uniform cloud
  // uniform — no streaks can ever form from forces alone. The reference's
  // filaments and dense core come from continuous emission: particles die at
  // a Churn-set rate and are reborn just off the centre with a small outward
  // push, so density peaks at the core and the flow draws fresh particles
  // out along coherent streamlines. A beat reburns a large share at once,
  // faster (the burst impulse rides on the spawn speed), which is the splatter.
  float beatShare = clamp(uBurstImpulse / ${BURST_K.toFixed(2)} * ${BEAT_SPAWN_SHARE.toFixed(2)}, 0.0, 0.8);
  float dieChance = uChurn * uSimDt + beatShare;
  if (hash21(seed + 3.7) < dieChance) {
    // Isotropic between beats; on a beat the reborn share jets out along
    // this beat's direction (the reference's splatter goes one way per hit).
    vec3 rnd = normalize(hash3 * 2.0 - 1.0 + uBurstDir * BURST_ANISO * step(0.001, beatShare) + vec3(1e-4));
    float inner = pow(hash21(seed + 9.1), 0.3333);
    p = rnd * ${SPAWN_RADIUS.toFixed(3)} * inner;
    v = rnd * (${SPAWN_SPEED.toFixed(2)} * (0.5 + hash1) + uBurstImpulse * (0.4 + 0.6 * hash21(seed + 12.9)));
  }

  v = clamp(v, vec3(-VEL_MAX), vec3(VEL_MAX));

  o0 = pack2(vec2(mapPos(p.x), mapPos(p.y)));
  o1 = pack2(vec2(mapPos(p.z), mapVel(v.x)));
  o2 = pack2(vec2(mapVel(v.y), mapVel(v.z)));
}
`;

const BG_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
${ROOM_UV_GLSL}
${PLUME_GLSL}

void main() {
  vec2 rUv = roomUv(vUv);
  vec2 p = rUv - 0.5;
  p.x *= roomAspect();

  // Two grey speckled wall panels that brighten toward the top corners.
  float sideness = smoothstep(0.1, 0.45, abs(p.x));
  float topness = smoothstep(-0.3, 0.4, p.y);
  float wallBrightness = sideness * topness;
  float speckle = hash21(floor(gl_FragCoord.xy / 2.0));

  vec3 base = vec3(0.008, 0.009, 0.014); // near-black navy
  vec3 wallCol = vec3(0.30, 0.31, 0.35) * (0.4 + 0.6 * speckle) * wallBrightness;
  vec3 col = base + wallCol * uRoom;

  float vig = 1.0 - smoothstep(0.35, 0.95, length(p));
  col *= 0.6 + 0.4 * vig;

  outColor = vec4(col, 1.0);
}
`;

const POINT_VERT = `#version 300 es
precision highp float;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
uniform sampler2D uTex0;
uniform sampler2D uTex1;
uniform sampler2D uTex2;
uniform float uSide;
uniform float uPointGain; // count compensation goes into sprite size, see pointGain()
${PLUME_GLSL}
out float vHeat;
out float vFog;
out float vShade;

void main() {
  int side = int(uSide);
  ivec2 texel = ivec2(gl_VertexID % side, gl_VertexID / side);
  vec2 t0 = unpack2(texelFetch(uTex0, texel, 0));
  vec2 t1 = unpack2(texelFetch(uTex1, texel, 0));
  vec2 t2 = unpack2(texelFetch(uTex2, texel, 0));
  vec3 pos = vec3(unmapPos(t0.x), unmapPos(t0.y), unmapPos(t1.x));
  vec3 vel = vec3(unmapVel(t1.y), unmapVel(t2.x), unmapVel(t2.y));

  vec3 view = toView(pos);
  vec4 clip = projectClip(view);
  float viewZ = clip.w;

  // Panorama slice, applied in NDC (post perspective-divide): project into
  // the full room's clip space, remap by this device's viewport rect, then
  // re-derive clip.xy so the GPU's own divide (using the original clip.w)
  // lands correctly — copied from meshGrid's MESH_VERT.
  vec2 ndc = clip.xy / clip.w;
  vec2 uv01 = ndc * 0.5 + 0.5;
  uv01 = (uv01 - uViewport.xy) / uViewport.zw;
  clip.xy = (uv01 * 2.0 - 1.0) * clip.w;
  gl_Position = clip;

  float speed = length(vel) / VEL_MAX;
  // Hot where a particle is moving fast (a burst) or sits in the dense
  // centre — the reference's core glows red even at rest.
  float coreHeat = smoothstep(0.18, 0.0, length(pos)) * 0.8;
  vHeat = max(smoothstep(0.3, 0.85, speed * uHeat), coreHeat * min(uHeat, 1.0));
  vFog = clamp(1.3 - 0.35 * (viewZ / max(uCameraDistance, 0.1)), 0.35, 1.3);

  // A single directional light from the camera's top-left, applied per
  // particle by where it sits on the cloud (its direction from the cloud's
  // centre, in view space): the lit flank is bright, the far side falls into
  // shadow, so the mass reads as a solid, lit volume the way the reference's
  // cubes do — not as a fog. Sprites are drawn opaque-ish (POINT_FRAG), so
  // this shading is what gives the cloud its form.
  vec3 rel = view - toView(vec3(0.0));
  vShade = 0.45 + 0.55 * clamp(dot(normalize(rel + vec3(1e-4)), normalize(vec3(-0.55, 0.7, -0.45))), 0.0, 1.0);

  float resScale = max(1.0, uResolution.y / 720.0);
  gl_PointSize = max(1.0, uSize * uPointGain * resScale * (uCameraDistance / viewZ) * (1.0 + 0.6 * vHeat));
}
`;

const POINT_FRAG = `#version 300 es
precision highp float;
in float vHeat;
in float vFog;
in float vShade;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
const float SPRITE_ALPHA = ${SPRITE_ALPHA.toFixed(2)};
${PALETTE_GLSL}
${PLUME_GLSL}

void main() {
  // Square sprite (the reference's particles are little cubes), soft 1px edge.
  vec2 d = gl_PointCoord - 0.5;
  float edge = max(abs(d.x), abs(d.y));
  float aa = fwidth(edge) + 1e-4;
  float coverage = 1.0 - smoothstep(0.5 - aa, 0.5, edge);
  if (coverage <= 0.0) discard;

  vec3 cool = mix(palette(uHue, uPalA, uPalB, uPalC, uPalD), vec3(1.0), 0.55);
  vec3 hot = palette(uHue + 0.67, uPalA, uPalB, uPalC, uPalD); // two-thirds around the gradient: red against Neon's blue
  // Hot particles are emissive — the shading fades out as they heat up.
  vec3 col = mix(cool * vShade, hot, vHeat) * vFog * uBrightness * (0.7 + 0.3 * uEnergy);

  // Premultiplied, partially opaque: later-drawn particles paint over
  // earlier ones instead of summing, so a dense core never clips to white
  // and coverage (density) is what makes the body solid while the fringe
  // stays sparse. Drawn with blendFunc(ONE, ONE_MINUS_SRC_ALPHA).
  float a = SPRITE_ALPHA * coverage;
  outColor = vec4(col * a, a);
}
`;

// Reused across render() calls — declared at module scope (not per scene
// instance) since only one plumeScene singleton ever exists.
const bandsBuf = new Float32Array(NUM_BANDS);

function createPlumeScene(): Scene {
  let simProg: GLProgram | null = null;
  let bgProg: GLProgram | null = null;
  let pointProg: GLProgram | null = null;
  let quadVao: WebGLVertexArrayObject | null = null;
  let pointVao: WebGLVertexArrayObject | null = null;
  const stateTex: (WebGLTexture | null)[][] = [
    [null, null, null],
    [null, null, null],
  ];
  const stateFbo: (WebGLFramebuffer | null)[] = [null, null];
  let simTexLoc: (WebGLUniformLocation | null)[] = [null, null, null];
  let pointTexLoc: (WebGLUniformLocation | null)[] = [null, null, null];
  let read = 0;
  let side = 1;
  let particleCount = 0;
  let lastFrameTime: number | null = null;

  return {
    id: ID,
    name: "Plume",
    settings: SETTINGS,

    init(ctx: SceneContext) {
      const { gl } = ctx;
      simProg = createProgram(gl, SIM_FRAG);
      bgProg = createProgram(gl, BG_FRAG);
      pointProg = createProgram(gl, POINT_FRAG, POINT_VERT);
      simTexLoc = [
        gl.getUniformLocation(simProg.program, "uTex0"),
        gl.getUniformLocation(simProg.program, "uTex1"),
        gl.getUniformLocation(simProg.program, "uTex2"),
      ];
      pointTexLoc = [
        gl.getUniformLocation(pointProg.program, "uTex0"),
        gl.getUniformLocation(pointProg.program, "uTex1"),
        gl.getUniformLocation(pointProg.program, "uTex2"),
      ];
      quadVao = createFullscreenQuad(gl);
      // The point pass has no vertex attributes at all — every particle is
      // addressed by gl_VertexID into the state textures, chladni's
      // POINT_VERT pattern — so it draws from an empty VAO.
      pointVao = gl.createVertexArray();

      particleCount = Math.max(1, Math.floor(ctx.quality.maxParticles));
      side = particleTextureSide(particleCount);
      const seed = seedState(side);
      const seedBufs = [seed.tex0, seed.tex1, seed.tex2];

      for (let i = 0; i < 2; i++) {
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        for (let c = 0; c < 3; c++) {
          const tex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, side, side, 0, gl.RGBA, gl.UNSIGNED_BYTE, seedBufs[c]);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + c, gl.TEXTURE_2D, tex, 0);
          stateTex[i][c] = tex;
        }
        // Per-FBO state — must be set while this FBO (never the default
        // framebuffer) is bound. MRT is new to this repo; see file header.
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
          throw new Error("plume: state framebuffer incomplete");
        }
        stateFbo[i] = fbo;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);

      read = 0;
      lastFrameTime = null;
    },

    render(ctx, frame, viewport, palette, anim) {
      if (!simProg || !bgProg || !pointProg || !quadVao || !pointVao) return;
      const { gl } = ctx;

      // A previous gallery tile may leave blend on — additive blending into
      // the state textures would corrupt positions/velocities, so this goes
      // first, before anything else touches GL state.
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);

      // See file header for why frame.time and not anim.dtSec.
      const dt = lastFrameTime === null ? 1 / 60 : Math.max(0, Math.min(0.05, frame.time - lastFrameTime));
      lastFrameTime = frame.time;

      const burst = resolveSceneSetting(ID, settingFor("burst"));
      const burstImpulse = anim.onset ? burst * BURST_K * (anim.dropOnset ? DROP_BURST_MULT : 1) : 0;

      // Sim pass: step every particle from the read set into the write set.
      const write = 1 - read;
      gl.bindFramebuffer(gl.FRAMEBUFFER, stateFbo[write]);
      gl.viewport(0, 0, side, side);
      simProg.use();
      uploadCommonUniforms(simProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      simProg.setF("uSimDt", dt);
      simProg.setF("uSeed", Math.random() * 100);
      simProg.setF("uBurstImpulse", burstImpulse);
      // A fresh random direction per beat; only read by the shader on the
      // onset frame, so it needs no state across frames.
      const theta = Math.random() * Math.PI * 2;
      const z = Math.random() * 2 - 1;
      const rxy = Math.sqrt(Math.max(0, 1 - z * z));
      simProg.setV3v("uBurstDir", [Math.cos(theta) * rxy, z, Math.sin(theta) * rxy]);
      for (let c = 0; c < 3; c++) {
        gl.activeTexture(gl.TEXTURE0 + c);
        gl.bindTexture(gl.TEXTURE_2D, stateTex[read][c]);
        gl.uniform1i(simTexLoc[c], c);
      }
      drawFullscreenQuad(gl, quadVao);
      // Both hosts (app.ts / tv.ts) size the viewport to the drawing buffer
      // and only re-set it on resize; the gallery preview sets it per frame.
      // Either way the drawing buffer is the right thing to restore to.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      read = write;

      // Room.
      bgProg.use();
      uploadCommonUniforms(bgProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      drawFullscreenQuad(gl, quadVao);

      // The cloud: one point per particle, all of them — unlike chladni's
      // grain bed there's no coverage cap to thin against here.
      pointProg.use();
      uploadCommonUniforms(pointProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      pointProg.setF("uSide", side);
      pointProg.setF("uPointGain", pointGain(particleCount));
      for (let c = 0; c < 3; c++) {
        gl.activeTexture(gl.TEXTURE0 + c);
        gl.bindTexture(gl.TEXTURE_2D, stateTex[read][c]);
        gl.uniform1i(pointTexLoc[c], c);
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied, see POINT_FRAG
      gl.bindVertexArray(pointVao);
      gl.drawArrays(gl.POINTS, 0, particleCount);
      gl.bindVertexArray(null);

      // The gallery renders every scene into one shared context each tick —
      // must not leak blend state or bound textures onto the next tile.
      gl.disable(gl.BLEND);
      for (let c = 0; c < 3; c++) {
        gl.activeTexture(gl.TEXTURE0 + c);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindVertexArray(null);
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      simProg?.dispose();
      bgProg?.dispose();
      pointProg?.dispose();
      if (quadVao) gl.deleteVertexArray(quadVao);
      if (pointVao) gl.deleteVertexArray(pointVao);
      for (let i = 0; i < 2; i++) {
        if (stateFbo[i]) gl.deleteFramebuffer(stateFbo[i]);
        for (let c = 0; c < 3; c++) {
          if (stateTex[i][c]) gl.deleteTexture(stateTex[i][c]);
          stateTex[i][c] = null;
        }
        stateFbo[i] = null;
      }
      simProg = null;
      bgProg = null;
      pointProg = null;
      quadVao = null;
      pointVao = null;
      simTexLoc = [null, null, null];
      pointTexLoc = [null, null, null];
      read = 0;
      lastFrameTime = null;
    },
  };
}

export const plumeScene = createPlumeScene();
