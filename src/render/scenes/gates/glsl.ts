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
// clock and colour) is a second pass over the same geometry, folded into the
// same draw call rather than a separate one: every instance still emits
// exactly the bounding quad above, just a little larger while a strike is
// live (see "while a strike is live" below), and the fragment shader adds
// the current on top of the tube it already drew. Where the current is on
// this instance's segment at this instant is arcPathStart(seg) (mirrored
// from layout.ts's function of the same name) plus the fragment's own
// position along the segment — a coordinate the *shape* doesn't need to
// know, so the strike rides straight through a morph unaffected by what's
// morphing into what. It starts at the gates nearest the camera and ripples
// outward (the vertex shader's `delay`, from zMid) because a real spark
// takes time to propagate and starting there reads as *arriving* rather than
// simply appearing everywhere at once. It's evaluated once per fragment
// against the *now* segment only (vSegNow), not swept across SWEEP_TAPS like
// the tube's own motion blur — the strike is a flash of light along wires
// that are already there, not something that itself needs to smear with
// the camera's shutter.

import { NOISE_HASH_GLSL, NOISE_MASK } from "../../noiseHash.ts";
import { MAX_OBJ, SEG_MAX, TUNNEL_LEN } from "./layout.ts";

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
/** Seconds of ripple delay per world-space z unit of depth, so the strike
 *  reaches the far end of the tunnel well after the near gates light up. */
const ARC_DEPTH_DELAY = 0.025;
/** Max random per-object timing jitter added to the depth delay, seconds —
 *  keeps gates at the same depth from striking in perfect lockstep. */
const ARC_DEPTH_JITTER_SEC = 0.04;
/** How fast the whole strike fades after the beat, per second — also what
 *  ARC_LIVE_MIN below is measured against. */
const ARC_DECAY = 6.0;
/** Below this, uLightning * exp(-uArcAge * ARC_DECAY) counts as off: the
 *  uniform-level branch (same value for every instance in the draw call)
 *  that skips the quad's extra margin, so between beats — and at Lightning
 *  0, where this is never exceeded — the vertex shader costs what it did
 *  before the strike existed. */
const ARC_LIVE_MIN = 0.02;
/** Like HAZE, but tuned separately so the strike itself can be kept
 *  concentrated near the camera independent of the neon's own falloff. */
const HAZE_ARC = 0.32;
/** How fast the current travels, in path-units per second — arcPathStart's
 *  shared per-object path (layout.ts) is about 6 units around, so this is
 *  roughly how many gate corners the current crosses each second. */
const ARC_SPEED = 34.0;
/** How fast the lit trail dims behind the current's head, per path-unit. */
const ARC_TRAIL = 2.2;
/** How tightly the current's own bright point glows around its
 *  instantaneous position, per path-unit — higher is a sharper spark. */
const ARC_HEAD_SHARP = 10.0;
/** Pixel wavelength of the zigzag's crackle noise — smaller kinks tighter. */
const ARC_WAVE_PX = 18.0;
/** How far each zigzag strand strays from the true line, in pixels. */
const ARC_AMP_PX = 10.0;
/** Half-width of a zigzag strand's own bright core, in pixels — a bold
 *  thread of light laid over the tube, wider than the tube's own floor. */
const ARC_CORE_PX = 1.6;
/** Half-width of a zigzag strand's halo, in pixels. */
const ARC_HALO_PX = 8.0;
/** Overall brightness of the strike (strands, halo and the relit tube). */
const ARC_GAIN = 3.0;
/** Brightness of a zigzag strand's halo relative to its core. */
const ARC_STRAND_HALO_GAIN = 0.5;
/** How far the strike's core pushes toward white — stronger than the tube's
 *  own WHITE_CORE, since lightning reads as white-hot, not tinted-hot. */
const ARC_WHITE_CORE = 0.7;
/** How often the crackle re-rolls to a new random shape, in Hz. */
const ARC_FLICKER_HZ = 24.0;

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
const float ARC_DEPTH_DELAY = ${f(ARC_DEPTH_DELAY)};
const float ARC_DEPTH_JITTER_SEC = ${f(ARC_DEPTH_JITTER_SEC)};
const float ARC_DECAY = ${f(ARC_DECAY)};
const float ARC_LIVE_MIN = ${f(ARC_LIVE_MIN)};
const float HAZE_ARC = ${f(HAZE_ARC)};
const float ARC_AMP_PX = ${f(ARC_AMP_PX)};
const float ARC_HALO_PX = ${f(ARC_HALO_PX)};

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

