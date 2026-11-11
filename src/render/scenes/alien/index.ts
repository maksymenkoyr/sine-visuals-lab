/**
 * Alien — one grey alien dancing as a glowing green wireframe on black, in
 * short loops, each a captured dance seen from its own angle (LOOPS in
 * reel.ts), drawn live every frame by renderer.ts. The music decides how:
 *   - Move: its wire (Level by default) times the slider is the dance's
 *     speed over the one pace every dance keeps (DANCE_PACE_HZ in reel.ts,
 *     each dance's moves counted by pace.ts), eased so it glides; silence
 *     buys no frames and the alien holds;
 *   - Dance cut: a dance repeats until its wire (Drop level by default)
 *     climbs up through the dotted line on its graph (src/render/lineTrigger.ts),
 *     then the scene cuts to another dance, through its own camera; Camera
 *     cut does the same on its own wire (Kick by default) but changes only
 *     the camera. Shortest dance and Shortest view are how long each must
 *     stay on screen first, Longest dance and Longest view how long at most
 *     (then it cuts by itself, on the next beat with the on-beat switch on,
 *     and not in silence), and line sink lowers the line as Longest nears;
 *   - Bounce: its wire (Kick by default) squashes the alien toward the
 *     floor under him and springs him back, on top of the dance (MESH_VERT
 *     in glsl.ts); Bounce smoothness turns that spring from a snap and a
 *     wobble into an ease and a glide;
 *   - Dance and View, not wired to the music: hold one dance (Dance cut
 *     then waits) or one camera for every dance (Camera cut waits); on Any,
 *     each row outlines the chip on screen (probe()'s `dance` and `view`,
 *     SceneSetting.onScreen). The camera sliders, and the arrow keys, move
 *     that camera by hand (camera.ts).
 * reel.ts owns those rules and the LOOPS table; under the Move row a readout
 * shows what the music is buying (src/ui/widgets/alienPlay.ts, fed by
 * probe()).
 *
 * Each loop keeps its own place in its clip, so a cut back finds the alien
 * where he was left. The model (meshFile.ts, built in Blender by
 * tools/alien-model/) and the clips (the dancers' library) are fetched on the
 * first mount and decoded once per page; until both land the scene draws
 * black. The baked videos in public/media/alien/ are no longer played: they
 * stay for tabs on an older build (src/pinnedAssets.ts's header), and
 * loops/manifest.ts lists them.
 *
 * DEV: `?loop=<n>` pins one loop (no cuts), and `window.__alien` exposes the
 * reel, the last wire readings and each loop's place for a headless run.
 */
import type { Scene, SceneContext, Viewport } from "../../scene.ts";
import type { FeatureFrame } from "../../../audio/types.ts";
import type { Palette } from "../../palette.ts";
import type { AnimFrame } from "../../animClock.ts";
import { PASSTHROUGH_DRIVES, type SceneDrives } from "../../drives.ts";
import { publishSettingMarks } from "../../settingMarks.ts";
import { SONG_EDGE_MIN_DIMMER } from "../../animClock.ts";
import { lineAt, type LineTriggerSettings } from "../../lineTrigger.ts";
import { resolveSceneSetting } from "../../autoTune.ts";
import { sceneMedia } from "../../../pinnedAssets.ts";
import { CLIP_LIBRARY_URL, decodeClipLibrary, sampleClip, type Clip, type ClipLibrary } from "../dancers/clipFormat.ts";
import { createPose } from "../dancers/rig.ts";
import { createAlienRenderer, floorPivot, type AlienRenderer, type Squash } from "./renderer.ts";
import { decodeAlienMesh, MESH_URL, type AlienModel } from "./meshFile.ts";
import { BOUNCE_MAX, CUT_LINE_DEFAULT, LONGEST_NEVER_SEC, chipLoop, chipView, clipSeconds, createBounce, createReel, easeSpeed, LOOPS, pacedSeconds, showLoop, stepBounce, stepCuts, VIEWS, type Reel } from "./reel.ts";
import { danceMoves } from "./pace.ts";
import { card, MOVE_GAIN, SETTINGS } from "./card.ts";
import { easeHand, HAND_AT_REST, handCamera, type CameraHand } from "./camera.ts";

// Scene media (src/pinnedAssets.ts's header): sceneMedia keys by path, so the
// clips are the same copy Dancers and Code Rain hold.
const clips = sceneMedia(CLIP_LIBRARY_URL);
const meshMedia = sceneMedia(MESH_URL);

export const ALIEN_ID = card.id;

const MAX_RATE = 4;
/** The eased speed only nears 0 in silence; below this (it reads 0.00×) the
 *  alien holds still and the readout says so. */
