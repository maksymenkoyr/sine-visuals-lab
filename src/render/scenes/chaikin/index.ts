// Chaikin Curves — a field of black, round-cornered Voronoi cells on white,
// a dot on every seed and faint lines between neighbours, flying outward
// from a white core. Built from `/ref` on "Dann hebt er ab und…" by
// u/BennyPendentes (r/creativecoding, 2020, silent; bundle
// tools/.cache/refs/hebt-ab/, the record is docs/scenes/chaikin.md), whose
// author made it in Processing from Voronoi cells smoothed with Chaikin's
// corner cutting. This is written independently: the seeds are laid out on
// a lattice on the CPU (seeds.ts), the cells computed per pixel on the GPU
// (glsl.ts) and the corners rounded with a tangent circle, not by Chaikin's
// algorithm.
//
// The reference opens on one cell; births fill in from a ring toward the
// centre while the whole field starts to zoom, until the centre is a white
// blob of cells too small to see. launch.ts owns that clock (zoom, birth
// front, relaunch, kick ring buffer); this file resolves settings and drives
// into it, fills the seed texture from it once a frame and uploads both.
//
// Sync, as drives (drives.ts's header) — the reference is silent, so these
// are design choices on top of its measured motion:
// - Speed: the zoom rate rides the overall level (All level), over a floor
//   so a quiet passage still drifts (launch.ts's SPEED_FLOOR).
// - Births: a bass hit stamps a band of extra seeds near the centre that
//   grow in, ride outward with the zoom and merge back within about a
//   second (launch.ts's KICK_LIFE_SEC).
// - Relaunch: a drop pulls the birth front back out, swallowing the inner
//   cells into one central cell and replaying the opening from there.
// - Lines: the lines between seeds brighten with the treble level.
// - Swell: the waves' height rides the overall level (All level).
// - Pull: how strongly the fireflies pull each other into step rides the
//   overall level, squared — scattered in a quiet intro, in step in a loud
//   section.
// - Drop sync: a drop pulls every firefly's clock toward the beat.
//
// Motion on top of the zoom, in two layers mixed by their own amounts
// (Swell, Fireflies): motion.ts steps them, and seeds.ts moves each seed by
// them as it lays it out. Swell keeps the waves on the bar and Fireflies runs
// near the tempo, both off the beat clock (anim.barPhase, anim.beatPhase,
// anim.tempoBpm).
import { createFullscreenScene } from "../../fullscreenScene.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import type { Scene, SceneContext, Viewport } from "../../scene.ts";
import type { GLProgram } from "../../gl.ts";
import { CHAIKIN_FRAG, CHAIKIN_UNIFORMS_GLSL } from "./glsl.ts";
import {
  createLaunchState,
  kickDeltaZ,
  latticeU,
  KICK_SLOTS,
  splitZoom,
  stepLaunch,
  FRONT_START,
  type LaunchState,
} from "./launch.ts";
import { CHILD_BAND_HI, CHILD_BAND_LO, CHILD_BAND_SOFT, fillSeeds, PHASE_COL, rowsFor, TEX_H, TEX_W, type SeedMove } from "./seeds.ts";
import {
  addPop,
  addSwell,
  createFireflies,
  fireOrder,
  resetFireflies,
  stepFireflies,
  swellBar,
  swellFrame,
  SWELL_FLOOR,
  SWELL_GAIN,
  SWELL_REST,
  type Swell,
} from "./motion.ts";

const ID = "chaikin";
const NAME = "Chaikin Curves";

/** The longest frame step that still counts as motion; a hidden-tab gap is
 *  clamped so it can't fling the zoom. */
const MAX_STEP_SEC = 0.5;

