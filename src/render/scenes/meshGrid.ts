import { NUM_BANDS } from "../../audio/types.ts";
import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../gl.ts";
import { PALETTE_GLSL } from "../palette.ts";
import type { SceneSetting } from "../sceneSettings.ts";
import { resolveSceneSetting } from "../autoTune.ts";
import type { Scene, SceneContext } from "../scene.ts";
import { COMMON_UNIFORMS_GLSL, ROOM_UV_GLSL, settingUniformName, uploadCommonUniforms } from "../sceneCommon.ts";

// A wireframe dome whose concentric rings are a live radial spectrogram:
// bass at the center, treble at the rim, with each ring reading further back
// in time toward the edge, so the whole surface is a rolling polar history
// of the spectrum rather than a single frozen frame.
//
// Design notes on how it's built:
//
//  - No directional/diffuse lighting. Color comes purely from a per-vertex
//    amplitude value run through a fixed-stop gradient (gradientMap4 below),
//    not from shading geometry — flat, graphic, closer to a heat-map than a
//    lit 3D object.
//  - Real world units, not a normalized -1..1 disc: the grid is laid out at
//    `cellSize` (1) world-unit spacing, so its half-extent is WORLD_SCALE
//    below. The camera sits close and slightly overflows the frame — chosen
//    for a dense, engulfing read rather than a clean establishing shot of
//    the whole dome.
//  - The visible rim is a circular mask by raw grid-index distance from
//    center, but the *radial* `h` used everywhere else (ring/bin lookup,
//    meshBend) is normalized by the grid's *diagonal* half-extent instead.
//    Since a square's diagonal is sqrt(2) times its half-width, h only
//    reaches ~0.707 at the visible rim — meshBend's "(1 - 2h^2)" term stays
//    near zero there and only goes fully negative at the corners the circle
//    mask clips away, which is what keeps the rim curling the right way.
//  - meshBend is a large absolute number (slider range -50..50), not a 0..1
//    knob — center-to-rim curvature in world units, not a normalized amount.
//  - Height and per-vertex color amplitude each come from their own tree of
//    sine terms in (angle, radius, time), blended by a `radialMix` control
//    so the surface can lean toward clean radial rings or a freeform ripple.
//    jaggedness is a self-contained angular faceting term layered on top,
//    active only where radialMix leans radial.
//  - Height is temporally smoothed by an exponential filter applied to the
//    spectrum bands on the CPU before they reach the history texture, rather
//    than to the ~31k vertices themselves each frame (see `dampen()` below)
//    — cheap, and since per-vertex height is a smooth function of a handful
//    of nearby bins, smoothing the input gets close to smoothing the output.
//  - Flowing Noise and Radial Mix both get a small attack/release envelope
//    driven by spectral flux (onset strength), on top of their slider
//    baseline, so transients visibly push the surface rather than only the
//    steady-state controls doing so — Flux Reactivity is a single knob over
//    both amounts together.
//
// Deliberately out of scope: a real post-processing stack (gamma, a
// frame-wide gradient remap, tiled/mirrored background, feedback) would
// need an offscreen framebuffer and multi-pass compositor this project
// doesn't have elsewhere. The Background Mesh checkbox is an explicitly
// approximate stand-in for that kind of background, not a full pass — see
// its comment.
//
// Beyond the core dome, this scene also exposes a handful of display modes
// in a "technical/digital" instrument-panel register — Scanlines,
// Posterize, Wireframe Only, Scan Sweep, Contour Lines — evoking CRT
// monitors, radar/HUD sweeps, quantized signal readouts, and topographic
// contour maps. Each is cheap enough to run inside the existing single-pass
// forward render (no offscreen framebuffer needed) — see each one's own
// comment for exactly where and why.
const ID = "mesh";

const HISTORY_FRAMES = 200; // rows in the rolling spectrogram history ring
const WORLD_SCALE = 60.0; // grid half-extent in world units (cellSize=1 spacing)

