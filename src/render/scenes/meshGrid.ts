import { NUM_BANDS } from "../../audio/types.ts";
import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../gl.ts";
import { PALETTE_GLSL } from "../palette.ts";
import type { SceneSetting } from "../sceneSettings.ts";
import { resolveSceneSetting } from "../autoTune.ts";
import type { Scene, SceneContext } from "../scene.ts";
import { COMMON_UNIFORMS_GLSL, ROOM_UV_GLSL, settingUniformName, uploadCommonUniforms } from "../sceneCommon.ts";

// A hidden-line terrain that is a live spectrogram waterfall: across the
// grid (X) is frequency, mirrored so the bass sits as a ridge down the
// middle and the treble runs out to both edges; into the grid (Z) is time,
// with the newest spectrum frame at the front row and older frames receding
// toward a fogged horizon. The surface is a rolling history of the spectrum
// rather than a single frozen frame.
//
// Design notes on how it's built:
//
//  - Newest row at the *front*. The big, legible rows nearest the camera are
//    the ones that should snap to the beat; putting the newest frame at the
//    horizon instead would leave the front `flow * HISTORY_FRAMES` frames
//    stale and the whole scene would visibly lag the music.
//  - Real perspective depth. `toClip` in CAMERA_GLSL writes a genuine
//    near/far-mapped z, and the fill pass writes depth, so near ridges occlude
//    far ones — the hidden-line look is the depth buffer doing its job, not a
//    draw-order trick. (An earlier version of this scene wrote a constant
//    NDC z for every vertex, which is why its surface folded over itself.)
//  - Grid lines are drawn *procedurally in the fragment shader* of the fill
//    pass, from the interpolated cell coordinate `vGrid` and `fwidth`, rather
//    than as a separate gl.LINES pass. The GL context has no MSAA
//    (`antialias: false` in gl.ts), so 1-px hardware lines would alias into
//    moiré in the far field; the analytic lines are anti-aliased, fade out on
//    their own as cell spacing approaches a pixel, and are exactly on the
//    surface so they need no polygon offset and can never z-fight it.
//  - The grid is a trapezoid that hugs the view frustum: each row's world
//    half-width is the frustum's half-width at that depth (times
//    WIDTH_MARGIN), so the surface always slightly overflows the frame with
//    no receding side edges, and on-screen column spacing stays constant
//    front to back. Frequency-to-X is therefore consistent in screen space.
//  - Row spacing in world Z is non-linear (`Z_POWER`) so rows spread more
//    evenly on screen under perspective; time per row stays uniform because
//    the history lookup uses the normalized row fraction, not world Z.
//  - No directional lighting. Color comes from the room palette
//    (`palette()` in palette.ts, like every other scene) driven by the
//    per-vertex spectrum amplitude, with a push toward white at peaks that
//    Color Intensity and the spectral-flux envelope both feed, and a
//    `col / (1 + col)` tonemap (same trick as caustics.ts) so loud passages
//    glow instead of clipping flat.
//  - The far edge dissolves into the background instead of showing a
//    silhouette: the fill pass fog-mixes toward `bgColor()` — the *same*
//    function BG_FRAG paints the frame with (horizon glow included) — so
//    there is no seam where the mesh ends. Keep those two in lockstep by
//    only ever editing `BG_COLOR_GLSL`.
//  - Surface Fill is the occluder's *tint*, not its opacity: a depth-writing
//    surface can't be made see-through by alpha (alpha doesn't affect the
//    depth test). Wireframe Only is the one true see-through mode — it draws
//    the surface pass additively with depth writes off and the fill color
//    zeroed.
//  - Height is temporally smoothed by an exponential filter applied to the
//    spectrum bands on the CPU before they reach the history texture, rather
//    than to every vertex each frame (see `dampen()` below) — cheap, and since
//    per-vertex height is a smooth function of a couple of nearby bins,
//    smoothing the input gets close to smoothing the output.
//  - Flowing Noise gets a small attack/release envelope driven by spectral
//    flux (onset strength) on top of its slider baseline, and the same
//    envelope brightens the peak glow, so transients visibly push the surface
//    rather than only the steady-state controls doing so — Flux Reactivity is
//    a single knob over both.
//  - The noise field travels *with* the data (sampled in frame-count space,
//    not grid space), so the terrain's undulation scrolls toward the camera
//    with the spectrogram instead of the spectrogram sliding over a static
//    bump map. Its time axis is wrapped on the noise lattice (`noisePeriodic`)
//    so the scroll phase can stay small forever — a raw ever-growing frame
//    count would eventually starve the hash of float precision.
//
// Beyond the core terrain, this scene also exposes a handful of display
// modes in a "technical/digital" instrument-panel register — Scanlines,
// Posterize, Wireframe Only, Scan Sweep, Contour Lines — evoking CRT
// monitors, radar/HUD sweeps, quantized signal readouts, and topographic
// contour maps. Each is cheap enough to run inside the existing single-pass
// forward render (no offscreen framebuffer needed) — see each one's own
// comment for exactly where and why.
const ID = "mesh";

