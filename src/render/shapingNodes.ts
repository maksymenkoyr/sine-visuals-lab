/**
 * Shaping nodes: a card in the panel's middle column takes ONE input node (a
 * SignalId from signals.ts) and sends a changed copy of it out of its own
 * jack. The change uses the same controls a scene setting's own wire panel
 * has. Window picks the stretch of the input, between 0 and its own learned
 * peak, that moves the output (Min and Max, with an On/Off), and reuses
 * the generic gate in gateWindow.ts, so the window's math is never copied.
 * Smoothness softens that window with gateWindow.ts's default formula.
 * Length is a straight fall after each
 * rise, in seconds, off at the bottom of its slider. Height only matters for
 * a hit-kind input (Graded, Fixed or Loud, as a setting's own wire chooses);
 * a level-kind input ignores it. Re-pointing a node's input starts its
 * learning over: the floor, the peak and the envelopes reset. A node knows
 * nothing about the scene: any scene setting wires to it the same way it
 * wires to an input node, as a `{ source: "shaped", id }` choice (drives.ts).
 * Wires from an input arrive through a shared neutral node by themselves
 * (src/render/wireModifiers.ts).
 *
 * The store is device-wide, not per scene, and synced: it is mirrored to the
 * pop-out output and to a room's TV through registerSyncedStore, so every
 * window agrees on which nodes exist. Each DriveEngine owns its own bank of
 * per-node state (createShapingBank) and advances it in accumulate(), so the
 * main window, the pop-out and a TV each compute the same node from the same
 * audio. A wire that names a node id which does not exist (deleted here, or
 * made on another device) reads 0. Ids are never reused: the store keeps a
 * counter, so a stale wire cannot silently attach to a newer node.
 */
import type { FeatureFrame } from "../audio/types.ts";
import type { AnimFrame } from "./animClock.ts";
import type { HitHeight } from "./drives.ts";
import {
  advanceGateTracker,
  createGateTracker,
  GENERIC_SMOOTHNESS_DEFAULT,
  GENERIC_THRESHOLD_DEFAULT,
  GENERIC_WINDOW_MAX_DEFAULT,
  stepHeightEnv,
  windowReading,
  type GateTrackerState,
} from "./gateWindow.ts";
import { SIGNALS, type SignalId } from "./signals.ts";
import { parseSyncedObject, registerSyncedStore } from "../net/syncedStores.ts";

/** Length's right end: the longest fall a node's output can take, in seconds. */
export const SHAPING_LENGTH_MAX_SEC = 1.5;
/** Most nodes a device keeps (bounds a Look's size). */
export const SHAPING_NODES_MAX = 24;
export const SHAPING_NODE_ID_RE = /^n[1-9]\d{0,5}$/;

export interface ShapingNodeDef {
  src: SignalId;
  /** The window: Min and Max between 0 and the input's own learned peak (1). */
  windowOn: boolean;
  min: number;
  max: number;
  /** How far the window softens (gateWindow.ts windowReading); off means an exact window. */
  smoothOn: boolean;
  smoothness: number;
  /** How a hit-kind input reads (drives.ts HitHeight); a level-kind input ignores it. */
  height: HitHeight;
  /** Seconds the output takes to fall from 1 to 0 after a rise; 0 = off. */
  length: number;
}
export interface ShapingNode extends ShapingNodeDef {
  id: string;
}

const STORAGE_KEY = "vibe.shapingNodes";

const HEIGHTS: ReadonlySet<string> = new Set<HitHeight>(["graded", "fixed", "loud"]);

function clampTo(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// The catalogue ids as a Set: SIGNALS is a plain object, so a lookup on it
// would also accept "toString" or "__proto__" from corrupt storage or a
// crafted Look.
const SIGNAL_IDS: ReadonlySet<string> = new Set(Object.keys(SIGNALS));

/** `raw` as a real ShapingNodeDef, or null when any field has the wrong type.
 *  Numbers are clamped to their range rather than rejected. */
export function sanitizeShapingNodeDef(raw: unknown): ShapingNodeDef | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const src = r.src;
  if (typeof src !== "string" || !SIGNAL_IDS.has(src)) return null;
  const { windowOn, min, max, smoothOn, smoothness, height, length } = r;
  if (typeof windowOn !== "boolean" || typeof smoothOn !== "boolean") return null;
  if (typeof min !== "number" || !Number.isFinite(min)) return null;
  if (typeof max !== "number" || !Number.isFinite(max)) return null;
  if (typeof smoothness !== "number" || !Number.isFinite(smoothness)) return null;
  if (typeof length !== "number" || !Number.isFinite(length)) return null;
  if (typeof height !== "string" || !HEIGHTS.has(height)) return null;
  const lo = clampTo(min, 0, 1);
  return {
    src: src as SignalId,
    windowOn,
    min: lo,
    max: Math.max(clampTo(max, 0, 1), lo),
    smoothOn,
    smoothness: clampTo(smoothness, 0, 1),
    height: height as HitHeight,
    length: clampTo(length, 0, SHAPING_LENGTH_MAX_SEC),
  };
}

