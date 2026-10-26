import type { EngineReading, FeatureFrame, HitKind } from "../audio/types.ts";
import { HIT_STRENGTH_MAX, NUM_BANDS } from "../audio/types.ts";
import { BAND_SPLIT } from "../audio/bandSplit.ts";
import type { OnsetDiag } from "../audio/onsetDiag.ts";
import { hitPasses } from "../audio/silenceGate.ts";
import { hitStrength, pulseDecayScale, type HitShape, type HitParts } from "../audio/hitStrength.ts";

// Bass, Mid and Treble: three lanes built from the audio engine's reading
// (FeatureFrame.engine, src/audio/engine/engine.ts), lane low/mid/high on the
// engine's kick/snare/hat. Per lane: a continuous level (the engine's own
// band level, safe to drive geometry with), a decaying pulse, and a one-shot
// onset edge, so a kick and a hat can drive visibly different things. Every
// device that draws runs this off the reading its frames carry, so the
// laptop, the pop-out and a TV build the same lanes.
//
// A lane's onset is its engine hit, or for Bass and Treble a rise in the
// engine's band level (RISE_WINDOW_S below), passing the silence gate
// (silenceGate.ts's hitPasses, `dimmer` below), on every device with its own
// marks. A pulse's height is graded by src/audio/hitStrength.ts when advance()
// is given a `shape`, from the hit's strength and how loud the lane's own
// range of `frame.bands` is (an absolute reading with auto-gain off, the
// default; src/audio/bandGains.ts's header). The pulse takes the larger of
// its own decaying tail and that grade, so a weak hit landing on a strong
// one's decay can't cut it down. With no `shape` a pulse snaps to a flat 1.
// The onset edges are never graded: a scene that cuts on the boolean fires on
// every hit.
//
// The band split (src/audio/bandSplit.ts) picks which of `frame.bands` the
// loudness reads. A null reading (no capture, a
// sender from before the engine) is nothing heard: levels ease out and
// nothing fires.

// The level slew slewLevel() eases Hats and Lead with (animClock.ts), and
// whose periods set the extra level smoothing below Smoothing's default.
const LEVEL_ATTACK_PER_SEC = 24;
const LEVEL_RELEASE_PER_SEC = 10;

// A zero or non-finite dtSec (a stalled clock, a test) would otherwise turn
// the slews' rates into Infinity*0 = NaN at Smoothing at 0.
const MIN_DT_SEC = 1e-4;

// Each lane's pulse fall rate, tied to the lane's role: a kick's pulse rings
// longest, a hat's is a flick. Exported because scenes (alien, sweep),
// gateWindow.ts, drives.ts's Graded heights and the meters time things
// against exactly these falls.
// riseRefractorySec spaces a lane's rise hits after any of its hits, and an
// engine hit after a rise hit, so the two count once; null = no rise hits.
export const GROUP_TUNING: Record<"low" | "mid" | "high", { pulseDecayRate: number; riseRefractorySec: number | null }> = {
  low: { pulseDecayRate: 3.5, riseRefractorySec: 0.1 },
  mid: { pulseDecayRate: 6, riseRefractorySec: null },
  high: { pulseDecayRate: 10, riseRefractorySec: 0.05 },
};

const KIND_OF_LANE: Record<"low" | "mid" | "high", HitKind> = { low: "kick", mid: "snare", high: "hat" };

// Bass and Treble also fire on a jump in the engine's own band level, while
// the engine hears music (RISE_CONFIDENCE): its rise over the level's
// minimum across RISE_WINDOW_S, against a running mean plus RISE_K deviations
// over RISE_STATS_S, never under RISE_MIN. The engine gives each attack one name,
// so a hat landing with a kick or snare, and a kick through speakers with no
// bass, never reached their lanes (#682; the bench's Hits by kind,
// docs/audio-engine.md). The engine's level, not `frame.bands`: through laptop
// speakers it found twice the kicks. A window rather than a frame-to-frame
// step, because a TV's levels are interpolated from wire frames and a step
// there is spread over two render ticks. Mid keeps the engine's snares alone:
// a rise in the mids fired on kicks and hats and halved isolated-snare F.
// Without music the room's own sound (talking, a fan) rose often enough to
// fire over 200 hits a minute on the laptop recordings.
export const RISE_WINDOW_S = 0.04;
const RISE_STATS_S = 1;
export const RISE_K = 2;
const RISE_MIN = 0.05;
// Loud talking or knocks near the mic can hold the engine's presence on with
// no music, and rises then fire there too. Tuned on the bench's no-music
// rooms (2026-10-24): at engine/tempo.ts's MUSIC_ON the hits a minute with no
// music rose from 9.88 to 10.29, at this line to 9.95. Against MUSIC_ON it
// cost a little of the music's hits (laptop kick F 0.83 to 0.80) and kept
// rises off isolated hits (isolated hat F 0.62 to 0.71).
const RISE_CONFIDENCE = 0.5;
// Too few samples to span RISE_WINDOW_S at a fast frame rate only shortens the window.
const RISE_RING = 16;

