// Tunnel — the set's opening look: nested gold-and-red neon squares on
// black that exist only in a flash on each hit. Every hit launches a square
// from the centre that keeps growing out past the frame, and every later
// hit lights all the squares still in flight at their new sizes — so the
// picture is a strobe of the same few squares, each flash bigger. Mirrored
// "claw" ornaments, the top ornament bars or the frame join some flashes.
// From the alt-tunnel bundle (docs/scenes/longplay.md, Measurements): red
// 0° on a black ground, the brightest squares gold; strokes 6.7 px; glow
// e-fold 6–9 px; squares at half-sizes 0.07/0.12/0.22 and a frame near
// 0.62; a square grows at +1.9 log-scale/s (the measured zoom-in); claws at
// |x| 1.1–1.6; the reference's frames 80 ms before and 160 ms after a beat
// are black (T_FLASH_SEC). Brightness flashes on onsets (FLASH_W 1) and its
// strobe runs one flash per beat (STROBE_W 1). Layers: 0 inner nest + top
// ornaments, 1 squares in flight, 2 claws, 3 pillars + frame — any of them
// may blink off (Flicker).

export const TUNNEL_GLSL = `
const float FLASH_W = 1.0;
const float STROBE_W = 1.0;
const vec3 T_RED = vec3(1.0, 0.05, 0.02);
const vec3 T_GOLD = vec3(1.0, 0.70, 0.18);
const vec3 T_HOT = vec3(1.0, 0.93, 0.82);
const float T_ZOOM = 1.9; // log-scale per second
const float T_FLASH_SEC = 0.08; // e-fold of a hit's flash — gone by the +160 ms frame

// A neon square: a thick gold stroke with a hot core, edged and haloed in
// red — the reference's squares are yellow-gold at their brightest.
vec3 neonSquare(vec2 p, float h, float amp) {
  float d = sqDist(p, h);
  vec3 c = T_RED * stroke(d - 3.0 * px, 3.0);
  c += T_GOLD * stroke(d, 6.7) * 0.9;
  c += T_HOT * stroke(d, 2.0) * 0.6;
  c += T_RED * glow(d, 7.5) * 0.55 * uGlow;
  return c * amp;
}

// One horn: a spike rising from y0 to y0 + len, bending outward by bend
// and tapering from half-width w0 to a point.
float horn(vec2 q, float y0, float len, float bend, float w0) {
  float k = clamp((q.y - y0) / len, 0.0, 1.0);
  float cx = bend * k * k;
  float halfW = w0 * (1.0 - k);
  float d = abs(q.x - cx) - halfW;
  float cap = max(y0 - q.y, q.y - (y0 + len));
  return max(d, cap);
}
// The ornament either side: an outer pair of tall horns curving apart and
// a shorter inner pair — the reference's "claws" at |x| 1.1–1.6.
float claw(vec2 p) {
  vec2 q = p - vec2(1.36, 0.0);
  float d = horn(q - vec2(-0.12, 0.0), -0.22, 0.40, -0.10, 0.035);
  d = min(d, horn(q - vec2(0.12, 0.0), -0.22, 0.40, 0.10, 0.035));
  d = min(d, horn(q - vec2(-0.04, 0.0), -0.18, 0.24, -0.04, 0.025));
  d = min(d, horn(q - vec2(0.04, 0.0), -0.18, 0.24, 0.04, 0.025));
  // the base bar the horns grow from
  d = min(d, length(max(abs(q - vec2(0.0, -0.22)) - vec2(0.15, 0.012), 0.0)));
  return d;
}

// The top ornament: two bars with hooked ends per side (mirrored).
float topBars(vec2 p) {
  vec2 q = p - vec2(0.0, 0.74);
  float d = 1e3;
  d = min(d, length(max(abs(q - vec2(0.20, 0.0)) - vec2(0.11, 0.0), 0.0)));
  d = min(d, length(max(abs(q - vec2(0.31, -0.05)) - vec2(0.0, 0.05), 0.0)));
  d = min(d, length(max(abs(q - vec2(0.47, 0.0)) - vec2(0.08, 0.0), 0.0)));
  d = min(d, length(max(abs(q - vec2(0.55, -0.07)) - vec2(0.0, 0.07), 0.0)));
  return d;
}

vec3 viewColor(vec2 p) {
  p.x = abs(p.x);
  // The picture exists only in a flash on each hit: the reference's frames
  // 80 ms before and 160 ms after a beat are black. A hit lights every
  // square still in flight at its current size — successive flashes show
  // the same square bigger, the outward dashes in the slit-scan.
  float vis = 0.0, newest = 1e3, seed = 0.0;
  for (int i = 0; i < LAUNCH_SLOTS; i++) {
    float e = exp(-uLaunchAge[i] / T_FLASH_SEC) * uLaunchAmp[i];
    vis = max(vis, e);
    if (uLaunchAge[i] < newest) { newest = uLaunchAge[i]; seed = uLaunchSeed[i]; }
  }
  vis = max(vis, uStrobe * 0.8);
  if (vis < 0.003) return vec3(0.0);
  vec3 c = vec3(0.0);

  // 0: the inner nest, and the top ornament on some flashes
  vec3 nest = neonSquare(p, 0.07, 0.8) + neonSquare(p, 0.12, 0.6);
  if (seed > 0.25 && seed < 0.45) {
    float bars = topBars(p);
    nest += T_RED * (stroke(bars, 5.0) + 0.5 * uGlow * glow(bars, 6.0));
  }
  c += nest * layerOn(0);

  // 1: every square in flight, at its current size
  vec3 flown = vec3(0.0);
  for (int i = 0; i < LAUNCH_SLOTS; i++) {
    float h = 0.10 * exp(T_ZOOM * uLaunchAge[i]);
    if (h > 2.4) continue;
    float fade = uLaunchAmp[i] * smoothstep(2.4, 1.4, h);
    flown += neonSquare(p, h, fade);
    flown += T_HOT * stroke(sqDist(p, h) + 1.5 * px, 1.2) * fade;
  }
  c += flown * layerOn(1);

  // 2: claws, on some flashes
  if (seed < 0.25) {
    float cl = claw(p);
    c += (T_RED * (1.0 - smoothstep(-px, px, cl)) * 0.9 + T_RED * glow(cl, 9.0) * 0.4 * uGlow) * layerOn(2);
  }

  // 3: edge pillars + the frame square, on some flashes and phrase starts
  if (seed > 0.8 || uPhrase > 0.5) {
    float pil = min(abs(p.x - 1.70), abs(p.x - 1.76));
    c += (T_RED * stroke(pil, 4.0) * 0.7 + neonSquare(p, 0.62, 0.8)) * layerOn(3);
  }
  return c * vis;
}
`;
