import {
  addMapping,
  decodeMidi,
  LEARN_IDLE,
  learnStep,
  mappingText,
  parseMappings,
  removeMapping,
  serializeMappings,
  targetLive,
  type KeySpec,
  type LearnEvent,
  type LearnState,
  type LearnTarget,
  type Mapping,
  type MidiMessage,
} from "./midiMap.ts";

/**
 * Web MIDI for the panel's MIDI card: connecting to the controllers, the live
 * learn session, and turning their messages into what the panel already does.
 * The rules it follows (decoding, scaling, the mapping store, the learn
 * steps) are in midiMap.ts and tested there; this file is the glue, with
 * everything it touches handed in through `MidiEnv` so a test can drive it
 * with fakes. `browserMidiEnv` is the real one.
 *
 * What a mapping does:
 *  - A CC mapping moves a slider. The value is recorded per target and
 *    applied on the next animation frame, so a knob that sends hundreds of
 *    messages a second reaches a setting as often as a hand drag would. The
 *    `applyCc` hook (midiCard.ts) sets the slider and fires its own "input"
 *    event, so the move takes the exact path a drag takes: the setting's
 *    store, what a drag does to Auto, Looks, the output window and the room.
 *    Only mappings aimed at the scene on screen (or a Master dial) act.
 *  - A note mapping stands in for one computer key: note on is a keydown,
 *    note off a keyup, dispatched on the focused element (or the body) so the
 *    window-level key handlers in app.ts see them like a real press. Nothing
 *    in the app checks `isTrusted`, so no handler needs to know. Keys still
 *    held when a controller is unplugged are released, so a held Cue cannot
 *    stick.
 *
 * Learn: while a session is on, MIDI messages only teach (they do not also
 * drive their old mappings), and keyboard presses are taken by learning
 * instead of reaching the app — in the window's capture phase, ahead of the
 * handlers app.ts registers later. Escape cancels; Tab passes through.
 *
 * MIDI access is only requested on `connect()`, which the card calls from a
 * button press (Chrome then asks the person). `autoConnect()` reconnects on a
 * later load, and only when the browser already says the permission is
 * granted, so a page load never raises a prompt.
 */

/** The localStorage key of the mapping list. Device-local: listed in
 *  net/syncedStores.ts's PRIVATE_KEYS so it never reaches the output window
 *  or a room. */
export const MIDI_MAP_KEY = "vibe.midiMap";

/** What the controller reads from and does to the outside world. */
export interface MidiEnv {
  /** Undefined where the browser has no Web MIDI (Safari). */
  requestAccess?: () => Promise<MIDIAccess>;
  /** Whether the browser already holds the MIDI permission, without asking. */
  permissionGranted?: () => Promise<boolean>;
  storage: Pick<Storage, "getItem" | "setItem">;
  currentSceneId: () => string;
  /** Set a slider to this controller value (0..127), by target id. */
  applyCc: (target: string, cc: number) => void;
  dispatchKey: (type: "keydown" | "keyup", key: KeySpec) => void;
  /** Runs `fn` on the next animation frame. */
  schedule: (fn: () => void) => void;
  /** Where learning listens for computer-key presses (capture phase). */
  keyTarget?: Pick<Window, "addEventListener">;
}

export interface MidiSnapshot {
  supported: boolean;
  connected: boolean;
  connecting: boolean;
  /** Names of the connected input devices. */
  devices: string[];
  mappings: readonly Mapping[];
  learn: LearnState;
  /** A one-line result or problem: what was just mapped, or why connecting failed. */
  notice: string;
}

export interface MidiController {
  snapshot(): MidiSnapshot;
  /** Called after any change to the snapshot. Returns an unsubscribe. */
  subscribe(cb: () => void): () => void;
  /** Called for every incoming message that is not system traffic (clock and
   *  the like) — the card's activity light. */
  onActivity(cb: () => void): () => void;
  connect(): Promise<void>;
  autoConnect(): Promise<void>;
  /** Arms learning, or turns it off if it is on. */
  toggleLearn(): void;
  cancelLearn(): void;
  pickTarget(target: LearnTarget): void;
  removeAt(index: number): void;
  /** The learn session's view of a keydown; true when it took the key. */
  learnKey(e: KeyboardEvent): boolean;
  /** Same for the keyup that follows a learned keydown. */
  learnKeyUp(e: KeyboardEvent): boolean;
}