// Every knob the algorithm actually supports is exposed as a live setting
// rather than a baked-in constant, so the space it covers is fully
// explorable rather than locked to one fixed look.
const SETTINGS: SceneSetting[] = [
  {
    key: "bend",
    label: "Mesh Bend",
    description: "Center-to-rim curvature (negative = bowl, center pulled down)",
    min: -50,
    max: 50,
    step: 0.5,
    default: -10,
    // A fuller mix supports a flatter, less bowl-shaped center (bend moves toward 0).
    auto: { density: 0.2 },
  },
  {
    key: "waveHeight",
    label: "Wave Height",
    description: "Amplitude of the audio-driven surface displacement",
    min: 0.1,
    max: 5,
    step: 0.1,
    default: 1.1,
    // Displacement amplitude follows macro dynamics; dark mixes get more bulk.
    auto: { dynamics: 0.3, brightness: -0.2 },
  },
  {
    key: "flow",
    label: "Waterfall",
    description: "How far back in time the outer rings read",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    // Faster, pulsier music wants tighter immediacy over a deep waterfall trail.
    auto: { tempo: -0.25, pulse: -0.2 },
  },
  {
    key: "noise",
    label: "Flowing Noise",
    description: "Turbulence baseline -- surges further on audio transients",
    min: 0,
    max: 5,
    step: 0.05,
    default: 1.35,
    // Busy, bright mixes churn the turbulence baseline more.
    auto: { density: 0.3, brightness: 0.1 },
  },
  {
    key: "noiseScale",
    label: "Noise Scale",
    description: "Turbulence pattern size -- lower is coarser/blobbier",
    min: 0.01,
    max: 1,
    step: 0.01,
    default: 0.1,
  },
  {
    key: "jaggedness",
    label: "Jaggedness",
    description: "Faceted angular ripple layered onto the surface",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
  },
  {
    key: "radialMix",
    label: "Radial Mix",
    description: "Baseline balance between radial rings and the freeform ripple (surges toward rings on transients)",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.25,
  },
  {
    key: "fluxReactivity",
    label: "Flux Reactivity",
    description: "How hard audio transients push Flowing Noise and Radial Mix",
    min: 0,
    max: 3,
    step: 0.1,
    default: 1.0,
  },
  {
    key: "dampening",
    label: "Motion Dampening",
    description: "Temporal smoothing -- higher is slower and more fluid",
    min: 0,
    max: 0.95,
    step: 0.05,
    default: 0.95,
  },
  {
    key: "fill",
    label: "Surface Fill",
    description: "Opacity of the solid undercoat beneath the wireframe",
    min: 0,
    max: 1,
    step: 0.05,
    default: 1.0,
    // Denser mixes support more solid undercoat; sparse/bright ones read better more see-through.
    auto: { density: 0.15, brightness: -0.1 },
  },
  {
    key: "fillReactivity",
    label: "Fill Reactivity",
    description: "How much the fill's opacity itself tracks loudness",
    min: 0,
    max: 1,
    step: 0.05,
    default: 1.0,
  },
  {
    key: "lineReactivity",
    label: "Line Reactivity",
    description: "How much the wireframe's opacity tracks loudness",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
  },
  {
    key: "dots",
    label: "Dots",
    description: "Size of the vertex dots",
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.78,
    // Vertex-dot presence tracks hats/cymbals and transient hits.
    auto: { brightness: 0.3, attack: 0.15 },
  },
  {
    key: "dotReactivity",
    label: "Dot Reactivity",
    description: "How much dot size/opacity tracks loudness",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
  },
  {
    key: "colorIntensity",
    label: "Color Intensity",
    description: "Push the color gradient toward gold/white, or pull it back toward shadow",
    min: 0.2,
    max: 3,
    step: 0.05,
    default: 1.0,
  },
  {
    key: "bgMesh",
    label: "Background Mesh",
    description: "Procedural tiled lattice filling the background behind the dome",
    min: 0,
    max: 1,
    step: 1,
    default: 0,
    type: "boolean",
  },
  {
    key: "scanlines",
    label: "Scanlines",
    description: "Alternating darkened rows across the whole frame, like a CRT monitor",
    min: 0,
    max: 1,
    step: 1,
    default: 0,
    type: "boolean",
  },
  {
    key: "scanlineIntensity",
    label: "Scanline Intensity",
    description: "How dark the darkened rows go",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
  },
  {
    key: "posterize",
    label: "Posterize",
    description: "Quantize the color gradient into hard bands instead of a smooth blend",
    min: 0,
    max: 1,
    step: 1,
    default: 0,
    type: "boolean",
  },
  {
    key: "posterizeSteps",
    label: "Posterize Steps",
    description: "Number of color bands",
    min: 2,
    max: 16,
    step: 1,
    default: 5,
  },
  {
    key: "wireframeOnly",
    label: "Wireframe Only",
    description: "Hide the solid fill entirely -- lines and dots only, a bare circuit-board read",
    min: 0,
    max: 1,
    step: 1,
    default: 0,
    type: "boolean",
  },
  {
    key: "scanSweep",
    label: "Scan Sweep",
    description: "A rotating bright arc, like a radar display's sweep line",
    min: 0,
    max: 1,
    step: 1,
    default: 0,
    type: "boolean",
  },
  {
    key: "sweepSpeed",
    label: "Sweep Speed",
    description: "How fast the sweep arc rotates",
    min: 0.05,
    max: 3,
    step: 0.05,
    default: 0.5,
  },
  {
    key: "contourLines",
    label: "Contour Lines",
    description: "Band the surface's actual height (not the audio signal) into topographic-style elevation rings",
    min: 0,
    max: 1,
    step: 1,
    default: 0,
    type: "boolean",
  },
  {
    key: "contourDensity",
    label: "Contour Density",
    description: "How many elevation bands",
    min: 0.05,
    max: 2,
    step: 0.05,
    default: 0.4,
  },
];

const settingByKey = new Map(SETTINGS.map((s) => [s.key, s]));
function settingFor(key: string): SceneSetting {
  const spec = settingByKey.get(key);
  if (!spec) throw new Error(`meshGrid: unknown setting "${key}"`);
  return spec;
}

/** Grid resolution per side, scaled off the quality detail proxy — the same
 *  signal shaders use to scale raymarch/density cost (see quality.ts). */
