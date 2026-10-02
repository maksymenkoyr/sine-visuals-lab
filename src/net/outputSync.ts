import type { FeatureFrame } from "../audio/types.ts";
import type { PowerMode } from "../render/powerMode.ts";
import type { QualityPreset } from "../render/quality.ts";
import type { QualityChoice } from "../render/qualityPref.ts";
import type { SilenceGateMarks } from "../audio/silenceGate.ts";
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
 *    window owns. Sent when an output (re)connects, on Go (Play in the UI),
 *    while Cue is held (the preview, following live) and when Cue is released
 *    (the program Play last put there). A Go may carry `glideMs`: the output
 *    then arrives over that long instead of switching (outputGlide.ts). The
 *    output is the master, as on a DJ mixer: tuning the preview sends nothing
 *    (createCueController).
 *  - `frame`: one per main render tick — the band-gained feature frame (the
 *    same one the main scene sees before Sensitivity/Expansion), plus the
 *    live-only extras the output's anim clock can't recompute (the local
 *    extractor's broadband ratio, the waveform peak). `p` carries the
 *    main window's resolved Sensitivity/Expansion/Smoothing for its scene;
 *    it is left off unless the output shows the preview live (Cue held, or
 *    the two match), so a held look keeps the numbers it was sent with.
 *    `gate` is the main window's resolved silence-gate marks, always sent:
 *    they describe the room and the mic, not the look, so a held look never
 *    keeps stale ones (and under Auto the stored marks stay at their defaults
 *    while the controller's room-floor tracker moves the real ones).
 *  - `power`: the output's own Quality, Energy saving and Resolution choice
 *    (render/outputPower.ts). Not part of the look, so Cue never holds it and
 *    the synced snapshot never carries it: it is how this window renders.
 *    Re-sent with every heartbeat reply, so a missed one heals.
 *  - `hello`/`bye` from the output: a once-a-second heartbeat (so the main
 *    window's button reflects a closed window) and a goodbye on unload.
 *  - `status` from the output: its live render readouts (preset, fps,
 *    governor), twice a second, for the Output Power card in the main
 *    window's panel. Also counts as a sign of life, but unlike `hello` it
 *    never makes the main window re-send state.
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
  /** See the header; absent while the output shows its own look, not the preview. */
  p?: OutputParams;
  /** The main window's resolved silence-gate marks (audio/silenceGate.ts's
   *  resolveSilenceGate), for the output's own band-onset detectors; see the
   *  header. Optional only for an older main window that doesn't send it. */
  gate?: SilenceGateMarks;
}

/** How the output window renders: its Quality choice, Energy saving mode and
 *  Resolution scale (outputPower.ts's RESOLUTION_MIN..RESOLUTION_MAX). */
export interface OutputPower {
  quality: QualityChoice;
  mode: PowerMode;
  resolution: number;
}

/** The output window's live render readouts — the fields of the Power card's
 *  PowerStatus that only the output can measure (ui/powerCard.ts). */
export interface OutputRenderStatus {
  preset: QualityPreset;
  /** What Auto resolves to on the output's own GPU. */
  recommended: QualityPreset;
  fps: number;
  /** Governor step, null while a dev pin skips the governor. */
  level: number | null;
  maxLevel: number;
  fraction: number;
  standingDown: boolean;
  bufferWidth: number;
  bufferHeight: number;
}

/** `glideMs` (state only): the output arrives at this look over that long
 *  instead of switching at once — src/net/outputGlide.ts says what moves
 *  smoothly and what waits. Absent is the plain instant send. */
export type ToOutput =
  | { t: "state"; state: OutputState; glideMs?: number }
  | { t: "frame"; f: WireFrame }
  | { t: "power"; power: OutputPower };
export type ToMain = { t: "hello"; haveState: boolean } | { t: "bye" } | { t: "status"; s: OutputRenderStatus };

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
   *  fine; it only acts on a change). Reaches the output only while Cue is
   *  held (and once, to seed an output that has nothing yet). */
  preview(state: OutputState): void;
  /** Cue pressed (true) or released (false). Pressed: the output shows the
   *  preview, following it live. Released: it goes back to what Go last put
   *  there. */
  setCue(on: boolean): void;
  cueOn(): boolean;
  /** True while the output shows the preview live — Cue held, or the two
   *  match — the only time the main window's resolved Sensitivity/Expansion/
   *  Smoothing ride along on frames. */
  following(): boolean;
  /** Play: the preview becomes what the output shows, for good (a released
   *  Cue returns to it). `glideMs` asks the output to arrive over that long
   *  (see ToOutput); ignored while Cue is held, when the output already
   *  shows the preview. */
  go(glideMs?: number): void;
  /** Re-sends whatever the output should be showing right now (the preview
   *  while Cue is held, else the program) if it differs from what it was last
   *  *delivered*. For an output that reappears with its state intact after a
   *  stretch the send callback reported as undelivered: a Play or Cue pressed
   *  then moved the controller's intent but never reached the window. */
  resync(): void;
  /** An output window just appeared (or re-announced itself after the main
   *  window reloaded): it gets the preview as its program. */
  outputOpened(): void;
  outputClosed(): void;
  /** True while the output shows something other than the preview. */
  differs(): boolean;
  /** What the output was last sent, null before any. */
  held(): OutputState | null;
}

