import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NO_EFFECTS, type HeldEffects } from "../src/render/heldEffects.ts";

// effectControls.ts builds its buttons and listens on window/document; the
// tests run in node, so both are small fakes that keep the listeners.
type Listener = (e: Record<string, unknown>) => void;

function listenerHost() {
  const on = new Map<string, Listener[]>();
  return {
    addEventListener(type: string, fn: Listener) {
      on.set(type, [...(on.get(type) ?? []), fn]);
    },
    fire(type: string, e: Record<string, unknown> = {}) {
      for (const fn of on.get(type) ?? []) fn({ preventDefault() {}, ...e });
    },
  };
}

function fakeEl() {
  return {
    ...listenerHost(),
    dataset: {} as Record<string, string>,
    style: {} as Record<string, string>,
    classList: { toggle() {} },
    setAttribute() {},
    append() {},
    appendChild() {},
  };
}

let win: ReturnType<typeof listenerHost>;
let doc: ReturnType<typeof listenerHost> & { hidden: boolean; createElement(): ReturnType<typeof fakeEl> };
let made: ReturnType<typeof fakeEl>[];

beforeEach(() => {
  made = [];
  win = listenerHost();
  doc = Object.assign(listenerHost(), {
    hidden: false,
    createElement() {
      const el = fakeEl();
      made.push(el);
      return el;
    },
  });
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function build() {
  const { createEffectControls } = await import("../src/ui/effectControls.ts");
  let last: HeldEffects = NO_EFFECTS;
  const controls = createEffectControls({
    bar: fakeEl() as unknown as HTMLElement,
    enabled: () => true,
    isTyping: () => false,
    onChange: (e) => {
      last = e;
    },
  });
  const button = (fx: string) => made.find((b) => b.dataset.fx === fx)!;
  const key = (type: "keydown" | "keyup", code: string, repeat = false) => win.fire(type, { code, key: code.slice(3).toLowerCase(), repeat });
  return { controls, button, key, now: () => last };
}

describe("effect controls", () => {
  it("a held effect is on only while its key is down, and blur lets go", async () => {
    const { key, now } = await build();
    key("keydown", "KeyQ");
    expect(now().blackout).toBe(true);
    key("keyup", "KeyQ");
    expect(now().blackout).toBe(false);
    key("keydown", "KeyQ");
    win.fire("blur");
    expect(now().blackout).toBe(false);
  });

  it("Strobe latches: one press turns it on, the next press off", async () => {
    const { key, now } = await build();
    key("keydown", "KeyW");
    key("keyup", "KeyW");
    expect(now().strobe).toBe(true);
    key("keydown", "KeyW", true);
    expect(now().strobe).toBe(true);
    key("keydown", "KeyW");
    key("keyup", "KeyW");
    expect(now().strobe).toBe(false);
  });

  it("the Strobe button latches the same way", async () => {
    const { button, now } = await build();
    button("strobe").fire("pointerdown", { button: 0 });
    button("strobe").fire("pointerup");
    button("strobe").fire("pointerleave");
    expect(now().strobe).toBe(true);
    button("strobe").fire("pointerdown", { button: 0 });
    expect(now().strobe).toBe(false);
  });

  it("a latched Strobe survives blur and a hidden tab, not leaving the scene", async () => {
    const { controls, key, now } = await build();
    key("keydown", "KeyW");
    win.fire("blur");
    doc.hidden = true;
    doc.fire("visibilitychange");
    expect(now().strobe).toBe(true);
    controls.setVisible(false);
    expect(now().strobe).toBe(false);
  });
});
