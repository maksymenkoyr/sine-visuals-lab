/**
 * Alien — one grey alien dancing as a glowing green wireframe on black, in
 * three short loops, each a captured dance seen from its own angle. The loops
 * are baked videos (loops/, made by tools/alien-bake.mjs from the live
 * renderer in renderer.ts); this scene plays them, and the music decides how:
 *   - Move: its wire (Level by default) times the slider is the playback
 *     speed, eased so it glides; silence buys no frames and the loop holds;
 *   - Cut: a loop repeats until its wire (Drop by default) rises over the
 *     line under its graph, then the scene cuts to another loop;
 *   - Bounce: its wire (Bass hit by default) squashes the picture toward the
 *     floor under the alien and springs it back, on top of the dance;
 *     Bounce smoothness turns that spring from a snap and a wobble into an
 *     ease and a glide.
 * reel.ts owns those rules and the LOOPS table; under the Move row a readout
 * shows what the music is buying (src/ui/widgets/alienPlay.ts, fed by
 * probe()).
 *
 * Playback: one muted <video> per loop, only the one on screen playing, its
 * playbackRate set from the eased speed (paused below MIN_RATE — browsers
 * won't play slower). Each keeps its own place, so a cut back finds the
 * alien where it was left. The frame on screen is uploaded to a texture when
 * it changes and drawn to cover the room (Panorama-aware via uViewport),
 * squashed about the loop's pivot for Bounce.
 *
 * DEV: `?loop=<n>` pins one loop (no cuts), and `window.__alien` exposes the
 * reel, the last wire readings and the videos for a headless run.
 */
import type { PanelSection, Scene, SceneContext, Viewport } from "../../scene.ts";
import type { FeatureFrame } from "../../../audio/types.ts";
import type { Palette } from "../../palette.ts";
import type { AnimFrame } from "../../animClock.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import { PASSTHROUGH_DRIVES, type SceneDrives } from "../../drives.ts";
import { resolveSceneSetting } from "../../autoTune.ts";
import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../../gl.ts";
import { pinAsset } from "../../../pinnedAssets.ts";
import loop0Url from "./loops/loop0.mp4?url";
import loop1Url from "./loops/loop1.mp4?url";
import loop2Url from "./loops/loop2.mp4?url";
import { BAKED } from "./loops/manifest.ts";
import { BOUNCE_MAX, BOUNCE_WIDEN, createBounce, createReel, easeSpeed, LOOPS, stepBounce, stepCut, type Reel } from "./reel.ts";
import { PLAYER_FRAG } from "./glsl.ts";

// Pinned (src/pinnedAssets.ts): every visitor's page fetches these after
// load, so a deploy mid-visit can't strand the scene without its loops. The
// scene record has their size; keep the bake's quality no higher than needed.
const VIDEOS = [pinAsset(loop0Url), pinAsset(loop1Url), pinAsset(loop2Url)];

export const ALIEN_ID = "alien";

/** Scales Level (Move's default wire) so a loud song reads about 1 — the
 *  dance at its captured speed with Move at its default. */
export const MOVE_GAIN = 2;
/** Where the Cut line starts on its default wire, Drop: a drop's flash
 *  clears it, nothing else on that signal does. */
export const CUT_LINE_DEFAULT = 0.5;
/** Browsers won't play slower than about this; below it the loop pauses. */
const MIN_RATE = 0.07;
const MAX_RATE = 4;
/** Playback-rate changes smaller than this aren't sent to the video. */
const RATE_STEP = 0.02;
/** Squash the spring may reach either way, as a share of the height. */
const SQUASH_LIMIT = 0.35;