/** Cue / Play, as on a DJ mixer. The output is the master: it keeps its
 *  program — what Play last sent it — however the preview is tuned. Holding
 *  Cue puts the preview on the master for as long as it's held (and lets it
 *  follow live edits); releasing Cue puts the program back. Play makes the
 *  preview the new program, so a Cue released afterwards has nothing to undo. */
export function createCueController(
  /** Returns false when the message could not be delivered (no output window
   *  listening right now): the controller then leaves `held()` at what the
   *  output really has, so a later resync() can catch it up. */
  send: (state: OutputState, glideMs?: number) => boolean | void,
): CueController {
  let cue = false;
  let previewState: OutputState | null = null;
  /** previewState's and program's stateKey, computed once when each is set:
   *  differs() and following() run on every render tick, and a stateKey
   *  sorts and stringifies the whole mirrored storage. A state object is
   *  never mutated after capture, so the key can't go stale. */
  let previewKey = "";
  /** What Play last put on the output — what a released Cue returns to. */
  let program: OutputState | null = null;
  let programKey = "";
  let sent: OutputState | null = null;
  let sentKey = "";

  function push(state: OutputState, glideMs?: number): void {
    if (send(state, glideMs) === false) return;
    sent = state;
    sentKey = state === previewState ? previewKey : state === program ? programKey : stateKey(state);
  }

  function differs(): boolean {
    return previewState !== null && sent !== null && previewKey !== sentKey;
  }

  return {
    preview(state) {
      previewState = state;
      previewKey = stateKey(state);
      if (sent === null) {
        program = state;
        programKey = previewKey;
        push(state);
      } else if (cue && previewKey !== sentKey) push(state);
    },
    setCue(on) {
      if (on === cue) return;
      cue = on;
      if (on) {
        if (previewState && differs()) push(previewState);
      } else if (program && programKey !== sentKey) push(program);
    },
    cueOn: () => cue,
    following: () => cue || !differs(),
    go(glideMs) {
      if (!previewState) return;
      program = previewState;
      programKey = previewKey;
      push(previewState, cue ? undefined : glideMs);
    },
    resync() {
      const target = cue ? previewState : program;
      const key = cue ? previewKey : programKey;
      if (target && key !== sentKey) push(target);
    },
    outputOpened() {
      sent = null;
      sentKey = "";
      program = previewState;
      programKey = previewKey;
      if (previewState) push(previewState);
    },
    outputClosed() {
      sent = null;
      sentKey = "";
      program = null;
      programKey = "";
    },
    differs,
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
