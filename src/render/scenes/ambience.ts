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
//  - The **lattice**, for loud sections: a regular grid of glowing discs
//    that mostly lives as a sheet — rippling, bending, tumbling, stretched,
//    seen in perspective from a camera that swoops between poses on bar
//    boundaries — but that is really a set of dots free to take any
//    *formation*: one dot, a line, the sheet, a tube, a cube, a tesseract.
//    The reference builds its sheet exactly this way: the sunburst's last
//    dot stretches into a line, the line sweeps round and extrudes the
//    sheet, and at the end the sheet folds back down to a few dots. Every
//    transition here is a leg on that dimensional ladder (see FORM and
//    JOURNEYS), so the sheet always arrives from and leaves through a line
//    or a dot, the way the video's does.
//    A musical hit sends a swell running along one row or column, and the
//    discs inside it balloon and merge into one fat blob.
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
//    that carries most of its own alpha, so it adds softly without breaking
//    the union or piling up where discs crowd. Fog, the row window and the
//    phase crossfade all scale the whole premultiplied vec4 (colour and
//    alpha together) — scaling alpha alone would leave dark rings.
//  - No depth test: same-colour flat discs look identical whichever is in
//    front, so ordering is free and the sheet may fold over itself. The
//    dot formation is every disc drawn on one spot and reads as one disc.
//  - A dot's position is `formation(id)` for two formations blended by a
//    transition progress, with a per-dot stagger (by row, column, radius or
//    a hash) so a formation change sweeps across the lattice — the line
//    peels off into rows — rather than every dot moving at once. Then a
//    4D turn (`flip4`: rotate the sheet's plane into the fourth axis and
//    project with w-perspective — one half swells toward the viewer, the
//    other shrinks, the whole thing passes through a line and re-expands
//    mirrored), then a 3D tumble about the look target. The tesseract
//    formation is a genuine 4D lattice (`latticeDims` factors the dot count
//    into four) spun in two planes and projected the same way.
//  - **Motion streaks**: the vertex shader evaluates the dot at this frame's
//    animation state and at the previous frame's (`uAnim` / `uAnimPrev`,
//    every animated quantity lives in one array so the same code runs twice)
//    and stretches the sprite into a capsule along its screen-space
//    velocity. That smear is what the reference's fast flips and the line
//    sweep look like; it is not a post pass.
//  - The sheet's height is two travelling sines (amplitudes from the low and
//    mid band levels, phase from the audio-warped flow clock), a slow value
//    noise roll, and quadratic curvature terms from the current pose, which
//    bend the sheet into bowls, ridges and saddles between poses.
//  - The **choreographer** (`createChoreographer`) owns everything animated
//    on the JS side: the camera/curvature/tumble/stretch pose (a new target
//    on a bar boundary while the tempo is locked, on a timer otherwise, eased
//    exponentially so every move is a sweep), the flips (a tumble target a
//    half-turn away, so the sheet turns right over), and the journeys —
//    sequences of formation legs timed in bars, started every few bars, on a
//    section drop, and on the way into and out of the sunburst.
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
//    the default palette) with a hue-preserving chroma push and a touch of
//    white, so another palette recolours the whole scene consistently; the
//    ground is a dark indigo tinted a little by that same colour.
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
const SHEET_HALF = 12.0; // world half-extent of the sheet, both axes
const NEAR = 0.3;
const FOCAL_Y = 1.0 / Math.tan((60 * Math.PI) / 180 / 2);
/** Palette stop the hot colour is taken from: the magenta on Neon. */
const HOT_T = 0.1;
/** Bars between journeys at Transitions 0 and 1. */
const JOURNEY_BARS_RARE = 10;
const JOURNEY_BARS_OFTEN = 3;
/** Seconds per bar assumed while no tempo is locked. */
const FREE_BAR_SEC = 2.0;

export type Rng = () => number;

/** Small deterministic generator so the pulse pool and the choreographer are
 *  testable and a seed reproduces a sequence of poses and journeys. */
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

/** Factors a dot count into `k` lattice sides as balanced as it can be,
 *  exactly when the count allows (so the cube and tesseract formations have
 *  no half-filled layer), otherwise with a product just past the count.
 *  Sides ascending. */
