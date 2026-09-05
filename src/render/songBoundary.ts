import { NUM_BANDS, type FeatureFrame } from "../audio/types.ts";

/**
 * Every cue we can pull toward "did the track just change" — monitor-only.
 * Nothing reads this yet: no scene, no auto-reset of the adaptive state a
 * track change should invalidate (sectionIntensity.ts's floor/ceiling,
 * features.ts's per-band AGC, beatClock.ts's tempo). This exists so those
 * cues can be watched on the meters panel (src/ui/audioMeters.ts's Track
 * card) against real transitions before anything is built on top of them.
 *
 * A song boundary is NOT perfectly detectable. A gap between tracks is close
 * to it; a hard cut with no gap shows up as spectral/tempo novelty within a
 * second or two; a crossfade has no instant that IS the boundary at all —
 * two tracks overlap for bars. So this produces two edges, not one, the same
 * split as FeatureFrame.onset (raw, loose) vs. beatClock's tempoLock
 * (confirmed, lagged):
 *
 *  - `provisional` fires fast and loose, on weak evidence, the moment
 *    `confidence` crosses its trigger. Cheap to be wrong about.
 *  - `confirmed` fires later, only if the new spectrum is still there after
 *    CONFIRM_HOLD_SEC — see below for why that alone is what tells a real
 *    track change apart from a breakdown that came back.
 *
 * ---- Gap evidence (FeatureFrame.level) ----
 * Reads `frame.level`, the one field FeatureFrame's own doc names as
 * surviving features.ts's adaptive floor/peak AGC. `bands`/`energy` are
 * unusable here: that AGC drops its floor in ~0.1s and re-adapts up in
 * ~1.25s, so a sustained gap reads as amplified room noise, not silence, by
 * design (the same reason musicProfile.ts's `loudness` dial reads `level`
 * directly instead of `energy`). `levelEst` is a ceiling-style reference
 * (fast up, slow down, like features.ts's own peak tracker) rather than a
 * plain average, so a genuine gap doesn't drag its own reference down before
 * quietHoldSec has had time to accumulate — it has to actually persist below
 * a *stale* reference to register as a gap at all.
 *
 * ---- Spectral novelty (frame.bands) ----
 * Two leaky per-band means at different rates — `bandRecent` ("what's
 * playing right now") against `bandEstablished` ("this track's own spectral
 * personality") — compared by cosine distance, which for nonnegative band
 * magnitudes already sits in [0,1] with no extra normalizing needed.
 *
 * Both are FROZEN while `isQuiet` (the same flag gap evidence computes)
 * rather than gated on their own band-peak, unlike spectralCentroid.ts/
 * musicProfile.ts's usual SILENCE_PEAK convention — because `bands` is
 * exactly the signal that AGC-inflates during a gap (see above), so a
 * bands-peak gate would stop "seeing" the gap within about a second and
 * start ingesting amplified noise as if it were music. Freezing on the
 * level-based flag instead means: during a quiet stretch, `bandRecent` holds
 * the LAST real spectrum rather than drifting toward noise or near-zero.
 * That's what makes the `confirmed` check work: on a `provisional` fire, a
 * snapshot of `bandEstablished` is taken — the SLOW mean, not the fast one —
 * specifically because it's still close to "before" at that instant even
 * when `bandRecent` (novelty's fast half) has already moved most of the way
 * toward whatever triggered the fire in the first place; snapshotting the
 * fast mean instead was tried first and under-detected exactly this case
 * (see the git history around this file). After CONFIRM_HOLD_SEC, the
 * snapshot is compared against `bandRecent` as it stands then: if the track
 * resumed as the SAME material (or the gap froze both means at the same
 * spectrum they already shared), `bandRecent` lands back close to the
 * snapshot and `confirmed` correctly withholds; if different material came
 * in, `bandRecent` has moved on and stays away, and `confirmed` fires. One
 * mechanism handles "real gap, same track resumes" (a long pause), "real
 * gap, different track" (an actual boundary), and a hard cut with no gap at
 * all — see songBoundary.test.ts.
 *
 * ---- Tempo evidence (frame.bpm, beatClock's tempoLock via inputs) ----
 * `tempoLockDrop` is lock collapsing from its own recent peak (a leaky-peak
 * hold, the same shape as PEAK_FALL_PER_SEC in audioMeters.ts), not lock's
 * raw complement — so a track with no steady beat at all doesn't read as
 * permanently "dropping." `tempoShift` fires once, as a decaying pulse, the
 * moment lock is regained: how far the new tempo sits from the one held
 * right before it was lost. Re-locking to a DIFFERENT tempo is real
 * evidence; re-locking to the SAME one is what a breakdown looks like.
 *
 * ---- Range staleness (sectionIntensity's rawIntensity via inputs) ----
 * `rangeStale` is how long that dial has sat pinned at an extreme — the cue
 * that most directly names the cost of not knowing a track changed: a
 * pinned range means sectionIntensity's own floor/ceiling belongs to
 * different music than what's actually playing.
 *
 * ---- Fusion ----
 * `confidence` takes the strongest single piece of primary evidence (gap,
 * novelty, tempo shift) and lets tempoLockDrop/rangeStale add a boost on top
 * — deliberately not a plain weighted average, so one strong signal alone
 * (a real gap) is already most of the way to confident rather than diluted
 * by everything else reading low. These weights are a first pass, not a
 * tuned model: the whole point of putting this on the meters before wiring
 * anything to it is to retune them by eye against real transitions.
 *
 * No `rateScale` parameter, unlike every sibling clock. sectionIntensity.ts
 * already draws the line this follows: rateScale (sensitivity.ts's
 * smoothingRateScale) belongs to *display* easing, and it withholds it from
 * its own floor/ceiling trackers because those are "the room/track
 * measurement," not something a user's Smoothing setting should touch.
 * Everything in this file is that same kind of measurement. Consequence:
 * these fields have no pre-smoothing counterpart, so the meters' RAW chip
 * correctly leaves the Track card alone rather than needing a branch for it.
 */

