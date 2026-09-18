/**
 * The silence gate: two volume marks, `closed` < `open`, in FeatureFrame.level
 * units (see features.ts's LEVEL_DB_FLOOR/LEVEL_DB_CEIL — level is the one
 * absolute loudness reading the pipeline has). silenceGateDimmer() maps a
 * frame's level to a 0..1 multiplier — 0 at/below `closed`, 1 at/above
 * `open`, smoothstepped between — that features.ts's onset detector and
 * bandEnergy.ts's per-group detectors both fold into their firing
 * comparison. It exists because those detectors are purely relative: a
 * broadband/per-band flux baseline that adapts to whatever is currently
 * "loud", on a room-adaptive window that only ever floors out at
 * features.ts's MIN_RANGE_DB. In a near-silent room that baseline is just
 * mic hiss chasing mic hiss — there's no genuine quiet reference, so any
 * wobble above the hiss average clears the threshold and fires an onset.
 * `level` is the only signal in the pipeline that still knows "quiet" from
 * "loud" in absolute terms after the adaptive stages have re-normalized
 * everything else away, which is exactly what a silence gate needs to read.
 *
 * The dimmer multiplies ONLY the firing comparison — `flux * dimmer >
 * threshold` in features.ts, `rise * dimmer > threshold` per group in
 * bandEnergy.ts. Everything that scores or times a hit is computed on the
 * raw, ungated signal: the flux/rise baseline keeps adapting to the
 * genuine, ungated value (if the gate shrank the signal before the baseline
 * ever saw it, both sides of the comparison would shrink together and hiss
 * would go right on beating hiss — the gate would do nothing), the reported
 * ratio (features.ts's fluxRatio) stays the true unclamped score, and the
 * refractory/tempo-comb logic is untouched. Level is read on the same frame
 * as the candidate hit, not a smoothed lag of it, so a genuinely loud sound
 * in an otherwise silent room — a clap, a single loud beat — opens its own
 * gate that same tick and fires normally.
 *
 * Two marks, not one. A single on/off threshold is a switch, and a switch
 * chatters: with the firing comparison an all-or-nothing step function, a
 * level that happens to hover right at the mark (a song fading out, a mic's
 * own noise floor drifting a fraction of a dB) flips the gate open and shut
 * on every little wobble, exactly the flicker this exists to prevent. A
 * smoothstep between two marks turns that same wobble into a small change in
 * how much a hit has to stand out rather than a binary flip — the gate has
 * to be crossed by a wider margin of genuine loudness before an onset can
 * ever fire, not just brushed.
 *
 * Global per device (not per scene, unlike src/audio/sensitivity.ts and
 * src/render/sceneSettings.ts) — like autoGain.ts and bandSplit.ts, how
 * quiet this room/mic actually is describes the input, not one scene's look,
 * so it should carry across scene switches. Same in-memory-cache-over-
 * localStorage pattern as those modules: the cache is the source of truth
 * for get/set within a session, seeded once from localStorage, so behavior
 * stays correct even where localStorage is unavailable (node test env,
 * Safari private mode).
 *
 * The defaults below are placeholders, not measured against a real mic in a
 * real room: SILENCE_GATE_CLOSED_DEFAULT is set low because the room that
 * prompted this feature read Level as zero, and SILENCE_GATE_OPEN_DEFAULT is
 * set to sit at or under the quietest level src/audio/synthetic.ts's `level`
 * line ever emits, so the synthetic feed — every headless screenshot and
 * tuning tool that drives the app with `?audio=synthetic` — is never dimmed
 * by the shipped default (tests/silenceGate.test.ts pins this against the
 * real synthetic feed rather than trusting the arithmetic by eye).
 *
 * TV limitation: only the broadband onset flag (FeatureFrame.onset) is
 * computed by a FeatureExtractor and travels pre-gated to a paired TV over
 * src/net/protocol.ts's wire frame. bandEnergy.ts's per-band low/mid/high
 * detectors run independently on both the phone and the TV, each off its own
 * decoded `level` byte and its own locally-stored SilenceGateMarks — the
 * phone's marks never travel, the same way bandSplit.ts's low/mid crossovers
 * don't. So a phone's Silence gate setting doesn't gate what a paired TV's
 * own bandEnergy onsets treat as silence; only the TV's own copy of this
 * setting does that.
 */

const STORAGE_KEY_CLOSED = "vibe.silenceGateClosed";
const STORAGE_KEY_OPEN = "vibe.silenceGateOpen";

/** Slider range, in FeatureFrame.level units — see this file's header. */
export const SILENCE_GATE_MIN = 0;
export const SILENCE_GATE_MAX = 0.6;
/** Smallest gap the setters ever leave between the two marks — see
 *  setSilenceGateClosed/setSilenceGateOpen for how the invariant `open >=
 *  closed + SILENCE_GATE_MIN_WIDTH` is kept. */
export const SILENCE_GATE_MIN_WIDTH = 0.01;
export const SILENCE_GATE_CLOSED_DEFAULT = 0.05;
export const SILENCE_GATE_OPEN_DEFAULT = 0.15;

export interface SilenceGateMarks {
  closed: number;
  open: number;
}

