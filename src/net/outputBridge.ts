import type { SilenceGateMarks } from "../audio/silenceGate.ts";
import type { FeatureFrame } from "../audio/types.ts";
import {
  createCueController,
  createOutputPresence,
  type CueController,
  type OutputParams,
  type OutputPower,
  type OutputRenderStatus,
  type ToMain,
  type ToOutput,
} from "./outputSync.ts";
import { captureSyncedStorage } from "./syncedStores.ts";

/**
 * The main window's end of the pop-out output (message layer and the why:
 * outputSync.ts): opens the output page, owns Cue/Go and presence, and
 * streams frames to it. Transport is injected — BroadcastChannel today
 * (createBroadcastTransport), so the output needs no server or room; a later
 * relay over the room connection is another `Transport`, same messages.
 *
 * Driven by app.ts's render loop: `update()` once per tick (presence, the
 * look-change poll), `pushFrame()` whenever a feature frame exists.
 */

export const OUTPUT_CHANNEL = "svl-output-v1";
/** The output page, and the name of its window: `window.open` with a fixed
 *  name focuses the existing window instead of stacking a second one. */
export const OUTPUT_URL = "/output.html";
export const OUTPUT_WINDOW_NAME = "svl-output";

/** How often the look (scene, palette, synced stores) is re-read to spot a change. */
const LOOK_POLL_MS = 120;

/** The dev `?quality=`/`?tier=` pin, if this window has one, to hand on to the
 *  output (render/quality.ts's parseQualityPreset) so both render alike. */
function qualityPinQuery(): string {
  const src = new URLSearchParams(location.search);
  const out = new URLSearchParams();
  for (const k of ["quality", "tier"]) {
    const v = src.get(k);
    if (v !== null) out.set(k, v);
  }
  const s = out.toString();
  return s ? `?${s}` : "";
}

export interface Transport<Out, In> {
  post(msg: Out): void;
  onMessage(cb: (msg: In) => void): void;
}

export function createBroadcastTransport<Out, In>(name = OUTPUT_CHANNEL): Transport<Out, In> {
  const ch = new BroadcastChannel(name);
  return {
    post: (m) => ch.postMessage(m),
    onMessage: (cb) => ch.addEventListener("message", (e: MessageEvent) => cb(e.data as In)),
  };
}

export interface OutputStatus {
  open: boolean;
  /** Cue is held: the output shows the preview (outputSync.ts's createCueController). */
  cue: boolean;
  /** Output shows something other than the preview. */
  differs: boolean;
  /** Cue means something: the pop-out window is open (the room has no Cue, so
   *  a room-only bridge says false and the bar hides CUE). */
  canCue: boolean;
  /** Who changed Main while this device had unplayed edits (a display name),
   *  null or absent otherwise. Only the room bridge sets it (roomBridge.ts). */
  changedBy?: string | null;
}

export interface OutputBridge {
  /** Open the output window, or focus it if it's already there. */
  open(): void;
  status(): OutputStatus;
  onStatus(cb: (s: OutputStatus) => void): void;
  setCue(on: boolean): void;
  /** Send the preview across. With `glideMs` > 0 the output arrives over that
   *  long — but only within one scene (never across a scene change, which goes
   *  instantly). Returns whether a glide was actually asked for. */
  go(glideMs?: number): boolean;
  update(nowMs: number): void;
  pushFrame(
    frame: FeatureFrame,
    extras: { beatRatio: number | null; wavePeak: number | null; gate: SilenceGateMarks },
    params: OutputParams,
  ): void;
  /** Send the output its Quality / Energy saving now (it also gets them on
   *  every heartbeat reply). No-op while no output is open. */
  sendPower(): void;
  /** The output's last reported render readouts, null while it is closed. */
  outputStatus(): OutputRenderStatus | null;
  /** Drop this device's unplayed edits and show what Main shows now (the room
   *  bridge's answer to `changedBy`). The pop-out has nothing to take. */
  take?(): void;
}

/** The parts of an OutputStatus a listener cares about, as one comparable
 *  string: bridges call their listeners only when this changes. */
export function statusKey(s: OutputStatus): string {
  return `${s.open}|${s.cue}|${s.differs}|${s.canCue}|${s.changedBy ?? ""}`;
}

export interface OutputBridgeOptions {
  transport: Transport<ToOutput, ToMain>;
  /** The main window's current scene and palette ids. */
  look: () => { scene: string; palette: string };
  /** Defaults to the real localStorage. */
  storage?: Pick<Storage, "getItem" | "key" | "length">;
  openWindow?: () => Window | null;
  /** The output's Quality and Energy saving choice (render/outputPower.ts). */
  power: () => OutputPower;
}