const HELD_BELOW = 0.005;
/** Squash the spring may reach either way, as a share of the height. */
const SQUASH_LIMIT = 0.35;

const SETTING_BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));

interface LiveLoop {
  clip: Clip;
  /** One loop at speed 1, at the pace every dance keeps (reel.ts's `pacedSeconds`). */
  seconds: number;
  /** Bounce's floor point, x and z in metres (renderer.ts's floorPivot). */
  pivot: [number, number];
}

function liveLoops(library: ClipLibrary): LiveLoop[] {
  return LOOPS.map((spec) => {
    const clip = library.byName.get(spec.clip);
    if (!clip) throw new Error(`alien: no clip ${spec.clip}`);
    return { clip, seconds: pacedSeconds(clipSeconds(clip), danceMoves(clip)), pivot: floorPivot(clip) };
  });
}

/** One cut's line, Shortest, Longest, Sink and on-beat as its settings hold them. */
function cutSettings(
  drives: SceneDrives,
  get: (key: string) => number,
  cutKey: string,
  holdKey: string,
  longestKey: string,
  sinkKey: string,
  onBeatKey: string,
): LineTriggerSettings {
  const line = drives.threshold(cutKey);
  const longest = get(longestKey);
  return {
    line: line === undefined ? CUT_LINE_DEFAULT : line,
    shortestSec: get(holdKey),
    longestSec: longest >= LONGEST_NEVER_SEC ? Infinity : longest,
    sink: get(sinkKey),
    onBeat: get(onBeatKey) >= 0.5,
  };
}

