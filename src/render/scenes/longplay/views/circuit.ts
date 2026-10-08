// Circuit (Pro) — a site seen from straight above through an edge filter:
// a court outlined in dashes with dashed curves crossing it, banks of seat
// rows either side and along the top and bottom, a column of rounded
// rectangles at the edges, everything lit electric blue and torn into
// horizontal streaks. From the alt-circuit bundle (docs/scenes/longplay.md,
// Measurements): blue 240° 86–99% (azure and cyan in its brightest
// stretch); the frame is mostly bright saturated blue — about half its
// pixels sit above 0.7 — with dark streak gaps; detail runs horizontal (the
// vertical brightness gradient is about twice the horizontal); hundreds of
// short bars, mirrored 2-fold 0.92–0.98; strokes 1.9 px, glow e-fold
// 9–11 px; slow mixed drift; zoom direction reverses on phrase starts. The
// reference is filmed footage, so this is a drawn site in the same filter,
// not the footage. No hard cuts and no onset flash (FLASH_W small); what
// it follows is the high band (activity r +0.36, brightness r +0.27), so
// Lift — wired to the treble by default — brightens the edges and speeds
// the tearing. Flicker blinks only the small rounded rectangles (layer 2):
// a blinking court or seat bank reads as the hard cut the reference never
// makes.

