// Toon Rave -- the cartoon rave prototype (a tiny DJ who slams the giant red
// button at the drop) as a scene. The drawing is the prototype's own vector art:
// art/*.ts build its SVG markup, svgDraw.ts compiles that once and paints it with
// Canvas2D every frame (crisp at any zoom), and this file shows the canvas through
// one small WebGL2 pass (glsl.ts) that also does the impact frame.
//
// Who owns what:
//   - motion.ts: frameAt(c, opts), a pure function of the cycle position c (in
//     beats, drop at 0) -- every pose, light, camera shot and the impact flag.
//   - conductor.ts: turns the app's beat clock (AnimFrame's beats/tempoLock/...)
//     into c. Locked, c follows the beats and re-anchors only at a drop so drops
//     land on bar lines; unlocked, it free-runs. A big-hit trigger (Drop on big
//     hits) may start a new cycle early.
//   - svgDraw.ts: compileScene(markup) once, drawProgram(...) per frame.
//   - this file: settings, the GL objects, and the per-frame wiring.
//
// Settings reshape the frame state after frameAt() rather than being threaded
// through motion.ts, so the prototype's own numbers stay untouched at the defaults:
//   - Energy (key `bounce`) scales each cast rig's matrix between its rest
//     pose (the hero frame's matrix, which is also the markup's own placement)
//     and the moving one, so 1 is exactly the prototype and the hero frame never
//     changes. It sets only how big the moves are; when they happen is the
//     conductor's beat clock, whatever the setting is wired to.
//   - Lights scales the lasers', lamps' and rays' opacity (capped at fully on).
//   - Shake scales the camera's noise shake.
// Energy and Lights are drive settings (drives.ts): Energy swells with its
// signal (BOUNCE_DRIVE_DEPTH below the slider at a 0 reading, the slider at a full
// one; a beat-grid pulse by default), Lights' follows the treble level (0.8x quiet
// to 1.2x loud). With nothing plugged in both rest at exactly their slider value. Drop on big hits is the trigger setting: its drive's edge
// (the section-loudness drop) becomes ConductorInput.dropFired.
//
// DEV only: `command("freeze", {c})` (and `window.__toonrave.freeze(c | null)`)
// pins the cycle position so a test can screenshot an exact frame; freezing also
// neutralises the audio modulation so the picture is repeatable.
import type { FeatureFrame } from "../../../audio/types.ts";
import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../../gl.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import { resolveSceneSetting } from "../../autoTune.ts";
import type { Scene, SceneContext, Viewport } from "../../scene.ts";
import { PASSTHROUGH_DRIVES, type SceneDrives } from "../../drives.ts";
import type { QualityPreset } from "../../quality.ts";
import type { AnimFrame } from "../../animClock.ts";
import type { Palette } from "../../palette.ts";
import { buildSceneSvg } from "./art/scene.ts";
import { buildPostFrag } from "./glsl.ts";
import { compileScene, drawProgram, type DrawProgram, type View } from "./svgDraw.ts";
import { createConductor } from "./conductor.ts";
import { clampCentre, frameFocus } from "./focus.ts";
import { frameAt,FRAME_W, FRAME_H, type FrameState, type Mat, type MotionOpts } from "./motion.ts";

const ID = "toonrave";

/** Cycle length in beats for each Drops option (32, 16 and 8 bars). */
export const DROP_CYCLE_BEATS: readonly (32 | 64 | 128)[] = [128, 64, 32];

/** The widest the drawn canvas gets per quality preset; the picture is vector
 *  art, so a smaller canvas just means softer edges, never missing detail. */
const MAX_CANVAS_WIDTH: Record<QualityPreset, number> = { high: 1920, mid: 1600, low: 1280, floor: 960 };

/** The cycle position of the prototype's hero frame (two animation steps in at
 *  12 steps a beat); the rest pose Energy scales away from. */
export const HERO_C = 2 / 12;

/** How far Energy's signal can pull the moves down below the slider (at a 0 reading). */
const BOUNCE_DRIVE_DEPTH = 0.3;
/** The Lights drive's swing around the slider: 1 - this at a quiet reading, 1 + this at a loud one. */
const LIGHTS_DRIVE_SWING = 0.2;

/** The rigs that make up the cast, the ones Energy moves. Lights, rays, rings,
 *  confetti and the like keep their own motion. */
