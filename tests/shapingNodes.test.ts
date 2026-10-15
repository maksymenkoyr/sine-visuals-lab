import { afterEach, describe, expect, it } from "vitest";
import { createAnimClock } from "../src/render/animClock.ts";
import { NUM_BANDS, type FeatureFrame } from "../src/audio/types.ts";
import { SIGNALS } from "../src/render/signals.ts";
import {
  adoptShapingNodes,
  addShapingNode,
  createShapingBank,
  createShapingState,
  getShapingNode,
  listShapingNodes,
  removeShapingNode,
  sameShapingNodeDef,
  SHAPING_EXPANSION_DEFAULT,
  SHAPING_EXPANSION_MAX,
  SHAPING_EXPANSION_MIN,
  SHAPING_MEAN_TAU_SEC,
  SHAPING_NODE_ID_RE,
  SHAPING_NODES_MAX,
  SHAPING_SMOOTH_RETAIN_MAX,
  SHAPING_SMOOTHNESS_DEFAULT,
  SHAPING_THRESHOLD_DEFAULT,
  sanitizeShapingNodeDef,
  stepShapingNode,
  subscribeShapingNodes,
  updateShapingNode,
  type ShapingNodeDef,
} from "../src/render/shapingNodes.ts";

const DT = 1 / 60;

function frame(overrides: Partial<FeatureFrame> = {}): FeatureFrame {
  return {
    time: 0,
    bands: new Float32Array(NUM_BANDS),
    energy: 0,
    level: 1,
    hats: 0,
    lead: 0,
    onset: false,
    pulseOnset: false,
    bpm: 120,
    onsetPhase: 0,
    ...overrides,
  };
}

function def(over: Partial<ShapingNodeDef> = {}): ShapingNodeDef {
  return {
    src: "anim.low",
    expansion: SHAPING_EXPANSION_DEFAULT,
    thresholdOn: false,
    threshold: SHAPING_THRESHOLD_DEFAULT,
    smoothOn: false,
    smoothness: SHAPING_SMOOTHNESS_DEFAULT,
    ...over,
  };
}

// The store is one in-memory list shared by the whole file: every test removes
// the nodes it made, by the ids it was handed, so nothing depends on specific ids.
const made: string[] = [];
function add(src: ShapingNodeDef["src"] = "anim.low", over: Partial<Omit<ShapingNodeDef, "src">> = {}): string {
  const n = addShapingNode(src, over);
  if (!n) throw new Error("addShapingNode returned null");
  made.push(n.id);
  return n.id;
}

afterEach(() => {
  for (const id of made.splice(0)) removeShapingNode(id);
  for (const n of [...listShapingNodes()]) removeShapingNode(n.id);
});

