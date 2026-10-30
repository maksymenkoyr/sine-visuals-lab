// A whole SongFrame (src/audio/types.ts) for tests that drive the song tail
// through the wire, the jitter buffer and the anim clock: silence, with the
// fields a test names overridden.

import type { SongFrame } from "../src/audio/types.ts";
import type { AnimSong } from "../src/render/animClock.ts";

export function songFrame(overrides: Partial<SongFrame> = {}): SongFrame {
  return {
    kick: false,
    clap: false,
    hat: false,
    chord: false,
    clapLevel: 0,
    hatLevel: 0,
    chordLevel: 0,
    keys: 0,
    loudness: 0,
    dropLevel: 0,
    playing: 0,
    ...overrides,
  };
}

/** An AnimFrame.song at rest, with the fields a test names overridden. */
export function animSong(overrides: Partial<AnimSong> = {}): AnimSong {
  return {
    kickOnset: false,
    clapOnset: false,
    hatOnset: false,
    chordOnset: false,
    kickPulse: 0,
    clapPulse: 0,
    hatPulse: 0,
    chordPulse: 0,
    clapLevel: 0,
    hatLevel: 0,
    chordLevel: 0,
    keys: 0,
    loudness: 0,
    dropLevel: 0,
    playing: 0,
    ...overrides,
  };
}
