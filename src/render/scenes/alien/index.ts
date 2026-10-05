/**
 * Alien — one grey alien dancing as a glowing green wireframe on black, in
 * three short loops, each a captured dance seen from its own angle. The
 * music pays for the frames: the Play setting's wire (Level by default)
 * sets how fast the loop on screen plays, and silence holds the frame. The
 * Cut setting's wire cuts to another loop each time it rises over the line
 * under its graph. Those two are the whole interface; reel.ts owns both
 * rules and the LOOPS table.
 *
 * Built from parts the repo already has: the dancers' rig, captured clips
 * and clip format (../dancers/), drawn as a real skinned triangle mesh
 * instead of their raymarched skeleton — mesh.ts builds it once from
 * body.ts's distance field, and glsl.ts skins and draws it.
 *
 * Passes per frame (the Gates pattern): the mesh into a sharp target with
 * its own depth buffer, two blur levels for the bloom (as many as
 * `quality.bloomPasses` allows), then a composite to the drawing buffer.
 *
 * DEV: `?loop=<n>` pins one loop of LOOPS (no cuts), and
 * `window.__alien` exposes the reel so a headless run can seek a frame.
 */
import type { Scene, SceneContext, Viewport } from "../../scene.ts";
import type { FeatureFrame } from "../../../audio/types.ts";
import type { Palette } from "../../palette.ts";
import type { AnimFrame } from "../../animClock.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import { PASSTHROUGH_DRIVES, type SceneDrives } from "../../drives.ts";
import { resolveSceneSetting } from "../../autoTune.ts";
import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../../gl.ts";
import { pinAsset } from "../../../pinnedAssets.ts";
import clipsUrl from "../dancers/clips.bin?url";
import { decodeClipLibrary, sampleClip, type Clip } from "../dancers/clipFormat.ts";
import {
  BONE_COUNT,
  CH_LIFT,
  createPose,
  createRigWorld,
  forwardKinematics,
  groundToFloor,
  quatConjugate,
  quatMul,
  quatRotate,
  resetPose,
} from "../dancers/rig.ts";
import { alienMesh, MAX_INFLUENCES } from "./mesh.ts";
import { advanceReel, clipFps, createReel, LOOPS, type Reel } from "./reel.ts";
import { BLUR_FRAG, BLUR_STRIDE, COMPOSITE_FRAG, MESH_FRAG, MESH_VERT } from "./glsl.ts";

// Pinned (src/pinnedAssets.ts): the same clip library the Dancers scene
// pins — pinAsset() hands back that one handle, so it's fetched once.
const clips = pinAsset(clipsUrl);

export const ALIEN_ID = "alien";

/** Scales Level (the Play wire's default) so a loud song reads about 1 —
 *  the dance at its captured speed with Play at its default. */
export const PLAY_GAIN = 2;
/** Where the Cut line starts on its default wire, Bass level: only the
 *  strongest swells of the bass cut (the scene record has the measured
 *  rates). A hit signal peaks near 1 on every hit, so on one any line cuts
 *  on nearly every beat. */
export const CUT_LINE_DEFAULT = 0.85;
/** Framing is set for a 16:9 room; a narrower one pulls the lens back by
 *  the square root of how much narrower, but never past this share. */
const NARROW_FOCAL_MIN = 0.62;
const WIDE_ASPECT = 16 / 9;
/** Bloom gains for the two blur levels. */
const GLOW_A_GAIN = 0.55;
const GLOW_B_GAIN = 1.1;

const SETTINGS: SceneSetting[] = [
  {
    key: "play",
    label: "Play",
    description:
      "The music pays for every frame of the dance: the wired signal times this sets how fast the loop plays. " +
      "At 1 a loud song plays it as it was danced; silence buys no frames, so the alien holds still",
    group: "Motion",
    min: 0,
    max: 3,
    step: 0.05,
    default: 1,
    drive: { default: "feature.level", gain: PLAY_GAIN },
  },
  {
    key: "cut",
    label: "Cut",
    description:
      "On: each time the wired signal rises over the line under its graph, cut to another of the three angles — " +
      "never twice within a couple of seconds. Off: stay on the one on screen",
    group: "Camera",
    type: "boolean",
    min: 0,
    max: 1,
    step: 1,
    default: 1,
    drive: {
      default: "anim.low",
      threshold: {
        default: CUT_LINE_DEFAULT,
        label: "Cuts above",
        hint: "A cut each time the signal rises over this line",
      },
    },
  },
];

const SETTING_BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));

const scratchInv = new Float32Array(4);
const scratchQ = new Float32Array(4);
const scratchMoved = new Float32Array(3);

