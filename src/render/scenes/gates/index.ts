import { createFullscreenScene } from "../../fullscreenScene.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import type { SignalLink } from "../../signals.ts";
import type { AnimFrame } from "../../animClock.ts";
import { GATES_FRAG } from "./glsl.ts";

// A perspective tunnel of neon wireframe gates — hexagon rings, rectangular
// frames, glowing rods and panels — flying at the camera in mirrored
// wedges, after the VJ loop 4PsXO3JsQdg ("Neon Groove Vibes"): small and
// crisp at the vanishing point, huge and streaked at the edges, on black.
// glsl.ts owns the picture.
//
// What the reference does with the music, measured (tools/ref-scan.py):
// nothing — the video is silent by design and a short loop repeated for
// hours, its hard cuts between looks (a shape set plus a palette, the
// looks in lookPrimary/lookSecondary in glsl.ts) landing on a fixed timer,
// with one blackout frame per loop. So the cuts here are ours to place:
// on bar boundaries — a wrap of anim.barPhase, the ambience.ts precedent —
// with the odds set by Cut rate, plus half-bar cuts once Cut rate is high,
// never the same look twice in a row; a blackout frame followed by a cut
// on every BARS_PER_PHRASE-th bar and on a drop (anim.dropOnset); and a
// free-running bar timer while there is no tempo lock, because barPhase
// freezes without a tempo and a silent room would otherwise never cut.
// The fly speed rides the low band, an onset flashes the nearest gate, and
// each cut flips the spin direction so a cut reads as a regime change.
// Rates scale, positions accumulate (travel, spin) — the flowClock lesson.
//
// The scheduler (advanceGates) is pure and exported for tests/gates.test.ts;
// the scene keeps one instance in its extraUniforms closure.

/** Looks the cut cycles through — must match the if-chains in glsl.ts. */
export const LOOK_COUNT = 5;
/** Every this-many bars: a blackout frame, then the cut. */
export const BARS_PER_PHRASE = 4;
/** Bar length while there is no tempo lock (a 120 bpm bar). */
export const FREE_BAR_SEC = 2.0;
/** Half-bar cuts start once Cut rate passes this, scaled by the gain. */
const HALF_BAR_CUT_FROM = 0.4;
const HALF_BAR_CUT_GAIN = 1.5;
/** Fly speed in depth slots per second at Speed 0 and 1, and the extra
 *  factor the low band adds. */
const FLY_MIN = 0.4;
const FLY_MAX = 3.0;
const FLY_BASS_GAIN = 0.8;
/** Spin in radians per second at Spin = 1. */
const SPIN_RAD_MAX = 0.6;
/** Onset flash: the jump per onset, its cap, and its decay per second. */
const FLASH_HIT = 1.0;
const FLASH_CAP = 1.5;
const FLASH_DECAY = 5.0;

export interface GateState {
  /** Which look the tunnel is showing. */
  look: number;
  /** Bumped on every cut; re-hashes which shape sits in which slot. */
  cutSeed: number;
  /** Bar boundaries seen so far. */
  bars: number;
  lastBarPhase: number;
  /** Free-running bar clock while there is no tempo lock. */
  freeTimer: number;
  /** This frame is black; the pending cut lands on the frame after it. */
  blackFrame: 0 | 1;
  pendingCut: boolean;
  flash: number;
  spinDir: 1 | -1;
  /** Accumulated travel in depth slots, and spin in radians. */
  travel: number;
  spinPos: number;
  /** Last frame's fly speed, slots/s — the shader's streak length. */
  flyRate: number;
  prevDrop: boolean;
}

export function createGateState(): GateState {
  return {
    look: 0,
    cutSeed: 0,
    bars: 0,
    lastBarPhase: 0,
    freeTimer: 0,
    blackFrame: 0,
    pendingCut: false,
    flash: 0,
    spinDir: 1,
    travel: 0,
    spinPos: 0,
    flyRate: FLY_MIN,
    prevDrop: false,
  };
}

/** The slice of AnimFrame the scheduler reads — tests build just this. */
export type GateAnim = Pick<AnimFrame, "dtSec" | "barPhase" | "tempoLock" | "onset" | "dropOnset" | "low">;

export interface GateOpts {
  speed: number;
  cutRate: number;
  spin: number;
  blackouts: boolean;
}

/** A look other than `prev`, uniform over the rest. */
export function pickLook(prev: number, rng: () => number): number {
  return (prev + 1 + Math.floor(rng() * (LOOK_COUNT - 1))) % LOOK_COUNT;
}

