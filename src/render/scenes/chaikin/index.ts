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
import { CHILD_BAND_HI, CHILD_BAND_LO, CHILD_BAND_SOFT, fillSeeds, rowsFor, TEX_H, TEX_W } from "./seeds.ts";

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
    fillSeeds(seedData, { cols: cells, jitter: getSetting("jitter"), zRow: zoom.row, zFrac: zoom.frac, frontU, rows, kicks });
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
  probe: () => ({ front, tau: state.tau, k: rate, z: state.z }),
};
