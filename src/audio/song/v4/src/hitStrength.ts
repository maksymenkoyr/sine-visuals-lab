// Copied from audio-subsystem/v6/src/song/v4 (2026-10-30, #798/#800), which is v4's code with the browser-storage reads and writes cut; the bench check (bench-signals' probe app-song) holds it equal to v6. Edits: unused code removed, and with it the saved settings and their reload hook (the shape is always the defaults).
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
 * actually raises Dimension (the amount slider's label in Shape, the Hits
 * card's own disclosure — src/ui/audioMeters.ts).
 *
 * `shape.tail` is the same sort of knob for a hit's *length* rather than its
 * height, one per lane (HitLane): a multiple on how long that lane's decaying
 * pulse takes to fall (see pulseDecayScale), 1 leaving it exactly as it was.
 * A multiple rather than a time because the base rates belong to the modules
 * that build each pulse (animClock.ts, bandEnergy.ts) — the Hits card's
 * Length rows show the time it comes to. Smoothing (sensitivity.ts's
 * smoothingRateScale) already slows these same pulses along with the level
 * slews; Length is the hits-only counterpart and the two multiply.
 *
 * Global per device (not per scene, unlike audio-subsystem/src/sensitivity.ts and
 * src/render/sceneSettings.ts) and threaded the same way as
 * audio-subsystem/src/silenceGate.ts's marks: a param into src/render/animClock.ts's
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
 * The shape rides in a room's look, unlike silenceGate.ts's marks: its keys
 * are plain `vibe.*` keys that src/net/syncedStores.ts's `isRoomKey` accepts, and
 * the hook registered below re-seeds the caches when a look is applied. So a
 * phone's Hits card reaches a paired TV the way it reaches the pop-out — the
 * TV applies the look, then reads its own getHitShape(). What the TV does not
 * get is the host's broadband ratio (`beatRatio` is not on the wire; src/tv.ts
 * says what it uses instead), so a graded broadband hit there is built from
 * the TV's own band readings.
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
  /** How long each lane's pulse rings out, as a multiple of its own fall:
   *  1 = unchanged, 2 = twice as long, 0.5 = half. See pulseDecayScale. */
  tail: HitTails;
}

/** The pulses a tail can stretch, named like AnimFrame.hitStrength's lanes:
 *  `beat` is the broadband pulse (and everything timed like it — the
 *  metronome and beat-grid pulses), the rest bandEnergy.ts's groups. */
export type HitLane = "beat" | "low" | "mid" | "high";
export type HitTails = Readonly<Record<HitLane, number>>;


const HIT_AMOUNT_DEFAULT = 0;

const HIT_KNEE_DEFAULT = 1;

const HIT_LOUDNESS_DEFAULT = 0;

const HIT_FLOOR_DEFAULT = 0;

const HIT_TAIL_DEFAULT = 1;
/** Every lane at HIT_TAIL_DEFAULT — also every lane's decay scale then. */
export const UNIT_TAILS: HitTails = Object.freeze({ beat: 1, low: 1, mid: 1, high: 1 });

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

let amountCache = HIT_AMOUNT_DEFAULT;
let kneeCache = HIT_KNEE_DEFAULT;
let loudnessCache = HIT_LOUDNESS_DEFAULT;
let floorCache = HIT_FLOOR_DEFAULT;
let tailCache: HitTails = Object.freeze({ beat: HIT_TAIL_DEFAULT, low: HIT_TAIL_DEFAULT, mid: HIT_TAIL_DEFAULT, high: HIT_TAIL_DEFAULT });

// Rebuilt only when a field changes (persist() is the one place every
// setter ends), not per call — src/app.ts and src/tv.ts read this every tick, and a
// fresh object per read would be steady-state garbage for no reason.
let snapshot: HitShape | null = null;

/** A frozen snapshot — callers can't mutate the cache through it. */
export function getHitShape(): HitShape {
  if (snapshot === null) {
    snapshot = Object.freeze({ amount: amountCache, knee: kneeCache, loudness: loudnessCache, floor: floorCache, tail: tailCache });
  }
  return snapshot;
}



// ---- The pure formula --------------------------------------------------

/** The factor a lane's pulse decay rate is multiplied by for a given
 *  `shape.tail[lane]`: a longer tail is a slower fall, so 1 / tail. Exactly 1
 *  at the default tail, so an untouched Length row leaves its pulses
 *  bit-for-bit as they were. A missing shape (previews/gallery/probes, which
 *  never get one) or a non-finite or non-positive tail reads as 1, same
 *  fallback rule as the other fields. Applied wherever a hit's decaying pulse
 *  is built: animClock.ts (beatPulse, the metronome pulses), bandEnergy.ts
 *  (each band group's pulse) and drives.ts's grid pulses and Fixed/Loud
 *  heights, which read it back off AnimFrame.hitTail so they fall like the
 *  pulses they stand in for. */
export function pulseDecayScale(shape: HitShape | undefined, lane: HitLane): number {
  const t = shape?.tail[lane];
  return t !== undefined && Number.isFinite(t) && t > 0 ? 1 / t : 1;
}

/** Every lane's pulseDecayScale at once, for AnimFrame.hitTail. */
export function pulseDecayScales(shape: HitShape | undefined): HitTails {
  if (shape === undefined) return UNIT_TAILS;
  return Object.freeze({
    beat: pulseDecayScale(shape, "beat"),
    low: pulseDecayScale(shape, "low"),
    mid: pulseDecayScale(shape, "mid"),
    high: pulseDecayScale(shape, "high"),
  });
}

/** ratio (1 = bare trigger) -> 0..1, 0 at/below the firing line. Exported on
 *  its own for the Hits card's Shape section's own Curve monitor
 *  (src/ui/audioMeters.ts), which plots this same function of ratio to show
 *  what a knee setting actually does. */
function hitStandout(ratio: number, knee: number): number {
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
