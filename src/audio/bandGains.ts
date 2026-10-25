import { NUM_BANDS, type EngineReading, type FeatureFrame } from "./types.ts";
import { parseSyncedObject, registerSyncedStore } from "../net/syncedStores.ts";
import { BAND_SPLIT } from "./bandSplit.ts";

/**
 * Per-scene band gain — a bank of BAND_FADER_COUNT faders across the band
 * ladder, graphic-EQ style: each fader owns a run of neighbouring bands and
 * says how hard they drive the visuals. Centre of the travel is 1× (band
 * passes through untouched), up boosts, down cuts, the very bottom is Off.
 * This is the DJ-mixer control the app wants — not "which frequencies count
 * as bass" (bandSplit.ts's crossover, which only feeds the low/mid/
 * high pulse groups in bandEnergy.ts and the strip's bar tints) but "how
 * much does this part of the spectrum matter to the picture".
 *
 * Per-scene, not global per device,
 * since a gain is a preference for one scene's look, not a description of
 * the room. The UI is src/ui/bandFaders.ts, drawn over the spectrum strip
 * inside deviceMenu.ts's Bands card.
 *
 * Boost and cut both earn their place because of autoGain.ts: with
 * auto-gain off (the default) a band is a fixed-window dB reading, so the
 * music's real bass-heavy tilt reaches here and a treble boost has genuine
 * headroom; with auto-gain on every band already sits near full and only
 * cuts do much (applyBandGains clamps at 1 either way — see pinnedBands).
 *
 * Storage is one per-scene float per fader ("vibe.bandFader.<i>"). The
 * three low/mid/high keys this replaced are left where they are — three
 * values don't map onto a fader bank, and stale per-scene taste isn't worth
 * a migration.
 */

// The store's real range: 0 is a full kill (a fader's bands stop driving
// anything), 4 is max boost. Matches Sensitivity/Contrast's ceiling so all
// the gain controls in the panel feel the same at their loud end.
export const BAND_GAIN_MIN = 0;
export const BAND_GAIN_MAX = 4;
export const BAND_GAIN_DEFAULT = 1;

// UI-only: a fader's log-mapped travel spans down to this floor, not all the
// way to 0 (log(0) is undefined) — the bottom of the travel snaps straight
// to BAND_GAIN_MIN instead (see faderPosToGain). Chosen so the travel is
// symmetric around BAND_GAIN_DEFAULT in log terms: as far below 1× as
// BAND_GAIN_MAX is above it, which is what puts 1× at the centre. Kept
// here, next to the store range it's paired with, rather than in the UI.
export const BAND_GAIN_LOG_FLOOR = 0.25;

export const BAND_FADER_COUNT = 6;

// Fader travel is a position in [0,1] from bottom to top. Positions at or
// below the Off zone read as Off; above it the log curve runs from
// BAND_GAIN_LOG_FLOOR to BAND_GAIN_MAX. A narrow detent around the 1×
// position lets a finger land on "no change" without hunting for it.
export const FADER_OFF_ZONE = 0.04;
export const FADER_DETENT = 0.035;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

const LOG_SPAN = Math.log(BAND_GAIN_MAX / BAND_GAIN_LOG_FLOOR);

/** Fader position -> gain. Off below the Off zone, exactly BAND_GAIN_DEFAULT
 *  inside the centre detent, log-mapped elsewhere. */
export function faderPosToGain(pos: number): number {
  const p = clamp01(pos);
  if (p <= FADER_OFF_ZONE) return BAND_GAIN_MIN;
  if (Math.abs(p - FADER_CENTER_POS) < FADER_DETENT) return BAND_GAIN_DEFAULT;
  const t = (p - FADER_OFF_ZONE) / (1 - FADER_OFF_ZONE);
  return BAND_GAIN_LOG_FLOOR * Math.exp(LOG_SPAN * t);
}

/** Gain -> fader position (the inverse of faderPosToGain outside the detent). */
export function gainToFaderPos(gain: number): number {
  if (gain <= BAND_GAIN_MIN) return 0;
  const t = clamp01(Math.log(gain / BAND_GAIN_LOG_FLOOR) / LOG_SPAN);
  return FADER_OFF_ZONE + t * (1 - FADER_OFF_ZONE);
}

/** Where 1× sits on the travel — the centre line the faders rest on. */
export const FADER_CENTER_POS = gainToFaderPos(BAND_GAIN_DEFAULT);

