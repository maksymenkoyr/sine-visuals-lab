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
 * returns exactly 1, whatever the other three fields hold.
 *
 * `shape.tail` is the same sort of knob for a hit's *length* rather than its
 * height, one per lane (HitLane): a multiple on how long that lane's decaying
 * pulse takes to fall (see pulseDecayScale), 1 leaving it exactly as it was.
 * Smoothing (sensitivity.ts's smoothingRateScale) already slows these same
 * pulses along with the level slews; Length is the hits-only counterpart and
 * the two multiply.
 *
 * Nothing in the panel sets the shape any more, so getHitShape() always hands
 * back HIT_SHAPE_FLAT: every pulse is a flat 1 at its own base fall. The
 * shape is still threaded as a param into src/render/animClock.ts's
 * advance() (passed by src/app.ts, src/tv.ts and src/output.ts; every
 * preview/gallery/probe caller omits it and gets the same flat pulses) so a
 * future control has the plumbing and the math stays covered by
 * tests/hitStrength.test.ts.
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

export const HIT_AMOUNT_DEFAULT = 0;
export const HIT_KNEE_DEFAULT = 1;
export const HIT_LOUDNESS_DEFAULT = 0;
export const HIT_FLOOR_DEFAULT = 0;
/** Every lane at its own base fall — also every lane's decay scale then. */
export const UNIT_TAILS: HitTails = Object.freeze({ beat: 1, low: 1, mid: 1, high: 1 });

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Flat 1 at every lane's own base fall (see file header). */
const HIT_SHAPE_FLAT: HitShape = Object.freeze({
  amount: HIT_AMOUNT_DEFAULT,
  knee: HIT_KNEE_DEFAULT,
  loudness: HIT_LOUDNESS_DEFAULT,
  floor: HIT_FLOOR_DEFAULT,
  tail: UNIT_TAILS,
});

export function getHitShape(): HitShape {
  return HIT_SHAPE_FLAT;
}

// ---- The pure formula --------------------------------------------------

/** The factor a lane's pulse decay rate is multiplied by for a given
 *  `shape.tail[lane]`: a longer tail is a slower fall, so 1 / tail. Exactly 1
 *  at the default tail, so an untouched Length row leaves its pulses
 *  bit-for-bit as they were. A missing shape (previews/gallery/probes, which
 *  never get one) or a non-finite or non-positive tail reads as 1, same
 *  fallback rule as the other fields. Applied wherever a hit's decaying pulse
 *  is built: animClock.ts (beatPulse, the metronome pulses), bandEnergy.ts
 *  (each band group's pulse) and drives.ts's grid pulses and Graded
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

/** ratio (1 = bare trigger) -> 0..1, 0 at/below the firing line. */
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
