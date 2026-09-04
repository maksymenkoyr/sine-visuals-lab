import { NUM_BANDS } from "../../audio/types.ts";
import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../gl.ts";
import { PALETTE_GLSL } from "../palette.ts";
import type { SceneSetting } from "../sceneSettings.ts";
import type { SignalLink } from "../signals.ts";
import { resolveSceneSetting } from "../autoTune.ts";
import type { Scene, SceneContext } from "../scene.ts";
import { COMMON_UNIFORMS_GLSL, ROOM_UV_GLSL, SAMPLE_BANDS_GLSL, settingUniformName, uploadCommonUniforms } from "../sceneCommon.ts";

// Ambience: an homage to the visualizers that shipped with the old Windows
// Media Player — one hot colour on a near-black ground, everything a soft,
// flat-shaded glow, nothing lit, nothing textured. Two looks, crossfaded by
// how loud the section is:
//
//  - The **sunburst**, for quiet sections: tapered comets pointing radially
//    out of the frame's centre, round head on the centre side and a tail
//    thinning to a point outward, drifting slowly outward. They arrive one
//    at a time as the section builds; as it approaches the drop they
//    contract into a single disc with thin wavy tendrils and shrink away.
//  - The **dot sheet**, for loud sections: a regular lattice of glowing
//    discs on a sheet that ripples, rolls and bends, seen in perspective from
//    a camera that swoops between poses on bar boundaries. Near dots are
//    big, far ones tiny; a musical hit sends a swell running along one row or
//    column, and the discs inside it balloon and merge into one fat blob.
//
// Design notes on how it's built:
//
//  - Nothing is a point sprite. The swells push a disc to several times the
//    lattice spacing, past what gl.POINTS guarantees for a point size, so
//    both the discs and the comets are **instanced quads** drawn from an
//    empty VAO: the quad corner comes from gl_VertexID and the lattice cell
//    (or comet slot) from gl_InstanceID, the same attribute-less trick
//    chladni.ts uses for its grains. No buffers exist at all.
//  - Discs composite with **premultiplied "over"** blending, not additive.
//    Two same-coloured discs drawn over each other are one flat shape, which
//    is exactly how the reference's merged blobs read; additive overlaps
//    would bloom white. The glow is a low-intensity skirt on the same sprite
//    that carries no alpha, so it adds softly without breaking the union.
//    Fog, the row window and the phase crossfade all scale the whole
//    premultiplied vec4 (colour and alpha together) — scaling alpha alone
//    would leave dark rings around fading discs.
//  - No depth test: same-colour flat discs look identical whichever is in
//    front, so ordering is free and the sheet may fold over itself.
//  - The sheet's height is two travelling sines (amplitudes from the low and
//    mid band levels, phase from the audio-warped flow clock), a slow value
//    noise roll, and quadratic curvature terms from the current camera pose,
//    which is what bends the sheet into bowls, ridges and saddles between
//    poses rather than leaving it a flat carpet.
//  - Camera poses (orbit yaw/elevation/roll/distance, look target, sheet
//    curvature, which band of rows is visible) live in a scheduler on the
//    JS side (`createPoseScheduler`): a new target is drawn on a bar
//    boundary while the tempo is locked, on a timer otherwise, and the live
//    pose eases toward it exponentially so every transition is a sweep, not
//    a cut. Camera drift sets both how often and how fast.
//  - Swells are a small pool of travelling pulses (`createPulsePool`): each
//    is one row or column, a head position in cells, and a strength; the
//    vertex shader sums a Gaussian footprint per live pulse around the head.
//    A bass onset or a broadband beat fires one (through anim's latched
//    edges — see renderLatch.ts — never FeatureFrame.onset directly, which a
//    render-capped tick can drop), with a short refractory so one hit is
//    one swell; a section drop fires a burst.
//  - Disc size is derived in world units from the lattice spacing and
//    projected, so perspective does the near-big/far-small work on its own;
//    a pixel floor keeps the far rows from dissolving, and everything on
//    screen is a fraction of the viewport slice's height rather than a fixed
//    pixel count, so gallery tiles and the governor's render scale can't
//    blow the sprites up or shrink them away.
//  - Colour is the room palette's hot stop (HOT_T, which is the magenta on
//    the default palette) with a hue-preserving chroma push, so another
//    palette recolours the whole scene consistently; the ground is a dark
//    indigo tinted a little by that same colour.
//  - The comets are screen-space 2D, in a square space where the frame's
//    height is 2 units and x is scaled by the room aspect so the burst stays
//    circular. Each comet's angle, drift phase and proportions come from a
//    hash of its slot, so a comet keeps its identity while it lives; the
//    fragment shader draws a round-headed taper as a signed distance, with a
//    wobble along the tail that ramps up as the burst contracts.
//  - dt comes from anim.timeSec deltas (clamped) rather than anim.dtSec: the
//    gallery's preview path hands render() an un-latched anim, and the delta
//    form behaves in both hosts (same as storm.ts and meshGrid.ts).
const ID = "ambience";

export const MAX_PULSES = 8;
export const MAX_COMETS = 32;
/** Floats per pose in the uniform array — the field order of poseToArray. */
export const POSE_FLOATS = 11;
/** Seconds after an accepted swell during which another hit is folded into it. */
export const PULSE_REFRACTORY_SEC = 0.12;
const PULSE_SPEED = 14; // cells per second at Swell speed 1
/** Cells of run-in before the first cell and run-out after the last, so a
 *  swell fades in from off the sheet and out past its far edge. */
