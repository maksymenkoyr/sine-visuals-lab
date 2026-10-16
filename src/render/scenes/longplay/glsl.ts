// What every Long Play view's fragment shader shares: the per-frame state
// index.ts uploads (launch pool, phrase pulse, flicker mask, strobe), stroke
// and glow helpers sized in screen pixels, and the main() that frames a view
// and lays the shared reactions over it. A view module (views/*.ts) supplies
// only `vec3 viewColor(vec2 p)` plus two consts, FLASH_W and STROBE_W — how
// much of the shared onset flash and strobe that view takes, from what the
// reference measured per view.
//
// Coordinates: `p` is centred, in half-heights (the unit report.md's
// "Picture, measured" uses — r = 1 is the top edge), so a measured radius or
// size goes into a view as is. `px` is one screen pixel in those units, so
// a measured stroke (1.9 px) or glow e-fold (9 px) is written in pixels too.

export const LAUNCH_SLOTS = 8;

export const LONGPLAY_UNIFORMS_GLSL = `
uniform float uT;                       // speed-integrated time, seconds
uniform float uLaunchAge[${LAUNCH_SLOTS}];  // seconds since each launch (large = empty)
uniform float uLaunchAmp[${LAUNCH_SLOTS}];  // that launch's strength 0..1
uniform float uLaunchSeed[${LAUNCH_SLOTS}]; // a random 0..1 drawn at that launch
uniform float uPhrase;                  // decaying pulse at each phrase start (16-beat count)
uniform float uPhraseN;                 // phrase starts so far
uniform float uPhraseAge;               // speed-scaled seconds since the last phrase start
uniform float uFlickMask;               // 4-bit mask of layers blinked off this hold
uniform float uStrobe;                  // 0..1 strobe flash, already scaled by Flicker
`;

export const LONGPLAY_COMMON_GLSL = `
#define PI 3.14159265
#define LAUNCH_SLOTS ${LAUNCH_SLOTS}
float px; // one screen pixel in half-heights, set in main()

float hash11(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float hash21(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 q) {
  vec2 i = floor(q), f = fract(q);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), u.x),
             mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), u.x), u.y);
}

float fbm(vec2 q) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(q);
    q = q * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return s;
}

// A stroke of \`widthPx\` screen pixels along the zero set of a distance d.
float stroke(float d, float widthPx) {
  float hw = 0.5 * widthPx * px;
  return 1.0 - smoothstep(hw - px, hw + px, abs(d));
}
// An exponential glow whose e-fold is \`efoldPx\` screen pixels.
float glow(float d, float efoldPx) {
  return exp(-abs(d) / (efoldPx * px));
}
// Distance to an axis-aligned square outline of half-size h (Chebyshev).
float sqDist(vec2 p, float h) { return max(abs(p.x), abs(p.y)) - h; }

// Layer k (0..3) is blinked off this hold when its bit is set; Flicker has
// already decided how many bits are set (index.ts).
float layerOn(int k) {
  return mod(floor(uFlickMask / pow(2.0, float(k))), 2.0) > 0.5 ? 0.0 : 1.0;
}
`;

/** A whole fragment body for one view: common helpers, the view, main(). */
export function viewFragBody(viewGlsl: string): string {
  return `${LONGPLAY_COMMON_GLSL}
${viewGlsl}
void main() {
  vec2 uv = roomUv(vUv) - 0.5;
  uv.x *= uResolution.x / uResolution.y;
  vec2 p = uv * 2.0;
  px = 2.0 / uResolution.y;
  vec3 c = viewColor(p);
  float flash = flashDrive(uBeatPulse) * uFlash * FLASH_W;
  c *= 1.0 + 1.2 * flash;
  c += c * uStrobe * STROBE_W * 2.0;
  c = 1.0 - exp(-c * 1.15);
  outColor = vec4(c, 1.0);
}
`;
}
