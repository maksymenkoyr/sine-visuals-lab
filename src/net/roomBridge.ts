import { diffLook, emptyLookDoc, type LookClientMsg, type LookDoc } from "../../server/lookDoc.ts";
import type { OutputBridge, OutputStatus } from "./outputBridge.ts";
import { createCueController, DEFAULT_OUTPUT_PARAMS, type CueController } from "./outputSync.ts";

/**
 * Cue and Play for the screens in the laptop's room: the pop-out's controls
 * (net/outputSync.ts's createCueController, ui/outputControls.ts) driving a TV
 * instead of a window. The cue logic is the same state machine; only the
 * delivery differs. Where the pop-out gets a `state` message over a
 * BroadcastChannel, a TV gets the look as a `lookPatch` to the room
 * (server/lookDoc.ts), which stores it and relays it to every screen and phone.
 *
 * The laptop is not told the room's look (the room sends hosts no snapshot), so
 * the patch is the difference from what this bridge last sent, `sent`, and a
 * screen's arrival or a reconnect starts `sent` over from nothing: the whole
 * look goes out again, which is harmless (a patch is idempotent) and heals a
 * room that lost it. A key the room still holds from before and the laptop no
 * longer has is not removed by that; it is a stray setting for the next scene
 * change to overwrite, not a wrong picture.
 *
 * What a TV does not get that the pop-out does: `params` (the laptop's
 * resolved Sensitivity / Expansion / Smoothing). A TV resolves its own from the
 * stored settings (src/tv.ts's header), so a glide moves the plain sliders and
 * the Master dials but not those three.
 *
 * Presence is the roster: a screen is a `renderer` in it, and Cue and Play are
 * offered while there is at least one. Frames already reach the TV from
 * `HostConnection.sendFrame`, so `pushFrame` has nothing to do here.
 *
 * `combineBridges` lets one Cue/Play bar drive the pop-out and the room's
 * screens together. Each keeps its own program (what Play last put there), as
 * two mixer outputs would.
 */

/** How often the look is re-read to spot a change (the pop-out's LOOK_POLL_MS). */
const LOOK_POLL_MS = 120;

export interface RoomBridgeOptions {
  /** Sends a look message to the room; false when the socket is not open. */
  send: (msg: LookClientMsg) => boolean;
  /** How many screens (renderers) the room lists right now. */
  screens: () => number;
  /** This window's current scene and palette ids. */
  look: () => { scene: string; palette: string };
  /** The room-scope settings as they are on this device now
   *  (syncedStores.ts's captureRoomStorage). */
  capture: () => Record<string, string>;
  /** Clicked "OUTPUT": there is nothing to open for a TV, so show the room view. */
  showRoom: () => void;
}

export interface RoomBridge extends OutputBridge {
  /** The host's socket (re)connected: the room may have lost what it held, so
   *  the whole look is sent again as the program. */
  reconnected(): void;
  /** The room refused a patch (too fast, too big): the next one carries everything. */
  refused(): void;
}

export function createRoomBridge(opts: RoomBridgeOptions): RoomBridge {
  let present = false;
  let sent: LookDoc = emptyLookDoc();
  let seq = 0;
  let lastPollMs = -Infinity;
  let lastStatusKey = "";
  const listeners: Array<(s: OutputStatus) => void> = [];

  const cue: CueController = createCueController((state, glideMs) => {
    // No screen listening: say so, so the controller keeps what the screen
    // really has and offers the look again.
    if (!present) return false;
    const doc: LookDoc = { scene: state.scene, palette: state.palette, storage: state.storage };
    const patch = diffLook(sent, doc);
    if (!patch) return true;
    const msg: LookClientMsg = { type: "lookPatch", n: ++seq, ...patch, ...(glideMs && glideMs > 0 ? { glideMs } : {}) };
    if (!opts.send(msg)) return false;
    sent = doc;
    return true;
  });

  function preview(): void {
    const { scene, palette } = opts.look();
    cue.preview({ scene, palette, storage: opts.capture(), params: DEFAULT_OUTPUT_PARAMS });
  }

  function status(): OutputStatus {
    return { open: present, cue: present && cue.cueOn(), differs: present && cue.differs() };
  }

  function emitIfChanged(): void {
    const s = status();
    const key = `${s.open}|${s.cue}|${s.differs}`;
    if (key === lastStatusKey) return;
    lastStatusKey = key;
    for (const cb of listeners) cb(s);
  }

  /** The roster has a screen where it had none (or lost the last one). */
  function setPresent(now: boolean): void {
    if (now === present) return;
    present = now;
    if (now) {
      sent = emptyLookDoc();
      preview();
      cue.outputOpened();
    } else cue.outputClosed();
  }

  return {
    open: opts.showRoom,
    status,
    onStatus: (cb) => listeners.push(cb),
    setCue(on) {
      if (present) preview();
      cue.setCue(on);
      emitIfChanged();
    },
    go(glideMs) {
      if (!present) return false;
      preview();
      // A glide never crosses a scene change: that goes instantly.
      const held = cue.held();
      const glide = !!glideMs && glideMs > 0 && !cue.cueOn() && held !== null && held.scene === opts.look().scene;
      cue.go(glide ? glideMs : undefined);
      emitIfChanged();
      return glide;
    },
    update(nowMs) {
      setPresent(opts.screens() > 0);
      if (present && nowMs - lastPollMs >= LOOK_POLL_MS) {
        lastPollMs = nowMs;
        preview();
      }
      emitIfChanged();
    },
    reconnected() {
      if (!present) return;
      sent = emptyLookDoc();
      preview();
      cue.outputOpened();
      emitIfChanged();
    },
    refused() {
      sent = emptyLookDoc();
    },
    // Frames reach a TV from HostConnection.sendFrame, and a TV's quality is its own.
    pushFrame() {},
    sendPower() {},
    outputStatus: () => null,
  };
}

/** One bar for several outputs. `open` is the first one's (the pop-out's: it is
 *  the one that can be opened); Cue and Play go to every output that is open;
 *  the status says "open" while any is, "cue" while any is cued and "differs"
 *  while any shows something other than the preview. Frames, power and render
 *  readouts are the first output's, the pop-out's. */
export function combineBridges(bridges: [OutputBridge, ...OutputBridge[]]): OutputBridge {
  const [first] = bridges;
  const live = (): OutputBridge[] => bridges.filter((b) => b.status().open);
  function status(): OutputStatus {
    let open = false;
    let cue = false;
    let differs = false;
    for (const b of bridges) {
      const s = b.status();
      open = open || s.open;
      cue = cue || s.cue;
      differs = differs || s.differs;
    }
    return { open, cue, differs };
  }
  return {
    open: () => first.open(),
    status,
    onStatus(cb) {
      let lastKey = "";
      const relay = (): void => {
        const s = status();
        const key = `${s.open}|${s.cue}|${s.differs}`;
        if (key === lastKey) return;
        lastKey = key;
        cb(s);
      };
      for (const b of bridges) b.onStatus(relay);
    },
    setCue(on) {
      // Releasing reaches every output, open or not: a Cue can outlive a window.
      for (const b of on ? live() : bridges) b.setCue(on);
    },
    go(glideMs) {
      let glided = false;
      for (const b of live()) glided = b.go(glideMs) || glided;
      return glided;
    },
    update(nowMs) {
      for (const b of bridges) b.update(nowMs);
    },
    pushFrame: (frame, extras, params) => first.pushFrame(frame, extras, params),
    sendPower: () => first.sendPower(),
    outputStatus: () => first.outputStatus(),
  };
}