export function gridSizeForQuality(quality: number): number {
  if (quality >= 0.9) return 220;
  if (quality >= 0.65) return 160;
  if (quality >= 0.35) return 100;
  return 72;
}

/** n*n vertices in [-1,1], row-major (row = index/n, col = index%n). */
export function buildGridPositions(n: number): Float32Array {
  const positions = new Float32Array(n * n * 2);
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = (row * n + col) * 2;
      positions[i] = (col / (n - 1)) * 2 - 1;
      positions[i + 1] = (row / (n - 1)) * 2 - 1;
    }
  }
  return positions;
}

/** Index pairs for gl.LINES over an n*n grid: every horizontal and vertical
 *  edge, plus one diagonal per cell when `withDiagonals` for a triangulated
 *  wireframe texture, skipped at low quality to halve the line count where
 *  per-line cost matters most. */
export function buildGridIndices(n: number, withDiagonals: boolean): Uint32Array {
  const segments: number[] = [];
  const idx = (row: number, col: number) => row * n + col;

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n - 1; col++) {
      segments.push(idx(row, col), idx(row, col + 1));
    }
  }
  for (let col = 0; col < n; col++) {
    for (let row = 0; row < n - 1; row++) {
      segments.push(idx(row, col), idx(row + 1, col));
    }
  }
  if (withDiagonals) {
    for (let row = 0; row < n - 1; row++) {
      for (let col = 0; col < n - 1; col++) {
        segments.push(idx(row, col), idx(row + 1, col + 1));
      }
    }
  }
  return new Uint32Array(segments);
}

/** Two CCW triangles per cell over an n*n grid, for the solid fill pass. */
export function buildGridTriangles(n: number): Uint32Array {
  const tris: number[] = [];
  const idx = (row: number, col: number) => row * n + col;
  for (let row = 0; row < n - 1; row++) {
    for (let col = 0; col < n - 1; col++) {
      const a = idx(row, col);
      const b = idx(row, col + 1);
      const c = idx(row + 1, col);
      const d = idx(row + 1, col + 1);
      tris.push(a, b, c, b, d, c);
    }
  }
  return new Uint32Array(tris);
}

/** A rolling ring buffer of the last `frames` spectrum frames (each `bands`
 *  wide), row-major, uploaded to a texture and sampled in the vertex shader
 *  so the mesh's concentric rings read as a genuine polar spectrogram
 *  (further out = further back in time) rather than a synthetic wave. */
export function createSpectrumHistory(bands: number, frames: number) {
  const data = new Float32Array(bands * frames);
  let cursor = 0; // row that will be written on the next push
  return {
    data,
    bands,
    frames,
    /** Writes `values` into the next row and returns that row's index (the
     *  "newest" row immediately after writing). */
    push(values: ArrayLike<number>): number {
      const row = cursor;
      const off = row * bands;
      for (let i = 0; i < bands; i++) data[off + i] = values[i] ?? 0;
      cursor = (cursor + 1) % frames;
      return row;
    },
  };
}

/** Mirrors the vertex shader's `mod(newestRow - h*flow*frames, frames)`
 *  row lookup — kept as a standalone pure function so the wrap-around math
 *  is unit-testable without a GL context. Returns a fractional row; callers
 *  that need an integer row should floor it, matching the shader's nearest
 *  sampling. */
export function historyRowFor(newestRow: number, h: number, flow: number, frames: number): number {
  const back = h * flow * frames;
  let row = (newestRow - back) % frames;
  if (row < 0) row += frames;
  return row;
}

/** Exponential dampening: moves a `rate`-weighted fraction of the way from
 *  `prev` toward `target` per 120fps-normalized frame, framerate-independent
 *  via `rate^(120*dt)`. Smooths the ~24 spectrum bands on the CPU each frame
 *  before they reach the history texture (see file header). */
function dampen(prev: number, target: number, rate: number, dt: number): number {
  return prev + (target - prev) * (1 - Math.pow(rate, 120 * dt));
}

const settingsUniformsGlsl = SETTINGS.map((s) => `uniform float ${settingUniformName(s.key)};`).join("\n");

