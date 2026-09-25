// Shaders for the Neon Gates scene. index.ts owns the design and the
// reference it was measured from, layout.ts owns what is in the tunnel and
// how it morphs; this file owns the picture.
//
// The gate pass draws one primitive: a neon tube segment swept through the
// shutter. Each instance is (object, mirror copy, segment): the vertex
// shader looks the object up in the uObjA/uObjB/uObjC arrays, morphs that
// segment's endpoints between the fromLook and toLook shapes (morphSegment,
// mirroring layout.ts's TS version of the same name — same SEG_MAX=18
// topology, same slot arithmetic, same lerp; the one difference is dims:
// the shader gets a single already-blended (sx, sy, dz) from uObjB, not two
// separate ones, since the uniform budget has no room for both — exact at
// uMorph=0/1, a smooth approximation in between), places it in the tunnel,
// mirrors it, spins it, and projects it twice — where it is now and where
// it was a shutter ago — then emits an oriented bounding quad around those
// four screen points plus the stroke and the halo margin. The fragment
// shader samples the tube along the sweep and averages an anti-aliased core
// and a short halo, so the streaks the reference has are the motion of the
// 3D geometry itself, not a smear pasted on afterwards. Everything is
// additive into an RGBA8 target; the blur chain and the composite in
// index.ts turn that into the bloom and the tinted ground.
//
// A mirror copy that would land exactly on an on-axis object is faded by a
// continuous copyWeight (from uObjC's wx/wy, layout.ts's axis weights)
// rather than discarded outright, so an object crossing a mirror axis
// mid-morph fades its copy in/out instead of popping it.
//
// Stroke is a tube radius in world units (uObjA.w, blended per object)
// projected to pixels and floored at CORE_MIN_PX, so it is thin at the
// vanishing point and thick at the edge the way the reference's is. Past
// DOF_Z the halo widens with depth — the cheap depth of field that turns far
// gates into soft blobs.
//
// The lightning strike (index.ts's advanceGates/pickArcColour own its beat
// clock and colour; a beatListener.ts listener there decides *when* one
// starts, per the Lightning on setting) is a second pass over the same
// geometry, folded into the same draw call rather than a separate one: every
// instance still emits exactly the bounding quad above, just a little larger
// for the handful of instances the current is actually on or just passed
// (see "per-segment liveness" below), and the fragment shader adds the
// current on top of the tube it already drew. Where the current is on this
// instance's segment at this instant is arcPathStart(seg) (mirrored from
// layout.ts's function of the same name) plus the fragment's own position
// along the segment — a coordinate the *shape* doesn't need to know, so the
// strike rides straight through a morph unaffected by what's morphing into
// what. It starts at the gates nearest the camera and ripples outward (the
// vertex shader's `delay`, from zMid) because a real spark takes time to
// propagate and starting there reads as *arriving* rather than simply
// appearing everywhere at once. It's evaluated once per fragment against the
// *now* segment only (vSegNow), not swept across SWEEP_TAPS like the tube's
// own motion blur — the strike is a flash of light along wires that are
// already there, not something that itself needs to smear with the camera's
// shutter.
//
// Per-segment liveness (the fix for a real, measured cost — a strike used to
// grow *every* instance's quad by its full zigzag reach for as long as it was
// live at all, which at ordinary tempos is effectively always, since the live
// window outlasts a beat period): the vertex shader computes this object's
// current head position H the same way the fragment shader does, and only
// grows the margin — and gives the segment a nonzero strength — when its path
// span overlaps the lit window around H (layout.ts's arcLitSpan is the pure,
// tested mirror of this test; ARC_ENV_MIN there and here must match by hand).
// Between beats, and always at Lightning 0, the uniform-level strikeLive
// branch already skipped all of this; now a live strike itself only pays for
// the segments actually near the current, not the whole tunnel. The fragment
// shader adds two more early-outs on top: it skips the zigzag noise loop
// outright when the envelope (trail + head, folded with strength) is below
// ARC_ENV_MIN, and again when a fragment's perpendicular distance from the
// segment's line is beyond the zigzag's own reach (amp + 3 halo widths) — the
// two together mean only fragments actually near the current's path pay for
// the noise, not every fragment inside the enlarged quad. A third, unrelated
// to the strike, guards the tube's own SWEEP_TAPS loop: a fragment beyond the
// swept quad's own edges (vHalfPx + 3 halo widths from the nearest of the
// four sweep corners) skips the tap loop entirely — this is what actually
// pays for a strike's enlarged margin, since most of a bigger quad's added
// area is nowhere near the thin tube itself. Below full uDetail, only one
// zigzag strand draws instead of two, the same uDetail hook the tap cap
// already uses.
//
// The strike's shape and look (index.ts's arcSustain/arcThickness/
// arcCrackle/arcSpeed settings) arrive as two vec4 uniforms rather than
// compile-time constants, since they're now user-adjustable: uArcShape =
// (speed, trail falloff, whole-strike decay, zigzag amplitude), uArcLook =
// (strand core half-width px, strand halo half-width px, flicker Hz, depth
// ripple delay). Both are declared identically in the vertex and fragment
// shaders (one linked program, one uniform each) even though each stage only
// reads some of the four components.

