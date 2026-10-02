// Turns the beat clock's free-running beat count into the one-shot beat
// edge a scene sees (AnimFrame.onset / beatPulse), on the grid the Beat grid
// row picked (src/audio/beatGrid.ts). Sits inside animClock.advance()
// between beatClock and the AnimFrame it returns, so every scene reading
// anim.onset gets the grid for free and none has to know it exists.
//
// A grid stop only makes sense once the tracker has a tempo: beatClock's
// phase stalls at bpm 0 and drifts while it's still converging, so below
// GRID_LOCK_ON the pulse falls back to the raw onsets — the same picture as
// Hits — and only switches to the grid once tempoLock has climbed past it.
// The two thresholds are a hysteresis pair so a lock hovering at the line
// doesn't flip the source every few frames. The handover itself is silent:
// crossing the line never fires a pulse of its own, and neither does
// changing the grid mid-track (the first grid tick after a change is just
// the next boundary crossed).
//
// Band edges (lowOnset/midOnset/highOnset) are deliberately not gridded —
// they *are* hits by definition (a low onset is a kick), and a scene reads
// them for that.
//
// This module's own fallback is deliberate, not a gap to close: "the
// tracker's beat when it's sure, raw hits when it isn't" is what the plain
// Beat grid choice has always meant. A source that's *always* an evenly
// spaced metronome regardless of how sure the tracker is — never the raw
// hits, never wavering with a live estimate — is metronome.ts instead
// (src/render/signals.ts's anim.metronome/anim.metronomeBar); the two are
// exposed as separate drive sources rather than one setting doing both.

export const GRID_LOCK_ON = 0.35;
export const GRID_LOCK_OFF = 0.2;

// How far back (in beats) the count has to jump before the pulse re-arms at
// the new position instead of waiting to pass its old high-water mark. A beat
// trim can only rewind by under a bar; two bars back is a resync.
const REARM_BACK_BEATS = 8;

export interface GridPulse {
  /** True while a grid stop is selected and the tracker is locked enough
   *  for the grid to be driving — false on Hits or while falling back. */
  readonly onGrid: boolean;
  /** Advances one tick and returns whether a beat edge fires this tick.
   *  `beats` is beatClock's unwrapped beat count, `gridBeats` the beats per
   *  pulse (null = Hits), `rawOnset` this tick's detector edge. */
  advance(beats: number, tempoLock: number, gridBeats: number | null, rawOnset: boolean): boolean;
}

export function createGridPulse(): GridPulse {
  let locked = false;
  let lastIndex: number | null = null;
  let lastGridBeats: number | null = null;

  const pulse: GridPulse = {
    onGrid: false,
    advance(beats, tempoLock, gridBeats, rawOnset) {
      if (locked ? tempoLock < GRID_LOCK_OFF : tempoLock >= GRID_LOCK_ON) locked = !locked;
      const onGrid = gridBeats !== null && locked;
      (pulse as { onGrid: boolean }).onGrid = onGrid;
      if (!onGrid) {
        lastIndex = null;
        lastGridBeats = null;
        return rawOnset;
      }
      const index = Math.floor(beats / gridBeats);
      // Arm silently on entry or after a grid change — no pulse for the
      // boundary we happen to already be past.
      const armed = lastIndex !== null && lastGridBeats === gridBeats;
      // Only a boundary past the high-water mark fires. beatClock's phase
      // never runs backwards, but the beat trim on top of it can (a "later"
      // nudge, a trim reset, a multiplier change with an offset set), and a
      // rewound count crossing the same boundary again must not pulse twice.
      const fired = armed && index > (lastIndex as number);
      if (!armed) lastIndex = index;
      else if (index < (lastIndex as number) - Math.ceil(REARM_BACK_BEATS / gridBeats)) lastIndex = index; // a resync, not a nudge
      else lastIndex = Math.max(lastIndex as number, index);
      lastGridBeats = gridBeats;
      return fired;
    },
  };
  return pulse;
}
