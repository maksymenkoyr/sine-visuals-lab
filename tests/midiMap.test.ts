import { describe, expect, it } from "vitest";
import {
  addMapping,
  ccToValue,
  decodeMidi,
  keyName,
  LEARN_IDLE,
  learnPrompt,
  learnStep,
  mappingText,
  MAX_MAPPINGS,
  parseMappings,
  removeMapping,
  sceneTargetId,
  serializeMappings,
  targetLive,
  targetScene,
  type LearnState,
  type Mapping,
} from "../src/ui/midiMap.ts";

describe("decodeMidi", () => {
  it("reads a controller change with its channel as 1..16", () => {
    expect(decodeMidi([0xb0, 21, 99])).toEqual({ kind: "cc", ch: 1, cc: 21, value: 99 });
    expect(decodeMidi([0xbf, 7, 0])).toEqual({ kind: "cc", ch: 16, cc: 7, value: 0 });
  });

  it("reads a note on, and a note on with velocity 0 as a note off", () => {
    expect(decodeMidi([0x99, 36, 100])).toEqual({ kind: "noteOn", ch: 10, note: 36, velocity: 100 });
    expect(decodeMidi([0x99, 36, 0])).toEqual({ kind: "noteOff", ch: 10, note: 36 });
  });

  it("reads a note off whatever its release velocity", () => {
    expect(decodeMidi([0x80, 60, 64])).toEqual({ kind: "noteOff", ch: 1, note: 60 });
  });

  it("ignores system messages, other channel messages and short data", () => {
    expect(decodeMidi([0xf8])).toBeNull();
    expect(decodeMidi([0xfe, 0, 0])).toBeNull();
    expect(decodeMidi([0xe0, 0, 64])).toBeNull(); // pitch bend
    expect(decodeMidi([0xc0, 5])).toBeNull(); // program change
    expect(decodeMidi([0xb0, 21])).toBeNull();
  });
});

describe("ccToValue", () => {
  it("maps 0..127 linearly across min..max", () => {
    expect(ccToValue(0, 2, 10)).toBe(2);
    expect(ccToValue(127, 2, 10)).toBe(10);
    expect(ccToValue(63.5, 0, 1)).toBeCloseTo(0.5, 6);
  });

  it("snaps to the step counted from min", () => {
    expect(ccToValue(64, 0, 1, 0.1)).toBeCloseTo(0.5, 12);
    expect(ccToValue(64, 0, 1, 0.25)).toBe(0.5);
    // 0.30000000000000004 must not leak out of the multiply.
    expect(ccToValue(Math.round(0.3 * 127), 0, 1, 0.1)).toBe(0.3);
    expect(ccToValue(50, 1, 9, 2)).toBe(5);
  });

  it("stays inside the range", () => {
    expect(ccToValue(200, 0, 1, 0.3)).toBeLessThanOrEqual(1);
    expect(ccToValue(-5, 3, 4)).toBe(3);
  });

  it("treats a missing or non-positive step as continuous", () => {
    const v = ccToValue(10, 0, 1);
    expect(ccToValue(10, 0, 1, 0)).toBe(v);
    expect(ccToValue(10, 0, 1, undefined)).toBe(v);
  });
});

describe("targets", () => {
  it("ties a scene setting to its scene and leaves Master dials global", () => {
    const id = sceneTargetId("storm", "speed");
    expect(targetScene(id)).toBe("storm");
    expect(targetScene("master/scale")).toBeNull();
    expect(targetLive(id, "storm")).toBe(true);
    expect(targetLive(id, "mesh")).toBe(false);
    expect(targetLive("master/scale", "mesh")).toBe(true);
  });
});

const cc21: Mapping = { kind: "cc", ch: 1, cc: 21, target: "scene/storm/speed", label: "Storm · Speed" };
const note36: Mapping = { kind: "note", ch: 10, note: 36, key: "q", code: "KeyQ" };