// --- Gap evidence ---
const LEVEL_EST_RISE_RATE = 0.5; // ~2s — catches up fast once the room's loud again
const LEVEL_EST_FALL_RATE = 0.03; // ~30s — deliberately slow; see file header
const MIN_LEVEL_EST = 0.05; // never divide by a near-zero reference
const QUIET_REL_THRESHOLD = 0.35; // level below this fraction of levelEst reads as "quiet"
const GAP_CONFIRM_SEC = 2; // quietHoldSec at which gapConfidence saturates — past an ordinary musical rest

// --- Spectral novelty ---
const BAND_RECENT_RATE = 0.7; // ~1.4s — "what's playing right now"
const BAND_ESTABLISHED_RATE = 0.05; // ~20s — "this track's own spectral personality"

// --- Tempo evidence ---
const LOCK_CONFIDENT = 0.75; // tempoLock above this reads as genuinely locked, not just trending up
const LOCK_MEMORY_DECAY = 0.3; // ~3s hold on "was recently locked" after lock starts falling
const TEMPO_SHIFT_REF = 0.25; // a re-lock this far (25%) from the pre-drop bpm reads as "fully shifted"
const TEMPO_SHIFT_DECAY = 0.5; // ~2s — tempoShift is a pulse, not a sustained level
const MIN_BPM_REF = 40; // never divide by a near-zero bpm reference

// --- Range staleness ---
const RANGE_PIN_HIGH = 0.92;
const RANGE_PIN_LOW = 0.08;
const RANGE_STALE_CONFIRM_SEC = 20; // sustained pinning this long reads as fully stale

// --- Fusion / edges ---
const PROVISIONAL_TRIGGER = 0.5;
const PROVISIONAL_RELEASE = 0.35; // below the trigger — same latch shape as sectionIntensity.ts's dropOnset
const RANGE_STALE_BOOST = 0.15;
const LOCK_DROP_BOOST = 0.15;
const CONFIRM_HOLD_SEC = 4; // wait this long after provisional before judging whether the new spectrum stuck
const CONFIRM_DISTANCE_MIN = 0.3; // cosine distance from the pre-event snapshot that reads as "genuinely different"
const REFRACTORY_SEC = 20; // a second confirmed edge this soon is almost certainly the same event re-triggering

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function expBlend(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

/** Cosine distance between two nonnegative band vectors: 0 for the same
 *  shape, approaching 1 as they share no energy in the same bands.
 *  Nonnegative inputs keep cosine similarity in [0,1] already, so the
 *  distance needs no separate clamp. Returns 0 — no evidence either way,
 *  not "identical" — when either vector has no energy to compare. */
function cosineDistance(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na < 1e-8 || nb < 1e-8) return 0;
  return clamp01(1 - dot / Math.sqrt(na * nb));
}

