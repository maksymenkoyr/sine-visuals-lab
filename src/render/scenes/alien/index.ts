/**
 * Alien — one grey alien dancing as a glowing green wireframe on black, in
 * three short loops, each a captured dance seen from its own angle. The loops
 * are baked videos (loops/, made by tools/alien-bake.mjs from the live
 * renderer in renderer.ts); this scene plays them, and the music decides how:
 *   - Move: its wire (Level by default) times the slider is the playback
 *     speed, eased so it glides; silence buys no frames and the loop holds;
 *   - Cut: a loop repeats until its wire (Drop by default) makes a climb
 *     that stands out from its everyday ones (the dotted line on its graph,
 *     src/render/standout.ts), then the scene cuts to another loop;
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
 * alien where it was left.
 *
 * iPhone and iPad (WebKit on iOS) are stricter than desktop browsers. They
 * pause an inline video they count as off-screen, and a video outside the
 * page always is, so the videos sit in the page as one invisible pixel
 * (`VIDEO_HOLDER_STYLE`). They may refuse play() on a video no tap has
 * touched (always in Low Power Mode, which is why Move once froze on a
 * room's iPad while Bounce, a shader effect, kept working). So the first
 * tap or key anywhere starts and stops every loop, which lifts that limit
 * for good (`unlockOnGesture`). Until then, and wherever play() is refused,
 * the scene moves the paused video's playhead itself each frame (`scrub`):
 * the same speed, at the cost of a seek per frame. The frame on screen is uploaded to a texture when
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
import { publishSettingMarks } from "../../settingMarks.ts";
import { STANDOUT_THRESHOLD_DEFAULT, standoutLine, standoutMarks, standoutThreshold } from "../../standout.ts";
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
/** Browsers won't play slower than about this; below it the loop pauses. */
const MIN_RATE = 0.07;
const MAX_RATE = 4;
/** Playback-rate changes smaller than this aren't sent to the video. */
const RATE_STEP = 0.02;
/** Squash the spring may reach either way, as a share of the height. */
const SQUASH_LIMIT = 0.35;
/** Where the videos sit in the page: inside the viewport (iOS pauses a video
 *  it counts as off-screen) but one see-through pixel nobody can click. */