export const alienScene: Scene = (() => {
  const get = (key: string): number => resolveSceneSetting(ALIEN_ID, SETTING_BY_KEY.get(key)!);

  let renderer: AlienRenderer | null = null;
  let model: AlienModel | null = null;
  let loops: LiveLoop[] | null = null;
  let libraryRequested = false;
  let modelRequested = false;
  const pose = createPose();
  const squash: Squash = { x: 0, z: 0, squash: 0 };

  // Reel, speed and places outlive dispose(): leaving and coming back finds
  // the alien where it was, the same as cutting away and back.
  const reel: Reel = createReel();
  const bounce = createBounce();
  let speed = 0;
  /** The camera by hand as drawn, easing toward the sliders (camera.ts). */
  const hand: CameraHand = { ...HAND_AT_REST };
  const handTarget: CameraHand = { ...HAND_AT_REST };
  /** A mount's first drawn frame starts at the sliders instead of easing there. */
  let handFresh = true;
  /** Per loop: how far through its clip the alien is, 0..1. */
  const phase = LOOPS.map(() => 0);
  let lastTime: number | null = null;

  const pinnedLoop = (() => {
    if (!import.meta.env.DEV || typeof location === "undefined") return null;
    const raw = new URLSearchParams(location.search).get("loop");
    const n = raw === null ? NaN : Number(raw);
    return Number.isInteger(n) && n >= 0 && n < LOOPS.length ? n : null;
  })();
  if (pinnedLoop !== null) showLoop(reel, pinnedLoop);
  /** Index into VIEWS of the camera the last render drew through. */
  let shownView = reel.view;
  // What the last render read off the wires, for probe() and the DEV hook.
  const last = { target: 0, speed: 0, rate: 0, cutSignal: 0, cutLine: 0, cameraSignal: 0, cameraLine: 0, squash: 0 };
  if (import.meta.env.DEV && typeof window !== "undefined") (window as unknown as { __alien: unknown }).__alien = { reel, last, phase };

  return {
    ...card,

    // For the Move readout (src/ui/widgets/alienPlay.ts): the loop on screen,
    // where the alien is in its clip, and what the music is buying right now.
    // `dance` and `view` are the Dance and View chips on screen (onScreen in
    // card.ts), chip 0 being Any.
    probe() {
      const live = loops?.[reel.loop];
      const frames = live?.clip.frames ?? 0;
      return {
        loop: reel.loop,
        frame: phase[reel.loop] * frames,
        frames,
        speed: last.rate,
        bought: live && live.seconds > 0 ? (last.rate * frames) / live.seconds : 0,
        squash: last.squash,
        cuts: reel.cuts,
        cameraCuts: reel.cameraCuts,
        dance: reel.loop + 1,
        view: shownView + 1,
      };
    },

    init(_ctx: SceneContext) {
      lastTime = null;
      handFresh = true;
      // A later mount (the gallery tile, then the full view) finds the model
      // and the clips already decoded; modelRequested and libraryRequested
      // keep a mount during a fetch from asking twice.
      if (typeof window === "undefined" || typeof fetch !== "function") return;
      if (!model && !modelRequested) {
        modelRequested = true;
        meshMedia
          .bytes()
          .then((buf) => {
            model = decodeAlienMesh(buf);
          })
          .catch((err: unknown) => {
            modelRequested = false;
            console.warn("alien: model unavailable", err);
          });
      }
      if (!loops && !libraryRequested) {
        libraryRequested = true;
        clips
          .bytes()
          .then((buf) => {
            loops = liveLoops(decodeClipLibrary(buf));
          })
          .catch((err: unknown) => {
            libraryRequested = false;
            console.warn("alien: clip library unavailable", err);
          });
      }
    },

    render(ctx: SceneContext, frame: FeatureFrame, viewport: Viewport, _palette: Palette, anim: AnimFrame, drives: SceneDrives = PASSTHROUGH_DRIVES) {
      const { gl } = ctx;
      if (!renderer && model) renderer = createAlienRenderer(gl, model);

      // Own delta from timeSec: the gallery preview hands render() an un-latched anim.
      const dt = lastTime === null ? 1 / 60 : Math.max(0, Math.min(0.25, anim.timeSec - lastTime));
      lastTime = anim.timeSec;

      // The wired settings (reel.ts's header has the rules). Unplugged, each
      // reads 0: no frames bought, nothing to cut on, no bounce.
      last.target = get("move") * Math.max(0, drives.value("move", frame.level * MOVE_GAIN, 0));
      speed = easeSpeed(speed, last.target, dt);
      last.speed = speed;
      last.rate = speed < HELD_BELOW ? 0 : Math.min(MAX_RATE, speed);
      last.cutSignal = drives.value("cut", anim.song.dropLevel, 0);
      last.cameraSignal = drives.value("cameraCut", anim.song.kickPulse, 0);
      const heldDance = chipLoop(get("dance"));
      if (heldDance !== null) showLoop(reel, heldDance);
      const heldView = chipView(get("view"));
      const danceLine = cutSettings(drives, get, "cut", "cutHold", "cutLongest", "cutSink", "cutOnBeat");
      const cameraLine = cutSettings(drives, get, "cameraCut", "cameraHold", "cameraLongest", "cameraSink", "cameraOnBeat");
      const cut = stepCuts(
        reel,
        dt,
        { on: pinnedLoop === null && heldDance === null && get("cut") >= 0.5, signal: last.cutSignal, settings: danceLine },
        { on: pinnedLoop === null && heldView === null && get("cameraCut") >= 0.5, signal: last.cameraSignal, settings: cameraLine },
        anim.metronomeBeat,
        anim.gateDimmer >= SONG_EDGE_MIN_DIMMER,
      );
      shownView = heldView ?? reel.view;
      // The panel draws the line a climb has to cross, and a dot per cut
      // (settingMarks.ts); no line while the threshold is off.
      const danceAt = lineAt(danceLine, reel.cut.sinceSec);
      const cameraAt = lineAt(cameraLine, reel.cameraCut.sinceSec);
      last.cutLine = danceAt ?? 0;
      last.cameraLine = cameraAt ?? 0;
      publishSettingMarks(
        ALIEN_ID,
        "cut",
        { lines: danceAt === null ? [] : [{ value: danceAt, label: "line to cross" }], reactionLabel: "cut" },
        cut === "dance" ? 1 : 0,
      );
      publishSettingMarks(
        ALIEN_ID,
        "cameraCut",
        { lines: cameraAt === null ? [] : [{ value: cameraAt, label: "line to cross" }], reactionLabel: "cut" },
        cut === "camera" ? 1 : 0,
      );
      const hit = Math.max(0, Math.min(1, drives.value("bounce", anim.song.kickPulse, 0)));
      stepBounce(bounce, get("bounce") * BOUNCE_MAX * hit, dt, get("bounceSmooth"));
      last.squash = Math.max(-SQUASH_LIMIT, Math.min(SQUASH_LIMIT, bounce.squash));

      const live = loops?.[reel.loop];
      if (!live || !renderer) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        return;
      }
      if (live.seconds > 0) phase[reel.loop] = (phase[reel.loop] + (last.rate * dt) / live.seconds) % 1;
      sampleClip(live.clip, phase[reel.loop], pose);
      squash.x = live.pivot[0];
      squash.z = live.pivot[1];
      squash.squash = last.squash;
      handTarget.orbit = get("orbit");
      handTarget.tilt = get("tilt");
      handTarget.distance = get("distance");
      handTarget.height = get("height");
      handTarget.zoom = get("zoom");
      if (handFresh) Object.assign(hand, handTarget);
      else easeHand(hand, handTarget, dt);
      handFresh = false;
      renderer.draw(pose, handCamera(VIEWS[shownView].camera, hand), ctx.quality.bloomPasses, viewport, squash);
    },

    dispose() {
      renderer?.dispose();
      renderer = null;
    },
  };
})();
