// Code Rain -- a 3D field of falling glyph columns that the camera glides
// through, with a dancer drawn in glyphs among them. Built from a measured
// reference (docs/scenes/coderain.md has the record: the bundle, the numbers,
// and why each choice was made). glyphs.ts draws the glyph set and its
// atlas, figure.ts poses the dancer (the Dancers scene's rig, reused),
// glsl.ts draws both; this file is the wiring: settings, drives, the camera,
// the fall clock, the burst ring and the draws.
//
// The rain: one instanced, camera-facing vertical quad per column, on a
// jittered grid that wraps around the camera (FIELD world units square), so
// the field never ends. Glyphs are fixed in their cells; a bright head steps
// down each column lighting a trail behind it (glsl.ts's RAIN_FRAG). Heads
// fall on one fall clock integrated here, in rows, so a speed change never
// makes a head jump.
//
// Sync mapping (drives, not fixed couplings -- see drives.ts's header). The
// reference syncs to nothing (a hand-flown camera over a soundtrack), so
// these are this scene's own choices:
// - Rush: how far the overall level speeds the fall up or slows it, centred
//   on a mid reading (All level is auto-gained, so it sits mid-range).
// - Downpour: on a bass hit, a share of the columns starts a fresh, brighter
//   head at the top of the view (the burst ring, BURST_SLOTS deep).
// - Hit glow: the heads flare on a bass hit.
// - Turn: on a drop, the camera swings to a new heading, smoothly (the
//   reference has no hard cuts; neither does this).
// The glide forward and a slow wander of the heading run on time.
//
// Time: this scene's own delta of anim.timeSec -- the gallery preview hands
// render() an un-latched anim, so anim.dtSec is not used (as swarm, coil).
import { createProgram, type GLProgram } from "../../gl.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import { resolveSceneSetting } from "../../autoTune.ts";
import type { Scene, SceneContext } from "../../scene.ts";
import { PASSTHROUGH_DRIVES } from "../../drives.ts";
import { paletteVecs, PALETTE_RAMP_STOPS } from "../../palette.ts";
import type { QualityPreset } from "../../quality.ts";
import { pinAsset } from "../../../pinnedAssets.ts";
import clipsUrl from "../dancers/clips.bin?url";
import { decodeClipLibrary } from "../dancers/clipFormat.ts";
import { ATLAS_PX, buildGlyphAtlas } from "./glyphs.ts";
import { createFigure, FIGURE_HEIGHT, type Figure } from "./figure.ts";
import { BURST_SLOTS, FIGURE_FRAG, FIGURE_VERT, RAIN_FRAG, RAIN_VERT } from "./glsl.ts";

const ID = "coderain";

// Shared with the Dancers scene: pinAsset keys by URL, so this is the same
// pinned copy (src/pinnedAssets.ts).
const clips = pinAsset(clipsUrl);

/** Vertical field of view. */
const FOV_Y = (60 * Math.PI) / 180;
const NEAR = 0.05;
const FAR = 300;
/** Glyph cell width at Glyph size 1, world units -- the unit the rest of
 *  the geometry is measured in. */
const GLYPH_W = 0.24;
/** Row pitch over glyph width (measured on the reference: 1.0-1.17). */
const CELL_ASPECT = 1.1;
/** The grid's wrap period, world units. Sized from the reference's glyph
 *  widths (median 7 px, 90th pct 17, 99th 48 at 720p): with columns spread
 *  evenly over the ground, those percentiles put the farthest visible
 *  column ~127 glyph widths away at this field of view. */
const FIELD = 76;
/** Columns per side of the grid, by quality preset. */
const TIER_GRID: Record<QualityPreset, number> = { high: 40, mid: 34, low: 28, floor: 22 };
/** Rows a second at Fall speed 1 (a column's own factor spreads it 0.55-1.45x;
 *  measured heads fell ~14-27 rows/s). */
const FALL_BASE = 18;
/** Mean trail length, rows, at Trail length 1 (measured 12-25 glyphs). */
const TRAIL_BASE = 18;
/** Mean gap between trails down a column, in trail lengths. */
const GAP = 4;
/** Glyph swaps per second per cell at Flicker 1. */
const FLICKER_BASE = 0.35;
/** How far Rush moves the fall speed per unit of level above or below the
 *  middle, at Rush 1. */
