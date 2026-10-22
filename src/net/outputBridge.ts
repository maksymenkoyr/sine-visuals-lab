import type { SilenceGateMarks } from "../audio/silenceGate.ts";
import type { FeatureFrame } from "../audio/types.ts";
import { NO_EFFECTS, type HeldEffects } from "../render/heldEffects.ts";
import {
  createCueController,
  createOutputPresence,
  type CueController,
  type OutputParams,
  type OutputPower,
  type OutputState,
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
 * The page is opened `noopener` (OUTPUT_WINDOW_FEATURES says why), so this
 * window never holds the output's Window: whether one is open is presence
 * alone — its hello heartbeat, its bye on unload, or the heartbeat lapsing
 * after a crash. Nor can a second window.open find it by name, so open()
 * keeps it to one itself: while an output is alive, or one was asked for less
 * than OUTPUT_OPEN_GRACE_MS ago and has not said hello yet, a press of POP
 * OUT sends `raise` instead of opening another.
 *
 * Driven by app.ts's render loop: `update()` once per tick (presence, the
 * look-change poll), `pushFrame()` whenever a feature frame exists.
 */

export const OUTPUT_CHANNEL = "svl-output-v1";
/** The output page, and the name its window is given. The name no longer finds
 *  an open output (a `noopener` window is out of this window's reach), which
 *  is why open() counts outputs itself. */
export const OUTPUT_URL = "/output.html";
export const OUTPUT_WINDOW_NAME = "svl-output";
/** `noopener` puts the output in a browsing context group of its own, so the
 *  browser can run it in its own renderer process: this window's main-thread
 *  work (the panel, a scene's shader compile) no longer drops the output's
 *  frames, and a crash in one window no longer takes the other down. In
 *  exchange window.open returns null: the output is reached only through the
 *  transport. */
const OUTPUT_WINDOW_FEATURES = "popup=yes,width=1280,height=720,noopener";
/** How long after open() asked for a window a further press still counts it as
 *  on its way while it has not said hello: loading the page and setting up its
 *  GL take a moment, longest on a cold dev server. A press after that with
 *  still no hello opens again (that window never came). */
export const OUTPUT_OPEN_GRACE_MS = 5000;

/** How often the look (scene, palette, synced stores) is re-read to spot a change. */
const LOOK_POLL_MS = 120;
/** How often a wanted `thumbs` request is repeated: well inside
 *  THUMBS_TIMEOUT_MS, so one lost message does not stop the thumbnails. */
const THUMBS_RESEND_MS = 1000;

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
  /** Play means something here. False on a room device the owner has not let
   *  play (roomBridge.ts), so the bar hides PLAY; absent means true. */
  canPlay?: boolean;
}

export interface OutputBridge {
  /** Open the output window. The pop-out's bridge asks one already open, or
   *  still loading, to come to the front instead (outputBridge.ts's header). */
  open(): void;
  status(): OutputStatus;
  onStatus(cb: (s: OutputStatus) => void): void;
  setCue(on: boolean): void;
  /** Send the preview across. With `glideMs` > 0 the output arrives over that
   *  long: its settings glide within one scene, and a different scene
   *  crossfades over it (render/crossfade.ts). Returns whether the output was
   *  asked to take that long. */
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
  /** The held effects now engaged on this window (render/heldEffects.ts), sent
   *  on as their own message — never part of the look, never held by Cue. Kept
   *  and re-sent with every heartbeat reply. No-op while no output is open. */
  sendEffects(effects: HeldEffects): void;
  /** The output's last reported render readouts, null while it is closed. */
  outputStatus(): OutputRenderStatus | null;
  /** NEXT (re-read now) and LIVE (what the output was last sent). Either is null while no output is open. */
  looks?(): { next: OutputState | null; live: OutputState | null };
  /** Sends `state` as the new program (CueController.goState). False while no output is open. */
  sendState?(state: OutputState, glideMs?: number): boolean;
  /** Drop this device's unplayed edits and show what Main shows now (the room
   *  bridge's answer to `changedBy`). The pop-out has nothing to take. */
  take?(): void;
  /** Asks the output for its thumbnails (ToOutput `thumbs`) while `on`; the
   *  request is repeated while wanted and lapses without one. No-op while closed. */
  setThumbs?(on: boolean): void;
  /** Each thumbnail the output sends (ToMain `thumb`). The listener owns the bitmap. */
  onThumb?(cb: (bmp: ImageBitmap) => void): void;
}

/** The parts of an OutputStatus a listener cares about, as one comparable
 *  string: bridges call their listeners only when this changes. */
export function statusKey(s: OutputStatus): string {
  return `${s.open}|${s.cue}|${s.differs}|${s.canCue}|${s.changedBy ?? ""}|${s.canPlay ?? true}`;
}

