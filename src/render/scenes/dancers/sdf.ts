/**
 * Signed-distance primitives the skins build their bones from. Textbook
 * formulas written out here so every skin shares one copy; nothing in this
 * file knows about the rig.
 */
export const SDF_GLSL = `
float sdSphere(vec3 p, float r) { return length(p) - r; }

// Bound-preserving ellipsoid approximation (exact on the axes).
float sdEllipsoid(vec3 p, vec3 r) {
  float k0 = length(p / r);
  float k1 = max(length(p / (r * r)), 1e-6);
  return k0 * (k0 - 1.0) / k1;
}

// A ring of tube radius r, lying in the XZ plane about the local Y axis.
float sdRing(vec3 p, float R, float r) {
  vec2 q = vec2(length(p.xz) - R, p.y);
  return length(q) - r;
}

float sdRoundBox(vec3 p, vec3 b, float r) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

// Capsule between two arbitrary points.
float sdSegment(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

// Polynomial smooth union / intersection; k is the blend width.
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
float smax(float a, float b, float k) { return -smin(-a, -b, k); }
`;