/** One tick's gate reading, off one device's own FeatureExtractor — not the
 *  stored marks above (SilenceGateMarks), but what the gate actually did
 *  this tick. `dimmer` is FeatureExtractor.gateDimmer, `fired` is that same
 *  tick's FeatureFrame.onset, `suppressed` is FeatureExtractor.suppressed.
 *  One definition, shared by app.ts's `lastGate`, deviceMenu.ts's
 *  DeviceMenu.update(), and audioMeters.ts's AudioMeters.update() and Gate
 *  card, so none of them can drift into an incompatible shape. `null`
 *  wherever a device has no local extractor to read (a renderer, the
 *  synthetic feed) — the same null-hides-itself convention
 *  lastFixedEnergy/lastFluxRatio already use. */
export interface SilenceGateReading {
  dimmer: number;
  fired: boolean;
  suppressed: boolean;
}

function clampMark(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(SILENCE_GATE_MAX, Math.max(SILENCE_GATE_MIN, value));
}

function loadMark(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return clampMark(Number(raw), fallback);
  } catch {
    return fallback;
  }
}

let closedCache = loadMark(STORAGE_KEY_CLOSED, SILENCE_GATE_CLOSED_DEFAULT);
let openCache = loadMark(STORAGE_KEY_OPEN, SILENCE_GATE_OPEN_DEFAULT);
// The two keys are loaded independently, so a corrupted/hand-edited pair
// could violate the invariant the setters below always maintain — fix it by
// pulling `closed` down rather than pushing `open` up, so a bad stored
// `closed` can't silently widen what "open" requires.
if (openCache < closedCache + SILENCE_GATE_MIN_WIDTH) {
  closedCache = Math.max(SILENCE_GATE_MIN, openCache - SILENCE_GATE_MIN_WIDTH);
}

function persist(): void {
  snapshot = null;
  try {
    localStorage.setItem(STORAGE_KEY_CLOSED, String(closedCache));
    localStorage.setItem(STORAGE_KEY_OPEN, String(openCache));
  } catch {
    // Not fatal — the setting just won't persist across reloads.
  }
}

// Rebuilt only when a mark changes (persist() is the one place every setter
// ends), not per call — app.ts and tv.ts read this every tick, and a fresh
// object per read would be steady-state garbage for no reason.
let snapshot: SilenceGateMarks | null = null;

/** A frozen snapshot — callers can't mutate the cache through it. */
export function getSilenceGate(): SilenceGateMarks {
  if (snapshot === null) snapshot = Object.freeze({ closed: closedCache, open: openCache });
  return snapshot;
}

/** Clamps to [SILENCE_GATE_MIN, SILENCE_GATE_MAX] (non-finite -> the mark's
 *  own default), then keeps `open >= closed + SILENCE_GATE_MIN_WIDTH` by
 *  dragging `open` up if this new `closed` crowds it — capped short of
 *  SILENCE_GATE_MAX by the minimum width first, so there's always room above
 *  it for `open` to sit without itself exceeding SILENCE_GATE_MAX. */
export function setSilenceGateClosed(v: number): void {
  const closed = Math.min(clampMark(v, SILENCE_GATE_CLOSED_DEFAULT), SILENCE_GATE_MAX - SILENCE_GATE_MIN_WIDTH);
  closedCache = closed;
  if (openCache < closed + SILENCE_GATE_MIN_WIDTH) openCache = closed + SILENCE_GATE_MIN_WIDTH;
  persist();
}

/** Mirror of setSilenceGateClosed: floored above SILENCE_GATE_MIN by the
 *  minimum width first, so there's always room below it for `closed` to sit
 *  without going under SILENCE_GATE_MIN, then drags `closed` down if this new
 *  `open` crowds it. */
export function setSilenceGateOpen(v: number): void {
  const open = Math.max(clampMark(v, SILENCE_GATE_OPEN_DEFAULT), SILENCE_GATE_MIN + SILENCE_GATE_MIN_WIDTH);
  openCache = open;
  if (closedCache > open - SILENCE_GATE_MIN_WIDTH) closedCache = open - SILENCE_GATE_MIN_WIDTH;
  persist();
}

export function resetSilenceGate(): void {
  closedCache = SILENCE_GATE_CLOSED_DEFAULT;
  openCache = SILENCE_GATE_OPEN_DEFAULT;
  persist();
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Pure — takes `marks` explicitly rather than reading the store, so
 * features.ts's FeatureExtractor (which must stay store-free) and
 * bandEnergy.ts can both call it without becoming stateful about it
 * themselves. Smoothstepped (t*t*(3-2t), not a linear ramp) so the
 * multiplier's own rate of change eases in and out at each mark instead of
 * kinking there.
 *
 * Two special cases:
 * - `marks.closed <= SILENCE_GATE_MIN` means the gate is OFF: always returns
 *   1. Nothing is quieter than level zero, so there is nothing left to call
 *   silence — dragging Closed all the way down is how a user disables the
 *   gate entirely.
 * - A non-finite `level` returns 1 (fail open). Bad data reaching this
 *   function must never be the reason the visuals go silent.
 */
export function silenceGateDimmer(level: number, marks: SilenceGateMarks): number {
  if (marks.closed <= SILENCE_GATE_MIN) return 1;
  if (!Number.isFinite(level)) return 1;
  const span = marks.open - marks.closed;
  if (span <= 0) return 1; // degenerate marks shouldn't reach here via the exported setters — fail open
  const t = clamp01((level - marks.closed) / span);
  return t * t * (3 - 2 * t);
}