describe("stepShapingNode", () => {
  it("at Expansion 1 with threshold and smoothing off, the output is the input", () => {
    const st = createShapingState();
    const d = def({ expansion: 1, thresholdOn: false, smoothOn: false });
    stepShapingNode(st, d, 0.7, DT);
    expect(stepShapingNode(st, d, 0.2, DT)).toBeCloseTo(0.2, 9);
    expect(stepShapingNode(st, d, 0.9, DT)).toBeCloseTo(0.9, 9);
  });

  it("Expansion 2 doubles the distance from the running mean", () => {
    const st = createShapingState();
    const d = def({ expansion: 2 });
    for (let i = 0; i < 2000; i++) stepShapingNode(st, d, 0.5, DT);
    expect(st.mean).toBeCloseTo(0.5, 6);
    // A tiny step keeps the mean where the warm-up left it.
    const out = stepShapingNode(st, d, 0.7, 1e-9);
    expect(out).toBeCloseTo(0.5 + 2 * (0.7 - 0.5), 4);
  });

  it("Expansion clamps the expanded value to 0..1", () => {
    const st = createShapingState();
    const d = def({ expansion: 3 });
    for (let i = 0; i < 2000; i++) stepShapingNode(st, d, 0.5, DT);
    expect(stepShapingNode(st, d, 0.9, 1e-9)).toBe(1);
    expect(stepShapingNode(st, d, 0.1, 1e-9)).toBe(0);
  });

  it("threshold on zeroes a value under the line and passes one above it", () => {
    const st = createShapingState();
    const d = def({ expansion: 1, thresholdOn: true, threshold: 0.3, smoothOn: false });
    for (let i = 0; i < 2000; i++) stepShapingNode(st, d, 0.2, DT);
    expect(stepShapingNode(st, d, 0.2, 1e-9)).toBe(0);
    expect(stepShapingNode(st, d, 0.5, 1e-9)).toBeCloseTo(0.5, 6);
  });

  it("smoothness 0 with smoothing on is no smoothing", () => {
    const st = createShapingState();
    const d = def({ expansion: 1, smoothOn: true, smoothness: 0 });
    stepShapingNode(st, d, 0, DT);
    expect(stepShapingNode(st, d, 1, DT)).toBeCloseTo(1, 9);
  });

  it("smoothness 1 approaches the target over about a second", () => {
    const st = createShapingState();
    const d = def({ expansion: 1, smoothOn: true, smoothness: 1 });
    stepShapingNode(st, d, 0, DT);
    let out = 0;
    for (let i = 0; i < 60; i++) out = stepShapingNode(st, d, 1, DT);
    expect(out).toBeGreaterThan(0.98);
    expect(out).toBeLessThan(1);
  });

  it("smoothing is frame-rate independent for a constant target", () => {
    const run = (dt: number, steps: number): number => {
      const st = createShapingState();
      const d = def({ expansion: 1, smoothOn: true, smoothness: 1 });
      stepShapingNode(st, d, 0, dt);
      let out = 0;
      for (let i = 0; i < steps; i++) out = stepShapingNode(st, d, 1, dt);
      return out;
    };
    expect(run(1 / 120, 120)).toBeCloseTo(run(1 / 60, 60), 6);
  });

  it("a zero step leaves the output unchanged", () => {
    const st = createShapingState();
    const d = def({ expansion: 1, smoothOn: true, smoothness: 0.8 });
    stepShapingNode(st, d, 0, DT);
    const before = stepShapingNode(st, d, 1, DT);
    expect(stepShapingNode(st, d, 0.2, 0)).toBeCloseTo(before, 12);
  });
});

describe("stepShapingNode time constants", () => {
  it("the running mean closes 1 - 1/e of the gap in SHAPING_MEAN_TAU_SEC", () => {
    const st = createShapingState();
    const d = def({ expansion: 1 });
    stepShapingNode(st, d, 0, DT);
    const sub = SHAPING_MEAN_TAU_SEC / 1000;
    for (let i = 0; i < 1000; i++) stepShapingNode(st, d, 1, sub);
    expect(st.mean).toBeCloseTo(1 - Math.exp(-1), 6);
  });

  it("one 1/60 s step at smoothness 1 keeps SHAPING_SMOOTH_RETAIN_MAX of the old output", () => {
    const st = createShapingState();
    const d = def({ expansion: 1, smoothOn: true, smoothness: 1 });
    stepShapingNode(st, d, 0, DT);
    const out = stepShapingNode(st, d, 1, DT);
    expect(1 - out).toBeCloseTo(SHAPING_SMOOTH_RETAIN_MAX, 9);
  });
});

