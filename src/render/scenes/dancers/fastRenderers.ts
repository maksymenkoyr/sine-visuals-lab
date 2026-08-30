/**
 * The two cheap renderers the `renderer` setting can pick instead of the
 * raymarcher (index.ts). Both draw the rig as capsules straight from
 * uBones, with no marching and no finite-difference normals, so a pixel
 * costs a couple of dozen dot products instead of thousands of SDF
 * evaluations — that is what lets the scene run on the `low`/`floor`
 * presets (the TVs) at all.
 *
 *   Capsules (analytic): per pixel, a bounding-sphere rejection of every
 *   bone, an exact ray–capsule intersection for the few that survive, the
 *   nearest hit wins, the normal comes from the hit point's offset from the
 *   bone axis. Real perspective, real occlusion, real lighting — the same
 *   `<skin>_shade` as the raymarcher colours it.
 *
 *   Flat (2D): each bone is projected to the screen and tested as a 2D
 *   capsule whose radius shrinks with depth; the nearest bone in depth
 *   claims the pixel and is shaded as a cylinder across its width. Reads
 *   as a lit figure from the front, costs even less, and the crisp edges
 *   suit a stylised look.
 *
 * Radii come from CAPSULE_RADII by bone name (the anatomical skin's own
 * proportions), the skull is a sphere on the head bone, and the jaw is
 * skipped — it's too small to matter at this cost level.
 */
import { BONES, BONE_COUNT, VEC4_PER_BONE, type BoneName } from "./rig.ts";

/** Capsule radius per bone for the cheap renderers; 0 skips the bone. */
export const CAPSULE_RADII: Readonly<Record<BoneName, number>> = {
  pelvis: 0.06,
  spine: 0.045,
  chest: 0.05,
  neck: 0.03,
  head: 0,
  jaw: 0,
  L_upperArm: 0.036,
  L_forearm: 0.03,
  L_hand: 0.024,
  R_upperArm: 0.036,
  R_forearm: 0.03,
  R_hand: 0.024,
  L_thigh: 0.045,
  L_shin: 0.036,
  L_foot: 0.028,
  R_thigh: 0.045,
  R_shin: 0.036,
  R_foot: 0.028,
};
/** The skull: a sphere this far up the head bone, this big. */
export const SKULL_OFFSET = 0.11;
export const SKULL_RADIUS = 0.12;

const radii = BONES.map((b) => CAPSULE_RADII[b.name as BoneName] ?? 0);

