// Liquid Chrome: a glossy liquid surface drawn as tight contour bands that
// wrap into eddies, with dark creases between the bands and cyan glints on
// their flanks, boiling in place rather than scrolling. Built against a
// measured reference (docs/scenes/chrome.md, References and Measurements).
//
// The surface is one height field h: domain-warped value noise, two warp
// fields feeding a third. The picture is h cut into `lines` bands: each
// band is a rounded ridge (bandProfile) whose slope is the band profile's
// slope times the field's own gradient. That gradient comes from
// dFdx/dFdy of h, not from extra field evaluations: h is smooth at the
// pixel scale, so a 2x2-quad derivative is within a few percent, and the
// sharp part of the normal comes from the per-pixel band profile. Where the
// field is flat (an eddy's centre) the bands spread out and the ridge goes
// flat, which is where the broad bright panels come from.
//
// Motion: every fbm octave of every call site drifts in its own direction
// (FLOW_SITE_RATES, turned by FLOW_OCTAVE_TURN per octave), so the octaves
// slide past each other and the field boils with no net drift. The band
// phase moves the contours in and out of the eddies. Both accumulate in JS
// (Flow, sped up by Rush's drive) and reach the shader wrapped, as
// noiseHash.ts's header requires; the shader never sees a growing phase.
//
// Music: Rush (loudness) speeds the flow, Swirl (bass) deepens the warp,
// Shine (hits) flashes the glints. Each reads its drive, never a signal.
import { createFullscreenScene } from "../fullscreenScene.ts";
import { NOISE_HASH_GLSL, NOISE_MASK, wrapFlow } from "../noiseHash.ts";
import type { SceneSetting } from "../sceneSettings.ts";

/** Octaves of every fbm in FRAG. */
export const FBM_OCTAVES = 4;
/** Per fbm call site — warp x, warp y — its drift in noise cells per unit
 *  of flow phase, in the octave's own lattice frame. The two point different
 *  ways so the warp bends rather than travels, and nothing drifts across the
 *  screen as a whole. */
export const FLOW_SITE_RATES: ReadonlyArray<readonly [number, number]> = [
  [0.21, -0.12],
  [-0.15, 0.19],
];
/** How far each octave's drift turns from the one below it, in radians,
 *  and how much faster it runs — the octaves sliding past each other is
 *  what reads as boiling instead of scrolling. */
export const FLOW_OCTAVE_TURN = 2.4;
export const FLOW_OCTAVE_SPEEDUP = 1.35;
/** uDrift layout: per call site, per octave, an [x, y] pair. */
export const FLOW_LEN = FLOW_SITE_RATES.length * FBM_OCTAVES * 2;
/** Radians per unit of flow phase that each cell's point turns on its
 *  orbit (half the points turn the other way). */
export const ORBIT_RATE = 0.45;
/** Bands the contours travel per unit of flow phase (outward from an eddy's
 *  peak when positive). */
export const BAND_RATE = 0.35;
/** How much a full Rush reading on top of a full Rush setting multiplies the
 *  flow rate by: rate = flow * (1 + RUSH_GAIN * rush * reading). */
export const RUSH_GAIN = 1.5;
/** How sharply cellField's smooth minimum picks the nearest point — higher
 *  gives harder creases where two points' rings meet. */
export const CELL_SMOOTH = 7;
/** The Shine flash relaxes by e every this many seconds. */
export const SHINE_TAU_SEC = 0.18;

/** Fills `out` with each fbm octave's drift offset at flow phase `ph`,
 *  wrapped into the lattice period — see the header. */
export function chromeFlows(ph: number, out: Float32Array = new Float32Array(FLOW_LEN)): Float32Array {
  for (let site = 0; site < FLOW_SITE_RATES.length; site++) {
    const [rx, ry] = FLOW_SITE_RATES[site];
    let speed = 1;
    for (let k = 0; k < FBM_OCTAVES; k++) {
      const a = k * FLOW_OCTAVE_TURN;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const o = (site * FBM_OCTAVES + k) * 2;
      out[o] = wrapFlow(ph * speed * (c * rx - s * ry));
      out[o + 1] = wrapFlow(ph * speed * (s * rx + c * ry));
      speed *= FLOW_OCTAVE_SPEEDUP;
    }
  }
  return out;
}

/** The flow phase's next value: Flow times the Rush boost, integrated, so a
 *  change in either only ever changes the speed going forward. */