describe("shaping node store", () => {
  it("ids match the id pattern and are never reused after a removal", () => {
    const a = add();
    expect(SHAPING_NODE_ID_RE.test(a)).toBe(true);
    removeShapingNode(a);
    const b = add();
    expect(SHAPING_NODE_ID_RE.test(b)).toBe(true);
    expect(b).not.toBe(a);
  });

  it("the list changes identity on every add, update and remove", () => {
    const l0 = listShapingNodes();
    const id = add();
    const l1 = listShapingNodes();
    expect(l1).not.toBe(l0);
    updateShapingNode(id, { expansion: 2 });
    const l2 = listShapingNodes();
    expect(l2).not.toBe(l1);
    removeShapingNode(id);
    expect(listShapingNodes()).not.toBe(l2);
  });

  it("update clamps every number to its range", () => {
    const id = add();
    updateShapingNode(id, { expansion: 99, threshold: -1, smoothness: 7 });
    const n = getShapingNode(id);
    expect(n?.expansion).toBe(SHAPING_EXPANSION_MAX);
    expect(n?.threshold).toBe(0);
    expect(n?.smoothness).toBe(1);
  });

  it("update on an unknown id changes nothing", () => {
    const before = listShapingNodes();
    updateShapingNode("n999999", { expansion: 2 });
    expect(listShapingNodes()).toBe(before);
  });

  it("addShapingNode returns null at the device maximum", () => {
    for (let i = 0; i < SHAPING_NODES_MAX; i++) add();
    expect(addShapingNode("anim.low")).toBeNull();
    expect(listShapingNodes().length).toBe(SHAPING_NODES_MAX);
  });

  it("sanitizeShapingNodeDef rejects a non-catalogue source, prototype keys and wrong types", () => {
    const good = def();
    expect(sanitizeShapingNodeDef(good)).toEqual(good);
    expect(sanitizeShapingNodeDef({ ...good, src: "not-a-signal" })).toBeNull();
    expect(sanitizeShapingNodeDef({ ...good, src: "__proto__" })).toBeNull();
    expect(sanitizeShapingNodeDef({ ...good, src: "toString" })).toBeNull();
    expect(sanitizeShapingNodeDef({ ...good, expansion: "1" })).toBeNull();
    expect(sanitizeShapingNodeDef({ ...good, expansion: Number.NaN })).toBeNull();
    expect(sanitizeShapingNodeDef({ ...good, thresholdOn: "yes" })).toBeNull();
    expect(sanitizeShapingNodeDef({ ...good, smoothOn: 1 })).toBeNull();
    expect(sanitizeShapingNodeDef(null)).toBeNull();
    expect(sanitizeShapingNodeDef("anim.low")).toBeNull();
  });

  it("sanitizeShapingNodeDef clamps out-of-range numbers", () => {
    const out = sanitizeShapingNodeDef({ ...def(), expansion: 99, threshold: 5, smoothness: -2 });
    expect(out?.expansion).toBe(SHAPING_EXPANSION_MAX);
    expect(out?.threshold).toBe(1);
    expect(out?.smoothness).toBe(0);
    expect(sanitizeShapingNodeDef({ ...def(), expansion: 0 })?.expansion).toBe(SHAPING_EXPANSION_MIN);
  });

  it("subscribers hear every add, update and remove, and none after unsubscribing", () => {
    let calls = 0;
    const off = subscribeShapingNodes(() => calls++);
    const id = add();
    expect(calls).toBe(1);
    updateShapingNode(id, { smoothOn: false });
    expect(calls).toBe(2);
    removeShapingNode(id);
    expect(calls).toBe(3);
    off();
    add();
    expect(calls).toBe(3);
  });

  it("adoptShapingNodes reuses an identical node and adds one for a different definition", () => {
    const d = def({ src: "anim.high", expansion: 1.5 });
    const first = adoptShapingNodes({ L: d });
    const newId = first.get("L")!;
    expect(getShapingNode(newId)).toBeDefined();
    made.push(newId);
    const countAfterFirst = listShapingNodes().length;

    const again = adoptShapingNodes({ L: d });
    expect(again.get("L")).toBe(newId);
    expect(listShapingNodes().length).toBe(countAfterFirst);

    const other = adoptShapingNodes({ L: { ...d, expansion: 2 } });
    const otherId = other.get("L")!;
    expect(otherId).not.toBe(newId);
    made.push(otherId);
    expect(sameShapingNodeDef(getShapingNode(otherId)!, d)).toBe(false);
  });
});

describe("shaping bank", () => {
  it("follows its source: output equals the clamped source value at the default shape", () => {
    const id = add("anim.low", { smoothOn: false, expansion: 1, thresholdOn: false });
    const clock = createAnimClock();
    const bands = new Float32Array(NUM_BANDS).fill(0.6);
    const f = frame({ bands });
    const anim = clock.advance(DT, f);
    const bank = createShapingBank();
    bank.advance(DT, f, anim);
    const expected = Math.min(1, Math.max(0, SIGNALS["anim.low"].read(f, anim)));
    expect(bank.output(id)).toBeCloseTo(expected, 9);
    expect(bank.reading(id)?.output).toBeCloseTo(expected, 9);
  });

  it("reads 0 for an id with no node, and null for its reading", () => {
    const bank = createShapingBank();
    expect(bank.output("n999999")).toBe(0);
    expect(bank.reading("n999999")).toBeNull();
  });

  it("a removed node's reading becomes null and its output 0", () => {
    const id = add("anim.low", { smoothOn: false });
    const clock = createAnimClock();
    const f = frame({ bands: new Float32Array(NUM_BANDS).fill(0.5) });
    const anim = clock.advance(DT, f);
    const bank = createShapingBank();
    bank.advance(DT, f, anim);
    removeShapingNode(id);
    bank.advance(DT, f, anim);
    expect(bank.reading(id)).toBeNull();
    expect(bank.output(id)).toBe(0);
  });
});
