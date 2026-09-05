// Fragment body for the Neon Gates scene. index.ts owns the design and the
// reference it was measured from; this file owns the picture. Assigns
// outColor from the common uniforms, the scene's setting uniforms and the
// extra uniforms index.ts uploads (uTravel, uSpinPos, uLook, uCutSeed,
// uBlackFrame, uFlash, uFlyRate).
//
// Per pixel: fold the screen into one mirrored wedge (that fold *is* the
// kaleidoscopic symmetry — one gate drawn in the wedge appears once per
// wedge), then walk the depth slots of the tunnel. Each slot holds one
// gate at a perspective scale of 1/depth, sitting on one of the wedge's
// two mirror lines so its copies land on the cardinal or the diagonal
// axes, as the reference's do. The gate is a signed distance in its own
// unit frame (x radial, outward) turned into a neon line: a core whose
// width lives in world units (far gates draw thin) floored at the pixel,
// plus a halo in screen units, because the bloom belongs to the screen,
// not the object. The motion streak is analytic, not a post pass: the
// inward (trailing) side of the gate's frame is compressed by the slot's
// screen speed, so the shape smears toward the centre it came from, and
// its colour runs from the look's primary to its secondary along the smear.
// Additive glow, then a soft knee, so the ground stays black.
export const GATES_FRAG = `
const float PI = 3.14159265;
const float TWO_PI = 6.2831853;
// Depth slots the loop walks; how many are lit comes from Gate density and
// uDetail. z runs from 1 (far, at the vanishing point) to 0 (at the camera).
const int SLOTS = 22;
const float SLOTS_MIN = 9.0;
// Share of gate places left empty, so the rings aren't a uniform picket.
const float SKIP_SHARE = 0.3;
const float HAZE = 0.035;
const float FAR_DIM = 0.4;
const float NEAR = 0.16;
const float FAR = 10.0;
// Where gate centres sit around the axis, in world units at unit depth.
const float GATE_R = 0.9;
// The core grows with perspective but slower than the shape (CORE_GROWTH):
// a neon tube stays a tube as it passes, not a slab.
const float CORE_W = 0.02;
const float CORE_GROWTH = 0.6;
const float HALO_W = 0.07;
const float HALO_GAIN = 0.3;
// Streak length per unit of fly speed, in the gate's own frame, and how
// dim the tail end of the smear gets.
const float STREAK_GAIN = 3.0;
const float TAIL_DIM = 0.3;
// How much brighter the nearest gate gets on an onset flash.
const float FLASH_GAIN = 2.0;
const float KNEE = 1.3;

float hash11(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

vec3 rainbow(float t) { return palette(t, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67)); }

// Per look: the gate's own colour, and the colour its streak fades to.
vec3 lookPrimary(int look) {
  if (look == 0) return vec3(0.25, 0.45, 1.0);
  if (look == 1) return vec3(0.2, 1.0, 0.85);
  if (look == 2) return vec3(1.0, 0.72, 0.15);
  if (look == 3) return vec3(1.0, 0.2, 0.75);
  return vec3(1.0, 0.35, 0.65);
}
vec3 lookSecondary(int look) {
  if (look == 0) return vec3(1.0, 0.45, 0.1);
  if (look == 1) return vec3(0.15, 0.9, 0.3);
  if (look == 2) return vec3(1.0, 0.35, 0.05);
  if (look == 3) return vec3(0.25, 0.4, 1.0);
  return vec3(0.3, 0.9, 1.0);
}

// Shapes: 0 hex ring, 1 rectangular frame, 2 solid rod, 3 bracket pair,
// 4 solid panel. Each look draws from a ring-ish and a bar-ish shape;
// Shape mix is the share of bar-ish gates.
int lookRingShape(int look) {
  if (look == 1 || look == 4) return 0;
  if (look == 3) return 4;
  return 1;
}
int lookBarShape(int look) {
  if (look == 3 || look == 4) return 3;
  return 2;
}
int shapeFor(float slot, float cycle, int look, float seed, float mixBar) {
  float h = hash21(vec2(slot * 3.1 + cycle * 17.0, seed * 5.3 + float(look)));
  float h2 = hash21(vec2(cycle * 7.7 + slot, seed + 41.0));
  int s = h < mixBar ? lookBarShape(look) : lookRingShape(look);
  if (h2 < 0.2 && s == 2) s = 3;
  return s;
}

float sdHexagon(vec2 p, float r) {
  const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
  p = abs(p);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}
float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
float sdRod(vec2 p, float halfLen, float halfW) {
  p.x -= clamp(p.x, -halfLen, halfLen);
  return length(p) - halfW;
}
// Distance to the lit part of a gate in its unit frame (x radial, outward).
float gateSdf(int shape, vec2 q) {
  if (shape == 0) return abs(sdHexagon(q.yx, 0.32));
  if (shape == 1) return abs(sdBox(q, vec2(0.3, 0.16)));
  if (shape == 2) return max(sdRod(q, 0.55, 0.035), 0.0);
  if (shape == 3) return max(min(sdRod(q - vec2(0.0, 0.22), 0.2, 0.03), sdRod(q + vec2(0.0, 0.22), 0.2, 0.03)), 0.0);
  return max(sdBox(q, vec2(0.24, 0.08)), 0.0);
}

// Mirror-fold p into one wedge: wedges/2 rotational copies, each mirrored.
vec2 fold(vec2 p, float period, float spin) {
  float a = atan(p.y, p.x) + spin;
  a = mod(a, period);
  a = min(a, period - a);
  return length(p) * vec2(cos(a), sin(a));
}

void main() {
  vec2 uv = roomUv(vUv);
  vec2 p = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0) * 2.0;
  // Pixel size from the unfolded frame: across a mirror line fwidth reads ~0.
  float px = max(fwidth(p.x), fwidth(p.y));
  float wedges = 4.0 + 2.0 * floor(uSymmetry + 0.5);
  float period = TWO_PI / (wedges * 0.5);
  int look = int(uLook + 0.5);
  float nVis = floor(mix(SLOTS_MIN, float(SLOTS), uDensity) * mix(0.6, 1.0, uDetail) + 0.5);
  vec2 f = fold(p, period, uSpinPos);
  vec3 col = vec3(0.0);
  vec3 prim0 = lookPrimary(look);
  vec3 sec = lookSecondary(look);
  float glowGain = 0.6 + 0.8 * uGlow;
  // A faint wash of the look's colour so the black isn't dead — the bloom
  // the reference's near gates leave on everything.
  col += mix(prim0, sec, 0.5) * HAZE * uGlow;
  for (int i = 0; i < SLOTS; i++) {
    if (float(i) >= nVis) break;
    float slot = float(i);
    float u = (slot + uTravel) / nVis;
    float cycle = floor(u);
    float z = 1.0 - fract(u);
    float zp = mix(NEAR, FAR, z);
    float scale = 1.0 / zp;
    // Emerge from the dark at the vanishing point, pass out of frame at the camera.
    float fade = smoothstep(0.0, 0.12, z) * (1.0 - smoothstep(0.86, 1.0, z));
    if (fade <= 0.0) continue;
    // Streak: the slot's screen speed grows with scale, so near gates smear most.
    float L = uStreaks * STREAK_GAIN * uFlyRate * scale / nVis;
    float core = max(CORE_W * pow(scale, CORE_GROWTH), 1.5 * px);
    // Far gates pile up at the vanishing point: dim them and shrink their
    // screen-space halo so the cluster stays coloured instead of burning white.
    float farDim = mix(1.0, FAR_DIM, smoothstep(0.45, 1.0, z));
    float haloGain = HALO_GAIN * clamp(scale * 0.4, 0.1, 1.0);
    float gain = glowGain * (1.0 + FLASH_GAIN * uFlash * pow(1.0 - z, 3.0)) * fade * farDim;
    // Toward the vanishing point every look's gates pick up the reference's
    // multicoloured centre cluster.
    float farTint = smoothstep(0.5, 0.9, z) * (look == 2 || look == 4 ? 1.0 : 0.6);
    // Two gates per slot, one on each mirror line of the wedge: their copies
    // land on the cardinal and the diagonal axes.
    for (int g = 0; g < 2; g++) {
      float gid = float(g);
      float hSkip = hash21(vec2(slot * 5.0 + gid, cycle * 3.0 + uCutSeed));
      if (hSkip < SKIP_SHARE) continue;
      int shape = shapeFor(slot + gid * 100.0, cycle, look, uCutSeed, uShapeMix);
      float axis = gid * period * 0.5;
      vec2 dir = vec2(cos(axis), sin(axis));
      vec2 rel = f - dir * GATE_R * scale;
      vec2 q = vec2(dot(rel, dir), dot(rel, vec2(-dir.y, dir.x))) / scale;
      float trail = max(-q.x - 0.35, 0.0);
      q.x = q.x < 0.0 ? q.x / (1.0 + L) : q.x;
      float head = exp(-trail / (L + 0.05));
      float d = gateSdf(shape, q) * scale;
      float glow = (exp(-d / core) + haloGain * exp(-d / HALO_W)) * mix(TAIL_DIM, 1.0, head);
      vec3 prim = look == 4 ? rainbow(hash11(slot + gid * 7.0 + cycle * 3.0) + z * 0.2) : prim0;
      vec3 lc = mix(sec, prim, head);
      lc = mix(lc, rainbow(z * 2.0 + slot * 0.13 + gid * 0.4), farTint);
      col += lc * glow * gain;
    }
  }
  col = 1.0 - exp(-col * KNEE);
  outColor = vec4(col * (1.0 - uBlackFrame), 1.0);
}
`;
