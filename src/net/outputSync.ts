import type { FeatureFrame } from "../audio/types.ts";
import { VOLATILE_PREFIXES } from "./syncedStores.ts";

/**
 * The pop-out output window's message layer: what the main window (the
 * controller, src/app.ts) says to the output page (output.html ->
 * src/output.ts) on the same machine, and the pure state machines on each
 * end. No DOM, no transport: src/net/outputBridge.ts rides these messages on
 * a BroadcastChannel today; nothing here knows that, so a later relay of the
 * same `ToOutput`/`ToMain` messages over the room connection (net/room.ts)
 * needs no change to this file.
 *
 * Why not tv.ts as-is. The paired TV (src/tv.ts, net/protocol.ts) is fed
 * only a scene id, a palette id and raw feature frames — every setting,
 * Auto choice, drive patch and master dial is read from the TV's OWN
 * localStorage. A same-machine output needs the controller's settings too,
 * and needs them *held* while Cue is on, so the output page is a renderer
 * in tv.ts's mould (same scene/anim/drive pipeline) fed by these messages
 * instead of the room socket. What crosses is:
 *  - `state`: scene + palette + a snapshot of every localStorage key the
 *    app writes (net/syncedStores.ts — wholesale, so no store, present or
 *    future, can be forgotten; Quality, master dials, Looks, drives, gate
 *    marks all ride along). The output applies it into a private in-memory
 *    storage (net/outputStorage.ts), never the real localStorage the main
 *    window owns. Sent when the look changes (mirror mode), on Go, and when
 *    an output (re)connects.
 *  - `frame`: one per main render tick — the band-gained feature frame (the
 *    same one the main scene sees before Sensitivity/Expansion), plus the
 *    live-only extras the output's anim clock can't recompute (the local
 *    extractor's broadband ratio, the waveform peak). `p` carries the
 *    main window's resolved Sensitivity/Expansion/Smoothing for its scene;
 *    it is left off while Cue holds the output, so the held look keeps the
 *    numbers it was sent with.
 *  - `hello`/`bye` from the output: a once-a-second heartbeat (so the main
 *    window's button reflects a closed window) and a goodbye on unload.
 */

/** Sensitivity, Expansion and Smoothing as the main window resolved them
 *  (autoTune.ts's resolveSensitivity/resolveExpansion/resolveSmoothing) —
 *  resolved values, not stored ones, because Auto slews them live. */
export interface OutputParams {
  sens: number;
  exp: number;
  smoothing: number;
}

export const DEFAULT_OUTPUT_PARAMS: OutputParams = { sens: 1, exp: 1, smoothing: 1 };

export interface OutputState {
  scene: string;
  palette: string;
  /** Every mirrored localStorage key — net/syncedStores.ts's captureSyncedStorage. */
  storage: Record<string, string>;
  params: OutputParams;
}

export interface WireFrame extends FeatureFrame {
  /** features.ts's broadband ratio (animClock.advance's `beatRatio`), null off a local mic. */
  beatRatio: number | null;
  /** Waveform peak for AnimFrame.wavePeak, null off a local mic. */
  wavePeak: number | null;
  /** See the header; absent while Cue holds the output. */
  p?: OutputParams;
}

export type ToOutput = { t: "state"; state: OutputState } | { t: "frame"; f: WireFrame };
export type ToMain = { t: "hello"; haveState: boolean } | { t: "bye" };

/** Identity of what the output is showing, for "does the output match the
 *  preview" — scene, palette and the stored settings. `params` and the keys
 *  the main window rewrites on its own (VOLATILE_PREFIXES) are left out:
 *  Auto slews them continuously, which would read as a permanent difference. */
export function stateKey(s: OutputState): string {
  const keys = Object.keys(s.storage)
    .filter((k) => !VOLATILE_PREFIXES.some((p) => k.startsWith(p)))
    .sort();
  return JSON.stringify([s.scene, s.palette, keys.map((k) => [k, s.storage[k]])]);
}

