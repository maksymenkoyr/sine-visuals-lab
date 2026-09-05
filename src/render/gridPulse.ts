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

export const GRID_LOCK_ON = 0.35;
export const GRID_LOCK_OFF = 0.2;

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
      const fired = lastIndex !== null && lastGridBeats === gridBeats && index !== lastIndex;
      lastIndex = index;
      lastGridBeats = gridBeats;
      return fired;
    },
  };
  return pulse;
}