const SETTINGS: SceneSetting[] = [
  {
    key: "move",
    label: "Move",
    description:
      "The music pays for every frame of the dance: the wired signal times this sets how fast the loop plays, " +
      "gliding rather than jumping. At 1 a loud song plays it as it was danced; silence buys no frames, so the alien holds still",
    group: "Motion",
    min: 0,
    max: 3,
    step: 0.05,
    default: 1,
    drive: { default: "feature.level", gain: MOVE_GAIN },
  },
  {
    key: "bounce",
    label: "Bounce",
    description: "How deep the alien squashes toward the floor and springs back each time the wired signal hits, on top of the dance",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    drive: { default: "anim.lowOnset" },
  },
  {
    key: "bounceSmooth",
    label: "Bounce smoothness",
    description:
      "How Bounce moves. Left: a quick snap down and a springy wobble back. Right: a slow ease down and a glide back to rest. " +
      "A single hit squashes as deep either way; on fast kicks a smooth bounce doesn't fully come back up between hits",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
  },
  {
    key: "cut",
    label: "Cut",
    description:
      "On: the loop repeats until the wired signal rises over the line under its graph, then cuts to another of the three angles " +
      "(never twice within a couple of seconds). Off: the loop on screen repeats",
    group: "Camera",
    type: "boolean",
    min: 0,
    max: 1,
    step: 1,
    default: 1,
    drive: {
      default: "anim.dropOnset",
      threshold: {
        default: CUT_LINE_DEFAULT,
        label: "Cuts above",
        hint: "A cut each time the signal rises over this line",
      },
    },
  },
];

const SETTING_BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));

/** The Motion group as one section: the Move row with a live readout under
 *  it (speed, frames bought per second, the loop's playhead), then Bounce
 *  and its smoothness. */
const PANEL: PanelSection[] = [{ widget: "alienPlay", title: "Motion", settings: ["move", "bounce", "bounceSmooth"] }];