export interface CueController {
  /** Main window's current look — call as often as you like (every tick is
   *  fine; it only acts on a change). In mirror mode a change is sent. */
  preview(state: OutputState): void;
  setCue(on: boolean): void;
  cueOn(): boolean;
  /** Send the preview to the output now, cue or not. */
  go(): void;
  /** An output window just appeared (or re-announced itself after the main
   *  window reloaded): it gets whatever it should be showing now. */
  outputOpened(): void;
  outputClosed(): void;
  /** True while the output shows something other than the preview. */
  differs(): boolean;
  /** What the output was last sent, null before any. */
  held(): OutputState | null;
}

/** Cue / Go. Cue off: the output mirrors the preview. Cue on: the preview
 *  moves alone, the output keeps what it had until Go. */
export function createCueController(send: (state: OutputState) => void): CueController {
  let cue = false;
  let previewState: OutputState | null = null;
  let sent: OutputState | null = null;
  let sentKey = "";

  function push(state: OutputState): void {
    sent = state;
    sentKey = stateKey(state);
    send(state);
  }

  return {
    preview(state) {
      previewState = state;
      if (!cue && (sent === null || stateKey(state) !== sentKey)) push(state);
    },
    setCue(on) {
      cue = on;
      if (!on && previewState) push(previewState);
    },
    cueOn: () => cue,
    go() {
      if (previewState) push(previewState);
    },
    outputOpened() {
      sent = null;
      sentKey = "";
      if (previewState) push(previewState);
    },
    outputClosed() {
      sent = null;
      sentKey = "";
    },
    differs() {
      return previewState !== null && sent !== null && stateKey(previewState) !== sentKey;
    },
    held: () => sent,
  };
}

/** The output's frame mailbox: frames arrive at the main window's tick rate,
 *  the output renders at its own, so the latest frame is kept and the
 *  one-shot edges (onset, pulseOnset) are OR-ed until a render consumes
 *  them — a hit between two output ticks isn't lost, and one isn't fired
 *  twice when the output ticks faster than the main window. */
export interface FrameInbox {
  push(f: WireFrame, nowMs: number): void;
  /** Latest frame with pending one-shots delivered (and cleared), or null if none yet. */
  take(): WireFrame | null;
  /** ms since the last frame, Infinity before the first. */
  ageMs(nowMs: number): number;
  /** The newest `p` seen — held across frames that omit it. */
  params(): OutputParams;
  setParams(p: OutputParams): void;
}

export function createFrameInbox(): FrameInbox {
  let latest: WireFrame | null = null;
  let lastMs = -Infinity;
  let onset = false;
  let pulse = false;
  let params: OutputParams = DEFAULT_OUTPUT_PARAMS;
  return {
    push(f, nowMs) {
      latest = f;
      lastMs = nowMs;
      onset = onset || f.onset;
      pulse = pulse || f.pulseOnset;
      if (f.p) params = f.p;
    },
    take() {
      if (!latest) return null;
      const out: WireFrame = { ...latest, onset, pulseOnset: pulse };
      onset = false;
      pulse = false;
      return out;
    },
    ageMs: (nowMs) => (lastMs === -Infinity ? Infinity : nowMs - lastMs),
    params: () => params,
    setParams(p) {
      params = p;
    },
  };
}

/** How long without a heartbeat before an output counts as gone. The output
 *  beats once a second, so this rides out a dropped tick or two. */
export const OUTPUT_PRESENCE_TIMEOUT_MS = 3000;

/** The main window's view of whether an output window is alive. */
export interface OutputPresence {
  /** Returns true when this beat turned "absent" into "present". */
  seen(nowMs: number): boolean;
  bye(): void;
  isOpen(nowMs: number): boolean;
}

export function createOutputPresence(timeoutMs = OUTPUT_PRESENCE_TIMEOUT_MS): OutputPresence {
  let lastSeen = -Infinity;
  return {
    seen(nowMs) {
      const was = nowMs - lastSeen < timeoutMs;
      lastSeen = nowMs;
      return !was;
    },
    bye() {
      lastSeen = -Infinity;
    },
    isOpen: (nowMs) => nowMs - lastSeen < timeoutMs,
  };
}