export const PULSE_TAIL = 3;
/** Half-width of the hysteresis band around Sunburst threshold. */
export const SHEET_HYSTERESIS = 0.1;
const SHEET_RISE_RATE = 2.5; // per second: the sheet arrives quickly at a drop
const SHEET_FALL_RATE = 0.7; // per second: and dissolves slowly when the section quietens
const FREE_RUN_SEC_SLOW = 8; // seconds per pose with no tempo lock, Camera drift 0
const FREE_RUN_SEC_FAST = 2.5; // ...and at Camera drift 1
const BARS_PER_POSE_SLOW = 4;
const BARS_PER_POSE_FAST = 1;
const POSE_EASE_RATE = 0.9; // per second at Camera drift 0.5
const SHEET_HALF_W = 12.0; // world half-extent of the sheet across
const SHEET_HALF_D = 12.0; // ...and into the frame
const NEAR = 0.3;
const FOCAL_Y = 1.0 / Math.tan((60 * Math.PI) / 180 / 2);
/** Palette stop the hot colour is taken from: the magenta on Neon. */
const HOT_T = 0.1;

export type Rng = () => number;

/** Small deterministic generator so the pulse pool and pose scheduler are
 *  testable and a seed reproduces a sequence of poses. */
export function createRng(seed: number): Rng {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lattice size for the quality detail proxy (see quality.ts). Both
 *  dimensions are non-increasing as quality drops. Sheet density multiplies
 *  these per frame — there is no buffer to rebuild. */
export function gridDimsForQuality(quality: number): { cols: number; rows: number } {
  if (quality >= 0.9) return { cols: 40, rows: 28 };
  if (quality >= 0.65) return { cols: 36, rows: 24 };
  if (quality >= 0.35) return { cols: 30, rows: 20 };
  return { cols: 24, rows: 16 };
}

export interface PulsePool {
  /** vec4 per slot, uploaded as uPulse: axis (0 = along a row, 1 = along a
   *  column), line index, head position in cells, strength (0 = free). */
  readonly data: Float32Array;
  live(): number;
  /** Starts a swell on a random line of a cols x rows lattice. Refused
   *  inside the refractory window unless forced. */
  trigger(strength: number, cols: number, rows: number, force?: boolean): boolean;
  /** Advances every live head by `speed` times PULSE_SPEED cells per second
   *  and frees the ones that have run off their line. */
  tick(dt: number, speed: number): void;
}

export function createPulsePool(rng: Rng = Math.random, slots = MAX_PULSES): PulsePool {
  const data = new Float32Array(slots * 4);
  const dir = new Float32Array(slots);
  const len = new Float32Array(slots);
  const age = new Float32Array(slots).fill(-1); // -1 = free
  let sinceLast = Infinity;

  function place(slot: number, strength: number, cols: number, rows: number): void {
    const axis = rng() < 0.5 ? 0 : 1;
    const lines = axis === 0 ? rows : cols;
    const cells = axis === 0 ? cols : rows;
    const d = rng() < 0.5 ? 1 : -1;
    const o = slot * 4;
    data[o] = axis;
    data[o + 1] = Math.min(lines - 1, Math.floor(rng() * lines));
    data[o + 2] = d > 0 ? -PULSE_TAIL : cells - 1 + PULSE_TAIL;
    data[o + 3] = Math.max(0, strength);
    dir[slot] = d;
    len[slot] = cells;
    age[slot] = 0;
  }

  return {
    data,
    live: () => age.reduce((n, a) => n + (a >= 0 ? 1 : 0), 0),
    trigger(strength, cols, rows, force = false) {
      if (!Number.isFinite(strength) || strength <= 0) return false;
      if (!force && sinceLast < PULSE_REFRACTORY_SEC) return false;
      let slot = -1;
      let oldest = -1;
      for (let i = 0; i < slots; i++) {
        if (age[i] < 0) {
          slot = i;
          break;
        }
        if (age[i] > oldest) {
          oldest = age[i];
          slot = i;
        }
      }
      place(slot, strength, Math.max(1, cols), Math.max(1, rows));
      sinceLast = 0;
      return true;
    },
    tick(dt, speed) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      sinceLast += dt;
      const step = Math.max(0, speed) * PULSE_SPEED * dt;
      for (let i = 0; i < slots; i++) {
        if (age[i] < 0) continue;
        age[i] += dt;
        const o = i * 4;
        data[o + 2] += dir[i] * step;
        const head = data[o + 2];
        if (head < -PULSE_TAIL - 0.01 || head > len[i] - 1 + PULSE_TAIL + 0.01) {
          age[i] = -1;
          data[o + 3] = 0;
        }
      }
    },
  };
}

export interface Pose {
  yaw: number; // orbit angle about the sheet's up axis, radians
  el: number; // camera elevation above the sheet plane, radians (low = grazing)
  roll: number; // radians about the view axis
  dist: number; // world units from the look target
  tx: number; // look target on the sheet
  tz: number;
  kx: number; // sheet curvature across (bowl/ridge)
  kz: number; // ...and into the frame
  twist: number; // saddle term
  winCenter: number; // row window centre in the sheet's [-1,1] depth coordinate
  winWidth: number; // row window half-width; past WINDOW_OPEN the whole sheet shows
}

