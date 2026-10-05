// Fractal Grid — the Mandelbrot set drawn as graph paper: every point that
// doesn't escape gets a square grid drawn on where its orbit ended up, so
// each bulb carries its own grid, the lines crowd and bend into circles and
// petals where the orbit slows (cusps, bulb roots), and turn solid white
// where they crowd past a pixel. Studied from u/ReplacementFresh3915's
// "Mandelgrid" (r/creativecoding, silent) with `/ref` — docs/scenes/fractalgrid.md
// has what was measured and decided.
//
// **The picture**, per pixel (FRAG below): iterate z → z² + c a fixed number
// of times (Iterations, capped by the quality proxy uDetail), carrying dz/dc
// alongside. An escaped point is ground, with a thin edge line from the
// distance estimate so filaments stay visible. A point that stays draws two
// families of lines on its final z — `z · Grid lines + offset`, a line every
// cell in each direction — box-filtered over the pixel's own footprint in
// cells, which dz/dc gives exactly (no screen-space derivatives, so no 2×2
// blocks where the orbit is chaotic). A line is Line weight of a cell wide,
// but never thinner than MIN_LINE_PX: that floor is what turns crowded
// regions and the set's edge white, as in the reference.
//
// **The camera** (motion.ts owns the clock): the view's half-height is the
// whole-set framing times e^{logZoom}, and the dive target sits at a screen
// position that shrinks toward the centre as √(e^{logZoom}) — at the whole
// set every target lands the camera on the same framing, deep in a dive the
// target is centred. The set is computed in 32-bit floats, so Dive depth's
// range stops before pixels run out of precision.
//
// **Fold** mixes the orbit's last two points, z_N and z_{N+1}, by the fold's
// fraction, and steps N by its whole part: a bulb whose orbit cycles through
// k points slides its grid to the next point over one fold.
//
// Sync mapping (drives, not fixed couplings — drives.ts's header): the
// reference is silent, so every reaction here is ours. Dive speed rides the
// bass level, the grid steps on bass hits, folds land on the bar grid, lines
// thicken on any beat, and a drop inverts the picture for a few bars.
import { createFullscreenScene } from "../../fullscreenScene.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import { resolveSceneSetting } from "../../autoTune.ts";
import {
  DIVE_TARGETS,
  FOLD_SPAN,
  HOME_HALF_H,
  HOME_HALF_W,
  HOME_X,
  createDiveState,
  diveLogZoom,
  foldPosition,
  stepDive,
  targetDepth,
} from "./motion.ts";

const ID = "fractalgrid";

/** Iterations at uDetail = 1; the quality proxy scales it down. */
const ITER_CAP = 400;
/** Lines never get thinner than this many pixels. */
const MIN_LINE_PX = 1.5;
/** Escape radius², large enough for a smooth distance estimate. */
const ESCAPE_R2 = 1024;
/** Width of the edge line on escaped points, pixels. */
const EDGE_PX = 1.0;

/** Dive speed's bass reading maps to FLOOR + GAIN · level; REST is the level
 *  assumed with nothing plugged in, where the factor is 1, so Dive speed
 *  is the plain e-folds-per-second figure. */
const DIVE_FLOOR = 0.4;
const DIVE_GAIN = 1.2;
const DIVE_REST = 0.5;
/** How much thicker a full-height beat makes the lines. */
const WEIGHT_PULSE = 0.6;
/** Bars a drop's inversion holds, and the seconds assumed with no tempo. */
const INVERT_BARS = 4;
const INVERT_FALLBACK_SEC = 8;