import { NOISE_HASH_GLSL, NOISE_MASK } from "../../noiseHash.ts";
import { MAX_OBJ, SEG_MAX, TUNNEL_LEN } from "./layout.ts";

// ARC_ENV_MIN mirrors layout.ts's own constant of the same name by hand (no
// shared compile step between TS and GLSL — see this file's header and
// layout.ts's arcLitSpan).
const ARC_ENV_MIN = 0.02;

/** Vertical focal length: the tunnel is seen through a wide lens. */
const FOCAL_Y = 1.0;
/** Nearest view depth a segment is clipped to. */
const NEAR = 0.12;
/** Tube half-width on screen, in pixels at a 720-high frame: the floor
 *  keeps the vanishing point crisp, the cap is the reference's edge stroke. */
const CORE_MIN_PX = 0.9;
const CORE_MAX_PX = 4.5;
/** Halo around the core: width in px, its gain at the core edge. */
const HALO_PX = 3.0;
const HALO_GAIN = 0.16;
/** Depth of field: beyond DOF_Z the halo widens by DOF_GAIN px per unit. */
const DOF_Z = 5.0;
const DOF_GAIN = 0.25;
/** Haze: brightness falls off with depth, so the far cluster at the
 *  vanishing point stays fine instead of burning white. */
const HAZE = 0.28;
/** A gate fades out over its last stretch before the camera instead of
 *  filling the frame. */
const NEAR_FADE_Z = 1.1;
/** Most samples along the shutter sweep (one per stroke width of sweep, so
 *  a long smear stays a smear and a short one costs little), and how dim
 *  the tail end is. */
const SWEEP_TAPS = 40;
const TAIL_DIM = 0.35;
/** How much the core pushes toward white. */
const WHITE_CORE = 0.2;
/** Beat flash: extra gain on the nearest gates, scaled by the Beat flash
 *  setting (uBeatFlash) against the shared beat pulse (uBeatPulse) — the
 *  same shared pattern every other scene's own Beat flash setting reads,
 *  replacing what used to be a hand-rolled per-scene onset accumulator. */
const FLASH_GAIN = 1.6;

// --- Lightning strike (index.ts's uLightning) -------------------------------
// ARC_DEPTH_DELAY, ARC_DECAY, ARC_SPEED, ARC_TRAIL, ARC_AMP_PX, ARC_CORE_PX,
// ARC_HALO_PX and ARC_FLICKER_HZ used to live here as compile-time constants;
// they're now user-settable (arcSustain/arcThickness/arcCrackle/arcSpeed,
// index.ts) and arrive per-frame as uArcShape/uArcLook instead (see this
// file's header). What's left below is either not user-settable or is the
// fixed reference each setting's *default* reproduces exactly.
/** Max random per-object timing jitter added to the depth delay, seconds —
 *  keeps gates at the same depth from striking in perfect lockstep. Not
 *  settable — only the depth delay itself (uArcLook.w) scales with speed. */
const ARC_DEPTH_JITTER_SEC = 0.04;
/** Below this, uLightning * exp(-uArcAge * uArcShape.z) (the live decay)
 *  counts as off: the uniform-level branch (same value for every instance in
 *  the draw call) that skips the quad's extra margin, so between beats — and
 *  at Lightning 0, where this is never exceeded — the vertex shader costs
 *  what it did before the strike existed. */
const ARC_LIVE_MIN = 0.02;
/** Like HAZE, but tuned separately so the strike itself can be kept
 *  concentrated near the camera independent of the neon's own falloff. */
const HAZE_ARC = 0.32;
/** How tightly the current's own bright point glows around its
 *  instantaneous position, per path-unit — higher is a sharper spark. Not
 *  settable, and shared with layout.ts's arcLitSpan (mirrored by hand). */
const ARC_HEAD_SHARP = 10.0;
/** Pixel wavelength of the zigzag's crackle noise — smaller kinks tighter.
 *  Not settable — Lightning crackle scales the amplitude and the flicker
 *  rate, not the wavelength. */
const ARC_WAVE_PX = 18.0;
/** Overall brightness of the strike (strands, halo and the relit tube). */
const ARC_GAIN = 6.0;
/** Brightness of a zigzag strand's halo relative to its core. */
const ARC_STRAND_HALO_GAIN = 0.5;
/** How far the strike's core pushes toward white — stronger than the tube's
 *  own WHITE_CORE, since lightning reads as white-hot, not tinted-hot. */