/** Row-window half-width at or beyond which no rows are masked. */
export const WINDOW_OPEN = 1.4;

export function poseToArray(p: Pose, out: Float32Array = new Float32Array(POSE_FLOATS)): Float32Array {
  out[0] = p.yaw;
  out[1] = p.el;
  out[2] = p.roll;
  out[3] = p.dist;
  out[4] = p.tx;
  out[5] = p.tz;
  out[6] = p.kx;
  out[7] = p.kz;
  out[8] = p.twist;
  out[9] = p.winCenter;
  out[10] = p.winWidth;
  return out;
}

/** The pose the scene opens on: a gentle three-quarter view of the whole
 *  sheet. Every random pose is an excursion around it scaled by Camera range. */
export const REST_POSE: Readonly<Pose> = {
  yaw: 0.35,
  el: 0.42,
  roll: 0.0,
  dist: 15,
  tx: 0,
  tz: 0,
  kx: 0,
  kz: 0,
  twist: 0,
  winCenter: 0,
  winWidth: WINDOW_OPEN + 0.2,
};

/** Draws a pose whose every field sits within `range` (0..1) of REST_POSE's
 *  own excursion limits; range 0 is REST_POSE exactly. About a third of
 *  poses at full range show only a band of rows. */
export function randomPose(rng: Rng, range: number): Pose {
  const r = Math.max(0, Math.min(1, range));
  const sym = (scale: number) => (rng() * 2 - 1) * scale * r + 0; // + 0: never a -0 at range 0
  const partial = rng() < 0.3 * r;
  return {
    yaw: REST_POSE.yaw + sym(1.1),
    el: REST_POSE.el + sym(0.32),
    roll: sym(0.5),
    dist: REST_POSE.dist + sym(7),
    tx: sym(4),
    tz: sym(4),
    kx: sym(1.0),
    kz: sym(1.0),
    twist: sym(0.8),
    winCenter: sym(0.5),
    winWidth: partial ? 0.3 + rng() * 0.5 : REST_POSE.winWidth,
  };
}

export interface PoseScheduler {
  /** The eased pose, POSE_FLOATS long, ready for uniform upload. */
  readonly current: Float32Array;
  target(): Readonly<Pose>;
  /** Draws a new target pose. */
  retarget(range: number): void;
  /** Retargets on a bar boundary every few bars while the tempo is locked
   *  (on a timer otherwise), and eases toward the target. Camera drift sets
   *  the bar/timer interval and the ease rate. Returns `current`. */
  advance(dt: number, barPhase: number, tempoLock: number, drift: number, range: number): Float32Array;
}

export function barsPerPose(drift: number): number {
  const d = Math.max(0, Math.min(1, drift));
  return Math.round(BARS_PER_POSE_SLOW + (BARS_PER_POSE_FAST - BARS_PER_POSE_SLOW) * d);
}

export function freeRunSec(drift: number): number {
  const d = Math.max(0, Math.min(1, drift));
  return FREE_RUN_SEC_SLOW + (FREE_RUN_SEC_FAST - FREE_RUN_SEC_SLOW) * d;
}

export function createPoseScheduler(rng: Rng = Math.random): PoseScheduler {
  let target: Pose = { ...REST_POSE };
  const targetArr = poseToArray(target);
  const current = poseToArray(target);
  let lastBarPhase = 0;
  let bars = 0;
  let timer = 0;

  function retarget(range: number): void {
    target = randomPose(rng, range);
    poseToArray(target, targetArr);
    timer = 0;
  }

  return {
    current,
    target: () => target,
    retarget,
    advance(dt, barPhase, tempoLock, drift, range) {
      const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
      if (tempoLock > 0.5) {
        // A wrap of the phase-locked bar clock is a bar boundary.
        if (barPhase < lastBarPhase - 0.5) {
          bars++;
          if (bars % barsPerPose(drift) === 0) retarget(range);
        }
        timer = 0;
      } else {
        timer += step;
        if (timer >= freeRunSec(drift)) retarget(range);
      }
      lastBarPhase = barPhase;
      const rate = POSE_EASE_RATE * (0.5 + Math.max(0, Math.min(1, drift)));
      const k = 1 - Math.exp(-step * rate);
      for (let i = 0; i < POSE_FLOATS; i++) current[i] += (targetArr[i] - current[i]) * k;
      return current;
    },
  };
}

/** The sunburst/sheet crossfade: 0 = all sunburst, 1 = all sheet. Section
 *  intensity above threshold + SHEET_HYSTERESIS picks the sheet, below
 *  threshold - SHEET_HYSTERESIS the sunburst, in between it holds whichever
 *  side it was on; the result slews rather than snaps (fast in, slow out). */
export function phaseMix(prev: number, sectionIntensity: number, dt: number, threshold: number): number {
  const p = Number.isFinite(prev) ? Math.max(0, Math.min(1, prev)) : 0;
  if (!Number.isFinite(sectionIntensity) || !Number.isFinite(dt) || dt <= 0) return p;
  let goal: number;
  if (sectionIntensity > threshold + SHEET_HYSTERESIS) goal = 1;
  else if (sectionIntensity < threshold - SHEET_HYSTERESIS) goal = 0;
  else goal = p > 0.5 ? 1 : 0;
  const rate = goal > p ? SHEET_RISE_RATE : SHEET_FALL_RATE;
  return p + (goal - p) * (1 - Math.exp(-dt * rate));
}