export function advanceChromePhase(ph: number, dtSec: number, flow: number, rush: number, rushReading: number): number {
  return ph + Math.max(0, dtSec) * flow * (1 + RUSH_GAIN * rush * Math.max(0, rushReading));
}

/** The Shine envelope after `dtSec`, jumped to at least `kick` by a hit. */
export function advanceShine(env: number, dtSec: number, kick: number): number {
  return Math.max(env * Math.exp(-Math.max(0, dtSec) / SHINE_TAU_SEC), kick);
}

const FRAG = `
${NOISE_HASH_GLSL}

const int OCT = ${FBM_OCTAVES};

float vnoise(vec2 p, uint seed) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hashCell(i, ${NOISE_MASK}, seed);
  float b = hashCell(i + vec2(1.0, 0.0), ${NOISE_MASK}, seed);
  float c = hashCell(i + vec2(0.0, 1.0), ${NOISE_MASK}, seed);
  float d = hashCell(i + vec2(1.0, 1.0), ${NOISE_MASK}, seed);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// One fbm call site, its first oct octaves: each octave adds its own
// wrapped drift (uDrift).
float fbm(vec2 p, int site, int oct, uint seed) {
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int k = 0; k < OCT; k++) {
    if (k >= oct) break;
    int o = (site * OCT + k) * 2;
    sum += amp * vnoise(p + vec2(uDrift[o], uDrift[o + 1]), seed + uint(k));
    norm += amp;
    p = rot * p * 2.03;
    amp *= 0.42;
  }
  return sum / norm;
}

// Smoothed distance to the nearest cell point: rings around each point,
// merging into parallel stripes between points, with the even spacing
// plain noise contours lack. Points sit in the middle of their cell and
// orbit it; uOrbit is wrapped to one turn, so nothing here grows.
float cellField(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float acc = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 rnd = hash2Cell(i + o, ${NOISE_MASK}, 51u);
      float ang = 6.2831853 * rnd.x + uOrbit * (rnd.y > 0.5 ? 1.0 : -1.0);
      vec2 pt = o + 0.5 + 0.3 * vec2(cos(ang), sin(ang));
      acc += exp(-${CELL_SMOOTH.toFixed(1)} * length(pt - f));
    }
  }
  return -log(acc) / ${CELL_SMOOTH.toFixed(1)};
}

// A band as a rounded ridge: 1 on its spine, 0 in the crease. Returns
// (height, slope per unit of band coordinate).
vec2 bandProfile(float x) {
  float t = fract(x) * 2.0 - 1.0;
  float k = 1.6;
  float at = abs(t);
  return vec2(1.0 - pow(at, k), -k * pow(max(at, 1e-4), k - 1.0) * sign(t) * 2.0);
}

void main() {
  vec2 uv = roomUv(vUv);
  float aspect = uResolution.x / uResolution.y;
  float scale = 4.5 * uZoom;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0) * scale + 7.3;

  float swirl = 0.9 * (1.0 + uSwirl * swirlDrive(uLow));
  vec2 q = vec2(fbm(p * 0.6, 0, 3, 11u), fbm(p * 0.6 + vec2(5.2, 1.3), 1, 3, 23u)) - 0.5;
  float h = cellField(p + swirl * 1.4 * q);

  // The field's gradient per unit of p (see the header for why dFdx).
  float pixScale = scale / uResolution.y;
  vec2 gh = vec2(dFdx(h), dFdy(h)) / pixScale;

  float x = h * uLines - uBandPhase;
  vec2 band = bandProfile(x);
  // Slope of the ridge surface over p; the factor is how tall a ridge
  // stands against its width.
  vec2 slope = band.y * uLines * gh * 0.035;
  vec3 n = normalize(vec3(-slope, 1.0));

  // A chrome look with no scene behind it: each ribbon lit from one side
  // (its far flank falls to teal, then to the crease), and glints from two
  // lights reflected off it.
  vec3 r = reflect(vec3(0.0, 0.0, -1.0), n);
  vec3 keyL = normalize(vec3(-0.45, 0.5, 0.72));
  vec3 rimL = normalize(vec3(0.65, -0.4, 0.5));
  float diff = clamp(dot(n, keyL), 0.0, 1.0);
  float key = pow(max(dot(r, keyL), 0.0), 24.0);
  // A hit both brightens the glints and spreads them across the flanks.
  float flash = uShineEnv * uShine;
  float rim = pow(max(dot(r, rimL), 0.0), mix(6.0, 2.0, clamp(flash, 0.0, 1.0)));
  float lit = smoothstep(0.0, 0.5, band.x);
  float glint = (0.6 + 2.2 * flash) * uGloss;

  vec3 deep, flank, body, bright, glintCol;
  if (uColors < 0.5) {
    deep = vec3(0.004, 0.03, 0.035);
    flank = vec3(0.02, 0.26, 0.20);
    body = vec3(0.02, 0.58, 0.09);
    bright = vec3(0.06, 0.88, 0.18);
    glintCol = vec3(0.06, 0.78, 0.68);
  } else {
    deep = uPalGround;
    flank = palRamp(0.3);
    body = palRamp(0.6);
    bright = palRamp(0.9);
    glintCol = uPalAccent;
  }

  vec3 col = mix(deep, flank, lit);
  col = mix(col, body, lit * smoothstep(0.45, 0.85, diff));
  col = mix(col, bright, lit * smoothstep(0.85, 1.0, diff));
  col += glintCol * rim * glint * lit;
  col += mix(bright, vec3(1.0), 0.4) * key * glint * 0.7;
  outColor = vec4(col, 1.0);
}
`;