export const alienScene: Scene = (() => {
  const get = (key: string): number => resolveSceneSetting(ALIEN_ID, SETTING_BY_KEY.get(key)!);

  let prog: GLProgram | null = null;
  let quadVao: WebGLVertexArrayObject | null = null;
  let tex: WebGLTexture | null = null;
  /** What `tex` holds: the loop and its video time, so a held frame isn't re-uploaded. */
  let texLoop = -1;
  let texTime = -1;

  // Reel, speed and videos outlive dispose(): leaving and coming back finds
  // the alien where it was, the same as cutting away and back.
  const reel: Reel = createReel();
  const bounce = createBounce();
  let speed = 0;
  let videos: HTMLVideoElement[] | null = null;
  let lastTime: number | null = null;

  const pinnedLoop = (() => {
    if (!import.meta.env.DEV || typeof location === "undefined") return null;
    const raw = new URLSearchParams(location.search).get("loop");
    const n = raw === null ? NaN : Number(raw);
    return Number.isInteger(n) && n >= 0 && n < LOOPS.length ? n : null;
  })();
  if (pinnedLoop !== null) reel.loop = pinnedLoop;
  // What the last render read off the wires, for probe() and the DEV hook.
  const last = { target: 0, speed: 0, rate: 0, cutSignal: 0, cutLine: 0, squash: 0 };

  /** One muted, looping <video> per loop, its source the pinned bytes. */
  function ensureVideos(): HTMLVideoElement[] {
    if (videos) return videos;
    videos = VIDEOS.map((asset) => {
      const v = document.createElement("video");
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.preload = "auto";
      asset
        .url("video/mp4")
        .then((url) => {
          v.src = url;
        })
        .catch((err: unknown) => console.warn("alien: loop video unavailable", err));
      return v;
    });
    if (import.meta.env.DEV) (window as unknown as { __alien: unknown }).__alien = { reel, last, videos };
    return videos;
  }

  /** Plays the loop on screen at `rate` (paused below MIN_RATE) and holds the rest. */
  function drivePlayback(vs: HTMLVideoElement[], rate: number): void {
    vs.forEach((v, i) => {
      if (i !== reel.loop) {
        if (!v.paused) v.pause();
        return;
      }
      if (rate < MIN_RATE) {
        if (!v.paused) v.pause();
        return;
      }
      const r = Math.min(MAX_RATE, rate);
      if (Math.abs(v.playbackRate - r) > RATE_STEP) v.playbackRate = r;
      if (v.paused) v.play().catch(() => {});
    });
  }

  return {
    id: ALIEN_ID,
    name: "Alien",
    settings: SETTINGS,
    panel: PANEL,

    // For the Move readout (src/ui/widgets/alienPlay.ts): the loop on screen,
    // where its video is, and what the music is buying right now.
    probe() {
      const v = videos?.[reel.loop];
      const baked = BAKED.loops[reel.loop];
      return {
        loop: reel.loop,
        frame: v ? v.currentTime * BAKED.fps : 0,
        frames: baked?.frames ?? 0,
        speed: last.rate,
        bought: last.rate * BAKED.fps,
        squash: last.squash,
        cuts: reel.cuts,
      };
    },

    init(ctx: SceneContext) {
      const { gl } = ctx;
      prog = createProgram(gl, PLAYER_FRAG);
      quadVao = createFullscreenQuad(gl);
      tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D, null);
      texLoop = -1;
      texTime = -1;
      lastTime = null;
      if (typeof document !== "undefined") ensureVideos();
    },

    render(ctx: SceneContext, frame: FeatureFrame, viewport: Viewport, _palette: Palette, anim: AnimFrame, drives: SceneDrives = PASSTHROUGH_DRIVES) {
      const { gl } = ctx;
      if (!prog || !quadVao || !tex) return;

      // Own delta from timeSec: the gallery preview hands render() an un-latched anim.
      const dt = lastTime === null ? 1 / 60 : Math.max(0, Math.min(0.25, anim.timeSec - lastTime));
      lastTime = anim.timeSec;

      // The three settings (reel.ts's header has the rules). Unplugged, each
      // reads 0: no frames bought, nothing to cut on, no bounce.
      last.target = get("move") * Math.max(0, drives.value("move", frame.level * MOVE_GAIN, 0));
      speed = easeSpeed(speed, last.target, dt);
      last.speed = speed;
      last.rate = speed < MIN_RATE ? 0 : Math.min(MAX_RATE, speed);
      const mark = drives.threshold("cut");
      last.cutSignal = drives.value("cut", anim.dropPulse, 0);
      last.cutLine = mark === undefined ? CUT_LINE_DEFAULT : (mark ?? 0);
      stepCut(reel, { dtSec: dt, cutOn: pinnedLoop === null && get("cut") >= 0.5, cutSignal: last.cutSignal, cutLine: last.cutLine });
      const hit = Math.max(0, Math.min(1, drives.value("bounce", anim.lowPulse, 0)));
      stepBounce(bounce, get("bounce") * BOUNCE_MAX * hit, dt, get("bounceSmooth"));
      const squash = Math.max(-SQUASH_LIMIT, Math.min(SQUASH_LIMIT, bounce.squash));
      last.squash = squash;

      // The frame on screen: uploaded when the loop or its video time moved.
      let hasFrame = 0;
      const vs = videos;
      if (vs) {
        drivePlayback(vs, last.rate);
        const v = vs[reel.loop];
        if (v.readyState >= 2) {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          if (texLoop !== reel.loop || texTime !== v.currentTime) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, v);
            texLoop = reel.loop;
            texTime = v.currentTime;
          }
          hasFrame = 1;
        } else if (texLoop === reel.loop) {
          hasFrame = 1; // still loading the next frame: keep the one we have
        }
      }

      const baked = BAKED.loops[reel.loop];
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      prog.use();
      prog.setV2("uResolution", gl.drawingBufferWidth, gl.drawingBufferHeight);
      prog.setV4("uViewport", viewport.x, viewport.y, viewport.w, viewport.h);
      prog.setV2("uVideoSize", BAKED.width, BAKED.height);
      prog.setV2("uPivot", baked.pivot[0], baked.pivot[1]);
      prog.setV2("uScale", 1 + squash * BOUNCE_WIDEN, 1 - squash);
      prog.setF("uHasFrame", hasFrame);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(gl.getUniformLocation(prog.program, "uVideo"), 0);
      drawFullscreenQuad(gl, quadVao);
      // The gallery renders every scene into one shared context each tick.
      gl.bindTexture(gl.TEXTURE_2D, null);
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      prog?.dispose();
      if (quadVao) gl.deleteVertexArray(quadVao);
      if (tex) gl.deleteTexture(tex);
      prog = null;
      quadVao = null;
      tex = null;
      videos?.forEach((v) => v.pause());
    },
  };
})();
