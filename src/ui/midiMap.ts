/**
 * The pure half of MIDI control — no DOM, no Web MIDI, no clock. Web MIDI
 * itself, the live learn session and the panel are in midiInput.ts and
 * midiCard.ts; this file is what they agree on and what the tests pin down:
 *
 *  - decodeMidi: a raw MIDI message to the three things the panel uses (a
 *    controller change, a note on, a note off). A note-on with velocity 0 is
 *    a note off, as the MIDI spec has it. Channels read 1..16.
 *  - ccToValue: a controller value 0..127 to a slider's value, linearly across
 *    its min..max and snapped to the setting's own step.
 *  - The mapping model and its store (`vibe.midiMap`): which controller or
 *    note does what. A CC mapping aims at a slider by a target id
 *    (`sceneTargetId` / `MASTER_SCALE_TARGET` ...); a note mapping stands in
 *    for one computer-keyboard key. The key stays on this device — it is in
 *    net/syncedStores.ts's PRIVATE_KEYS, because a controller is plugged into
 *    one machine, not into the room — and `parseMappings` sanitises whatever
 *    localStorage hands back.
 *  - The learn state machine (`learnStep` and friends): arm, then either
 *    touch a slider and move a knob, or press a keyboard key and hit a pad.
 *    Each step returns a new state plus, when the pair is complete, the
 *    mapping it made, so the same rules can be driven in a test.
 *
 * A mapping to a scene's setting names the scene in its target id, so it acts
 * only while that scene is on screen; the Master dials' ids carry no scene.
 */

/** A controller change (a knob or fader), a note on, or a note off. */
export type MidiMessage =
  | { kind: "cc"; ch: number; cc: number; value: number }
  | { kind: "noteOn"; ch: number; note: number; velocity: number }
  | { kind: "noteOff"; ch: number; note: number };

const STATUS_NOTE_OFF = 0x80;
const STATUS_NOTE_ON = 0x90;
const STATUS_CC = 0xb0;

/** Decodes one raw message; null for anything the panel ignores (system
 *  messages such as clock, pitch bend, program change, truncated data). */
export function decodeMidi(data: ArrayLike<number>): MidiMessage | null {
  if (data.length < 3) return null;
  const status = data[0] & 0xf0;
  const ch = (data[0] & 0x0f) + 1;
  const a = data[1] & 0x7f;
  const b = data[2] & 0x7f;
  if (data[0] >= 0xf0) return null;
  if (status === STATUS_CC) return { kind: "cc", ch, cc: a, value: b };
  if (status === STATUS_NOTE_ON) return b === 0 ? { kind: "noteOff", ch, note: a } : { kind: "noteOn", ch, note: a, velocity: b };
  if (status === STATUS_NOTE_OFF) return { kind: "noteOff", ch, note: a };
  return null;
}

/** The largest value a CC carries. */
export const CC_MAX = 127;

/** A controller value across [min, max] (a slider's own range), snapped to
 *  `step` counted from min, and clamped back inside. No step (or a step that
 *  is not positive) leaves the value continuous. */
export function ccToValue(value: number, min: number, max: number, step?: number): number {
  const t = Math.min(1, Math.max(0, value / CC_MAX));
  let v = min + t * (max - min);
  if (step !== undefined && step > 0) {
    v = min + Math.round((v - min) / step) * step;
    // Trim float noise from the multiply so 0.1 steps do not read 0.30000000000000004.
    v = Number(v.toPrecision(12));
  }
  return Math.min(max, Math.max(min, v));
}

// ---- targets ---------------------------------------------------------------

/** The id of one scene setting's slider: the scene and the setting's key. */
export function sceneTargetId(sceneId: string, key: string): string {
  return `scene/${sceneId}/${key}`;
}

/** The Master card's Scale and Expansion dials. */
export const MASTER_SCALE_TARGET = "master/scale";
export const MASTER_EXPANSION_TARGET = "master/expansion";

/** The scene a target is tied to, or null for a global (Master) dial. */
export function targetScene(id: string): string | null {
  if (!id.startsWith("scene/")) return null;
  const rest = id.slice("scene/".length);
  const slash = rest.indexOf("/");
  return slash <= 0 ? null : rest.slice(0, slash);
}

/** Whether a mapping to `id` may act while `currentSceneId` is on screen. */
export function targetLive(id: string, currentSceneId: string): boolean {
  const scene = targetScene(id);
  return scene === null || scene === currentSceneId;
}

// ---- mappings --------------------------------------------------------------

/** A computer key as a KeyboardEvent names it. */
export interface KeySpec {
  key: string;
  code: string;
  shift?: boolean;
}

export type Mapping =
  | { kind: "cc"; ch: number; cc: number; target: string; label: string }
  | ({ kind: "note"; ch: number; note: number } & KeySpec);

/** The most mappings kept — a sanity bound on what localStorage can hold us to. */
export const MAX_MAPPINGS = 256;

function isInt(v: unknown, lo: number, hi: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
}

function sanitizeOne(raw: unknown): Mapping | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isInt(r.ch, 1, 16)) return null;
  if (r.kind === "cc") {
    if (!isInt(r.cc, 0, 127)) return null;
    if (typeof r.target !== "string" || r.target.length === 0 || r.target.length > 200) return null;
    if (typeof r.label !== "string") return null;
    return { kind: "cc", ch: r.ch, cc: r.cc, target: r.target, label: r.label.slice(0, 120) };
  }
  if (r.kind === "note") {
    if (!isInt(r.note, 0, 127)) return null;
    if (typeof r.key !== "string" || r.key.length === 0 || r.key.length > 32) return null;
    if (typeof r.code !== "string" || r.code.length > 32) return null;
    const out: Mapping = { kind: "note", ch: r.ch, note: r.note, key: r.key, code: r.code };
    if (r.shift === true) out.shift = true;
    return out;
  }
  return null;
}