interface ShapingStore {
  next: number;
  nodes: ShapingNode[];
}

/** The stored shape: a counter and the node list, each node sanitized on
 *  read. Bad nodes are dropped, not rejected. */
function sanitizeStored(raw: Record<string, unknown>): ShapingStore {
  const nodes: ShapingNode[] = [];
  const seen = new Set<string>();
  let highest = 0;
  if (Array.isArray(raw.nodes)) {
    for (const item of raw.nodes) {
      if (!item || typeof item !== "object") continue;
      const id = (item as { id?: unknown }).id;
      if (typeof id !== "string" || !SHAPING_NODE_ID_RE.test(id) || seen.has(id)) continue;
      const def = sanitizeShapingNodeDef(item);
      if (!def) continue;
      seen.add(id);
      nodes.push({ id, ...def });
      highest = Math.max(highest, Number(id.slice(1)));
    }
  }
  const storedNext = typeof raw.next === "number" && Number.isFinite(raw.next) ? Math.floor(raw.next) : 1;
  return { next: Math.max(storedNext, highest + 1, 1), nodes };
}

// Strict: throws on text that is not a JSON object, so the reload hook keeps
// the cache it has (net/syncedStores.ts's parseSyncedObject).
function readStore(): ShapingStore {
  const raw = parseSyncedObject(localStorage.getItem(STORAGE_KEY));
  return raw ? sanitizeStored(raw) : { next: 1, nodes: [] };
}

function loadInitial(): ShapingStore {
  try {
    return readStore();
  } catch {
    return { next: 1, nodes: [] };
  }
}

let state: ShapingStore = loadInitial();
const listeners: Array<() => void> = [];

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ next: state.next, nodes: state.nodes }));
  } catch {
    // Not fatal: the nodes work for this session and are lost on reload.
  }
}

function changed(): void {
  persist();
  for (const cb of listeners) cb();
}

// Re-seeds from localStorage for the pop-out output window and a room TV
// (net/syncedStores.ts). Reads before it swaps, so unreadable text keeps the
// nodes this window already has.
registerSyncedStore(STORAGE_KEY, () => {
  state = readStore();
  for (const cb of listeners) cb();
});

/** The live node list. Replaced on every change, never mutated in place, so
 *  a caller can compare identity to see that something changed. */
export function listShapingNodes(): readonly ShapingNode[] {
  return state.nodes;
}

export function getShapingNode(id: string): ShapingNode | undefined {
  return state.nodes.find((n) => n.id === id);
}

/** A node's definition without its id. */
export function shapingNodeDef(node: ShapingNode): ShapingNodeDef {
  return {
    src: node.src,
    windowOn: node.windowOn,
    min: node.min,
    max: node.max,
    smoothOn: node.smoothOn,
    smoothness: node.smoothness,
    height: node.height,
    length: node.length,
  };
}

export function addShapingNode(src: SignalId, def: Partial<Omit<ShapingNodeDef, "src">> = {}): ShapingNode | null {
  if (state.nodes.length >= SHAPING_NODES_MAX) return null;
  const clean = sanitizeShapingNodeDef({
    src,
    windowOn: def.windowOn ?? true,
    min: def.min ?? GENERIC_THRESHOLD_DEFAULT,
    max: def.max ?? GENERIC_WINDOW_MAX_DEFAULT,
    smoothOn: def.smoothOn ?? true,
    smoothness: def.smoothness ?? GENERIC_SMOOTHNESS_DEFAULT,
    height: def.height ?? "graded",
    length: def.length ?? 0,
  });
  if (!clean) return null;
  const node: ShapingNode = { id: `n${state.next}`, ...clean };
  state = { next: state.next + 1, nodes: [...state.nodes, node] };
  changed();
  return node;
}

export function updateShapingNode(id: string, patch: Partial<ShapingNodeDef>): void {
  const at = state.nodes.findIndex((n) => n.id === id);
  if (at < 0) return;
  const cur = state.nodes[at];
  const clean = sanitizeShapingNodeDef({ ...cur, ...patch });
  if (!clean) return;
  const node: ShapingNode = { id, ...clean };
  state = { next: state.next, nodes: state.nodes.map((n, i) => (i === at ? node : n)) };
  changed();
}

/** Drops the node. Wire cleanup in every scene is driveStore's job
 *  (removeShapedSource). */