/** How many comets are out (fractional: the last one is fading in) and how
 *  far the burst has contracted toward its final disc, from the section's
 *  progress toward the sheet threshold. */
export function cometState(
  cometCount: number,
  energy: number,
  sectionIntensity: number,
  threshold: number,
): { count: number; contract: number } {
  const max = Math.max(1, Math.min(MAX_COMETS, cometCount));
  const f = Math.max(0, Math.min(1, sectionIntensity / Math.max(threshold, 1e-3)));
  const e = Math.max(0, Math.min(1, energy));
  const fill = Math.max(0, Math.min(1, 0.12 + 0.88 * f * (0.75 + 0.25 * e)));
  const count = Math.max(1, Math.min(max, max * fill));
  const c = Math.max(0, Math.min(1, (f - 0.7) / 0.3));
  return { count, contract: c * c * (3 - 2 * c) };
}

/** With Sunburst pinned, how far along its build the burst sits (0..1) for
 *  a live bass level and broadband energy — see render(). */
export function sunburstProgress(low: number, energy: number): number {
  const l = Number.isFinite(low) ? Math.max(0, Math.min(1, low)) : 0;
  const e = Number.isFinite(energy) ? Math.max(0, Math.min(1, energy)) : 0;
  const level = 0.5 * l + 0.5 * e;
  const f = Math.max(0, Math.min(1, (level - 0.1) / 0.7));
  return f * f * (3 - 2 * f);
}

// Every table below reproduces its plain `default` when all dials sit at
// NEUTRAL (musicProfile.ts) — nothing is hand-biased. `pulse` is kept small:
// it floors near 0.9 on any locked-tempo track (see the Focus snap comment in
// caustics.ts), so a large pulse weight is a constant offset in disguise.
export const MODES: readonly string[] = ["Auto", "Sheet", "Sunburst"];

const SETTINGS: SceneSetting[] = [
  {
    key: "mode",
    label: "Mode",
    description: "Auto crossfades from the sunburst in quiet sections to the dot sheet in loud ones (see Sunburst threshold); Sheet and Sunburst pin one look",
    group: "Form",
    min: 0,
    max: MODES.length - 1,
    step: 1,
    default: 0,
    type: "enum",
    options: MODES,
  },
  {
    key: "sunburstThreshold",
    label: "Sunburst threshold",
    description: "In Auto mode, the section intensity the dot sheet takes over at; the sunburst contracts as the section approaches it",
    group: "Form",
    min: 0.2,
    max: 0.9,
    step: 0.05,
    default: 0.5,
  },
  {
    key: "cometCount",
    label: "Comets",
    description: "How many comets the sunburst grows to at the top of a quiet section's build",
    group: "Form",
    min: 1,
    max: MAX_COMETS,
    step: 1,
    default: 20,
  },
  {
    key: "cometLength",
    label: "Comet length",
    description: "Length of each comet's tail",
    group: "Form",
    min: 0.2,
    max: 2,
    step: 0.05,
    default: 1,
  },
  {
    key: "sheetDensity",
    label: "Sheet density",
    description: "Multiplies the lattice's rows and columns: above 1 is a finer lattice, below 1 a coarser one",
    group: "Form",
    min: 0.5,
    max: 2,
    step: 0.25,
    default: 1,
    advanced: true,
  },
  {
    key: "waveHeight",
    label: "Wave height",
    description: "How far the sheet's ripples lift and drop its rows",
    group: "Motion",
    min: 0,
    max: 3,
    step: 0.05,
    default: 1,
    // Dynamic material rolls harder; bright mixes stay a little calmer.
    auto: { dynamics: 0.3, brightness: -0.15 },
  },
  {
    key: "waveSpeed",
    label: "Wave speed",
    description: "How fast the ripples travel across the sheet",
    group: "Motion",
    min: 0,
    max: 3,
    step: 0.05,
    default: 1,
    // Faster tracks get faster ripples.
    auto: { tempo: 0.25 },
  },
  {
    key: "breathe",
    label: "Breathe",
    description: "How much each disc swells with its own frequency band (bass in the middle columns, treble at the edges)",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { dynamics: 0.25 },
  },
  {
    key: "swell",
    label: "Beat swell",
    description: "How far the discs balloon inside the swell a hit sends along a row or column",
    group: "Motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    // Punchy, transient-heavy material gets bigger blobs.
    auto: { attack: 0.3, pulse: 0.2 },
    reads: ["anim.lowOnset", "feature.onset", "anim.dropOnset"] satisfies readonly SignalLink[],
  },
  {
    key: "swellSpeed",
    label: "Swell speed",
    description: "How fast a swell runs along its line",
    group: "Motion",
    min: 0.3,
    max: 3,
    step: 0.05,
    default: 1,
    advanced: true,
  },
  {
    key: "dotSize",
    label: "Dot size",
    description: "Disc radius as a share of the lattice spacing, before the beat swells",
    group: "Look",
    min: 0.2,
    max: 3,
    step: 0.05,
    default: 1,
    // Bright, sharp-attack material reads well with bolder discs.
    auto: { brightness: 0.2, attack: 0.15 },
  },
  {
    key: "glow",
    label: "Glow",
    description: "Width and strength of the soft halo around every disc and comet",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 0.8,
  },
  {
    key: "fog",
    label: "Fog",
    description: "How quickly the far rows dim into the ground",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
  },
  {
    key: "cameraDrift",
    label: "Camera drift",
    description: "How often the camera and the sheet's curve move to a new pose (every few bars at 0, every bar at 1) and how briskly they sweep there",
    group: "Camera",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { tempo: 0.2 },
  },
  {
    key: "cameraRange",
    label: "Camera range",
    description: "How far a pose may stray from the resting three-quarter view: angle, distance, roll, sheet curvature and the band of rows shown",
    group: "Camera",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    advanced: true,
  },
];

