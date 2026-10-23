import type { StemLevels, StemRanges, StemSplitter } from "../../audio-subsystem/src/stemSplit.ts";
import { getDriveSetting } from "./driveStore.ts";
import type { SceneSetting } from "./sceneSettings.ts";
import type { SignalId } from "./signals.ts";

/**
 * Who reads Hats and Lead, so app.ts runs the stem split
 * (audio-subsystem/src/stemSplit.ts) only on ticks where something does. The split is
 * the largest piece of JavaScript in a scene with the panel closed (#553), and
 * most of the time nothing reads its two levels.
 *
 * Something reads them while any of these holds (app.ts's stemsRead() asks):
 *  - a setting of the scene is wired to one, through a source that isn't
 *    muted (`wiresReadStems` below). A setting left on its built-in reaction
 *    counts when its `drive.sceneSources` names one, so a scene whose own code
 *    reads AnimFrame.hats or .lead must list them there.
 *  - a crossfade is running: the outgoing scene still reads its own wires
 *    (compositor.ts's `drivesFor`) until the blend ends.
 *  - the panel's Stems row (deviceMenu.ts's Bands card) is on screen.
 *  - a screen fed by this window may show a look other than this window's:
 *    the pop-out holding an earlier Play (the cue controller in
 *    net/outputSync.ts says it differs), or any other device online in the
 *    room. The wire check above covers a screen only while it shows this
 *    window's look, and in a room it often doesn't: a phone previews its own
 *    edits before they are played, and the room's Main can be another
 *    device's look. The host can't see those wires, so any device counts.
 *  - a dev build: the tuning kit (src/tuning/debug.ts) snapshots both levels
 *    on demand (probe(), a mark, a clip), so they must already be live when
 *    it asks.
 *
 * On a tick where none holds, the frame keeps the zeros features.ts gives it,
 * so a screen gets 0 rather than a stale reading, and the anim clock eases
 * both levels down. When reading starts again the split starts over
 * (StemSplitter.reset) and settles within STEM_SETTLE_SEC, as at a fresh
 * start, instead of carrying a peak from before the pause; the anim clock
 * eases each level up from where it fell. The panel's heat (audioMeters.ts) asks the gate whether
 * the levels were measured, and records a gap rather than a cold stretch
 * while they weren't.
 */

const STEM_SIGNALS: ReadonlySet<SignalId> = new Set<SignalId>(["anim.hats", "anim.lead"]);

export function isStemSignal(id: SignalId): boolean {
  return STEM_SIGNALS.has(id);
}

/** Whether a wire reads Hats or Lead: an unmuted source on a setting of this
 *  scene, or a built-in reaction's `sceneSources` (see the header). */
export function wiresReadStems(sceneId: string, settings: readonly SceneSetting[]): boolean {
  for (const spec of settings) {
    if (!spec.drive) continue;
    const setting = getDriveSetting(sceneId, spec);
    if (setting === "scene") {
      if (spec.drive.sceneSources?.some((id) => STEM_SIGNALS.has(id))) return true;
      continue;
    }
    for (const src of setting.sources) {
      if (!src.off && typeof src.choice === "string" && STEM_SIGNALS.has(src.choice)) return true;
    }
  }
  return false;
}

export interface StemGate {
  /** One tick. With `read`, runs the split and returns its levels; without,
   *  leaves it idle and returns null, and the caller keeps the frame's zeros.
   *  The first read tick after an idle one resets the split first. */
  update(read: boolean, binsDb: ArrayLike<number>, nowSec: number, ranges: StemRanges): StemLevels | null;
  /** Whether the last tick ran the split. */
  measured(): boolean;
}

export function createStemGate(splitter: StemSplitter): StemGate {
  let idle = false;
  let measured = true;
  return {
    update(read, binsDb, nowSec, ranges) {
      measured = read;
      if (!read) {
        idle = true;
        return null;
      }
      if (idle) {
        splitter.reset();
        idle = false;
      }
      return splitter.update(binsDb, nowSec, ranges);
    },
    measured: () => measured,
  };
}
