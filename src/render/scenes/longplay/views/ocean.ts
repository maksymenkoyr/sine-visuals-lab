// Ocean — the calmest view: an edge-filtered sea seen at an angle, thin
// blue-white foam strokes in bright patches with dark water between. From
// the alt-ocean bundle (docs/scenes/longplay.md, Measurements): blue 240°
// (71–81%) with violet and azure, near-black ground; strokes 1.9 px with
// almost no glow (e-fold ~2 px); nearly every lit object a horizontal bar;
// a 2-fold score of 0.74–0.87 that comes from the horizontal streaks, not
// a mirror (it isn't drawn mirrored); slow mixed drift. No hard cuts and no
// flash on onsets (FLASH_W small, STROBE_W 0); what it does react to is the
// phrase start — zoom speed and colour change most there — so the drift
// surges and the hue turns on uPhrase/uPhraseN. Layers: 0 foam, 1 crests.

export const OCEAN_GLSL = `
const float FLASH_W = 0.15;
const float STROBE_W = 0.0;
const vec3 O_BLUE = vec3(0.16, 0.18, 1.0);
const vec3 O_VIOLET = vec3(0.42, 0.20, 1.0);
const vec3 O_FOAM = vec3(0.80, 0.80, 1.0);
// Mild perspective: the reference's size-vs-radius law is near flat
// (r^-0.03 … r^-0.42), so features only shrink a little toward the top.
const float O_TILT = 0.35;
const float O_SCALE = 3.0;

vec3 viewColor(vec2 p) {
  // measured drift ~0.07 half-heights/s, surging on a phrase start
  float travel = uT * 0.07 * O_SCALE + uPhrase * 0.5;
  vec2 w = p * O_SCALE / (1.0 + O_TILT * p.y) + vec2(0.0, travel);

  // bright patches and dark holes, a few per frame
  float patchN = fbm(vec2(w.x * 0.22, w.y * 0.75) + vec2(uT * 0.03, 0.0));
  float m = smoothstep(0.36, 0.54, patchN);

  // foam strokes: contours of a field stretched along x
  // stretched ~12:1 along x — the reference's lit objects are nearly all
  // horizontal bars — with a light warp so strands bend but don't close
  vec2 s = vec2(w.x * 0.8, w.y * 9.5);
  float n = fbm(s + vec2(0.35 * fbm(s * 0.3 + uT * 0.10), 0.0));
  float f = n * 6.0;
  float lw = abs(fract(f) - 0.5) / max(fwidth(f), 1e-4);
  float line = 1.0 - smoothstep(0.55, 1.5, lw);
  float crest = smoothstep(0.45, 0.7, n) * smoothstep(0.45, 0.65, patchN);

  vec3 tint = mix(O_BLUE, O_VIOLET, 0.15 + 0.15 * sin(uPhraseN * 1.7));
  vec3 foam = tint * line * m * (1.5 + 0.5 * uPhrase);
  vec3 crests = O_FOAM * line * crest * 1.8;
  return foam * layerOn(0) + crests * layerOn(1);
}
`;
