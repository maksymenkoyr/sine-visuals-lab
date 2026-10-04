// Bloom (Pro) — a red ink core inside a ring of paint that blooms outward,
// white at its inner edge through cyan to blue, with pink neon squares
// launched out on hits and red ink spattered round the edges. From the
// alt-bloom bundle (docs/scenes/longplay.md, Measurements): magenta/rose
// 300–330° on a dark red ground with a red core; squares at 1.9 px and
// 6.7 px; glow e-fold ~12 px; the slit-scan shows the blue paint ring
// growing from the centre to the frame edge over about five seconds, again
// and again — here once per phrase (uPhraseAge), cycling on its own when no
// tempo is held. Activity flashes on onsets but brightness doesn't (FLASH_W
// small); the 63 hard cuts in 40 s are the shared flicker. Layers: 0 core +
// paint ring, 1 squares, 2 ink spatter, 3 blue halo.

export const BLOOM_GLSL = `
const float FLASH_W = 0.35;
const float STROBE_W = 0.3;
const vec3 B_RED = vec3(1.0, 0.03, 0.03);
const vec3 B_PINK = vec3(1.0, 0.35, 0.75);
const vec3 B_WHITE = vec3(0.95, 0.88, 1.0);
const vec3 B_CYAN = vec3(0.35, 0.85, 1.0);
const vec3 B_BLUE = vec3(0.10, 0.18, 1.0);
const float B_CYCLE_SEC = 7.5; // one phrase at the reference's 129 bpm

vec3 viewColor(vec2 p) {
  p.x = abs(p.x);
  float r = length(p);
  float a = atan(p.y, p.x);
  vec3 c = vec3(0.0);
  float ragged = fbm(vec2(a * 3.0, uT * 0.4)) - 0.5;

  // 0: the ink core and the paint ring that blooms out of it
  float coreR = 0.17 + 0.05 * ragged;
  vec3 core = B_RED * (1.0 - smoothstep(coreR - 2.0 * px, coreR + 2.0 * px, r));
  float k = mod(uPhraseAge, B_CYCLE_SEC) / B_CYCLE_SEC;
  float ringR = 0.24 * exp(k * 2.2);             // centre to past the edge
  float ringW = 0.10 + 0.25 * k;
  float edgeNoise = 0.06 * (fbm(vec2(a * 5.0, ringR * 3.0)) - 0.5);
  float inRing = (r - (ringR - ringW) - edgeNoise) / ringW;  // 0 inner .. 1 outer
  float ringMask = smoothstep(0.0, 0.08, inRing) * smoothstep(1.05, 0.9, inRing);
  float speck = smoothstep(0.35, 0.65, vnoise(p * 40.0 + uT));
  // white only at the very inner lip, then saturated cyan into blue
  vec3 paint = mix(B_WHITE, mix(B_CYAN, B_BLUE, smoothstep(0.35, 0.9, inRing)), smoothstep(0.0, 0.18, inRing));
  core += paint * ringMask * (0.8 + 0.4 * speck) * (1.0 - 0.5 * k);
  // red ink pooling inside the ring as it opens
  float pool = smoothstep(0.2, 0.0, inRing) * step(coreR, r) * smoothstep(0.45, 0.7, fbm(p * 2.5 + uT * 0.1));
  core += B_RED * pool * 0.7 * k;
  c += core * layerOn(0);

  // 1: pink squares launched out on hits
  vec3 sq = vec3(0.0);
  for (int i = 0; i < LAUNCH_SLOTS; i++) {
    float h = 0.28 * exp(1.2 * uLaunchAge[i]);
    if (h > 2.2) continue;
    float fade = uLaunchAmp[i] * smoothstep(2.2, 1.2, h);
    float d = sqDist(p, h);
    sq += B_PINK * (stroke(d, uLaunchSeed[i] > 0.6 ? 6.7 : 1.9) + 0.4 * uGlow * glow(d, 12.0)) * fade;
  }
  sq += B_PINK * stroke(sqDist(p, 0.36), 1.9) * 0.6;
  c += sq * layerOn(1);

  // 2: red ink spatter toward the edges
  float sp = fbm(p * 3.5 + vec2(0.0, uT * 0.05));
  float spatter = smoothstep(0.58, 0.64, sp) * smoothstep(0.7, 1.3, r);
  c += B_RED * spatter * 0.8 * layerOn(2);

  // 3: the blue halo round the bloom
  float halo = exp(-abs(r - ringR - 0.05) / (0.08 + 0.2 * k));
  c += B_BLUE * halo * 0.6 * (1.0 - k) * uGlow * layerOn(3);
  return c;
}
`;
