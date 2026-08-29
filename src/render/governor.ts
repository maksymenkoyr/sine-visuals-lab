import type { QualitySettings } from "./quality.ts";

// Discrete quality ladder, expressed as a fraction of the preset-detected
// baseline. renderScale, raymarchSteps, and detail all move together on a
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

// --- Authority probe -------------------------------------------------------
// A slower rendered-frame interval isn't always this page's fault to fix.
// Chrome's Energy Saver mode (and equivalents elsewhere) lowers the display
// refresh rate, and rAF follows it: a loop that assumed 16.7ms between
// callbacks now sees ~33.3ms while the GPU work per frame hasn't changed at
// all. Budgeting against a flat targetFrameMs reads that as sustained
// overload and used to walk quality all the way to the floor — where it then
// stayed forever, since recovery needs an interval the throttled device can
// no longer produce.
//
// Frame-gap timing alone can't tell "paced by something outside the page"
// from "genuinely GPU-bound" apart: under vsync a real overload also snaps
// to the same quantized interval, so neither the gap nor its jitter carries
// the answer (EXT_disjoint_timer_query_webgl2 would, but isn't available on
// Safari — a possible later upgrade, not this). So instead of trusting the
// diagnosis, the *first* step down out of level 0 is a probe: jump straight
// to the bottom rung — deep enough that "no improvement at all" can't be
// vsync noise — then after one cooldown, compare. A genuine bottleneck gets
// faster; a pace this page has no authority over does not. A probe that
// didn't help puts quality back and the governor stands down — no further
// stepping — until the cadence it observed actually moves, which covers
// both the throttle lifting and the page's own workload changing while
// still throttled. A probe that did help just resumes ordinary one-rung
// stepping from the bottom, same recovery path as before.
const PROBE_LEVEL = QUALITY_STEPS.length - 1;
// How much the EWMA has to improve, as a fraction of its pre-probe value,
// to count as "the cut helped." Comfortably below what a real GPU-bound
// scene sees from a 5-rung drop, comfortably above vsync-quantization noise.
const MIN_PROBE_GAIN = 0.1;
// How far the EWMA has to move off the cadence recorded when standing down
// before re-arming — otherwise a standing-down governor would never step
// again even after the throttle lifts or the scene gets genuinely heavier.
const CADENCE_SHIFT_FRAC = 0.15;

export interface QualityGovernor {
  /** Call once per *rendered* frame — i.e. only on ticks that actually
   *  called scene.render(), not every requestAnimationFrame tick — with the
   *  current wall-clock time in ms. Steps the shared QualitySettings object's
   *  numeric knobs down under sustained load and back up once comfortable
   *  again. Never touches `quality.preset` itself: that label drives which
   *  scenes are selectable (see presetAllows in app.ts/tv.ts), and changing
   *  it mid-session would make the running scene or gallery entries vanish. */
  recordFrame(nowMs: number): void;
  /** Current step index, 0 = full detected-preset quality. For a debug HUD
   *  and the Power card's status readout. */
  readonly level: number;
  /** The last valid index into the quality ladder — level's ceiling. Lets a
   *  caller render "n/max" without hardcoding the ladder's length. */
  readonly maxLevel: number;
  /** QUALITY_STEPS[level] — the current step as a fraction of baseline, for
   *  the Power card's Detail readout. Kept alongside level/maxLevel rather
   *  than making the caller re-derive it from the ladder. */
  readonly fraction: number;
  /** True once a step-down probe found no improvement — something outside
   *  this page (a browser energy-saver mode, an OS refresh-rate cap) is
   *  setting the render pace, not GPU load — and the governor has stopped
   *  stepping until that pace itself changes. For a status readout only. */
  readonly standingDown: boolean;
  /** Energy saving On/Off (see src/render/powerMode.ts) takes the governor
   *  out of the loop entirely rather than fighting it: `false` pins quality
   *  to the preset baseline and stops stepping; `true` resumes closed-loop
   *  stepping from a clean measurement (a stale EWMA/fastestMs from
   *  whatever ran while disabled must not carry over). Idempotent. */
  setEnabled(on: boolean): void;
}

/**
 * Closed-loop counterpart to detectQuality()'s one-shot boot benchmark
 * (quality.ts). That benchmark measures a cold device; phones and TV SoCs
 * throttle under sustained load, so its result stops describing reality
 * partway through a session. This watches actual rendered-frame timing
 * against `targetFrameMs` (the render-rate cap's interval) and adjusts —
 * see the "Authority probe" comment above for why a step down has to prove
 * itself before it's trusted.
 */
