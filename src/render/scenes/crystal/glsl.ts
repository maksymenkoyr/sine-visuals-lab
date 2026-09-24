// GLSL for Crystal Wall v4 — see index.ts's header for the picture this
// renders and why. Three programs' worth of source, kept as plain strings
// (no backticks anywhere in them — a literal backtick would end the
// template string one line early with no compile error, just a truncated
// shader) so index.ts can assemble each into a full `#version 300 es`
// source the same way fullscreenScene.ts does for a single-pass scene.

/** Pass 1 body: folds the screen into one p6m wedge, turns the wedge point
 *  into a ray, and raymarches a hex-cored, panel-lined corridor along it.
 *  Everything above `main()` is this pass's own except the SDF helpers
 *  themselves — the fold helpers (hexLocal/polar) are kept from v3; the box,
 *  hexagon and hex-prism-extrusion and capsule distance functions are
 *  Inigo Quilez's published distance functions (MIT, credited at each one
 *  below and in THIRD-PARTY-NOTICES.md), written out here the way
 *  dancers/sdf.ts writes its own copy, since this pass can't import GLSL
 *  from another module. The corridor's *composition* — which primitives,
 *  where, and how they're lit — is our own. */
export const MARCH_FRAG_BODY = `
const float PI = 3.14159265;
const float TWO_PI = 6.2831853;
const float SQRT3 = 1.7320508;
// Six mirror axes, fixed: only the lattice's scale (uLogZoom) wanders.
const float S = PI / 6.0;
// How far off-axis the wedge point (0..0.577, a hex cell's centre-to-vertex
// distance) throws the ray — see the header on why the wedge point becomes
// a ray at all.
const float WEDGE_FOV = 1.6;
// Depth period of the corridor: every this-many world units along the ray,
// a new cell (with its own hash-picked rotation and red edges) begins.
const float Z_REP = 2.4;
const int MAX_MARCH_STEPS = 80;

const vec3 EDGE_WHITE = vec3(0.92, 0.96, 1.0);
const vec3 NEON_RED = vec3(1.0, 0.045, 0.04);
const vec3 ICE = vec3(0.60, 0.82, 1.0);
// e-fold width of the edge stroke per unit distance (so it holds a constant
// width on screen) — tuned against the shot sheet toward the measured ~4 px
// stroke at 720p.
const float EDGE_W = 0.006;

// Nearest centre of the triangular lattice with spacing 1 along x
// (neighbours at (±1, 0) and (±0.5, ±sqrt3/2)); returns the offset from it.
vec2 hexLocal(vec2 p) {
  vec2 rr = vec2(1.0, SQRT3);
  vec2 hh = rr * 0.5;
  vec2 aa = mod(p, rr) - hh;
  vec2 bb = mod(p - hh, rr) - hh;
  return dot(aa, aa) < dot(bb, bb) ? aa : bb;
}

vec2 polar(float rr, float ang) {
  return rr * vec2(cos(ang), sin(ang));
}

vec2 rot2(vec2 v, float ang) {
  float c = cos(ang), s = sin(ang);
  return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
}

float hash11(float n) {
  return fract(sin(n * 127.1) * 43758.5453);
}

// ~35% of an object's edges are red-flagged (h-chosen) rather than white —
// see the header. seed just tells one object in a cell from another.
float redFlag(float h, float seed) {
  return step(hash11(h * 17.0 + seed), 0.18);
}

// A box with its corners rounded off by bevel — the textbook rounded-box
// SDF (same formula as dancers/sdf.ts's sdRoundBox, written out again here
// since this pass can't import GLSL from another module).
// Inigo Quilez's rounded-box distance (MIT) — see THIRD-PARTY-NOTICES.md
float sdBoxCh(vec3 p, vec3 b, float bevel) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - bevel;
}

// 2D hexagon distance field (flat-topped, circumradius rr) — the same shape
// v3's sdHexagon drew, extruded below into a prism.
// Inigo Quilez's hexagon distance field (MIT) — see THIRD-PARTY-NOTICES.md
float sdHexagon2(vec2 p, float rr) {
  const vec3 k = vec3(-0.8660254, 0.5, 0.5773503);
  p = abs(p);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z * rr, k.z * rr), rr);
  return length(p) * sign(p.y);
}

// Extrude the 2D hexagon along z by half-depth hh.
// Inigo Quilez's hex-prism extrusion (MIT) — see THIRD-PARTY-NOTICES.md
float sdHexPrism(vec3 p, float rr, float hh) {
  float d2 = sdHexagon2(p.xy, rr);
  float dz = abs(p.z) - hh;
  return min(max(d2, dz), 0.0) + length(max(vec2(d2, dz), 0.0));
}

// Inigo Quilez's capsule distance (MIT) — see THIRD-PARTY-NOTICES.md
float sdCapsule(vec3 p, vec3 a, vec3 b, float rad) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - rad;
}

// The middle of three values — for a box, b - abs(pLocal) is the
// per-axis distance to each face plane; the smallest is the ordinary box
// SDF, and the *second*-smallest reads as "how far from the nearest edge
// along whichever face we're on" (an actual edge has two of the three near
// zero at once). That's the measure the edge-light stroke below uses.
float midComponent(vec3 v) {
  float mx = max(v.x, max(v.y, v.z));
  float mn = min(v.x, min(v.y, v.z));
  return v.x + v.y + v.z - mx - mn;
}

// The corridor's contents at world point p. The scene itself is folded
// about the axis into 30-degree sectors (twelve-fold, like the screen), so
// whichever wedge of view the screen fold hands us always has geometry in
// it; each depth cell is spun by its own hash h, so successive rings sit at
// different angles and the picture keeps re-forming as the camera flies.
// Per cell: three tilted chamfered slabs at growing radius and depth — each
// crosses its sector obliquely, so its mirror copies join into a zigzag
// star ring, and perspective nests the rings toward the axis — a hollow hex
// ring on the axis (hollow so the camera flies through it, never into a
// flat face), and above half density x detail a hex nut and a thin radial
// rod. Returns the nearest distance; mat/edgeD/red describe the object
// it came from. edgeD is the distance, along the surface, to that object's
// nearest edge: for a box the middle component of b - abs(q); for a prism
// the larger of the rim distance and the cap distance (on a cap the cap
// distance is zero everywhere — taking the smaller lit the whole face).
float slab(vec3 lp, vec2 f, float radius, float tilt, float zc, float halfDepth, out float edgeD) {
  vec2 c = polar(radius, S * 0.5);
  vec2 rel = rot2(f - c, -(S * 0.5 + 1.5708 + tilt));
  vec3 q = vec3(rel, lp.z - zc);
  vec3 b = vec3(0.36 * radius / cos(tilt), 0.035 + 0.02 * radius, halfDepth);
  edgeD = max(0.0, midComponent(b - abs(q)));
  return sdBoxCh(q, b, 0.012);
}

float mapFull(vec3 p, out int mat, out float edgeD, out float red) {
  float zz = p.z + uTravel;
  float cellIdx = floor(zz / Z_REP);
  float h = hash11(cellIdx);
  float lz = mod(zz, Z_REP) - Z_REP * 0.5;
  float spin = h * TWO_PI + 0.2 * sin(uMorphPos * 0.7 + h * 10.0);
  float rad = length(p.xy);
  float ang = atan(p.y, p.x) + spin;
  float fa = abs(mod(ang, 2.0 * S) - S);
  vec2 f = polar(rad, fa);
  vec3 lp = vec3(f, lz);

  float fill = clamp(uDensity * uDetail * 1.6, 0.0, 1.0);
  float breathe = 0.06 * sin(uMorphPos * 0.5 + h * 6.0);

  float best = 1.0e5;
  int bestMat = 0;
  float bestEdge = 1.0e5;
  float bestRed = 0.0;
  float e;
  float d;

  d = slab(lp, f, 0.42 + breathe, 0.62, -0.75, 0.16, e);
  if (d < best) { best = d; bestMat = 1; bestEdge = e; bestRed = redFlag(h, 1.0); }
  d = slab(lp, f, 0.80 - breathe, -0.55, -0.05, 0.22, e);
  if (d < best) { best = d; bestMat = 1; bestEdge = e; bestRed = redFlag(h, 2.0); }
  d = slab(lp, f, 1.30 + breathe, 0.48, 0.65, 0.28, e);
  if (d < best) { best = d; bestMat = 1; bestEdge = e; bestRed = redFlag(h, 3.0); }

  // Hollow hex ring on the axis.
  {
    vec3 q = vec3(rot2(p.xy, spin), lz - 0.35);
    float outer = sdHexPrism(q, 0.20, 0.05);
    float inner = sdHexPrism(q, 0.145, 0.08);
    d = max(outer, -inner);
    if (d < best) {
      best = d;
      bestMat = 2;
      float rimD = min(abs(sdHexagon2(q.xy, 0.20)), abs(sdHexagon2(q.xy, 0.145)));
      bestEdge = max(rimD, abs(abs(q.z) - 0.05));
      bestRed = 0.0;
    }
  }
  if (fill > 0.5) {
    // Hex nut on the sector bisector.
    vec3 q = vec3(f - polar(0.60, S * 0.5), lz + 0.35);
    float outer = sdHexPrism(q, 0.075, 0.04);
    float inner = sdHexPrism(q, 0.045, 0.06);
    d = max(outer, -inner);
    if (d < best) {
      best = d;
      bestMat = 3;
      float rimD = min(abs(sdHexagon2(q.xy, 0.075)), abs(sdHexagon2(q.xy, 0.045)));
      bestEdge = max(rimD, abs(abs(q.z) - 0.04));
      bestRed = step(hash11(h * 17.0 + 4.0), 0.6);
    }
    // Thin radial rod along the sector ray: all of it reads as edge.
    d = sdCapsule(lp, vec3(0.28, 0.0, 0.95), vec3(1.5, 0.0, 0.95), 0.012);
    if (d < best) { best = d; bestMat = 4; bestEdge = 0.0; bestRed = redFlag(h, 5.0); }
  }

  mat = bestMat;
  edgeD = bestEdge;
  red = bestRed;
  return best;
}

float mapDist(vec3 p) {
  int m;
  float e;
  float rd0;
  return mapFull(p, m, e, rd0);
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.002, 0.0);
  return normalize(vec3(
    mapDist(p + e.xyy) - mapDist(p - e.xyy),
    mapDist(p + e.yxy) - mapDist(p - e.yxy),
    mapDist(p + e.yyx) - mapDist(p - e.yyx)
  ));
}

void main() {
  vec2 p = (roomUv(vUv) - 0.5) * 2.0;
  p.x *= uResolution.x / uResolution.y;

  // The fold, kept from v3: hexLocal finds the nearest lattice point, af
  // folds the angle into one wedge (S = PI/6), w is that wedge point in cell
  // units (r <= 0.577). v4's whole idea: w becomes a ray instead of a 2D
  // drawing coordinate — a three-mirror kaleidoscope really does tile one
  // object cell, so let the object be a real one.
  float scale = exp(uLogZoom) * uTiling;
  vec2 q = hexLocal(p / scale + vec2(uPanX, uPanY));
  float r = length(q);
  float a = atan(q.y, q.x);
  float af = abs(mod(a, 2.0 * S) - S);
  vec2 w = polar(r, af);

  // Camera roll turns the view inside the wedge; every wedge sees the same
  // rotated view, so the mirror seams stay continuous.
  vec2 wr = rot2(w, uRoll);
  vec3 rd = normalize(vec3(wr * WEDGE_FOV, 1.0));
  vec3 ro = vec3(0.0);

  float litAny = clamp(max(uBlobs, uFan), 0.0, 1.0);

  int steps = int(min(float(MAX_MARCH_STEPS), uMaxSteps));
  // Start past the near plane: geometry sliding through the camera would
  // otherwise fill the frame with one flat face.
  float t = 0.45;
  bool hit = false;
  vec3 pos = ro;
  int hitMat = 0;
  float hitEdge = 1.0e5;
  float hitRed = 0.0;
  // Closest approach to an edge-bearing surface along the ray, as an angle:
  // the halo a missed edge still throws (the measured glow around strokes).
  float nearMiss = 1.0e5;

  for (int i = 0; i < MAX_MARCH_STEPS; i++) {
    if (i >= steps) break;
    pos = ro + rd * t;
    int mat;
    float edgeD;
    float red;
    float d = mapFull(pos, mat, edgeD, red);
    nearMiss = min(nearMiss, d / t);
    float eps = 0.0015 + t * 0.0015;
    if (d < eps) {
      hit = true;
      hitMat = mat;
      hitEdge = edgeD;
      hitRed = red;
      break;
    }
    t += d * 0.9;
    if (t > 14.0) break;
  }

  float fog = mix(0.55, 0.20, uGround);
  vec3 col = vec3(0.0);
  if (hit) {
    vec3 n = calcNormal(pos);
    float facing = max(dot(n, -rd), 0.0);
    float fade = exp(-fog * t);
    // Near-black glossy panels under a key light at the camera; the ice
    // light (Blobs) floods the faces instead of the air, so the bloom turns
    // lit faces into soft blobs while the gaps between panels stay black.
    vec3 base = vec3(0.020, 0.018, 0.022);
    float atten = 1.0 / (1.0 + 0.35 * t * t);
    vec3 key = vec3(0.30, 0.34, 0.40) * facing * atten * 0.30;
    // The ice light is a ring light riding the corridor wall: only faces
    // near its radius catch it, so the bloom makes separate soft blobs and
    // the panels between them stay black (the reference's bright look).
    float ringR = 0.78 + 0.22 * sin(uMorphPos * 0.4);
    float ringD = (length(pos.xy) - ringR) / 0.30;
    float ring = exp(-ringD * ringD);
    vec3 ice = ICE * (0.35 + 0.65 * facing) * ring * (0.3 + 0.7 * atten) * 2.0 * uBlobs;
    float spec = pow(max(dot(reflect(rd, n), -rd), 0.0), 24.0) * 0.35;
    float fres = pow(1.0 - facing, 3.0);
    vec3 rim = fres * vec3(0.30, 0.34, 0.42) * 0.35;
    // Edge stroke: a constant width on screen, so the world width grows
    // with distance (one pixel subtends t / focal).
    float edgeGlow = exp(-hitEdge / (EDGE_W * t));
    vec3 whiteEdge = EDGE_WHITE * (0.75 + 1.1 * uEdges) * (1.0 - 0.5 * litAny);
    vec3 redEdge = NEON_RED * uNeon * (0.55 + 1.4 * uRed + 0.4 * uBeatSwell * uPulse);
    // A red edge dims under the ice light; it never blends toward white
    // (that blend is pink, and the reference has no pink).
    vec3 edgeCol = edgeGlow * (hitRed > 0.5 ? redEdge * (1.0 - 0.9 * litAny) : whiteEdge);
    col = (base + key + ice + vec3(spec) + rim) * fade + edgeCol * exp(-fog * 0.5 * t);
  } else {
    // The far end of the corridor: a soft lit core on the axis.
    float core = exp(-dot(wr, wr) * 9.0);
    col = vec3(0.22, 0.26, 0.32) * core * (0.35 + 0.5 * uBlobs);
  }

  // Fan: bright spokes from the axis along the mirror rays, in the wedge
  // coordinates the fold uses, so they tile exactly like everything else.
  float spokes = pow(abs(cos(6.0 * af)), 14.0) * exp(-r * 2.2) * uFan;
  col += ICE * spokes * 0.9;

  // A breath of lit air under the ice light — small, so black stays black.
  col += ICE * 0.015 * uBlobs;

  col *= 1.0 + 0.2 * uBeatSwell * uPulse;
  // Half scale on write: the target is 8-bit, and the edges and the ice
  // light run past 1; the composite doubles it back (powder's way).
  outColor = vec4(max(col, vec3(0.0)) * 0.5, 1.0);
}
`;

