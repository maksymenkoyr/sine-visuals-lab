/**
 * Shaping nodes: a card in the panel's middle column takes ONE input node (a
 * SignalId from signals.ts) and sends a changed copy of it out of its own
 * jack. The change is three controls: Expansion pushes the value away from
 * its own running mean (flatter below 1, punchier above), Threshold reads 0
 * while the expanded value is under a line, and Smoothness is a one-pole
 * smoothing of the output. A node knows nothing about the scene: any scene
 * setting wires to it the same way it wires to an input node, as a
 * `{ source: "shaped", id }` choice (drives.ts).
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
import { SIGNALS, type SignalId } from "./signals.ts";
import { parseSyncedObject, registerSyncedStore } from "../net/syncedStores.ts";

export const SHAPING_EXPANSION_MIN = 0.5;
export const SHAPING_EXPANSION_MAX = 3;
export const SHAPING_EXPANSION_DEFAULT = 1;
export const SHAPING_THRESHOLD_DEFAULT = 0.3;
export const SHAPING_SMOOTHNESS_DEFAULT = 0.5;
/** Time constant of the running mean Expansion pushes away from. */
export const SHAPING_MEAN_TAU_SEC = 1.67;
/** Smoothness 1 keeps this much of the old output per 1/60 s. */
export const SHAPING_SMOOTH_RETAIN_MAX = 0.93;
/** Most nodes a device keeps (bounds a Look's size). */
export const SHAPING_NODES_MAX = 24;
export const SHAPING_NODE_ID_RE = /^n[1-9]\d{0,5}$/;

export interface ShapingNodeDef {
  src: SignalId;
  expansion: number;
  thresholdOn: boolean;
  threshold: number;
  smoothOn: boolean;
  smoothness: number;
}
export interface ShapingNode extends ShapingNodeDef {
  id: string;
}

const STORAGE_KEY = "vibe.shapingNodes";

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
  const { expansion, threshold, smoothness, thresholdOn, smoothOn } = r;
  if (typeof expansion !== "number" || !Number.isFinite(expansion)) return null;
  if (typeof threshold !== "number" || !Number.isFinite(threshold)) return null;
  if (typeof smoothness !== "number" || !Number.isFinite(smoothness)) return null;
  if (typeof thresholdOn !== "boolean" || typeof smoothOn !== "boolean") return null;
  return {
    src: src as SignalId,
    expansion: clampTo(expansion, SHAPING_EXPANSION_MIN, SHAPING_EXPANSION_MAX),
    thresholdOn,
    threshold: clampTo(threshold, 0, 1),
    smoothOn,
    smoothness: clampTo(smoothness, 0, 1),
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

export function addShapingNode(src: SignalId, def: Partial<Omit<ShapingNodeDef, "src">> = {}): ShapingNode | null {
  if (state.nodes.length >= SHAPING_NODES_MAX) return null;
  const clean = sanitizeShapingNodeDef({
    src,
    expansion: def.expansion ?? SHAPING_EXPANSION_DEFAULT,
    thresholdOn: def.thresholdOn ?? false,
    threshold: def.threshold ?? SHAPING_THRESHOLD_DEFAULT,
    smoothOn: def.smoothOn ?? true,
    smoothness: def.smoothness ?? SHAPING_SMOOTHNESS_DEFAULT,
  });
  if (!clean) return null;
  const node: ShapingNode = { id: `n${state.next}`, ...clean };
  state = { next: state.next + 1, nodes: [...state.nodes, node] };
  changed();
  return node;
}

export function updateShapingNode(id: string, patch: Partial<Omit<ShapingNodeDef, "src">>): void {
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
    a.expansion === b.expansion &&
    a.thresholdOn === b.thresholdOn &&
    a.threshold === b.threshold &&
    a.smoothOn === b.smoothOn &&
    a.smoothness === b.smoothness
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
  input: number;
  output: number;
  mean: number;
  warm: boolean;
}

export function createShapingState(): ShapingState {
  return { input: 0, output: 0, mean: 0, warm: false };
}

/** One step of a node. The output is clamped to 0..1, the scale every
 *  monitor draws. Smoothness is frame-rate independent: the retain factor is
 *  raised to the elapsed 1/60 s count. */
export function stepShapingNode(st: ShapingState, node: ShapingNodeDef, input: number, dtSec: number): number {
  if (!st.warm) {
    st.mean = input;
    st.warm = true;
  }
  st.input = input;
  st.mean += (input - st.mean) * (1 - Math.exp(-dtSec / SHAPING_MEAN_TAU_SEC));
  let v = Math.min(1, Math.max(0, st.mean + (input - st.mean) * node.expansion));
  if (node.thresholdOn && v < node.threshold) v = 0;
  if (node.smoothOn) {
    const retain = Math.pow(SHAPING_SMOOTH_RETAIN_MAX * node.smoothness, dtSec * 60);
    st.output = v + (st.output - v) * retain;
  } else {
    st.output = v;
  }
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
        stepShapingNode(st, node, SIGNALS[node.src].read(frame, anim), dtSec);
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
