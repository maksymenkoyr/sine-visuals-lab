/**
 * A hit's strength: today, every detected onset sets its pulse to a flat 1
 * (bandEnergy.ts's `state.pulse = 1`, animClock.ts's `beatPulse = 1`) — a
 * whisper and a slam drive the same height. This module grades that height
 * instead, from two ingredients a detector already has and throws away:
 *
 * - **stand-out** (hitStandout): how far this hit's OnsetDiag.ratio cleared
 *   its firing line, through a soft knee — `1 - exp(-(ratio-1)/knee)`, 0
 *   at/below the line, easing toward 1 the further above it, `knee` setting
 *   how fast. A null ratio (no detector reading behind this pulse — a
 *   grid-only beat, or a device with no local broadband extractor) reads as
 *   a bare, unremarkable trigger: stand-out 1.
 * - **loudness**: how loud the hit actually was, as an absolute 0..1 reading
 *   (bandEnergy.ts passes its group's own `raw` mean; animClock.ts passes
 *   FeatureFrame.level) — stand-out alone can't tell a loud room's ordinary
 *   beat from a quiet room's, since it's relative to that detector's own
 *   recent average either way.
 *
 * `hitStrength` blends the two (`shape.loudness`, 0 = stand-out only, 1 =
 * loudness only), optionally floors and rescales the blend (`shape.floor`:
 * below it reads as 0, the rest stretched back to fill 0..1 — "ignore hits
 * this weak"), and finally blends *that* against today's flat 1
 * (`shape.amount`, 0 = flat 1, 1 = fully graded). `shape.amount = 0` always
 * returns exactly 1, whatever the other three fields hold — the graded path
 * is opt-in per device, and every scene tuned against a flat pulse keeps
 * looking exactly the way it did before this module existed until someone
 * actually raises Dimension (the amount slider's label in the meters panel,
 * src/ui/audioMeters.ts).
 *
 * Global per device (not per scene, unlike src/audio/sensitivity.ts and
 * src/render/sceneSettings.ts) and threaded the same way as
 * src/audio/silenceGate.ts's marks: a param into src/render/animClock.ts's
 * advance(), which passes it into bandEnergy.ts's own advance() and never
 * reads this module's store itself — only src/app.ts and src/tv.ts (the real
 * entry points) read getHitShape() and pass it in; every preview/gallery/
 * probe caller omits it and gets today's flat-1 pulses regardless of what
 * this device's shape is set to. Same in-memory-cache-over-localStorage
 * pattern as silenceGate.ts/bandSplit.ts: the cache is the source of truth
 * for get/set within a session, seeded once from localStorage, so behavior
 * stays correct even where localStorage is unavailable (node test env,
 * Safari private mode).
 *
 * TV limitation: same as silenceGate.ts's own. A paired TV runs its own
 * bandEnergy.ts detectors and its own animClock off frames that arrive
 * pre-decoded over src/net/protocol.ts's wire — the phone's HitShape never
 * travels with them, so src/tv.ts reads its own local getHitShape() (device
 * defaults, or whatever a TV-side dev console has poked into its own
 * localStorage) rather than whatever the paired phone's sliders are showing.
 */

export interface HitShape {
  /** 0 = flat 1 (today) … 1 = fully graded. */
  amount: number;
  /** Stand-out softness, in ratio units above the firing line. */
  knee: number;
  /** 0 = stand-out only … 1 = loudness only (crossfade). */
  loudness: number;
  /** Graded strength below this counts as 0; the rest rescales to 0..1. */
  floor: number;
}

export const HIT_AMOUNT_MIN = 0;
export const HIT_AMOUNT_MAX = 1;
export const HIT_AMOUNT_DEFAULT = 0;

// The knee's own slider range (src/ui/audioMeters.ts) — narrow enough
// (0.05) that a hit barely over the line already reads as near-full
// stand-out, wide enough (4) that even a big clearance stays soft.
export const HIT_KNEE_MIN = 0.05;
export const HIT_KNEE_MAX = 4;
export const HIT_KNEE_DEFAULT = 1;

export const HIT_LOUDNESS_MIN = 0;
export const HIT_LOUDNESS_MAX = 1;
export const HIT_LOUDNESS_DEFAULT = 0;

export const HIT_FLOOR_MIN = 0;
// Short of 1: a floor at 1 would leave nothing above it to rescale into
// 0..1 (see hitStrength's own span<=0 fallback) — capping just under keeps
// the slider's top stop a genuinely steep-but-finite cut instead of a
// degenerate one.
export const HIT_FLOOR_MAX = 0.95;
export const HIT_FLOOR_DEFAULT = 0;

const STORAGE_KEY_AMOUNT = "vibe.hitAmount";
const STORAGE_KEY_KNEE = "vibe.hitKnee";
const STORAGE_KEY_LOUDNESS = "vibe.hitLoudness";
const STORAGE_KEY_FLOOR = "vibe.hitFloor";

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function clampField(v: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, v));
}

function loadField(key: string, lo: number, hi: number, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return clampField(Number(raw), lo, hi, fallback);
  } catch {
    return fallback;
  }
}

let amountCache = loadField(STORAGE_KEY_AMOUNT, HIT_AMOUNT_MIN, HIT_AMOUNT_MAX, HIT_AMOUNT_DEFAULT);
let kneeCache = loadField(STORAGE_KEY_KNEE, HIT_KNEE_MIN, HIT_KNEE_MAX, HIT_KNEE_DEFAULT);
let loudnessCache = loadField(STORAGE_KEY_LOUDNESS, HIT_LOUDNESS_MIN, HIT_LOUDNESS_MAX, HIT_LOUDNESS_DEFAULT);
let floorCache = loadField(STORAGE_KEY_FLOOR, HIT_FLOOR_MIN, HIT_FLOOR_MAX, HIT_FLOOR_DEFAULT);

