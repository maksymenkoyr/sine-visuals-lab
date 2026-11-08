/**
 * Mandelbox Flight (in development): the camera keeps flying into a box-folded 3D fractal, the
 * Mandelbox, whose cells shine with white rims over two turning hues, and every so often it
 * dissolves to a new place, mirrored down the middle in some of them.
 *
 * Two draws: the march (glsl.ts's MARCH_BODY) into an offscreen target no taller than
 * `MARCH_HEIGHT` for the quality preset, then a full-size pass (OUT_BODY) that scales it up and,
 * while a new place fades in, mixes it over the last place's final frame, which `hold` keeps.
 * flight.ts flies the camera and finds the places, a little of the search each frame.
 *
 * The look and the motion were measured from a pre-rendered fractal video whose picture follows
 * nothing in its music (the `/ref` bundle `fractal-loop-2T33`), so the reactions are this scene's
 * own design, picked by the owner from a live sketch: the music's loudness sets the pace of the
 * flight and of the colours, so silence holds still (Push); kicks and claps flash the rims (Rim
 * flash); a drop moves on to a new place (Dissolve). docs/scenes/mandelbox.md has the record.
 */

import { NUM_BANDS } from "../../../audio/types.ts";
import { resolveSceneSetting } from "../../autoTune.ts";
import {
  createColorTarget,
  createFullscreenQuad,
  createProgram,
  destroyTarget,
  drawFullscreenQuad,
  type ColorTarget,
  type GLProgram,
} from "../../gl.ts";
import { PASSTHROUGH_DRIVES } from "../../drives.ts";
import type { QualityPreset } from "../../quality.ts";
import type { Scene, SceneContext } from "../../scene.ts";
import { COMMON_UNIFORMS_GLSL, DRIVE_GLSL, ROOM_UV_GLSL, settingUniformName, uploadCommonUniforms } from "../../sceneCommon.ts";
import { card, SETTINGS } from "./card.ts";
import {
  advanceFlight,
  cameraAxes,
  createFlight,
  createPace,
  createPlaceSearch,
  DE_FLOOR,
  foldScale,
  stepPace,
  stepPlaceSearch,
  type Flight,
  type Pace,
  type Place,
  type PlaceSearch,
} from "./flight.ts";
import { EXTRA_UNIFORMS, FOV_TAN, MARCH_BODY, OUT_BODY } from "./glsl.ts";

const ID = card.id;
/** The share of the gap closed per second at Flight speed 1: the reference zoomed in by this many e-folds a second. */
const BASE_RATE = 0.073;
/** Seconds per turn of the colour wheel at Colour drift 1: the reference's median within a minute.
 *  Its colours also jump as each new render dissolves in, which a new place's own `hueJump` does here. */
const HUE_PERIOD_SEC = 52;
/** Where the colour wheel starts: violet, with tintB on the far side of it (glsl.ts). */
const HUE_START = 0.72;
/** The share of the colour drift that goes on in silence. */
const COLOUR_FLOOR = 0.1;
/** A rim flash fades over this long: at a slower fade, a song with a kick and a clap every beat kept
 *  the frame half white. */
const FLASH_DECAY_SEC = 0.1;
/** A drop moves on only once the current place has shown this long; one that lands sooner, or while
 *  no place is ready, still counts if the wait ends within DROP_WAIT_SEC. */
const MIN_PLACE_SEC = 6;
const DROP_WAIT_SEC = 3;
/** The place search's share of each frame, and its allowance when there is nothing to show yet. */
const SEARCH_BUDGET_MS = 1.5;
const FIRST_SEARCH_MS = 600;
/** The first place's seed, picked by eye at the default Roundness and Mirror (docs/scenes/mandelbox.md). */
const FIRST_SEED = 2;
/** The fade in from black when the scene starts, seconds. */
const OPEN_FADE_SEC = 1;
const MAX_DT_SEC = 0.25;
/** The march target's height cap and step count per quality preset (glsl.ts's MAX_STEPS bounds the steps). */
const MARCH_HEIGHT: Record<QualityPreset, number> = { high: 720, mid: 540, low: 405, floor: 324 };
const MARCH_STEPS: Record<QualityPreset, number> = { high: 170, mid: 130, low: 100, floor: 80 };

