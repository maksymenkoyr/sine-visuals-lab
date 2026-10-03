import { statusKey, type OutputBridge, type OutputStatus } from "./outputBridge.ts";
import type { MainPlay } from "./mainPlay.ts";

/**
 * Play to the room's Main screens, from any device, as an `OutputBridge` so the
 * same bar (ui/outputControls.ts) and keys (ui/outputKeys.ts) drive it as drive
 * the pop-out window.
 *
 * It is only a thin face on a `MainPlay` (net/mainPlay.ts), which owns the
 * rules. Main lives in the room (server/lookDoc.ts): every member receives it,
 * and each device's own look is its preview. This bridge turns that into the
 * bar's words:
 *
 *  - Play sends this device's look to Main: a tap switches every Main screen at
 *    once, a hold glides there within a scene (a scene change always switches
 *    at once). The glide is walked by the TV and the pop-out; a laptop's or an
 *    iPad's own main window follows a glide with a plain switch (known limit).
 *  - There is no Cue for the room: `canCue` is false, so the bar hides CUE
 *    unless the pop-out (which does have one) is open next to it.
 *  - `differs` is "Main is not what this device shows" (MAIN ≠ YOURS), and only
 *    while the room is open: a closed room can't be played to, so it must not
 *    keep a combined bar on "differs" after Play reached only the pop-out.
 *  - `changedBy` is set while someone else played over a device that had
 *    unplayed edits (also only while open); `take()` is that device's "Take Main".
 *
 * Following is MainPlay's job, not this bridge's: it hears the room's look
 * through its own events (snapshot, patch, ack, reject, disconnect), so there
 * is nothing to re-send here after a reconnect or a refusal. The only thing the
 * bridge drives is the clock: `update` ticks MainPlay, which re-reads this
 * device's look and works out whether it is on air.
 *
 * "Open" means another device of the room is online: with nobody else there,
 * Play has nobody to reach and the bar stays away.
 *
 * `combineBridges` lets one bar drive the pop-out and the room together on the
 * laptop. Play goes to every open bridge (the pop-out and Main), a held Cue only to
 * the bridges that can cue (the pop-out).
 */

export interface RoomBridgeOptions {
  /** The room's Main, as this device plays to and follows it. */
  play: MainPlay;
  /** Another member of the room is online right now. */
  present: () => boolean;
  /** Clicked "POP OUT" where there is nothing to open: show the room view. */
  showRoom: () => void;
}

/** What the app holds: a plain output bridge. */
export type RoomBridge = OutputBridge;

export function createRoomBridge(opts: RoomBridgeOptions): RoomBridge {
  const { play } = opts;
  const listeners: Array<(s: OutputStatus) => void> = [];

  function status(): OutputStatus {
    const p = play.status();
    // Before the room has told this device its Main there is nothing to differ from.
    // A closed room can't be played to, so it never reads as differing or changed
    // (else a combined bar would stay on OUT ≠ PREVIEW after Play reached only the pop-out).
    const open = opts.present();
    return { open, cue: false, differs: open && p.known && !p.onAir, canCue: false, changedBy: open ? p.changedBy : null };
  }

  function emitIfChanged(): void {
    const s = status();
    const key = statusKey(s);
    if (key === lastStatusKey) return;
    lastStatusKey = key;
    for (const cb of listeners) cb(s);
  }

  // The bar reads the status itself when it is built; listeners hear changes from there.
  let lastStatusKey = statusKey(status());
  play.onStatus(emitIfChanged);

  return {
    open: opts.showRoom,
    status,
    onStatus: (cb) => void listeners.push(cb),
    // The room has no Cue: a held key or button does nothing here.
    setCue() {},
    go(glideMs) {
      const result = play.play(glideMs);
      emitIfChanged();
      return result === "glide";
    },
    update(nowMs) {
      play.tick(nowMs);
      emitIfChanged();
    },
    take() {
      play.take();
      emitIfChanged();
    },
    // Frames reach a TV from HostConnection.sendFrame, and a TV's quality is its own.
    pushFrame() {},
    sendPower() {},
    outputStatus: () => null,
  };
}

/** One bar for several outputs. `open` is the first one's (the pop-out's: it is
 *  the one that can be opened); Play goes to every output that is open and Cue
 *  only to those that can cue. The status says "open" while any is, "cue" while
 *  any is cued, "differs" while any shows something other than the preview and
 *  "canCue" while an open one can cue; `changedBy` is the first one set. `take`
 *  reaches every output that has one. Frames, power and render readouts are
 *  the first output's, the pop-out's. */
export function combineBridges(bridges: [OutputBridge, ...OutputBridge[]]): OutputBridge {
  const [first] = bridges;
  const live = (): OutputBridge[] => bridges.filter((b) => b.status().open);
  function status(): OutputStatus {
    let open = false;
    let cue = false;
    let differs = false;
    let canCue = false;
    let changedBy: string | null = null;
    for (const b of bridges) {
      const s = b.status();
      open = open || s.open;
      cue = cue || s.cue;
      differs = differs || s.differs;
      canCue = canCue || (s.open && s.canCue);
      changedBy = changedBy ?? s.changedBy ?? null;
    }
    return { open, cue, differs, canCue, changedBy };
  }
  return {
    open: () => first.open(),
    status,
    onStatus(cb) {
      let lastKey = "";
      const relay = (): void => {
        const s = status();
        const key = statusKey(s);
        if (key === lastKey) return;
        lastKey = key;
        cb(s);
      };
      for (const b of bridges) b.onStatus(relay);
    },
    setCue(on) {
      // Holding reaches only an open output that can cue. Releasing reaches
      // every output, open or not (a Cue can outlive a window); the room's
      // setCue does nothing, so only the pop-out hears it.
      for (const b of bridges) {
        const s = b.status();
        if (!on || (s.open && s.canCue)) b.setCue(on);
      }
    },
    go(glideMs) {
      let glided = false;
      for (const b of live()) glided = b.go(glideMs) || glided;
      return glided;
    },
    update(nowMs) {
      for (const b of bridges) b.update(nowMs);
    },
    take() {
      for (const b of bridges) b.take?.();
    },
    pushFrame: (frame, extras, params) => first.pushFrame(frame, extras, params),
    sendPower: () => first.sendPower(),
    outputStatus: () => first.outputStatus(),
  };
}