/** The pieces of the other renderer-side clocks this needs, passed in
 *  rather than recomputed — animClock.ts already derives all three from the
 *  same frame this advance() call receives. */
export interface SongBoundaryInputs {
  /** beatClock's tempoLock (see beatClock.ts). */
  tempoLock: number;
  /** sectionIntensity's rawIntensity, unsmoothed (see sectionIntensity.ts). */
  rawIntensity: number;
  /** spectralCentroid's raw, unsmoothed, absolute centroid (see spectralCentroid.ts). */
  centroidRaw: number;
}

export interface SongBoundarySnapshot {
  /** How far below the quiet threshold `level` currently sits, 0 when not quiet. */
  readonly quietDepth: number;
  /** Seconds continuously below the quiet threshold, 0 when not quiet. */
  readonly quietHoldSec: number;
  /** quietDepth combined with hold — the near-certain gap detector. */
  readonly gapConfidence: number;
  /** Cosine distance between the recent and established band means, frozen while quiet. */
  readonly novelty: number;
  /** Frame-to-frame jump in the raw spectral centroid. */
  readonly centroidStep: number;
  /** How far beatClock's tempoLock has fallen from its own recent peak. */
  readonly tempoLockDrop: number;
  /** Decaying pulse: how far a freshly re-locked tempo sits from the one held before it dropped. */
  readonly tempoShift: number;
  /** How long sectionIntensity's rawIntensity has sat pinned at an extreme. */
  readonly rangeStale: number;
  /** Blended [0,1] boundary belief — see file header for the fusion. */
  readonly confidence: number;
  /** One-shot fast/loose edge: true only on the tick confidence crosses its trigger. */
  readonly provisional: boolean;
  /** One-shot edge: true only on the tick a provisional fire is confirmed — see file header. */
  readonly confirmed: boolean;
  /** Seconds since the last confirmed edge (Infinity if there's never been one). */
  readonly sinceBoundarySec: number;
}

export interface SongBoundary extends SongBoundarySnapshot {
  advance(dtSec: number, frame: FeatureFrame, inputs: SongBoundaryInputs): void;
}