const RUSH_GAIN = 1.4;
/** The share of the columns a full-height hit starts a burst in, at Downpour 1. */
const DOWNPOUR_SHARE = 0.3;
/** Two bursts closer together than this merge into the first. */
const BURST_MIN_GAP_SEC = 0.15;
/** Head brightness lift at Hit glow 1 on a full hit: x (1 + this). */
const HEAD_LIFT = 1.6;
/** Glide speed at Glide 1, world units/s (~3 glyph widths a second). */
const GLIDE_BASE = 0.9;
/** A drop turns the heading by this much at Turn 1, plus up to TURN_SPREAD. */
const TURN_MIN = (60 * Math.PI) / 180;
const TURN_SPREAD = (60 * Math.PI) / 180;
const TURN_TAU = 1.4;
/** The slow wander of the heading and the pitch, radians, and its periods. */
const WANDER_YAW = (10 * Math.PI) / 180;
const WANDER_PITCH = (4 * Math.PI) / 180;
/** Tilt 1 looks this far up. */
const TILT_MAX = (35 * Math.PI) / 180;
/** The depth fade, world units: columns fade in from NEAR_FADE[0] to [1]
 *  (so none passes through the camera), are full from there out to
 *  FAR_FADE[0], and gone by FAR_FADE[1] (inside FIELD / 2, so the wrap never
 *  shows). Matched to the reference's glyph widths: its 99th percentile
 *  (48 px at 720p) puts the nearest columns ~3.5 units away, and its count
 *  of thin far strips falls well short of an even field's past ~20 units. */
const NEAR_FADE = [1.4, 2.6] as const;
const FAR_FADE = [20, 36] as const;
/** The figure: how far ahead of the camera, how many world units per rig
 *  metre, how slowly it follows the camera's turns, and its glyph cell. */
const FIG_DIST = 7;
const FIG_SCALE = 2.5;
const FIG_FOLLOW_TAU = 2.6;
const FIG_CELL = FIGURE_HEIGHT / 72;
const FIG_WIDTH = 2.4;
/** The classic look (sRGB): the head and the trail from the head's side to
 *  the tail, as measured on the reference (head ~#99b379, near the head
 *  ~#4faa1d, the tail ~#1d3a10 -- glyph-edge averages, so the cores here
 *  sit a little brighter). */
const GREEN = {
  head: [0.66, 1.0, 0.5],
  trail: [0.38, 0.88, 0.16],
  tail: [0.1, 0.26, 0.05],
  figure: [0.86, 1.0, 0.8],
} as const;
const SEED = 20261005;