function persist(): void {
  snapshot = null;
  try {
    localStorage.setItem(STORAGE_KEY_AMOUNT, String(amountCache));
    localStorage.setItem(STORAGE_KEY_KNEE, String(kneeCache));
    localStorage.setItem(STORAGE_KEY_LOUDNESS, String(loudnessCache));
    localStorage.setItem(STORAGE_KEY_FLOOR, String(floorCache));
  } catch {
    // Not fatal — the setting just won't persist across reloads.
  }
}

// Rebuilt only when a field changes (persist() is the one place every
// setter ends), not per call — app.ts/tv.ts read this every tick, and a
// fresh object per read would be steady-state garbage for no reason.
let snapshot: HitShape | null = null;

/** A frozen snapshot — callers can't mutate the cache through it. */
export function getHitShape(): HitShape {
  if (snapshot === null) {
    snapshot = Object.freeze({ amount: amountCache, knee: kneeCache, loudness: loudnessCache, floor: floorCache });
  }
  return snapshot;
}

export function setHitShape(partial: Partial<HitShape>): void {
  if (partial.amount !== undefined) amountCache = clampField(partial.amount, HIT_AMOUNT_MIN, HIT_AMOUNT_MAX, HIT_AMOUNT_DEFAULT);
  if (partial.knee !== undefined) kneeCache = clampField(partial.knee, HIT_KNEE_MIN, HIT_KNEE_MAX, HIT_KNEE_DEFAULT);
  if (partial.loudness !== undefined)
    loudnessCache = clampField(partial.loudness, HIT_LOUDNESS_MIN, HIT_LOUDNESS_MAX, HIT_LOUDNESS_DEFAULT);
  if (partial.floor !== undefined) floorCache = clampField(partial.floor, HIT_FLOOR_MIN, HIT_FLOOR_MAX, HIT_FLOOR_DEFAULT);
  persist();
}

export function resetHitShape(): void {
  amountCache = HIT_AMOUNT_DEFAULT;
  kneeCache = HIT_KNEE_DEFAULT;
  loudnessCache = HIT_LOUDNESS_DEFAULT;
  floorCache = HIT_FLOOR_DEFAULT;
  persist();
}

// ---- The pure formula --------------------------------------------------

/** ratio (1 = bare trigger) -> 0..1, 0 at/below the firing line. Exported on
 *  its own for the meters panel's Curve monitor (src/ui/audioMeters.ts),
 *  which plots this same function of ratio to show what a knee setting
 *  actually does. */
export function hitStandout(ratio: number, knee: number): number {
  const r = Number.isFinite(ratio) ? ratio : 1;
  const k = Number.isFinite(knee) && knee > 0 ? knee : HIT_KNEE_DEFAULT;
  return clamp01(1 - Math.exp(-(r - 1) / k));
}

/** The three numbers behind a graded pulse, for the monitors: `standout` and
 *  `loudness` are this hit's two raw ingredients (see file header),
 *  `strength` is the final blend that actually becomes the pulse height.
 *  bandEnergy.ts/animClock.ts mutate one of these in place per detector
 *  (`out`) rather than allocate fresh on every hit, the same reason
 *  onsetDiag.ts's OnsetDiag is mutated rather than replaced. */
export interface HitParts {
  standout: number;
  loudness: number;
  strength: number;
}

/** `ratio` null means no detector reading backs this pulse (a grid-only
 *  tick, or a device with no local broadband extractor) — read as a bare
 *  trigger, stand-out 1, same as a ratio sitting exactly on the firing
 *  line. All other inputs are sanitized the same way (non-finite falls
 *  back to a safe default) so a bad upstream reading can never make a
 *  pulse disappear or blow up. */
export function hitStrength(ratio: number | null, loudness: number, shape: HitShape, out?: HitParts): HitParts {
  const standout = ratio === null ? 1 : hitStandout(ratio, shape.knee);
  const loud = Number.isFinite(loudness) ? clamp01(loudness) : 0;
  const mix = Number.isFinite(shape.loudness) ? clamp01(shape.loudness) : HIT_LOUDNESS_DEFAULT;
  const graded = standout + (loud - standout) * mix;

  // graded and floor both sit in 0..1, so (graded-floor)/(1-floor) can
  // never exceed 1 — no separate cap needed above clamp01's own floor of 0.
  // span<=0 (floor pinned to 1, outside what the setters above ever store,
  // but this is a pure fn a test can call directly) falls back to a plain
  // step so the result stays finite either way.
  const floor = Number.isFinite(shape.floor) ? clamp01(shape.floor) : HIT_FLOOR_DEFAULT;
  const span = 1 - floor;
  const gated = span > 0 ? clamp01((graded - floor) / span) : graded >= floor ? 1 : 0;

  const amount = Number.isFinite(shape.amount) ? clamp01(shape.amount) : HIT_AMOUNT_DEFAULT;
  // amount = 0 lands on exactly 1 regardless of everything above — see file
  // header for why that bit-for-bit match matters.
  const strength = 1 + (gated - 1) * amount;

  const result = out ?? { standout: 0, loudness: 0, strength: 0 };
  result.standout = standout;
  result.loudness = loud;
  result.strength = strength;
  return result;
}