const SETTINGS: SceneSetting[] = [
  // Form
  {
    key: "density",
    label: "Grid lines",
    description: "How many grid lines cross each bulb — right packs them closer",
    group: "Form",
    min: 8,
    max: 80,
    step: 1,
    default: 32,
  },
  {
    key: "iterations",
    label: "Iterations",
    description:
      "How many times the formula repeats before the grid is drawn — left leaves the grids warped and half-formed, right settles them and sharpens the edges",
    group: "Form",
    min: 12,
    max: ITER_CAP,
    step: 1,
    default: 160,
  },
  // Motion
  {
    key: "step",
    label: "Step",
    description: "How far the grid lines jump on each hit, as a share of a cell",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.25,
    drive: { default: "anim.lowOnset" },
  },
  {
    key: "fold",
    label: "Fold",
    description:
      "How far each tick moves every bulb's grid on to the next point of its cycle — 1 is one whole step, 0 turns folding off",
    group: "Motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    drive: { default: { source: "beat", grid: 4 } },
  },
  // Look
  {
    key: "weight",
    label: "Line weight",
    description: "How thick the lines are, as a share of a cell",
    group: "Look",
    min: 0.04,
    max: 0.5,
    step: 0.01,
    default: 0.2,
    drive: { default: "feature.onset" },
  },
  {
    key: "invert",
    label: "Invert",
    description: "How far a drop swaps black and white, for a few bars — 0 never inverts",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 1,
    drive: { default: "anim.dropOnset" },
  },
  {
    key: "colours",
    label: "Colours",
    description: "How far black and white pull toward the app's colour palette",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
  },
  // Camera
  {
    key: "dive",
    label: "Dive speed",
    description: "How fast the camera zooms into a bulb and back out to the whole set",
    group: "Camera",
    min: 0,
    max: 3,
    step: 0.05,
    default: 1,
    drive: { default: "anim.low" },
  },
  {
    key: "depth",
    label: "Dive depth",
    description: "How far each dive zooms in before pulling back — right goes deeper, up to where the picture runs out of precision",
    group: "Camera",
    min: 0.3,
    max: 1.25,
    step: 0.05,
    default: 1,
  },
];

function settingFor(key: string): SceneSetting {
  const s = SETTINGS.find((x) => x.key === key);
  if (!s) throw new Error(`fractalgrid: unknown setting ${key}`);
  return s;
}

const FRAG = `
const int ITER_CAP = ${ITER_CAP};
const int FOLD_SPAN = ${FOLD_SPAN};
const float ESCAPE_R2 = ${ESCAPE_R2.toFixed(1)};
const float MIN_LINE_PX = ${MIN_LINE_PX.toFixed(3)};
const float EDGE_PX = ${EDGE_PX.toFixed(3)};
const float HOME_X = ${HOME_X.toFixed(4)};
const float HOME_HALF_W = ${HOME_HALF_W.toFixed(4)};
const float HOME_HALF_H = ${HOME_HALF_H.toFixed(4)};

vec2 cmul(vec2 a, vec2 b) {
  return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

// Share of [x - fp/2, x + fp/2] covered by lines of width w (in cells)
// centred on the integers: the difference of the running coverage
// floor(y)·w + min(fract(y), w), with y shifted so a line starts at 0.
float lineCover(float x, float w, float fp) {
  float y = x + 0.5 * w;
  float h = 0.5 * max(fp, 1e-4);
  float a = floor(y - h) * w + min(fract(y - h), w);
  float b = floor(y + h) * w + min(fract(y + h), w);
  return clamp((b - a) / (2.0 * h), 0.0, 1.0);
}

void main() {
  vec2 res = uResolution;
  float aspect = res.x / res.y;
  vec2 uv = (roomUv(vUv) - 0.5) * 2.0;
  uv.x *= aspect;

  // Camera — see the header.
  float sHome = HOME_HALF_H * max(1.0, HOME_HALF_W / (HOME_HALF_H * aspect));
  float k = exp(uLogZoom);
  float s = sHome * k;
  vec2 target = vec2(uTargetX, uTargetY);
  vec2 p = (target - vec2(HOME_X, 0.0)) / sHome * sqrt(k);
  vec2 c = target + (uv - p) * s;
  float pixel = 2.0 * s / res.y;

  int base = int(min(uIterations, float(ITER_CAP) * uDetail));
  float fold = uFoldPos;
  int total = base + int(floor(fold)) + 1;

  vec2 z = vec2(0.0);
  vec2 dz = vec2(0.0);
  vec2 zPrev = z;
  vec2 dzPrev = dz;
  bool escaped = false;
  for (int i = 0; i < ITER_CAP + FOLD_SPAN + 1; i++) {
    if (i >= total) break;
    zPrev = z;
    dzPrev = dz;
    dz = 2.0 * cmul(z, dz) + vec2(1.0, 0.0);
    z = cmul(z, z) + c;
    if (dot(z, z) > ESCAPE_R2) {
      escaped = true;
      break;
    }
  }

  float cover;
  if (escaped) {
    // Distance to the set in pixels, from the escaped orbit.
    float r = length(z);
    float de = 0.5 * r * log(r) / max(length(dz), 1e-20) / pixel;
    cover = clamp(1.0 - de / EDGE_PX, 0.0, 1.0);
  } else {
    float f = fract(fold);
    vec2 zf = mix(zPrev, z, f);
    vec2 dzf = mix(dzPrev, dz, f);
    vec2 g = zf * uDensity + vec2(uGridOffset);
    float fp = length(dzf) * pixel * uDensity;
    float w = clamp(max(uLineW, MIN_LINE_PX * fp), 0.0, 1.0);
    float lx = lineCover(g.x, w, fp);
    float ly = lineCover(g.y, w, fp);
    cover = 1.0 - (1.0 - lx) * (1.0 - ly);
  }

  cover = mix(cover, 1.0 - cover, uInvertMix);
  vec3 mono = vec3(cover);
  vec3 tinted = mix(uPalGround, palRamp(0.92), cover);
  outColor = vec4(mix(mono, tinted, uColours), 1.0);
}
`;

