/**
 * The clip player: which captured move is being danced, where in its loop
 * we are, and how one move hands over to the next.
 *
 * Clock: clips are never advanced by wall time. A clip's phase is a
 * function of the bars elapsed since it started (createBarCounter) and the
 * current bar phase, so the dancer can't drift off the beat however the
 * tempo estimate wanders, a clip authored at 100 bpm simply plays faster at
 * 128, and every move starts at its own frame 0 on a downbeat.
 * Speed-warping a move by more than roughly ±30 % stops looking like the
 * move, so past HALF_TIME_RATIO the clip is spread over twice its bars
 * (every clip beat on every other music beat) and below DOUBLE_TIME_RATIO it
 * is played twice as fast — the same trick a dancer uses when the DJ speeds
 * up.
 *
 * Picker: re-evaluated only on bar boundaries, and only once the current
 * move has been held for HOLD_LOOPS loops (a move you can't watch for a few
 * bars isn't a move). Candidates are the family asked for (or all), scored
 * by how close their energy is to the intensity the music asks for, with a
 * penalty on recent repeats and a little seeded randomness so the same
 * track doesn't always dance the same. A drop pulse forces the biggest move
 * available at the next bar.
 *
 * Handover, two ways (BlendMode, the `blend` setting): a crossfade (nlerp)
 * over FADE_BARS, where both clips keep dancing and the pose slides from
 * one to the other — both are phase-locked so the blend never fights the
 * beat; or inertialization, where at the switch the offset between the
 * pose being shown and the new clip's pose is captured and decayed to zero
 * over FADE_BARS while only the new clip plays — the old move stops dead
 * and the new one takes over from where the body actually is, so a drop
 * hits harder and nothing mid-blend looks like neither move. Pure and
 * DOM/GL-free — tests/dancersPlayer.test.ts drives it.
 */
import { sampleClip, type Clip, type ClipLibrary, type ClipMeta } from "./clipFormat.ts";
import { BONE_COUNT, boneChannel, createPose, lerpPose, quatConjugate, quatMul, quatNlerp, type Pose } from "./rig.ts";

export type BlendMode = "crossfade" | "inertial";

export const BEATS_PER_BAR = 4;
/** bpm / nativeBpm above which the clip goes half-time. */
export const HALF_TIME_RATIO = 1.35;
/** bpm / nativeBpm below which the clip goes double-time. */
export const DOUBLE_TIME_RATIO = 0.7;
/** Loops of a clip danced before the picker looks for another. */
export const HOLD_LOOPS = 2;
/** Bars a handover crossfade takes. */
export const FADE_BARS = 0.5;
/** Picker penalty for a clip danced within the last few picks. */
const REPEAT_PENALTY = 0.35;
/** Picker penalty for picking the clip that's already playing. */
const SAME_PENALTY = 0.6;
const HISTORY = 3;
const JITTER = 0.15;

/** Music bars one loop of the clip spans at this tempo. */
export function clipCycleBars(clip: ClipMeta, bpm: number): number {
  const bars = clip.beats / BEATS_PER_BAR;
  if (!(bpm > 0) || !(clip.nativeBpm > 0)) return bars;
  const ratio = bpm / clip.nativeBpm;
  if (ratio > HALF_TIME_RATIO) return bars * 2;
  if (ratio < DOUBLE_TIME_RATIO) return bars * 0.5;
  return bars;
}

/** 0..1 phase around the clip's loop for `barsElapsed` (integer bars plus
 *  the current bar's phase) at tempo `bpm`. */
export function clipPhaseAt(clip: ClipMeta, bpm: number, barsElapsed: number): number {
  const cycle = clipCycleBars(clip, bpm);
  const x = barsElapsed / cycle;
  return x - Math.floor(x);
}

export interface BarCounter {
  /** Feeds this frame's barPhase and returns fractional bars elapsed since
   *  the counter started — monotonic, wrapping the bar count on every
   *  barPhase wrap. */
  advance(barPhase: number): number;
}

export function createBarCounter(): BarCounter {
  let bars = 0;
  let last = 0;
  return {
    advance(barPhase) {
      if (barPhase < last) bars++;
      last = barPhase;
      return bars + barPhase;
    },
  };
}

/** A tiny seeded PRNG so a picker run reproduces in tests. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PlayerParams {
  /** 0..1 — what the picker matches clip energy against (effectiveIntensity). */
  intensity: number;
  /** Clip family to dance, or null for the whole library. */
  family: string | null;
  /** The section clock's drop flash; above 0.5 it forces a big move. */
  dropPulse: number;
  bpm: number;
  /** How one move hands over to the next. */
  blend: BlendMode;
}

export interface ClipPlayer {
  /** Writes this frame's pose into `out` and returns the clip it came from,
   *  or null (and leaves `out` alone) when there is nothing to dance. */
  advance(barPhase: number, params: PlayerParams, out: Pose): Clip | null;
  /** The clip currently being danced (the incoming one during a fade). */
  readonly current: Clip | null;
}