export const FAST_RENDERERS_GLSL = `
const float CAPSULE_RADII[${BONE_COUNT}] = float[${BONE_COUNT}](${radii.map((r) => r.toFixed(3)).join(", ")});
const float SKULL_OFFSET = ${SKULL_OFFSET.toFixed(3)};
const float SKULL_RADIUS = ${SKULL_RADIUS.toFixed(3)};

// Rotates v by unit quaternion q (bone -> world).
vec3 quatRot(vec4 q, vec3 v) {
  vec3 t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}
vec3 boneHead(int i) { return uBones[i * ${VEC4_PER_BONE}].xyz; }
vec3 boneTailPos(int i) {
  return boneHead(i) + quatRot(uBones[i * ${VEC4_PER_BONE} + 1], vec3(0.0, uBones[i * ${VEC4_PER_BONE}].w, 0.0));
}
vec3 skullCenter() {
  return boneHead(B_HEAD) + quatRot(uBones[B_HEAD * ${VEC4_PER_BONE} + 1], vec3(0.0, SKULL_OFFSET, 0.0));
}

// Ray vs sphere: nearest positive t, or -1.
float raySphere(vec3 ro, vec3 rd, vec3 c, float r) {
  vec3 oc = ro - c;
  float b = dot(oc, rd);
  float h = b * b - (dot(oc, oc) - r * r);
  if (h < 0.0) return -1.0;
  return -b - sqrt(h);
}

// Ray vs capsule (a, b, r): the infinite cylinder around the axis solved as
// a quadratic in the axis frame, accepted only between the ends; otherwise
// the sphere cap on the side the ray passes. Nearest positive t, or -1.
float rayCapsule(vec3 ro, vec3 rd, vec3 a, vec3 b, float r) {
  vec3 ba = b - a;
  vec3 oa = ro - a;
  float baba = dot(ba, ba), bard = dot(ba, rd), baoa = dot(ba, oa);
  float rdoa = dot(rd, oa), oaoa = dot(oa, oa);
  float A = baba - bard * bard;
  float B = baba * rdoa - baoa * bard;
  float C = baba * oaoa - baoa * baoa - r * r * baba;
  float h = B * B - A * C;
  if (h < 0.0) return -1.0;
  if (A > 1e-6) {
    float t = (-B - sqrt(h)) / A;
    float y = baoa + t * bard;
    if (y > 0.0 && y < baba) return t;
    vec3 oc = y <= 0.0 ? oa : ro - b;
    float bb = dot(rd, oc);
    float hh = bb * bb - (dot(oc, oc) - r * r);
    return hh > 0.0 ? -bb - sqrt(hh) : -1.0;
  }
  // Ray parallel to the axis: only the caps can be hit.
  float t1 = raySphere(ro, rd, a, r);
  float t2 = raySphere(ro, rd, b, r);
  if (t1 < 0.0) return t2;
  if (t2 < 0.0) return t1;
  return min(t1, t2);
}

vec3 closestOnSegment(vec3 a, vec3 b, vec3 p) {
  vec3 ba = b - a;
  float h = clamp(dot(p - a, ba) / dot(ba, ba), 0.0, 1.0);
  return a + ba * h;
}

// Capsules: analytic nearest hit over every bone. Writes the hit point and
// normal; returns false for background.
bool capsulesTrace(vec3 ro, vec3 rd, out vec3 p, out vec3 n) {
  float best = 1e9;
  int hitBone = -1;
  for (int i = 0; i < BONE_COUNT; i++) {
    float r = CAPSULE_RADII[i];
    if (r <= 0.0) continue;
    vec3 a = boneHead(i);
    vec3 b = boneTailPos(i);
    // Bounding sphere first: most bones miss most pixels.
    vec3 c = (a + b) * 0.5;
    if (raySphere(ro, rd, c, length(b - a) * 0.5 + r) < 0.0 && length(ro - c) > length(b - a) * 0.5 + r) continue;
    float t = rayCapsule(ro, rd, a, b, r);
    if (t > 0.0 && t < best) { best = t; hitBone = i; }
  }
  vec3 sc = skullCenter();
  float ts = raySphere(ro, rd, sc, SKULL_RADIUS);
  bool skull = ts > 0.0 && ts < best;
  if (skull) best = ts;
  if (hitBone < 0 && !skull) return false;
  p = ro + rd * best;
  n = skull ? normalize(p - sc) : normalize(p - closestOnSegment(boneHead(hitBone), boneTailPos(hitBone), p));
  return true;
}

// ---- Flat --------------------------------------------------------------------

// Projects a world point into the same uv space main() shoots rays from:
// xy in view units at focal FOCAL, z the view depth.
vec3 projectPoint(vec3 p, vec3 eye, vec3 right, vec3 up, vec3 fwd, float focal) {
  vec3 v = p - eye;
  float z = max(0.05, dot(v, fwd));
  return vec3(dot(v, right) * focal / z, dot(v, up) * focal / z, z);
}

// Flat: the nearest projected capsule under this pixel, shaded as a
// cylinder across its width. Returns coverage 0..1; writes a pseudo 3D
// point and normal for the skin's shade.
float flatTrace(vec2 uv, vec3 eye, vec3 right, vec3 up, vec3 fwd, float focal, out vec3 p, out vec3 n) {
  float bestZ = 1e9;
  float bestCover = 0.0;
  vec3 bestP = vec3(0.0);
  vec3 bestN = vec3(0.0, 0.0, -1.0);
  float aa = fwidth(uv.x) * 1.5;
  for (int i = 0; i < BONE_COUNT; i++) {
    float r = CAPSULE_RADII[i];
    if (r <= 0.0) continue;
    vec3 a3 = boneHead(i);
    vec3 b3 = boneTailPos(i);
    vec3 a = projectPoint(a3, eye, right, up, fwd, focal);
    vec3 b = projectPoint(b3, eye, right, up, fwd, focal);
    vec2 ba = b.xy - a.xy;
    float h = clamp(dot(uv - a.xy, ba) / max(1e-6, dot(ba, ba)), 0.0, 1.0);
    vec2 q = uv - (a.xy + ba * h);
    float z = mix(a.z, b.z, h);
    float rp = r * focal / z;
    float d = length(q);
    if (d > rp + aa || z >= bestZ) continue;
    float cover = 1.0 - smoothstep(rp - aa, rp + aa, d);
    // Cylinder across the width: the pseudo normal tilts from facing the
    // camera at the axis to the edge direction at the rim.
    float s = clamp(d / rp, 0.0, 1.0);
    vec2 dir = d > 1e-5 ? q / d : vec2(0.0, 1.0);
    vec3 side = normalize(right * dir.x + up * dir.y);
    bestZ = z;
    bestCover = cover;
    bestN = normalize(side * s - fwd * sqrt(max(0.0, 1.0 - s * s)));
    bestP = mix(a3, b3, h);
  }
  vec3 sc = skullCenter();
  vec3 s3 = projectPoint(sc, eye, right, up, fwd, focal);
  float rs = SKULL_RADIUS * focal / s3.z;
  float ds = length(uv - s3.xy);
  if (ds <= rs + aa && s3.z < bestZ) {
    float s = clamp(ds / rs, 0.0, 1.0);
    vec2 dir = ds > 1e-5 ? (uv - s3.xy) / ds : vec2(0.0, 1.0);
    vec3 side = normalize(right * dir.x + up * dir.y);
    bestCover = 1.0 - smoothstep(rs - aa, rs + aa, ds);
    bestN = normalize(side * s - fwd * sqrt(max(0.0, 1.0 - s * s)));
    bestP = sc;
  }
  p = bestP;
  n = bestN;
  return bestCover;
}
`;