describe("mapping store", () => {
  it("round-trips through its own text", () => {
    expect(parseMappings(serializeMappings([cc21, note36]))).toEqual([cc21, note36]);
  });

  it("reads missing, garbled and wrong-shaped text as empty", () => {
    expect(parseMappings(null)).toEqual([]);
    expect(parseMappings("")).toEqual([]);
    expect(parseMappings("{nope")).toEqual([]);
    expect(parseMappings('{"kind":"cc"}')).toEqual([]);
  });

  it("drops malformed entries and keeps the good ones", () => {
    const text = JSON.stringify([
      cc21,
      { kind: "cc", ch: 0, cc: 5, target: "x", label: "x" }, // channel out of range
      { kind: "cc", ch: 1, cc: 128, target: "x", label: "x" }, // cc out of range
      { kind: "cc", ch: 1, cc: 5, target: "", label: "x" },
      { kind: "note", ch: 1, note: 60, key: "", code: "" },
      { kind: "note", ch: 1, note: 1.5, key: "a", code: "KeyA" },
      { kind: "wheel", ch: 1 },
      null,
      7,
      note36,
    ]);
    expect(parseMappings(text)).toEqual([cc21, note36]);
  });

  it("keeps the first of two entries on the same control", () => {
    const again: Mapping = { ...cc21, target: "master/scale", label: "Master · Scale" };
    expect(parseMappings(JSON.stringify([cc21, again]))).toEqual([cc21]);
  });

  it("only keeps a note's shift flag when it is true", () => {
    const withShift = { ...note36, shift: true };
    expect(parseMappings(JSON.stringify([withShift]))[0]).toEqual(withShift);
    expect(parseMappings(JSON.stringify([{ ...note36, shift: "yes" }]))[0]).toEqual(note36);
  });

  it("is bounded", () => {
    const many = Array.from({ length: MAX_MAPPINGS + 40 }, (_, i) => ({ ...cc21, cc: i % 128, ch: 1 + Math.floor(i / 128) }));
    expect(parseMappings(JSON.stringify(many)).length).toBe(MAX_MAPPINGS);
  });

  it("replaces a mapping on the same control, and a CC on the same slider", () => {
    const moved: Mapping = { ...cc21, target: "master/scale", label: "Master · Scale" };
    expect(addMapping([cc21], moved)).toEqual([moved]);
    const other: Mapping = { ...cc21, cc: 22 }; // a second knob onto the same slider
    expect(addMapping([cc21], other)).toEqual([other]);
    expect(addMapping([cc21, note36], { ...note36, key: "w", code: "KeyW" })).toEqual([cc21, { ...note36, key: "w", code: "KeyW" }]);
  });

  it("tells controls apart by kind, number and channel", () => {
    const onCh2: Mapping = { ...cc21, ch: 2, target: "master/scale", label: "x" };
    expect(addMapping([cc21], onCh2)).toHaveLength(2);
    expect(addMapping([cc21], { kind: "note", ch: 1, note: 21, key: "a", code: "KeyA" })).toHaveLength(2);
  });

  it("removes by index", () => {
    expect(removeMapping([cc21, note36], 0)).toEqual([note36]);
    expect(removeMapping([cc21], 5)).toEqual([cc21]);
  });
});

describe("words", () => {
  it("names keys the way the panel does", () => {
    expect(keyName({ key: "q", code: "KeyQ" })).toBe("Q");
    expect(keyName({ key: " ", code: "Space" })).toBe("Space");
    expect(keyName({ key: "Alt", code: "AltLeft" })).toBe("Option");
    expect(keyName({ key: "B", code: "KeyB", shift: true })).toBe("Shift B");
    expect(keyName({ key: "Shift", code: "ShiftLeft", shift: true })).toBe("Shift");
  });

  it("prints a mapping as one line", () => {
    expect(mappingText(cc21)).toBe("CC 21 ch 1 → Storm · Speed");
    expect(mappingText(note36)).toBe("Note 36 ch 10 → key Q");
  });
});