const smoothstep = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/** Chooses the next clip. Exported so the scoring is testable on its own. */
export function pickClip(
  library: ClipLibrary,
  params: PlayerParams,
  current: Clip | null,
  history: readonly string[],
  rand: () => number,
  forceBig: boolean,
): Clip | null {
  let candidates = library.clips;
  if (params.family) {
    const inFamily = candidates.filter((c) => c.family === params.family);
    if (inFamily.length > 0) candidates = inFamily;
  }
  if (candidates.length === 0) return null;
  let best: Clip | null = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    let score = forceBig ? c.bigness + 0.5 * c.energy : 1 - Math.abs(c.energy - params.intensity);
    if (history.includes(c.name)) score -= REPEAT_PENALTY;
    // A drop wants the biggest move even if that's the one already playing.
    if (!forceBig && current && c.name === current.name) score -= SAME_PENALTY;
    score += rand() * JITTER;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

export function createClipPlayer(library: ClipLibrary, seed = 1): ClipPlayer {
  const rand = mulberry32(seed);
  const bars = createBarCounter();
  let current: Clip | null = null;
  let currentStart = 0;
  let holdUntil = 0;
  let outgoing: Clip | null = null;
  let outgoingStart = 0;
  let switchBar = 0;
  let lastBar = -1;
  let dropPending = false;
  let lastDropPulse = 0;
  const history: string[] = [];
  const inPose = createPose();
  const outPose = createPose();
  // Inertialization state: the pose shown last frame, and the offset from
  // the new clip captured at the switch (root deltas + a quaternion per bone).
  const lastOut = createPose();
  let haveLast = false;
  const offset = createPose();
  let inertial = false;
  const IDENTITY = new Float32Array([0, 0, 0, 1]);
  const scratchQ = new Float32Array(4);

  const captureOffset = (next: Clip): void => {
    sampleClip(next, 0, inPose);
    for (let i = 0; i < 3; i++) offset[i] = lastOut[i] - inPose[i];
    for (let b = 0; b < BONE_COUNT; b++) {
      const ch = boneChannel(b);
      quatConjugate(inPose, ch, scratchQ, 0);
      quatMul(lastOut, ch, scratchQ, 0, offset, ch);
    }
  };

  /** out = new pose with `w` of the captured offset still applied. */
  const applyOffset = (w: number, out: Pose): void => {
    for (let i = 0; i < 3; i++) out[i] = inPose[i] + offset[i] * w;
    for (let b = 0; b < BONE_COUNT; b++) {
      const ch = boneChannel(b);
      quatNlerp(IDENTITY, 0, offset, ch, w, scratchQ, 0);
      quatMul(scratchQ, 0, inPose, ch, out, ch);
    }
  };

  const player: ClipPlayer = {
    get current() {
      return current;
    },
    advance(barPhase, params, out) {
      const elapsed = bars.advance(barPhase);
      const bar = Math.floor(elapsed);
      // Edge-triggered: the flash decays over many frames, and one drop is one pick.
      if (params.dropPulse > 0.5 && lastDropPulse <= 0.5) dropPending = true;
      lastDropPulse = params.dropPulse;

      // Bar boundary (or the very first frame): maybe pick.
      if (bar !== lastBar) {
        lastBar = bar;
        const due = current === null || bar >= holdUntil || dropPending;
        if (due) {
          const next = pickClip(library, params, current, history, rand, dropPending);
          dropPending = false;
          if (next && next !== current) {
            if (current) {
              switchBar = bar;
              if (params.blend === "inertial" && haveLast) {
                captureOffset(next);
                inertial = true;
                outgoing = null;
              } else {
                outgoing = current;
                outgoingStart = currentStart;
                inertial = false;
              }
              history.push(current.name);
              if (history.length > HISTORY) history.shift();
            }
            current = next;
            currentStart = bar;
          }
          if (current) holdUntil = bar + Math.max(1, Math.round(clipCycleBars(current, params.bpm) * HOLD_LOOPS));
        }
      }
      if (!current) return null;

      sampleClip(current, clipPhaseAt(current, params.bpm, elapsed - currentStart), inPose);
      const fade = outgoing || inertial ? (elapsed - switchBar) / FADE_BARS : 1;
      if (outgoing && fade < 1) {
        sampleClip(outgoing, clipPhaseAt(outgoing, params.bpm, elapsed - outgoingStart), outPose);
        lerpPose(outPose, inPose, smoothstep(fade), out);
      } else if (inertial && fade < 1) {
        applyOffset(1 - smoothstep(fade), out);
      } else {
        outgoing = null;
        inertial = false;
        out.set(inPose);
      }
      lastOut.set(out);
      haveLast = true;
      return current;
    },
  };
  return player;
}
