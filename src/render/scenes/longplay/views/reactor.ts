// Reactor — the set's long closing look: an 8-fold gear outline round a
// glowing red core, concentric rings pushed out on hits, red tabs in the
// gear's notches, and arrows that slam in from the sides on the strongest
// hits. Numbers from the alt-hud bundle (docs/scenes/longplay.md,
// Measurements): red 0° / rose 330° on black; 8-fold symmetry (score
// 0.70–0.80), mirrored; gear at about 0.8 half-heights, rings at r ≈ 0.24
// and 0.42 with launched rings out past 0.95; strokes 1.9 px, 2.8 px on the
// outer rings; brightness flashes on onsets within a frame (FLASH_W 1), the
// rest is flicker (95 hard cuts in 40 s — a timer). Layers: 0 gear, 1 rings,
// 2 tabs + arrows, 3 core.

export const REACTOR_GLSL = `
const float FLASH_W = 1.0;
const float STROBE_W = 0.4;
const vec3 R_ROSE = vec3(1.0, 0.42, 0.55);
const vec3 R_RED = vec3(1.0, 0.06, 0.04);
const vec3 R_SALMON = vec3(1.0, 0.55, 0.45);
const float R_GEAR = 0.80;

// Polar fold into one 45° wedge, mirrored about its centre line.
vec2 wedge8(vec2 p) {
  float r = length(p);
  float a = atan(p.y, p.x);
  a = abs(mod(a + PI / 8.0, PI / 4.0) - PI / 8.0);
  return r * vec2(cos(a), sin(a));
}
float box(vec2 q, vec2 b) {
  vec2 d = abs(q) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// Arrow pointing toward the centre, sitting at x = 1.35.
float arrow(vec2 p) {
  vec2 q = p - vec2(1.35, 0.0);
  float shaft = box(q - vec2(0.12, 0.0), vec2(0.10, 0.045));
  vec2 t = vec2(q.x + 0.02, abs(q.y));
  float head = max(-t.x, t.x * 0.75 + t.y - 0.10);
  return min(shaft, head);
}

vec3 viewColor(vec2 p) {
  p.x = abs(p.x);
  vec2 q = wedge8(p);
  float r = length(p);
  vec3 c = vec3(0.0);

  // 0: the gear — an octagon with a notch at each corner
  vec2 corner = vec2(R_GEAR, R_GEAR * 0.4142);
  float gear = max(q.x - R_GEAR, -box(q - corner, vec2(0.10)));
  float inner = q.x - 0.30;
  // the reference's outline is a double line, ~5 px apart
  vec3 gearC = R_ROSE * (stroke(gear, 1.9) + stroke(gear + 5.0 * px, 1.9) + 0.8 * stroke(inner, 1.9));
  gearC += R_ROSE * glow(gear, 4.0) * 0.25 * uGlow;
  c += gearC * layerOn(0);

  // 1: fixed rings + rings launched outward on hits
  vec3 rings = R_ROSE * (stroke(r - 0.42, 1.9) + 0.7 * stroke(r - 0.24, 1.9));
  float band = smoothstep(0.585, 0.595, r) * smoothstep(0.665, 0.655, r);
  rings += R_SALMON * band * 0.6 * uPhrase;
  // Most hits send one thin ring; about one in three is a burst — a
  // spread of rings, the salmon band and the side arrows — so the view
  // swings between sparse and full the way the reference does.
  float burstNow = 0.0;
  for (int i = 0; i < LAUNCH_SLOTS; i++) {
    float age = uLaunchAge[i];
    float fade = uLaunchAmp[i] * exp(-age * 2.0);
    if (fade < 0.01) continue;
    bool burst = uLaunchSeed[i] > 0.67;
    if (burst) burstNow = max(burstNow, fade);
    int n = burst ? 6 : 1;
    for (int k = 0; k < 6; k++) {
      if (k >= n) break;
      float rr = 0.42 + age * 0.95 + float(k) * 0.06;
      rings += mix(R_SALMON, R_ROSE, float(k) / 5.0) * stroke(r - rr, 2.8) * fade;
      rings += R_RED * glow(r - rr, 8.0) * fade * 0.25 * uGlow;
    }
  }
  rings += R_SALMON * band * burstNow * 1.2;
  c += rings * layerOn(1);

  // 2: red tabs in the gear's notches + side arrows on bursts
  float tab = box(q - corner * 0.90, vec2(0.03, 0.045));
  vec3 tabs = R_RED * (1.0 - smoothstep(-px, px, tab));
  float ar = arrow(p);
  tabs += R_SALMON * (1.0 - smoothstep(-px, px, ar)) * smoothstep(0.2, 0.6, burstNow);
  c += tabs * layerOn(2);

  // 3: the core — mostly dark, as measured: a rim and a faint ember that
  // bursts light up
  vec3 core = R_RED * smoothstep(0.12, 0.0, r) * (0.12 + 0.6 * burstNow);
  core += mix(R_ROSE, vec3(1.0), 0.3) * stroke(r - 0.12, 3.0) * 0.6;
  core += R_RED * glow(r - 0.12, 10.0) * 0.3 * uGlow;
  c += core * layerOn(3);
  return c;
}
`;