const HISTORY_FRAMES = 200; // rows in the rolling spectrogram history ring
const GRID_DEPTH = 160.0; // world z of the far (oldest) row; the front row is at z=0
const Z_POWER = 1.4; // >1 spreads rows toward the horizon so they stay legible under perspective
const HEIGHT_SCALE = 6.0; // world units of displacement at amplitude 1, waveHeight 1
const WIDTH_MARGIN = 1.15; // grid half-width as a multiple of the frustum half-width at that depth
const FOG_K = 1.0 / 110.0; // 1/(view depth) at which fog reaches 1/e
const LINE_PX = 1.2; // grid line width in pixels before anti-aliasing
const NOISE_PERIOD = 64.0; // lattice period of the noise field's time axis (see noisePeriodic)
const NOISE_Z_RATE = 0.25; // noise-lattice cells the field scrolls per spectrum frame at noiseScale 1

// Every knob the algorithm actually supports is exposed as a live setting
// rather than a baked-in constant, so the space it covers is fully
// explorable rather than locked to one fixed look.
const SETTINGS: SceneSetting[] = [
  {
    key: "waveHeight",
    label: "Wave Height",
    description: "Height of the spectrum ridges",
    min: 0.1,
    max: 5,
    step: 0.1,
    default: 1.1,
    // Displacement amplitude follows macro dynamics; dark mixes get more bulk.
    auto: { dynamics: 0.3, brightness: -0.2 },
  },
  {
    key: "valley",
    label: "Valley",
    description: "Curvature across the terrain (positive = edges rise into a canyon, negative = a ridge)",
    min: -20,
    max: 20,
    step: 0.5,
    default: 4,
  },
  {
    key: "cameraDistance",
    label: "Camera Distance",
    description: "How far back from the front row the camera sits -- further pushes the whole terrain away",
    min: 2,
    max: 60,
    step: 1,
    default: 16,
  },
  {
    key: "cameraHeight",
    label: "Camera Height",
    description: "Camera height above the terrain's rest level -- low is a grazing view, high looks down on it",
    min: 1,
    max: 40,
    step: 0.5,
    default: 9,
  },
  {
    key: "cameraTilt",
    label: "Camera Tilt",
    description: "Camera pitch in degrees -- negative looks down (horizon rises), positive looks up",
    min: -35,
    max: 15,
    step: 0.5,
    default: -9.5,
  },
  {
    key: "flow",
    label: "Waterfall",
    description: "How far back in time the horizon reads",
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
    description: "Terrain undulation baseline -- surges further on audio transients",
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
    description: "Undulation pattern size -- lower is broader/rolling hills",
    min: 0.01,
    max: 1,
    step: 0.01,
    default: 0.1,
  },
  {
    key: "fluxReactivity",
    label: "Flux Reactivity",
    description: "How hard audio transients push Flowing Noise and the peak glow",
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
    label: "Surface Tint",
    description: "Brightness of the dark surface beneath the grid lines (it always occludes; see Wireframe Only)",
    min: 0,
    max: 1,
    step: 0.05,
    default: 1.0,
    // Denser mixes support a more present surface; sparse/bright ones read better closer to black.
    auto: { density: 0.15, brightness: -0.1 },
  },
  {
    key: "fillReactivity",
    label: "Tint Reactivity",
    description: "How much the surface tint lights up with loudness",
    min: 0,
    max: 1,
    step: 0.05,
    default: 1.0,
  },
  {
    key: "lineReactivity",
    label: "Line Reactivity",
    description: "How much the grid lines' brightness tracks loudness (quiet lines never fully vanish)",
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
    default: 0.3,
    // Vertex-dot presence tracks hats/cymbals and transient hits.
    auto: { brightness: 0.3, attack: 0.15 },
  },
  {
    key: "dotReactivity",
    label: "Dot Reactivity",
    description: "How much dot size/brightness tracks loudness",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
  },
  {
    key: "colorIntensity",
    label: "Color Intensity",
    description: "Push peaks toward white-hot, or pull the whole surface back toward the palette's shadows",
    min: 0.2,
    max: 3,
    step: 0.05,
    default: 1.0,
  },
  {
    key: "bgMesh",
    label: "Background Mesh",
    description: "Faint procedural lattice in the sky above the horizon",
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
    description: "Quantize the colors into hard bands instead of a smooth blend",
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
    description: "Drop the occluding surface -- see-through lines and dots only, a bare circuit-board read",
    min: 0,
    max: 1,
    step: 1,
    default: 0,
    type: "boolean",
  },
  {
    key: "scanSweep",
    label: "Scan Sweep",
    description: "A bright row sweeping from the front to the horizon, like a radar display's sweep line",
    min: 0,
    max: 1,
    step: 1,
    default: 0,
    type: "boolean",
  },
  {
    key: "sweepSpeed",
    label: "Sweep Speed",
    description: "How fast the sweep row travels",
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

/** Grid resolution scaled off the quality detail proxy — the same signal
 *  shaders use to scale raymarch/density cost (see quality.ts). Columns and
 *  rows are sized independently: X only has to resolve the mirrored
 *  NUM_BANDS spectrum, while Z wants roughly one row per history frame the
 *  waterfall shows. Both are non-increasing as quality drops. */
export function gridDimsForQuality(quality: number): { cols: number; rows: number } {
  if (quality >= 0.9) return { cols: 96, rows: 128 };
  if (quality >= 0.65) return { cols: 80, rows: 96 };
  if (quality >= 0.35) return { cols: 64, rows: 64 };
  return { cols: 48, rows: 48 };
}

/** cols*rows vertices in [-1,1]², row-major (row = index/cols, col = index%cols).
 *  x spans the columns, y spans the rows. */
export function buildGridPositions(cols: number, rows: number = cols): Float32Array {
  const positions = new Float32Array(cols * rows * 2);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = (row * cols + col) * 2;
      positions[i] = (col / (cols - 1)) * 2 - 1;
      positions[i + 1] = (row / (rows - 1)) * 2 - 1;
    }
  }
  return positions;
}

