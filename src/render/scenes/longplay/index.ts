// Long Play — one long scene made of many "views", after a VJ set: built
// from `/ref` on Altum's 90-minute "Techno Mix (2022) with 4K Visuals"
// (YouTube kMJVNerOtRI; bundles tools/.cache/refs/alt-*, the record is
// docs/scenes/longplay.md). The VJ holds one looped look for minutes and
// then mixes into the next; every look is centre-framed, mirrored left to
// right, drawn in thin neon strokes on black, with a glitch layer that
// blinks parts of it on and off.
//
// Structure. Each view is its own fragment shader (views/*.ts) compiled
// into its own child program by createFullscreenScene — compiled lazily,
// the first time the view is shown, so a long list of views costs nothing
// until it plays. All children share this scene's id and settings, so they
// read the same store and drives. A frame draws the view on screen; during
// a mix it draws the next view over it with a constant-alpha blend, so the
// crossfade needs no extra framebuffer. tour.ts decides which view shows
// and when a mix runs; glsl.ts holds what every view shares.
//
// Pro. Views listed in a VIEW's `pro` are Pro content (src/render/pro.ts):
// the View setting's `proOptions` keeps them from being stored or read
// back while Pro is locked, the device menu shows them as locked chips, and
// the tour skips them. Free today: Tunnel, Reactor, Ocean.
//
// Sync, from the reference's measurements (the record's "Decisions and
// pivots" has the evidence):
// - View changes are a timer, not the music (Hold); the mix starts on a
//   phrase start of our 16-beat count and runs two bars (tour.ts).
// - Launch: a hit sends a new square (Tunnel) / ring burst (Reactor) out
//   from the centre — drive default the onset, as measured in those views.
// - Flash: brightness on hits, scaled per view by its FLASH_W (strong in
//   Tunnel and Reactor, nearly none in Ocean, as measured).
// - Phrase starts (uPhrase/uPhraseN): the within-view change the reference
//   favours — Ocean surges and turns colour, Tunnel's frame lifts.
// - Flicker: the glitch layer is a timer — holds of 67–333 ms (the
//   measured median holds between hard cuts), never on the beat — plus a
//   strobe stretch of one flash per beat for a bar after a phrase start
//   (Tunnel's measured ≈1-beat strobe). Each view picks which of its
//   layers the mask may blink: a view the reference never hard-cuts
//   (Wings, Circuit) gives it only a minor layer, since a big one blinking
//   reads as a cut.
// - Lift: a sustained level brightens the lines, on the views that
//   measured one — drive default the treble level (Circuit's edges
//   followed the high band).
import { createFullscreenScene } from "../../fullscreenScene.ts";
import { isProLocked, type SceneSetting } from "../../sceneSettings.ts";
import { resolveSceneSetting } from "../../autoTune.ts";
import type { Scene, SceneContext } from "../../scene.ts";
import { PASSTHROUGH_DRIVES } from "../../drives.ts";
import { LAUNCH_SLOTS, LONGPLAY_UNIFORMS_GLSL, viewFragBody } from "./glsl.ts";
import { createTour, mixWeight, stepTour, PHRASE_BEATS, type TourState } from "./tour.ts";
import { TUNNEL_GLSL } from "./views/tunnel.ts";
import { REACTOR_GLSL } from "./views/reactor.ts";
import { OCEAN_GLSL } from "./views/ocean.ts";
import { BLOOM_GLSL } from "./views/bloom.ts";
import { WINGS_GLSL } from "./views/wings.ts";
import { CIRCUIT_GLSL } from "./views/circuit.ts";
import { CHIP_GLSL } from "./views/chip.ts";

const ID = "longplay";
const NAME = "Long Play";

interface ViewDef {
  name: string;
  glsl: string;
  pro?: boolean;
}

/** The views, in tour order. A view's name is its chip in the View row. */
export const VIEWS: readonly ViewDef[] = [
  { name: "Tunnel", glsl: TUNNEL_GLSL },
  { name: "Reactor", glsl: REACTOR_GLSL },
  { name: "Ocean", glsl: OCEAN_GLSL },
  { name: "Bloom", glsl: BLOOM_GLSL, pro: true },
  { name: "Wings", glsl: WINGS_GLSL, pro: true },
  { name: "Circuit", glsl: CIRCUIT_GLSL, pro: true },
  { name: "Chip", glsl: CHIP_GLSL, pro: true },
];