export function latticeDims(n: number, k: number): number[] {
  const count = Math.max(1, Math.floor(n));
  const exact = (m: number, sides: number): number[] | null => {
    if (sides === 1) return [m];
    const ideal = Math.round(Math.pow(m, 1 / sides));
    for (let off = 0; off <= m; off++) {
      for (const a of off === 0 ? [ideal] : [ideal - off, ideal + off]) {
        if (a < 2 || a > m || m % a !== 0) continue;
        const rest = exact(m / a, sides - 1);
        if (rest && Math.max(...rest, a) <= 3 * Math.min(...rest, a)) return [a, ...rest];
      }
      if (ideal - off < 2 && ideal + off > m) break;
    }
    return null;
  };
  const found = exact(count, k);
  if (found) return found.sort((a, b) => a - b);
  const side = Math.ceil(Math.pow(count, 1 / k));
  return new Array(k).fill(side);
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

// ---------------------------------------------------------------------------
// Formations, poses and the choreographer.

/** The formations a dot can be sent to; the value is what the shader
 *  switches on. In ladder order: each is one dimension up from the last. */
export const FORM = { DOT: 0, LINE: 1, SHEET: 2, TUBE: 3, CUBE: 4, TESSERACT: 5 } as const;
/** How a formation change sweeps across the lattice. */
export const STAGGER = { NONE: 0, ROWS: 1, COLS: 2, RADIAL: 3, SCATTER: 4 } as const;

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
  rx: number; // the sheet's own tumble about the look target, radians
  ry: number;
  rz: number;
  sx: number; // stretch of the lattice across
  sz: number; // ...and into the frame
}

/** Floats per pose in the animation array — the field order of poseToArray. */
export const POSE_FLOATS = 16;
/** Animation array layout: the pose, then the ripple clock, the transition
 *  progress and the three 4D angles. The shader reads the same layout. */
export const ANIM = { FLOW: 16, PROGRESS: 17, ROT_XW: 18, ROT_ZW: 19, SPIN: 20 } as const;
export const ANIM_N = 21;
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
  out[11] = p.rx;
  out[12] = p.ry;
  out[13] = p.rz;
  out[14] = p.sx;
  out[15] = p.sz;
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
  rx: 0,
  ry: 0,
  rz: 0,
  sx: 1,
  sz: 1,
};

/** Draws a pose whose every field sits within `range` (0..1) of REST_POSE's
 *  own excursion limits; range 0 is REST_POSE exactly. `flip` (0..1) sets
 *  how far the sheet tumbles: the tilt here, and (in the choreographer) how
 *  often a tumble is a full half-turn. About a third of poses at full range
 *  show only a band of rows. */
export function randomPose(rng: Rng, range: number, flip = 0): Pose {
  const r = Math.max(0, Math.min(1, range));
  const f = Math.max(0, Math.min(1, flip));
  const sym = (scale: number) => (rng() * 2 - 1) * scale * r + 0; // + 0: never a -0 at range 0
  const partial = rng() < 0.3 * r;
  const stretchy = rng() < 0.4 * r;
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
    rx: (rng() * 2 - 1) * 0.5 * f + 0,
    ry: (rng() * 2 - 1) * 0.6 * f + 0,
    rz: (rng() * 2 - 1) * 0.5 * f + 0,
    sx: stretchy ? 0.6 + rng() * 1.1 : 1,
    sz: stretchy ? 0.6 + rng() * 1.1 : 1,
  };
}

export function barsPerPose(drift: number): number {
  const d = Math.max(0, Math.min(1, drift));
  return Math.round(BARS_PER_POSE_SLOW + (BARS_PER_POSE_FAST - BARS_PER_POSE_SLOW) * d);
}

export function freeRunSec(drift: number): number {
  const d = Math.max(0, Math.min(1, drift));
  return FREE_RUN_SEC_SLOW + (FREE_RUN_SEC_FAST - FREE_RUN_SEC_SLOW) * d;
}

export function journeyBars(transitions: number): number {
  const t = Math.max(0, Math.min(1, transitions));
  return Math.round(JOURNEY_BARS_RARE + (JOURNEY_BARS_OFTEN - JOURNEY_BARS_RARE) * t);
}

/** One step of a journey: blend the lattice from one formation to another
 *  over `bars`, sweeping by `stagger`. A leg whose two formations match is a
 *  dwell — used to turn the sheet through the fourth axis (`flip4`) or to
 *  spin the tesseract (`spin`) without moving the dots' formation. */
export interface Leg {
  from: number;
  to: number;
  stagger: number;
  bars: number;
  /** Adds a half-turn to the sheet's 4D rotation in this plane over the leg. */
  flip4?: "xw" | "zw";
  /** Spins the tesseract's two planes through two full turns over the leg. */
  spin?: boolean;
}

const { DOT, LINE, SHEET, TUBE, CUBE, TESSERACT } = FORM;
const { ROWS, COLS, RADIAL, SCATTER } = STAGGER;

/** The journeys the choreographer picks between while the lattice is up.
 *  Every one starts and ends on the sheet. */