/** Advances the scheduler by one rendered frame, in place. */
export function advanceGates(st: GateState, anim: GateAnim, opts: GateOpts, rng: () => number = Math.random): void {
  const dt = Number.isFinite(anim.dtSec) ? Math.max(0, anim.dtSec) : 0;

  const cut = () => {
    st.look = pickLook(st.look, rng);
    st.cutSeed += 1;
    st.spinDir = st.spinDir === 1 ? -1 : 1;
  };
  const blackoutThenCut = () => {
    if (opts.blackouts) {
      st.blackFrame = 1;
      st.pendingCut = true;
    } else {
      cut();
    }
  };

  // Last frame was black: the cut it announced lands now.
  if (st.blackFrame) {
    st.blackFrame = 0;
    if (st.pendingCut) {
      cut();
      st.pendingCut = false;
    }
  }

  let boundary = false;
  let half = false;
  if (anim.tempoLock > 0.5) {
    boundary = anim.barPhase < st.lastBarPhase - 0.5;
    half = st.lastBarPhase < 0.5 && anim.barPhase >= 0.5;
    st.freeTimer = 0;
  } else {
    st.freeTimer += dt;
    if (st.freeTimer >= FREE_BAR_SEC) {
      boundary = true;
      st.freeTimer = 0;
    }
  }
  st.lastBarPhase = anim.barPhase;

  if (boundary) {
    st.bars += 1;
    if (st.bars % BARS_PER_PHRASE === 0) blackoutThenCut();
    else if (rng() < opts.cutRate) cut();
  } else if (half && rng() < Math.max(0, opts.cutRate - HALF_BAR_CUT_FROM) * HALF_BAR_CUT_GAIN) {
    cut();
  }

  const drop = anim.dropOnset && !st.prevDrop;
  st.prevDrop = anim.dropOnset;
  if (drop) blackoutThenCut();

  if (anim.onset) st.flash = Math.min(FLASH_CAP, st.flash + FLASH_HIT);
  st.flash *= Math.exp(-dt * FLASH_DECAY);

  st.flyRate = (FLY_MIN + (FLY_MAX - FLY_MIN) * opts.speed) * (1 + FLY_BASS_GAIN * anim.low);
  st.travel += st.flyRate * dt;
  st.spinPos += st.spinDir * SPIN_RAD_MAX * opts.spin * dt;
}

const SETTINGS: SceneSetting[] = [
  {
    key: "symmetry",
    label: "Symmetry",
    description: "How many mirrored wedges the tunnel folds into — each gate appears once per pair of wedges, on the cardinal or the diagonal axes",
    group: "Form",
    type: "enum",
    options: ["4", "6", "8"],
    min: 0,
    max: 2,
    step: 1,
    default: 2,
    // Framing the user picks to taste, like Kaleidoscope's Symmetry.
  },
  {
    key: "density",
    label: "Gate density",
    description: "How many gates are in the tunnel at once — sparse rings at the low end, a crowded corridor at the high end",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { density: 0.3 },
  },
  {
    key: "shapeMix",
    label: "Shape mix",
    description: "Rings and frames at the low end, rods and panels at the high end",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
  },
  {
    key: "speed",
    label: "Speed",
    description: "How fast the gates fly at you; the bass pushes it further",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { tempo: 0.35, loudness: 0.15 },
  },
  {
    key: "cutRate",
    label: "Cut rate",
    description: "How often a bar boundary hard-cuts to another look; past the middle, half-bars can cut too. Every fourth bar and every drop cut regardless",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { pulse: 0.3, dynamics: 0.2 },
    reads: ["anim.dropOnset"] satisfies readonly SignalLink[],
  },
  {
    key: "spin",
    label: "Spin",
    description: "How fast the tunnel turns; every cut reverses it",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
    auto: { tempo: 0.2 },
  },
  {
    key: "streaks",
    label: "Streaks",
    description: "How far the gates smear toward the centre as they fly — motion blur, longest on the nearest gates",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { loudness: 0.25 },
  },
  {
    key: "glow",
    label: "Glow",
    description: "How bright the neon burns; a beat flashes the nearest gate",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { brightness: 0.2, loudness: 0.2 },
    reads: ["feature.onset"] satisfies readonly SignalLink[],
  },
  {
    key: "blackouts",
    label: "Blackouts",
    description: "A single black frame before the cut on every fourth bar and on a drop, the way the reference loop drops out",
    group: "Look",
    type: "boolean",
    min: 0,
    max: 1,
    step: 1,
    default: 1,
    reads: ["anim.dropOnset"] satisfies readonly SignalLink[],
  },
];

export const gatesScene = createFullscreenScene("gates", "Neon Gates", GATES_FRAG, {
  minQuality: "low",
  settings: SETTINGS,
  // Named apart from the generated u<Key> uniforms (uSpin, uSpeed, uBlackouts):
  // a redefinition is a silent compile failure.
  extraUniformDecls: `uniform float uTravel;\nuniform float uSpinPos;\nuniform float uLook;\nuniform float uCutSeed;\nuniform float uBlackFrame;\nuniform float uFlash;\nuniform float uFlyRate;`,
  extraUniforms: (() => {
    const st = createGateState();
    return (_frame, anim, getSetting) => {
      // anim.onset / anim.dropOnset, not frame.onset: the render cap can skip
      // the tick the feature fired on (renderLatch.ts).
      advanceGates(st, anim, {
        speed: getSetting("speed"),
        cutRate: getSetting("cutRate"),
        spin: getSetting("spin"),
        blackouts: getSetting("blackouts") > 0.5,
      });
      return {
        uTravel: st.travel,
        uSpinPos: st.spinPos,
        uLook: st.look,
        uCutSeed: st.cutSeed,
        uBlackFrame: st.blackFrame,
        uFlash: st.flash,
        uFlyRate: st.flyRate,
      };
    };
  })(),
});
