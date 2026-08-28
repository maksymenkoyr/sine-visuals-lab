import type { TierSettings } from "./tier.ts";

// Discrete quality ladder, expressed as a fraction of the tier-detected
// baseline. renderScale, raymarchSteps, and quality all move together on a
// step so they never drift out of proportion with each other.
const QUALITY_STEPS = [1.0, 0.8, 0.6, 0.45, 0.3];

const MIN_RENDER_SCALE = 0.25;
const MIN_RAYMARCH_STEPS = 8;
const MIN_QUALITY = 0.1;

const EWMA_ALPHA = 0.1;
const OVER_BUDGET_MULT = 1.25;
// 1.05 gave less headroom above a healthy budget than ordinary rAF jitter
// provides, so the EWMA never settled inside it for long enough to
// accumulate a full recovery streak — quality that had stepped down
// essentially never stepped back up within a session. 1.12 leaves an
// 1.12-1.25 deadband that a genuinely comfortable stretch can sit inside.
const UNDER_BUDGET_MULT = 1.12;
// Recovery is deliberately far more cautious than the drop: a device that
// just throttled shouldn't get its quality bumped back the moment one
// comfortable stretch shows up.
const STEP_DOWN_FRAMES = 20;
const STEP_UP_FRAMES = 180;
// No further step for this long after any change, so the EWMA has time to
// settle into the new regime before it's evaluated again — without this a
// step down immediately looks "comfortable" (frame time just dropped) and
// triggers a step back up, oscillating every frame.
const COOLDOWN_MS = 2000;

// Any single measured gap beyond this is off-scale for a closed-loop
// stepper: it can't distinguish 4x over budget from 400x, the corrective
// action is identical either way, and letting a 400x sample straight into a
// ten-frame-memory EWMA poisons it for dozens of frames afterward. This is
// also what keeps a stretch where nothing was rendering (the gallery, a
// backgrounded tab, a scene switch — recordFrame simply isn't called during
// any of those) from arriving as one multi-second "frame" and forcing an
// immediate downgrade the moment rendering resumes.
const MAX_SAMPLE_MULT = 4;

// A render can only land on a display refresh, so the interval it actually
// achieves is quantized to whole vsyncs — a 144Hz panel capped at 60fps
// renders every 3rd tick (~20.8ms), a 75Hz one every 2nd (~26.7ms). Neither
// is the GPU struggling, but both would read as over budget against a flat
// 16.7ms target (the 144Hz case lands almost exactly on
// targetFrameMs * OVER_BUDGET_MULT, decided by float noise). Budgeting
// against the fastest interval this session has actually achieved — instead
// of the nominal cap — accounts for that quantization without just
// widening OVER_BUDGET_MULT itself (which would also blunt real-overload
// detection). Bounded, so a device that has simply never been fast can't
// excuse its own slowness into never stepping down.
const MAX_ACHIEVABLE_MULT = 1.5;

export interface QualityGovernor {
  /** Call once per *rendered* frame — i.e. only on ticks that actually
   *  called scene.render(), not every requestAnimationFrame tick — with the
   *  current wall-clock time in ms. Steps the shared TierSettings object's
   *  numeric knobs down under sustained load and back up once comfortable
   *  again. Never touches `tier.tier` itself: that label drives which
   *  scenes are selectable (see tierAllows in app.ts/tv.ts), and changing
   *  it mid-session would make the running scene or gallery entries vanish. */
  recordFrame(nowMs: number): void;
  /** Current step index, 0 = full detected-tier quality. For a debug HUD only. */
  readonly level: number;
}

/**
 * Closed-loop counterpart to detectTier()'s one-shot boot benchmark
 * (tier.ts). That benchmark measures a cold device; phones and TV SoCs
 * throttle under sustained load, so its result stops describing reality
 * partway through a session. This watches actual rendered-frame timing
 * against `targetFrameMs` (the render-rate cap's interval) and adjusts.
 */
export function createQualityGovernor(tier: TierSettings, targetFrameMs: number): QualityGovernor {
  const baseline = {
    renderScale: tier.renderScale,
    raymarchSteps: tier.raymarchSteps,
    quality: tier.quality,
  };
  let level = 0;
  let ewmaMs = targetFrameMs;
  let lastMs: number | null = null;
  let overStreak = 0;
  let underStreak = 0;
  let cooldownUntilMs = 0;
  // Fastest interval actually observed this session — see
  // MAX_ACHIEVABLE_MULT above for why this replaces a flat targetFrameMs.
  let fastestMs = Infinity;

  function applyLevel(): void {
    const f = QUALITY_STEPS[level];
    tier.renderScale = Math.max(MIN_RENDER_SCALE, baseline.renderScale * f);
    tier.raymarchSteps = Math.max(MIN_RAYMARCH_STEPS, Math.round(baseline.raymarchSteps * f));
    tier.quality = Math.max(MIN_QUALITY, baseline.quality * f);
  }

  return {
    get level() {
      return level;
    },

    recordFrame(nowMs: number): void {
      if (lastMs !== null) {
        const dtMs = Math.min(targetFrameMs * MAX_SAMPLE_MULT, Math.max(0, nowMs - lastMs));
        ewmaMs += (dtMs - ewmaMs) * EWMA_ALPHA;
        fastestMs = Math.min(fastestMs, dtMs);
        const budgetMs = Math.min(targetFrameMs * MAX_ACHIEVABLE_MULT, Math.max(targetFrameMs, fastestMs));

        if (nowMs >= cooldownUntilMs) {
          if (ewmaMs > budgetMs * OVER_BUDGET_MULT) {
            overStreak++;
            underStreak = 0;
            if (overStreak >= STEP_DOWN_FRAMES && level < QUALITY_STEPS.length - 1) {
              level++;
              applyLevel();
              overStreak = 0;
              cooldownUntilMs = nowMs + COOLDOWN_MS;
            }
          } else if (ewmaMs < budgetMs * UNDER_BUDGET_MULT) {
            underStreak++;
            overStreak = 0;
            if (underStreak >= STEP_UP_FRAMES && level > 0) {
              level--;
              applyLevel();
              underStreak = 0;
              cooldownUntilMs = nowMs + COOLDOWN_MS;
            }
          } else {
            overStreak = 0;
            underStreak = 0;
          }
        }
      }
      lastMs = nowMs;
    },
  };
}