const SETTINGS: SceneSetting[] = [
  // Form
  {
    key: "density",
    label: "Density",
    description: "How many columns fill the space — right is a thicker downpour",
    group: "Form",
    min: 0.1,
    max: 1,
    step: 0.05,
    default: 0.32,
  },
  {
    key: "glyphSize",
    label: "Glyph size",
    description: "How big the glyphs are",
    group: "Form",
    min: 0.5,
    max: 2,
    step: 0.05,
    default: 1,
  },
  {
    key: "trail",
    label: "Trail length",
    description: "How many glyphs stay lit behind each falling head",
    group: "Form",
    min: 0.3,
    max: 2.5,
    step: 0.05,
    default: 1,
  },
  {
    key: "figure",
    label: "Figure",
    description: "How bright the dancer made of glyphs is — 0 hides it",
    group: "Form",
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 0.8,
  },
  // Motion
  {
    key: "fall",
    label: "Fall speed",
    description: "How fast the heads fall down the columns",
    group: "Motion",
    min: 0.1,
    max: 2.5,
    step: 0.05,
    default: 1,
  },
  {
    key: "rush",
    label: "Rush",
    description: "How much the music speeds the rain up when it's loud and slows it when it's quiet",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    drive: { default: "anim.energy" },
  },
  {
    key: "downpour",
    label: "Downpour",
    description: "How many columns a hit starts a fresh, bright head in, from the top of the view",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    drive: { default: "anim.lowOnset", hit: { reactionLabel: "downpour" } },
  },
  {
    key: "flicker",
    label: "Flicker",
    description: "How often the glyphs change into other glyphs",
    group: "Motion",
    min: 0,
    max: 3,
    step: 0.05,
    default: 1,
  },
  // Look
  {
    key: "brightness",
    label: "Brightness",
    description: "How bright the rain is",
    group: "Look",
    min: 0.3,
    max: 2,
    step: 0.05,
    default: 1,
  },
  {
    key: "hitGlow",
    label: "Hit glow",
    description: "How much the falling heads flare on a hit",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    drive: { default: "anim.lowOnset" },
  },
  {
    key: "colour",
    label: "Colour",
    description: "Green like the film, or the room's palette",
    group: "Look",
    type: "enum",
    options: ["Green", "Palette"],
    min: 0,
    max: 1,
    step: 1,
    default: 0,
  },
  // Camera
  {
    key: "glide",
    label: "Glide",
    description: "How fast the camera drifts forward through the columns",
    group: "Camera",
    min: 0,
    max: 3,
    step: 0.05,
    default: 1,
  },
  {
    key: "turn",
    label: "Turn",
    description: "How far the camera swings round to a new heading on a drop",
    group: "Camera",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    drive: { default: "anim.dropOnset", hit: { reactionLabel: "turn" } },
  },
  {
    key: "tilt",
    label: "Tilt",
    description: "Where the camera looks — left looks down, right looks up into the rain",
    group: "Camera",
    min: -0.5,
    max: 1,
    step: 0.05,
    default: 0.25,
  },
];