const ARC_WHITE_CORE = 0.7;

/** Blur stride in texels of the level being blurred. */
export const BLUR_STRIDE = 2.4;
/** Composite knee: per-channel Reinhard just above white. */
const TONE_KNEE = 1.25;

const f = (v: number) => v.toFixed(4);

/** Room-space perspective camera (ambience.ts's pattern): world -> room NDC,
 *  then the device's slice of it. */
export const CAMERA_GLSL = `
const float FOCAL_Y = ${f(FOCAL_Y)};
const float NEAR = ${f(NEAR)};

float roomAspect() {
  return (uResolution.x / max(uViewport.z, 0.0001)) / (uResolution.y / max(uViewport.w, 0.0001));
}
vec2 project(vec3 view) {
  return vec2(view.x * FOCAL_Y / roomAspect(), view.y * FOCAL_Y) / max(view.z, NEAR);
}
vec2 toDevice(vec2 ndc) {
  vec2 uv01 = (ndc * 0.5 + 0.5 - uViewport.xy) / uViewport.zw;
  return uv01 * 2.0 - 1.0;
}
`;

export const GATE_VERT_BODY = `
const int SEG_MAX = ${SEG_MAX};
const float TUNNEL_LEN = ${f(TUNNEL_LEN)};
const float PI = 3.14159265;
const float CORE_MIN_PX = ${f(CORE_MIN_PX)};
const float CORE_MAX_PX = ${f(CORE_MAX_PX)};
const float HALO_PX = ${f(HALO_PX)};
const float DOF_Z = ${f(DOF_Z)};
const float DOF_GAIN = ${f(DOF_GAIN)};
const float HAZE = ${f(HAZE)};
const float NEAR_FADE_Z = ${f(NEAR_FADE_Z)};
const float FLASH_GAIN = ${f(FLASH_GAIN)};
const float ARC_DEPTH_JITTER_SEC = ${f(ARC_DEPTH_JITTER_SEC)};
const float ARC_LIVE_MIN = ${f(ARC_LIVE_MIN)};
const float HAZE_ARC = ${f(HAZE_ARC)};
const float ARC_HEAD_SHARP = ${f(ARC_HEAD_SHARP)};
const float ARC_ENV_MIN = ${f(ARC_ENV_MIN)};

${NOISE_HASH_GLSL}

// Per object: (x, y, z0, half-stroke) — see layout.ts's morphLayout header.
uniform vec4 uObjA[${MAX_OBJ}];
// Per object: (sx, sy, dz, presence * brightness jitter).
uniform vec4 uObjB[${MAX_OBJ}];
// Per object: (axis weight x, axis weight y, shapeFrom + 4*shapeTo, keyFrom + 4*keyTo).
uniform vec4 uObjC[${MAX_OBJ}];
uniform int uObjCount;
uniform int uCopies;
uniform float uTravel;
uniform float uTravelDelta;
uniform float uSpinPos;
uniform float uSpinDelta;
// Colour key 0/1/2 = primary/secondary/accent, for the look being left and
// the look being entered; uMorph mixes between them.
uniform vec3 uColFrom[3];
uniform vec3 uColTo[3];
uniform float uMorph;
uniform float uCoreGain;
// Lightning strike clock (index.ts's advanceGates): seconds since the last
// beat, and a per-beat seed for the zigzag's noise and the per-object jitter
// below. uLightning itself arrives via SETTINGS_UNIFORMS_GLSL.
uniform float uArcAge;
uniform float uArcSeed;
// Lightning shape/look, from index.ts's arcSustain/arcThickness/arcCrackle/
// arcSpeed settings — see this file's header. uArcShape = (speed, trail
// falloff, whole-strike decay, zigzag amplitude px); uArcLook = (strand core
// half-width px, strand halo half-width px, flicker Hz, depth ripple delay
// sec/z-unit). The vertex shader reads every component; the fragment shader
// (below) declares the same two uniforms but only reads speed/trail/amp and
// core/halo/flicker respectively.
uniform vec4 uArcShape;
uniform vec4 uArcLook;

flat out vec4 vSegNow;
flat out vec4 vSegPrev;
flat out float vHalfPx;
flat out float vHaloPx;
flat out vec3 vColor;
// Lightning strike, evaluated in the fragment shader: (path start of this
// segment's slot, this object's start delay in seconds, its strength — 0
// whenever the strike isn't live OR this segment isn't within reach of the
// current head (arcLitSpan/segLive below — the per-segment liveness fix),
// already folded with uLightning/HAZE_ARC/the gain below so the fragment
// needs no setting uniform of its own — and this object's index, for a
// per-object noise seed). See the file header.
flat out vec4 vArc;

// Where segment slot i (0..17) sits along the shared per-object arc path —
// mirrors layout.ts's arcPathStart exactly (see its header).
float arcPathStart(int i) {
  int k = i - (i / 6) * 6;
  return float(k);
}

// Ring vertex k (0..5) of a shape's cross-section at half-extents s.xy —
// mirrors layout.ts's ringVertex exactly (see its header for the FRAME
// slot-to-corner mapping).
vec2 ringVertex(int shape, int k, vec2 s) {
  if (shape == 0) {
    float a = PI * 0.5 + PI / 3.0 * float(k);
    return s.x * vec2(cos(a), sin(a));
  } else if (shape == 1) {
    int corner = (k == 0 || k == 1) ? 0 : k == 2 ? 1 : (k == 3 || k == 4) ? 2 : 3;
    float x = (corner == 0 || corner == 3) ? -s.x : s.x;
    float y = corner < 2 ? -s.y : s.y;
    return vec2(x, y);
  }
  return vec2(0.0);
}

// 1 for a real edge of shape at slot i (0..17), 0 for a degenerate dupe —
// mirrors layout.ts's shapePresence exactly.
float shapePresence(int shape, int i) {
  if (shape == 0) return 1.0;
  if (shape == 1) {
    int k = i < 6 ? i : i < 12 ? i - 6 : i - 12;
    if (i < 12) return (k == 0 || k == 3) ? 0.0 : 1.0;
    return (k == 1 || k == 4) ? 0.0 : 1.0;
  }
  return i == 12 ? 1.0 : 0.0;
}

// Segment i, morphing shapeFrom's topology toward shapeTo's at progress e —
// mirrors layout.ts's morphSegment, except dims is already the e-blended
// (sx, sy, dz) rather than two separate from/to dims (see this file's
// header for why that's still exact at e=0/1).
void morphSegment(int shapeFrom, int shapeTo, int i, vec3 dims, float e, out vec3 a, out vec3 b, out float presence) {
  float h = dims.z * 0.5;
  presence = mix(shapePresence(shapeFrom, i), shapePresence(shapeTo, i), e);
  if (i < 12) {
    int k = i < 6 ? i : i - 6;
    int k1 = k + 1 - ((k + 1) / 6) * 6;
    vec2 pFrom = ringVertex(shapeFrom, k, dims.xy);
    vec2 pFrom2 = ringVertex(shapeFrom, k1, dims.xy);
    vec2 pTo = ringVertex(shapeTo, k, dims.xy);
    vec2 pTo2 = ringVertex(shapeTo, k1, dims.xy);
    float z = i < 6 ? -h : h;
    a = vec3(mix(pFrom, pTo, e), z);
    b = vec3(mix(pFrom2, pTo2, e), z);
    return;
  }
  int k = i - 12;
  vec2 pFrom = ringVertex(shapeFrom, k, dims.xy);
  vec2 pTo = ringVertex(shapeTo, k, dims.xy);
  vec2 p = mix(pFrom, pTo, e);
  a = vec3(p, -h);
  b = vec3(p, h);
}

vec2 rot(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

// Clips a segment to the near plane; false when it is entirely behind it.
bool clipNear(inout vec3 a, inout vec3 b) {
  if (a.z < NEAR && b.z < NEAR) return false;
  if (a.z < NEAR) a = mix(a, b, (NEAR - a.z) / (b.z - a.z));
  if (b.z < NEAR) b = mix(b, a, (NEAR - b.z) / (a.z - b.z));
  return true;
}

void main() {
  int seg = gl_InstanceID - (gl_InstanceID / SEG_MAX) * SEG_MAX;
  int rest = gl_InstanceID / SEG_MAX;
  int copy = rest - (rest / uCopies) * uCopies;
  int obj = rest / uCopies;
  // Pixel space is the drawing buffer: the pass renders into the scene's
  // own target of exactly that size, so gl_FragCoord matches.
  vec2 vpPx = max(uResolution, vec2(1.0));

  vec4 A = uObjA[obj];
  vec4 B = uObjB[obj];
  vec4 C = uObjC[obj];
  int shapeCombo = int(C.z + 0.5);
  int shapeFrom = shapeCombo - (shapeCombo / 4) * 4;
  int shapeTo = shapeCombo / 4;
  int keyCombo = int(C.w + 0.5);
  int keyFrom = keyCombo - (keyCombo / 4) * 4;
  int keyTo = keyCombo / 4;

  vec3 sa, sb;
  float segPresenceNow;
  morphSegment(shapeFrom, shapeTo, seg, B.xyz, uMorph, sa, sb, segPresenceNow);

  vec2 centre = A.xy;
  bool swapped = (copy & 4) != 0;
  if (swapped) centre = centre.yx;
  // Mirror copy c of a cross-section point: bit 0 flips x, bit 1 flips y.
  // copyWeight fades continuously toward 0 as the object approaches the
  // axis that copy mirrors across (1 when off it) instead of a hard cut, so
  // a transitioning object's mirror copy fades rather than pops; a fully
  // on-axis holding object (weight exactly 0 or 1) behaves exactly as
  // before.
  vec2 axisW = swapped ? C.yx : C.xy;
  float copyWeight = 1.0;
  if ((copy & 1) != 0) { centre.x = -centre.x; copyWeight *= axisW.x; }
  if ((copy & 2) != 0) { centre.y = -centre.y; copyWeight *= axisW.y; }

  float gain = B.w * segPresenceNow * copyWeight;
  bool drawn = obj < uObjCount && gain > 0.0005;
  if (!drawn) { gl_Position = vec4(2.0, 2.0, 0.0, 1.0); return; }

  // The copy mirrors the object's own frame as well as its place: a
  // mirrored hexagon is a hexagon, so only the sign pattern matters.
  vec2 fa = swapped ? sa.yx : sa.xy;
  vec2 fb = swapped ? sb.yx : sb.xy;
  if ((copy & 1) != 0) { fa.x = -fa.x; fb.x = -fb.x; }
  if ((copy & 2) != 0) { fa.y = -fa.y; fb.y = -fb.y; }

  float zRel = mod(A.z - uTravel, TUNNEL_LEN);
  float zPrev = zRel + uTravelDelta;
  vec3 nowA = vec3(rot(centre + fa, uSpinPos), zRel + sa.z);
  vec3 nowB = vec3(rot(centre + fb, uSpinPos), zRel + sb.z);
  float spinPrev = uSpinPos - uSpinDelta;
  vec3 prevA = vec3(rot(centre + fa, spinPrev), zPrev + sa.z);
  vec3 prevB = vec3(rot(centre + fb, spinPrev), zPrev + sb.z);
  bool nowOk = clipNear(nowA, nowB);
  bool prevOk = clipNear(prevA, prevB);
  if (!nowOk) { gl_Position = vec4(2.0, 2.0, 0.0, 1.0); return; }
  if (!prevOk) { prevA = nowA; prevB = nowB; }

  vec2 pa = (toDevice(project(nowA)) * 0.5 + 0.5) * vpPx;
  vec2 pb = (toDevice(project(nowB)) * 0.5 + 0.5) * vpPx;
  vec2 qa = (toDevice(project(prevA)) * 0.5 + 0.5) * vpPx;
  vec2 qb = (toDevice(project(prevB)) * 0.5 + 0.5) * vpPx;

  // Stroke: the tube radius seen at the segment's mean depth.
  float zMid = 0.5 * (nowA.z + nowB.z);
  float pxScale = vpPx.y / 720.0;
  float halfPx = clamp(A.w * FOCAL_Y * vpPx.y * 0.5 / zMid, CORE_MIN_PX * pxScale, CORE_MAX_PX * pxScale);
  float haloPx = (HALO_PX + DOF_GAIN * max(0.0, zMid - DOF_Z)) * pxScale;
  float margin = halfPx + haloPx * 3.0 + 1.0;

  // Lightning strike. uLightning*exp(-uArcAge*uArcShape.z) (the live decay)
  // is the same value for every instance this draw call (both are true
  // uniforms), so strikeLive is uniform-coherent — between beats, and always
  // at Lightning 0, it's false for the whole draw call and this whole block
  // costs one exp() and nothing else, same as before the strike existed.
  float arcLive = uLightning * exp(-uArcAge * uArcShape.z);
  bool strikeLive = arcLive > ARC_LIVE_MIN;
  float pathStart = arcPathStart(seg);
  float delay = 0.0;
  float strength = 0.0;
  if (strikeLive) {
    // This object's delay before the current reaches it (nearest gates
    // first, rippling outward with depth) plus a small per-object jitter so
    // gates at the same depth don't all strike in lockstep.
    float jitterHash = hashCell(vec2(float(obj), 0.0), ${NOISE_MASK}, uint(uArcSeed));
    delay = zMid * uArcLook.w + (jitterHash - 0.5) * 2.0 * ARC_DEPTH_JITTER_SEC;

    // Per-segment liveness (the main performance fix — see the file header
    // and layout.ts's arcLitSpan, this test's pure, tested mirror): H is the
    // current's head position on this object's shared path, the same formula
    // the fragment shader uses below. A segment only grows the quad's margin
    // — and gets a nonzero strength — when its path span overlaps the lit
    // window around H, instead of every segment of every visible object for
    // as long as the strike is live at all (which, at ordinary tempos, is
    // effectively always).
    float H = (uArcAge - delay) * uArcShape.x;
    float trailReach = log(1.0 / ARC_ENV_MIN) / uArcShape.y;
    float headReach = log(1.0 / ARC_ENV_MIN) / ARC_HEAD_SHARP;
    bool segLive = pathStart + 1.0 >= H - trailReach && pathStart <= H + headReach;
    if (segLive) {
      // strength folds in uLightning, the strike's own depth haze and this
      // segment/copy's presence and copy weight (the same ones gain already
      // carries) — zero whenever the strike isn't live or this segment isn't
      // lit, so the fragment shader needs no uLightning uniform of its own.
      strength = arcLive * exp(-HAZE_ARC * zMid) * gain;
      margin += (uArcShape.w + uArcLook.y * 3.0) * pxScale;
    }
  }
  vArc = vec4(pathStart, delay, strength, float(obj));

  // Oriented bounding quad around the four sweep points.
  vec2 run = pb - pa;
  vec2 sweep = qa - pa;
  vec2 u = dot(run, run) > dot(sweep, sweep) ? run : sweep;
  u = dot(u, u) > 1e-6 ? normalize(u) : vec2(1.0, 0.0);
  vec2 v = vec2(-u.y, u.x);
  vec2 uMinMax = vec2(min(min(dot(pa, u), dot(pb, u)), min(dot(qa, u), dot(qb, u))),
                      max(max(dot(pa, u), dot(pb, u)), max(dot(qa, u), dot(qb, u)))) + vec2(-margin, margin);
  vec2 vMinMax = vec2(min(min(dot(pa, v), dot(pb, v)), min(dot(qa, v), dot(qb, v))),
                      max(max(dot(pa, v), dot(pb, v)), max(dot(qa, v), dot(qb, v)))) + vec2(-margin, margin);
  // Two triangles: (0,1,2) = min-min, max-min, min-max; (3,4,5) = min-max,
  // max-min, max-max.
  int corner = gl_VertexID;
  float cu = (corner == 1 || corner == 4 || corner == 5) ? uMinMax.y : uMinMax.x;
  float cv = (corner == 2 || corner == 3 || corner == 5) ? vMinMax.y : vMinMax.x;
  vec2 px = u * cu + v * cv;
  gl_Position = vec4(px / vpPx * 2.0 - 1.0, 0.0, 1.0);

  vSegNow = vec4(pa, pb);
  vSegPrev = vec4(qa, qb);
  vHalfPx = halfPx;
  vHaloPx = haloPx;

  vec3 colFrom = keyFrom == 2 ? uColFrom[2] : (keyFrom == 1 ? uColFrom[1] : uColFrom[0]);
  vec3 colTo = keyTo == 2 ? uColTo[2] : (keyTo == 1 ? uColTo[1] : uColTo[0]);
  vec3 col = mix(colFrom, colTo, uMorph);
  float g = gain
    * exp(-HAZE * zMid)
    * smoothstep(NEAR, NEAR_FADE_Z, zMid)
    * (1.0 + FLASH_GAIN * uBeatFlash * uBeatPulse * exp(-0.6 * zMid))
    * uCoreGain;
  vColor = col * g;
}
`;