const VIDEO_HOLDER_STYLE =
  "position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;opacity:0.01;pointer-events:none";

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
      "On: the loop repeats until the wired signal jumps out from its everyday ones, over the dotted line on its graph, " +
      "then cuts to another of the three angles (never twice within a couple of seconds). Off: the loop on screen repeats",
    group: "Camera",
    type: "boolean",
    min: 0,
    max: 1,
    step: 1,
    default: 1,
    drive: {
      default: "anim.dropOnset",
      // A cut has no size, so its Reaction row stays on Flat.
      hit: { ownDetector: true, flatOnly: "A cut either happens or it doesn't, so it can't be sized." },
      // Scene-handled: the same standout as Physarum 2's Dose threshold
      // (standout.ts's header has how one is wired).
      threshold: {
        default: STANDOUT_THRESHOLD_DEFAULT,
        label: "Cut threshold",
        hint: "Moves the dotted line: how far a sound has to stand out from the everyday ones to cut to another angle. Left: more cuts, even from quiet sounds. Right: only clear standouts.",
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
  /** Per loop: a play() is in flight, or the browser refused it (then
   *  `scrub` moves the playhead until a tap lets play() through). */
  let playPending: boolean[] = [];
  let playRefused: boolean[] = [];
  /** Per loop: seconds of dance `scrub` owes while a seek is still landing. */
  let scrubOwed: number[] = [];
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
      // As attributes too: iOS WebKit has read these from the markup.
      v.setAttribute("muted", "");
      v.setAttribute("playsinline", "");
      asset
        .url("video/mp4")
        .then((url) => {
          v.src = url;
        })
        .catch((err: unknown) => console.warn("alien: loop video unavailable", err));
      return v;
    });
    playPending = videos.map(() => false);
    playRefused = videos.map(() => false);
    scrubOwed = videos.map(() => 0);
    const holder = document.createElement("div");
    holder.setAttribute("aria-hidden", "true");
    holder.style.cssText = VIDEO_HOLDER_STYLE;
    videos.forEach((v) => holder.appendChild(v));
    document.body.appendChild(holder);
    unlockOnGesture(videos);
    if (import.meta.env.DEV) (window as unknown as { __alien: unknown }).__alien = { reel, last, videos, playRefused };
    return videos;
  }

  /** On the first tap or key, plays and stops every loop inside the gesture:
   *  iOS then lets each play without one. Listens again if any refused. */
  function unlockOnGesture(vs: HTMLVideoElement[]): void {
    const events = ["click", "touchend", "keydown"] as const;
    const onGesture = (): void => {
      events.forEach((e) => window.removeEventListener(e, onGesture, true));
      let refused = false;
      void Promise.all(
        vs.map((v, i) =>
          v
            .play()
            .then(() => {
              playRefused[i] = false;
              if (i !== reel.loop || last.rate < MIN_RATE) v.pause();
            })
            .catch((err: unknown) => {
              if ((err as { name?: string }).name !== "AbortError") refused = true;
            }),
        ),
      ).then(() => {
        if (refused) events.forEach((e) => window.addEventListener(e, onGesture, true));
      });
    };
    events.forEach((e) => window.addEventListener(e, onGesture, true));
  }

  /** Plays the loop on screen at `rate` (paused below MIN_RATE) and holds the rest. */
  function drivePlayback(vs: HTMLVideoElement[], rate: number, dt: number): void {
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
      if (playRefused[i]) {
        scrub(v, i, r, dt);
        return;
      }
      if (Math.abs(v.playbackRate - r) > RATE_STEP) v.playbackRate = r;
      if (v.paused && !playPending[i]) {
        playPending[i] = true;
        v.play()
          .then(() => {
            playPending[i] = false;
          })
          .catch((err: unknown) => {
            playPending[i] = false;
            // AbortError: a pause() overtook the play — not a refusal.
            if ((err as { name?: string }).name !== "AbortError") playRefused[i] = true;
          });
      }
    });
  }

  /** Where play() is refused: steps the paused video's playhead by `rate`
   *  × dt, wrapping at the loop's end. While a seek is still landing it only
   *  adds up what it owes, so seeks don't pile up and the speed holds. */
  function scrub(v: HTMLVideoElement, i: number, rate: number, dt: number): void {
    scrubOwed[i] += rate * dt;
    if (v.readyState < 1 || v.seeking) return;
    const len = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : BAKED.loops[i].seconds;
    v.currentTime = (v.currentTime + scrubOwed[i]) % len;
    scrubOwed[i] = 0;
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
      last.cutSignal = drives.value("cut", anim.dropPulse, 0);
      const cut = stepCut(reel, {
        dtSec: dt,
        cutOn: pinnedLoop === null && get("cut") >= 0.5,
        cutSignal: last.cutSignal,
        cutThreshold: standoutThreshold(drives, "cut"),
      });
      // The panel draws the line a climb has to reach, and a dot per cut
      // (settingMarks.ts); no line while the threshold is off.
      last.cutLine = standoutMarks(reel.cut.detector)?.reach ?? 0;
      publishSettingMarks(ALIEN_ID, "cut", { lines: standoutLine(reel.cut.detector, "reach to cut"), reactionLabel: "cut" }, cut ? 1 : 0);
      const hit = Math.max(0, Math.min(1, drives.value("bounce", anim.lowPulse, 0)));
      stepBounce(bounce, get("bounce") * BOUNCE_MAX * hit, dt, get("bounceSmooth"));
      const squash = Math.max(-SQUASH_LIMIT, Math.min(SQUASH_LIMIT, bounce.squash));
      last.squash = squash;

      // The frame on screen: uploaded when the loop or its video time moved.
      let hasFrame = 0;
      const vs = videos;
      if (vs) {
        drivePlayback(vs, last.rate, dt);
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
      prog.setI("uVideo", 0);
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