const settingByKey = new Map(SETTINGS.map((s) => [s.key, s]));
function settingFor(key: string): SceneSetting {
  const spec = settingByKey.get(key);
  if (!spec) throw new Error(`ambience: unknown setting "${key}"`);
  return spec;
}

const settingsUniformsGlsl = SETTINGS.map((s) => `uniform float ${settingUniformName(s.key)};`).join("\n");

// Shared by every program: the room aspect, the hot colour and a small
// hash/value-noise family of this scene's own. Requires COMMON_UNIFORMS_GLSL
// and PALETTE_GLSL before it.
const AMBIENCE_GLSL = `
#define HOT_T ${HOT_T.toFixed(3)}

// Aspect of the full room-space canvas, not this device's slice of it.
float roomAspect() {
  return (uResolution.x / max(uViewport.z, 0.0001)) / (uResolution.y / max(uViewport.w, 0.0001));
}

// The one colour everything is drawn in: the palette's hot stop, pushed to
// full chroma without changing its hue so every palette gives a saturated
// glow rather than a pastel.
vec3 hotColor() {
  vec3 c = max(palette(HOT_T, uPalA, uPalB, uPalC, uPalD), 0.0);
  float m = max(max(c.r, c.g), max(c.b, 1e-3));
  c = c / m;
  // A touch of white: the reference's pink is a pale glow, not a laser.
  return mix(pow(c, vec3(0.85)), vec3(1.0), 0.22);
}

float hash11(float p) {
  return fract(sin(p * 127.1 + 311.7) * 43758.5453);
}

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Quad corner for vertex 0..5 of an instanced two-triangle quad, in [-1,1]².
vec2 quadCorner(int vertexId) {
  int c = vertexId - (vertexId / 6) * 6;
  float x = (c == 1 || c == 2 || c == 4) ? 1.0 : -1.0;
  float y = (c == 2 || c == 4 || c == 5) ? 1.0 : -1.0;
  return vec2(x, y);
}
`;

// Opaque ground pass: previewRenderer.ts documents that scenes must cover
// the frame every tick (the gallery never clears). Dark indigo tinted by the
// hot colour, vignetted, breathing a little with overall energy.
const BG_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
${COMMON_UNIFORMS_GLSL}
${settingsUniformsGlsl}
${PALETTE_GLSL}
${ROOM_UV_GLSL}
${AMBIENCE_GLSL}
out vec4 outColor;

void main() {
  vec2 rUv = roomUv(vUv);
  vec2 p = (rUv - 0.5) * vec2(roomAspect(), 1.0);
  float vig = mix(0.55, 1.0, smoothstep(1.3, 0.15, length(p)));
  vec3 ground = (vec3(0.075, 0.03, 0.15) + hotColor() * 0.035) * vig * (1.0 + 0.2 * uEnergy);
  outColor = vec4(ground, 1.0);
}
`;

const DOT_VERT = `#version 300 es
precision highp float;
${COMMON_UNIFORMS_GLSL}
${settingsUniformsGlsl}
${PALETTE_GLSL}
${SAMPLE_BANDS_GLSL}
${AMBIENCE_GLSL}
uniform vec2 uGridDims;              // (cols, rows) of the lattice this frame
uniform float uPose[${POSE_FLOATS}]; // the eased pose, see poseToArray
uniform vec4 uPulse[${MAX_PULSES}];  // live swells, see PulsePool.data
uniform float uPhaseMix;             // 0 = sunburst, 1 = sheet
out vec2 vQ;        // quad-local coordinate, [-1,1]²
out float vFade;    // fog * row window * phase, applied to the whole premultiplied colour
out float vCore;    // radius of the disc's core as a fraction of the quad's half-size
out float vAa;      // one pixel, in quad-local units
out float vHot;     // swell amount, pushes the colour toward white

#define SHEET_HALF_W ${SHEET_HALF_W.toFixed(1)}
#define SHEET_HALF_D ${SHEET_HALF_D.toFixed(1)}
#define NEAR ${NEAR.toFixed(2)}
#define FOCAL_Y ${FOCAL_Y.toFixed(5)}
#define WINDOW_OPEN ${WINDOW_OPEN.toFixed(2)}
#define PULSE_SIGMA_ALONG 1.6
#define PULSE_SIGMA_ACROSS 0.55