export const CAST_RIGS: readonly string[] = [
  "dj", "djHead", "djPhones", "guy", "guyHead", "kid", "raver", "pomp", "stick", "crowd0", "crowd1", "crowd2",
];

const SETTINGS: SceneSetting[] = [
  // Motion
  {
    key: "bounce",
    label: "Energy",
    description:
      "How big the cast's dance moves are; the steps themselves follow the BPM. " +
      `The wired signal pumps the size: this value at its peak, ${Math.round((1 - BOUNCE_DRIVE_DEPTH) * 100)}% of it when quiet. ` +
      "0 holds everyone still",
    group: "Motion",
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 1,
    drive: { default: { source: "beat", grid: 2 } },
  },
  {
    key: "drops",
    label: "Drops",
    description: "How often the big drop comes round: the hero button slam, then the gags, the groove and the build back up",
    group: "Motion",
    type: "enum",
    options: ["Every 32 bars", "Every 16 bars", "Every 8 bars"],
    min: 0,
    max: 2,
    step: 1,
    default: 1,
  },
  {
    key: "dropHits",
    label: "Drop on big hits",
    description: "A big drop in the music's loudness starts the next drop early, once at least eight bars have passed since the last",
    group: "Motion",
    type: "boolean",
    min: 0,
    max: 1,
    step: 1,
    default: 1,
    drive: { default: "anim.dropOnset" },
  },
  // Look
  {
    key: "lights",
    label: "Lights",
    description: "How bright the lasers, lamps and rays are",
    group: "Look",
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 1,
    drive: { default: "anim.high" },
  },
  // Camera
  {
    key: "cuts",
    label: "Cuts",
    description: "How often the camera cuts to a close shot in the groove; 0 holds the wide shot",
    group: "Camera",
    min: 0,
    max: 3,
    step: 1,
    default: 2,
  },
  {
    key: "shake",
    label: "Shake",
    description: "How hard the camera shakes on the drop",
    group: "Camera",
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 1,
  },
  // Post
  {
    key: "flash",
    label: "Impact flash",
    description: "The two-colour flash frame on the drop",
    group: "Post",
    type: "boolean",
    min: 0,
    max: 1,
    step: 1,
    default: 1,
  },
];

