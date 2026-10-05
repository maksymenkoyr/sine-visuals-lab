// Wings (Pro) — a mirrored mass like two wings or a ribcage, made of a very
// dense wire mesh: wires a few pixels apart that fold together into bright
// fibres and spread into dim moiré between them, magenta fading to
// pink-white on the brightest folds. From the alt-wings bundle
// (docs/scenes/longplay.md, Measurements): magenta 300° with violet 270° on
// a near-black ground; lit objects are thousands of short vertical bars and
// dots (the wires, seen through the video's compression); 2-fold 0.96–0.99;
// glow e-fold 12–30 px; dim — most of each frame sits below a fifth of full
// brightness. Close up the "dots" are moiré of parallel wires 2–3 px apart,
// so it is drawn as a displaced wire grid whose lines bunch at the folds,
// not as dots. Motion is slow and mixed — the measured zoom changes
// direction and averages near zero — so the mesh breathes in and out
// instead of flying one way. No hard cuts and no onset flash (FLASH_W
// small); brightness and colour change at phrase starts, so each phrase
// start lifts the mesh, turns its hue and glides to its own composition
// (wings shown or not, their size and height — wPick) over a couple of
// seconds. Flicker blinks only the faint background bands (layer 3): any
// bigger blink reads as the hard cut the reference never makes.