const MESH_VERT = `#version 300 es
precision highp float;
precision highp sampler2D;
layout(location = 0) in vec2 aPos;
out vec3 vColor;
out float vAlpha;
out float vHeight; // raw surface displacement, for the Contour Lines checkbox in MESH_FRAG
${COMMON_UNIFORMS_GLSL}
${settingsUniformsGlsl}
uniform sampler2D uHistory;
uniform float uNewestRow;
// uRadialMix and uNoise are both declared above by settingsUniformsGlsl
// (they're real settings, sliders a user can move) but render() overwrites
// them every frame with a flux-modulated value on top of that slider
// baseline -- see render()'s comment.
uniform float uIsFillPass;  // 1.0 during the solid-surface pass, 0.0 for wireframe/dots
uniform float uIsPointPass; // 1.0 only during the dots (gl.POINTS) draw

#define PI 3.14159265359
#define SQRT2 1.41421356237
#define HISTORY_FRAMES ${HISTORY_FRAMES.toFixed(1)}
#define NUM_BANDS ${NUM_BANDS.toFixed(1)}
#define WORLD_SCALE ${WORLD_SCALE.toFixed(1)}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Value noise -- cheaper than a Perlin/gradient-noise permutation table
// while keeping the same broad turbulent character.
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// A fixed 4-stop gradient (deep violet -> magenta -> gold -> white) driven
// by per-vertex amplitude, rather than a raw amplitude-to-hue HSV ramp --
// reads with presence even at low amplitude instead of sitting flat and
// dark, and gives a warm "hot end" for colorIntensity to push toward.
// Applied as a direct per-vertex lookup, not a whole-frame post-process
// (this project has no offscreen pass to apply one elsewhere in the scene).
vec3 gradientMap4(float t) {
  vec3 c0 = vec3(0.0510, 0.0078, 0.1294); // #0d0221 shadows
  vec3 c1 = vec3(0.9686, 0.1451, 0.5216); // #f72585 midtones
  vec3 c2 = vec3(1.0000, 0.8392, 0.0392); // #ffd60a highlights
  vec3 c3 = vec3(1.0000, 1.0000, 1.0000); // #ffffff
  t = clamp(t, 0.0, 1.0);
  if (t < 1.0 / 3.0) return mix(c0, c1, t * 3.0);
  if (t < 2.0 / 3.0) return mix(c1, c2, (t - 1.0 / 3.0) * 3.0);
  return mix(c2, c3, (t - 2.0 / 3.0) * 3.0);
}

void main() {
  vec2 flatPos = aPos * WORLD_SCALE;      // real-unit grid-index offset from center (cellSize=1)
  float rNorm = length(aPos);              // 0 at center, 1 at the visible circular rim
  // circleShape masks by raw distance (rim at rNorm=1), but the radial h
  // used for bin/ring lookup and meshBend is normalized by the grid's
  // *diagonal* half-extent -- so h only reaches ~1/sqrt(2) at the visible
  // rim, not 1. See file header.
  float h = clamp(rNorm / SQRT2, 0.0, 1.0);
  float g = atan(flatPos.y, flatPos.x);    // angle around the center

  // Bass/mid energy: this project already tracks slewed low/mid band energy
  // for every scene (bandEnergy.ts), so reuse that rather than re-deriving
  // it from frame.bands here.
  float er = uLow;
  float en = uMid;
  float t = uTime;

  // Concentric rings are the audio spectrum mapped radially (bass at the
  // center, treble at the rim), read from a rolling history texture at a row
  // further into the past the further out you sample -- a genuine polar
  // spectrogram. Bin mapping is linear in h (spectrumSpread=0 for this
  // preset, which is the only thing that would curve it).
  //
  // Manual bilinear sampling across both axes: R32F textures can't use
  // hardware LINEAR filtering without OES_texture_float_linear, which isn't
  // guaranteed on the TV-class hardware this project targets.
  float binF = h * (NUM_BANDS - 1.0);
  float bin0 = floor(binF);
  float bin1 = min(bin0 + 1.0, NUM_BANDS - 1.0);
  float binFrac = fract(binF);
  float rowF = mod(uNewestRow - h * uFlow * HISTORY_FRAMES, HISTORY_FRAMES);
  float row0 = floor(rowF);
  float row1 = mod(row0 + 1.0, HISTORY_FRAMES);
  float rowFrac = fract(rowF);
  float u0 = (bin0 + 0.5) / NUM_BANDS;
  float u1 = (bin1 + 0.5) / NUM_BANDS;
  float v0 = (row0 + 0.5) / HISTORY_FRAMES;
  float v1 = (row1 + 0.5) / HISTORY_FRAMES;
  float amp00 = texture(uHistory, vec2(u0, v0)).r;
  float amp10 = texture(uHistory, vec2(u1, v0)).r;
  float amp01 = texture(uHistory, vec2(u0, v1)).r;
  float amp11 = texture(uHistory, vec2(u1, v1)).r;
  float x = mix(mix(amp00, amp10, binFrac), mix(amp01, amp11, binFrac), rowFrac);

  // Two structurally parallel sine-term trees, blended by radialMix (q):
  // one leaning radial/ring-like, one a freeform ripple.
  float q = clamp(uRadialMix, 0.0, 1.0);
  float wq = 1.0 - q;

  // Per-vertex color amplitude (drives hue/sat/val below) -- a lighter mix
  // than height's tree since it's a secondary, mostly-cosmetic signal.
  float colorRipple = (0.3 * sin(4.0 * g + 2.0 * t) + 0.3 * sin(6.0 * h - 1.5 * t)) * x * wq
    + (0.4 * sin(8.0 * h - 2.0 * g + t) + 0.4 * sin(6.0 * g + 5.0 * h - 1.2 * t)) * x * wq
    + (sin(3.0 * g - 1.5 * t) * en * 0.6 + sin(2.0 * g + 4.0 * h - 2.5 * t) * (er + en) * 0.5) * wq;
  float colorAmp = clamp(x + colorRipple, 0.0, 1.0);

  // Height: same q/(1-q) blend, its own sine tree.
  float heightSig = 0.0;
  heightSig += x * (1.0 + er) * 1.5 * q;
  heightSig += sin(15.0 * h - 6.0 * er - 2.0 * t) * er * 0.8 * q;
  heightSig += x * (1.0 + er) * 1.5 * wq;
  heightSig += sin(8.0 * h - 2.0 * t) * er * 0.8 * wq;
  heightSig += (sin(3.0 * g - 1.5 * t) * en * 0.6 + sin(2.0 * g + 4.0 * h - 2.5 * t) * (er + en) * 0.5) * wq;
  heightSig += (sin(10.0 * h) * sin(4.0 * g) * er * 0.7 + sin(15.0 * h - 3.0 * t) * en * 0.5) * wq;
  heightSig += 0.2 * sin(8.0 * g + 20.0 * h + 0.5 * t) * wq;

  // Jaggedness: an angular faceting term, active only where radialMix leans
  // radial (q) so it reads as texture on the rings rather than the ripple.
  heightSig += uJaggedness * q * (0.3 * sin(4.0 * g + t) + 0.2 * sin(8.0 * g - 1.5 * t) + 0.15 * sin(12.0 * g + 0.7 * t));

  float j = heightSig * uWaveHeight;
  vec2 noiseCoord = flatPos * uNoiseScale;
  float nz = noise(noiseCoord + vec2(t * 0.09, -t * 0.07));
  j += (2.0 * nz - 1.0) * uNoise * uWaveHeight * 0.2; // *0.2: keeps noise as texture, not a dominant swing

  float bendTerm = uBend * (1.0 - 2.0 * h * h);
  float height = j + bendTerm;
  vHeight = height; // to MESH_FRAG, for the Contour Lines checkbox

  vec3 worldPos = vec3(flatPos.x, height, flatPos.y);

  // Fixed camera: close and slightly overflowing the frame, tuned to
  // WORLD_SCALE above so the dome fills the view without a full establishing
  // shot's worth of empty space around it.
  vec3 camPos = vec3(52.0, 34.0, 9.0);
  vec3 camTarget = vec3(0.0, -8.0, -1.0);
  vec3 forward = normalize(camTarget - camPos);
  vec3 worldUp = vec3(0.0, 1.0, 0.0);
  vec3 right = normalize(cross(forward, worldUp));
  vec3 up2 = cross(right, forward);
  vec3 rel = worldPos - camPos;
  vec3 view = vec3(dot(rel, right), dot(rel, up2), dot(rel, forward));
  view.z = max(view.z, 0.5);

  float focalY = 1.0 / tan(radians(75.0) * 0.5); // three.js PerspectiveCamera default fov=75
  float roomAspect = (uResolution.x / max(uViewport.z, 0.0001)) / (uResolution.y / max(uViewport.w, 0.0001));
  vec4 clip = vec4(view.x * focalY / roomAspect, view.y * focalY, view.z * 0.02, view.z);

  // Panorama slice, applied in NDC (post perspective-divide): project into
  // the full room's clip space, remap by this device's viewport rect, then
  // re-derive clip.xy so the GPU's own divide (using the original clip.w)
  // lands correctly.
  vec2 ndc = clip.xy / clip.w;
  vec2 uv01 = ndc * 0.5 + 0.5;
  uv01 = (uv01 - uViewport.xy) / uViewport.zw;
  clip.xy = (uv01 * 2.0 - 1.0) * clip.w;

  gl_Position = clip;

  // Perspective-scaled point size, so dots read consistently near and far.
  float ampFactor = mix(1.0, mix(0.15, 1.0, colorAmp), uDotReactivity);
  gl_PointSize = (0.7 + 0.2 * uDots) * ampFactor * (300.0 / view.z);

  // colorIntensity pushes the *input* to the gradient lookup toward its hot
  // end, rather than overshooting the output color past white.
  vec3 col = gradientMap4(colorAmp * uColorIntensity);

  // Scan Sweep: a bright arc at a rotating angle, like a radar display's
  // sweep line. A broad angular glow rather than a hairline, so computing it
  // once per vertex (not per fragment) reads fine at this grid density --
  // no varying needed, just folded straight into the vertex color like the
  // gradient above.
  if (uScanSweep > 0.5) {
    float sweepAngle = mod(uTime * uSweepSpeed, 2.0 * PI);
    float angDiff = g - sweepAngle;
    angDiff -= 2.0 * PI * floor((angDiff + PI) / (2.0 * PI)); // wrap to [-PI, PI]
    float sweepGlow = pow(max(0.0, 1.0 - abs(angDiff) / 0.4), 3.0);
    col += vec3(0.6, 1.0, 0.9) * sweepGlow; // cyan-ish, reads as "scanner" rather than matching the fire palette
  }

  // Fill pass is darkened (surfaceShade 0.55) so it reads as underlying
  // surface, not competing with the full-bright (1.0) wireframe/dots on top.
  float shade = mix(1.0, 0.55, uIsFillPass);
  vColor = col * shade;

  // Alpha: fillOpacity/lineReactivity/dotSize/dotReactivity all blend
  // between flat and colorAmp-driven -- quiet regions genuinely go
  // transparent here, not just dim.
  float fillAlpha = uFill * mix(1.0, colorAmp, uFillReactivity);
  float wireAlpha = (1.0 - uDots * uDots) * mix(1.0, colorAmp, uLineReactivity);
  float dotFadeIn = clamp(uDots * 3.0, 0.0, 1.0);
  float dotAlpha = dotFadeIn * mix(1.0, clamp(0.1 + colorAmp * 1.2, 0.0, 1.0), uDotReactivity);
  float alpha = mix(mix(wireAlpha, dotAlpha, uIsPointPass), fillAlpha, uIsFillPass);

  // Circular silhouette instead of the grid's natural square edge, with a
  // soft antialiased fade rather than a hard discard at the rim.
  float discFade = 1.0 - smoothstep(0.97, 1.0, rNorm);
  vAlpha = alpha * discFade;
}
`;