const SETTINGS: SceneSetting[] = [
  {
    key: "lines",
    label: "Lines",
    description: "How many contour bands the surface is cut into — fewer gives broad glossy ribbons, more gives fine grooves.",
    group: "Form",
    min: 3,
    max: 24,
    step: 0.5,
    default: 12,
    auto: { density: 0.3, brightness: 0.15 },
  },
  {
    key: "zoom",
    label: "Size",
    description: "How much of the surface fits on screen — further right shows more, smaller eddies.",
    group: "Form",
    min: 0.4,
    max: 2.5,
    step: 0.05,
    default: 1,
  },
  {
    key: "flow",
    label: "Flow",
    description: "How fast the liquid boils and the bands stream in and out of the eddies.",
    group: "Motion",
    min: 0,
    max: 3,
    step: 0.05,
    default: 1,
    auto: { tempo: 0.3, pulse: 0.15 },
  },
  {
    key: "rush",
    label: "Rush",
    description: "How much louder music speeds the flow up.",
    group: "Motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 0.8,
    auto: { loudness: 0.25, dynamics: 0.15 },
    drive: { default: "anim.energy" },
  },
  {
    key: "swirl",
    label: "Swirl",
    description: "How much the bass twists the bands into deeper eddies.",
    group: "Motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 0.6,
    auto: { pulse: 0.25, dynamics: 0.15 },
    drive: { default: "anim.low" },
  },
  {
    key: "gloss",
    label: "Gloss",
    description: "How bright the glints on the bands' flanks are.",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    auto: { brightness: 0.2 },
  },
  {
    key: "shine",
    label: "Shine",
    description: "How hard a hit flashes the glints.",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 0.8,
    auto: { attack: 0.3, pulse: 0.15 },
    drive: { default: "feature.onset", hit: { reactionLabel: "shine" } },
  },
  {
    key: "colors",
    label: "Colour",
    description: "Liquid keeps the green-and-cyan chrome; Room takes the room palette.",
    group: "Look",
    min: 0,
    max: 1,
    step: 1,
    default: 0,
    type: "enum",
    // A taste pick, so no auto table and no drive.
    options: ["Liquid", "Room"],
  },
];

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "draft", added: "2026-10-21" } as const;

export const chromeScene = createFullscreenScene("chrome", "Liquid Chrome", FRAG, {
  settings: SETTINGS,
  extraUniformDecls: `uniform float uDrift[${FLOW_LEN}];\nuniform float uBandPhase;\nuniform float uOrbit;\nuniform float uShineEnv;`,
  extraUniforms: (() => {
    const flowBuf = new Float32Array(FLOW_LEN);
    let ph = 0;
    let shine = 0;
    return (frame, anim, getSetting, drives) => {
      ph = advanceChromePhase(ph, anim.dtSec, getSetting("flow"), getSetting("rush"), drives.value("rush", frame.energy));
      const hit = drives.fired("shine", anim.onset);
      shine = advanceShine(shine, anim.dtSec, hit ? drives.hitSize("shine") : 0);
      const bandPhase = ph * BAND_RATE;
      const orbit = (ph * ORBIT_RATE) % (2 * Math.PI);
      return { uDrift: chromeFlows(ph, flowBuf), uBandPhase: bandPhase - Math.floor(bandPhase), uOrbit: orbit, uShineEnv: shine };
    };
  })(),
});