export const CHAIKIN_SETTINGS: SceneSetting[] = [
  // Form
  {
    key: "cells",
    label: "Cells",
    description: "How many cells fit around one ring — right makes every cell smaller",
    group: "Form",
    min: 16,
    max: 96,
    step: 1,
    default: 44,
  },
  {
    key: "jitter",
    label: "Jitter",
    description: "How irregular the cells are — 0 lines them up in rings, right scatters them",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.9,
  },
  {
    key: "round",
    label: "Round",
    description: "How much each cell's corners are rounded off",
    group: "Form",
    min: 0,
    max: 3,
    step: 0.05,
    default: 1,
  },
  // Motion
  {
    key: "speed",
    label: "Speed",
    description: "How fast the cells fly outward from the centre",
    group: "Motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    auto: { tempo: 0.3, loudness: 0.2 },
    drive: { default: "anim.energy" },
  },
  {
    key: "births",
    label: "Births",
    description: "How many new cells a hit seeds near the centre — they grow in, fly out and merge back — 0 seeds none",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    auto: { pulse: 0.3, attack: 0.2 },
    drive: { default: "anim.lowOnset" },
  },
  {
    key: "relaunch",
    label: "Relaunch",
    description: "How far a drop pulls the field back into one big cell before it fills in again — 0 never does",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.7,
    drive: { default: "anim.dropOnset" },
  },
  {
    key: "swell",
    label: "Swell",
    description: "How tall the waves rolling across the field are — 0 stills them",
    group: "Motion",
    family: "Swell",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    drive: { default: "anim.energy" },
  },
  {
    key: "swellLength",
    label: "Wavelength",
    description: "How many cells lie between one crest and the next",
    group: "Motion",
    family: "Swell",
    min: 3,
    max: 16,
    step: 0.5,
    default: 7,
  },
  {
    key: "swellArms",
    label: "Arms",
    description: "How the waves wind round the centre — 0 rolls them out in rings, right winds more spiral arms",
    group: "Motion",
    family: "Swell",
    min: 0,
    max: 8,
    step: 1,
    default: 3,
    masterScale: false,
  },
  {
    key: "swellTravel",
    label: "Travel",
    description: "Which way the waves roll, in crests per bar — left rolls them inward, right outward, 0 holds them in place",
    group: "Motion",
    family: "Swell",
    min: -3,
    max: 3,
    step: 1,
    default: 1,
    masterScale: false,
  },
  {
    key: "swellOrder",
    label: "Order",
    description: "How much the cells move as one wave — left gives every cell its own timing",
    group: "Motion",
    family: "Swell",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.85,
  },
  {
    key: "swellPunch",
    label: "Punch",
    description: "How the waves move through each beat — left glides, right surges on the beat and settles",
    group: "Motion",
    family: "Swell",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
  },
  {
    key: "fireflies",
    label: "Fireflies",
    description: "How big each cell's pop is when its own clock comes round — 0 stops them",
    group: "Motion",
    family: "Fireflies",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.7,
  },
  {
    key: "fliesPull",
    label: "Pull",
    description: "How strongly each cell's clock pulls its neighbours' into step — left lets each pop on its own",
    group: "Motion",
    family: "Fireflies",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    drive: { default: "anim.energy" },
  },
  {
    key: "fliesLock",
    label: "Beat lock",
    description: "How strongly the beat pulls every cell's clock — left lets them run free",
    group: "Motion",
    family: "Fireflies",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.1,
  },
  {
    key: "fliesSpread",
    label: "Spread",
    description: "How far the cells' own tempos differ — left gives them all the beat's",
    group: "Motion",
    family: "Fireflies",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
  },
  {
    key: "fliesSnap",
    label: "Drop sync",
    description: "How far a drop pulls every cell's clock into step with the beat — 0 never does",
    group: "Motion",
    family: "Fireflies",
    min: 0,
    max: 1,
    step: 0.05,
    default: 1,
    drive: { default: "anim.dropOnset" },
  },
  // Look
  {
    key: "edges",
    label: "Edges",
    description: "How wide the white gaps between cells are",
    group: "Look",
    min: 0,
    max: 3,
    step: 0.05,
    default: 1,
  },
  {
    key: "dots",
    label: "Dots",
    description: "How big the dot on each cell's seed is — 0 hides them",
    group: "Look",
    min: 0,
    max: 3,
    step: 0.05,
    default: 1,
  },
  {
    key: "lines",
    label: "Lines",
    description: "How bright the lines between neighbouring seeds are — 0 hides them",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    auto: { brightness: 0.35 },
    drive: { default: "anim.high" },
  },
  {
    key: "colours",
    label: "Colours",
    description: "How far the black and white pull toward the app's colour palette",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
  },
];