/** What `parseMappings` reads, and `serializeMappings` writes. */
export function serializeMappings(maps: readonly Mapping[]): string {
  return JSON.stringify(maps);
}

/** Mappings from stored text: anything that is not a well-formed mapping is
 *  dropped (the rest are kept), a source that appears twice keeps its first
 *  entry, and an unreadable or missing store reads as empty. */
export function parseMappings(text: string | null): Mapping[] {
  if (!text) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: Mapping[] = [];
  for (const item of raw) {
    const m = sanitizeOne(item);
    if (!m || out.some((o) => sameSource(o, m))) continue;
    out.push(m);
    if (out.length >= MAX_MAPPINGS) break;
  }
  return out;
}

/** Two mappings listen to the same control: same kind, number and channel. */
export function sameSource(a: Mapping, b: Mapping): boolean {
  if (a.kind !== b.kind || a.ch !== b.ch) return false;
  return a.kind === "cc" ? a.cc === (b as typeof a).cc : a.note === (b as typeof a).note;
}

/** Adds `m`. A new mapping replaces one on the same control, and a CC
 *  mapping also replaces whichever control was on its slider before — a
 *  slider answers to one knob. */
export function addMapping(maps: readonly Mapping[], m: Mapping): Mapping[] {
  const kept = maps.filter((o) => !sameSource(o, m) && !(m.kind === "cc" && o.kind === "cc" && o.target === m.target));
  return [...kept, m].slice(-MAX_MAPPINGS);
}

export function removeMapping(maps: readonly Mapping[], index: number): Mapping[] {
  return maps.filter((_, i) => i !== index);
}

// ---- words -----------------------------------------------------------------

const KEY_NAMES: Record<string, string> = {
  " ": "Space",
  Alt: "Option",
  Control: "Control",
  Meta: "Command",
  Shift: "Shift",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
};

/** A computer key as the panel names it: a letter in capitals, Alt as the
 *  Option key the rest of the panel calls it, the rest as KeyboardEvent does. */
export function keyName(k: KeySpec): string {
  const base = KEY_NAMES[k.key] ?? (k.key.length === 1 ? k.key.toUpperCase() : k.key);
  return k.shift && k.key !== "Shift" ? `Shift ${base}` : base;
}

/** The mapping list's line, e.g. "CC 21 ch 1 → Storm · Speed". */
export function mappingText(m: Mapping): string {
  if (m.kind === "cc") return `CC ${m.cc} ch ${m.ch} → ${m.label}`;
  return `Note ${m.note} ch ${m.ch} → key ${keyName(m)}`;
}

// ---- learn -----------------------------------------------------------------

/** What a slider offers to learn onto. */
export interface LearnTarget {
  id: string;
  label: string;
}

export type LearnState =
  | { step: "idle" }
  /** Armed: waiting for a slider to be touched or a computer key pressed. */
  | { step: "armed" }
  /** A slider was picked: waiting for a knob or fader to move. */
  | { step: "cc"; target: LearnTarget }
  /** A key was picked: waiting for a pad or key to be hit. */
  | { step: "note"; key: KeySpec };

export const LEARN_IDLE: LearnState = { step: "idle" };

export type LearnEvent =
  | { type: "arm" }
  | { type: "cancel" }
  | { type: "pickTarget"; target: LearnTarget }
  | { type: "pickKey"; key: KeySpec }
  | { type: "midi"; msg: MidiMessage };

export interface LearnResult {
  state: LearnState;
  /** The mapping this step completed, to be added to the list. */
  made?: Mapping;
}

/** One step of the learn session. Arming while armed (or mid-way) turns it
 *  off again, so the Learn button is its own cancel. Events that mean nothing
 *  in the current step (a knob moved while waiting for a key) leave it as it is. */
export function learnStep(state: LearnState, ev: LearnEvent): LearnResult {
  switch (ev.type) {
    case "arm":
      return { state: state.step === "idle" ? { step: "armed" } : LEARN_IDLE };
    case "cancel":
      return { state: LEARN_IDLE };
    // Once armed, either pick may come at any time and re-aims: a slider
    // touched after a key (or a second slider after the first) wins.
    case "pickTarget":
      return state.step === "idle" ? { state } : { state: { step: "cc", target: ev.target } };
    case "pickKey":
      return state.step === "idle" ? { state } : { state: { step: "note", key: ev.key } };
    case "midi": {
      const m = ev.msg;
      if (state.step === "cc" && m.kind === "cc") {
        return { state: LEARN_IDLE, made: { kind: "cc", ch: m.ch, cc: m.cc, target: state.target.id, label: state.target.label } };
      }
      if (state.step === "note" && m.kind === "noteOn") {
        const made: Mapping = { kind: "note", ch: m.ch, note: m.note, key: state.key.key, code: state.key.code };
        if (state.key.shift) made.shift = true;
        return { state: LEARN_IDLE, made };
      }
      return { state };
    }
  }
}

/** What Learn is waiting for, in plain words — the card's status line. */
export function learnPrompt(state: LearnState): string {
  switch (state.step) {
    case "idle":
      return "";
    case "armed":
      return "Touch a slider to map a knob, or press a keyboard key to map a pad. Escape cancels.";
    case "cc":
      return `Now move a knob or fader for ${state.target.label}. Escape cancels.`;
    case "note":
      return `Now hit the pad or key for ${keyName(state.key)}. Escape cancels.`;
  }
}