export interface OutputBridgeOptions {
  transport: Transport<ToOutput, ToMain>;
  /** The main window's current scene and palette ids. */
  look: () => { scene: string; palette: string };
  /** Defaults to the real localStorage. */
  storage?: Pick<Storage, "getItem" | "key" | "length">;
  /** Opens the output page; window.open with OUTPUT_WINDOW_FEATURES when
   *  absent. Tests pass a counter. */
  openWindow?: () => void;
  /** The clock presence and open()'s grace run on; performance.now() when
   *  absent. Tests pass their own. */
  now?: () => number;
  /** The output's Quality and Energy saving choice (render/outputPower.ts). */
  power: () => OutputPower;
}

export function createOutputBridge(opts: OutputBridgeOptions): OutputBridge {
  const { transport } = opts;
  const now = opts.now ?? (() => performance.now());
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
  /** Until when a press of POP OUT still counts the window open() last asked
   *  for as on its way (OUTPUT_OPEN_GRACE_MS); a bye clears it. */
  let openingUntilMs = -Infinity;
  let latestParams: OutputParams = { sens: 1, exp: 1, smoothing: 1 };
  let latestEffects: HeldEffects = NO_EFFECTS;
  let lastPollMs = -Infinity;
  let lastStatusKey = "";
  let lastStatus: OutputRenderStatus | null = null;
  let thumbsWanted = false;
  let lastThumbsPostMs = -Infinity;
  const thumbListeners: Array<(bmp: ImageBitmap) => void> = [];

  function closed(): void {
    presence.bye();
    outputOpen = false;
    openingUntilMs = -Infinity;
    lastStatus = null;
    cue.outputClosed();
  }

  function preview(): void {
    const { scene, palette } = opts.look();
    cue.preview({ scene, palette, storage: captureSyncedStorage(storage), params: latestParams });
  }

  transport.onMessage((m) => {
    if (m.t === "thumb") {
      for (const cb of thumbListeners) cb(m.bmp);
      return;
    }
    if (m.t === "bye") {
      closed();
      return;
    }
    if (m.t === "status") {
      // A sign of life, nothing more: the hello path below re-sends state.
      lastStatus = m.s;
      presence.seen(now());
      outputOpen = true;
      return;
    }
    // Only the output's own messages count: another main window (a second
    // tab) on this channel posts frames, states and raises meant for it.
    if (m.t !== "hello") return;
    presence.seen(now());
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
    transport.post({ t: "effects", effects: latestEffects });
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
      const nowMs = now();
      if (presence.isOpen(nowMs) || nowMs < openingUntilMs) {
        transport.post({ t: "raise" });
        return;
      }
      openingUntilMs = nowMs + OUTPUT_OPEN_GRACE_MS;
      if (opts.openWindow) opts.openWindow();
      else window.open(OUTPUT_URL + qualityPinQuery(), OUTPUT_WINDOW_NAME, OUTPUT_WINDOW_FEATURES);
    },
    status,
    onStatus: (cb) => listeners.push(cb),
    setCue(on) {
      preview();
      cue.setCue(on);
      emitIfChanged();
    },
    go(glideMs) {
      preview();
      // Across a scene change the length becomes a crossfade on the output.
      const held = cue.held();
      const glide = !!glideMs && glideMs > 0 && !cue.cueOn() && held !== null;
      cue.go(glide ? glideMs : undefined);
      emitIfChanged();
      return glide;
    },
    update(nowMs) {
      outputOpen = presence.isOpen(nowMs) && outputOpen;
      if (outputOpen && nowMs - lastPollMs >= LOOK_POLL_MS) {
        lastPollMs = nowMs;
        preview();
      }
      if (outputOpen && thumbsWanted && nowMs - lastThumbsPostMs >= THUMBS_RESEND_MS) {
        lastThumbsPostMs = nowMs;
        transport.post({ t: "thumbs", on: true });
      }
      emitIfChanged();
    },
    setThumbs(on) {
      if (on === thumbsWanted) return;
      thumbsWanted = on;
      if (!outputOpen) return;
      lastThumbsPostMs = now();
      transport.post({ t: "thumbs", on });
    },
    onThumb: (cb) => void thumbListeners.push(cb),
    sendPower() {
      if (outputOpen) transport.post({ t: "power", power: opts.power() });
    },
    sendEffects(effects) {
      latestEffects = effects;
      if (outputOpen) transport.post({ t: "effects", effects });
    },
    outputStatus: () => (outputOpen ? lastStatus : null),
    looks() {
      if (!outputOpen) return { next: null, live: null };
      preview();
      return { next: cue.current(), live: cue.held() };
    },
    sendState(state, glideMs) {
      if (!outputOpen) return false;
      cue.goState(state, glideMs && glideMs > 0 ? glideMs : undefined);
      emitIfChanged();
      return true;
    },
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
          gateDimmer: frame.gateDimmer,
          hats: frame.hats,
          lead: frame.lead,
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