export function createSongBoundary(): SongBoundary {
  let levelEst = 0;
  let quietHoldSec = 0;
  let quietDepth = 0;
  let gapConfidence = 0;

  const bandRecent = new Float32Array(NUM_BANDS);
  const bandEstablished = new Float32Array(NUM_BANDS);
  let bandsPrimed = false;
  let novelty = 0;

  let prevCentroidRaw = 0.5;
  let centroidStep = 0;

  let lockMemory = 0;
  let tempoLockDrop = 0;
  let wasConfidentLock = false;
  let lockedBpm = 0;
  let preDropBpm = 0;
  let tempoShift = 0;

  let pinnedSec = 0;
  let rangeStale = 0;

  let confidence = 0;
  let wasAboveProvisional = false;

  let pendingConfirm = false;
  let confirmTimer = 0;
  const preSnapshot = new Float32Array(NUM_BANDS);
  let sinceBoundarySec = Number.POSITIVE_INFINITY;

  const state: SongBoundary = {
    quietDepth: 0,
    quietHoldSec: 0,
    gapConfidence: 0,
    novelty: 0,
    centroidStep: 0,
    tempoLockDrop: 0,
    tempoShift: 0,
    rangeStale: 0,
    confidence: 0,
    provisional: false,
    confirmed: false,
    sinceBoundarySec,
    advance(dtSec: number, frame: FeatureFrame, inputs: SongBoundaryInputs): void {
      const dt = Math.max(1e-4, dtSec);

      // --- gap evidence ---
      const level = clamp01(frame.level);
      const levelRate = level > levelEst ? LEVEL_EST_RISE_RATE : LEVEL_EST_FALL_RATE;
      levelEst += (level - levelEst) * expBlend(levelRate, dt);
      const quietThreshold = Math.max(levelEst, MIN_LEVEL_EST) * QUIET_REL_THRESHOLD;
      const isQuiet = level < quietThreshold;
      quietHoldSec = isQuiet ? quietHoldSec + dt : 0;
      quietDepth = isQuiet ? clamp01(1 - level / quietThreshold) : 0;
      gapConfidence = isQuiet ? quietDepth * clamp01(quietHoldSec / GAP_CONFIRM_SEC) : 0;

      // --- spectral novelty (frozen while isQuiet — see file header) ---
      if (!bandsPrimed) {
        bandRecent.set(frame.bands);
        bandEstablished.set(frame.bands);
        bandsPrimed = true;
      } else if (!isQuiet) {
        for (let b = 0; b < NUM_BANDS; b++) {
          bandRecent[b] += (frame.bands[b] - bandRecent[b]) * expBlend(BAND_RECENT_RATE, dt);
          bandEstablished[b] += (frame.bands[b] - bandEstablished[b]) * expBlend(BAND_ESTABLISHED_RATE, dt);
        }
      }
      novelty = cosineDistance(bandRecent, bandEstablished);

      // --- centroid step ---
      centroidStep = Math.abs(inputs.centroidRaw - prevCentroidRaw);
      prevCentroidRaw = inputs.centroidRaw;

      // --- tempo evidence ---
      const lock = clamp01(inputs.tempoLock);
      lockMemory = Math.max(lock, lockMemory - LOCK_MEMORY_DECAY * dt);
      tempoLockDrop = clamp01(lockMemory - lock);

      const confidentLock = lock > LOCK_CONFIDENT;
      if (confidentLock) {
        if (!wasConfidentLock && preDropBpm > 0) {
          const shift = Math.abs(frame.bpm - preDropBpm) / Math.max(preDropBpm, MIN_BPM_REF);
          tempoShift = clamp01(shift / TEMPO_SHIFT_REF);
          preDropBpm = 0; // consumed — the next drop starts its own comparison fresh
        }
        lockedBpm = frame.bpm;
      } else if (wasConfidentLock) {
        preDropBpm = lockedBpm;
      }
      wasConfidentLock = confidentLock;
      tempoShift *= Math.exp(-dt * TEMPO_SHIFT_DECAY);

      // --- range staleness ---
      const pinned = inputs.rawIntensity > RANGE_PIN_HIGH || inputs.rawIntensity < RANGE_PIN_LOW;
      pinnedSec = pinned ? pinnedSec + dt : 0;
      rangeStale = clamp01(pinnedSec / RANGE_STALE_CONFIRM_SEC);

      // --- fusion ---
      const primary = Math.max(gapConfidence, novelty, tempoShift);
      confidence = clamp01(primary + RANGE_STALE_BOOST * rangeStale + LOCK_DROP_BOOST * tempoLockDrop);

      const aboveNow = confidence > (wasAboveProvisional ? PROVISIONAL_RELEASE : PROVISIONAL_TRIGGER);
      const provisional = aboveNow && !wasAboveProvisional;
      wasAboveProvisional = aboveNow;

      if (provisional && !pendingConfirm && sinceBoundarySec > REFRACTORY_SEC) {
        pendingConfirm = true;
        confirmTimer = 0;
        // The slow mean, not the fast one — see file header on why.
        preSnapshot.set(bandEstablished);
      }

      let confirmed = false;
      if (pendingConfirm) {
        confirmTimer += dt;
        if (confirmTimer >= CONFIRM_HOLD_SEC) {
          confirmed = cosineDistance(bandRecent, preSnapshot) >= CONFIRM_DISTANCE_MIN;
          pendingConfirm = false;
        }
      }
      sinceBoundarySec = confirmed ? 0 : sinceBoundarySec + dt;

      (state as { quietDepth: number }).quietDepth = quietDepth;
      (state as { quietHoldSec: number }).quietHoldSec = quietHoldSec;
      (state as { gapConfidence: number }).gapConfidence = gapConfidence;
      (state as { novelty: number }).novelty = novelty;
      (state as { centroidStep: number }).centroidStep = centroidStep;
      (state as { tempoLockDrop: number }).tempoLockDrop = tempoLockDrop;
      (state as { tempoShift: number }).tempoShift = tempoShift;
      (state as { rangeStale: number }).rangeStale = rangeStale;
      (state as { confidence: number }).confidence = confidence;
      (state as { provisional: boolean }).provisional = provisional;
      (state as { confirmed: boolean }).confirmed = confirmed;
      (state as { sinceBoundarySec: number }).sinceBoundarySec = sinceBoundarySec;
    },
  };

  return state;
}