/** The pop-out's own bridge: an `OutputBridge` that also hands out the output's
 *  Window, so the clip recorder (ui/clipRecorder.ts) can reach its canvas. The
 *  room's bridge has no such window. */
export interface PopOutBridge extends OutputBridge {
  /** The output window while it is open and reachable, else null. */
  popupWindow(): Window | null;
}

export function createOutputBridge(opts: OutputBridgeOptions): PopOutBridge {
  const { transport } = opts;
  const storage = opts.storage ?? localStorage;
  const presence = createOutputPresence();
  let outputOpen = false;
  const cue: CueController = createCueController((state, glideMs) => {
    // Not delivered while presence has lapsed: say so, or the controller
    // would record the look as sent and never offer it again.
    if (!outputOpen) return false;
    transport.post(glideMs && glideMs > 0 ? { t: "state", state, glideMs } : { t: "state", state });
    return true;
  });
  const listeners: Array<(s: OutputStatus) => void> = [];
  let win: Window | null = null;
  let latestParams: OutputParams = { sens: 1, exp: 1, smoothing: 1 };
  let lastPollMs = -Infinity;
  let lastStatusKey = "";
  let lastStatus: OutputRenderStatus | null = null;

  function closed(): void {
    presence.bye();
    outputOpen = false;
    win = null;
    lastStatus = null;
    cue.outputClosed();
  }

  function preview(): void {
    const { scene, palette } = opts.look();
    cue.preview({ scene, palette, storage: captureSyncedStorage(storage), params: latestParams });
  }

  transport.onMessage((m) => {
    if (m.t === "bye") {
      closed();
      return;
    }
    if (m.t === "status") {
      // A sign of life, nothing more: the hello path below re-sends state.
      lastStatus = m.s;
      presence.seen(performance.now());
      outputOpen = true;
      return;
    }
    presence.seen(performance.now());
    outputOpen = true;
    // A window that lost its state (fresh, or reloaded) is sent the current
    // one; one that still has it keeps its program — plus any Play or Cue
    // pressed while its presence had lapsed, which never reached it.
    if (!m.haveState || cue.held() === null) {
      preview();
      cue.outputOpened();
    } else {
      cue.resync();
    }
    transport.post({ t: "power", power: opts.power() });
  });

  function status(): OutputStatus {
    return { open: outputOpen, cue: outputOpen && cue.cueOn(), differs: outputOpen && cue.differs(), canCue: outputOpen };
  }

  function emitIfChanged(): void {
    const s = status();
    const key = statusKey(s);
    if (key === lastStatusKey) return;
    lastStatusKey = key;
    for (const cb of listeners) cb(s);
  }

  return {
    open() {
      if (win && !win.closed) {
        win.focus();
        return;
      }
      win = opts.openWindow
        ? opts.openWindow()
        : window.open(OUTPUT_URL + qualityPinQuery(), OUTPUT_WINDOW_NAME, "popup=yes,width=1280,height=720");
    },
    popupWindow: () => (win && !win.closed ? win : null),
    status,
    onStatus: (cb) => listeners.push(cb),
    setCue(on) {
      preview();
      cue.setCue(on);
      emitIfChanged();
    },
    go(glideMs) {
      preview();
      // A glide never crosses a scene change: that goes instantly.
      const held = cue.held();
      const glide = !!glideMs && glideMs > 0 && !cue.cueOn() && held !== null && held.scene === opts.look().scene;
      cue.go(glide ? glideMs : undefined);
      emitIfChanged();
      return glide;
    },
    update(nowMs) {
      if (win && win.closed) closed();
      outputOpen = presence.isOpen(nowMs) && outputOpen;
      if (outputOpen && nowMs - lastPollMs >= LOOK_POLL_MS) {
        lastPollMs = nowMs;
        preview();
      }
      emitIfChanged();
    },
    sendPower() {
      if (outputOpen) transport.post({ t: "power", power: opts.power() });
    },
    outputStatus: () => (outputOpen ? lastStatus : null),
    pushFrame(frame, extras, params) {
      latestParams = params;
      if (!outputOpen) return;
      transport.post({
        t: "frame",
        f: {
          time: frame.time,
          bands: frame.bands,
          energy: frame.energy,
          level: frame.level,
          onset: frame.onset,
          pulseOnset: frame.pulseOnset,
          bpm: frame.bpm,
          onsetPhase: frame.onsetPhase,
          beatRatio: extras.beatRatio,
          wavePeak: extras.wavePeak,
          gate: extras.gate,
          ...(cue.following() ? { p: params } : {}),
        },
      });
    },
  };
}