/** Shortest gap between two launches — a fast hi-hat run mustn't stack a
 *  square per sixteenth. */
const LAUNCH_MIN_GAP_SEC = 0.22;
/** Flicker holds, log-uniform between the measured shortest and median-ish
 *  longest hold between hard cuts (alt-tunnel/alt-hud: 67–333 ms). */
const FLICK_HOLD_MIN_SEC = 0.067;
const FLICK_HOLD_MAX_SEC = 0.333;
/** Strobe stretch after a phrase start, in beats. */
const STROBE_BEATS = 4;
const PHRASE_DECAY_SEC = 0.9;

export const LONGPLAY_SETTINGS: SceneSetting[] = [
  // Form
  {
    key: "view",
    label: "View",
    description: "Which look is on screen — picking one mixes to it over two bars",
    group: "Form",
    type: "enum",
    options: VIEWS.map((v) => v.name),
    proOptions: VIEWS.filter((v) => v.pro).map((v) => v.name),
    min: 0,
    max: VIEWS.length - 1,
    step: 1,
    default: 0,
  },
  {
    key: "auto",
    label: "Auto change",
    description: "Moves on to the next view by itself after Hold, mixing in on a phrase start",
    group: "Form",
    type: "boolean",
    min: 0,
    max: 1,
    step: 1,
    default: 1,
  },
  {
    key: "hold",
    label: "Hold",
    description: "Minutes a view stays before Auto change mixes to the next — right holds longer",
    group: "Form",
    min: 0.5,
    max: 10,
    step: 0.5,
    default: 3,
  },
  // Motion
  {
    key: "speed",
    label: "Speed",
    description: "How fast every view drifts, flies and grows",
    group: "Motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
  },
  {
    key: "launch",
    label: "Launch",
    description: "How bright the square or ring a hit sends out from the centre is — 0 sends none",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.8,
    drive: { default: "feature.onset" },
  },
  // Look
  {
    key: "flash",
    label: "Flash",
    description: "How much a hit brightens the picture (the calm views take less of it)",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    drive: { default: "feature.onset" },
  },
  {
    key: "glow",
    label: "Glow",
    description: "How far the neon halo spreads around each stroke",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
  },
  {
    key: "lift",
    label: "Lift",
    description: "How much the sound brightens the lines, on the views that react to it (Circuit's edges)",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    drive: { default: "anim.high" },
  },
  // Post
  {
    key: "flicker",
    label: "Flicker",
    description: "How much of the picture blinks off for a few frames at a time — the reference's glitch, on its own timer",
    group: "Post",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
  },
];

function settingFor(key: string): SceneSetting {
  const s = LONGPLAY_SETTINGS.find((x) => x.key === key);
  if (!s) throw new Error(`longplay: unknown setting ${key}`);
  return s;
}
const VIEW_SPEC = settingFor("view");
const get = (key: string): number => resolveSceneSetting(ID, settingFor(key));
const viewLocked = (i: number): boolean => isProLocked(VIEW_SPEC, i);

// ---- per-frame shared state, uploaded to whichever children draw ----
const launchAge = new Float32Array(LAUNCH_SLOTS).fill(1e3);
const launchAmp = new Float32Array(LAUNCH_SLOTS);
const launchSeed = new Float32Array(LAUNCH_SLOTS);
let launchNext = 0;
let lastLaunchSec = -1e3;
let t = 0;
let phrase = 0;
let phraseN = 0;
let phraseAge = 0;
let lastPhraseIdx = -1;
let flickMask = 0;
let flickLeft = 0;
let strobeUntilBeat = -1;
let strobe = 0;
let lastTimeSec = -1;
let tour: TourState = createTour(0);

function resetState(): void {
  launchAge.fill(1e3);
  launchAmp.fill(0);
  launchSeed.fill(0);
  launchNext = 0;
  lastLaunchSec = -1e3;
  t = 0;
  phrase = 0;
  phraseN = 0;
  phraseAge = 0;
  lastPhraseIdx = -1;
  flickMask = 0;
  flickLeft = 0;
  strobeUntilBeat = -1;
  strobe = 0;
  lastTimeSec = -1;
  tour = createTour(get("view"));
}

type Drives = NonNullable<Parameters<Scene["render"]>[5]>;
type Anim = Parameters<Scene["render"]>[4];