export const WINGS_GLSL = `
const float FLASH_W = 0.1;
const float STROBE_W = 0.3;
const vec3 W_MAG = vec3(0.95, 0.20, 1.0);
const vec3 W_VIO = vec3(0.60, 0.28, 1.0);
const vec3 W_HOT = vec3(1.0, 0.86, 1.0);
const float W_PITCH_PX = 2.6;   // wire spacing where the mesh lies flat
const float W_MORPH_SEC = 2.5;  // a phrase start's glide to the next shape

// Wires along the zero crossings of fract(f), wpx pixels wide; once they
// are closer than about two pixels they blend to their average coverage, so
// bunched wires read as one bright fibre instead of aliasing.
float wires(float f, float wpx) {
  float fw = max(fwidth(f), 1e-4);
  float d = abs(fract(f) - 0.5) / fw;
  float sharp = 1.0 - smoothstep(0.5 * wpx - 0.5, 0.5 * wpx + 0.5, d);
  float avg = min(1.0, wpx * fw);
  return mix(sharp, avg, smoothstep(0.4, 0.9, fw));
}

// A rough relief: ridged value noise, creased like bark, about 0..1.
float wRelief(vec2 q) {
  float s = 0.0, a = 0.5;
  for (int k = 0; k < 5; k++) {
    s += a * (1.0 - abs(2.0 * vnoise(q) - 1.0));
    q = q * 2.07 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return s;
}

// One phrase's composition: x wings shown (0 or 1), y their size, z how
// high they sit.
vec3 wPick(float n) {
  float shown = step(0.25, hash11(n + 0.37));
  float size = 0.55 + 0.5 * hash11(n * 1.71 + 3.1);
  float high = (1.05 - size) * hash11(n * 2.3 + 7.7);
  return vec3(shown, size, high);
}

vec3 viewColor(vec2 p) {
  vec2 q = vec2(abs(p.x), p.y);
  // Continuous across a phrase start (uPhraseN steps up as uPhraseAge
  // resets), then glides one whole step.
  float morph = uPhraseN - 1.0 + smoothstep(0.0, W_MORPH_SEC, uPhraseAge);

  // The silhouette, like a moth or a ribcage: a centre column with a dark
  // dome rising from the bottom, a dark channel either side, then a rounded
  // lobe with spiky tips reaching outward.
  float wob = fbm(vec2(q.x * 1.4, q.y * 0.9) + vec2(morph * 0.71, 3.0)) - 0.5;
  float colW = 0.34 + 0.05 * sin(morph * 1.9);
  float column = smoothstep(colW + 0.04, colW - 0.04, q.x + 0.1 * wob);
  float dome = length(vec2(q.x / 0.32, (q.y + 1.05) / 0.62));
  column *= smoothstep(0.92, 1.08, dome + 0.2 * wob);
  // Each phrase picks how much of the wings shows — full, small and high,
  // or the centre column alone on black — and glides there from the last
  // phrase's pick; the reference swings that far between phrases.
  float km = smoothstep(0.0, W_MORPH_SEC, uPhraseAge);
  vec3 pick = mix(wPick(uPhraseN - 1.0), wPick(uPhraseN), km);
  vec2 lc = vec2(0.42 + 0.54 * pick.y, 0.08 + pick.z);
  vec2 lr = vec2(0.57, 0.98) * pick.y;
  vec2 ld = (q - lc) / lr;
  float ang = atan(ld.y, ld.x);
  float spikes = 0.7 * pow(vnoise(vec2(ang * 7.0 + 40.0, morph)), 3.0) * smoothstep(-0.2, 0.9, cos(ang));
  float body = smoothstep(0.08, -0.08, length(ld) - 1.0 - 0.35 * wob - spikes);
  float mass = max(column, body * pick.x);
  // dark holes through the mesh
  mass *= mix(0.08, 1.0, smoothstep(0.25, 0.37, fbm(q * vec2(5.0, 3.0) + vec2(20.0, morph))));

  // The mesh lies over a rough relief and breathes in and out. The relief
  // lights it (its slope against a light from above and outside, mirrored),
  // darkens its hollows, and shifts each wire by height the way a tilted
  // mesh would — so wires bunch on the slopes into bright fibres.
  float zoom = exp(0.3 * sin(uT * 0.23 + morph * 1.3));
  vec2 u = q * zoom;
  float h = wRelief(vec2(u.x * 3.0, u.y * 2.0) + vec2(morph * 0.6, uT * 0.03));
  // lumps lit from a coarse relief, creases from the fine one
  float hc = fbm(vec2(u.x * 2.4, u.y * 1.6) + vec2(morph * 0.4, 31.0));
  vec2 g = vec2(dFdx(h) * 0.12 + dFdx(hc) * 0.6, dFdy(h) * 0.12 + dFdy(hc) * 0.6) / px;
  g.x *= sign(p.x + 1e-6);
  vec3 nrm = normalize(vec3(-g, 1.0));
  float shade = clamp(dot(nrm, normalize(vec3(0.5, 0.6, 0.6))), 0.0, 1.0);
  float hollow = smoothstep(0.25, 0.6, h);
  vec2 w = u + vec2(0.12 * h, 0.04 * h);
  float n = 1.0 / (W_PITCH_PX * px * zoom);
  float vert = wires(w.x * n, 1.0);
  float xw = wires(w.y * n * 0.6, 1.0);
  float lit = mass * hollow * (0.15 + 1.1 * shade * shade);
  // pink-white on the ridges that face the light
  float spec = pow(shade, 10.0) * mass * hollow;

  float tintK = 0.2 + 0.2 * sin(uPhraseN * 2.3);
  vec3 tint = mix(W_MAG, W_VIO, tintK);
  // thin wiry ridges where the relief crosses a few heights
  float ridge = wires(h * 5.0, 1.2) * mass * hollow * (0.3 + shade);
  float i = (lit * (vert + 0.6 * xw) + spec * (0.25 + 0.6 * vert) + 0.5 * ridge) * (0.7 + 0.8 * uPhrase);
  vec3 c = tint * i * 0.55;
  c = mix(c, W_HOT * i * 0.5, smoothstep(0.05, 0.8, i) * 0.45);
  float patchy = shade;
  // the soft halo inside the mass (the measured 12–30 px glow)
  c += tint * 0.05 * uGlow * smoothstep(0.0, 1.0, mass) * (0.6 + patchy);

  // faint horizontal violet bands in the ground beside the mass
  float bands = smoothstep(0.55, 0.8, fbm(vec2(p.x * 0.5, p.y * 7.0 + uT * 0.05)));
  c += W_VIO * 0.05 * bands * (1.0 - max(column, body * pick.x)) * layerOn(3);
  return c;
}
`;
