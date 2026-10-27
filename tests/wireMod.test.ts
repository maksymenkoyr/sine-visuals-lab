import { describe, expect, it } from "vitest";
import { advanceGateTracker, createGateTracker, GATE_FORMULA_DEFAULT, windowReading } from "../src/render/gateWindow.ts";
import {
  clampWireMod,
  createWireModState,
  decodeWireMod,
  encodeWireMod,
  freshWireMod,
  legacyNodeFrom,
  sameWireMod,
  stepWireMod,
  WIRE_LENGTH_MAX_SEC,
  wireModCurve,
  wireModIsIdle,
  type WireMod,
} from "../src/render/wireMod.ts";

const DT = 1 / 60;
const mod = (over: Partial<WireMod> = {}): WireMod => ({ ...freshWireMod(), ...over });

describe("stepWireMod", () => {
  it("Window and Length off: the output is the clamped input", () => {
    const st = createWireModState();
    for (const v of [0.2, 0.9, 0, 1.4]) expect(stepWireMod(st, mod(), DT, v, GATE_FORMULA_DEFAULT)).toBe(Math.min(1, v));
  });

  it("Window on equals the generic gate fed the same inputs", () => {
    const m = mod({ windowOn: true, min: 0.3, max: 0.9, smoothOn: true, smoothness: 0.5 });
    const st = createWireModState();
    const tr = createGateTracker();
    for (let i = 0; i < 3; i++) {
      for (const v of [0.1, 0.2, 0.8, 0.9, 0.4, 0.05, 0.7, 0.6, 0.95, 0.3]) {
        const out = stepWireMod(st, m, DT, v, GATE_FORMULA_DEFAULT);
        advanceGateTracker(tr, DT, v, m.min, m.max, GATE_FORMULA_DEFAULT, m.smoothness);
        expect(out).toBeCloseTo(windowReading(tr, v, m.smoothness, GATE_FORMULA_DEFAULT), 12);
        expect(st.line).toBe(tr.line);
        expect(st.top).toBe(tr.top);
      }
    }
  });

  it("Window off: Smoothness eases the input, rising and falling alike; its resting value or Off changes nothing", () => {
    const run = (m: WireMod): number[] => {
      const st = createWireModState();
      return [0, 1, 1, 1, 0, 0, 0].map((v) => stepWireMod(st, m, DT, v, GATE_FORMULA_DEFAULT));
    };
    expect(run(mod())).toEqual([0, 1, 1, 1, 0, 0, 0]);
    expect(run(mod({ smoothOn: false, smoothness: 1 }))).toEqual([0, 1, 1, 1, 0, 0, 0]);
    const soft = run(mod({ smoothness: 0.8 }));
    expect(soft[1]).toBeGreaterThan(0);
    expect(soft[1]).toBeLessThan(1);
    expect(soft[4]).toBeGreaterThan(0);
    expect(soft[4]).toBeLessThan(soft[3]!);
    const softer = run(mod({ smoothness: 1 }));
    expect(softer[1]).toBeLessThan(soft[1]!);
  });

  it("Length: after a rise to 1 and a fall to 0, the output is max(0, 1 - k*DT/length)", () => {
    const m = mod({ length: 0.5 });
    const st = createWireModState();
    stepWireMod(st, m, DT, 1, GATE_FORMULA_DEFAULT);
    for (let k = 1; k <= 40; k++) expect(stepWireMod(st, m, DT, 0, GATE_FORMULA_DEFAULT)).toBeCloseTo(Math.max(0, 1 - (k * DT) / 0.5), 9);
  });
});

