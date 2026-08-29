/**
 * The skeleton skin: anatomical-ish bone drawn over the rig, one part per
 * bone in that bone's local frame (Y head→tail, Z front — see rig.ts). Every
 * part is wrapped in a padded-capsule bound so bones far from the pixel's
 * march point cost one distance test, not their whole shape.
 *
 * Detail scales with uDetail: below SKEL_LOD_CUTOFF the sockets, ribs,
 * condyles, fingers and toes drop out and the long bones fatten so the
 * figure still reads at half resolution and a dozen march steps.
 */
export const RIB_COUNT = 6;
const LOD_CUTOFF = 0.5;

export const SKELETON_SKIN_GLSL = `
const float SKEL_LOD_CUTOFF = ${LOD_CUTOFF.toFixed(2)};
const int RIB_COUNT = ${RIB_COUNT};

// ---- parts ------------------------------------------------------------------

// A shaft with a rounded head and a pair of condyles at the far end.
float skel_longBone(vec3 q, float len, float r, float knob, float lod) {
  float d = sdCapsuleY(q, len, r);
  if (lod < SKEL_LOD_CUTOFF) return d;
  d = smin(d, sdSphere(q, knob), 0.015);
  vec3 e = vec3(abs(q.x) - knob * 0.45, q.y - len, q.z);
  d = smin(d, sdEllipsoid(e, vec3(knob * 0.72, knob * 0.68, knob * 0.85)), 0.015);
  return d;
}

// Forearm / shin: a main bone with a thinner companion alongside it.
float skel_pairBone(vec3 q, float len, float r, float knob, float lod) {
  float d = skel_longBone(q, len, r, knob, lod);
  if (lod < SKEL_LOD_CUTOFF) return d;
  float twin = sdCapsuleY(q - vec3(r + 0.012, 0.025, 0.0), len - 0.05, r * 0.55);
  return smin(d, twin, 0.01);
}

float skel_skull(vec3 q, float lod) {
  float d = sdSphere(q - vec3(0.0, 0.125, -0.005), 0.105);
  float face = sdEllipsoid(q - vec3(0.0, 0.055, 0.035), vec3(0.07, 0.075, 0.07));
  d = smin(d, face, 0.035);
  if (lod >= SKEL_LOD_CUTOFF) {
    // Eye sockets and the nasal cavity hollowed out of the face, cheekbones added.
    vec3 e = vec3(abs(q.x) - 0.036, q.y - 0.085, q.z - 0.09);
    d = smax(d, -sdEllipsoid(e, vec3(0.03, 0.027, 0.03)), 0.008);
    vec3 nq = vec3(q.x, q.y - 0.045, q.z - 0.1);
    d = smax(d, -sdEllipsoid(nq, vec3(0.012, 0.022, 0.03)), 0.006);
    vec3 ck = vec3(abs(q.x) - 0.06, q.y - 0.05, q.z - 0.05);
    d = smin(d, sdSphere(ck, 0.018), 0.02);
  }
  // Upper teeth.
  d = min(d, sdRoundBox(q - vec3(0.0, 0.0, 0.065), vec3(0.03, 0.011, 0.012), 0.006));
  return d;
}

// The jaw hinges about its bone's head at the skull base. Points below are
// the rest-pose positions of the hinges, jaw angles and chin expressed in
// the jaw's own frame.
float skel_jaw(vec3 q) {
  vec3 m = vec3(abs(q.x), q.y, q.z);
  float d = sdSegment(m, vec3(0.08, -0.06, -0.03), vec3(0.06, -0.003, 0.067), 0.01);   // ramus
  d = smin(d, sdSegment(m, vec3(0.06, -0.003, 0.067), vec3(0.0, 0.073, 0.066), 0.012), 0.01); // body to chin
  // Lower teeth sit on the body, just behind the chin.
  d = min(d, sdRoundBox(q - vec3(0.0, 0.04, 0.05), vec3(0.028, 0.008, 0.011), 0.005));
  return d;
}

// A column of vertebrae along the bone, each with a spinous process pointing back.
float skel_spine(vec3 q, float len, float spacing, float r, float lod) {
  if (lod < SKEL_LOD_CUTOFF) return sdCapsuleY(q, len, r * 0.85);
  float core = sdCapsuleY(q, len, r * 0.5);
  float n = clamp(floor(q.y / spacing + 0.5), 0.0, floor(len / spacing));
  vec3 c = vec3(q.x, q.y - n * spacing, q.z);
  float body = sdEllipsoid(c, vec3(r, spacing * 0.3, r * 0.9));
  float proc = sdSegment(c, vec3(0.0), vec3(0.0, -spacing * 0.15, -r * 1.7), r * 0.28);
  return min(core, smin(body, proc, 0.008));
}

// Ribs, sternum, clavicles and shoulder blades, all hung off the chest bone.
float skel_chest(vec3 q, float len, float lod) {
  vec3 m = vec3(abs(q.x), q.y, q.z);
  // Clavicles reach from the sternum's top out to the shoulder joints.
  float d = sdSegment(m, vec3(0.0, 0.24, 0.06), vec3(0.19, 0.26, 0.01), 0.009);
  if (lod < SKEL_LOD_CUTOFF) {
    return min(d, sdEllipsoid(q - vec3(0.0, 0.13, 0.07), vec3(0.15, 0.13, 0.09)));
  }
  // Shoulder blades: flat plates on the back.
  d = smin(d, sdEllipsoid(m - vec3(0.11, 0.16, -0.06), vec3(0.05, 0.07, 0.012)), 0.01);
  // Ribs: rings up the chest, barrel-shaped, flattened front-to-back and
  // hung forward of the spine so their backs meet it. Each droops toward the front.
  const float SPACING = 0.04;
  float n = clamp(floor((q.y - 0.025) / SPACING + 0.5), 0.0, float(RIB_COUNT - 1));
  float y = 0.025 + n * SPACING;
  float u = y / len;
  float R = 0.07 + 0.08 * sin(3.14159 * clamp(u * 0.85 + 0.15, 0.0, 1.0));
  vec3 c = vec3(q.x, q.y - y + max(q.z, 0.0) * 0.22, (q.z - R * 0.5) * 1.35);
  float rib = sdRing(c, R, 0.0075) / 1.4;
  d = min(d, rib);
  // Sternum down the front.
  d = min(d, sdSegment(q, vec3(0.0, 0.05, 0.13), vec3(0.0, 0.235, 0.11), 0.011));
  return d;
}

float skel_pelvis(vec3 q, float lod) {
  vec3 m = vec3(abs(q.x), q.y, q.z);
  // Sacrum at the back where the spine lands.
  float d = sdEllipsoid(q - vec3(0.0, 0.05, -0.035), vec3(0.035, 0.06, 0.03));
  // Iliac wings flaring up and out.
  d = smin(d, sdEllipsoid(m - vec3(0.085, 0.07, -0.025), vec3(0.075, 0.065, 0.016)), 0.02);
  // Hip sockets the thighs plug into, and the arch closing the front.
  d = smin(d, sdSphere(m - vec3(0.1, -0.02, 0.0), 0.02), 0.02);
  d = smin(d, sdSegment(m, vec3(0.1, -0.02, 0.0), vec3(0.0, -0.03, 0.05), 0.013), 0.015);
  return d;
}

float skel_hand(vec3 q, float len, float lod) {
  float d = sdEllipsoid(q - vec3(0.0, 0.045, 0.0), vec3(0.036, 0.05, 0.012));
  if (lod < SKEL_LOD_CUTOFF) return min(d, sdCapsuleY(q, len, 0.018));
  // Four fingers by repetition across X, a thumb off one side.
  float fx = (clamp(floor(q.x / 0.018), -2.0, 1.0) + 0.5) * 0.018;
  vec3 f = vec3(q.x - fx, q.y, q.z);
  d = smin(d, sdCapsuleY(f - vec3(0.0, 0.085, 0.0), len - 0.09, 0.0065), 0.008);
  d = smin(d, sdSegment(q, vec3(0.035, 0.03, 0.0), vec3(0.06, 0.08, 0.01), 0.007), 0.01);
  return d;
}

// The foot bone runs heel to toes; its local +Z is the sole.
float skel_foot(vec3 q, float len, float lod) {
  float d = sdEllipsoid(q - vec3(0.0, 0.05, 0.0), vec3(0.03, 0.07, 0.02));
  d = smin(d, sdSphere(q - vec3(0.0, -0.01, -0.01), 0.028), 0.02);
  if (lod < SKEL_LOD_CUTOFF) return min(d, sdCapsuleY(q, len, 0.02));
  float fx = (clamp(floor(q.x / 0.017), -2.0, 1.0) + 0.5) * 0.017;
  vec3 f = vec3(q.x - fx, q.y, q.z);
  d = smin(d, sdCapsuleY(f - vec3(0.0, 0.09, 0.0), len - 0.1, 0.0075), 0.01);
  return d;
}

// ---- assembly ----------------------------------------------------------------

// Evaluate a part only when its padded capsule bound could beat the running
// minimum — everything a part draws must stay inside that bound.
#define SKEL_PART(boneId, pad, expr) { vec3 q = boneLocal(boneId, p); float len = boneLen(boneId); if (sdCapsuleY(q, len, pad) < d) d = min(d, expr); }

float skel_map(vec3 p) {
  float lod = uDetail;
  float fat = mix(1.5, 1.0, lod); // thin shafts survive a half-resolution buffer
  float d = 1e9;
  SKEL_PART(B_HEAD, 0.13, skel_skull(q, lod))
  SKEL_PART(B_JAW, 0.12, skel_jaw(q))
  SKEL_PART(B_NECK, 0.05, skel_spine(q, len, 0.026, 0.017, lod))
  SKEL_PART(B_CHEST, 0.24, min(skel_spine(q, len, 0.036, 0.024, lod), skel_chest(q, len, lod)))
  SKEL_PART(B_SPINE, 0.08, skel_spine(q, len, 0.04, 0.03, lod))
  SKEL_PART(B_PELVIS, 0.17, skel_pelvis(q, lod))
  SKEL_PART(B_L_UPPER_ARM, 0.05, skel_longBone(q, len, 0.019 * fat, 0.032, lod))
  SKEL_PART(B_R_UPPER_ARM, 0.05, skel_longBone(q, len, 0.019 * fat, 0.032, lod))
  SKEL_PART(B_L_FOREARM, 0.05, skel_pairBone(q, len, 0.015 * fat, 0.024, lod))
  SKEL_PART(B_R_FOREARM, 0.05, skel_pairBone(q, len, 0.015 * fat, 0.024, lod))
  SKEL_PART(B_L_HAND, 0.07, skel_hand(q, len, lod))
  SKEL_PART(B_R_HAND, 0.07, skel_hand(q, len, lod))
  SKEL_PART(B_L_THIGH, 0.06, skel_longBone(q, len, 0.026 * fat, 0.034, lod))
  SKEL_PART(B_R_THIGH, 0.06, skel_longBone(q, len, 0.026 * fat, 0.034, lod))
  SKEL_PART(B_L_SHIN, 0.06, skel_pairBone(q, len, 0.021 * fat, 0.034, lod))
  SKEL_PART(B_R_SHIN, 0.06, skel_pairBone(q, len, 0.021 * fat, 0.034, lod))
  SKEL_PART(B_L_FOOT, 0.07, skel_foot(q, len, lod))
  SKEL_PART(B_R_FOOT, 0.07, skel_foot(q, len, lod))
  return d;
}

vec3 skel_shade(vec3 p, vec3 n, vec3 rd, vec3 rim, float ao) {
  vec3 albedo = vec3(0.93, 0.89, 0.80);
  vec3 key = normalize(vec3(0.5, 0.8, 0.55));
  vec3 fill = normalize(vec3(-0.7, 0.1, 0.5));
  float diff = max(0.0, dot(n, key));
  float fl = max(0.0, dot(n, fill)) * 0.3;
  float spec = pow(max(0.0, dot(reflect(-key, n), -rd)), 24.0) * 0.22;
  return albedo * (0.05 + diff * 0.85 + fl) * ao + spec * ao + rim * ao;
}
`;
