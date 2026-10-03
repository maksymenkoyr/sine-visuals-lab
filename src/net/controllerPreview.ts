/**
 * What a phone controller previews when the laptop stops sending.
 *
 * The jitter buffer (net/jitterBuffer.ts) holds its last frame once the room
 * clock passes it, and the relay says nothing when the laptop leaves, so
 * without a check a phone keeps the last energy and bands forever: a loud frame
 * previews as a stuck-loud scene while the user tunes. The TV answers with its
 * "waiting" phase (net/tvPhase.ts); the phone has no fallback to go to (it has
 * no microphone, and falling back to solo would turn it into a second player),
 * so it stays in the room and previews silence instead: the scene keeps
 * running on the room clock, so every setting the user changes still shows,
 * and the room badge says it is waiting.
 *
 * A frame that never arrived is not this: with no sample there is nothing to
 * draw, as before, and the badge says the same.
 */

import type { ConnState, VisualSample } from "./room.ts";

/** The sample with the audio taken out: no level, no bands, no onsets and no
 *  tempo (a bpm of zero is "unknown" to the beat grid), time left running. */
export function silentSample(s: VisualSample): VisualSample {
  return {
    bands: new Float32Array(s.bands.length),
    energy: 0,
    bpm: 0,
    beatPhase: 0,
    onsetFired: false,
    pulseFired: false,
    timeSec: s.timeSec,
    level: 0,
  };
}

/** The sample to preview this tick, and whether the badge should say the
 *  laptop is not sending. Stale means no frame arrived for `staleMs`
 *  (`msSinceLastFrame` is Infinity before the first). The badge says "waiting"
 *  only while the phone's own socket is open: a dropped socket has its own
 *  word, and is a different problem. */
export function controllerPreview(
  sample: VisualSample | null,
  msSinceLastFrame: number,
  state: ConnState,
  staleMs: number,
): { sample: VisualSample | null; waiting: boolean } {
  const stale = msSinceLastFrame >= staleMs;
  return {
    sample: sample && stale ? silentSample(sample) : sample,
    waiting: stale && state === "open",
  };
}

/** The room badge's text: the room, then the one thing worth saying about it. */
export function controllerBadgeText(room: string, state: ConnState, waiting: boolean): string {
  if (state !== "open") return `remote · ${room} · reconnecting`;
  return waiting ? `remote · ${room} · waiting for laptop` : `remote · ${room}`;
}