const MESH_FRAG = `#version 300 es
precision highp float;
in vec3 vColor;
in float vAlpha;
in float vHeight;
uniform float uIsPointPass;
// Re-declared here even though settingsUniformsGlsl already declares these
// in MESH_VERT -- each shader stage in a WebGL2 program needs its own
// uniform declaration to reference it, even when both stages share the same
// linked program and value (uIsFillPass/uIsPointPass above already did
// this for the same reason).
uniform float uScanlines;
uniform float uScanlineIntensity;
uniform float uPosterize;
uniform float uPosterizeSteps;
uniform float uContourLines;
uniform float uContourDensity;
out vec4 outColor;

void main() {
  float mask = 1.0;
  if (uIsPointPass > 0.5) {
    // Circular sprite with a soft antialiased rim (gl_PointCoord distance test).
    vec2 pc = gl_PointCoord - 0.5;
    float r2 = dot(pc, pc);
    if (r2 > 0.25) discard;
    mask = smoothstep(0.25, 0.16, r2);
  }

  vec3 rgb = vColor;

  // Contour Lines: bands the *actual height field*, not the audio-driven
  // color -- the only display mode here that visualizes geometry rather
  // than signal. vHeight is interpolated per-fragment (not per-vertex) so
  // the band edges stay smooth across each triangle instead of following
  // the flat facets.
  if (uContourLines > 0.5) {
    float bands = fract(vHeight * uContourDensity);
    float edge = 1.0 - smoothstep(0.0, 0.05, min(bands, 1.0 - bands));
    rgb += vec3(0.25, 0.85, 1.0) * edge * 0.7;
  }

  // Posterize: quantized in the fragment shader (on the already-interpolated
  // color), not per-vertex -- doing it per-vertex would let GPU interpolation
  // smear the hard steps back into a gradient across each triangle.
  if (uPosterize > 0.5) {
    float steps = max(2.0, uPosterizeSteps);
    rgb = floor(rgb * steps + 0.5) / steps;
  }

  // Scanlines: needs gl_FragCoord, so this has to live in a fragment shader
  // (there's no per-vertex equivalent). Alternating hard rows, matched by
  // the same effect in BG_FRAG so it reads across the whole frame.
  if (uScanlines > 0.5) {
    float row = step(0.5, fract(gl_FragCoord.y * 0.5));
    float scanFactor = mix(1.0, mix(1.0, 0.3, row), uScanlineIntensity);
    rgb *= scanFactor;
  }

  outColor = vec4(rgb, vAlpha * mask);
}
`;