export function createQualityGovernor(quality: QualitySettings, targetFrameMs: number): QualityGovernor {
  const baseline = {
    renderScale: quality.renderScale,
    raymarchSteps: quality.raymarchSteps,
    detail: quality.detail,
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
  let enabled = true;

  // Probe state — see the "Authority probe" comment above.
  let probing = false;
  let probeBeforeMs = 0;
  let probeFromLevel = 0;
  let standingDown = false;
  let pacedEwmaMs = 0;

  function applyLevel(): void {
    const f = QUALITY_STEPS[level];
    quality.renderScale = Math.max(MIN_RENDER_SCALE, baseline.renderScale * f);
    quality.raymarchSteps = Math.max(MIN_RAYMARCH_STEPS, Math.round(baseline.raymarchSteps * f));
    quality.detail = Math.max(MIN_QUALITY, baseline.detail * f);
  }

  // Re-armed on setEnabled(true): a stale EWMA/fastestMs learned while the
  // governor was disabled (e.g. forced 30fps under Energy saving On)
  // describes the wrong regime and must not carry into the next session of
  // closed-loop measurement.
  function resetMeasurement(): void {
    ewmaMs = targetFrameMs;
    lastMs = null;
    overStreak = 0;
    underStreak = 0;
    cooldownUntilMs = 0;
    fastestMs = Infinity;
    probing = false;
    standingDown = false;
  }

  return {
    get level() {
      return level;
    },
    get maxLevel() {
      return QUALITY_STEPS.length - 1;
    },
    get fraction() {
      return QUALITY_STEPS[level];
    },
    get standingDown() {
      return standingDown;
    },

    setEnabled(on: boolean): void {
      if (on === enabled) return;
      enabled = on;
      if (!on) {
        level = 0;
        applyLevel();
      } else {
        resetMeasurement();
      }
    },

    recordFrame(nowMs: number): void {
      if (!enabled) {
        lastMs = nowMs;
        return;
      }

      if (lastMs !== null) {
        const dtMs = Math.min(targetFrameMs * MAX_SAMPLE_MULT, Math.max(0, nowMs - lastMs));
        ewmaMs += (dtMs - ewmaMs) * EWMA_ALPHA;
        fastestMs = Math.min(fastestMs, dtMs);
        const budgetMs = Math.min(targetFrameMs * MAX_ACHIEVABLE_MULT, Math.max(targetFrameMs, fastestMs));

        if (standingDown) {
          // No stepping while standing down — only watch for the cadence
          // itself to move, which is the one thing that can tell us the
          // "not our bottleneck" verdict might no longer hold.
          if (Math.abs(ewmaMs - pacedEwmaMs) > pacedEwmaMs * CADENCE_SHIFT_FRAC) {
            standingDown = false;
            overStreak = 0;
            underStreak = 0;
            cooldownUntilMs = nowMs + COOLDOWN_MS;
          }
          lastMs = nowMs;
          return;
        }

        if (nowMs >= cooldownUntilMs) {
          if (probing) {
            probing = false;
            const improvedMs = probeBeforeMs - ewmaMs;
            if (improvedMs < probeBeforeMs * MIN_PROBE_GAIN) {
              // The deep cut bought nothing — this page wasn't the
              // bottleneck. Put quality back and stop touching it until the
              // pace itself changes (see the standingDown branch above).
              level = probeFromLevel;
              applyLevel();
              standingDown = true;
              pacedEwmaMs = ewmaMs;
            }
            // Either verdict consumes this evaluation; don't also run a
            // normal step below on the same frame.
            overStreak = 0;
            underStreak = 0;
            cooldownUntilMs = nowMs + COOLDOWN_MS;
          } else if (ewmaMs > budgetMs * OVER_BUDGET_MULT) {
            overStreak++;
            underStreak = 0;
            if (overStreak >= STEP_DOWN_FRAMES && level < QUALITY_STEPS.length - 1) {
              if (level === 0) {
                // First correction out of a fully comfortable level —
                // probe before committing rather than trusting the
                // diagnosis (see the "Authority probe" comment above).
                probeFromLevel = level;
                probeBeforeMs = ewmaMs;
                level = PROBE_LEVEL;
                probing = true;
              } else {
                // Already confirmed real this session (a probe succeeded
                // to get here) — no need to re-probe every further step.
                level++;
              }
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