/** Pass 2: a separable 9-tap Gaussian, verbatim from powder.ts's BLUR_FRAG
 *  (same weights, same uBlurStep-driven two-pass horizontal/vertical use —
 *  see index.ts's render() and its own BLUR_STRIDE, which is this scene's
 *  own tuning, not powder's). */
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

/** Pass 3 body: the sharp layer plus two blurred levels, doubled back from
 *  the march pass's half-scale write, a small black point (the wide glow
 *  level otherwise veils the measured near-black ground) and one
 *  exponential shoulder so whites reach white. The weights (uSharpW, uGA,
 *  uGB) are computed in index.ts rather than from uGlow/uBlobs here: that
 *  is where the ice light defocuses the picture toward the blurred levels,
 *  and where a quality preset with no bloom passes can zero the glow
 *  outright instead of sampling targets this frame never rendered into.
 *  Needs uSharpTex/uGlowATex/uGlowBTex/uGA/uGB/uSharpW declared alongside
 *  it (index.ts's assembly). */
export const COMPOSITE_BODY = `
void main() {
  vec3 sharp = texture(uSharpTex, vUv).rgb;
  vec3 glowA = texture(uGlowATex, vUv).rgb;
  vec3 glowB = texture(uGlowBTex, vUv).rgb;
  vec3 col = (sharp * uSharpW + glowA * uGA + glowB * uGB) * 2.0;
  // One exponential shoulder: whites reach white, and a small black point
  // takes out the veil the wide glow level lays over the ground (measured
  // ground luminance 0.02).
  col = max(col - 0.012, vec3(0.0));
  col = 1.0 - exp(-col * 1.7);
  outColor = vec4(col, 1.0);
}
`;