export const GATE_FRAG_BODY = `
const int SWEEP_TAPS = ${SWEEP_TAPS};
const float TAIL_DIM = ${f(TAIL_DIM)};
const float HALO_GAIN = ${f(HALO_GAIN)};
const float WHITE_CORE = ${f(WHITE_CORE)};
const float ARC_HEAD_SHARP = ${f(ARC_HEAD_SHARP)};
const float ARC_ENV_MIN = ${f(ARC_ENV_MIN)};
const float ARC_WAVE_PX = ${f(ARC_WAVE_PX)};
const float ARC_STRAND_HALO_GAIN = ${f(ARC_STRAND_HALO_GAIN)};
const float ARC_WHITE_CORE = ${f(ARC_WHITE_CORE)};
const float ARC_GAIN = ${f(ARC_GAIN)};

${NOISE_HASH_GLSL}

flat in vec4 vSegNow;
flat in vec4 vSegPrev;
flat in float vHalfPx;
flat in float vHaloPx;
flat in vec3 vColor;
// (path start, start delay sec, strength — 0 when not live, else already
// folded with uLightning/depth haze/presence/copy weight — object index).
// See GATE_VERT_BODY, above, for how it's built.
flat in vec4 vArc;
// Lightning strike clock and colour — index.ts's advanceGates/pickArcColour.
// uLightning itself never reaches this shader: vArc.z is already 0 whenever
// the strike isn't live, so the branch below costs nothing between beats.
uniform float uArcAge;
uniform float uArcSeed;
uniform vec3 uArcColor;
// Lightning shape/look — see GATE_VERT_BODY's own declaration and the file
// header. This stage only reads speed/trail/amp (uArcShape) and
// core/halo/flicker (uArcLook); depth ripple delay and whole-strike decay are
// vertex-only (already folded into vArc by the time this stage runs).
uniform vec4 uArcShape;
uniform vec4 uArcLook;

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

// Distance from p to the swept quad a->b->c->d (0 inside it, else the
// nearest of its 4 edges) — works for either winding order. This is the
// tube's own motion-blur hull (vSegNow/vSegPrev's four projected corners),
// not the lightning strike: a fragment beyond vHalfPx + 3 halo widths from
// this hull can't be reached by the SWEEP_TAPS loop below, so skipping the
// loop there costs nothing and saves most of what a strike's enlarged margin
// would otherwise spend on fragments nowhere near the thin tube itself (see
// the file header).
float sdQuad(vec2 p, vec2 a, vec2 b, vec2 c, vec2 d) {
  vec2 v0 = p - a, v1 = p - b, v2 = p - c, v3 = p - d;
  vec2 e0 = b - a, e1 = c - b, e2 = d - c, e3 = a - d;
  float s0 = e0.x * v0.y - e0.y * v0.x;
  float s1 = e1.x * v1.y - e1.y * v1.x;
  float s2 = e2.x * v2.y - e2.y * v2.x;
  float s3 = e3.x * v3.y - e3.y * v3.x;
  bool inside = (s0 >= 0.0 && s1 >= 0.0 && s2 >= 0.0 && s3 >= 0.0) || (s0 <= 0.0 && s1 <= 0.0 && s2 <= 0.0 && s3 <= 0.0);
  if (inside) return 0.0;
  return min(min(sdSegment(p, a, b), sdSegment(p, b, c)), min(sdSegment(p, c, d), sdSegment(p, d, a)));
}

// Two-octave value noise along a 1D coordinate, for the strike's crackle —
// hashCell (noiseHash.ts) keeps it exact on every GPU, unlike the classic
// fract(sin(...)) hash that degrades for a growing input (its header).
float arcNoise1D(float x, uint seed) {
  float i = floor(x);
  float u = fract(x);
  float sm = u * u * (3.0 - 2.0 * u);
  float a = hashCell(vec2(i, 0.0), ${NOISE_MASK}, seed);
  float b = hashCell(vec2(i + 1.0, 0.0), ${NOISE_MASK}, seed);
  return mix(a, b, sm);
}
float arcFbm(float x, uint seed) {
  float n = arcNoise1D(x, seed) * 0.6667;
  n += arcNoise1D(x * 2.07, seed + 1u) * 0.3333;
  return n;
}

void main() {
  vec2 p = gl_FragCoord.xy;
  float core = 0.0;
  float halo = 0.0;
  // Skip the tube's own SWEEP_TAPS loop for a fragment nowhere near the
  // swept hull — see sdQuad's own comment. Cheap even when it doesn't skip
  // (four cross products), and it's what actually pays for a strike's
  // enlarged margin, since most of a bigger quad's added area is nowhere
  // near the thin tube.
  float hullDist = sdQuad(p, vSegNow.xy, vSegNow.zw, vSegPrev.zw, vSegPrev.xy);
  if (hullDist <= vHalfPx + vHaloPx * 3.0) {
    float sweepLen = max(length(vSegNow.xy - vSegPrev.xy), length(vSegNow.zw - vSegPrev.zw));
    // One tap per stroke width of sweep keeps the smear continuous; the cap
    // follows quality so a TV spends less per pixel on the nearest gates.
    int maxTaps = int(mix(12.0, float(SWEEP_TAPS), uDetail));
    int taps = clamp(int(sweepLen / max(vHalfPx * 1.2, 1.0)) + 1, 1, maxTaps);
    float wsum = 0.0;
    for (int k = 0; k < SWEEP_TAPS; k++) {
      if (k >= taps) break;
      float t = (float(k) + 0.5) / float(taps);
      vec2 a = mix(vSegPrev.xy, vSegNow.xy, t);
      vec2 b = mix(vSegPrev.zw, vSegNow.zw, t);
      float d = sdSegment(p, a, b) - vHalfPx;
      float w = mix(TAIL_DIM, 1.0, t);
      core += w * (1.0 - smoothstep(-0.5, 0.75, d));
      halo += w * exp(-max(d, 0.0) / vHaloPx);
      wsum += w;
    }
    core /= wsum;
    halo /= wsum;
  }
  vec3 col = mix(vColor, vec3(max(max(vColor.r, vColor.g), vColor.b)), WHITE_CORE * core) * core
    + vColor * halo * HALO_GAIN;

  // Lightning strike, evaluated once against the *now* segment only (see
  // this file's header) — vArc.z is exactly 0 whenever the strike isn't
  // live or this segment isn't within reach of the current (the vertex
  // shader's per-segment liveness fix), so this whole block is dead weight
  // only for the handful of segments the current is actually on.
  if (vArc.z > 0.0005) {
    float H = (uArcAge - vArc.y) * uArcShape.x;
    vec2 aSeg = vSegNow.xy;
    vec2 baSeg = vSegNow.zw - aSeg;
    float segLenPx = length(baSeg);
    vec2 tangent = segLenPx > 1e-6 ? baSeg / segLenPx : vec2(1.0, 0.0);
    vec2 normal = vec2(-tangent.y, tangent.x);
    float hLocal = clamp(dot(p - aSeg, tangent) / max(segLenPx, 1e-6), 0.0, 1.0);
    float pos = vArc.x + hLocal;
    float perp = dot(p - aSeg, normal);

    float strandCore = 0.0;
    float strandHalo = 0.0;
    float envelope = 0.0;
    // Skip the trail/head envelope and the zigzag noise entirely for a
    // fragment whose perpendicular distance from the segment's own line is
    // beyond any strand's reach — the enlarged margin's corners, mostly.
    if (abs(perp) <= uArcShape.w + uArcLook.y * 3.0) {
      // Trail behind the current's head, plus a brighter point at the head
      // itself — not gated by the step, so the head reads as a small glowing
      // tip rather than a hard-edged front.
      float trail = step(pos, H) * exp(-(H - pos) * uArcShape.y);
      float head = exp(-abs(H - pos) * ARC_HEAD_SHARP);
      envelope = trail + head;

      // The noise loop itself is the expensive part (arcFbm below is 4
      // hashCell calls per strand): skip it too when the envelope this
      // fragment would multiply is already negligible.
      if (envelope * vArc.z >= ARC_ENV_MIN) {
        // A per-object, per-strand seed that re-rolls at the flicker rate.
        // uArcSeed (the beat) mixes in so every beat's zigzag differs even
        // for an object whose depth/jitter delay repeats.
        uint flicker = uint(floor(uTime * uArcLook.z));
        uint objSeed = uhash(uint(vArc.w) ^ (uint(uArcSeed) * 0x9e3779b9u) ^ (flicker * 0x85ebca6bu));
        float coord = hLocal * segLenPx / ARC_WAVE_PX;

        // Two independent zigzag strands around the true line at full detail
        // (a forked look, brighter where they cross); one below it, the same
        // uDetail hook the tap cap above uses.
        int numStrands = uDetail >= 0.999 ? 2 : 1;
        for (int s = 0; s < numStrands; s++) {
          uint strandSeed = s == 0 ? objSeed : uhash(objSeed ^ 0x27d4eb2fu);
          float wave = (arcFbm(coord, strandSeed) - 0.5) * 2.0 * uArcShape.w;
          float dArc = abs(perp - wave);
          strandCore += 1.0 - smoothstep(0.0, uArcLook.x, dArc);
          strandHalo += exp(-dArc / uArcLook.y);
        }
      }
    }
    vec3 arcCoreCol = mix(uArcColor, vec3(1.0), ARC_WHITE_CORE);
    vec3 arcGlow = (arcCoreCol * strandCore + uArcColor * strandHalo * ARC_STRAND_HALO_GAIN) * envelope
      // The trail also relights the tube itself (core, already normalized
      // above) in the strike's colour — the line it passed stays lit.
      + uArcColor * envelope * core;
    col += arcGlow * vArc.z * ARC_GAIN;
  }

  outColor = vec4(col, 1.0);
}
`;