let state: LaunchState = createLaunchState();
let front = FRONT_START;
let frontU = latticeU(Math.exp(FRONT_START));
let rate = 0;
let lastTimeSec = -1;
let timeSec = 0;
const kickDZ = new Float32Array(KICK_SLOTS);

// Motion (motion.ts): this frame's swell, the fireflies' phases, and what
// step() read for them from the settings and drives, for beforeDraw to use.
let swell: Swell | null = null;
const flies = createFireflies();
const fly = { dt: 0, pull: 0, lock: 0, spread: 0, bpm: 0, beatPhase: 0, snap: 0 };
let popAmount = 0;

function moveSeed(u: number, th: number, g: number, t: number, c: number, out: SeedMove): void {
  if (swell) addSwell(swell, u, th, g, c, out);
  addPop(flies, popAmount, t, c, out);
}

// The seed texture: filled once a frame (or again if a later viewport of
// the same frame needs more rows), uploaded, and bound to unit 0.
const seedData = new Float32Array(TEX_W * TEX_H * 4);
let seedTex: WebGLTexture | null = null;
let seedGl: WebGL2RenderingContext | null = null;
let filledAt = -1;
let filledRows = 0;
let kidLo = 1e9;
let kidHi = -1e9;

function reset(): void {
  state = createLaunchState();
  front = FRONT_START;
  frontU = latticeU(Math.exp(FRONT_START));
  rate = 0;
  lastTimeSec = -1;
  filledAt = -1;
  resetFireflies(flies);
  fly.snap = 0;
}

type Drives = NonNullable<Parameters<Scene["render"]>[5]>;
type Anim = Parameters<Scene["render"]>[4];
type Frame = Parameters<Scene["render"]>[1];

let getSetting: (key: string) => number = (key) => CHAIKIN_SETTINGS.find((s) => s.key === key)?.default ?? 0;

function deltaFor(cells: number): number {
  return (2 * Math.PI) / Math.round(cells);
}

function step(frame: Frame, anim: Anim, get: (key: string) => number, drives: Drives): void {
  const births = get("births");
  const kick =
    births > 0 && drives.fired("births", anim.lowOnset)
      ? births * (0.5 + 0.5 * Math.min(1, drives.value("births", anim.lowPulse)))
      : null;
  const relaunch = get("relaunch");
  const drop = relaunch > 0 && drives.fired("relaunch", anim.dropOnset) ? relaunch : null;
  const out = stepLaunch(state, {
    timeSec: anim.timeSec,
    dtSec: Math.min(anim.dtSec, MAX_STEP_SEC),
    speed: get("speed"),
    speedDrive: drives.value("speed", frame.energy),
    relaunch: drop,
    kick,
  });
  front = out.front;
  frontU = out.frontU;
  rate = out.k;

  const height = get("swell") * (SWELL_FLOOR + SWELL_GAIN * drives.value("swell", frame.energy, SWELL_REST));
  swell =
    height > 0
      ? swellFrame({
          height,
          wavelength: get("swellLength"),
          arms: get("swellArms"),
          travel: get("swellTravel"),
          order: get("swellOrder"),
          bar: swellBar(anim.barPhase, anim.beatPhase, get("swellPunch")),
          delta: deltaFor(get("cells")),
        })
      : null;
  // Pull's drive rests at 1, so with nothing plugged in the slider alone
  // sets the pull.
  const pullDrive = drives.value("fliesPull", frame.energy, 1);
  fly.dt = Math.min(anim.dtSec, MAX_STEP_SEC);
  fly.pull = get("fliesPull") * pullDrive * pullDrive;
  fly.lock = get("fliesLock");
  fly.spread = get("fliesSpread");
  fly.bpm = anim.tempoBpm;
  fly.beatPhase = anim.beatPhase;
  const snap = get("fliesSnap");
  if (snap > 0 && drives.fired("fliesSnap", anim.dropOnset)) fly.snap = Math.max(fly.snap, snap);
}

/** The span of U where a live kick's children can be, padded by two rows —
 *  the shader searches the child rows only inside it. */
