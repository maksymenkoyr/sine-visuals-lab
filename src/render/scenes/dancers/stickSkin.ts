/**
 * The reference skin: every bone as one matte capsule plus a ball for the
 * head. Deliberately featureless — if a move looks wrong in this skin, the
 * rig is wrong, not the skin. Kept as a picker option for that reason.
 *
 * Skin contract (index.ts): `<prefix>_map(p)` returns the signed distance,
 * `<prefix>_shade(p, n, rd, rim)` the lit colour, both in world space using
 * only RIG_GLSL's helpers.
 */
export const STICK_SKIN_GLSL = `
float stick_map(vec3 p) {
  // Fatter at low detail so thin limbs survive a half-resolution buffer.
  float r = 0.036 * mix(1.5, 1.0, gDetail);
  float d = 1e9;
  for (int i = 0; i < BONE_COUNT; i++) {
    d = min(d, sdCapsuleY(boneLocal(i, p), boneLen(i), r));
  }
  vec3 h = boneLocal(B_HEAD, p);
  float headR = boneLen(B_HEAD) * 0.5;
  d = min(d, length(h - vec3(0.0, headR, 0.0)) - headR);
  return d;
}

vec3 stick_shade(vec3 p, vec3 n, vec3 rd, vec3 rim, float ao) {
  vec3 albedo = vec3(0.86, 0.84, 0.80);
  vec3 key = normalize(vec3(0.45, 0.8, 0.5));
  vec3 fill = normalize(vec3(-0.7, 0.2, 0.4));
  float diff = max(0.0, dot(n, key)) * 0.9 + max(0.0, dot(n, fill)) * 0.25;
  return (albedo * (0.08 + diff) + rim) * ao;
}
`;