flat out vec4 vSegNow;
flat out vec4 vSegPrev;
flat out float vHalfPx;
flat out float vHaloPx;
flat out vec3 vColor;
// Lightning strike, evaluated in the fragment shader: (path start of this
// segment's slot, this object's start delay in seconds, its strength — 0
// when the strike isn't live, already folded with uLightning/HAZE_ARC/the
// gain below so the fragment needs no setting uniform of its own — and this
// object's index, for a per-object noise seed). See the file header.
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

  // Lightning strike: uLightning*exp(-uArcAge*ARC_DECAY) is the same value
  // for every instance this draw call (both are true uniforms), so this
  // branch is uniform-coherent — between beats, and always at Lightning 0,
  // it's false for the whole draw call and the quad costs exactly what it
  // did before the strike existed. While live, grow the margin so the
  // zigzag's amplitude and halo (evaluated in the fragment shader) aren't
  // clipped by the tube's own, smaller bounding quad.
  float arcLive = uLightning * exp(-uArcAge * ARC_DECAY);
  bool strikeLive = arcLive > ARC_LIVE_MIN;
  if (strikeLive) margin += (ARC_AMP_PX + ARC_HALO_PX * 3.0) * pxScale;

  // This object's delay before the current reaches it (nearest gates first,
  // rippling outward with depth) plus a small per-object jitter so gates at
  // the same depth don't all strike in lockstep, and this segment's place
  // on the shared arc path. strength folds in uLightning, the strike's own
  // depth haze and this segment/copy's presence and copy weight (the same
  // ones gain already carries) — zero whenever the strike isn't live, so
  // the fragment shader needs no uLightning uniform of its own.
  float jitterHash = hashCell(vec2(float(obj), 0.0), ${NOISE_MASK}, uint(uArcSeed));
  float delay = zMid * ARC_DEPTH_DELAY + (jitterHash - 0.5) * 2.0 * ARC_DEPTH_JITTER_SEC;
  float strength = strikeLive ? arcLive * exp(-HAZE_ARC * zMid) * gain : 0.0;
  vArc = vec4(arcPathStart(seg), delay, strength, float(obj));

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
const float ARC_SPEED = ${f(ARC_SPEED)};
const float ARC_TRAIL = ${f(ARC_TRAIL)};
const float ARC_HEAD_SHARP = ${f(ARC_HEAD_SHARP)};
const float ARC_WAVE_PX = ${f(ARC_WAVE_PX)};
const float ARC_AMP_PX = ${f(ARC_AMP_PX)};
const float ARC_CORE_PX = ${f(ARC_CORE_PX)};
const float ARC_HALO_PX = ${f(ARC_HALO_PX)};
const float ARC_STRAND_HALO_GAIN = ${f(ARC_STRAND_HALO_GAIN)};
const float ARC_WHITE_CORE = ${f(ARC_WHITE_CORE)};
const float ARC_FLICKER_HZ = ${f(ARC_FLICKER_HZ)};
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

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
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
  float sweepLen = max(length(vSegNow.xy - vSegPrev.xy), length(vSegNow.zw - vSegPrev.zw));
  // One tap per stroke width of sweep keeps the smear continuous; the cap
  // follows quality so a TV spends less per pixel on the nearest gates.
  int maxTaps = int(mix(12.0, float(SWEEP_TAPS), uDetail));
  int taps = clamp(int(sweepLen / max(vHalfPx * 1.2, 1.0)) + 1, 1, maxTaps);
  float core = 0.0;
  float halo = 0.0;
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
  vec3 col = mix(vColor, vec3(max(max(vColor.r, vColor.g), vColor.b)), WHITE_CORE * core) * core
    + vColor * halo * HALO_GAIN;

  // Lightning strike, evaluated once against the *now* segment only (see
  // this file's header) — vArc.z is exactly 0 whenever the strike isn't
  // live (including always, at Lightning 0), so this whole block is dead
  // weight only while a beat's current is actually running.
  if (vArc.z > 0.0005) {
    float H = (uArcAge - vArc.y) * ARC_SPEED;
    vec2 aSeg = vSegNow.xy;
    vec2 baSeg = vSegNow.zw - aSeg;
    float segLenPx = length(baSeg);
    vec2 tangent = segLenPx > 1e-6 ? baSeg / segLenPx : vec2(1.0, 0.0);
    vec2 normal = vec2(-tangent.y, tangent.x);
    float hLocal = clamp(dot(p - aSeg, tangent) / max(segLenPx, 1e-6), 0.0, 1.0);
    float pos = vArc.x + hLocal;
    float perp = dot(p - aSeg, normal);

    // Trail behind the current's head, plus a brighter point at the head
    // itself — not gated by the step, so the head reads as a small glowing
    // tip rather than a hard-edged front.
    float trail = step(pos, H) * exp(-(H - pos) * ARC_TRAIL);
    float head = exp(-abs(H - pos) * ARC_HEAD_SHARP);
    float envelope = trail + head;

    // A per-object, per-strand seed that re-rolls at ARC_FLICKER_HZ — the
    // crackle. uArcSeed (the beat) mixes in so every beat's zigzag differs
    // even for an object whose depth/jitter delay repeats.
    uint flicker = uint(floor(uTime * ARC_FLICKER_HZ));
    uint objSeed = uhash(uint(vArc.w) ^ (uint(uArcSeed) * 0x9e3779b9u) ^ (flicker * 0x85ebca6bu));
    float coord = hLocal * segLenPx / ARC_WAVE_PX;

    // Two independent zigzag strands around the true line — a forked look,
    // brighter where they cross.
    float strandCore = 0.0;
    float strandHalo = 0.0;
    for (int s = 0; s < 2; s++) {
      uint strandSeed = s == 0 ? objSeed : uhash(objSeed ^ 0x27d4eb2fu);
      float wave = (arcFbm(coord, strandSeed) - 0.5) * 2.0 * ARC_AMP_PX;
      float dArc = abs(perp - wave);
      strandCore += 1.0 - smoothstep(0.0, ARC_CORE_PX, dArc);
      strandHalo += exp(-dArc / ARC_HALO_PX);
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