export function removeShapingNode(id: string): void {
  if (!state.nodes.some((n) => n.id === id)) return;
  state = { next: state.next, nodes: state.nodes.filter((n) => n.id !== id) };
  changed();
}

export function sameShapingNodeDef(a: ShapingNodeDef, b: ShapingNodeDef): boolean {
  return (
    a.src === b.src &&
    a.windowOn === b.windowOn &&
    a.min === b.min &&
    a.max === b.max &&
    a.smoothOn === b.smoothOn &&
    a.smoothness === b.smoothness &&
    a.height === b.height &&
    a.length === b.length
  );
}

/** Applying a Look: each of its node definitions reuses the first identical
 *  local node, or adds one. Maps the Look's own id to the local id. When the
 *  device is full, the Look's id is kept (it then reads 0, as a dangling id). */
export function adoptShapingNodes(defs: Readonly<Record<string, ShapingNodeDef>>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [lookId, def] of Object.entries(defs)) {
    const same = state.nodes.find((n) => sameShapingNodeDef(n, def));
    if (same) {
      map.set(lookId, same.id);
      continue;
    }
    const made = addShapingNode(def.src, def);
    map.set(lookId, made ? made.id : lookId);
  }
  return map;
}

export function subscribeShapingNodes(cb: () => void): () => void {
  listeners.push(cb);
  return () => {
    const at = listeners.indexOf(cb);
    if (at >= 0) listeners.splice(at, 1);
  };
}

// ---- pure math ----------------------------------------------------------

export interface ShapingState {
  /** The value the window sees: the input, or its Fixed/Loud envelope. */
  input: number;
  output: number;
  /** The window's Min and Max lines on the input's scale (tracker.line/top); 0 while the window is off. */
  line: number;
  top: number;
  tracker: GateTrackerState;
  heightEnv: number;
  /** Length's falling envelope. */
  env: number;
  /** The input this state learned from; a different one starts it over. */
  src: SignalId | null;
}

export function createShapingState(): ShapingState {
  return { input: 0, output: 0, line: 0, top: 0, tracker: createGateTracker(), heightEnv: 0, env: 0, src: null };
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** One step of a node. The output is clamped to 0..1, the scale every
 *  monitor draws. Length's fall is a straight line at 1/length per second,
 *  so it is frame-rate independent. */
export function stepShapingNode(st: ShapingState, node: ShapingNodeDef, dtSec: number, frame: FeatureFrame, anim: AnimFrame): number {
  if (st.src !== node.src) {
    st.tracker = createGateTracker();
    st.heightEnv = 0;
    st.env = 0;
    st.src = node.src;
  }
  const sig = SIGNALS[node.src];
  let v = sig.read(frame, anim);
  if (sig.kind === "edge" && node.height !== "graded") {
    st.heightEnv = stepHeightEnv(st.heightEnv, node.src, node.height, dtSec, anim, frame.energy);
    v = st.heightEnv;
  }
  st.input = v;
  let y = v;
  if (node.windowOn) {
    advanceGateTracker(st.tracker, dtSec, v, node.min, node.max);
    y = windowReading(st.tracker, v, node.smoothOn ? node.smoothness : 0);
    st.line = st.tracker.line;
    st.top = st.tracker.top;
  } else {
    st.line = 0;
    st.top = 0;
  }
  if (node.length > 0) {
    st.env = Math.max(y, st.env - dtSec / node.length);
    y = st.env;
  } else {
    st.env = y;
  }
  st.output = clamp01(y);
  return st.output;
}

// ---- per-engine bank ----------------------------------------------------

export interface ShapingBank {
  /** Steps every node once; call once per tick from DriveEngine.accumulate. */
  advance(dtSec: number, frame: FeatureFrame, anim: AnimFrame): void;
  /** The node's output this tick; 0 for an id with no node. */
  output(id: string): number;
  /** The node's live state (input, output) for the panel, or null. Read-only. */
  reading(id: string): Readonly<ShapingState> | null;
}

export function createShapingBank(): ShapingBank {
  const states = new Map<string, ShapingState>();
  let seenList: readonly ShapingNode[] | null = null;
  return {
    advance(dtSec, frame, anim) {
      const list = listShapingNodes();
      if (list !== seenList) {
        seenList = list;
        const listed = new Set(list.map((n) => n.id));
        for (const id of [...states.keys()]) if (!listed.has(id)) states.delete(id);
      }
      for (const node of list) {
        let st = states.get(node.id);
        if (!st) {
          st = createShapingState();
          states.set(node.id, st);
        }
        stepShapingNode(st, node, dtSec, frame, anim);
      }
    },
    output(id) {
      if (!getShapingNode(id)) return 0;
      return states.get(id)?.output ?? 0;
    },
    reading(id) {
      if (!getShapingNode(id)) return null;
      return states.get(id) ?? null;
    },
  };
}