function clampDt(dtSec: number): number {
  return Number.isFinite(dtSec) ? Math.max(MIN_DT_SEC, dtSec) : MIN_DT_SEC;
}

/** One tick of a level slew: rises at LEVEL_ATTACK_PER_SEC, falls at
 *  LEVEL_RELEASE_PER_SEC, both times rateScale (Smoothing). Exported
 *  so animClock.ts eases its Hats and Lead levels the same way. */
export function slewLevel(level: number, raw: number, dtSec: number, rateScale: number): number {
  const dt = clampDt(dtSec);
  const rate = raw > level ? LEVEL_ATTACK_PER_SEC : LEVEL_RELEASE_PER_SEC;
  return level + (raw - level) * Math.min(1, rate * rateScale * dt);
}

/** The engine already eases its levels down, and its latency is the point,
 *  so at or above Smoothing's default this adds nothing. Slower settings add
 *  a slew whose time constants grow from zero there by the old level slew's
 *  periods. */
function smoothEngineLevel(level: number, raw: number, dt: number, rateScale: number): number {
  if (!(rateScale < 1)) return raw;
  const stretch = 1 / rateScale - 1;
  const tau = stretch / (raw > level ? LEVEL_ATTACK_PER_SEC : LEVEL_RELEASE_PER_SEC);
  return level + (raw - level) * (1 - Math.exp(-dt / tau));
}

function meanRange(bands: Float32Array, lo: number, hi: number): number {
  if (hi <= lo) return 0;
  let sum = 0;
  for (let i = lo; i < hi; i++) sum += bands[i];
  return sum / (hi - lo);
}

interface LaneState {
  level: number;
  /** Seconds since this lane's last onset. Starts at Infinity: no hit yet. */
  sinceOnsetSec: number;
  pulse: number;
  onset: boolean;
  /** Mutated in place every advance(), never replaced (BandEnergy's lowDiag). */
  diag: OnsetDiag;
  /** The last graded hit, mutated in place on an onset (BandEnergy's lowHit). */
  hit: HitParts;
  /** Seconds this lane has advanced; stamps the rise window's samples. */
  clock: number;
  riseLevels: Float64Array;
  riseTimes: Float64Array;
  risePos: number;
  riseMean: number;
  riseDev: number;
  /** The last onset was a rise, not an engine hit. */
  lastWasRise: boolean;
}

function makeLaneState(): LaneState {
  return {
    level: 0,
    sinceOnsetSec: Infinity,
    pulse: 0,
    onset: false,
    diag: { ratio: 0, gated: false, blocked: false, sinceOnsetSec: Infinity },
    hit: { standout: 0, loudness: 0, strength: 0 },
    clock: 0,
    riseLevels: new Float64Array(RISE_RING),
    riseTimes: new Float64Array(RISE_RING).fill(-Infinity),
    risePos: 0,
    riseMean: 0,
    riseDev: 0,
    lastWasRise: false,
  };
}

/** The level's rise this tick as a hit strength: 1 at the running threshold. */
function laneRise(state: LaneState, level: number, dt: number): number {
  state.clock += dt;
  let base = level;
  for (let j = 0; j < RISE_RING; j++) {
    if (state.clock - state.riseTimes[j] <= RISE_WINDOW_S) base = Math.min(base, state.riseLevels[j]);
  }
  state.riseLevels[state.risePos] = level;
  state.riseTimes[state.risePos] = state.clock;
  state.risePos = (state.risePos + 1) % RISE_RING;
  const rise = level - base;
  const threshold = Math.max(RISE_MIN, state.riseMean + RISE_K * state.riseDev);
  const a = Math.min(1, dt / RISE_STATS_S);
  state.riseMean += (rise - state.riseMean) * a;
  state.riseDev += (Math.abs(rise - state.riseMean) - state.riseDev) * a;
  return Math.min(HIT_STRENGTH_MAX, rise / threshold);
}

