// Chip (Pro) — a square corridor flown down toward a chip at its end: walls
// covered in circuit blocks streaming outward, bright struts in the
// corners, and nested die outlines with comb-like pins round a white-hot
// core. A phrase start brings it up close and red-hot for a moment; it
// then pulls back to a small chip — red round a hot speck most phrases,
// dark blue with cyan dots on some — with a bracket under it and posts
// either side, until the next phrase. From the alt-chip bundle
// (docs/scenes/longplay.md, Measurements): red/rose/magenta with orange
// highlights and a white core in the bright phase (8-fold 0.91, glow
// e-fold ≈30 px), small shapes on black between — the dim phase is more
// than half the clip, and its ref-shoot frames at the same beats show the
// full corridor rarely; zooms in +1.6 log-scale/s; brightness and colour
// jump at phrase starts (z +1.51, +1.06) and don't flash on onsets
// (FLASH_W small); 118 hard cuts in 40 s, median hold 67 ms, and many
// frames black — the shared Flicker, which here blinks every layer and
// blacks out the whole picture (layer 2). The measured −97°/s rotation is
// the 4-fold picture aliasing, not a turn: every frame of it is square to
// the screen. With no tempo held the phrase count stalls, so the heat
// cycles on its own every K_CYCLE_SEC. Layers: 0 core, 1 die outlines +
// pins + bracket, 2 the whole picture, 3 walls, struts and posts.