describe("wire modifier values", () => {
  it("fresh is idle and equal to absent; a window or a length is not idle", () => {
    expect(wireModIsIdle(undefined)).toBe(true);
    expect(wireModIsIdle(freshWireMod())).toBe(true);
    expect(sameWireMod(undefined, freshWireMod())).toBe(true);
    expect(wireModIsIdle(mod({ windowOn: true }))).toBe(false);
    expect(wireModIsIdle(mod({ length: 0.1 }))).toBe(false);
    expect(wireModIsIdle(mod({ smoothness: 0.5 }))).toBe(false);
    expect(wireModIsIdle(mod({ smoothness: 0.5, smoothOn: false }))).toBe(true);
    expect(sameWireMod(undefined, mod({ min: 0.5 }))).toBe(false);
  });

  it("clampWireMod keeps every number in range and Min ≤ Max", () => {
    expect(clampWireMod(mod({ min: 0.7, max: 0.2, smoothness: 3, length: 99 }))).toEqual(mod({ min: 0.7, max: 0.7, smoothness: 1, length: WIRE_LENGTH_MAX_SEC }));
  });

  it("encode then decode round-trips; decode rejects anything else", () => {
    const m = mod({ windowOn: true, min: 0.2, max: 0.6, smoothOn: false, smoothness: 0.3, length: 0.4 });
    expect(decodeWireMod(encodeWireMod(m))).toEqual(m);
    for (const bad of [null, "x", [1, 0, 1, 1, 0], [3, 0, 1, 1, 0, 0], [1, 0, 1, 1, 0, Number.POSITIVE_INFINITY], { 0: 1 }]) expect(decodeWireMod(bad)).toBeNull();
  });

  it("legacyNodeFrom reads a retired node and rejects a non-catalogue input or a wrong type", () => {
    const raw = { src: "anim.low", windowOn: true, min: 0.2, max: 0.6, smoothOn: true, smoothness: 0.1, height: "fixed", length: 0.3 };
    expect(legacyNodeFrom(raw)).toEqual({ src: "anim.low", height: "fixed", mod: mod({ windowOn: true, min: 0.2, max: 0.6, smoothness: 0.1, length: 0.3 }) });
    expect(legacyNodeFrom({ ...raw, src: "toString" })).toBeNull();
    expect(legacyNodeFrom({ ...raw, height: "tall" })).toBeNull();
    expect(legacyNodeFrom({ ...raw, min: "0.2" })).toBeNull();
  });
});

describe("wireModCurve", () => {
  const xs = Array.from({ length: 21 }, (_, i) => i / 20);

  it("Window off: identity, whatever Length is", () => {
    for (const x of xs) expect(wireModCurve(mod({ length: 0.8 }), x)).toBe(x);
  });

  it("Window on matches windowReading fed a tracker at peak 1", () => {
    for (const m of [mod({ windowOn: true, min: 0.3, max: 0.8, smoothness: 0.4 }), mod({ windowOn: true, min: 0.2, max: 0.6, smoothOn: false, smoothness: 0.9 })]) {
      const s = m.smoothOn ? m.smoothness : 0;
      const tr = createGateTracker();
      tr.init = true;
      tr.peak = 1;
      tr.line = m.min;
      tr.top = m.max;
      for (const x of xs) expect(wireModCurve(m, x)).toBeCloseTo(windowReading(tr, x, s, GATE_FORMULA_DEFAULT), 12);
    }
  });

  it("is monotone non-decreasing", () => {
    const m = mod({ windowOn: true, min: 0.4, max: 0.5, smoothness: 0.7 });
    for (let i = 1; i < xs.length; i++) expect(wireModCurve(m, xs[i]!)).toBeGreaterThanOrEqual(wireModCurve(m, xs[i - 1]!));
  });
});

describe("Invert", () => {
  it("sends 1 − what the wire would send, after Length", () => {
    const plain = createWireModState();
    const inv = createWireModState();
    for (const v of [0, 1, 0.4, 0, 0, 1.3]) {
      const y = stepWireMod(plain, mod({ length: 0.2 }), DT, v, GATE_FORMULA_DEFAULT);
      expect(stepWireMod(inv, mod({ length: 0.2, invert: true }), DT, v, GATE_FORMULA_DEFAULT)).toBeCloseTo(1 - y, 12);
    }
  });

  it("is not idle, flips the curve, and is stored as a seventh slot only when on", () => {
    const m = mod({ windowOn: true, min: 0.2, max: 0.6, invert: true });
    expect(wireModIsIdle(mod({ invert: true }))).toBe(false);
    expect(sameWireMod(undefined, mod({ invert: true }))).toBe(false);
    expect(wireModCurve(mod({ invert: true }), 0.3)).toBeCloseTo(0.7, 12);
    expect(encodeWireMod(m)).toHaveLength(7);
    expect(encodeWireMod(mod())).toHaveLength(6);
    expect(decodeWireMod(encodeWireMod(m))).toEqual(m);
    expect(decodeWireMod([1, 0, 1, 1, 0, 0, 2])).toBeNull();
  });
});