function step(anim: Anim, drives: Drives): void {
  const dt = Math.min(anim.dtSec, 0.1);
  const speed = get("speed");
  t += dt * speed;

  for (let i = 0; i < LAUNCH_SLOTS; i++) launchAge[i] += dt * Math.max(speed, 0.05);
  const launch = get("launch");
  if (launch > 0.02 && drives.fired("launch", anim.onset) && anim.timeSec - lastLaunchSec >= LAUNCH_MIN_GAP_SEC) {
    launchAge[launchNext] = 0;
    launchAmp[launchNext] = launch;
    launchSeed[launchNext] = Math.random();
    launchNext = (launchNext + 1) % LAUNCH_SLOTS;
    lastLaunchSec = anim.timeSec;
  }

  const phraseIdx = Math.floor(anim.beats / PHRASE_BEATS);
  const flicker = get("flicker");
  if (lastPhraseIdx >= 0 && phraseIdx > lastPhraseIdx) {
    phrase = 1;
    phraseN += 1;
    phraseAge = 0;
    if (flicker > 0.02) strobeUntilBeat = anim.beats + STROBE_BEATS;
  }
  lastPhraseIdx = phraseIdx;
  phrase *= Math.exp(-dt / PHRASE_DECAY_SEC);
  phraseAge += dt * speed;
  strobe = anim.beats < strobeUntilBeat ? flicker * Math.pow(1 - anim.beatPhase, 6) : 0;

  flickLeft -= dt;
  if (flickLeft <= 0) {
    const lo = Math.log(FLICK_HOLD_MIN_SEC);
    const hi = Math.log(FLICK_HOLD_MAX_SEC);
    flickLeft = Math.exp(lo + Math.random() * (hi - lo));
    // Each layer blinks off with a chance set by Flicker; the base layer
    // (bit 0) less often, so a view never vanishes for long.
    flickMask = 0;
    for (let k = 0; k < 4; k++) {
      const chance = flicker * (k === 0 ? 0.15 : 0.45);
      if (Math.random() < chance) flickMask |= 1 << k;
    }
  }

  tour = stepTour(tour, {
    timeSec: anim.timeSec,
    dtSec: dt,
    beats: anim.beats,
    pick: get("view"),
    auto: get("auto") > 0.5,
    holdSec: get("hold") * 60,
    count: VIEWS.length,
    locked: viewLocked,
  });
}

const extraUniforms = () => ({
  uT: t,
  uLaunchAge: launchAge,
  uLaunchAmp: launchAmp,
  uLaunchSeed: launchSeed,
  uPhrase: phrase,
  uPhraseN: phraseN,
  uPhraseAge: phraseAge,
  uFlickMask: flickMask,
  uStrobe: strobe,
});

const children: Scene[] = VIEWS.map((v) =>
  createFullscreenScene(ID, NAME, viewFragBody(v.glsl), {
    settings: LONGPLAY_SETTINGS,
    extraUniformDecls: LONGPLAY_UNIFORMS_GLSL,
    extraUniforms,
  }),
);
const ready = new Set<number>();

function ensure(ctx: SceneContext, i: number): void {
  if (ready.has(i)) return;
  children[i].init(ctx);
  ready.add(i);
}

export const longPlayScene: Scene = {
  id: ID,
  name: NAME,
  settings: LONGPLAY_SETTINGS,

  probe: () => ({ view: tour.cur, next: tour.next, mix: tour.mixing ? tour.mix : 0 }),

  init() {
    resetState();
  },

  render(ctx, frame, viewport, palette, anim, drives = PASSTHROUGH_DRIVES) {
    // A room's several viewports render the same frame more than once —
    // the state steps once per frame.
    if (anim.timeSec !== lastTimeSec) {
      step(anim, drives);
      lastTimeSec = anim.timeSec;
    }
    ensure(ctx, tour.cur);
    children[tour.cur].render(ctx, frame, viewport, palette, anim, drives);
    const w = mixWeight(tour);
    if (w > 0) {
      ensure(ctx, tour.next);
      const g = ctx.gl;
      g.enable(g.BLEND);
      g.blendColor(0, 0, 0, w);
      g.blendFunc(g.CONSTANT_ALPHA, g.ONE_MINUS_CONSTANT_ALPHA);
      children[tour.next].render(ctx, frame, viewport, palette, anim, drives);
      g.disable(g.BLEND);
    }
  },

  dispose(ctx) {
    for (const i of ready) children[i].dispose(ctx);
    ready.clear();
  },
};
