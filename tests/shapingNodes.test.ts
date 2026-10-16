import { afterEach, describe, expect, it } from "vitest";
import { createAnimClock } from "../src/render/animClock.ts";
import { advanceGateTracker, createGateTracker, GENERIC_SMOOTHNESS_DEFAULT, windowReading } from "../src/render/gateWindow.ts";
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
  SHAPING_LENGTH_MAX_SEC,
  SHAPING_NODE_ID_RE,
  SHAPING_NODES_MAX,
  sanitizeShapingNodeDef,
  shapingNodeDef,
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
    windowOn: false,
    min: 0,
    max: 1,
    smoothOn: false,
    smoothness: GENERIC_SMOOTHNESS_DEFAULT,
    height: "graded",
    length: 0,
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
  it("window off, smoothing off, no length, graded, a level source: the output is the clamped source value", () => {
    const st = createShapingState();
    const d = def({ src: "feature.level" });
    const clock = createAnimClock();
    for (const level of [0.2, 0.9, 0.5, 0, 1.4]) {
      const f = frame({ level });
      const anim = clock.advance(DT, f);
      const out = stepShapingNode(st, d, DT, f, anim);
      const expected = Math.min(1, Math.max(0, SIGNALS["feature.level"].read(f, anim)));
      expect(out).toBeCloseTo(expected, 12);
    }
  });

  it("window on equals the generic gate: the same tracker and windowReading fed the same inputs give the same output", () => {
    const min = 0.3;
    const max = 0.9;
    const smoothness = 0.5;
    const d = def({ src: "feature.level", windowOn: true, min, max, smoothOn: true, smoothness });
    const st = createShapingState();
    const tr = createGateTracker();
    const clock = createAnimClock();
    const levels = [0.1, 0.2, 0.8, 0.9, 0.4, 0.05, 0.7, 0.6, 0.95, 0.3, 0.3, 0.85, 0.02, 0.5];
    for (let i = 0; i < 3; i++) {
      for (const level of levels) {
        const f = frame({ level });
        const anim = clock.advance(DT, f);
        const out = stepShapingNode(st, d, DT, f, anim);
        advanceGateTracker(tr, DT, level, min, max);
        expect(out).toBeCloseTo(windowReading(tr, level, smoothness), 12);
      }
    }
  });

  it("under Min reads 0: after a low and a high, an input just above the floor with Min 0.5 and no knee gives 0", () => {
    const st = createShapingState();
    const d = def({ src: "feature.level", windowOn: true, min: 0.5, max: 1, smoothOn: false, smoothness: 0 });
    const clock = createAnimClock();
    for (const level of [0, 1]) {
      const f = frame({ level });
      stepShapingNode(st, d, DT, f, clock.advance(DT, f));
    }
    const f = frame({ level: 0.01 });
    expect(stepShapingNode(st, d, DT, f, clock.advance(DT, f))).toBe(0);
  });

  it("Length: after a rise to 1 and a fall to 0, the output is max(0, 1 - k*DT/length) after k steps", () => {
    const length = 0.5;
    const st = createShapingState();
    const d = def({ src: "feature.level", length });
    const clock = createAnimClock();
    const up = frame({ level: 1 });
    stepShapingNode(st, d, DT, up, clock.advance(DT, up));
    for (let k = 1; k <= 40; k++) {
      const f = frame({ level: 0 });
      const out = stepShapingNode(st, d, DT, f, clock.advance(DT, f));
      expect(out).toBeCloseTo(Math.max(0, 1 - (k * DT) / length), 9);
    }
  });

  it("re-pointing the source starts the learning over: a fresh tracker seeded from the new input", () => {
    const st = createShapingState();
    const clock = createAnimClock();
    const a = def({ src: "feature.level", windowOn: true });
    const fa = frame({ level: 0.2 });
    stepShapingNode(st, a, DT, fa, clock.advance(DT, fa));
    expect(st.tracker.init).toBe(true);
    const b = def({ src: "anim.energy", windowOn: true });
    const fb = frame({ energy: 0.7 });
    stepShapingNode(st, b, DT, fb, clock.advance(DT, fb));
    expect(st.src).toBe("anim.energy");
    expect(st.tracker.init).toBe(true);
    expect(st.tracker.floor).toBeCloseTo(0.7, 12);
    expect(st.tracker.peak).toBeCloseTo(0.7, 12);
  });

  it("height on a level-kind source is ignored: fixed and graded give the same output", () => {
    const graded = createShapingState();
    const fixed = createShapingState();
    const dg = def({ src: "feature.level", height: "graded" });
    const df = def({ src: "feature.level", height: "fixed" });
    const clock = createAnimClock();
    for (const level of [0.3, 0.8, 0.1, 0.6]) {
      const f = frame({ level });
      const anim = clock.advance(DT, f);
      expect(stepShapingNode(fixed, df, DT, f, anim)).toBe(stepShapingNode(graded, dg, DT, f, anim));
    }
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
    updateShapingNode(id, { length: 0.5 });
    const l2 = listShapingNodes();
    expect(l2).not.toBe(l1);
    removeShapingNode(id);
    expect(listShapingNodes()).not.toBe(l2);
  });

  it("a node's input can be re-pointed by update", () => {
    const id = add("anim.low");
    updateShapingNode(id, { src: "anim.high" });
    expect(getShapingNode(id)?.src).toBe("anim.high");
  });

  it("update clamps every number to its range", () => {
    const id = add();
    updateShapingNode(id, { min: -1, max: 7, smoothness: 7, length: 99 });
    const n = getShapingNode(id);
    expect(n?.min).toBe(0);
    expect(n?.max).toBe(1);
    expect(n?.smoothness).toBe(1);
    expect(n?.length).toBe(SHAPING_LENGTH_MAX_SEC);
  });

  it("update raises Max to Min when Min is set above it", () => {
    const id = add();
    updateShapingNode(id, { max: 0.2 });
    updateShapingNode(id, { min: 0.6 });
    expect(getShapingNode(id)?.max).toBe(0.6);
  });

  it("update on an unknown id changes nothing", () => {
    const before = listShapingNodes();
    updateShapingNode("n999999", { length: 2 });
    expect(listShapingNodes()).toBe(before);
  });

  it("addShapingNode returns null at the device maximum", () => {
    for (let i = 0; i < SHAPING_NODES_MAX; i++) add();
    expect(addShapingNode("anim.low")).toBeNull();
    expect(listShapingNodes().length).toBe(SHAPING_NODES_MAX);
  });

  it("addShapingNode defaults: window on over the full range, soft knee, graded, no length", () => {
    const id = add();
    const n = getShapingNode(id)!;
    expect(n.windowOn).toBe(true);
    expect(n.min).toBe(0.25);
    expect(n.max).toBe(1);
    expect(n.smoothOn).toBe(true);
    expect(n.smoothness).toBe(GENERIC_SMOOTHNESS_DEFAULT);
    expect(n.height).toBe("graded");
    expect(n.length).toBe(0);
  });

  it("shapingNodeDef drops the id and keeps every field", () => {
    const id = add("anim.high", { windowOn: false, min: 0.4, max: 0.9, smoothOn: false, smoothness: 0.3, height: "loud", length: 0.7 });
    expect(shapingNodeDef(getShapingNode(id)!)).toEqual({
      src: "anim.high",
      windowOn: false,
      min: 0.4,
      max: 0.9,
      smoothOn: false,
      smoothness: 0.3,
      height: "loud",
      length: 0.7,
    });
  });

  it("sanitizeShapingNodeDef rejects a non-catalogue source, prototype keys and wrong types", () => {
    const good = def();
    expect(sanitizeShapingNodeDef(good)).toEqual(good);
    expect(sanitizeShapingNodeDef({ ...good, src: "not-a-signal" })).toBeNull();
    expect(sanitizeShapingNodeDef({ ...good, src: "__proto__" })).toBeNull();
    expect(sanitizeShapingNodeDef({ ...good, src: "toString" })).toBeNull();
    expect(sanitizeShapingNodeDef({ ...good, min: "0.2" })).toBeNull();
    expect(sanitizeShapingNodeDef({ ...good, max: Number.NaN })).toBeNull();
    expect(sanitizeShapingNodeDef({ ...good, length: "1" })).toBeNull();
    expect(sanitizeShapingNodeDef({ ...good, windowOn: "yes" })).toBeNull();
    expect(sanitizeShapingNodeDef({ ...good, smoothOn: 1 })).toBeNull();
    expect(sanitizeShapingNodeDef({ ...good, height: "soft" })).toBeNull();
    expect(sanitizeShapingNodeDef({ ...good, height: 2 })).toBeNull();
    expect(sanitizeShapingNodeDef(null)).toBeNull();
    expect(sanitizeShapingNodeDef("anim.low")).toBeNull();
  });

  it("sanitizeShapingNodeDef clamps out-of-range numbers and raises Max to Min", () => {
    const out = sanitizeShapingNodeDef({ ...def(), min: 5, max: 0.2, smoothness: -2, length: 9 });
    expect(out?.min).toBe(1);
    expect(out?.max).toBe(1);
    expect(out?.smoothness).toBe(0);
    expect(out?.length).toBe(SHAPING_LENGTH_MAX_SEC);
    expect(sanitizeShapingNodeDef({ ...def(), min: 0.6, max: 0.2 })?.max).toBe(0.6);
    expect(sanitizeShapingNodeDef({ ...def(), length: -1 })?.length).toBe(0);
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
    const d = def({ src: "anim.high", windowOn: true, length: 0.3 });
    const first = adoptShapingNodes({ L: d });
    const newId = first.get("L")!;
    expect(getShapingNode(newId)).toBeDefined();
    made.push(newId);
    const countAfterFirst = listShapingNodes().length;

    const again = adoptShapingNodes({ L: d });
    expect(again.get("L")).toBe(newId);
    expect(listShapingNodes().length).toBe(countAfterFirst);

    const other = adoptShapingNodes({ L: { ...d, length: 0.9 } });
    const otherId = other.get("L")!;
    expect(otherId).not.toBe(newId);
    made.push(otherId);
    expect(sameShapingNodeDef(getShapingNode(otherId)!, d)).toBe(false);
  });
});

describe("shaping bank", () => {
  it("follows its source: output equals the clamped source value with the window and length off", () => {
    const id = add("anim.low", { windowOn: false, smoothOn: false, length: 0 });
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