void main() {
  vec2 corner = quadCorner(gl_VertexID);
  int cols = max(int(uGridDims.x), 2);
  int rows = max(int(uGridDims.y), 2);
  int cell = gl_InstanceID;
  int i = cell - (cell / cols) * cols;
  int j = cell / cols;
  float u = float(i) / float(cols - 1) * 2.0 - 1.0;
  float v = float(j) / float(rows - 1) * 2.0 - 1.0;

  float yaw = uPose[0], el = uPose[1], roll = uPose[2], dist = uPose[3];
  float tx = uPose[4], tz = uPose[5], kx = uPose[6], kz = uPose[7], twist = uPose[8];
  float winC = uPose[9], winW = uPose[10];

  // The sheet: travelling ripples fed by the low and mid bands, a slow noise
  // roll, and the pose's curvature (bowl / ridge / saddle).
  float t = uFlowPhase * uWaveSpeed;
  float h = uWaveHeight * SHEET_HALF_W * 0.16 * (
      (0.4 + 0.9 * uLow) * sin(u * 2.4 + t * 1.3)
    + (0.3 + 0.7 * uMid) * sin(v * 3.1 - t * 1.1 + u * 0.7) * 0.8
    + 1.2 * (vnoise(vec2(u * 1.3 + t * 0.15, v * 1.3 - t * 0.11)) - 0.5));
  h += SHEET_HALF_W * 0.35 * (kx * u * u + kz * v * v + twist * u * v);
  vec3 world = vec3(u * SHEET_HALF_W, h, v * SHEET_HALF_D);

  // Camera on an orbit about the look target, rolled about its own axis.
  vec3 target = vec3(tx, 0.0, tz);
  vec3 eye = target + vec3(sin(yaw) * cos(el), sin(el), -cos(yaw) * cos(el)) * dist;
  vec3 fwd = normalize(target - eye);
  vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, fwd);
  float cr = cos(roll), sr = sin(roll);
  vec3 right2 = right * cr + up * sr;
  vec3 up2 = up * cr - right * sr;
  vec3 rel = world - eye;
  vec3 view = vec3(dot(rel, right2), dot(rel, up2), dot(rel, fwd));
  float viewZ = max(view.z, NEAR);
  float aspect = roomAspect();
  vec2 ndc = vec2(view.x * FOCAL_Y / aspect, view.y * FOCAL_Y) / viewZ;

  // Radius: a share of the lattice spacing, breathing with this column's
  // band, ballooned by any swell whose footprint covers this cell.
  float band = sampleBands(abs(u));
  float breathe = mix(1.0, 0.7 + 0.8 * band, uBreathe);
  float swell = 0.0;
  for (int k = 0; k < ${MAX_PULSES}; k++) {
    vec4 p = uPulse[k];
    if (p.w <= 0.0) continue;
    float along = p.x < 0.5 ? float(i) : float(j);
    float across = p.x < 0.5 ? float(j) : float(i);
    float da = along - p.z;
    float dl = across - p.y;
    swell += p.w * exp(-da * da / (2.0 * PULSE_SIGMA_ALONG * PULSE_SIGMA_ALONG))
                 * exp(-dl * dl / (2.0 * PULSE_SIGMA_ACROSS * PULSE_SIGMA_ACROSS));
  }
  swell = min(swell, 1.2);
  float grow = 1.0 + uSwell * 5.0 * swell;
  float spacing = 2.0 * SHEET_HALF_W / float(cols - 1);
  float rWorld = spacing * 0.2 * uDotSize * breathe * grow;
  float rNdc = rWorld * FOCAL_Y / viewZ;
  // Everything on screen is a fraction of this slice's height (gallery tiles
  // are tiny); the pixel floor keeps the far rows from dissolving.
  float vpH = max(uResolution.y * uViewport.w, 1.0);
  float rPx = max(rNdc * 0.5 * vpH, 1.2);
  rNdc = rPx / (0.5 * vpH);
  float glowExt = 1.0 + 0.9 * uGlow * mix(0.5, 1.0, uDetail);
  float R = rNdc * glowExt;
  vCore = 1.0 / glowExt;
  vAa = 1.5 / max(rPx * glowExt, 1.0);

  float fog = exp(-pow(viewZ * uFog / 32.0, 2.0));
  float win = winW >= WINDOW_OPEN ? 1.0 : smoothstep(winW, winW - 0.3, abs(v - winC));
  float ahead = smoothstep(NEAR, NEAR + 2.0, view.z);
  vFade = fog * win * ahead * uPhaseMix;
  vHot = swell;
  vQ = corner;

  if (vFade < 0.003) {
    gl_Position = vec4(3.0, 3.0, 0.0, 1.0); // off screen, degenerate
    return;
  }

  // Panorama slice: remap the room-space NDC by this device's viewport, then
  // billboard the quad in device NDC so the disc stays round on screen.
  vec2 uv01 = (ndc * 0.5 + 0.5 - uViewport.xy) / uViewport.zw;
  vec2 dev = uv01 * 2.0 - 1.0;
  dev += corner * vec2(R / aspect / uViewport.z, R / uViewport.w);
  gl_Position = vec4(dev, 0.0, 1.0);
}
`;

const DOT_FRAG = `#version 300 es
precision highp float;
in vec2 vQ;
in float vFade;
in float vCore;
in float vAa;
in float vHot;
${COMMON_UNIFORMS_GLSL}
${settingsUniformsGlsl}
${PALETTE_GLSL}
${AMBIENCE_GLSL}
out vec4 outColor;

