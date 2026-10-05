// Chaikin Curves' fragment shader: a Voronoi diagram computed per pixel,
// drawn as black rounded cells with thin white gaps, a white dot on every
// seed and faint grey lines joining neighbouring seeds. The seeds come from
// seeds.ts, which lays them out (and says how the lattice works) and is
// uploaded every frame as the float texture uSeeds.
//
// Candidates. A pixel takes CELL_ROWS lattice rows around its own U and, in
// each, the three columns nearest its angle, plus CHILD_ROWS rows of
// children where a kick's band is near (uKidLo..uKidHi), plus the one seed
// at the centre — the centre seed's cell is the one big central cell inside
// launch.ts's front, so a pixel inside the front takes the first rows past
// the front instead of its own. Distances are true screen distances, so the
// cells are an honest Voronoi (power) diagram on screen, not a warped one.
//
// Drawing. Inside the nearest seed's cell, the distance to the boundary is
// the distance to the nearest neighbour's bisector (shifted by the two
// weights), except near the corner it shares with the second nearest, where
// it is the distance to a circle tangent to both — every corner rounded to
// the same share of its cell, and an obtuse corner barely at all, as a
// circle of that radius would. (A smooth minimum over all the bisectors was
// tried first: over a many-sided cell's nearly parallel edges it eroded the
// whole outline, not just the corners.) The white gap is that distance under
// half the Edges width; the dots are distances to every candidate seed; a
// line runs from the cell's seed toward a candidate whose bisector really is
// an edge of the cell (a one-dimensional feasibility check of the bisector
// against every other half-plane). Two things fade to white: cells only a
// few pixels across, where the per-pixel picture would only shimmer (to the
// share of white they average to), and whole cells whose seed is inside
// CORE_FADE_OUT of the centre, which are narrower in angle than in radius
// there and need more columns than a row searches — together, the white
// core at the centre of the zoom, ragged along the cells' outlines.
//
// Cost. Up to three passes over the candidates, each fetching them afresh
// from the texture: the nearest seed; the edges, dots and line candidates;
// then, only for a pixel near a corner or a line, the checks that need
// every other bisector. Holding the candidates in the shader cost more per
// frame than fetching them: generated in the shader, they had to be kept in
// registers or rebuilt each pass, and either was over twice as slow
// (docs/scenes/chaikin.md's Measurements).
import { CORE_R } from "./launch.ts";
import { MAX_ROWS, PHASE_COL, ROW_LO } from "./seeds.ts";

/** One pixel at 720 lines, in half-heights: the reference's widths are
 *  measured in its 720×720 pixels. */
const PX720 = 1 / 360;

const CELL_ROWS = 4;
const CHILD_ROWS = 3;

export const CHAIKIN_UNIFORMS_GLSL = `
uniform highp sampler2D uSeeds;
uniform float uRows;
uniform float uZFrac;
uniform float uFront;
uniform float uKidLo;
uniform float uKidHi;
`;

/** The candidate loop, written out once per pass: `body` sees `s` (the
 *  seed's texel) and `id` (unique per candidate; the centre seed, handled
 *  outside the loop, is 0). */
const eachCandidate = (body: string): string => `
  for (int r = 0; r < ${CELL_ROWS + CHILD_ROWS}; r++) {
    bool child = r >= ${CELL_ROWS};
    if (child && !gKids) break;
    float iLoc = child ? gKid0 + float(r - ${CELL_ROWS}) : gRow0 + float(r);
    float t = iLoc - ${ROW_LO.toFixed(1)};
    if (t < 0.0 || t >= uRows) continue;
    int ti = int(t) + (child ? ${MAX_ROWS} : 0);
    float c0 = floor(gThCols - texelFetch(uSeeds, ivec2(${PHASE_COL}, ti), 0).x);
    for (int k = -1; k <= 1; k++) {
      vec4 s = texelFetch(uSeeds, ivec2(int(mod(c0 + float(k), gCols)), ti), 0);
      if (s.w <= 0.0) continue;
      int id = 2 + r * 3 + k;
      ${body}
    }
  }`;