const SETTINGS_BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));

function setting(key: string): number {
  const spec = SETTINGS_BY_KEY.get(key);
  return spec ? resolveSceneSetting(ID, spec) : 0;
}

function fragSource(body: string): string {
  return `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS.map((s) => `uniform float ${settingUniformName(s.key)};`).join("\n")}
${DRIVE_GLSL(SETTINGS)}
${EXTRA_UNIFORMS}
${ROOM_UV_GLSL}
${body}
`;
}

function smooth01(x: number): number {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
}

function createMandelboxScene(): Scene {
  let marchProg: GLProgram | null = null;
  let outProg: GLProgram | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  let live: ColorTarget | null = null;
  let hold: ColorTarget | null = null;
  let flight: Flight | null = null;
  let search: PlaceSearch = createPlaceSearch(foldScale(setting("roundness")), FIRST_SEED, setting("mirror"));
  let pace: Pace = createPace();
  let flash = 0;
  let huePhase = 0;
  let fade = 0;
  let fadeSec = OPEN_FADE_SEC;
  let shownSec = 0;
  let dropWait = 0;
  let places = 0;
  /** The Mirror option the current place was found under. */
  let placeMirror = 0;
  const right = new Float32Array(3);
  const up = new Float32Array(3);
  const bandsBuf = new Float32Array(NUM_BANDS);

  function reset(): void {
    flight = null;
    search = createPlaceSearch(foldScale(setting("roundness")), FIRST_SEED, setting("mirror"));
    pace = createPace();
    flash = 0;
    huePhase = 0;
    fade = 0;
    fadeSec = OPEN_FADE_SEC;
    shownSec = 0;
    dropWait = 0;
    places = 0;
  }

  function sizedTargets(gl: WebGL2RenderingContext, preset: QualityPreset): ColorTarget {
    const fullW = gl.drawingBufferWidth;
    const fullH = gl.drawingBufferHeight;
    const h = Math.max(1, Math.min(fullH, MARCH_HEIGHT[preset]));
    const w = Math.max(1, Math.round((fullW * h) / fullH));
    if (live && hold && live.w === w && live.h === h) return live;
    freeTargets(gl);
    live = createColorTarget(gl, w, h, { label: ID });
    hold = createColorTarget(gl, w, h, { label: ID });
    // A new hold starts black, so the first place fades in from black.
    const clear = gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array;
    gl.bindFramebuffer(gl.FRAMEBUFFER, hold.fbo);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.clearColor(clear[0], clear[1], clear[2], clear[3]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return live;
  }

  function freeTargets(gl: WebGL2RenderingContext): void {
    destroyTarget(gl, live);
    destroyTarget(gl, hold);
    live = null;
    hold = null;
  }

  /** Keeps the frame on screen now in `hold`, then starts flying `place`, fading it in over `seconds`. */
  function moveOn(gl: WebGL2RenderingContext, place: Place, seconds: number): void {
    if (flight && live && hold) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, live.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, hold.fbo);
      gl.blitFramebuffer(0, 0, live.w, live.h, 0, 0, hold.w, hold.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    }
    // The first place keeps the starting colours; every later one arrives with its own.
    if (flight) huePhase = (huePhase + place.hueJump) % 1;
    flight = createFlight(place);
    placeMirror = search.mirror;
    // The next search carries on the same random sequence, so a mount always meets the same places.
    search = createPlaceSearch(place.scale, search.seed, search.mirror);
    fade = 0;
    fadeSec = seconds;
    shownSec = 0;
    dropWait = 0;
    places++;
  }

  return {
    ...card,

    probe() {
      return flight ? { pace: pace.value, flash, gap: flight.gap, places } : null;
    },

    init(ctx: SceneContext) {
      const { gl } = ctx;
      marchProg = createProgram(gl, fragSource(MARCH_BODY));
      outProg = createProgram(gl, fragSource(OUT_BODY));
      vao = createFullscreenQuad(gl);
      reset();
    },

    render(ctx, frame, viewport, palette, anim, drives = PASSTHROUGH_DRIVES) {
      if (!marchProg || !outProg || !vao) return;
      const { gl } = ctx;
      const preset = ctx.quality.preset;
      const dt = Math.min(Math.max(anim.dtSec, 0), MAX_DT_SEC);
      const tgt = sizedTargets(gl, preset);

      const scale = foldScale(setting("roundness"));
      const mirror = Math.round(setting("mirror"));
      if (search.scale !== scale || search.mirror !== mirror) search = createPlaceSearch(scale, search.seed, mirror);
      const ready = stepPlaceSearch(search, flight ? SEARCH_BUDGET_MS : FIRST_SEARCH_MS);

      // fired() consumes the edge, so both are read every frame whatever their settings.
      if (drives.fired("flash", anim.song.kickOnset || anim.song.clapOnset)) flash = Math.max(flash, drives.hitSize("flash"));
      if (drives.fired("dissolve", anim.dropOnset)) dropWait = DROP_WAIT_SEC;
      flash *= Math.exp(-dt / FLASH_DECAY_SEC);
      dropWait = Math.max(0, dropWait - dt);
      // Unplugged, Push reads the song's own average, which is a pace of 1: a steady flight.
      const p = stepPace(pace, drives.value("push", pace.average), setting("push"), dt);

      if (!flight && ready) moveOn(gl, ready, OPEN_FADE_SEC);
      if (flight) {
        shownSec += dt;
        // A place flown down to the floor holds still until the next one is ready.
        const usedUp = advanceFlight(flight, dt, BASE_RATE * setting("speed"), flight.gap < DE_FLOOR ? 0 : p);
        const settingsMoved = flight.place.scale !== scale || placeMirror !== mirror;
        const wanted = usedUp || settingsMoved || (dropWait > 0 && shownSec > MIN_PLACE_SEC);
        if (wanted && fade >= 1 && ready) moveOn(gl, ready, setting("dissolve"));
      }
      huePhase = (huePhase + (dt * setting("drift") * (COLOUR_FLOOR + (1 - COLOUR_FLOOR) * p)) / HUE_PERIOD_SEC) % 1;
      fade = Math.min(1, fade + dt / Math.max(fadeSec, 0.05));

      if (flight) {
        cameraAxes(flight, right, up);
        marchProg.use();
        uploadCommonUniforms(marchProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf, drives);
        marchProg.setV2("uResolution", tgt.w, tgt.h);
        marchProg.setV3v("uCamPos", flight.place.p);
        marchProg.setV3v("uCamFwd", flight.place.fwd);
        marchProg.setV3v("uCamRight", right);
        marchProg.setV3v("uCamUp", up);
        marchProg.setF("uFold", flight.place.scale);
        marchProg.setF("uFolds", flight.folds);
        marchProg.setF("uGap", flight.gap);
        marchProg.setF("uPixel", (2 * FOV_TAN * viewport.h) / tgt.h);
        marchProg.setF("uSteps", MARCH_STEPS[preset]);
        marchProg.setF("uHueNow", HUE_START + setting("hue") / 360 + huePhase);
        marchProg.setF("uFlashNow", setting("flash") * flash);
        gl.bindFramebuffer(gl.FRAMEBUFFER, tgt.fbo);
        gl.viewport(0, 0, tgt.w, tgt.h);
        drawFullscreenQuad(gl, vao);
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      outProg.use();
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, hold?.tex ?? null);
      outProg.setI("uHold", 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tgt.tex);
      outProg.setI("uLive", 0);
      outProg.setF("uFade", flight ? smooth01(fade) : 0);
      drawFullscreenQuad(gl, vao);
      // The gallery renders every scene into one shared context each tick: leave nothing bound.
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, null);
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      freeTargets(gl);
      marchProg?.dispose();
      outProg?.dispose();
      if (vao) gl.deleteVertexArray(vao);
      marchProg = null;
      outProg = null;
      vao = null;
      reset();
    },
  };
}

export const mandelboxScene = createMandelboxScene();