// Every mount starts a fresh dive from the whole set (onInit below).
let state = createDiveState();
let lastTime: number | null = null;

export const fractalGridScene = createFullscreenScene(ID, "Fractal Grid", FRAG, {
  settings: SETTINGS,
  extraUniformDecls: [
    "uniform float uTargetX;",
    "uniform float uTargetY;",
    "uniform float uLogZoom;",
    "uniform float uGridOffset;",
    "uniform float uFoldPos;",
    "uniform float uLineW;",
    "uniform float uInvertMix;",
  ].join("\n"),
  onInit: () => {
    state = createDiveState();
    lastTime = null;
  },
  extraUniforms: (frame, anim, _getSetting, drives) => {
    // Own delta from anim.timeSec, as coil does: the gallery preview hands
    // render() an un-latched anim.
    const dt = lastTime === null ? 0 : anim.timeSec - lastTime;
    lastTime = anim.timeSec;

    const dive = resolveSceneSetting(ID, settingFor("dive"));
    const depth = resolveSceneSetting(ID, settingFor("depth"));
    const step = resolveSceneSetting(ID, settingFor("step"));
    const fold = resolveSceneSetting(ID, settingFor("fold"));
    const weight = resolveSceneSetting(ID, settingFor("weight"));
    const invert = resolveSceneSetting(ID, settingFor("invert"));

    const bass = Math.min(1.5, Math.max(0, drives.value("dive", anim.low, DIVE_REST)));
    const stepFired = step > 0 && drives.fired("step", anim.lowOnset);
    const foldFired = fold > 0 && drives.fired("fold", anim.onset);
    const dropFired = invert > 0 && drives.fired("invert", anim.dropOnset);
    const beatSec = frame.bpm > 0 ? 60 / frame.bpm : 0;

    state = stepDive(state, {
      dt,
      rate: dive * (DIVE_FLOOR + DIVE_GAIN * bass),
      depthScale: depth,
      stepCells: stepFired ? step * drives.value("step", anim.lowPulse) : 0,
      foldSteps: foldFired ? fold : 0,
      dropFired,
      invertHoldSec: beatSec > 0 ? INVERT_BARS * 4 * beatSec : INVERT_FALLBACK_SEC,
    });

    const target = DIVE_TARGETS[state.targetIndex];
    const lineW = weight * (1 + WEIGHT_PULSE * Math.max(0, drives.value("weight", anim.beatPulse)));
    return {
      uTargetX: target.x,
      uTargetY: target.y,
      uLogZoom: diveLogZoom(state.phase, targetDepth(state.targetIndex, depth)),
      uGridOffset: state.grid,
      uFoldPos: foldPosition(state.fold),
      uLineW: lineW,
      uInvertMix: invert * state.invert,
    };
  },
});
