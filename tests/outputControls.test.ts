import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOutputControls, type OutputControlElements } from "../src/ui/outputControls.ts";
import type { OutputBridge, OutputStatus } from "../src/net/outputBridge.ts";
import { PLAY_TAP_MAX_MS } from "../src/ui/outputKeys.ts";

/** Just enough of an element for the bar: listeners, style, classes, text. */
function fakeEl() {
  const handlers = new Map<string, Array<(e: unknown) => void>>();
  const classes = new Set<string>();
  const vars: Record<string, string> = {};
  const style = {
    display: "",
    vars,
    setProperty(k: string, v: string) {
      vars[k] = v;
    },
    removeProperty(k: string) {
      delete vars[k];
    },
  };
  return {
    style,
    textContent: "",
    title: "",
    classList: {
      add: (c: string) => void classes.add(c),
      remove: (c: string) => void classes.delete(c),
      toggle: (c: string, on?: boolean) => void ((on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c)),
      contains: (c: string) => classes.has(c),
    },
    setAttribute: () => {},
    setPointerCapture: () => {},
    addEventListener: (t: string, f: (e: unknown) => void) => void handlers.set(t, [...(handlers.get(t) ?? []), f]),
    fire: (t: string, e: unknown = {}) => {
      for (const f of handlers.get(t) ?? []) f(e);
    },
  };
}

function fakeBridge(init: Partial<OutputStatus>, withTake: boolean) {
  const calls: string[] = [];
  let st: OutputStatus = { open: true, cue: false, differs: false, canCue: false, changedBy: null, ...init };
  const listeners: Array<(s: OutputStatus) => void> = [];
  const bridge: OutputBridge = {
    open: () => void calls.push("open"),
    status: () => st,
    onStatus: (cb) => void listeners.push(cb),
    setCue: (on) => void calls.push(`cue:${on}`),
    go: (g) => {
      calls.push(`go:${g}`);
      return !!g;
    },
    update: () => {},
    pushFrame: () => {},
    sendPower: () => {},
    outputStatus: () => null,
    ...(withTake ? { take: () => void calls.push("take") } : {}),
  };
  return {
    bridge,
    calls,
    set(s: Partial<OutputStatus>) {
      st = { ...st, ...s };
      for (const cb of listeners) cb(st);
    },
  };
}

function setup(init: Partial<OutputStatus> = {}, withTake = true) {
  const b = fakeBridge(init, withTake);
  const els = { popBtn: fakeEl(), cueBtn: fakeEl(), goBtn: fakeEl(), takeBtn: fakeEl(), stateEl: fakeEl(), barEl: fakeEl() };
  const controls = createOutputControls(b.bridge, els as unknown as OutputControlElements);
  controls.setVisible(true);
  return { controls, els, calls: b.calls, set: b.set };
}

let nowMs = 0;
beforeEach(() => {
  nowMs = 1000;
  vi.stubGlobal("window", { setTimeout: (f: () => void, ms: number) => setTimeout(f, ms) });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.spyOn(performance, "now").mockImplementation(() => nowMs);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the bar for the room's Main", () => {
  it("hides CUE while there is no pop-out, and shows it when one is open", () => {
    const { els, set } = setup();
    expect(els.cueBtn.style.display).toBe("none");
    expect(els.goBtn.style.display).toBe("block");
    set({ canCue: true });
    expect(els.cueBtn.style.display).toBe("block");
  });

  it("says MAIN = / ≠ YOURS without a pop-out and keeps the pop-out's words with one", () => {
    const { els, set } = setup();
    expect(els.stateEl.textContent).toBe("MAIN = YOURS");
    set({ differs: true });
    expect(els.stateEl.textContent).toBe("MAIN ≠ YOURS — PLAY TO SEND");
    set({ canCue: true });
    expect(els.stateEl.textContent).toBe("OUT ≠ PREVIEW — PLAY TO SEND");
    set({ differs: false });
    expect(els.stateEl.textContent).toBe("OUT = PREVIEW");
  });

  it("names who changed Main and offers TAKE MAIN, which calls take", () => {
    const { els, calls, set } = setup();
    expect(els.takeBtn.style.display).toBe("none");
    set({ differs: true, changedBy: "iPad" });
    expect(els.stateEl.textContent).toBe("MAIN CHANGED BY IPAD");
    expect(els.takeBtn.style.display).toBe("block");
    els.takeBtn.fire("click");
    expect(calls).toEqual(["take"]);
    set({ changedBy: null });
    expect(els.takeBtn.style.display).toBe("none");
  });

  it("works without a take button in the markup, and without a take on the bridge", () => {
    const noBtn = fakeBridge({ changedBy: "iPad" }, true);
    const els = { popBtn: fakeEl(), cueBtn: fakeEl(), goBtn: fakeEl(), stateEl: fakeEl(), barEl: fakeEl() };
    expect(() => createOutputControls(noBtn.bridge, els as unknown as OutputControlElements)).not.toThrow();
    const noTake = setup({ changedBy: "iPad" }, false);
    expect(() => noTake.els.takeBtn.fire("click")).not.toThrow();
    expect(noTake.calls).toEqual([]);
  });

  it("Cue does nothing while no pop-out is open", () => {
    const { controls, calls, set } = setup();
    expect(controls.cueActive()).toBe(false);
    expect(controls.holdCue(true)).toBe(false);
    expect(calls).toEqual([]);
    set({ canCue: true });
    expect(controls.cueActive()).toBe(true);
    expect(controls.holdCue(true)).toBe(true);
    expect(calls).toEqual(["cue:true"]);
  });
});

describe("PLAY under a pointer", () => {
  it("a short press sends at once, and the click that follows does not send again", () => {
    const { els, calls } = setup();
    els.goBtn.fire("pointerdown", { button: 0 });
    nowMs += 100;
    els.goBtn.fire("pointerup");
    els.goBtn.fire("click");
    expect(calls).toEqual(["go:undefined"]);
  });

  it("a hold glides on release, over the length the hold earns", () => {
    const { els, calls } = setup();
    els.goBtn.fire("pointerdown", { button: 0 });
    nowMs += 3000;
    els.goBtn.fire("pointerup");
    els.goBtn.fire("click");
    expect(calls).toEqual(["go:6000"]);
  });

  it("sliding off or a cancel drops the hold without sending", () => {
    const { els, calls } = setup();
    els.goBtn.fire("pointerdown", { button: 0 });
    nowMs += 3000;
    els.goBtn.fire("pointerleave");
    els.goBtn.fire("pointerup");
    els.goBtn.fire("pointerdown", { button: 0 });
    nowMs += 3000;
    els.goBtn.fire("pointercancel");
    els.goBtn.fire("pointerup");
    expect(calls).toEqual([]);
  });

  it("clears the charge fill once released", () => {
    const { els } = setup();
    els.goBtn.fire("pointerdown", { button: 0 });
    nowMs += PLAY_TAP_MAX_MS + 1000;
    els.goBtn.fire("pointerup");
    expect(els.goBtn.style.vars["--charge"]).toBeUndefined();
  });

  it("a click with no press before it (the keyboard) still sends", () => {
    const { els, calls } = setup();
    els.goBtn.fire("click");
    expect(calls).toEqual(["go:undefined"]);
  });
});