/** 9-tap separable Gaussian; the step is set per pass by index.ts. */
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

/** Ground plus the sharp gates plus two bloom levels, through a knee. */
export const COMPOSITE_BODY = `
const float TONE_KNEE = ${f(TONE_KNEE)};
uniform sampler2D uSharpTex;
uniform sampler2D uGlowATex;
uniform sampler2D uGlowBTex;
uniform vec3 uGround;
uniform float uVignette;
uniform float uGlowAGain;
uniform float uGlowBGain;

void main() {
  vec2 ruv = roomUv(vUv);
  vec2 q = (ruv - 0.5) * vec2(roomAspect(), 1.0) * 2.0;
  float r = length(q);
  vec3 ground = uGround * mix(1.0, uVignette, smoothstep(0.2, 1.3, r)) * (1.0 + 0.5 * uBeatFlash * uBeatPulse);
  vec3 sharpC = texture(uSharpTex, vUv).rgb;
  float buildMul = max(1.0 + uBuildGlow * 0.3 * (uSectionIntensity - 0.5), 0.2);
  vec3 glow = (texture(uGlowATex, vUv).rgb * uGlowAGain + texture(uGlowBTex, vUv).rgb * uGlowBGain) * buildMul;
  // Per-channel Reinhard: an overdriven core keeps its hue on the way to
  // white instead of clipping one channel first (powder.ts's lesson).
  vec3 col = ground + sharpC + glow;
  col = col / (1.0 + col / TONE_KNEE);
  col = 1.0 - exp(-col * 1.5);
  outColor = vec4(col, 1.0);
}
`;