function advanceLane(
  state: LaneState,
  lane: "low" | "mid" | "high",
  dt: number,
  engine: EngineReading | null,
  loudness: number,
  rateScale: number,
  dimmer: number,
  shape: HitShape | undefined,
): void {
  const kind = KIND_OF_LANE[lane];
  const engineStrength = engine ? engine[kind] : 0;
  state.level = engine ? smoothEngineLevel(state.level, engine[lane], dt, rateScale) : slewLevel(state.level, 0, dt, rateScale);

  const refractory = GROUP_TUNING[lane].riseRefractorySec;
  const riseStrength = refractory !== null && engine ? laneRise(state, engine[lane], dt) : 0;
  state.sinceOnsetSec += dt;
  const settled = refractory === null || state.sinceOnsetSec >= refractory;
  const engineFires = hitPasses(engineStrength, dimmer) && (settled || !state.lastWasRise);
  const riseCounts = !engineFires && settled && !!engine?.music && engine.confidence >= RISE_CONFIDENCE;
  const riseFires = riseCounts && hitPasses(riseStrength, dimmer);
  const passes = engineFires || riseFires;
  const strength = riseFires ? riseStrength : engineStrength;
  state.onset = passes;
  const surge = engine && engine.surgeKind === kind;
  state.diag.ratio = strength > 0 ? strength : surge ? engine.surge : 0;
  state.diag.gated = !passes && (hitPasses(engineStrength, 1) || (riseCounts && hitPasses(riseStrength, 1)));
  state.diag.blocked = !!surge && engine.blocked;
  state.diag.sinceOnsetSec = state.sinceOnsetSec;
  if (passes) {
    state.sinceOnsetSec = 0;
    state.lastWasRise = riseFires;
  }

  state.pulse *= Math.exp(-dt * GROUP_TUNING[lane].pulseDecayRate * rateScale * pulseDecayScale(shape, lane));
  if (passes) {
    if (shape) {
      const hit = hitStrength(strength, loudness, shape, state.hit);
      state.pulse = Math.max(state.pulse, hit.strength);
    } else {
      state.pulse = 1;
    }
  }
}

export interface BandEnergy {
  low: number;
  mid: number;
  high: number;
  lowPulse: number;
  midPulse: number;
  highPulse: number;
  /** One-shot edges, true only on the tick that lane's engine hit passed the
   *  silence gate. */
  lowOnset: boolean;
  midOnset: boolean;
  highOnset: boolean;
  /** Per-lane onset diagnostics (onsetDiag.ts's OnsetDiag). Aliases of state
   *  mutated every advance(), so reading them never allocates; read them
   *  before the next advance(). */
  lowDiag: OnsetDiag;
  midDiag: OnsetDiag;
  highDiag: OnsetDiag;
  /** Per-lane last graded hit (hitStrength.ts's HitParts), aliased the same
   *  way; only written while advance() is given a `shape`. */
  lowHit: HitParts;
  midHit: HitParts;
  highHit: HitParts;
  /** `rateScale` (sensitivity.ts's smoothingRateScale) scales the level
   *  smoothing and pulse falls, never which hits fire. `dimmer` is the
   *  silence gate's (silenceGate.ts), 1 = ungated, so a caller with no marks
   *  (a preview, gallery or probe tile) is unaffected. `shape` grades pulse
   *  heights; only animClock.ts's real entry points pass one. */
  advance(dtSec: number, frame: FeatureFrame, rateScale?: number, dimmer?: number, shape?: HitShape): void;
}

export function createBandEnergy(): BandEnergy {
  const low = makeLaneState();
  const mid = makeLaneState();
  const high = makeLaneState();

  const result: BandEnergy = {
    low: 0,
    mid: 0,
    high: 0,
    lowPulse: 0,
    midPulse: 0,
    highPulse: 0,
    lowOnset: false,
    midOnset: false,
    highOnset: false,
    lowDiag: low.diag,
    midDiag: mid.diag,
    highDiag: high.diag,
    lowHit: low.hit,
    midHit: mid.hit,
    highHit: high.hit,
    advance(dtSec: number, frame: FeatureFrame, rateScale = 1, dimmer = 1, shape?: HitShape): void {
      const dt = clampDt(dtSec);
      const engine = frame.engine;
      const { lowMid, midHigh } = BAND_SPLIT;
      const bands = frame.bands;
      advanceLane(low, "low", dt, engine, meanRange(bands, 0, lowMid), rateScale, dimmer, shape);
      advanceLane(mid, "mid", dt, engine, meanRange(bands, lowMid, midHigh), rateScale, dimmer, shape);
      advanceLane(high, "high", dt, engine, meanRange(bands, midHigh, NUM_BANDS), rateScale, dimmer, shape);

      result.low = low.level;
      result.mid = mid.level;
      result.high = high.level;
      result.lowPulse = low.pulse;
      result.midPulse = mid.pulse;
      result.highPulse = high.pulse;
      result.lowOnset = low.onset;
      result.midOnset = mid.onset;
      result.highOnset = high.onset;
    },
  };

  return result;
}