export function createMidiController(env: MidiEnv): MidiController {
  let mappings: Mapping[] = [];
  try {
    mappings = parseMappings(env.storage.getItem(MIDI_MAP_KEY));
  } catch {
    // Unreadable storage reads as no mappings.
  }
  let learn: LearnState = LEARN_IDLE;
  let notice = "";
  let connected = false;
  let connecting = false;
  let devices: string[] = [];
  let access: MIDIAccess | null = null;

  const listeners = new Set<() => void>();
  const activity = new Set<() => void>();
  const emit = (): void => {
    for (const cb of Array.from(listeners)) cb();
  };

  function save(): void {
    try {
      env.storage.setItem(MIDI_MAP_KEY, serializeMappings(mappings));
    } catch {
      // The mappings still work for this session.
    }
  }

  function step(ev: LearnEvent): void {
    const r = learnStep(learn, ev);
    learn = r.state;
    if (r.made) {
      mappings = addMapping(mappings, r.made);
      save();
      notice = `Mapped ${mappingText(r.made)}`;
    } else if (ev.type === "arm" || ev.type === "cancel") {
      notice = "";
    }
    emit();
  }

  // ---- performing mappings ----

  const pendingCc = new Map<string, number>();
  let flushQueued = false;
  function flushCc(): void {
    flushQueued = false;
    const batch = Array.from(pendingCc.entries());
    pendingCc.clear();
    for (const [target, value] of batch) env.applyCc(target, value);
  }

  const held = new Map<string, KeySpec>();
  function releaseAll(): void {
    for (const key of Array.from(held.values())) env.dispatchKey("keyup", key);
    held.clear();
  }

  function perform(msg: MidiMessage): void {
    for (const m of mappings) {
      if (m.kind === "cc" && msg.kind === "cc" && m.ch === msg.ch && m.cc === msg.cc) {
        if (!targetLive(m.target, env.currentSceneId())) continue;
        pendingCc.set(m.target, msg.value);
        if (!flushQueued) {
          flushQueued = true;
          env.schedule(flushCc);
        }
      } else if (m.kind === "note" && msg.kind !== "cc" && m.ch === msg.ch && m.note === msg.note) {
        const id = `${m.ch}:${m.note}`;
        if (msg.kind === "noteOn") {
          // A second hit on a held note is a fresh press.
          if (held.has(id)) env.dispatchKey("keyup", held.get(id)!);
          held.set(id, m);
          env.dispatchKey("keydown", m);
        } else if (held.has(id)) {
          env.dispatchKey("keyup", held.get(id)!);
          held.delete(id);
        }
      }
    }
  }

  function onMessage(ev: { data?: Uint8Array | null }): void {
    const data = ev.data;
    if (!data || data.length === 0 || data[0] >= 0xf0) return; // system traffic: clock, active sensing
    for (const cb of Array.from(activity)) cb();
    const msg = decodeMidi(data);
    if (!msg) return;
    if (learn.step !== "idle") {
      // While learning, a message is a lesson, not an action. A message the
      // step is not waiting for (a knob while waiting for a pad) changes nothing.
      if (msg.kind === "noteOff") return;
      step({ type: "midi", msg });
      return;
    }
    perform(msg);
  }

  // ---- devices ----

  function refreshDevices(): void {
    if (!access) return;
    const names: string[] = [];
    access.inputs.forEach((input) => {
      if (input.state === "connected") {
        input.onmidimessage = onMessage as (e: MIDIMessageEvent) => void;
        names.push(input.name || "MIDI input");
      }
    });
    // A controller that left may have held a pad down: let the key go.
    if (names.length < devices.length) releaseAll();
    devices = names;
    emit();
  }

  async function connect(): Promise<void> {
    if (!env.requestAccess || connected || connecting) return;
    connecting = true;
    notice = "";
    emit();
    try {
      access = await env.requestAccess();
      access.onstatechange = refreshDevices;
      connected = true;
      connecting = false;
      refreshDevices();
    } catch {
      connecting = false;
      notice = "MIDI access was blocked. Allow it for this site in the browser, then try again.";
      emit();
    }
  }

  async function autoConnect(): Promise<void> {
    if (!env.permissionGranted || !env.requestAccess) return;
    let granted = false;
    try {
      granted = await env.permissionGranted();
    } catch {
      // A browser that cannot say: stay quiet and wait for the button.
    }
    if (granted) await connect();
  }

  // ---- learn: computer keys ----

  let swallowUp: string | null = null;
  function learnKey(e: KeyboardEvent): boolean {
    if (learn.step === "idle") return false;
    if (e.key === "Escape") {
      step({ type: "cancel" });
      swallowUp = e.code;
      return true;
    }
    if (e.key === "Tab") return false;
    // Chords are shortcuts of the browser or the panel, not keys to learn;
    // Option alone is learnable (it is Play), and so is Control alone (it is
    // Tap); either one with a letter is not.
    if (e.metaKey || (e.ctrlKey && e.key !== "Control") || (e.altKey && e.key !== "Alt")) return false;
    swallowUp = e.code;
    if (e.repeat) return true;
    const key: KeySpec = { key: e.key, code: e.code };
    if (e.shiftKey && e.key !== "Shift") key.shift = true;
    step({ type: "pickKey", key });
    return true;
  }
  function learnKeyUp(e: KeyboardEvent): boolean {
    if (swallowUp === null || e.code !== swallowUp) return false;
    swallowUp = null;
    return true;
  }

  if (env.keyTarget) {
    env.keyTarget.addEventListener(
      "keydown",
      (e) => {
        if (learnKey(e as KeyboardEvent)) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      },
      true,
    );
    env.keyTarget.addEventListener(
      "keyup",
      (e) => {
        if (learnKeyUp(e as KeyboardEvent)) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      },
      true,
    );
  }

  return {
    snapshot: () => ({
      supported: env.requestAccess !== undefined,
      connected,
      connecting,
      devices,
      mappings,
      learn,
      notice,
    }),
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    onActivity(cb) {
      activity.add(cb);
      return () => activity.delete(cb);
    },
    connect,
    autoConnect,
    toggleLearn: () => step({ type: "arm" }),
    cancelLearn: () => step({ type: "cancel" }),
    pickTarget: (target) => step({ type: "pickTarget", target }),
    removeAt(index) {
      mappings = removeMapping(mappings, index);
      save();
      emit();
    },
    learnKey,
    learnKeyUp,
  };
}

/** The real environment: the page's navigator, localStorage and document.
 *  `applyCc` and `currentSceneId` come from app.ts / the card. */
export function browserMidiEnv(
  parts: Pick<MidiEnv, "applyCc" | "currentSceneId">,
  nav: Navigator = navigator,
): MidiEnv {
  const hasMidi = typeof nav.requestMIDIAccess === "function";
  return {
    requestAccess: hasMidi ? () => nav.requestMIDIAccess() : undefined,
    permissionGranted:
      hasMidi && nav.permissions
        ? async () => (await nav.permissions.query({ name: "midi" as PermissionName })).state === "granted"
        : undefined,
    storage: localStorage,
    ...parts,
    dispatchKey(type, key) {
      const down = type === "keydown";
      const target = document.activeElement ?? document.body;
      target.dispatchEvent(
        new KeyboardEvent(type, {
          key: key.key,
          code: key.code,
          shiftKey: key.shift === true || (down && key.key === "Shift"),
          altKey: down && key.key === "Alt",
          ctrlKey: down && key.key === "Control",
          metaKey: down && key.key === "Meta",
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      );
    },
    schedule: (fn) => void requestAnimationFrame(fn),
    keyTarget: window,
  };
}
