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