// Opaque backing pass: previewRenderer.ts documents that scenes must fully
// cover the frame (the gallery detaches the shared offscreen buffer each
// tick and nothing ever clears it) — the mesh's alpha-blended passes leave
// gaps (quiet/transparent regions, the area outside the circular mask), so
// this still runs underneath — a dark vignette, optionally with the
// Background Mesh checkbox's procedural lattice on top.
const BG_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${settingsUniformsGlsl}
${PALETTE_GLSL}
${ROOM_UV_GLSL}

#define PI 3.14159265359

// A cheap analytic background lattice, not a real multi-pass post-effect
// (this project has no compositor for one): three ridge gratings at
// 60-degree offsets tile into a fine triangular mesh, evoking the dome's own
// wireframe without being geometrically tied to its actual grid lines.
float triLattice(vec2 p) {
  vec2 a1 = vec2(1.0, 0.0);
  vec2 a2 = vec2(0.5, 0.8660254);
  vec2 a3 = vec2(-0.5, 0.8660254);
  float d1 = abs(fract(dot(p, a1)) - 0.5);
  float d2 = abs(fract(dot(p, a2)) - 0.5);
  float d3 = abs(fract(dot(p, a3)) - 0.5);
  float d = min(min(d1, d2), d3);
  // fwidth-based line width keeps this a clean fine mesh instead of
  // aliasing into speckle noise, whatever the local pixel-space frequency
  // ends up being after the radial warp below.
  float aa = max(fwidth(d) * 1.5, 0.003);
  return 1.0 - smoothstep(0.0, aa, d);
}