describe("learn", () => {
  const target = { id: "scene/storm/speed", label: "Storm · Speed" };
  const run = (state: LearnState, ...evs: Parameters<typeof learnStep>[1][]) => {
    let made: Mapping | undefined;
    for (const ev of evs) {
      const r = learnStep(state, ev);
      state = r.state;
      made = r.made ?? made;
    }
    return { state, made };
  };

  it("arms, and arming again turns it off", () => {
    expect(run(LEARN_IDLE, { type: "arm" }).state).toEqual({ step: "armed" });
    expect(run(LEARN_IDLE, { type: "arm" }, { type: "arm" }).state).toEqual(LEARN_IDLE);
  });

  it("maps a knob to a slider: touch the slider, then move the knob", () => {
    const r = run(
      LEARN_IDLE,
      { type: "arm" },
      { type: "pickTarget", target },
      { type: "midi", msg: { kind: "cc", ch: 3, cc: 21, value: 40 } },
    );
    expect(r.made).toEqual({ kind: "cc", ch: 3, cc: 21, target: target.id, label: target.label });
    expect(r.state).toEqual(LEARN_IDLE);
  });

  it("maps a pad to a key: press the key, then hit the pad", () => {
    const r = run(
      LEARN_IDLE,
      { type: "arm" },
      { type: "pickKey", key: { key: "q", code: "KeyQ" } },
      { type: "midi", msg: { kind: "noteOn", ch: 10, note: 36, velocity: 90 } },
    );
    expect(r.made).toEqual({ kind: "note", ch: 10, note: 36, key: "q", code: "KeyQ" });
    expect(r.state).toEqual(LEARN_IDLE);
  });

  it("carries the shift flag onto the mapping", () => {
    const r = run(
      LEARN_IDLE,
      { type: "arm" },
      { type: "pickKey", key: { key: "B", code: "KeyB", shift: true } },
      { type: "midi", msg: { kind: "noteOn", ch: 1, note: 40, velocity: 1 } },
    );
    expect(r.made).toMatchObject({ shift: true });
  });

  it("waits for the right kind of message", () => {
    const wantsCc = run(
      LEARN_IDLE,
      { type: "arm" },
      { type: "pickTarget", target },
      { type: "midi", msg: { kind: "noteOn", ch: 1, note: 5, velocity: 9 } },
    );
    expect(wantsCc.made).toBeUndefined();
    expect(wantsCc.state.step).toBe("cc");
    const wantsNote = run(
      LEARN_IDLE,
      { type: "arm" },
      { type: "pickKey", key: { key: "q", code: "KeyQ" } },
      { type: "midi", msg: { kind: "cc", ch: 1, cc: 5, value: 9 } },
    );
    expect(wantsNote.made).toBeUndefined();
    expect(wantsNote.state.step).toBe("note");
    // A note off does not complete a note either.
    const off = run(
      LEARN_IDLE,
      { type: "arm" },
      { type: "pickKey", key: { key: "q", code: "KeyQ" } },
      { type: "midi", msg: { kind: "noteOff", ch: 1, note: 5 } },
    );
    expect(off.made).toBeUndefined();
  });

  it("lets a later pick re-aim, and ignores picks and messages while idle", () => {
    const other = { id: "master/scale", label: "Master · Scale" };
    expect(run(LEARN_IDLE, { type: "arm" }, { type: "pickTarget", target }, { type: "pickTarget", target: other }).state).toEqual({
      step: "cc",
      target: other,
    });
    expect(
      run(LEARN_IDLE, { type: "arm" }, { type: "pickTarget", target }, { type: "pickKey", key: { key: "q", code: "KeyQ" } }).state.step,
    ).toBe("note");
    expect(run(LEARN_IDLE, { type: "pickTarget", target }).state).toEqual(LEARN_IDLE);
    expect(run(LEARN_IDLE, { type: "midi", msg: { kind: "cc", ch: 1, cc: 1, value: 1 } }).made).toBeUndefined();
  });

  it("cancels from any step", () => {
    expect(run(LEARN_IDLE, { type: "arm" }, { type: "pickTarget", target }, { type: "cancel" }).state).toEqual(LEARN_IDLE);
  });

  it("says what it waits for", () => {
    expect(learnPrompt(LEARN_IDLE)).toBe("");
    expect(learnPrompt({ step: "armed" })).toMatch(/slider/);
    expect(learnPrompt({ step: "cc", target })).toContain("Storm · Speed");
    expect(learnPrompt({ step: "note", key: { key: "q", code: "KeyQ" } })).toContain("Q");
  });
});