/** Per-bone skin transform for MESH_VERT: the rotation and translation that
 *  take a bind-pose point to where the bone carries it now. */
export function packSkin(bindPos: Float32Array, bindRot: Float32Array, pos: Float32Array, rot: Float32Array, out: Float32Array): void {
  const inv = scratchInv, q = scratchQ, moved = scratchMoved;
  for (let b = 0; b < BONE_COUNT; b++) {
    quatConjugate(bindRot, b * 4, inv, 0);
    quatMul(rot, b * 4, inv, 0, q, 0);
    quatRotate(q, 0, bindPos[b * 3], bindPos[b * 3 + 1], bindPos[b * 3 + 2], moved, 0);
    out.set(q, b * 8);
    out[b * 8 + 4] = pos[b * 3] - moved[0];
    out[b * 8 + 5] = pos[b * 3 + 1] - moved[1];
    out[b * 8 + 6] = pos[b * 3 + 2] - moved[2];
    out[b * 8 + 7] = 0;
  }
}

export const alienScene: Scene = (() => {
  const get = (key: string): number => resolveSceneSetting(ALIEN_ID, SETTING_BY_KEY.get(key)!);

  let meshProg: GLProgram | null = null;
  let blurProg: GLProgram | null = null;
  let compProg: GLProgram | null = null;
  let quadVao: WebGLVertexArrayObject | null = null;
  let meshVao: WebGLVertexArrayObject | null = null;
  const meshBufs: WebGLBuffer[] = [];
  let vertexCount = 0;

  // Render targets: the sharp mesh (with depth) at full size, two blur levels.
  let sharpTex: WebGLTexture | null = null;
  let sharpDepth: WebGLRenderbuffer | null = null;
  let sharpFbo: WebGLFramebuffer | null = null;
  const levelTex: (WebGLTexture | null)[] = [null, null, null, null];
  const levelFbo: (WebGLFramebuffer | null)[] = [null, null, null, null];
  let sharpW = 0;
  let sharpH = 0;
  const levelW = [0, 0];
  const levelH = [0, 0];

  // The reel outlives dispose(): leaving and coming back finds the alien
  // where it was, the same as cutting away and back.
  const reel: Reel = createReel();
  let loopClips: (Clip | null)[] = LOOPS.map(() => null);
  if (typeof window !== "undefined" && typeof fetch === "function") {
    clips
      .bytes()
      .then((buf) => {
        const library = decodeClipLibrary(buf);
        loopClips = LOOPS.map((l) => library.byName.get(l.clip) ?? null);
        loopClips.forEach((c, i) => {
          if (!c) console.warn(`alien: loop ${i} names a clip the library lacks: ${LOOPS[i].clip}`);
        });
      })
      .catch((err: unknown) => console.warn("alien: clip library unavailable", err));
  }
  const pinnedLoop = (() => {
    if (!import.meta.env.DEV || typeof location === "undefined") return null;
    const raw = new URLSearchParams(location.search).get("loop");
    const n = raw === null ? NaN : Number(raw);
    return Number.isInteger(n) && n >= 0 && n < LOOPS.length ? n : null;
  })();
  if (pinnedLoop !== null) reel.loop = pinnedLoop;
  // What the last render read off the two wires, for the DEV hook.
  const last = { speed: 0, cutSignal: 0, cutLine: 0 };
  if (import.meta.env.DEV && typeof window !== "undefined") {
    (window as unknown as { __alien: unknown }).__alien = { reel, last };
  }

  const pose = createPose();
  const world = createRigWorld();
  const skin = new Float32Array(BONE_COUNT * 8);
  let lastTime: number | null = null;

  function makeTexture(gl: WebGL2RenderingContext, w: number, h: number): WebGLTexture | null {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  function attach(gl: WebGL2RenderingContext, tex: WebGLTexture | null, depth: WebGLRenderbuffer | null = null): WebGLFramebuffer | null {
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (depth) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`alien: framebuffer incomplete (0x${status.toString(16)})`);
    return fbo;
  }

  function freeTargets(gl: WebGL2RenderingContext): void {
    if (sharpFbo) gl.deleteFramebuffer(sharpFbo);
    if (sharpTex) gl.deleteTexture(sharpTex);
    if (sharpDepth) gl.deleteRenderbuffer(sharpDepth);
    sharpFbo = null;
    sharpTex = null;
    sharpDepth = null;
    for (let i = 0; i < 4; i++) {
      if (levelFbo[i]) gl.deleteFramebuffer(levelFbo[i]);
      if (levelTex[i]) gl.deleteTexture(levelTex[i]);
      levelFbo[i] = null;
      levelTex[i] = null;
    }
    sharpW = 0;
    sharpH = 0;
  }

  /** Rebuilds the targets when the drawing buffer changes size. */
  function ensureTargets(gl: WebGL2RenderingContext): void {
    const w = Math.max(1, gl.drawingBufferWidth);
    const h = Math.max(1, gl.drawingBufferHeight);
    if (w === sharpW && h === sharpH && sharpFbo) return;
    freeTargets(gl);
    sharpTex = makeTexture(gl, w, h);
    sharpDepth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, sharpDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    sharpFbo = attach(gl, sharpTex, sharpDepth);
    for (let level = 0; level < 2; level++) {
      const shift = level + 2;
      levelW[level] = Math.max(1, w >> shift);
      levelH[level] = Math.max(1, h >> shift);
      for (let j = 0; j < 2; j++) {
        const i = level * 2 + j;
        levelTex[i] = makeTexture(gl, levelW[level], levelH[level]);
        levelFbo[i] = attach(gl, levelTex[i]);
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    sharpW = w;
    sharpH = h;
  }

  /** One separable blur: src -> level's A (horizontal) -> level's B. */
  function blurLevel(gl: WebGL2RenderingContext, level: number, src: WebGLTexture | null): void {
    const prog = blurProg!;
    gl.viewport(0, 0, levelW[level], levelH[level]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, levelFbo[level * 2]);
    gl.bindTexture(gl.TEXTURE_2D, src);
    prog.setV2("uBlurStep", BLUR_STRIDE / levelW[level], 0);
    drawFullscreenQuad(gl, quadVao!);
    gl.bindFramebuffer(gl.FRAMEBUFFER, levelFbo[level * 2 + 1]);
    gl.bindTexture(gl.TEXTURE_2D, levelTex[level * 2]);
    prog.setV2("uBlurStep", 0, BLUR_STRIDE / levelH[level]);
    drawFullscreenQuad(gl, quadVao!);
  }

  function buildMeshVao(gl: WebGL2RenderingContext): void {
    const mesh = alienMesh();
    meshVao = gl.createVertexArray();
    gl.bindVertexArray(meshVao);
    const attrib = (loc: number, data: ArrayBufferView, size: number, type: number, normalized: boolean): void => {
      const buf = gl.createBuffer()!;
      meshBufs.push(buf);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, type, normalized, 0, 0);
    };
    attrib(0, mesh.position, 3, gl.FLOAT, false);
    attrib(1, mesh.normal, 3, gl.FLOAT, false);
    attrib(2, mesh.bones, MAX_INFLUENCES, gl.UNSIGNED_BYTE, false);
    attrib(3, mesh.weights, MAX_INFLUENCES, gl.UNSIGNED_BYTE, true);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    vertexCount = mesh.triCount * 3;
  }

  return {
    id: ALIEN_ID,
    name: "Alien",
    minQuality: "low",
    settings: SETTINGS,

    probe() {
      return { loop: reel.loop, frame: reel.heads[reel.loop], cuts: reel.cuts };
    },

    init(ctx: SceneContext) {
      const { gl } = ctx;
      meshProg = createProgram(gl, MESH_FRAG, MESH_VERT);
      blurProg = createProgram(gl, BLUR_FRAG);
      compProg = createProgram(gl, COMPOSITE_FRAG);
      quadVao = createFullscreenQuad(gl);
      buildMeshVao(gl);
      ensureTargets(gl);
      lastTime = null;
    },

    render(ctx: SceneContext, frame: FeatureFrame, viewport: Viewport, _palette: Palette, anim: AnimFrame, drives: SceneDrives = PASSTHROUGH_DRIVES) {
      const { gl } = ctx;
      if (!meshProg || !blurProg || !compProg || !quadVao || !meshVao) return;
      ensureTargets(gl);

      // Own delta from timeSec: the gallery preview hands render() an un-latched anim.
      const dt = lastTime === null ? 1 / 60 : Math.max(0, Math.min(0.25, anim.timeSec - lastTime));
      lastTime = anim.timeSec;

      // The two settings (reel.ts's header has the rules). Unplugged, both
      // read 0: no frames bought, nothing to cut on.
      const speed = get("play") * Math.max(0, drives.value("play", frame.level * PLAY_GAIN, 0));
      const mark = drives.threshold("cut");
      last.speed = speed;
      last.cutSignal = drives.value("cut", anim.low, 0);
      last.cutLine = mark === undefined ? CUT_LINE_DEFAULT : (mark ?? 0);
      if (import.meta.env.DEV) {
        // Candidate signals for the Cut wire, for a headless run to compare.
        (last as Record<string, unknown>).sig = {
          level: frame.level, low: anim.low, mid: anim.mid, high: anim.high, lowPulse: anim.lowPulse,
          midPulse: anim.midPulse, highPulse: anim.highPulse, beatPulse: anim.beatPulse,
          section: anim.sectionIntensity, drop: anim.dropPulse,
        };
      }
      advanceReel(reel, {
        dtSec: dt,
        speed,
        cutOn: pinnedLoop === null && get("cut") >= 0.5,
        cutSignal: last.cutSignal,
        cutLine: last.cutLine,
        frames: loopClips.map((c) => c?.frames ?? 0),
        fps: loopClips.map((c) => (c ? clipFps(c) : 0)),
      });

      // The pose the playhead has paid for; the rest pose until clips arrive.
      const clip = loopClips[reel.loop];
      if (clip) sampleClip(clip, reel.heads[reel.loop] / clip.frames, pose);
      else resetPose(pose);
      forwardKinematics(pose, world);
      groundToFloor(world, pose[CH_LIFT]);
      const bind = alienMesh().bind;
      packSkin(bind.pos, bind.rot, world.pos, world.rot, skin);

      // The loop's camera.
      const cam = LOOPS[reel.loop].camera;
      const fx = cam.target[0] - cam.eye[0], fy = cam.target[1] - cam.eye[1], fz = cam.target[2] - cam.eye[2];
      const dist = Math.hypot(fx, fy, fz);
      const fwd = [fx / dist, fy / dist, fz / dist];
      const rl = Math.hypot(fwd[2], fwd[0]) || 1;
      const right = [-fwd[2] / rl, 0, fwd[0] / rl];
      const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
      const roomAspect = gl.drawingBufferWidth / Math.max(1e-4, viewport.w) / (gl.drawingBufferHeight / Math.max(1e-4, viewport.h));
      const narrow = Math.max(NARROW_FOCAL_MIN, Math.sqrt(Math.min(1, roomAspect / WIDE_ASPECT)));

      // 1. The mesh, into the sharp target.
      gl.bindFramebuffer(gl.FRAMEBUFFER, sharpFbo);
      gl.viewport(0, 0, sharpW, sharpH);
      gl.clearColor(0, 0, 0, 1);
      gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.disable(gl.BLEND);
      meshProg.use();
      meshProg.setV2("uResolution", gl.drawingBufferWidth, gl.drawingBufferHeight);
      meshProg.setV4("uViewport", viewport.x, viewport.y, viewport.w, viewport.h);
      meshProg.setV4v("uSkin", skin);
      meshProg.setV3v("uEye", cam.eye as unknown as number[]);
      meshProg.setV3v("uRight", right);
      meshProg.setV3v("uUp", up);
      meshProg.setV3v("uFwd", fwd);
      meshProg.setF("uFocal", cam.focal * narrow);
      meshProg.setF("uDepthMid", dist);
      gl.bindVertexArray(meshVao);
      gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
      gl.bindVertexArray(null);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.DEPTH_TEST);

      // 2. Bloom levels, as many as the quality allows.
      const passes = ctx.quality.bloomPasses;
      gl.activeTexture(gl.TEXTURE0);
      if (passes >= 1) {
        blurProg.use();
        gl.uniform1i(gl.getUniformLocation(blurProg.program, "uTex"), 0);
        blurLevel(gl, 0, sharpTex);
        if (passes >= 2) blurLevel(gl, 1, levelTex[1]);
      }

      // 3. Composite, opaque, to the drawing buffer.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      compProg.use();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sharpTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, levelTex[1]);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, levelTex[3]);
      gl.uniform1i(gl.getUniformLocation(compProg.program, "uSharpTex"), 0);
      gl.uniform1i(gl.getUniformLocation(compProg.program, "uGlowATex"), 1);
      gl.uniform1i(gl.getUniformLocation(compProg.program, "uGlowBTex"), 2);
      compProg.setF("uGlowAGain", passes >= 1 ? GLOW_A_GAIN : 0);
      compProg.setF("uGlowBGain", passes >= 2 ? GLOW_B_GAIN : 0);
      drawFullscreenQuad(gl, quadVao);

      // 4. The gallery renders every scene into one shared context each tick —
      // leak no bound texture or active unit onto the next tile.
      for (let unit = 2; unit >= 0; unit--) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      meshProg?.dispose();
      blurProg?.dispose();
      compProg?.dispose();
      if (quadVao) gl.deleteVertexArray(quadVao);
      if (meshVao) gl.deleteVertexArray(meshVao);
      for (const b of meshBufs) gl.deleteBuffer(b);
      meshBufs.length = 0;
      freeTargets(gl);
      meshProg = null;
      blurProg = null;
      compProg = null;
      quadVao = null;
      meshVao = null;
    },
  };
})();