void main() {
  float d = length(vQ);
  // Opaque core with a one-pixel antialiased rim; a low skirt outside it
  // that carries no alpha (see file header on why the blend is "over").
  float core = 1.0 - smoothstep(vCore - vAa, vCore + vAa * 0.25, d);
  float skirt = clamp(1.0 - (d - vCore) / max(1.0 - vCore, 1e-3), 0.0, 1.0);
  float halo = uGlow * 0.36 * pow(skirt, 2.2) * (1.0 - core);
  vec3 col = hotColor() * (0.9 + 0.25 * uEnergy);
  col = mix(col, vec3(1.0), 0.15 * min(vHot, 1.0));
  // The skirt carries most of its own alpha: a purely additive skirt piles
  // up where several fogged discs crowd together (a far row under a swell)
  // until the gaps outshine the cores and every disc reads as a ring.
  outColor = vec4(col * (core + halo), core + 0.9 * halo) * vFade;
}
`;

const COMET_VERT = `#version 300 es
precision highp float;
${COMMON_UNIFORMS_GLSL}
${settingsUniformsGlsl}
${PALETTE_GLSL}
${AMBIENCE_GLSL}
uniform float uCometsOut; // fractional: the last comet is fading in
uniform float uContract;   // 0 = comets adrift, 1 = pulled into the final disc
uniform float uPhaseMix;   // 0 = sunburst, 1 = sheet
uniform float uCometSeed;
out vec2 vLocal;    // x along the comet in width units (0 = head centre), y across
out float vLen;     // tail length in width units
out float vAlpha;
out float vSeed;
out float vWob;
out float vAa;

void main() {
  vec2 corner = quadCorner(gl_VertexID);
  int k = gl_InstanceID;
  float seed = hash11(float(k) * 7.31 + uCometSeed);
  float seed2 = hash11(float(k) * 3.77 + 11.0 + uCometSeed);
  float appear = clamp(uCometsOut - float(k), 0.0, 1.0);
  float ang = seed * 6.28318 + uTime * 0.05;
  vec2 dir = vec2(cos(ang), sin(ang));
  vec2 perp = vec2(-dir.y, dir.x);
  // Drift outward and wrap, fading at both ends of the run; the contraction
  // overrides the drift and gathers every head at the centre.
  float trav = fract(seed2 + uTime * 0.03);
  float env = smoothstep(0.0, 0.12, trav) * smoothstep(1.0, 0.8, trav);
  float r = mix(0.12 + 0.62 * trav, 0.05 + 0.03 * seed2, uContract);
  float len = uCometLength * 0.28 * mix(1.0, 0.7, uContract) * (0.8 + 0.4 * seed2);
  float wid = 0.022 * mix(1.0, 1.5, uContract) * (0.8 + 0.4 * seed);
  // The whole burst shrinks away as the sheet takes over.
  float shrink = 1.0 - 0.85 * uPhaseMix;
  r *= shrink;
  len *= shrink;
  wid *= shrink;
  float s = corner.x * 0.5 + 0.5;
  float along = mix(-1.6 * wid, len + 0.5 * wid, s);
  float across = corner.y * wid * 2.2;
  // Square space: the frame is 2 units tall, x scaled by the room aspect so
  // the burst stays circular.
  vec2 sq = dir * (r + along) + perp * across;
  vec2 ndc = vec2(sq.x / roomAspect(), sq.y);
  vec2 uv01 = (ndc * 0.5 + 0.5 - uViewport.xy) / uViewport.zw;
  gl_Position = vec4(uv01 * 2.0 - 1.0, 0.0, 1.0);
  vLocal = vec2(along / wid, across / wid);
  vLen = len / wid;
  vAlpha = appear * mix(env, 1.0, uContract) * (1.0 - uPhaseMix);
  vSeed = seed;
  vWob = uContract;
  float vpH = max(uResolution.y * uViewport.w, 1.0);
  vAa = 1.5 / max(wid * 0.5 * vpH, 1.0);
}
`;

const COMET_FRAG = `#version 300 es
precision highp float;
in vec2 vLocal;
in float vLen;
in float vAlpha;
in float vSeed;
in float vWob;
in float vAa;
${COMMON_UNIFORMS_GLSL}
${settingsUniformsGlsl}
${PALETTE_GLSL}
${AMBIENCE_GLSL}
out vec4 outColor;