function kidSpan(delta: number): void {
  kidLo = 1e9;
  kidHi = -1e9;
  for (let k = 0; k < KICK_SLOTS; k++) {
    if (state.kickAmp[k] <= 0) continue;
    const dz = state.z - state.kickZ[k];
    kidLo = Math.min(kidLo, CHILD_BAND_LO - CHILD_BAND_SOFT + dz - 2 * delta);
    kidHi = Math.max(kidHi, CHILD_BAND_HI + CHILD_BAND_SOFT + dz + 2 * delta);
  }
  if (kidHi < frontU) {
    kidLo = 1e9;
    kidHi = -1e9;
  }
}

function ensureTexture(gl: WebGL2RenderingContext): WebGLTexture | null {
  if (seedTex && seedGl === gl) return seedTex;
  seedGl = gl;
  seedTex = gl.createTexture();
  if (!seedTex) return null;
  gl.bindTexture(gl.TEXTURE_2D, seedTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, TEX_W, TEX_H, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  filledAt = -1;
  return seedTex;
}

function beforeDraw(ctx: SceneContext, prog: GLProgram, viewport: Viewport): void {
  const { gl } = ctx;
  const tex = ensureTexture(gl);
  if (!tex) return;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const cells = getSetting("cells");
  // The room's farthest point from the centre, in half-heights.
  const roomAspect = gl.drawingBufferWidth / Math.max(viewport.w, 1e-4) / (gl.drawingBufferHeight / Math.max(viewport.h, 1e-4));
  const rows = rowsFor(Math.hypot(roomAspect, 1), cells);
  if (filledAt !== timeSec || rows > filledRows) {
    const zoom = splitZoom(state.z, deltaFor(cells));
    const kicks = { dz: kickDeltaZ(state, kickDZ), age: state.kickAge, amp: state.kickAmp };
    // The fireflies step once a frame; a later viewport that needs more rows
    // only brings the new rows in.
    popAmount = getSetting("fireflies");
    if (popAmount > 0) {
      const newFrame = filledAt !== timeSec;
      stepFireflies(flies, {
        ...fly,
        dtSec: newFrame ? fly.dt : 0,
        snap: newFrame ? fly.snap : 0,
        rows,
        cols: Math.min(Math.round(cells), PHASE_COL),
        zRow: zoom.row,
      });
      if (newFrame) fly.snap = 0;
    }
    const move = swell || popAmount > 0 ? moveSeed : undefined;
    fillSeeds(seedData, { cols: cells, jitter: getSetting("jitter"), zRow: zoom.row, zFrac: zoom.frac, frontU, rows, kicks, move });
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TEX_W, TEX_H, gl.RGBA, gl.FLOAT, seedData);
    filledAt = timeSec;
    filledRows = rows;
  }
  gl.uniform1i(gl.getUniformLocation(prog.program, "uSeeds"), 0);
  gl.uniform1f(gl.getUniformLocation(prog.program, "uRows"), filledRows);
  gl.uniform1f(gl.getUniformLocation(prog.program, "uKidLo"), kidLo);
  gl.uniform1f(gl.getUniformLocation(prog.program, "uKidHi"), kidHi);
}

const inner = createFullscreenScene(ID, NAME, CHAIKIN_FRAG, {
  settings: CHAIKIN_SETTINGS,
  extraUniformDecls: CHAIKIN_UNIFORMS_GLSL,
  onInit: reset,
  extraUniforms: (frame, anim, get, drives) => {
    getSetting = get;
    timeSec = anim.timeSec;
    // A room's several viewports render the same frame more than once —
    // the clock steps once per frame.
    if (anim.timeSec !== lastTimeSec) {
      step(frame, anim, get, drives);
      lastTimeSec = anim.timeSec;
    }
    const delta = deltaFor(get("cells"));
    kidSpan(delta);
    return {
      uZFrac: splitZoom(state.z, delta).frac,
      uFront: frontU,
    };
  },
  beforeDraw,
  onDispose: (ctx) => {
    if (seedTex) ctx.gl.deleteTexture(seedTex);
    seedTex = null;
    seedGl = null;
  },
});

export const chaikinScene: Scene = {
  ...inner,
  probe: () => ({ front, tau: state.tau, k: rate, z: state.z, sync: fireOrder(flies) }),
};