// One per-scene float per key, in-memory over localStorage: the cache is the
// source of truth within a session, so get/set stay correct where
// localStorage is unavailable (node test env, Safari private mode). Each
// store registers a net/syncedStores.ts hook, so a snapshot applied from
// outside (the pop-out's Cue, a room look arriving on a TV) re-seeds the
// cache in place; that is what makes every fader live on a second window or
// screen.
function createPerSceneSetting(storageKey: string, min: number, max: number, defaultValue: number) {
  /** What localStorage holds under `storageKey`, as a plain record of finite
   *  numbers. Throws on text that is not a JSON object, so the reload hook
   *  keeps its cache. */
  function readStoredStrict(): Record<string, number> {
    const parsed = parseSyncedObject(localStorage.getItem(storageKey));
    const out: Record<string, number> = {};
    if (parsed === null) return out;
    for (const k of Object.keys(parsed)) {
      const v = parsed[k];
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
    return out;
  }

  function loadInitial(): Record<string, number> {
    try {
      return readStoredStrict();
    } catch {
      return {};
    }
  }

  const cache: Record<string, number> = loadInitial();

  // Reads before it clears, so unreadable text throws out of here and leaves
  // the cache alone.
  registerSyncedStore(storageKey, () => {
    const stored = readStoredStrict();
    for (const k of Object.keys(cache)) delete cache[k];
    for (const k of Object.keys(stored)) cache[k] = stored[k];
  });

  function persist(): void {
    try {
      localStorage.setItem(storageKey, JSON.stringify(cache));
    } catch {
      // Not fatal — the setting just won't persist across reloads.
    }
  }

  function clamp(value: number): number {
    if (!Number.isFinite(value)) return defaultValue;
    return Math.min(max, Math.max(min, value));
  }

  return {
    get(sceneId: string): number {
      const value = cache[sceneId];
      return typeof value === "number" ? clamp(value) : defaultValue;
    },
    set(sceneId: string, value: number): void {
      cache[sceneId] = clamp(value);
      persist();
    },
  };
}

const stores = Array.from({ length: BAND_FADER_COUNT }, (_, i) =>
  createPerSceneSetting(`vibe.bandFader.${i}`, BAND_GAIN_MIN, BAND_GAIN_MAX, BAND_GAIN_DEFAULT),
);

// Reused across calls: getBandGains runs every rAF tick in app.ts.
const scratchGains = new Float32Array(BAND_FADER_COUNT);

/** Every fader's gain for a scene, written into `out` (default: a shared
 *  scratch — copy if you need to hold onto it). */
export function getBandGains(sceneId: string, out: Float32Array = scratchGains): Float32Array {
  for (let i = 0; i < BAND_FADER_COUNT; i++) out[i] = stores[i].get(sceneId);
  return out;
}

export function getBandGain(sceneId: string, fader: number): number {
  return stores[fader].get(sceneId);
}

export function setBandGain(sceneId: string, fader: number, value: number): void {
  stores[fader].set(sceneId, value);
}

/** Every fader back to 1× — the Bands card's one Reset chip. */
export function resetBandGains(sceneId: string): void {
  for (const store of stores) store.set(sceneId, BAND_GAIN_DEFAULT);
}

export function isDefaultGains(gains: ArrayLike<number>): boolean {
  for (let i = 0; i < BAND_FADER_COUNT; i++) {
    if (gains[i] !== BAND_GAIN_DEFAULT) return false;
  }
  return true;
}

const BANDS_PER_FADER = NUM_BANDS / BAND_FADER_COUNT;

/** The half-open band-index span [lo, hi) fader `i` sits over. */
export function faderBandSpan(fader: number): [number, number] {
  return [Math.round(fader * BANDS_PER_FADER), Math.round((fader + 1) * BANDS_PER_FADER)];
}

/** The frequency to label fader `i` with: the geometric centre of its span,
 *  against a real (or nominal) edge table from bandScale.ts. */
export function faderCenterHz(fader: number, edgesHz: ArrayLike<number>): number {
  const [lo, hi] = faderBandSpan(fader);
  return Math.sqrt(edgesHz[lo] * edgesHz[hi]);
}

/**
 * Fader gains -> one weight per band. Each fader's gain is centred on its
 * span; a band between two fader centres takes a linear blend of the two,
 * and bands past the outermost centres take that outer fader's gain. So a
 * cut on one fader eases into its neighbours instead of stepping at the
 * span boundary — the look of a graphic EQ's curve, without one being drawn.
 */
export function faderWeights(gains: ArrayLike<number>, out: Float32Array): Float32Array {
  for (let b = 0; b < NUM_BANDS; b++) {
    const t = (b + 0.5) / BANDS_PER_FADER - 0.5;
    const i = Math.max(0, Math.min(BAND_FADER_COUNT - 2, Math.floor(t)));
    const f = clamp01(t - i);
    out[b] = gains[i] * (1 - f) + gains[i + 1] * f;
  }
  return out;
}

// Reused across calls to avoid a per-frame allocation in the render loop.
const scratchBands = new Float32Array(NUM_BANDS);
const scratchWeights = new Float32Array(NUM_BANDS);
const pinned = new Uint8Array(NUM_BANDS);

/** Which bands the last applyBandGains call clamped: their gained value
 *  would have gone past 1. Lets the strip show that a boost has stopped
 *  doing anything. Rewritten in place every call, including the fast path. */
export function pinnedBands(): Uint8Array {
  return pinned;
}

const scratchEngine: EngineReading = {
  low: 0,
  mid: 0,
  high: 0,
  kick: 0,
  snare: 0,
  hat: 0,
  surge: 0,
  surgeKind: "kick",
  blocked: false,
  music: false,
  confidence: 0,
  beatTime: 0,
  downbeatTime: 0,
  downbeatConfidence: 0,
  updates: 0,
};

/** The mean of `weights` over bands [lo, hi). */
function meanWeight(weights: Float32Array, lo: number, hi: number): number {
  let sum = 0;
  for (let b = lo; b < hi; b++) sum += weights[b];
  return sum / (hi - lo);
}

/**
 * Scales each band by its fader weight (faderWeights) before anything
 * downstream reads the frame. Applied upstream of both animClock.advance
 * and applySensitivity (the uBands shader uniform), so one control governs
 * both. Result is re-clamped to [0,1] since features.ts's contract is that
 * bands stay normalized (see clamp01 there) and a >1x gain can otherwise
 * punch through that; the bands that hit the clamp are recorded in
 * pinnedBands.
 *
 * The engine reading (types.ts's EngineReading) gets the same control per
 * lane: each of its low, mid and high is scaled by the mean weight over the
 * band split's range for it (bandSplit.ts), and so is that lane's hit
 * strength (kick, snare, hat) and a surge nearest it, so a fader at Off stops
 * its range driving anything and a boost lets that range's hits through a
 * half-closed silence gate. energy/level/hats/lead/onset/pulseOnset/bpm/
 * onsetPhase pass through untouched — this is a per-band control, not a
 * broadband one (that's Sensitivity/Contrast's job), and level in particular
 * must stay the raw, un-gained reading: it's auto mode's input signal (see
 * types.ts), so shaping it here would feed the gain stage its own output,
 * same as applySensitivity.
 */
export function applyBandGains(frame: FeatureFrame, gains: ArrayLike<number>): FeatureFrame {
  if (isDefaultGains(gains)) {
    pinned.fill(0);
    return frame;
  }

  faderWeights(gains, scratchWeights);
  for (let b = 0; b < NUM_BANDS; b++) {
    const v = frame.bands[b] * scratchWeights[b];
    pinned[b] = v > 1 ? 1 : 0;
    scratchBands[b] = v > 1 ? 1 : v;
  }

  let engine: EngineReading | null = null;
  if (frame.engine) {
    const { lowMid, midHigh } = BAND_SPLIT;
    const lane = {
      kick: meanWeight(scratchWeights, 0, lowMid),
      snare: meanWeight(scratchWeights, lowMid, midHigh),
      hat: meanWeight(scratchWeights, midHigh, NUM_BANDS),
    };
    engine = Object.assign(scratchEngine, frame.engine);
    engine.low = Math.min(1, engine.low * lane.kick);
    engine.mid = Math.min(1, engine.mid * lane.snare);
    engine.high = Math.min(1, engine.high * lane.hat);
    engine.kick *= lane.kick;
    engine.snare *= lane.snare;
    engine.hat *= lane.hat;
    engine.surge *= lane[engine.surgeKind];
  }

  return {
    time: frame.time,
    bands: scratchBands,
    energy: frame.energy,
    onset: frame.onset,
    pulseOnset: frame.pulseOnset,
    bpm: frame.bpm,
    onsetPhase: frame.onsetPhase,
    level: frame.level,
    hats: frame.hats,
    lead: frame.lead,
    engine,
  };
}