/** Two CCW triangles per cell over a cols*rows grid, for the surface pass. */
export function buildGridTriangles(cols: number, rows: number = cols): Uint32Array {
  const tris: number[] = [];
  const idx = (row: number, col: number) => row * cols + col;
  for (let row = 0; row < rows - 1; row++) {
    for (let col = 0; col < cols - 1; col++) {
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
 *  so the terrain's rows read as a genuine spectrogram waterfall (further
 *  back = further back in time) rather than a synthetic wave. */
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

/** Mirrors the vertex shader's `mod(newestRow - z*flow*frames, frames)`
 *  row lookup, where `z` is the row's normalized depth (0 = front row) —
 *  kept as a standalone pure function so the wrap-around math is
 *  unit-testable without a GL context. Returns a fractional row; callers
 *  that need an integer row should floor it, matching the shader's nearest
 *  sampling. */
export function historyRowFor(newestRow: number, z: number, flow: number, frames: number): number {
  const back = z * flow * frames;
  let row = (newestRow - back) % frames;
  if (row < 0) row += frames;
  return row;
}

/** Mirrors the vertex shader's spectrum-bin lookup for a grid x in [-1, 1]:
 *  the spectrum is folded about the center so bin 0 (bass) sits at x=0 and
 *  the top bin at both edges. Fractional; the shader interpolates between
 *  the two neighbouring bins. */
export function mirroredBinFor(x: number, bands: number): number {
  return Math.min(1, Math.abs(x)) * (bands - 1);
}

/** Exponential dampening: moves a `rate`-weighted fraction of the way from
 *  `prev` toward `target` per 120fps-normalized frame, framerate-independent
 *  via `rate^(120*dt)`. Smooths the spectrum bands on the CPU each frame
 *  before they reach the history texture (see file header). */
function dampen(prev: number, target: number, rate: number, dt: number): number {
  return prev + (target - prev) * (1 - Math.pow(rate, 120 * dt));
}

const settingsUniformsGlsl = SETTINGS.map((s) => `uniform float ${settingUniformName(s.key)};`).join("\n");

// Camera, projection and the horizon line, shared verbatim by MESH_VERT,
// MESH_FRAG and BG_FRAG so the background's horizon glow lands exactly on
// the terrain's far edge in both fullscreen and Panorama (all three derive
// it from the same projection of the same world point). The camera itself
// is driven by the Camera Distance / Height / Tilt settings: it sits on the
// center line, behind the front row (which is at world z = 0), and pitches
// about its own X axis — no yaw or roll, so the bass ridge always stays
// centered. Requires COMMON_UNIFORMS_GLSL (uResolution, uViewport) and
// settingsUniformsGlsl to be declared first.
const CAMERA_GLSL = `
#define GRID_DEPTH ${GRID_DEPTH.toFixed(1)}
#define NEAR 0.5
#define FAR 400.0

vec3 camPos() { return vec3(0.0, uCameraHeight, -uCameraDistance); }
vec3 camForward() {
  float p = radians(uCameraTilt);
  return vec3(0.0, sin(p), cos(p));
}

float focalY() { return 1.0 / tan(radians(60.0) * 0.5); }

// Aspect of the full room-space canvas, not this device's slice of it.
float roomAspect() {
  return (uResolution.x / max(uViewport.z, 0.0001)) / (uResolution.y / max(uViewport.w, 0.0001));
}

vec3 toView(vec3 world) {
  vec3 forward = camForward();
  vec3 right = normalize(cross(forward, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, forward);
  vec3 rel = world - camPos();
  return vec3(dot(rel, right), dot(rel, up), dot(rel, forward));
}

// Room-space clip coordinates with a genuine perspective depth: NDC z runs
// -1 at NEAR to +1 at FAR, so the depth test orders the surface correctly.
vec4 toClip(vec3 view) {
  float z = max(view.z, NEAR);
  float zc = z * (FAR + NEAR) / (FAR - NEAR) - 2.0 * FAR * NEAR / (FAR - NEAR);
  return vec4(view.x * focalY() / roomAspect(), view.y * focalY(), zc, z);
}

// Room-space v (0 = bottom, 1 = top) of the terrain's far edge at rest height.
float horizonV() {
  vec4 c = toClip(toView(vec3(0.0, 0.0, GRID_DEPTH)));
  return (c.y / c.w) * 0.5 + 0.5;
}
`;

// The frame's backdrop, as one function so the terrain's fog can dissolve
// into exactly what BG_FRAG painted (see file header). Requires
// COMMON_UNIFORMS_GLSL, PALETTE_GLSL and CAMERA_GLSL. Takes a room-space uv.
const BG_COLOR_GLSL = `
vec3 bgColor(vec2 rUv) {
  vec2 p = rUv - 0.5;
  p.x *= roomAspect();
  float vig = smoothstep(1.1, 0.1, length(p));
  vec3 base = max(palette(0.02 + uEnergy * 0.03, uPalA, uPalB, uPalC, uPalD), 0.0) * 0.06 * vig;
  // A soft band of light along the horizon, breathing with overall energy —
  // the thing the terrain's far rows fade into.
  float glow = exp(-pow((rUv.y - horizonV()) * 8.0, 2.0)) * (0.14 + 0.10 * uEnergy);
  return base + max(palette(0.3, uPalA, uPalB, uPalC, uPalD), 0.0) * glow;
}
`;

const MESH_VERT = `#version 300 es
precision highp float;
precision highp sampler2D;
layout(location = 0) in vec2 aPos;
out vec2 vGrid;   // cell coordinates (column, row) for the procedural grid lines
out float vAmp;   // spectrum amplitude at this vertex
out float vZ;     // normalized depth, 0 = front (newest) row, 1 = far edge
out float vFog;   // 1 = fully visible, 0 = dissolved into the background
out float vHeight; // raw surface displacement, for the Contour Lines checkbox in MESH_FRAG
${COMMON_UNIFORMS_GLSL}
${settingsUniformsGlsl}
${CAMERA_GLSL}
uniform sampler2D uHistory;
uniform float uNewestRow;
uniform float uNoisePhase; // scroll phase of the noise field's time axis, kept in [0, NOISE_PERIOD) by render()
uniform vec2 uGridDims;    // (cols, rows) of the grid this quality preset built
// uNoise is declared above by settingsUniformsGlsl (it's a real setting, a
// slider a user can move) but render() overwrites it every frame with a
// flux-modulated value on top of that slider baseline -- see render()'s
// comment.
uniform float uIsPointPass; // 1.0 only during the dots (gl.POINTS) draw

#define HISTORY_FRAMES ${HISTORY_FRAMES.toFixed(1)}
#define NUM_BANDS ${NUM_BANDS.toFixed(1)}
#define Z_POWER ${Z_POWER.toFixed(2)}
#define HEIGHT_SCALE ${HEIGHT_SCALE.toFixed(1)}
#define WIDTH_MARGIN ${WIDTH_MARGIN.toFixed(2)}
#define FOG_K ${FOG_K.toFixed(6)}
#define NOISE_PERIOD ${NOISE_PERIOD.toFixed(1)}
#define NOISE_Z_RATE ${NOISE_Z_RATE.toFixed(3)}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Value noise -- cheaper than a Perlin/gradient-noise permutation table
// while keeping the same broad turbulent character. Periodic along y with
// period NOISE_PERIOD lattice cells (the lattice index is wrapped, so the
// interpolation across the wrap is seamless), which lets the time axis
// scroll forever from a bounded phase — see file header.
float noisePeriodic(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float iy0 = mod(i.y, NOISE_PERIOD);
  float iy1 = mod(i.y + 1.0, NOISE_PERIOD);
  float a = hash21(vec2(i.x, iy0));
  float b = hash21(vec2(i.x + 1.0, iy0));
  float c = hash21(vec2(i.x, iy1));
  float d = hash21(vec2(i.x + 1.0, iy1));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Manual bilinear sampling of the history texture across both axes: R32F
// textures can't use hardware LINEAR filtering without
// OES_texture_float_linear, which isn't guaranteed on the TV-class hardware
// this project targets. binF is clamped to the spectrum, rowF wraps.
float sampleHistory(float binF, float rowF) {
  binF = clamp(binF, 0.0, NUM_BANDS - 1.0);
  float bin0 = floor(binF);
  float bin1 = min(bin0 + 1.0, NUM_BANDS - 1.0);
  float binFrac = fract(binF);
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
  return mix(mix(amp00, amp10, binFrac), mix(amp01, amp11, binFrac), rowFrac);
}

void main() {
  float fx = abs(aPos.x);              // 0 at the center (bass), 1 at either edge (treble)
  float zNorm = aPos.y * 0.5 + 0.5;    // 0 = front (newest) row, 1 = far edge

  // Rows are the audio spectrum's history (newest at the front), columns the
  // spectrum itself folded about the center: bass ridge in the middle,
  // treble at both edges.
  //
  // A small blur across neighbouring bins: adjacent bands can differ a lot
  // frame to frame, and with only a couple of columns per bin a plain
  // bilinear read turns every such step into a vertical cliff. The kernel
  // keeps the ridges but rounds their shoulders into terrain.
  float binF = fx * (NUM_BANDS - 1.0);
  float framesBack = zNorm * uFlow * HISTORY_FRAMES;
  float rowF = mod(uNewestRow - framesBack, HISTORY_FRAMES);
  float amp = (sampleHistory(binF - 0.7, rowF) + 2.0 * sampleHistory(binF, rowF) + sampleHistory(binF + 0.7, rowF)) * 0.25;
  amp = clamp(amp, 0.0, 1.0);
  vAmp = amp;

  float height = amp * uWaveHeight * HEIGHT_SCALE;

  // Undulation sampled in (normalized x, absolute frame) space so it scrolls
  // with the data. noiseScale sets the pattern size on both axes together.
  vec2 noiseCoord = vec2(aPos.x * 15.0 * uNoiseScale, uNoisePhase - framesBack * NOISE_Z_RATE * uNoiseScale);
  float nz = noisePeriodic(noiseCoord);
  height += (2.0 * nz - 1.0) * uNoise * uWaveHeight * 0.2 * HEIGHT_SCALE; // *0.2: keeps noise as texture, not a dominant swing

  height += uValley * aPos.x * aPos.x;
  vHeight = height; // to MESH_FRAG, for the Contour Lines checkbox

  // Trapezoid grid hugging the frustum: half-width grows with depth so the
  // surface overflows the frame at every row (see file header). Rows are
  // spread non-linearly in world z so they stay legible under perspective.
  float worldZ = GRID_DEPTH * pow(zNorm, Z_POWER);
  // Frustum half-width at this row's *view-space* depth (of the row at rest
  // height), so the trapezoid stays correct whatever the Camera Tilt is.
  float rowViewZ = max(toView(vec3(0.0, 0.0, worldZ)).z, NEAR);
  float halfW = WIDTH_MARGIN * rowViewZ * roomAspect() / focalY();
  vec3 worldPos = vec3(aPos.x * halfW, height, worldZ);

  vec3 view = toView(worldPos);
  vec4 clip = toClip(view);
  float viewZ = max(view.z, NEAR);

  // Panorama slice, applied in NDC (post perspective-divide): project into
  // the full room's clip space, remap by this device's viewport rect, then
  // re-derive clip.xy so the GPU's own divide (using the original clip.w)
  // lands correctly.
  vec2 ndc = clip.xy / clip.w;
  vec2 uv01 = ndc * 0.5 + 0.5;
  uv01 = (uv01 - uViewport.xy) / uViewport.zw;
  clip.xy = (uv01 * 2.0 - 1.0) * clip.w;
  gl_Position = clip;

  vGrid = (aPos * 0.5 + 0.5) * (uGridDims - 1.0);
  vZ = zNorm;
  // Depth fog, with an explicit fade over the last stretch of rows so the far
  // edge is guaranteed to reach exactly the background color.
  vFog = exp(-pow(viewZ * FOG_K, 2.0)) * (1.0 - smoothstep(0.75, 1.0, zNorm));

  // Perspective-scaled point size, so dots read consistently near and far.
  float ampFactor = mix(1.0, mix(0.2, 1.0, amp), uDotReactivity);
  gl_PointSize = (0.3 + 1.2 * uDots) * ampFactor * (110.0 / viewZ);
}
`;

const MESH_FRAG = `#version 300 es
precision highp float;
in vec2 vGrid;
in float vAmp;
in float vZ;
in float vFog;
in float vHeight;
uniform float uIsPointPass;
uniform float uFluxEnv; // spectral-flux envelope from render(), brightens the peak glow
// The common + settings blocks are re-declared here even though MESH_VERT
// already declares them -- each shader stage in a WebGL2 program needs its
// own uniform declaration to reference it, even when both stages share the
// same linked program and value.
${COMMON_UNIFORMS_GLSL}
${settingsUniformsGlsl}
${PALETTE_GLSL}
${ROOM_UV_GLSL}
${CAMERA_GLSL}
${BG_COLOR_GLSL}
out vec4 outColor;

#define LINE_PX ${LINE_PX.toFixed(2)}

void main() {
  float a = pow(clamp(vAmp, 0.0, 1.0), 0.6);
  vec3 base = max(palette(0.05 + 0.4 * a + 0.12 * vZ, uPalA, uPalB, uPalC, uPalD), 0.0);
  // White-hot push at peaks: Color Intensity moves the threshold, the flux
  // envelope (transients) makes the glow flare.
  float hot = smoothstep(0.55, 1.0, a * uColorIntensity) * (1.5 + 3.0 * uFluxEnv * uFluxReactivity);

  if (uIsPointPass > 0.5) {
    // Circular sprite with a soft antialiased rim (gl_PointCoord distance
    // test), drawn additively -- bright only where the spectrum peaks.
    vec2 pc = gl_PointCoord - 0.5;
    float r2 = dot(pc, pc);
    if (r2 > 0.25) discard;
    float mask = smoothstep(0.25, 0.16, r2);
    vec3 dot = (base * 0.6 + vec3(1.0) * hot) * mask * vFog * mix(1.0, a, uDotReactivity) * 0.8;
    outColor = vec4(dot, 1.0);
    return;
  }

  // Procedural grid lines from the interpolated cell coordinate: distance to
  // the nearest column/row line, anti-aliased against its own screen-space
  // footprint (fwidth), and faded out per axis as the cell spacing closes in
  // on a pixel so the far field never aliases into moire. Rows (time
  // slices) lead, columns support, so the waterfall's motion reads first.
  vec2 d = abs(fract(vGrid + 0.5) - 0.5);
  vec2 fw = fwidth(vGrid);
  vec2 l = (1.0 - smoothstep(vec2(0.0), fw * LINE_PX, d)) * (1.0 - smoothstep(vec2(0.3), vec2(0.9), fw));
  float line = max(l.x * 0.7, l.y);

  // Lines keep a visible floor even when quiet; loudness brightens them and
  // pushes them toward white via hot.
  float lineLum = mix(1.0, 0.3 + 0.7 * a, uLineReactivity);
  vec3 lineCol = base * lineLum * (1.0 + 2.0 * uColorIntensity * a) + vec3(1.0) * hot;

  // Scan Sweep: a bright row travelling front-to-horizon, like a radar
  // display's sweep line. Cyan-ish so it reads as "scanner" rather than
  // matching the palette.
  if (uScanSweep > 0.5) {
    float sweepPos = fract(uTime * uSweepSpeed * 0.25);
    lineCol += vec3(0.6, 1.0, 0.9) * exp(-pow((vZ - sweepPos) * 25.0, 2.0));
  }

  // The occluding surface under the lines: near-black, palette-tinted, lit a
  // little by loudness. Zeroed in Wireframe Only (that pass is additive).
  vec3 fillCol = base * 0.06 * uFill * mix(0.4, 0.4 + 1.6 * a, uFillReactivity);
  vec3 col = uWireframeOnly > 0.5 ? lineCol * line : fillCol + lineCol * line;

  // Contour Lines: bands the *actual height field*, not the audio-driven
  // color -- the only display mode here that visualizes geometry rather
  // than signal. vHeight is interpolated per-fragment (not per-vertex) so
  // the band edges stay smooth across each triangle instead of following
  // the flat facets. Width is set in screen space (fwidth) so a band edge
  // is a crisp line whether the surface is steep or nearly flat there.
  if (uContourLines > 0.5) {
    float bands = vHeight * uContourDensity;
    float toEdge = abs(fract(bands + 0.5) - 0.5);
    float edge = 1.0 - smoothstep(0.0, max(fwidth(bands) * 1.5, 0.002), toEdge);
    col += vec3(0.25, 0.85, 1.0) * edge * 0.7 * vFog;
  }

  col = col / (1.0 + col); // tonemap -- loud passages glow instead of clipping flat

  // Fog after the tonemap (the background isn't tonemapped): the opaque
  // surface dissolves into exactly what BG_FRAG painted; the additive
  // Wireframe Only pass simply fades out.
  vec2 rUv = roomUv(gl_FragCoord.xy / uResolution);
  col = uWireframeOnly > 0.5 ? col * vFog : mix(bgColor(rUv), col, vFog);

  // Posterize: quantized in the fragment shader (on the already-interpolated
  // color), not per-vertex -- doing it per-vertex would let GPU interpolation
  // smear the hard steps back into a gradient across each triangle.
  if (uPosterize > 0.5) {
    float steps = max(2.0, uPosterizeSteps);
    col = floor(col * steps + 0.5) / steps;
  }

  // Scanlines: needs gl_FragCoord, so this has to live in a fragment shader
  // (there's no per-vertex equivalent). Alternating hard rows, matched by
  // the same effect in BG_FRAG so it reads across the whole frame.
  if (uScanlines > 0.5) {
    float row = step(0.5, fract(gl_FragCoord.y * 0.5));
    float scanFactor = mix(1.0, mix(1.0, 0.3, row), uScanlineIntensity);
    col *= scanFactor;
  }

  outColor = vec4(col, 1.0);
}
`;

// Opaque backing pass: previewRenderer.ts documents that scenes must fully
// cover the frame (the gallery detaches the shared offscreen buffer each
// tick and nothing ever clears it). The terrain never reaches the sky, and
// its far rows fog into this, so this always runs underneath — bgColor()
// (vignette + horizon glow), optionally with the Background Mesh checkbox's
// procedural lattice above the horizon.
const BG_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${settingsUniformsGlsl}
${PALETTE_GLSL}
${ROOM_UV_GLSL}
${CAMERA_GLSL}
${BG_COLOR_GLSL}

// A cheap analytic lattice, not a real multi-pass post-effect (this project
// has no compositor for one): three ridge gratings at 60-degree offsets tile
// into a fine triangular mesh, echoing the terrain's grid in the sky without
// being geometrically tied to it.
float triLattice(vec2 p) {
  vec2 a1 = vec2(1.0, 0.0);
  vec2 a2 = vec2(0.5, 0.8660254);
  vec2 a3 = vec2(-0.5, 0.8660254);
  float d1 = abs(fract(dot(p, a1)) - 0.5);
  float d2 = abs(fract(dot(p, a2)) - 0.5);
  float d3 = abs(fract(dot(p, a3)) - 0.5);
  float d = min(min(d1, d2), d3);
  // fwidth-based line width keeps this a clean fine mesh instead of
  // aliasing into speckle noise.
  float aa = max(fwidth(d) * 1.5, 0.003);
  return 1.0 - smoothstep(0.0, aa, d);
}

void main() {
  vec2 rUv = roomUv(vUv);
  vec3 col = bgColor(rUv);

  if (uBgMesh > 0.5) {
    float hv = horizonV();
    vec2 p = vec2((rUv.x - 0.5) * roomAspect(), rUv.y - hv) * 14.0;
    float lattice = triLattice(p);
    // Only in the sky: fades in just above the horizon, out toward the top.
    float mask = smoothstep(hv, hv + 0.12, rUv.y) * (1.0 - smoothstep(hv + 0.25, 1.0, rUv.y));
    vec3 latticeCol = max(palette(0.5, uPalA, uPalB, uPalC, uPalD), 0.0);
    col += latticeCol * lattice * mask * (0.04 + 0.08 * uEnergy);
  }

  // Matches MESH_FRAG's scanline effect so it reads as one continuous CRT
  // overlay across the whole frame, not just the terrain.
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
  let triIdxBuf: WebGLBuffer | null = null;
  let triIndexCount = 0;
  let vertexCount = 0;
  let gridCols = 0;
  let gridRows = 0;
  let historyTex: WebGLTexture | null = null;
  let historyLoc: WebGLUniformLocation | null = null;
  let history: ReturnType<typeof createSpectrumHistory> | null = null;
  const bandsBuf = new Float32Array(NUM_BANDS);

  // CPU-side exponential dampening of the spectrum bands (see file header),
  // a spectral-flux envelope driving the Flowing Noise / peak-glow audio
  // modulations, and the noise field's scroll phase.
  let smoothedBands: Float32Array | null = null;
  let prevRawBands: Float32Array | null = null;
  let fluxEnv = 0;
  let noisePhase = 0;
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

      const { cols, rows } = gridDimsForQuality(ctx.quality.detail);
      gridCols = cols;
      gridRows = rows;
      const positions = buildGridPositions(cols, rows);
      const triIndices = buildGridTriangles(cols, rows);
      triIndexCount = triIndices.length;
      vertexCount = cols * rows;

      gridVao = gl.createVertexArray();
      gl.bindVertexArray(gridVao);
      posBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
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
      noisePhase = 0;
      lastFrameTime = null;
    },

    render(ctx, frame, viewport, palette, anim) {
      if (!bgProg || !quadVao || !meshProg || !gridVao || !historyTex || !history || !smoothedBands || !prevRawBands) return;
      const { gl } = ctx;

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      bgProg.use();
      // BG_FRAG declares the full settingsUniformsGlsl block too (it uses a
      // few of them -- Background Mesh, Scanlines -- and the rest are simply
      // unset/no-op uniforms, same as meshProg's uNewestRow pattern).
      uploadCommonUniforms(bgProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      drawFullscreenQuad(gl, quadVao);

      // dt for the CPU-side smoothing below. frame.time is the room/monotonic
      // clock this frame represents; guard the first frame and any backwards
      // jump (source switch, seek) with a small fallback.
      const dt = lastFrameTime === null ? 1 / 60 : Math.max(0, Math.min(0.25, frame.time - lastFrameTime));
      lastFrameTime = frame.time;

      // Spectral flux: sum of positive frame-to-frame increases across
      // bands, averaged -- an "onset strength" signal driving the Flowing
      // Noise / peak-glow modulations below via a fast-attack/slow-release
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

      // resolveSceneSetting (not getSceneSetting) for every base read below —
      // uploadCommonUniforms already wrote the auto-resolved values; reading
      // the raw manual value here would silently re-stomp an auto-tuned
      // slider back to manual every frame (see autoTune.ts).
      //
      // The noise field advances one spectrum frame per push, scaled by
      // Noise Scale, and wraps on the shader's lattice period so the phase
      // stays small forever (see file header). Accumulating incrementally
      // also means a Noise Scale change doesn't jump the field.
      const noiseScale = resolveSceneSetting(ID, settingFor("noiseScale"));
      noisePhase = (noisePhase + NOISE_Z_RATE * noiseScale) % NOISE_PERIOD;

      meshProg.use();
      uploadCommonUniforms(meshProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, historyTex);
      gl.uniform1i(historyLoc, 0);
      meshProg.setF("uNewestRow", newestRow);
      meshProg.setF("uNoisePhase", noisePhase);
      meshProg.setF("uFluxEnv", fluxEnv);
      meshProg.setV2("uGridDims", gridCols, gridRows);

      // Flowing Noise: base slider value plus a flux term, scaled by Flux
      // Reactivity (which also scales the peak glow's flux term in MESH_FRAG).
      const fluxReactivity = resolveSceneSetting(ID, settingFor("fluxReactivity"));
      const noiseBase = resolveSceneSetting(ID, settingFor("noise"));
      const effectiveNoise = Math.max(0, Math.min(5, noiseBase + 2.8 * fluxReactivity * fluxEnv));
      meshProg.setF("uNoise", effectiveNoise);

      // Nothing else in the gallery's shared context ever clears depth (see
      // gl.ts) — this scene owns clearing its own, every frame. The clear
      // honours depthMask, so set it explicitly first.
      gl.depthMask(true);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.bindVertexArray(gridVao);

      // Surface pass: the opaque occluder with the grid lines drawn into it.
      // Polygon offset pushes it back a hair so the dot sprites, which sit
      // exactly on the surface, pass the depth test (WebGL2 has no offset
      // for points). Wireframe Only instead draws it additively without
      // depth writes, the one true see-through mode -- see file header.
      const wireframeOnly = resolveSceneSetting(ID, settingFor("wireframeOnly")) > 0.5;
      if (wireframeOnly) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.depthMask(false);
      } else {
        gl.disable(gl.BLEND);
        gl.depthMask(true);
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(1.0, 1.0);
      }
      meshProg.setF("uIsPointPass", 0.0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, triIdxBuf);
      gl.drawElements(gl.TRIANGLES, triIndexCount, gl.UNSIGNED_INT, 0);
      gl.disable(gl.POLYGON_OFFSET_FILL);

      // Dots: additive sprites, depth-tested against the surface, no depth
      // writes of their own.
      const dots = resolveSceneSetting(ID, settingFor("dots"));
      if (dots > 0.01) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.depthMask(false);
        meshProg.setF("uIsPointPass", 1.0);
        gl.drawArrays(gl.POINTS, 0, vertexCount);
      }

      gl.bindVertexArray(null);
      // The gallery renders every scene into one shared context each tick —
      // must not leak depth, blend or polygon-offset state onto the next tile.
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ZERO);
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      bgProg?.dispose();
      meshProg?.dispose();
      if (quadVao) gl.deleteVertexArray(quadVao);
      if (gridVao) gl.deleteVertexArray(gridVao);
      if (posBuf) gl.deleteBuffer(posBuf);
      if (triIdxBuf) gl.deleteBuffer(triIdxBuf);
      if (historyTex) gl.deleteTexture(historyTex);
      bgProg = null;
      meshProg = null;
      quadVao = null;
      gridVao = null;
      posBuf = null;
      triIdxBuf = null;
      historyTex = null;
      historyLoc = null;
      history = null;
      smoothedBands = null;
      prevRawBands = null;
      fluxEnv = 0;
      noisePhase = 0;
      lastFrameTime = null;
    },
  };
})();
