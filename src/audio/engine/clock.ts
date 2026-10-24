// A musical clock whose position in beats is a function of time from an
// anchor, so following a new tempo never jumps the position. It snaps to the
// tracker's grid (tempo.ts) on first lock, then pulls a share of each phase
// error per tracker update, and flags a beat on the frame nearest each whole
// beat by looking half a frame ahead.
//
// What the anim clock (src/render/animClock.ts) needs on top of the clock the
// bench scored:
// - The position it reports never goes back: the first snap goes forwards
//   onto the grid, a bar move is taken as its forward equivalent, and a pull
//   that would step back is held until the clock catches up. Beat grids
//   (src/render/gridPulse.ts) and the metronome count whole beats, and a
//   count that steps back fires a beat twice.
// - While the tracker hears no pulse the tempo coasts to a stop (COAST_RATE)
//   instead of running on, so nothing keeps time to music that isn't there.
// - A tap tempo (src/render/tapTempo.ts) seeds it, and a tap at half the
//   tracker's tempo makes it judge the tracker's beats against every half
//   beat, so the tracker's faster pulse corrects the timing but the tap says
//   which pulse is the beat. Bars aren't moved while it does: the tracker's
//   bar is in its own beats.

export interface ClockInput {
  /** The tracker's tempo; 0 or `music` false unlocks the clock. */
  bpm: number;
  music: boolean;
  /** The latest beat and bar start on the tracker's grid, on the clock's own timeline. */
  beatTime: number;
  downbeatTime: number;
  downbeatConfidence: number;
  /** Changes whenever the tracker refreshes; the clock follows each value once. */
  updates: number;
}

export interface ClockFrame {
  /** True on the frame nearest a beat, while locked. */
  beat: boolean;
  /** Beats since the clock started, fractional, never decreasing. */
  beats: number;
  /** Progress through the current beat, 0..1. */
  beatPhase: number;
  /** Beat within the bar, from 0. */
  beatInBar: number;
  /** Progress through the current bar, 0..1. */
  barPhase: number;
  /** The tempo the position runs at: the tracker's while locked, coasting to 0 while not. */
  bpm: number;
  locked: boolean;
}

/** Share of a phase error corrected per tracker update, so following never makes the clock jump. */
const PHASE_PULL = 0.3;
const MIN_DOWNBEAT_CONFIDENCE = 0.2;
/** The tracker must place the bar line on the same new beat this many updates in a row before bars move. */
const DOWNBEAT_CONFIRMATIONS = 4;
/** Two flagged beats are never closer than this share of a beat, whatever a phase pull does. */
const MIN_BEAT_GAP = 0.5;
/** Per second; the rate the clock this replaced eased its tempo at. */
const COAST_RATE = 2;
const COAST_STOP_BPM = 1;

export const BEATS_PER_BAR = 4;

/** The signed distance to the nearest whole number, in [-0.5, 0.5). */
function wrapHalf(x: number): number {
  return x - Math.floor(x + 0.5);
}

export class BeatClock {
  private bpm = 0;
  private anchorTime = 0;
  private anchorBeats = 0;
  private locked = false;
  private lastUpdate = -1;
  private lastFlagged = -Infinity;
  private flaggedIndex = -Infinity;
  private barShift = 0;
  private barVotes = 0;
  private division = 1;
  private shown = -Infinity;
  private readonly out: ClockFrame = { beat: false, beats: 0, beatPhase: 0, beatInBar: 0, barPhase: 0, bpm: 0, locked: false };

  private beatsAt(t: number): number {
    return this.anchorBeats + ((t - this.anchorTime) * this.bpm) / 60;
  }

  /** Follows a tracker reading; call whenever it may have changed. */
  follow(s: ClockInput, now: number): void {
    if (s.updates === this.lastUpdate) return;
    this.lastUpdate = s.updates;
    if (!s.music || s.bpm <= 0) {
      this.locked = false;
      return;
    }
    this.setTempo(s.bpm, now);
    const d = this.division;
    const error = wrapHalf(this.beatsAt(s.beatTime) * d) / d;
    if (!this.locked) {
      this.anchorBeats += error > 0 ? 1 / d - error : -error;
      this.locked = true;
      // A beat the snap jumped over is in the past; flag from the next one.
      this.flaggedIndex = Math.floor(this.beatsAt(now));
      this.lastFlagged = -Infinity;
    } else {
      this.anchorBeats -= error * PHASE_PULL;
    }
    if (d === 1) this.alignBars(s);
  }

  /** Runs at `bpm` from `now` on, with the position moved the short way onto `beatPhase`. */
  seed(bpm: number, beatPhase: number, now: number): void {
    this.setTempo(bpm, now);
    this.anchorBeats += wrapHalf(beatPhase - this.beatsAt(now));
  }

  /** 1, or 2 while a tap sits at half the tracker's tempo (see the file header). Kept until changed. */
  setDivision(division: 1 | 2): void {
    this.division = division;
  }

  /** Advances to `now`; `dt` is the frame's length, half of which is used to centre beat flags. */
  // @per-frame
  tick(now: number, dt: number): ClockFrame {
    if (!this.locked && this.bpm > 0) {
      const next = this.bpm - this.bpm * Math.min(1, COAST_RATE * dt);
      this.setTempo(next < COAST_STOP_BPM ? 0 : next, now);
    }
    const ahead = this.beatsAt(now + dt / 2);
    const index = Math.floor(ahead);
    let beat = false;
    if (index > this.flaggedIndex) {
      beat = this.locked && ahead - this.lastFlagged >= MIN_BEAT_GAP;
      if (beat) this.lastFlagged = ahead;
      this.flaggedIndex = index;
    }
    this.shown = Math.max(this.shown, this.beatsAt(now));
    const beats = this.shown;
    const inBar = ((beats % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR;
    const o = this.out;
    o.beat = beat;
    o.beats = beats;
    o.beatPhase = beats - Math.floor(beats);
    o.beatInBar = Math.floor(inBar);
    o.barPhase = inBar / BEATS_PER_BAR;
    o.bpm = this.bpm;
    o.locked = this.locked;
    return o;
  }

  private setTempo(bpm: number, now: number): void {
    if (bpm === this.bpm) return;
    this.anchorBeats = this.beatsAt(now);
    this.anchorTime = now;
    this.bpm = bpm;
  }

  private alignBars(s: ClockInput): void {
    if (s.downbeatConfidence < MIN_DOWNBEAT_CONFIDENCE) return;
    const per = BEATS_PER_BAR;
    const at = ((Math.round(this.beatsAt(s.downbeatTime)) % per) + per) % per;
    const delta = at === 0 ? 0 : at > per / 2 ? per - at : -at;
    if (delta === 0) {
      this.barVotes = 0;
      return;
    }
    if (delta === this.barShift) this.barVotes++;
    else {
      this.barShift = delta;
      this.barVotes = 1;
    }
    if (this.barVotes < DOWNBEAT_CONFIRMATIONS) return;
    // The same bar line a whole bar later, so the position only moves forwards.
    const forward = delta < 0 ? delta + per : delta;
    this.anchorBeats += forward;
    this.flaggedIndex += forward;
    this.lastFlagged += forward;
    this.barVotes = 0;
  }
}