export const CHAIKIN_FRAG = `
const float TAU = 6.28318530718;
const float CORE_R = ${CORE_R.toFixed(4)};
const vec4 CENTRE = vec4(0.0, 0.0, 0.0, 1.0);

const float EDGE_HALF = ${(0.75 * PX720).toFixed(6)};
const float DOT_R = ${(2 * PX720).toFixed(6)};
const float LINE_HALF = ${(0.6 * PX720).toFixed(6)};
const float LINE_LUM = 0.42;
const float LINE_FLOOR = 0.6;
const float LINE_GAIN = 0.8;
// Corner radius at Round 1, as a share of the cell size.
const float ROUND_K = 0.22;
// The per-pixel picture fades to its average between these cell sizes (px),
// and for seeds inside this span of radii (half-heights).
const float CORE_PX0 = 2.0;
const float CORE_PX1 = 4.0;
const float CORE_FADE_IN = 0.045;
const float CORE_FADE_OUT = 0.09;

float gCols, gDelta, gThCols, gRow0, gKid0, gPx, gDotR;
bool gKids;
vec2 gP;

// The bisector of s0 and s as dot(x, n) = h, shifted by their weights.
float bisector(vec4 s0, vec4 s, out vec2 n) {
  vec2 D = s.xy - s0.xy;
  float iL = inversesqrt(max(dot(D, D), 1e-18));
  n = D * iL;
  return dot(0.5 * (s0.xy + s.xy), n) + (s0.z - s.z) * 0.5 * iL;
}

// ---- pass state ----
int n0;
vec4 s0;
float best;
float ea, eb, ha, hb;
int ia, ib;
vec2 na, nb;
float dotD;
float cov1, cov2, lh1, lh2, la1, la2;
int l1, l2;
vec2 ln1, ln2;
bool corner, want1, want2;
vec2 vtx, q1, t1, q2, t2;
float lo1, hi1, lo2, hi2;

void nearest(vec4 s, int id) {
  vec2 dv = gP - s.xy;
  float pw = dot(dv, dv) - s.z;
  if (pw < best) {
    best = pw;
    n0 = id;
    s0 = s;
  }
}

// Pass 2: the two nearest bisectors, the dots, and the two segments from s0
// that pass nearest the pixel.
void survey(vec4 s, int id) {
  if (id == n0) return;
  vec2 n;
  float h = bisector(s0, s, n);
  float ei = h - dot(gP, n);
  if (ei < ea) {
    eb = ea; ib = ia; nb = na; hb = ha;
    ea = ei; ia = id; na = n; ha = h;
  } else if (ei < eb) {
    eb = ei; ib = id; nb = n; hb = h;
  }
  vec2 dv = gP - s.xy;
  float d2 = dot(dv, dv);
  float reach = gDotR + 2.0 * gPx;
  if (d2 < reach * reach) dotD = min(dotD, sqrt(d2) - gDotR * s.w);
  vec2 D = s.xy - s0.xy;
  float DD = dot(D, D);
  vec2 q = gP - s0.xy;
  float t = clamp(dot(q, D) / max(DD, 1e-12), 0.0, 1.0);
  vec2 off = q - D * t;
  float lreach = LINE_HALF + gPx;
  if (dot(off, off) >= lreach * lreach) return;
  float cov = clamp((LINE_HALF - length(off)) / gPx + 0.5, 0.0, 1.0);
  if (cov > cov1) {
    cov2 = cov1; l2 = l1; ln2 = ln1; lh2 = lh1; la2 = la1;
    cov1 = cov; l1 = id; ln1 = n; lh1 = h; la1 = s.w;
  } else if (cov > cov2) {
    cov2 = cov; l2 = id; ln2 = n; lh2 = h; la2 = s.w;
  }
}

// Narrows [lo, hi], the stretch of the bisector q + t·dir that is still a
// candidate edge, by the half-plane dot(x, nj) <= hj.
void clipEdge(vec2 q, vec2 dir, vec2 nj, float hj, inout float lo, inout float hi) {
  float den = dot(dir, nj);
  float num = hj - dot(q, nj);
  if (abs(den) < 1e-9) {
    if (num < 0.0) hi = lo - 1.0;
    return;
  }
  float tt = num / den;
  if (den > 0.0) hi = min(hi, tt);
  else lo = max(lo, tt);
}

// Pass 3: the corner is real only if every other half-plane holds where the
// two bisectors meet (else a third edge cuts between them); a line is drawn
// only if its bisector is an edge.
void verify(vec4 s, int id) {
  if (id == n0) return;
  vec2 n;
  float h = bisector(s0, s, n);
  if (corner && id != ia && id != ib && h - dot(vtx, n) < -1e-6) corner = false;
  if (want1 && id != l1) clipEdge(q1, t1, n, h, lo1, hi1);
  if (want2 && id != l2) clipEdge(q2, t2, n, h, lo2, hi2);
}

void main() {
  float aspect = (uResolution.x / max(uViewport.z, 1e-4)) / (uResolution.y / max(uViewport.w, 1e-4));
  vec2 p = (roomUv(vUv) - 0.5) * 2.0;
  p.x *= aspect;
  gP = p;
  gPx = 2.0 * uViewport.w / uResolution.y;

  gCols = floor(uCells + 0.5);
  gDelta = TAU / gCols;
  gDotR = uDots * DOT_R;

  float pr = length(p);
  float up = asinh(pr / CORE_R);
  gThCols = atan(p.y, p.x) / gDelta;
  float a = up / gDelta - uZFrac;
  float iF = floor(uFront / gDelta - uZFrac);
  gRow0 = max(floor(a - 0.5) - 1.0, iF - 1.0);
  gKid0 = floor(a - 0.5) - 1.0;
  gKids = up > uKidLo && up < uKidHi;

  n0 = 0;
  s0 = CENTRE;
  best = dot(p, p);
${eachCandidate("nearest(s, id);")}

  ea = 1e30; eb = 1e30; ha = 0.0; hb = 0.0; ia = -1; ib = -1; na = vec2(0.0); nb = vec2(0.0);
  dotD = length(p - s0.xy) - gDotR * s0.w;
  cov1 = 0.0; cov2 = 0.0; l1 = -1; l2 = -1; ln1 = vec2(0.0); ln2 = vec2(0.0);
  lh1 = 0.0; lh2 = 0.0; la1 = 0.0; la2 = 0.0;
  survey(CENTRE, 0);
${eachCandidate("survey(s, id);")}

  // The lattice's cell size here, by its narrower spacing (the angular one);
  // for the central cell, about its ring's.
  float rFront = CORE_R * sinh(max(uFront, 0.0));
  float cellSize = (n0 == 0 ? 2.0 * rFront : length(s0.xy)) * gDelta;
  float rho = uRound * ROUND_K * (n0 == 0 ? rFront : cellSize);

  // The rounded corner between the two nearest bisectors: a circle of
  // radius rho tangent to both; inside the cone of the two normals from its
  // centre the arc is the nearest boundary.
  corner = false;
  float dCorner = ea;
  if (ib >= 0 && rho > 0.0) {
    float det = na.x * nb.y - na.y * nb.x;
    if (abs(det) > 1e-6) {
      vec2 c = vec2((ha - rho) * nb.y - (hb - rho) * na.y, na.x * (hb - rho) - nb.x * (ha - rho)) / det;
      vec2 v = p - c;
      float alpha = (v.x * nb.y - nb.x * v.y) / det;
      float beta = (na.x * v.y - v.x * na.y) / det;
      if (alpha > 0.0 && beta > 0.0) {
        corner = true;
        dCorner = rho - length(v);
        vtx = vec2(ha * nb.y - hb * na.y, na.x * hb - nb.x * ha) / det;
      }
    }
  }
  want1 = cov1 > 0.0;
  want2 = cov2 > 0.0;
  lo1 = -1e30; hi1 = 1e30; lo2 = -1e30; hi2 = 1e30;
  if (corner || want1) {
    q1 = ln1 * lh1;
    t1 = vec2(-ln1.y, ln1.x);
    q2 = ln2 * lh2;
    t2 = vec2(-ln2.y, ln2.x);
    verify(CENTRE, 0);
${eachCandidate("verify(s, id);")}
  }
  want1 = want1 && lo1 < hi1;
  want2 = want2 && lo2 < hi2;
  float d = corner ? dCorner : ea;
  float lineM = want1 ? cov1 * min(s0.w, la1) : (want2 ? cov2 * min(s0.w, la2) : 0.0);

  float hw = uEdges * EDGE_HALF;
  float edge = clamp((hw - d) / gPx + 0.5, 0.0, 1.0) * min(1.0, uEdges * 4.0);
  float dotM = gDotR > 0.0 ? clamp(0.5 - dotD / gPx, 0.0, 1.0) : 0.0;
  float lineLum = clamp(LINE_LUM * uLines * (LINE_FLOOR + LINE_GAIN * linesDrive(uHigh)), 0.0, 1.0);

  vec3 cellC = mix(vec3(0.0), uPalGround, uColours);
  vec3 inkC = mix(vec3(1.0), palRamp(0.92), uColours);
  vec3 dotC = mix(vec3(1.0), uPalAccent, uColours);
  vec3 lineC = mix(vec3(1.0), palRamp(0.7), uColours);

  vec3 col = cellC;
  col = mix(col, lineC, lineM * lineLum);
  col = mix(col, inkC, edge);
  col = mix(col, dotC, dotM);

  // Cells only a few pixels across: the share of white they average to.
  // Cells whose seed is inside the core: white, a whole cell at a time, so
  // the core's edge follows the cells' outlines.
  float black = max(1.0 - 2.0 * hw / max(cellSize, 1e-9), 0.0);
  float cover = 1.0 - black * black;
  col = mix(col, mix(cellC, inkC, cover), 1.0 - smoothstep(CORE_PX0, CORE_PX1, cellSize / gPx));
  if (n0 != 0) col = mix(col, inkC, 1.0 - smoothstep(CORE_FADE_IN, CORE_FADE_OUT, length(s0.xy)));

  outColor = vec4(col, 1.0);
}
`;