export const CHIP_GLSL = `
const float FLASH_W = 0.2;
const float STROBE_W = 0.6;
const vec3 K_RED = vec3(1.0, 0.06, 0.04);
const vec3 K_ORANGE = vec3(1.0, 0.55, 0.12);
const vec3 K_PINK = vec3(1.0, 0.30, 0.85);
const vec3 K_WHITE = vec3(1.0, 0.92, 1.0);
const vec3 K_BLUE = vec3(0.10, 0.22, 1.0);
const vec3 K_CYAN = vec3(0.20, 0.95, 1.0);
const float K_ZOOM = 1.6;       // log-scale per second, measured
const float K_RING = 0.32;      // log-depth between the corridor's ribs
const float K_CORE_HOT = 0.30;  // the core's half-size up close
const float K_CORE_COOL = 0.13; // and pulled back
const float K_HOT_SEC = 1.2;    // how long a phrase start's heat holds
const float K_CYCLE_SEC = 7.5;  // one phrase at the reference's 129 bpm

vec3 viewColor(vec2 p) {
  vec2 ap = abs(p);
  float r = max(ap.x, ap.y);
  float along = min(ap.x, ap.y) / max(r, 1e-4);   // 0 mid-wall .. 1 corner (8-fold)
  float age = mod(uPhraseAge, K_CYCLE_SEC);
  float hot = 1.0 - smoothstep(K_HOT_SEC, K_HOT_SEC + 0.5, age);
  // the cool chip is warm most phrases, blue and cyan on some
  float blue = step(0.65, hash11(uPhraseN * 1.37 + 0.5));
  vec3 coolHi = mix(K_WHITE, K_CYAN, blue);
  vec3 coolLo = mix(K_RED, K_BLUE, blue);
  float core = mix(K_CORE_COOL, K_CORE_HOT, hot);
  float l = log(max(r, 1e-4) / core);            // log-depth out from the core
  float z = l - K_ZOOM * uT;                     // the corridor streams outward
  vec3 c = vec3(0.0);

  // 0: the core — white-hot up close; far off a red die round a hot speck,
  // or a dark blue one with cyan dots
  float inCore = 1.0 - smoothstep(-1.5 * px, 1.5 * px, r - core);
  vec2 cq = p / core;
  float dots = step(0.72, hash21(floor(cq * 5.0) + floor(uT * 3.0)))
             * (1.0 - smoothstep(0.25, 0.32, length(fract(cq * 5.0) - 0.5)));
  vec3 coolCore = mix(K_RED * 0.45 + mix(K_ORANGE, K_WHITE, 0.5) * (1.0 - smoothstep(0.2, 0.5, length(cq))) * 1.6,
                       K_BLUE * 0.35 + mix(K_CYAN, vec3(0.3, 1.0, 0.6), hash21(floor(cq * 5.0))) * dots * 0.8, blue);
  vec3 coreC = mix(coolCore, K_WHITE * 2.2, hot);
  vec3 halo = mix(coolLo, K_WHITE, hot) * glow(r - core, mix(6.0, 30.0, hot)) * (0.25 + 0.35 * hot) * uGlow;
  c += (coreC * inCore + halo * (1.0 - inCore)) * layerOn(0);

  // 1: the die — nested outlines just outside the core, with pins between
  vec3 die = vec3(0.0);
  float rings[5];
  rings[0] = 0.05; rings[1] = 0.13; rings[2] = 0.23; rings[3] = 0.36; rings[4] = 0.47;
  for (int i = 0; i < 5; i++) {
    float d = r - core * exp(rings[i]);
    float w = mix(4.0, i == 4 ? 7.0 : 5.5, hot);
    die += mix(i % 2 == 0 ? coolHi * 1.4 : coolLo * 1.2, i % 2 == 0 ? K_WHITE * 1.4 : K_PINK, hot) * stroke(d, w);
  }
  float pinBand = step(0.16, l) * step(l, 0.22) + step(0.38, l) * step(l, 0.45);
  float pins = step(0.5, fract(along * 36.0)) * pinBand;
  die += mix(K_RED, coolLo * 0.6, 1.0 - hot) * pins * 0.8;
  // red between the outlines while hot
  die += K_RED * 0.18 * hot * step(0.0, l) * step(l, 0.47);
  // the cool phase's bracket: the lower half of a square under the chip
  float bracket = stroke(r - core * 3.2, 5.0) * step(p.y, core * 0.6) * (1.0 - hot);
  die += mix(coolHi, vec3(1.0, 0.85, 0.3), 0.5 * (1.0 - blue)) * bracket * 1.6;
  c += die * step(-0.01, l) * layerOn(1);

  // 3: the walls — circuit blocks in (along, depth) cells, streaming out
  float wallZone = smoothstep(0.45, 0.6, l) * smoothstep(1.3, 0.7, r);
  float zz = z / (K_RING / 2.0);
  float rowW = 3.0 + 3.0 * hash11(floor(zz) * 1.7 + 4.0);
  vec2 cg = vec2(along * rowW + hash11(floor(zz)), zz);
  vec2 cell = floor(cg);
  vec2 f = fract(cg);
  vec2 lo = vec2(hash21(cell + 1.0), hash21(cell + 2.0)) * 0.25;
  vec2 hi = lo + 0.45 + 0.3 * vec2(hash21(cell + 3.0), hash21(cell + 4.0));
  vec2 fw = max(fwidth(cg), vec2(1e-4));
  vec2 dIn = min(f - lo, hi - f) / fw;           // pixels inside each pair of sides
  float block = step(0.0, min(dIn.x, dIn.y));
  float blockEdge = block * (1.0 - smoothstep(0.5, 1.6, min(dIn.x, dIn.y)));
  float lum = hash21(cell + 9.0);
  // black or bright, like the reference: a third of the cells hold nothing
  vec3 blockC = lum > 0.85 ? K_ORANGE : (lum < 0.45 ? K_PINK : K_RED);
  float near = exp(-(l - 0.47) / 0.6);            // the walls are lit from the chip
  float streak = smoothstep(0.35, 0.8, vnoise(vec2(along * 40.0, z * 0.6)));
  vec3 wallC = blockC * block * step(0.33, lum) * (0.6 + 1.4 * near) * (0.6 + 0.6 * streak);
  // light bursting out of the die's edges, in streaks down the walls
  wallC += mix(K_ORANGE, K_WHITE, 0.4) * streak * exp(-(l - 0.47) / 0.12) * 1.6;
  wallC += mix(K_PINK, K_WHITE, step(0.7, lum)) * blockEdge * 0.9;
  // big dark components in front of the blocks, edged in pink-white
  vec2 og = vec2(along * 1.6, zz * 0.35 + 0.5);
  vec2 oc = floor(og);
  vec2 of = fract(og);
  vec2 ofw = max(fwidth(og), vec2(1e-4));
  vec2 oIn = min(of - 0.12, 0.88 - of) / ofw;
  float occ = step(0.55, hash21(oc + 23.0)) * step(0.0, min(oIn.x, oIn.y));
  wallC *= 1.0 - occ;
  wallC += K_PINK * 0.7 * occ * (1.0 - smoothstep(0.5, 1.6, min(oIn.x, oIn.y)));
  // the corridor's ribs: square outlines passing outward
  float fz = fract(z / K_RING);
  float dRib = min(fz, 1.0 - fz) * K_RING / max(fwidth(z), 1e-4) * px;  // pixels → half-heights
  wallC += K_RED * stroke(dRib, 3.0) * 0.8;
  c += wallC * wallZone * hot * layerOn(3);

  // 3: struts in the corners and pink dashes down the walls
  float diag = (ap.x - ap.y) * 0.7071;
  float beamW = 0.035 * r;
  float beam = 1.0 - smoothstep(beamW - px, beamW + px, abs(diag));
  float strut = stroke(abs(diag) - beamW, 3.0) + 0.3 * glow(abs(diag) - beamW, 8.0) * uGlow;
  float dash = stroke((fract(along * 3.5) - 0.5) / 3.5 * r, 2.0) * step(0.5, fract(zz * 0.5 + 0.25));
  vec3 struts = K_WHITE * strut * 0.9 + K_PINK * dash * 0.8;
  c *= 1.0 - beam * wallZone * hot * layerOn(3);
  c += struts * wallZone * hot * layerOn(3);

  // 3: posts either side of the chip, red with yellow tips
  float postA = stroke(ap.x - core * 4.6, 6.0) * step(-core * 3.2, p.y) * step(p.y, core * 1.8);
  float postB = stroke(ap.x - core * 6.6, 6.0) * step(-core * 0.8, p.y) * step(p.y, core * 4.0);
  vec3 postC = mix(K_RED, vec3(1.0, 0.9, 0.5), smoothstep(-core, core * 3.0, p.y));
  c += postC * (postA + postB) * 1.8 * layerOn(3);

  // 2: the whole picture blacks out for a hold now and then
  return c * layerOn(2) * (0.9 + 0.5 * uPhrase);
}
`;