export const CIRCUIT_GLSL = `
const float FLASH_W = 0.1;
const float STROBE_W = 0.2;
const vec3 C_BLUE = vec3(0.04, 0.03, 1.0);
const vec3 C_AZURE = vec3(0.20, 0.50, 1.0);
const vec3 C_EDGE = vec3(0.55, 0.85, 1.0);
const float C_ROW = 0.018;      // the tearing's row height, half-heights
const float C_ZOOM_SEC = 4.0;   // a phrase start's zoom run

float cBox(vec2 p, vec2 c, vec2 h) {
  vec2 d = abs(p - c) - h;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
float cSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}
// An edge-filtered line: a 1.9 px stroke and its measured ~10 px glow.
float cEdge(float d) { return stroke(d, 1.9) + 0.08 * uGlow * glow(d, 10.0); }
// Dashes along a line, \`along\` its length coordinate.
float cDash(float along, float period) { return step(0.45, fract(along / period)); }

vec3 viewColor(vec2 p) {
  float lift = uLift * liftDrive(uHigh);
  // The camera: zoom runs one way for a phrase, then the other.
  float s = uPhraseN - 1.0 + smoothstep(0.0, C_ZOOM_SEC, uPhraseAge);
  float zl = 0.32 * abs(mod(s, 2.0) - 1.0) - 0.12;
  vec2 cam = vec2(0.0, 0.06 * sin(uT * 0.05));

  // Tearing: each row slides sideways on its own slow wobble.
  float row = floor(p.y / C_ROW);
  float tn = vnoise(vec2(row * 0.43, uT * (0.25 + 0.5 * lift)));
  float tear = 0.1 * (tn - 0.5) * smoothstep(0.55, 0.8, hash11(row * 0.71 + 5.0));
  vec2 q = vec2(abs(p.x + tear), p.y);
  vec2 w = q * exp(-zl) + cam;

  // the fill: bright blue runs along each row with dark gaps between
  float run = vnoise(vec2(w.x * 3.5 + row * 1.7, row * 0.37 + uT * 0.04));
  // the ground under it: small blocks of their own brightness (the site's
  // roofs and lots), so edges run vertical as well as along the rows
  // each band of blocks has its own width, so the ground isn't a brick wall
  float bandY = floor(w.y / 0.045);
  vec2 bsz = vec2(0.04 + 0.09 * hash11(bandY * 1.31 + 2.0), 0.045);
  vec2 bc = (w + vec2(hash11(bandY) * 0.1, 0.0)) / bsz;
  vec2 bid = floor(bc);
  float blk = hash21(bid + 3.0);
  float fill = smoothstep(0.2, 0.6, run) * mix(0.35, 1.1, blk) * (0.55 + 0.6 * fbm(w * vec2(2.0, 3.0) + 9.0));
  vec3 c = C_BLUE * 2.1 * fill;

  float e = 0.0;     // edges, in C_EDGE
  float a = 0.0;     // lit structure, in C_AZURE

  // the court: a dashed outline, dashed curves crossing it, tick marks
  vec2 cc = vec2(0.0, 0.07), ch = vec2(0.76, 0.57);
  float court = cBox(w, cc, ch);
  float dash = abs(w.y - cc.y) > ch.y - 0.02 ? cDash(w.x, 0.05) : cDash(w.y, 0.05);
  e += cEdge(abs(court)) * dash;
  vec2 k = w - vec2(0.0, cc.y);
  float inCourt = step(court, 0.0);
  c *= 1.0 - 0.3 * inCourt;
  // dashed lines from the top and bottom centre out to the sides, crossing
  float l1 = cSeg(k, vec2(0.0, 0.57), vec2(0.76, -0.25));
  float l2 = cSeg(k, vec2(0.0, -0.57), vec2(0.76, 0.3));
  float marks = (cEdge(l1) * cDash(k.x - k.y, 0.07) + cEdge(l2) * cDash(k.x + k.y, 0.07)) * inCourt * 1.4;
  marks += cEdge(abs(w.x - 0.62)) * step(abs(w.y - 0.05), 0.06) * 0.8; // the spot either side
  e += marks;

  // seat banks: rows of short bars beside the court, columns above and below
  float side = cBox(w, vec2(1.12, 0.12), vec2(0.2, 0.68));
  float sideRows = step(0.42, fract(w.y / 0.034)) * step(0.02, abs(w.x - 1.12));
  float top = cBox(w, vec2(0.0, 0.95), vec2(0.9, 0.07));
  float bottom = cBox(w, vec2(0.0, -0.78), vec2(0.82, 0.17));
  float colD = (abs(fract(w.x / 0.03) - 0.5) - 0.22) * 0.03;   // to a seat bar's side
  float tier = step(0.012, abs(w.y + 0.78));
  float cols = step(colD, 0.0) * tier;
  float inTB = step(min(top, bottom), 0.0);
  float banks = step(side, 0.0) * sideRows + inTB * cols * 0.6;
  e += cEdge(colD) * inTB * tier * 0.7;
  float bankEdge = cEdge(abs(side)) + cEdge(abs(top)) + cEdge(abs(bottom));
  a += banks * 1.2;
  e += bankEdge * 0.5 + banks * 0.35;

  // the rounded rectangles in a column at the edges
  float slot = w.y - 0.15 * floor(w.y / 0.15 + 0.5);
  float car = length(max(abs(vec2(w.x - 1.48, slot)) - vec2(0.11, 0.04), 0.0)) - 0.02;
  car = step(abs(w.y + 0.05), 0.42) > 0.5 ? car : 1e3;
  e += cEdge(abs(car)) * layerOn(2);
  a += step(car, 0.0) * 0.4 * layerOn(2);

  // clutter on the ground: some blocks' sides lit as short bars
  vec2 bf = fract(bc);
  float bv = min(bf.x, 1.0 - bf.x) * bsz.x;
  float bh = min(bf.y, 1.0 - bf.y) * bsz.y;
  float ground = (1.0 - inCourt) * (1.0 - step(side, 0.0)) * (1.0 - inTB);
  e += 0.55 * ground * (cEdge(bv) * step(0.7, hash21(bid + 17.0)) + cEdge(bh) * step(0.78, hash21(bid + 41.0)));

  // the edges smear along the tearing, like the reference's streaks
  float smear = 0.6 + 0.4 * fill;
  float gain = (0.75 + 0.9 * lift) * (1.0 + 0.6 * uPhrase);
  c += C_AZURE * a * smear;
  c += C_EDGE * e * smear * gain;
  return c;
}
`;