export const JOURNEYS: Readonly<Record<string, readonly Leg[]>> = {
  // The reference's own opening, run in full: fold the sheet down to a
  // line, the line down to a dot, then build it back.
  unfold: [
    { from: SHEET, to: LINE, stagger: ROWS, bars: 1 },
    { from: LINE, to: DOT, stagger: COLS, bars: 0.5 },
    { from: DOT, to: LINE, stagger: COLS, bars: 0.5 },
    { from: LINE, to: SHEET, stagger: ROWS, bars: 1 },
  ],
  roll: [
    { from: SHEET, to: TUBE, stagger: ROWS, bars: 1 },
    { from: TUBE, to: TUBE, stagger: ROWS, bars: 1 },
    { from: TUBE, to: SHEET, stagger: ROWS, bars: 1 },
  ],
  stack: [
    { from: SHEET, to: CUBE, stagger: SCATTER, bars: 1 },
    { from: CUBE, to: CUBE, stagger: SCATTER, bars: 1 },
    { from: CUBE, to: SHEET, stagger: SCATTER, bars: 1 },
  ],
  turnX: [{ from: SHEET, to: SHEET, stagger: STAGGER.NONE, bars: 2, flip4: "xw" }],
  turnZ: [{ from: SHEET, to: SHEET, stagger: STAGGER.NONE, bars: 2, flip4: "zw" }],
  tesseract: [
    { from: SHEET, to: TESSERACT, stagger: RADIAL, bars: 1 },
    { from: TESSERACT, to: TESSERACT, stagger: RADIAL, bars: 4, spin: true },
    { from: TESSERACT, to: SHEET, stagger: RADIAL, bars: 1 },
  ],
};

/** The lattice's way in from the sunburst's last dot, and its way back out. */
export const ENTER_LEGS: readonly Leg[] = [
  { from: DOT, to: LINE, stagger: COLS, bars: 0.5 },
  { from: LINE, to: SHEET, stagger: ROWS, bars: 1 },
];
export const LEAVE_LEGS: readonly Leg[] = [
  { from: SHEET, to: LINE, stagger: ROWS, bars: 1 },
  { from: LINE, to: DOT, stagger: COLS, bars: 0.5 },
];

export interface ChoreoOptions {
  drift: number; // Camera drift setting
  range: number; // Camera range setting
  flip: number; // Flip setting
  transitions: number; // Transitions setting
}

export interface ChoreoEvents {
  /** The lattice is appearing (crossfade rising from the sunburst). */
  enter?: boolean;
  /** The lattice is leaving (crossfade falling toward the sunburst). */
  leave?: boolean;
  /** A section drop: start a journey now if nothing is running. */
  drop?: boolean;
}

export interface Choreographer {
  /** Everything animated, ANIM_N floats: the eased pose, then ANIM's slots. */
  readonly anim: Float32Array;
  /** The two formations being blended (equal while idle) and the sweep. */
  formA(): number;
  formB(): number;
  stagger(): number;
  target(): Readonly<Pose>;
  /** The journey in progress, or null. */
  journey(): string | null;
  retarget(range: number, flip: number): void;
  /** Starts a journey by name (ignored while one runs). */
  start(name: string): boolean;
  advance(dt: number, barPhase: number, tempoLock: number, opts: ChoreoOptions, events?: ChoreoEvents): void;
}