void main() {
  vec2 uv = roomUv(vUv) - 0.5;
  uv.x *= uResolution.x / uResolution.y;
  float r = length(uv);
  float vig = smoothstep(1.1, 0.1, r);
  vec3 base = palette(0.02 + uEnergy * 0.03, uPalA, uPalB, uPalC, uPalD) * 0.06;
  vec3 col = base * vig;

  if (uBgMesh > 0.5) {
    // Radial warp so the lattice reads as receding away from the dome
    // rather than a flat tiled overlay. Denser and dimmer further out.
    vec2 warped = uv * (2.0 + r * 6.0) * 5.5;
    float lattice = triLattice(warped);
    float fade = smoothstep(0.08, 0.35, r) * (1.0 - smoothstep(0.75, 1.15, r));
    vec3 gold = vec3(1.0, 0.7, 0.15);
    vec3 shadow = vec3(0.15, 0.02, 0.08);
    vec3 latticeCol = mix(shadow, gold, clamp(uEnergy * 1.5, 0.0, 1.0));
    col += latticeCol * lattice * fade * 0.5;
  }

  // Matches MESH_FRAG's scanline effect so it reads as one continuous CRT
  // overlay across the whole frame, not just the dome.
  if (uScanlines > 0.5) {
    float row = step(0.5, fract(gl_FragCoord.y * 0.5));
    float scanFactor = mix(1.0, mix(1.0, 0.3, row), uScanlineIntensity);
    col *= scanFactor;
  }

  outColor = vec4(col, 1.0);
}
`;

export const meshGridScene: Scene = (() => {
  let bgProg: GLProgram | null = null;
  let quadVao: WebGLVertexArrayObject | null = null;
  let meshProg: GLProgram | null = null;
  let gridVao: WebGLVertexArrayObject | null = null;
  let posBuf: WebGLBuffer | null = null;
  let lineIdxBuf: WebGLBuffer | null = null;
  let triIdxBuf: WebGLBuffer | null = null;
  let lineIndexCount = 0;
  let triIndexCount = 0;
  let vertexCount = 0;
  let historyTex: WebGLTexture | null = null;
  let historyLoc: WebGLUniformLocation | null = null;
  let history: ReturnType<typeof createSpectrumHistory> | null = null;
  const bandsBuf = new Float32Array(NUM_BANDS);

  // CPU-side exponential dampening of the spectrum bands (see file header)
  // plus a spectral-flux envelope driving the Flowing Noise/Radial Mix
  // audio modulations.
  let smoothedBands: Float32Array | null = null;
  let prevRawBands: Float32Array | null = null;
  let fluxEnv = 0;
  let lastFrameTime: number | null = null;

  return {
    id: ID,
    name: "Mesh Grid",
    settings: SETTINGS,

    init(ctx: SceneContext) {
      const { gl } = ctx;
      bgProg = createProgram(gl, BG_FRAG);
      quadVao = createFullscreenQuad(gl);

      meshProg = createProgram(gl, MESH_FRAG, MESH_VERT);
      historyLoc = gl.getUniformLocation(meshProg.program, "uHistory");

      const n = gridSizeForQuality(ctx.quality.detail);
      const withDiagonals = ctx.quality.detail >= 0.5;
      const positions = buildGridPositions(n);
      const lineIndices = buildGridIndices(n, withDiagonals);
      const triIndices = buildGridTriangles(n);
      lineIndexCount = lineIndices.length;
      triIndexCount = triIndices.length;
      vertexCount = n * n;

      gridVao = gl.createVertexArray();
      gl.bindVertexArray(gridVao);
      posBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      lineIdxBuf = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lineIdxBuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, lineIndices, gl.STATIC_DRAW);
      triIdxBuf = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, triIdxBuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, triIndices, gl.STATIC_DRAW);
      gl.bindVertexArray(null);

      history = createSpectrumHistory(NUM_BANDS, HISTORY_FRAMES);
      historyTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, historyTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, NUM_BANDS, HISTORY_FRAMES, 0, gl.RED, gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D, null);

      smoothedBands = new Float32Array(NUM_BANDS);
      prevRawBands = new Float32Array(NUM_BANDS);
      fluxEnv = 0;
      lastFrameTime = null;
    },

    render(ctx, frame, viewport, palette, anim) {
      if (!bgProg || !quadVao || !meshProg || !gridVao || !historyTex || !history || !smoothedBands || !prevRawBands) return;
      const { gl } = ctx;

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      bgProg.use();
      // BG_FRAG now declares the full settingsUniformsGlsl block too (it
      // uses a few of them -- Background Mesh, Scanlines -- and the rest are
      // simply unset/no-op uniforms, same as meshProg's uNewestRow pattern).
      uploadCommonUniforms(bgProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      drawFullscreenQuad(gl, quadVao);

      // dt for the CPU-side smoothing below. frame.time is the room/monotonic
      // clock this frame represents; guard the first frame and any backwards
      // jump (source switch, seek) with a small fallback.
      const dt = lastFrameTime === null ? 1 / 60 : Math.max(0, Math.min(0.25, frame.time - lastFrameTime));
      lastFrameTime = frame.time;

      // Spectral flux: sum of positive frame-to-frame increases across
      // bands, averaged -- an "onset strength" signal driving the Flowing
      // Noise/Radial Mix modulations below via a fast-attack/slow-release
      // envelope (10ms/200ms).
      let fluxRaw = 0;
      for (let i = 0; i < NUM_BANDS; i++) {
        const d = frame.bands[i] - prevRawBands[i];
        if (d > 0) fluxRaw += d;
        prevRawBands[i] = frame.bands[i];
      }
      fluxRaw = Math.min(1, fluxRaw / NUM_BANDS);
      const tau = fluxRaw > fluxEnv ? 0.01 : 0.2;
      fluxEnv += (fluxRaw - fluxEnv) * (1 - Math.exp(-dt / tau));

      // Smooths the input bands themselves before they reach the history
      // texture — see file header.
      const dampening = resolveSceneSetting(ID, settingFor("dampening"));
      for (let i = 0; i < NUM_BANDS; i++) {
        smoothedBands[i] = dampen(smoothedBands[i], frame.bands[i], dampening, dt);
      }

      const newestRow = history.push(smoothedBands);
      gl.bindTexture(gl.TEXTURE_2D, historyTex);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        newestRow,
        NUM_BANDS,
        1,
        gl.RED,
        gl.FLOAT,
        history.data,
        newestRow * NUM_BANDS,
      );

      meshProg.use();
      uploadCommonUniforms(meshProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, historyTex);
      gl.uniform1i(historyLoc, 0);
      meshProg.setF("uNewestRow", newestRow);

      // Flowing Noise/Radial Mix: base slider value plus/minus a flux term,
      // scaled by Flux Reactivity as a single knob over both together (flux
      // pushes noise up, pulls radialMix down).
      //
      // resolveSceneSetting (not getSceneSetting) for the bases below —
      // these reads happen after uploadCommonUniforms already wrote
      // uNoise/uRadialMix from the auto-resolved value; reading the raw
      // manual value here would silently re-stomp an auto-tuned slider back
      // to manual every frame (see autoTune.ts).
      const fluxReactivity = resolveSceneSetting(ID, settingFor("fluxReactivity"));
      const noiseBase = resolveSceneSetting(ID, settingFor("noise"));
      const effectiveNoise = Math.max(0, Math.min(5, noiseBase + 2.8 * fluxReactivity * fluxEnv));
      meshProg.setF("uNoise", effectiveNoise);
      const radialMixBase = resolveSceneSetting(ID, settingFor("radialMix"));
      const effectiveRadialMix = Math.max(0, Math.min(1, radialMixBase - 2.2 * fluxReactivity * fluxEnv));
      meshProg.setF("uRadialMix", effectiveRadialMix);

      // Nothing else in the gallery's shared context ever clears depth (see
      // gl.ts) — this scene owns clearing its own, every frame.
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(gridVao);

      // Fill: alpha-blended solid undercoat. Writes depth even though
      // fillReactivity=1
      // for this preset — kept on so the coarser grids used at lower quality
      // don't show obvious see-through overlap; see file header). Skipped
      // entirely when Wireframe Only is on -- a pure CPU/render() branch,
      // no shader involvement, since it's just "don't issue this draw call."
      const wireframeOnly = resolveSceneSetting(ID, settingFor("wireframeOnly")) > 0.5;
      if (!wireframeOnly) {
        gl.depthMask(true);
        meshProg.setF("uIsFillPass", 1.0);
        meshProg.setF("uIsPointPass", 0.0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, triIdxBuf);
        gl.drawElements(gl.TRIANGLES, triIndexCount, gl.UNSIGNED_INT, 0);
      }

      // Wireframe + dots: depth-tested against the fill, don't write depth
      // themselves (both draw over the same surface).
      gl.depthMask(false);
      meshProg.setF("uIsFillPass", 0.0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lineIdxBuf);
      gl.drawElements(gl.LINES, lineIndexCount, gl.UNSIGNED_INT, 0);

      meshProg.setF("uIsPointPass", 1.0);
      gl.drawArrays(gl.POINTS, 0, vertexCount);

      gl.bindVertexArray(null);
      // The gallery renders every scene into one shared context each tick —
      // must not leak depth or blend state onto the next tile.
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      bgProg?.dispose();
      meshProg?.dispose();
      if (quadVao) gl.deleteVertexArray(quadVao);
      if (gridVao) gl.deleteVertexArray(gridVao);
      if (posBuf) gl.deleteBuffer(posBuf);
      if (lineIdxBuf) gl.deleteBuffer(lineIdxBuf);
      if (triIdxBuf) gl.deleteBuffer(triIdxBuf);
      if (historyTex) gl.deleteTexture(historyTex);
      bgProg = null;
      meshProg = null;
      quadVao = null;
      gridVao = null;
      posBuf = null;
      lineIdxBuf = null;
      triIdxBuf = null;
      historyTex = null;
      historyLoc = null;
      history = null;
      smoothedBands = null;
      prevRawBands = null;
      fluxEnv = 0;
      lastFrameTime = null;
    },
  };
})();