function settingFor(key: string): SceneSetting {
  const s = SETTINGS.find((x) => x.key === key);
  if (!s) throw new Error(`toonrave: unknown setting ${key}`);
  return s;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

// --- pure helpers (unit-tested under node) ---------------------------------------------------------

/** The rig matrices at the hero frame: the rest pose Energy scales away from. */
let restPose: Record<string, Mat> | null = null;
function getRestPose(): Record<string, Mat> {
  if (!restPose) restPose = frameAt(HERO_C, { cycleBeats: 32, cuts: 0, bpm: 128 }).x;
  return restPose;
}

export interface LookAmounts {
  /** Multiplier on the cast's motion away from its rest pose (1 = the prototype). */
  bounce: number;
  /** Multiplier on the lasers', lamps' and rays' opacity (capped at 1 per element). */
  lights: number;
  /** Multiplier on the camera shake. */
  shake: number;
}

/** Reshapes a frame state by the Energy, Lights and Shake amounts, in place, and
 *  returns it. All three at 1 leave the state exactly as frameAt() made it. */
export function shapeState(state: FrameState, amounts: LookAmounts): FrameState {
  const { bounce, lights, shake } = amounts;
  if (bounce !== 1) {
    const rest = getRestPose();
    for (const id of CAST_RIGS) {
      const m = state.x[id];
      const r = rest[id];
      if (!m || !r) continue;
      state.x[id] = [
        r[0] + (m[0] - r[0]) * bounce,
        r[1] + (m[1] - r[1]) * bounce,
        r[2] + (m[2] - r[2]) * bounce,
        r[3] + (m[3] - r[3]) * bounce,
        r[4] + (m[4] - r[4]) * bounce,
        r[5] + (m[5] - r[5]) * bounce,
      ];
    }
  }
  if (lights !== 1) {
    for (const id in state.o) {
      if (id.indexOf("lampGlow") === 0 || id.indexOf("laser") === 0) state.o[id] = Math.min(1, state.o[id] * lights);
    }
    state.rayOp = Math.min(1, state.rayOp * lights);
  }
  if (shake !== 1) {
    const s = state.camera.shake;
    state.camera = { ...state.camera, shake: { x: s.x * shake, y: s.y * shake, rot: s.rot * shake } };
  }
  return state;
}

/** Where to draw the 1600x900 art on a w x h canvas so the part of it this device
 *  is responsible for (a Panorama slice of the room; the whole art at the full
 *  viewport) covers the canvas: scaled to fill, centred on the slice, the overflow
 *  cropped. A slice that reaches past the art shows the flat background there. */
export function coverView(w: number, h: number, viewport: Viewport, focus?: { x: number; y: number }): View {
  const sw = Math.max(1e-6, viewport.w) * FRAME_W;
  const sh = Math.max(1e-6, viewport.h) * FRAME_H;
  const scale = Math.max(w / sw, h / sh);
  const x0 = viewport.x * FRAME_W;
  const y0 = viewport.y * FRAME_H;
  // With a focus the crop looks at it, kept inside the slice; a crop as big as
  // the slice (16:9 on 16:9) is centred exactly as before.
  const cx = focus ? clampCentre(focus.x, w / scale, x0, sw) : x0 + sw / 2;
  const cy = focus ? clampCentre(focus.y, h / scale, y0, sh) : y0 + sh / 2;
  return { scale, tx: w / 2 - cx * scale, ty: h / 2 - cy * scale };
}

/** The drawn canvas's size for a drawing buffer: capped in width, aspect kept. */
export function canvasSize(bufW: number, bufH: number, preset: QualityPreset): { w: number; h: number } {
  const cap = MAX_CANVAS_WIDTH[preset];
  const w = Math.max(2, Math.min(cap, Math.round(bufW)));
  const h = Math.max(2, Math.round((w * bufH) / Math.max(1, bufW)));
  return { w, h };
}

// --- the scene -----------------------------------------------------------------------------------

// Compiled once per page (filled in init(), never at module scope: tests import
// every scene under node, and compileScene needs the DOM).
let compiled: DrawProgram | null = null;

function createToonRaveScene(): Scene {
  let post: GLProgram | null = null;
  let quadVao: WebGLVertexArrayObject | null = null;
  let tex: WebGLTexture | null = null;
  let texW = 0;
  let texH = 0;
  let texLoc: WebGLUniformLocation | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let c2d: CanvasRenderingContext2D | null = null;

  const conductor = createConductor();
  let lastTime: number | null = null;
  let lastC = 0;
  let lastBars = 0; // dev peek only
  let cycle = 0;
  let reduced = false;
  let frozenC: number | null = null;

  function freeze(c: number | null): void {
    frozenC = c !== null && isFinite(c) ? c : null;
  }

  return {
    id: ID,
    name: "Toon Rave",
    settings: SETTINGS,

    command(name, args) {
      if (name === "freeze") freeze(typeof args.c === "number" ? args.c : null);
      else if (name === "unfreeze") freeze(null);
    },

    init(ctx: SceneContext) {
      const { gl } = ctx;
      conductor.reset();
      lastTime = null;
      lastC = 0;
      cycle = 0;
      frozenC = null;
      reduced = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

      if (!compiled) compiled = compileScene(buildSceneSvg());
      canvas = document.createElement("canvas");
      canvas.width = 2;
      canvas.height = 2;
      c2d = canvas.getContext("2d");
      if (!c2d) throw new Error("toonrave: no 2d canvas context");

      post = createProgram(gl, buildPostFrag());
      texLoc = gl.getUniformLocation(post.program, "uTex");
      quadVao = createFullscreenQuad(gl);
      tex = gl.createTexture();
      if (!tex) throw new Error("toonrave: createTexture failed");
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D, null);
      texW = 0;
      texH = 0;

      if (import.meta.env.DEV && typeof window !== "undefined") {
        (window as unknown as { __toonrave?: unknown }).__toonrave = {
          freeze,
          // the cycle position and the app's bar count, for checking cuts against the bar line
          peek: () => ({ c: lastC, bars: lastBars }),
        };
      }
    },

    render(
      ctx: SceneContext,
      _frame: FeatureFrame,
      viewport: Viewport,
      _palette: Palette,
      anim: AnimFrame,
      drives: SceneDrives = PASSTHROUGH_DRIVES,
    ) {
      if (!post || !quadVao || !tex || !canvas || !c2d || !compiled) return;
      const { gl } = ctx;

      // Own delta from timeSec: the gallery preview hands render() an un-latched anim.
      const dt = lastTime === null ? 1 / 60 : Math.max(0, Math.min(0.25, anim.timeSec - lastTime));
      lastTime = anim.timeSec;

      const bounceAmount = resolveSceneSetting(ID, settingFor("bounce"));
      const dropsIdx = Math.round(resolveSceneSetting(ID, settingFor("drops")));
      const dropHitsOn = resolveSceneSetting(ID, settingFor("dropHits")) >= 0.5;
      const lightsAmount = resolveSceneSetting(ID, settingFor("lights"));
      const cuts = Math.max(0, Math.min(3, Math.round(resolveSceneSetting(ID, settingFor("cuts"))))) as 0 | 1 | 2 | 3;
      const shakeAmount = resolveSceneSetting(ID, settingFor("shake"));
      const flashOn = resolveSceneSetting(ID, settingFor("flash")) >= 0.5;
      const cycleBeats = DROP_CYCLE_BEATS[Math.max(0, Math.min(DROP_CYCLE_BEATS.length - 1, dropsIdx))];

      // Always read the trigger so a grid edge is consumed even when the setting is off.
      const dropEdge = drives.fired("dropHits", anim.dropOnset);
      const out = conductor.step(
        {
          timeSec: anim.timeSec,
          dtSec: dt,
          beats: anim.beats,
          beatPhase: anim.beatPhase,
          barPhase: anim.barPhase,
          tempoLock: anim.tempoLock,
          bpm: anim.tempoBpm,
          dropFired: dropHitsOn && dropEdge,
        },
        cycleBeats,
      );
      if (out.c < lastC - cycleBeats / 2) cycle++;
      lastC = out.c;
      lastBars = anim.beats / 4;
      const frozen = frozenC !== null;
      const c = frozen ? (frozenC as number) : out.c;

      const opts: MotionOpts = { cycleBeats, cuts, bpm: out.bpm, cycle, reduced };
      const state = frameAt(c, opts);

      // Audio modulation of the two drive settings; frozen frames stay repeatable.
      const pulse = frozen ? 1 : clamp01(drives.value("bounce", anim.beatPulse, 1));
      const level = frozen ? 0.5 : clamp01(drives.value("lights", anim.high, 0.5));
      shapeState(state, {
        bounce: bounceAmount * (1 - BOUNCE_DRIVE_DEPTH + BOUNCE_DRIVE_DEPTH * pulse),
        lights: lightsAmount * (1 - LIGHTS_DRIVE_SWING + 2 * LIGHTS_DRIVE_SWING * level),
        shake: shakeAmount,
      });

      // Draw the picture.
      const size = canvasSize(gl.drawingBufferWidth, gl.drawingBufferHeight, ctx.quality.preset);
      if (canvas.width !== size.w || canvas.height !== size.h) {
        canvas.width = size.w;
        canvas.height = size.h;
      }
      drawProgram(c2d, compiled, state, coverView(size.w, size.h, viewport, frameFocus(state.camera)));

      // Upload it. Flipping V is the shader's job, so no pixelStorei changes here.
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (texW !== size.w || texH !== size.h) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
        texW = size.w;
        texH = size.h;
      } else {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      }

      // Post pass to the screen.
      const blendWas = gl.isEnabled(gl.BLEND);
      if (blendWas) gl.disable(gl.BLEND);
      post.use();
      gl.uniform1i(texLoc, 0);
      post.setF("uImpact", flashOn ? state.impact : 0);
      post.setF("uInvert", state.impactInvert ? 1 : 0);
      drawFullscreenQuad(gl, quadVao);

      // The gallery shares one context across scenes: leave nothing bound or switched.
      gl.bindTexture(gl.TEXTURE_2D, null);
      if (blendWas) gl.enable(gl.BLEND);
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      post?.dispose();
      if (quadVao) gl.deleteVertexArray(quadVao);
      if (tex) gl.deleteTexture(tex);
      post = null;
      quadVao = null;
      tex = null;
      texLoc = null;
      texW = 0;
      texH = 0;
      canvas = null;
      c2d = null;
      // The compiled program stays (another host may still show this scene) but
      // its offscreen layers go; they are re-made on demand.
      if (compiled) compiled.layers.length = 0;
    },
  };
}

export const toonraveScene = createToonRaveScene();
