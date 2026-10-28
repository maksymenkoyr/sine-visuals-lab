/**
 * Alien — one grey alien dancing as a glowing green wireframe on black, in
 * short loops, each a captured dance seen from its own angle (LOOPS in
 * reel.ts), drawn live every frame by renderer.ts. The music decides how:
 *   - Move: its wire (Level by default) times the slider is the dance's
 *     speed, eased so it glides; silence buys no frames and the alien holds;
 *   - Cut: a loop repeats until its wire (Drop by default) makes a climb
 *     that stands out from its everyday ones (the dotted line on its graph,
 *     src/render/standout.ts), then the scene cuts to another loop;
 *   - Bounce: its wire (Bass hit by default) squashes the alien toward the
 *     floor under him and springs him back, on top of the dance (MESH_VERT
 *     in glsl.ts); Bounce smoothness turns that spring from a snap and a
 *     wobble into an ease and a glide;
 *   - Dance and View, not wired to the music: hold one dance (Cut then
 *     waits) or one loop's camera for every dance.
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
import { standoutLine, standoutMarks, standoutThreshold } from "../../standout.ts";
import { resolveSceneSetting } from "../../autoTune.ts";
import { sceneMedia } from "../../../pinnedAssets.ts";
import { CLIP_LIBRARY_URL, decodeClipLibrary, sampleClip, type Clip, type ClipLibrary } from "../dancers/clipFormat.ts";
import { createPose } from "../dancers/rig.ts";
import { createAlienRenderer, floorPivot, type AlienRenderer, type Squash } from "./renderer.ts";
import { decodeAlienMesh, MESH_URL, type AlienModel } from "./meshFile.ts";
import { BOUNCE_MAX, chipLoop, clipSeconds, createBounce, createReel, easeSpeed, LOOPS, stepBounce, stepCut, type Reel } from "./reel.ts";
import { card, MOVE_GAIN, SETTINGS } from "./card.ts";

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
  seconds: number;
  /** Bounce's floor point, x and z in metres (renderer.ts's floorPivot). */
  pivot: [number, number];
}

function liveLoops(library: ClipLibrary): LiveLoop[] {
  return LOOPS.map((spec) => {
    const clip = library.byName.get(spec.clip);
    if (!clip) throw new Error(`alien: no clip ${spec.clip}`);
    return { clip, seconds: clipSeconds(clip), pivot: floorPivot(clip) };
  });
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
  /** Per loop: how far through its clip the alien is, 0..1. */
  const phase = LOOPS.map(() => 0);
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
  if (import.meta.env.DEV && typeof window !== "undefined") (window as unknown as { __alien: unknown }).__alien = { reel, last, phase };

  return {
    ...card,

    // For the Move readout (src/ui/widgets/alienPlay.ts): the loop on screen,
    // where the alien is in its clip, and what the music is buying right now.
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
      };
    },

    init(_ctx: SceneContext) {
      lastTime = null;
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

      // The three settings (reel.ts's header has the rules). Unplugged, each
      // reads 0: no frames bought, nothing to cut on, no bounce.
      last.target = get("move") * Math.max(0, drives.value("move", frame.level * MOVE_GAIN, 0));
      speed = easeSpeed(speed, last.target, dt);
      last.speed = speed;
      last.rate = speed < HELD_BELOW ? 0 : Math.min(MAX_RATE, speed);
      last.cutSignal = drives.value("cut", anim.dropPulse, 0);
      const heldDance = chipLoop(get("dance"));
      if (heldDance !== null) reel.loop = heldDance;
      const cut = stepCut(reel, {
        dtSec: dt,
        cutOn: pinnedLoop === null && heldDance === null && get("cut") >= 0.5,
        cutSignal: last.cutSignal,
        cutThreshold: standoutThreshold(drives, "cut"),
      });
      // The panel draws the line a climb has to reach, and a dot per cut
      // (settingMarks.ts); no line while the threshold is off.
      last.cutLine = standoutMarks(reel.cut.detector)?.reach ?? 0;
      publishSettingMarks(ALIEN_ID, "cut", { lines: standoutLine(reel.cut.detector, "reach to cut"), reactionLabel: "cut" }, cut ? 1 : 0);
      const hit = Math.max(0, Math.min(1, drives.value("bounce", anim.lowPulse, 0)));
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
      renderer.draw(pose, LOOPS[chipLoop(get("view")) ?? reel.loop].camera, ctx.quality.bloomPasses, viewport, squash);
    },

    dispose() {
      renderer?.dispose();
      renderer = null;
    },
  };
})();