function settingFor(key: string): SceneSetting {
  const s = SETTINGS.find((x) => x.key === key);
  if (!s) throw new Error(`coderain: unknown setting ${key}`);
  return s;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** A small deterministic generator for the grid's jitter and seeds. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Per column: base x, base z (in [0, FIELD)), its share for the Density
 *  cut, and its speed factor. */
export function buildColumns(grid: number, seed = SEED): Float32Array {
  const rng = mulberry32(seed);
  const out = new Float32Array(grid * grid * 4);
  const cell = FIELD / grid;
  for (let j = 0; j < grid; j++) {
    for (let i = 0; i < grid; i++) {
      const k = (j * grid + i) * 4;
      out[k] = (i + 0.5 + (rng() - 0.5) * 0.9) * cell;
      out[k + 1] = (j + 0.5 + (rng() - 0.5) * 0.9) * cell;
      out[k + 2] = rng();
      out[k + 3] = 0.55 + 0.9 * rng();
    }
  }
  return out;
}

function rampAt(ramp: Float32Array, t: number): [number, number, number] {
  const x = clamp01(t) * (PALETTE_RAMP_STOPS - 1);
  const i = Math.min(PALETTE_RAMP_STOPS - 2, Math.floor(x));
  const f = x - i;
  return [0, 1, 2].map((c) => ramp[i * 3 + c] * (1 - f) + ramp[(i + 1) * 3 + c] * f) as [number, number, number];
}

function createCodeRainScene(): Scene {
  let rainProg: GLProgram | null = null;
  let figProg: GLProgram | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  let colBuf: WebGLBuffer | null = null;
  let emptyVao: WebGLVertexArrayObject | null = null;
  let atlas: WebGLTexture | null = null;
  let grid = 0;
  let figure: Figure | null = null;
  let libraryRequested = false;

  // Camera and clocks.
  let lastTime: number | null = null;
  let camX = 0;
  let camZ = 0;
  let yaw = 0;
  let yawTarget = 0;
  let figYaw = 0;
  let fallClock = 0;
  let wanderTime = 0;
  const rng = mulberry32(SEED ^ 0x9e3779b9);

  // The burst ring: per slot (fall clock at start, share, id, start time).
  const bursts = new Float32Array(BURST_SLOTS * 4);
  const burstUniform = new Float32Array(BURST_SLOTS * 4);
  let burstCount = 0;
  let lastBurstTime = -Infinity;

  function freeGeometry(gl: WebGL2RenderingContext): void {
    if (vao) gl.deleteVertexArray(vao);
    if (colBuf) gl.deleteBuffer(colBuf);
    vao = null;
    colBuf = null;
    grid = 0;
  }

  function buildGeometry(gl: WebGL2RenderingContext, n: number): void {
    freeGeometry(gl);
    const data = buildColumns(n);
    vao = gl.createVertexArray();
    colBuf = gl.createBuffer();
    if (!vao || !colBuf) throw new Error("coderain: column buffer creation failed");
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    grid = n;
  }

  function buildAtlas(gl: WebGL2RenderingContext): void {
    atlas = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, atlas);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, ATLAS_PX, ATLAS_PX, 0, gl.RED, gl.UNSIGNED_BYTE, buildGlyphAtlas());
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  return {
    id: ID,
    name: "Code Rain",
    settings: SETTINGS,

    init(ctx: SceneContext) {
      const { gl } = ctx;
      rainProg = createProgram(gl, RAIN_FRAG, RAIN_VERT);
      figProg = createProgram(gl, FIGURE_FRAG, FIGURE_VERT);
      emptyVao = gl.createVertexArray();
      buildAtlas(gl);
      freeGeometry(gl);
      figure = createFigure();
      // The clip library arrives asynchronously; until it does (or if it
      // can't) the dancer sways. libraryRequested keeps a re-init (context
      // loss, a gallery tile) from fetching twice.
      if (!libraryRequested && typeof window !== "undefined" && typeof fetch === "function") {
        libraryRequested = true;
        const fig = figure;
        clips
          .bytes()
          .then((buf) => fig.setLibrary(decodeClipLibrary(buf)))
          .catch((err: unknown) => {
            libraryRequested = false;
            console.warn("coderain: clip library unavailable", err);
          });
      }
      lastTime = null;
    },

    render(ctx, frame, viewport, palette, anim, drives = PASSTHROUGH_DRIVES) {
      if (!rainProg || !figProg || !atlas || !emptyVao || !figure) return;
      const { gl } = ctx;
      const wantGrid = TIER_GRID[ctx.quality.preset];
      if (grid !== wantGrid) buildGeometry(gl, wantGrid);
      if (!vao) return;

      const resW = gl.drawingBufferWidth;
      const resH = gl.drawingBufferHeight;
      const roomW = resW / Math.max(viewport.w, 1e-4);
      const roomH = resH / Math.max(viewport.h, 1e-4);

      const dt = lastTime === null ? 1 / 60 : Math.max(0, Math.min(0.25, anim.timeSec - lastTime));
      lastTime = anim.timeSec;

      const density = resolveSceneSetting(ID, settingFor("density"));
      const glyphSize = resolveSceneSetting(ID, settingFor("glyphSize"));
      const trailLen = resolveSceneSetting(ID, settingFor("trail"));
      const figureGain = resolveSceneSetting(ID, settingFor("figure"));
      const fall = resolveSceneSetting(ID, settingFor("fall"));
      const rush = resolveSceneSetting(ID, settingFor("rush"));
      const downpour = resolveSceneSetting(ID, settingFor("downpour"));
      const flicker = resolveSceneSetting(ID, settingFor("flicker"));
      const brightness = resolveSceneSetting(ID, settingFor("brightness"));
      const hitGlow = resolveSceneSetting(ID, settingFor("hitGlow"));
      const colour = Math.round(resolveSceneSetting(ID, settingFor("colour")));
      const glide = resolveSceneSetting(ID, settingFor("glide"));
      const turn = resolveSceneSetting(ID, settingFor("turn"));
      const tilt = resolveSceneSetting(ID, settingFor("tilt"));

      // The fall clock, in rows at speed factor 1.
      const level = rush > 0.001 ? drives.value("rush", frame.energy, 0.5) : 0.5;
      const speed = FALL_BASE * fall * Math.max(0.25, 1 + RUSH_GAIN * rush * (level - 0.5));
      fallClock += speed * dt;

      // Bursts: a hit starts fresh heads at the top of the view.
      const downpourFired = drives.fired("downpour", anim.lowOnset);
      if (downpour > 0.001 && downpourFired && anim.timeSec - lastBurstTime > BURST_MIN_GAP_SEC) {
        const height = clamp01(drives.value("downpour", anim.lowPulse));
        const slot = burstCount % BURST_SLOTS;
        bursts[slot * 4] = fallClock;
        bursts[slot * 4 + 1] = DOWNPOUR_SHARE * downpour * Math.max(0.35, height) * drives.hitSize("downpour");
        bursts[slot * 4 + 2] = (burstCount % 65536) + 1;
        bursts[slot * 4 + 3] = anim.timeSec;
        burstCount++;
        lastBurstTime = anim.timeSec;
      }
      for (let s = 0; s < BURST_SLOTS; s++) {
        // A burst fades out once its heads have long left the view, so a
        // slot reused later never cuts a trail off mid-screen.
        const age = anim.timeSec - bursts[s * 4 + 3];
        const alive = bursts[s * 4 + 1] > 0 && age < 6 ? 1 : 0;
        burstUniform[s * 4] = bursts[s * 4];
        burstUniform[s * 4 + 1] = alive * bursts[s * 4 + 1] * clamp01((6 - age) / 2);
        burstUniform[s * 4 + 2] = bursts[s * 4 + 2];
        burstUniform[s * 4 + 3] = 0;
      }
      const headLift = 1 + HEAD_LIFT * hitGlow * clamp01(drives.value("hitGlow", anim.lowPulse));

      // The camera: glide forward along the heading; a drop swings it.
      const turnFired = drives.fired("turn", anim.dropOnset);
      if (turn > 0.001 && turnFired) {
        const amount = turn * Math.max(0.4, clamp01(drives.value("turn", anim.dropPulse))) * drives.hitSize("turn");
        yawTarget += (rng() < 0.5 ? -1 : 1) * (TURN_MIN + TURN_SPREAD * rng()) * amount;
      }
      yaw += (yawTarget - yaw) * (1 - Math.exp(-dt / TURN_TAU));
      wanderTime += dt;
      const heading = yaw + WANDER_YAW * (0.6 * Math.sin((wanderTime * 2 * Math.PI) / 23) + 0.4 * Math.sin((wanderTime * 2 * Math.PI) / 37));
      const pitch = tilt * TILT_MAX + WANDER_PITCH * Math.sin((wanderTime * 2 * Math.PI) / 29);
      figYaw += (heading - figYaw) * (1 - Math.exp(-dt / FIG_FOLLOW_TAU));

      const cp = Math.cos(pitch);
      const fwd = [Math.sin(heading) * cp, Math.sin(pitch), -Math.cos(heading) * cp];
      const right = [Math.cos(heading), 0, Math.sin(heading)];
      const up = [
        right[1] * fwd[2] - right[2] * fwd[1],
        right[2] * fwd[0] - right[0] * fwd[2],
        right[0] * fwd[1] - right[1] * fwd[0],
      ];
      camX += Math.sin(heading) * GLIDE_BASE * glide * dt;
      camZ += -Math.cos(heading) * GLIDE_BASE * glide * dt;
      // The grid is periodic in FIELD, so the camera can be too: keeps the
      // fp32 uploads small however long the glide runs.
      camX -= Math.floor(camX / FIELD) * FIELD;
      camZ -= Math.floor(camZ / FIELD) * FIELD;

      const tanHalf = Math.tan(FOV_Y / 2);
      const aspect = roomW / roomH;
      const depthA = (FAR + NEAR) / (FAR - NEAR);
      const depthB = (-2 * FAR * NEAR) / (FAR - NEAR);
      const sliceX = 2 * viewport.x - 1 + viewport.w;
      const sliceY = 2 * viewport.y - 1 + viewport.h;

      const glyphW = GLYPH_W * glyphSize;
      let head: number[] = [...GREEN.head];
      let trailCol: number[] = [...GREEN.trail];
      let tailCol: number[] = [...GREEN.tail];
      let figCol: number[] = [...GREEN.figure];
      if (colour === 1) {
        const vecs = paletteVecs(palette);
        head = [...vecs.accent].map((c) => 0.35 + 0.65 * c);
        trailCol = rampAt(vecs.ramp, 0.8);
        tailCol = rampAt(vecs.ramp, 0.35);
        figCol = [...vecs.accent].map((c) => 0.5 + 0.5 * c);
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, resW, resH);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, atlas);

      const camera = (prog: GLProgram): void => {
        prog.setV3v("uCamPos", [camX, 0, camZ]);
        prog.setV3v("uRight", right);
        prog.setV3v("uUp", up);
        prog.setV3v("uFwd", fwd);
        prog.setV4("uProj", 1 / (tanHalf * aspect), 1 / tanHalf, depthA, depthB);
        prog.setV4("uSlice", sliceX, sliceY, 1 / Math.max(viewport.w, 1e-4), 1 / Math.max(viewport.h, 1e-4));
        gl.uniform1i(gl.getUniformLocation(prog.program, "uAtlas"), 0);
        prog.setF("uFall", fallClock);
        prog.setF("uTime", anim.timeSec);
        prog.setF("uFlicker", FLICKER_BASE * flicker);
      };

      // The figure first: the rain lands over it, as the reference's
      // columns pass in front of its ghosts.
      if (figureGain > 0.001) {
        const f = figure.advance(anim, frame.bpm, dt, 1);
        const figH = FIGURE_HEIGHT * FIG_SCALE;
        const centreY = FIG_DIST * Math.tan(pitch);
        figProg.use();
        camera(figProg);
        figProg.setV3v("uFigOrigin", [camX + Math.sin(figYaw) * FIG_DIST, centreY - figH * 0.5, camZ - Math.cos(figYaw) * FIG_DIST]);
        figProg.setF("uFigScale", FIG_SCALE);
        gl.uniform2f(gl.getUniformLocation(figProg.program, "uFigSize"), FIG_WIDTH, FIGURE_HEIGHT);
        figProg.setV4v("uCaps", f.caps);
        figProg.setFv("uCapR", f.radii);
        figProg.setV3v("uSkull", f.skull);
        figProg.setF("uFigCell", FIG_CELL);
        figProg.setF("uFigGain", figureGain * brightness);
        figProg.setV3v("uFigCol", figCol);
        figProg.setV3v("uTrailCol", trailCol);
        gl.bindVertexArray(emptyVao);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }

      rainProg.use();
      camera(rainProg);
      rainProg.setF("uField", FIELD);
      rainProg.setF("uSpan", FIELD * 0.8);
      rainProg.setF("uGlyphW", glyphW);
      rainProg.setF("uCellH", glyphW * CELL_ASPECT);
      rainProg.setF("uDensity", density);
      rainProg.setF("uTopSlope", Math.tan(Math.min(pitch + FOV_Y / 2, 1.35)));
      rainProg.setV4("uFade", NEAR_FADE[0], NEAR_FADE[1], FAR_FADE[0], FAR_FADE[1]);
      rainProg.setF("uTrail", TRAIL_BASE * trailLen);
      rainProg.setF("uGap", GAP);
      rainProg.setF("uHeadLift", headLift);
      rainProg.setF("uGain", brightness);
      rainProg.setV4v("uBurst", burstUniform);
      rainProg.setV3v("uHeadCol", head);
      rainProg.setV3v("uTrailCol", trailCol);
      rainProg.setV3v("uTailCol", tailCol);
      gl.bindVertexArray(vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, grid * grid);

      // The gallery renders every scene into one shared context each tick --
      // must not leak blend state, a bound VAO or the atlas onto the next tile.
      gl.bindVertexArray(null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.disable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ZERO);
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      freeGeometry(gl);
      if (emptyVao) gl.deleteVertexArray(emptyVao);
      if (atlas) gl.deleteTexture(atlas);
      emptyVao = null;
      atlas = null;
      rainProg?.dispose();
      figProg?.dispose();
      rainProg = null;
      figProg = null;
    },
  };
}

export const codeRainScene = createCodeRainScene();
