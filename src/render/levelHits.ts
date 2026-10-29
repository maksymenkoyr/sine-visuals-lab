/**
 * Picks the hits out of a level that ticks up on each hit and falls back
 * between them (Hats, src/audio/stemSplit.ts), so it can be a hit like the
 * engine's lanes: animClock.ts turns each peak into AnimFrame.hatsOnset on
 * every device, and the Stems card's drum-roll track (src/ui/audioMeters.ts)
 * draws a note per peak.
 *
 * A hit is one of the level's peaks: it is reported on the first tick the
 * level turns down, if it got at least LEVEL_HIT_MIN high. Then nothing fires
 * until the level has fallen to LEVEL_HIT_REARM of that peak (or under
 * LEVEL_HIT_MIN), so the ripples on one hit's fall can't count as more hits.
 * Both were picked by how well the notes landed on the hats and cymbals of
 * Demucs's drum stem on real songs, heard through a tab share and a laptop
 * mic.
 */

export const LEVEL_HIT_MIN = 0.3;
export const LEVEL_HIT_REARM = 0.8;

export interface LevelHits {
  /** One tick's level, or null for no reading (which starts over). Returns the
   *  hit's peak on the tick it is found, else null. */
  update(level: number | null): number | null;
}

export function createLevelHits(min = LEVEL_HIT_MIN, rearm = LEVEL_HIT_REARM): LevelHits {
  let last = 0;
  let rising = false;
  let armed = true;
  let lastPeak = 0;
  return {
    update(level) {
      if (level === null) {
        last = 0;
        rising = false;
        armed = true;
        return null;
      }
      let hit: number | null = null;
      if (level > last) rising = true;
      else if (level < last && rising) {
        rising = false;
        if (armed && last >= min) {
          hit = last;
          lastPeak = last;
          armed = false;
        }
      }
      if (!armed && (level <= lastPeak * rearm || level < min)) armed = true;
      last = level;
      return hit;
    },
  };
}