void main() {
  float x = vLocal.x;
  float y = vLocal.y;
  // A wobble along the tail: faint while adrift so the head flickers, a
  // full wave once the burst has contracted into its tendrilled disc.
  float wob = (0.1 + 0.4 * vWob) * sin(x * 0.9 + uTime * 5.0 + vSeed * 6.28318) * smoothstep(0.0, 2.0, x);
  y -= wob;
  float sx = clamp(x / max(vLen, 1e-3), 0.0, 1.0);
  // 1 at the head, a point at the tail's tip; the tails thin to tendrils
  // once the heads have gathered into the disc.
  float rad = pow(1.0 - sx, 0.75) * mix(1.0, 0.35, vWob * smoothstep(0.0, 1.5, x));
  float d = x < 0.0 ? length(vec2(x, y)) - 1.0 : abs(y) - rad;
  if (x > vLen) d = 1.0;
  float core = 1.0 - smoothstep(-vAa, vAa, d);
  // The skirt must reach exactly zero at the quad's edges, or its floor
  // shows as a faint box around every comet against the ground.
  float box = smoothstep(2.2, 1.3, abs(vLocal.y)) * smoothstep(vLen + 0.5, vLen, x) * smoothstep(-1.6, -1.2, x);
  float halo = uGlow * 0.3 * exp(-max(d, 0.0) * 1.8) * (1.0 - core) * box;
  vec3 col = hotColor() * (0.9 + 0.25 * uEnergy);
  outColor = vec4(col * (core + halo), core + 0.9 * halo) * vAlpha;
}
`;

export const ambienceScene: Scene = (() => {
  let bgProg: GLProgram | null = null;
  let dotProg: GLProgram | null = null;
  let cometProg: GLProgram | null = null;
  let quadVao: WebGLVertexArrayObject | null = null;
  let emptyVao: WebGLVertexArrayObject | null = null;
  let baseCols = 0;
  let baseRows = 0;
  let pool: PulsePool | null = null;
  let poses: PoseScheduler | null = null;
  let mix = 0;
  let cometSeed = 0;
  let lastTime: number | null = null;
  const bandsBuf = new Float32Array(NUM_BANDS);

  return {
    id: ID,
    name: "Ambience",
    settings: SETTINGS,

    init(ctx: SceneContext) {
      const { gl } = ctx;
      bgProg = createProgram(gl, BG_FRAG);
      dotProg = createProgram(gl, DOT_FRAG, DOT_VERT);
      cometProg = createProgram(gl, COMET_FRAG, COMET_VERT);
      quadVao = createFullscreenQuad(gl);
      // Both sprite passes have no vertex attributes at all — the quad corner
      // comes from gl_VertexID and the cell from gl_InstanceID — so they draw
      // from an empty VAO rather than the quad's (see file header).
      emptyVao = gl.createVertexArray();
      const dims = gridDimsForQuality(ctx.quality.detail);
      baseCols = dims.cols;
      baseRows = dims.rows;
      pool = createPulsePool();
      poses = createPoseScheduler();
      mix = 0;
      cometSeed = Math.random() * 100;
      lastTime = null;
    },

    render(ctx, frame, viewport, palette, anim) {
      if (!bgProg || !dotProg || !cometProg || !quadVao || !emptyVao || !pool || !poses) return;
      const { gl } = ctx;

      const dt = lastTime === null ? 1 / 60 : Math.max(0, Math.min(0.25, anim.timeSec - lastTime));
      lastTime = anim.timeSec;

      // resolveSceneSetting (not getSceneSetting) for every read below —
      // reading the raw manual value would re-stomp an auto-tuned slider
      // back to manual every frame (see autoTune.ts).
      const mode = resolveSceneSetting(ID, settingFor("mode"));
      const threshold = resolveSceneSetting(ID, settingFor("sunburstThreshold"));
      // A pinned mode still slews there, by feeding the crossfade an
      // intensity that is unambiguously on that side.
      const intensity = mode === 1 ? 2 : mode === 2 ? -1 : anim.sectionIntensity;
      mix = phaseMix(mix, intensity, dt, threshold);

      const density = resolveSceneSetting(ID, settingFor("sheetDensity"));
      const cols = Math.max(2, Math.round(baseCols * density));
      const rows = Math.max(2, Math.round(baseRows * density));

      // Swells only while the sheet is up; a section drop fires a burst.
      if (mix > 0.05) {
        if (anim.dropOnset) {
          for (let n = 0; n < 3; n++) pool.trigger(1, cols, rows, true);
        } else if (anim.lowOnset || anim.onset) {
          pool.trigger(0.7 + 0.3 * anim.low, cols, rows);
        }
      }
      pool.tick(dt, resolveSceneSetting(ID, settingFor("swellSpeed")));

      const drift = resolveSceneSetting(ID, settingFor("cameraDrift"));
      const range = resolveSceneSetting(ID, settingFor("cameraRange"));
      const pose = poses.advance(dt, anim.barPhase, anim.tempoLock, drift, range);

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      bgProg.use();
      uploadCommonUniforms(bgProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      drawFullscreenQuad(gl, quadVao);

      // Premultiplied "over": opaque cores union, skirts add (see file header).
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(emptyVao);

      if (mix > 0.005) {
        dotProg.use();
        uploadCommonUniforms(dotProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
        dotProg.setV2("uGridDims", cols, rows);
        dotProg.setFv("uPose", pose);
        dotProg.setV4v("uPulse", pool.data);
        dotProg.setF("uPhaseMix", mix);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, cols * rows);
      }

      if (mix < 0.995) {
        // In Auto the burst tracks the section's climb toward the drop. With
        // Sunburst pinned there is no drop to climb to, so the live level
        // stands in: the burst fills out on a loud passage and contracts
        // on the loudest, then opens up again.
        const progress = mode === 2 ? sunburstProgress(anim.low, frame.energy) * threshold : anim.sectionIntensity;
        const { count, contract } = cometState(
          resolveSceneSetting(ID, settingFor("cometCount")),
          frame.energy,
          progress,
          threshold,
        );
        cometProg.use();
        uploadCommonUniforms(cometProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
        cometProg.setF("uCometsOut", count);
        cometProg.setF("uContract", contract);
        cometProg.setF("uPhaseMix", mix);
        cometProg.setF("uCometSeed", cometSeed);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, Math.ceil(count));
      }

      // The gallery renders every scene into one shared context each tick —
      // must not leak blend state or a bound VAO onto the next tile.
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ZERO);
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      bgProg?.dispose();
      dotProg?.dispose();
      cometProg?.dispose();
      if (quadVao) gl.deleteVertexArray(quadVao);
      if (emptyVao) gl.deleteVertexArray(emptyVao);
      bgProg = null;
      dotProg = null;
      cometProg = null;
      quadVao = null;
      emptyVao = null;
      pool = null;
      poses = null;
      lastTime = null;
    },
  };
})();