export function createChoreographer(rng: Rng = Math.random): Choreographer {
  const anim = new Float32Array(ANIM_N);
  let target: Pose = { ...REST_POSE };
  const targetArr = poseToArray(target);
  poseToArray(target, anim);
  anim[ANIM.PROGRESS] = 0;
  // The tumble's half-turn base: targets are base + tilt, so a flip is a
  // base one half-turn further and the ease carries the sheet right over.
  const baseRot = [0, 0, 0];
  let lastBarPhase = 0;
  let bars = 0;
  let barsSinceJourney = 0;
  let timer = 0;
  let barSec = FREE_BAR_SEC; // estimated from the bar clock while locked
  let formA: number = SHEET;
  let formB: number = SHEET;
  let stag: number = STAGGER.NONE;
  let legs: readonly Leg[] = [];
  let legIndex = 0;
  let legProgress = 0;
  let journeyName: string | null = null;
  let leaving = false;
  let flipBase = [0, 0]; // xw, zw angles the current flip leg started from
  let spinBase = 0;
  let lastJourney = "";
  const names = Object.keys(JOURNEYS);

  function retarget(range: number, flip: number): void {
    target = randomPose(rng, range, flip);
    const f = Math.max(0, Math.min(1, flip));
    // A tumble target a half-turn away, sometimes two, so the sheet flips
    // right over on its way there. Stronger Flip: more often.
    if (rng() < 0.55 * f) {
      const axis = rng() < 0.6 ? 0 : 2;
      baseRot[axis] += (rng() < 0.5 ? 1 : -1) * Math.PI;
    }
    target.rx += baseRot[0];
    target.ry += baseRot[1];
    target.rz += baseRot[2];
    poseToArray(target, targetArr);
    timer = 0;
  }

  function beginLegs(list: readonly Leg[], name: string | null): void {
    legs = list;
    legIndex = 0;
    legProgress = 0;
    journeyName = name;
    const leg = legs[0];
    formA = leg.from;
    formB = leg.to;
    stag = leg.stagger;
    flipBase = [anim[ANIM.ROT_XW], anim[ANIM.ROT_ZW]];
    spinBase = anim[ANIM.SPIN];
  }

  function finishLeg(): void {
    const leg = legs[legIndex];
    formA = leg.to;
    if (leg.flip4 === "xw") anim[ANIM.ROT_XW] = flipBase[0] + Math.PI;
    if (leg.flip4 === "zw") anim[ANIM.ROT_ZW] = flipBase[1] + Math.PI;
    if (leg.spin) anim[ANIM.SPIN] = spinBase + 4 * Math.PI;
    legIndex++;
    if (legIndex < legs.length) {
      const next = legs[legIndex];
      formA = next.from;
      formB = next.to;
      stag = next.stagger;
      legProgress = 0;
      flipBase = [anim[ANIM.ROT_XW], anim[ANIM.ROT_ZW]];
      spinBase = anim[ANIM.SPIN];
    } else {
      formB = formA;
      legs = [];
      legProgress = 0;
      anim[ANIM.PROGRESS] = 0;
      journeyName = null;
      barsSinceJourney = 0;
    }
  }

  function start(name: string): boolean {
    const list = JOURNEYS[name];
    if (!list || legs.length > 0 || leaving || formA !== SHEET) return false;
    beginLegs(list, name);
    lastJourney = name;
    return true;
  }

  function pickJourney(): void {
    const pool = names.filter((n) => n !== lastJourney);
    start(pool[Math.floor(rng() * pool.length) % pool.length]);
  }

  return {
    anim,
    formA: () => formA,
    formB: () => formB,
    stagger: () => stag,
    target: () => target,
    journey: () => journeyName,
    retarget,
    start,
    advance(dt, barPhase, tempoLock, opts, events = {}) {
      const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
      const locked = tempoLock > 0.5;
      let barBoundary = false;
      if (locked) {
        const dPhase = barPhase - lastBarPhase;
        if (dPhase > 0 && step > 0) barSec += (step / dPhase - barSec) * 0.1;
        if (barPhase < lastBarPhase - 0.5) barBoundary = true;
      } else {
        timer += step;
        if (timer >= freeRunSec(opts.drift)) {
          barBoundary = true;
          timer = 0;
        }
        barSec = FREE_BAR_SEC;
      }
      barSec = Math.max(0.4, Math.min(6, barSec));
      lastBarPhase = barPhase;

      if (events.enter) {
        leaving = false;
        beginLegs(ENTER_LEGS, "enter");
      } else if (events.leave && !leaving) {
        leaving = true;
        beginLegs(LEAVE_LEGS, "leave");
      }

      if (barBoundary) {
        bars++;
        barsSinceJourney++;
        // Locked: every few bars. Free-running: the timer already spans the
        // whole interval, so every tick.
        if (!locked || bars % barsPerPose(opts.drift) === 0) retarget(opts.range, opts.flip);
        if (legs.length === 0 && !leaving && barsSinceJourney >= journeyBars(opts.transitions)) pickJourney();
      }
      if (events.drop && legs.length === 0 && !leaving && rng() < 0.7) pickJourney();

      if (legs.length > 0) {
        const leg = legs[legIndex];
        legProgress += step / Math.max(0.05, leg.bars * barSec);
        const p = Math.min(1, legProgress);
        const e = p * p * (3 - 2 * p);
        anim[ANIM.PROGRESS] = p;
        if (leg.flip4 === "xw") anim[ANIM.ROT_XW] = flipBase[0] + Math.PI * e;
        if (leg.flip4 === "zw") anim[ANIM.ROT_ZW] = flipBase[1] + Math.PI * e;
        if (leg.spin) anim[ANIM.SPIN] = spinBase + 4 * Math.PI * e;
        if (legProgress >= 1) {
          finishLeg();
          if (legs.length === 0 && leaving && formA === DOT) {
            // Parked on the dot until the next enter.
          }
        }
      } else {
        anim[ANIM.PROGRESS] = 0;
      }

      const rate = POSE_EASE_RATE * (0.5 + Math.max(0, Math.min(1, opts.drift)));
      const k = 1 - Math.exp(-step * rate);
      for (let i = 0; i < POSE_FLOATS; i++) anim[i] += (targetArr[i] - anim[i]) * k;
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
    key: "stretch",
    label: "Motion streaks",
    description: "How far a fast-moving disc smears along its path -- the streaks of a flip or the line sweeping out the sheet",
    group: "Motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    auto: { tempo: 0.2 },
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
    description: "How often the camera and the sheet move to a new pose (every few bars at 0, every bar at 1) and how briskly they sweep there",
    group: "Camera",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { tempo: 0.2 },
  },
  {
    key: "flip",
    label: "Flip",
    description: "How far the sheet itself tumbles between poses -- low tilts it, high turns it right over",
    group: "Camera",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    auto: { dynamics: 0.2 },
  },
  {
    key: "transitions",
    label: "Transitions",
    description: "How often the lattice leaves the sheet for a journey -- folding down to a line and a dot, rolling into a tube, stacking into a cube, turning through the fourth dimension -- and comes back",
    group: "Camera",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { dynamics: 0.2 },
  },
  {
    key: "cameraRange",
    label: "Camera range",
    description: "How far a pose may stray from the resting three-quarter view: angle, distance, roll, sheet curvature, stretch, and the band of rows shown",
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
uniform vec3 uDims3;                 // cube formation's lattice sides
uniform vec4 uDims4;                 // tesseract formation's lattice sides
uniform int uFormA;                  // the formations being blended, see FORM
uniform int uFormB;
uniform int uStagger;                // how the blend sweeps the lattice, see STAGGER
uniform float uAnim[${ANIM_N}];      // this frame's animation state, see ANIM
uniform float uAnimPrev[${ANIM_N}];  // last frame's, for the motion streaks
uniform vec4 uPulse[${MAX_PULSES}];  // live swells, see PulsePool.data
uniform float uPhaseMix;             // 0 = sunburst, 1 = sheet
uniform float uDtNorm;               // (1/60) / last frame's dt: streak length per 60 Hz frame
out vec2 vQ;        // quad-local coordinate: y in [-1,1], x in +-(1 + vStretch)
out float vStretch; // capsule half-length in units of the quad's half-height
out float vFade;    // fog * row window * phase, applied to the whole premultiplied colour
out float vCore;    // radius of the disc's core as a fraction of the quad's half-height
out float vAa;      // one pixel, in quad-local units
out float vHot;     // swell amount, pushes the colour toward white

#define S ${SHEET_HALF.toFixed(1)}
#define NEAR ${NEAR.toFixed(2)}
#define FOCAL_Y ${FOCAL_Y.toFixed(5)}
#define WINDOW_OPEN ${WINDOW_OPEN.toFixed(2)}
#define PI 3.14159265
#define D4 (S * 2.4)         // distance of the 4D eye along w
#define STAG 0.6             // how much of the transition the sweep spreads over
#define PULSE_SIGMA_ALONG 1.6
#define PULSE_SIGMA_ACROSS 0.55

// The animation state the position functions read; main() points it at
// uAnim and then at uAnimPrev so the same code yields this frame's and the
// last frame's positions.
float A[${ANIM_N}];

vec3 lookTarget() { return vec3(A[4], 0.0, A[5]); }

// The sheet's height: ripples fed by the low and mid bands, a slow noise
// roll, and the pose's curvature (bowl / ridge / saddle).
float sheetHeight(float u, float v) {
  float t = A[${ANIM.FLOW}];
  float h = uWaveHeight * S * 0.16 * (
      (0.4 + 0.9 * uLow) * sin(u * 2.4 + t * 1.3)
    + (0.3 + 0.7 * uMid) * sin(v * 3.1 - t * 1.1 + u * 0.7) * 0.8
    + 1.2 * (vnoise(vec2(u * 1.3 + t * 0.15, v * 1.3 - t * 0.11)) - 0.5));
  return h + S * 0.35 * (A[6] * u * u + A[7] * v * v + A[8] * u * v);
}

// Where a dot sits in each formation. The dot and the line sit on the look
// target so they land mid-frame; the rest are anchored to the world.
vec3 formation(int id, int cell, float u, float v) {
  float sx = A[14], sz = A[15];
  if (id == 0) return lookTarget();
  if (id == 1) return lookTarget() + vec3(u * S * sx, 0.0, 0.0);
  if (id == 2) return vec3(u * S * sx, sheetHeight(u, v), v * S * sz);
  if (id == 3) {
    // The sheet rolled into a tube about the across axis, keeping a little
    // of its ripple so it still breathes.
    float th = v * PI;
    float R = S * 0.5 * sz;
    float h = sheetHeight(u, v) * 0.3;
    return vec3(u * S * sx, (R + h) * sin(th), (R + h) * cos(th));
  }
  if (id == 4) {
    int nx = int(uDims3.x), ny = int(uDims3.y);
    int a = cell - (cell / nx) * nx;
    int q = cell / nx;
    int b = q - (q / ny) * ny;
    int c = q / ny;
    vec3 f = vec3(float(a), float(b), float(c)) / max(uDims3 - 1.0, vec3(1.0)) * 2.0 - 1.0;
    return f * S * vec3(0.7 * sx, 0.55, 0.7 * sz);
  }
  // 5: a 4D lattice, spun in two planes and projected with w-perspective —
  // cells swell as they come toward the 4D eye and shrink as they go away,
  // which is what reads as the lattice turning inside out.
  int nx = int(uDims4.x), ny = int(uDims4.y), nz = int(uDims4.z);
  int a = cell - (cell / nx) * nx;
  int q1 = cell / nx;
  int b = q1 - (q1 / ny) * ny;
  int q2 = q1 / ny;
  int c = q2 - (q2 / nz) * nz;
  int d = q2 / nz;
  vec4 p4 = (vec4(float(a), float(b), float(c), float(d)) / max(uDims4 - 1.0, vec4(1.0)) * 2.0 - 1.0) * S * 0.55;
  float sp = A[${ANIM.SPIN}];
  float c1 = cos(sp), s1 = sin(sp);
  float y = p4.y * c1 - p4.w * s1;
  float w = p4.y * s1 + p4.w * c1;
  p4.y = y; p4.w = w;
  float c2 = cos(sp * 0.5), s2 = sin(sp * 0.5);
  float x = p4.x * c2 - p4.w * s2;
  w = p4.x * s2 + p4.w * c2;
  p4.x = x; p4.w = w;
  float k = D4 / max(D4 - p4.w, 0.2 * S);
  return p4.xyz * k;
}

// The 4D turn: the sheet's plane rotated into the w axis about the look
// target, then projected back with w-perspective. At a quarter turn the
// rotated axis has collapsed to a line; at a half turn the sheet is back,
// mirrored.
vec3 flip4(vec3 p) {
  vec3 l = p - lookTarget();
  float ax = A[${ANIM.ROT_XW}], az = A[${ANIM.ROT_ZW}];
  float w = l.x * sin(ax) + l.z * sin(az);
  l.x *= cos(ax);
  l.z *= cos(az);
  float k = D4 / max(D4 - w, 0.2 * S);
  return lookTarget() + l * k;
}

// The sheet's own tumble about the look target.
vec3 tumble(vec3 p) {
  vec3 l = p - lookTarget();
  float cx = cos(A[11]), sx = sin(A[11]);
  l = vec3(l.x, l.y * cx - l.z * sx, l.y * sx + l.z * cx);
  float cy = cos(A[12]), sy = sin(A[12]);
  l = vec3(l.x * cy + l.z * sy, l.y, -l.x * sy + l.z * cy);
  float cz = cos(A[13]), sz = sin(A[13]);
  l = vec3(l.x * cz - l.y * sz, l.x * sz + l.y * cz, l.z);
  return lookTarget() + l;
}

vec3 worldPos(int cell, float u, float v, float sweep) {
  vec3 pa = formation(uFormA, cell, u, v);
  vec3 p = pa;
  if (uFormB != uFormA) {
    vec3 pb = formation(uFormB, cell, u, v);
    float tl = clamp(A[${ANIM.PROGRESS}] * (1.0 + STAG) - sweep * STAG, 0.0, 1.0);
    float e = tl * tl * (3.0 - 2.0 * tl);
    p = mix(pa, pb, e);
    // A little lift mid-way, so a dot swings to its new place rather than
    // sliding along a straight line.
    p.y += sin(PI * e) * 0.12 * length(pb - pa);
  }
  return tumble(flip4(p));
}

// Camera on an orbit about the look target, rolled about its own axis.
// Returns room-space NDC, the clamped view depth, and the raw view depth.
vec4 project(vec3 world) {
  float yaw = A[0], el = A[1], roll = A[2], dist = A[3];
  vec3 target = lookTarget();
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
  vec2 ndc = vec2(view.x * FOCAL_Y / roomAspect(), view.y * FOCAL_Y) / viewZ;
  return vec4(ndc, viewZ, view.z);
}

vec2 toDevice(vec2 ndc) {
  vec2 uv01 = (ndc * 0.5 + 0.5 - uViewport.xy) / uViewport.zw;
  return uv01 * 2.0 - 1.0;
}

void main() {
  vec2 corner = quadCorner(gl_VertexID);
  int cols = max(int(uGridDims.x), 2);
  int rows = max(int(uGridDims.y), 2);
  int cell = gl_InstanceID;
  int i = cell - (cell / cols) * cols;
  int j = cell / cols;
  float u = float(i) / float(cols - 1) * 2.0 - 1.0;
  float v = float(j) / float(rows - 1) * 2.0 - 1.0;

  float sweep = 0.0;
  if (uStagger == 1) sweep = v * 0.5 + 0.5;
  else if (uStagger == 2) sweep = u * 0.5 + 0.5;
  else if (uStagger == 3) sweep = length(vec2(u, v)) * 0.7071;
  else if (uStagger == 4) sweep = hash21(vec2(float(i), float(j)) * 0.37 + 1.7);

  // This frame's position and last frame's, for the streak.
  A = uAnim;
  vec3 world = worldPos(cell, u, v, sweep);
  vec4 pr = project(world);
  A = uAnimPrev;
  vec4 prPrev = project(worldPos(cell, u, v, sweep));
  A = uAnim;
  float viewZ = pr.z;

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
  float spacing = 2.0 * S / float(cols - 1);
  float rWorld = spacing * 0.2 * uDotSize * breathe * grow;
  float rNdc = rWorld * FOCAL_Y / viewZ;
  // Everything on screen is a fraction of this slice's height (gallery tiles
  // are tiny); the pixel floor keeps the far rows from dissolving.
  vec2 vpPx = max(uResolution * uViewport.zw, vec2(1.0));
  float rPx = max(rNdc * 0.5 * vpPx.y, 1.2);
  float glowExt = 1.0 + 0.9 * uGlow * mix(0.5, 1.0, uDetail);
  float Rpx = rPx * glowExt;
  vCore = 1.0 / glowExt;
  vAa = 1.5 / max(Rpx, 1.0);

  float fog = exp(-pow(viewZ * uFog / 32.0, 2.0));
  bool sheetOnly = uFormA == 2 && uFormB == 2;
  float win = (!sheetOnly || A[10] >= WINDOW_OPEN) ? 1.0 : smoothstep(A[10], A[10] - 0.3, abs(v - A[9]));
  float ahead = smoothstep(NEAR, NEAR + 2.0, pr.w);
  vFade = fog * win * ahead * uPhaseMix;
  vHot = swell;

  if (vFade < 0.003) {
    gl_Position = vec4(3.0, 3.0, 0.0, 1.0); // off screen, degenerate
    return;
  }

  // Streak: the screen-space step since last frame, normalised to a 60 Hz
  // frame, stretches the sprite into a capsule along its direction of
  // travel. Capped so a dot that teleported (a fresh journey) can't smear
  // across the frame.
  vec2 devNow = toDevice(pr.xy);
  vec2 devPrev = toDevice(prPrev.xy);
  vec2 dpx = (devNow - devPrev) * 0.5 * vpPx;
  float travel = length(dpx) * uDtNorm * step(NEAR, prPrev.w);
  float halfLen = min(travel * 0.45 * uStretch, Rpx * 5.0);
  vec2 dir = travel > 1e-4 ? normalize(dpx) : vec2(1.0, 0.0);
  vec2 perp = vec2(-dir.y, dir.x);
  float su = halfLen / Rpx;
  vStretch = su;
  vQ = vec2(corner.x * (1.0 + su), corner.y);
  vec2 offPx = dir * (corner.x * (Rpx + halfLen)) + perp * (corner.y * Rpx);
  gl_Position = vec4(devNow + offPx / (0.5 * vpPx), 0.0, 1.0);
}
`;

const DOT_FRAG = `#version 300 es
precision highp float;
in vec2 vQ;
in float vStretch;
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
  // A capsule: the disc, extended along the streak by vStretch.
  float dx = max(abs(vQ.x) - vStretch, 0.0);
  float d = length(vec2(dx, vQ.y));
  // Opaque core with a one-pixel antialiased rim; a low skirt outside it
  // (see file header on why the blend is "over").
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
uniform float uCometsOut;  // fractional: the last comet is fading in
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
  let formALoc: WebGLUniformLocation | null = null;
  let formBLoc: WebGLUniformLocation | null = null;
  let staggerLoc: WebGLUniformLocation | null = null;
  let baseCols = 0;
  let baseRows = 0;
  let pool: PulsePool | null = null;
  let choreo: Choreographer | null = null;
  const animPrev = new Float32Array(ANIM_N);
  let mix = 0;
  let lastMix = 0;
  let cometSeed = 0;
  let lastTime: number | null = null;
  let lastDt = 1 / 60;
  let dimsFor = -1;
  let dims3: number[] = [1, 1, 1];
  let dims4: number[] = [1, 1, 1, 1];
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
      formALoc = gl.getUniformLocation(dotProg.program, "uFormA");
      formBLoc = gl.getUniformLocation(dotProg.program, "uFormB");
      staggerLoc = gl.getUniformLocation(dotProg.program, "uStagger");
      quadVao = createFullscreenQuad(gl);
      // Both sprite passes have no vertex attributes at all — the quad corner
      // comes from gl_VertexID and the cell from gl_InstanceID — so they draw
      // from an empty VAO rather than the quad's (see file header).
      emptyVao = gl.createVertexArray();
      const dims = gridDimsForQuality(ctx.quality.detail);
      baseCols = dims.cols;
      baseRows = dims.rows;
      pool = createPulsePool();
      choreo = createChoreographer();
      animPrev.set(choreo.anim);
      mix = 0;
      lastMix = 0;
      cometSeed = Math.random() * 100;
      lastTime = null;
      lastDt = 1 / 60;
      dimsFor = -1;
    },

    render(ctx, frame, viewport, palette, anim) {
      if (!bgProg || !dotProg || !cometProg || !quadVao || !emptyVao || !pool || !choreo) return;
      const { gl } = ctx;

      const dt = lastTime === null ? 1 / 60 : Math.max(0, Math.min(0.25, anim.timeSec - lastTime));
      lastTime = anim.timeSec;
      if (dt > 0) lastDt = dt;

      // resolveSceneSetting (not getSceneSetting) for every read below —
      // reading the raw manual value would re-stomp an auto-tuned slider
      // back to manual every frame (see autoTune.ts).
      const mode = resolveSceneSetting(ID, settingFor("mode"));
      const threshold = resolveSceneSetting(ID, settingFor("sunburstThreshold"));
      // A pinned mode still slews there, by feeding the crossfade an
      // intensity that is unambiguously on that side.
      const intensity = mode === 1 ? 2 : mode === 2 ? -1 : anim.sectionIntensity;
      mix = phaseMix(mix, intensity, dt, threshold);
      // The lattice enters from the sunburst's dot and leaves back into one.
      const enter = lastMix < 0.02 && mix >= 0.02;
      const leave = lastMix > 0.98 && mix <= 0.98 && intensity < threshold;
      lastMix = mix;

      const density = resolveSceneSetting(ID, settingFor("sheetDensity"));
      const cols = Math.max(2, Math.round(baseCols * density));
      const rows = Math.max(2, Math.round(baseRows * density));
      if (cols * rows !== dimsFor) {
        dimsFor = cols * rows;
        dims3 = latticeDims(dimsFor, 3);
        dims4 = latticeDims(dimsFor, 4);
      }

      // Swells only while the sheet is up; a section drop fires a burst.
      if (mix > 0.05) {
        if (anim.dropOnset) {
          for (let n = 0; n < 3; n++) pool.trigger(1, cols, rows, true);
        } else if (anim.lowOnset || anim.onset) {
          pool.trigger(0.7 + 0.3 * anim.low, cols, rows);
        }
      }
      pool.tick(dt, resolveSceneSetting(ID, settingFor("swellSpeed")));

      // Last frame's animation state feeds the streaks; then advance.
      animPrev.set(choreo.anim);
      choreo.advance(
        dt,
        anim.barPhase,
        anim.tempoLock,
        {
          drift: resolveSceneSetting(ID, settingFor("cameraDrift")),
          range: resolveSceneSetting(ID, settingFor("cameraRange")),
          flip: resolveSceneSetting(ID, settingFor("flip")),
          transitions: resolveSceneSetting(ID, settingFor("transitions")),
        },
        { enter, leave, drop: anim.dropOnset },
      );
      // The ripple clock: the audio-warped flow phase at Wave speed. Kept in
      // the animation array so the streak sees last frame's phase too.
      choreo.anim[ANIM.FLOW] = anim.flowPhase * resolveSceneSetting(ID, settingFor("waveSpeed"));
      if (enter) animPrev.set(choreo.anim); // no streak from wherever the lattice last parked

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
        dotProg.setV3v("uDims3", dims3);
        dotProg.setV4("uDims4", dims4[0], dims4[1], dims4[2], dims4[3]);
        gl.uniform1i(formALoc, choreo.formA());
        gl.uniform1i(formBLoc, choreo.formB());
        gl.uniform1i(staggerLoc, choreo.stagger());
        dotProg.setFv("uAnim", choreo.anim);
        dotProg.setFv("uAnimPrev", animPrev);
        dotProg.setV4v("uPulse", pool.data);
        dotProg.setF("uPhaseMix", mix);
        dotProg.setF("uDtNorm", 1 / 60 / Math.max(lastDt, 1 / 240));
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
      formALoc = null;
      formBLoc = null;
      staggerLoc = null;
      pool = null;
      choreo = null;
      lastTime = null;
    },
  };
})();
