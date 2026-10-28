import { afterEach, describe, expect, it, vi } from "vitest";
import { arrowNudge, handleSceneArrows } from "../src/ui/sceneArrows.ts";
import type { SceneCard } from "../src/render/scene.ts";
import type { SceneSetting } from "../src/render/sceneSettings.ts";

const spin: SceneSetting = { key: "spin", label: "Spin", min: -10, max: 10, step: 1, default: 0 };
const card: SceneCard = {
  id: "test",
  name: "Test",
  settings: [spin],
  arrows: { leftRight: { setting: "spin", by: 2 }, shiftUpDown: { setting: "spin", by: -1 } },
};

// The tests run without a DOM: a stand-in for the focused element, whose
// closest() matches only when it was made inside a control.
class FakeElement {
  constructor(private readonly inControl: boolean) {}
  closest(): unknown {
    return this.inControl ? this : null;
  }
}

function press(key: string, opts: { shift?: boolean; target?: FakeElement | null; prevented?: boolean } = {}) {
  return {
    key,
    shiftKey: !!opts.shift,
    target: opts.target ?? null,
    defaultPrevented: !!opts.prevented,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent & { preventDefault: ReturnType<typeof vi.fn> };
}

function store(start: number) {
  let value = start;
  return { get: () => value, set: (_id: string, _spec: SceneSetting, v: number) => void (value = v), now: () => value };
}

afterEach(() => vi.unstubAllGlobals());

describe("scene arrow keys", () => {
  it("map → and ↑ to adding, ← and ↓ to taking away, and Shift to the second pair", () => {
    expect(arrowNudge(card.arrows, "ArrowRight", false)).toEqual({ setting: "spin", by: 2 });
    expect(arrowNudge(card.arrows, "ArrowLeft", false)).toEqual({ setting: "spin", by: -2 });
    expect(arrowNudge(card.arrows, "ArrowUp", true)).toEqual({ setting: "spin", by: -1 });
    expect(arrowNudge(card.arrows, "ArrowDown", true)).toEqual({ setting: "spin", by: 1 });
    expect(arrowNudge(card.arrows, "ArrowUp", false)).toBeNull();
    expect(arrowNudge(card.arrows, "ArrowRight", true)).toBeNull();
    expect(arrowNudge(card.arrows, "a", false)).toBeNull();
    expect(arrowNudge(undefined, "ArrowRight", false)).toBeNull();
  });

  it("move the setting within its range and claim the press", () => {
    vi.stubGlobal("Element", FakeElement);
    const s = store(9);
    const e = press("ArrowRight", { target: new FakeElement(false) });
    expect(handleSceneArrows(e, card, s)).toEqual({ spec: spin, value: 10 });
    expect(s.now()).toBe(10);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("store a whole number of presses without float dust", () => {
    vi.stubGlobal("Element", FakeElement);
    const fine: SceneSetting = { key: "spin", label: "Spin", min: 0, max: 3, step: 0.01, default: 1 };
    const fineCard: SceneCard = { ...card, settings: [fine], arrows: { leftRight: { setting: "spin", by: 0.05 } } };
    const s = store(1);
    for (let k = 0; k < 10; k++) handleSceneArrows(press("ArrowRight"), fineCard, s);
    expect(s.now()).toBe(1.5);
  });

  it("leave the press to a focused control that moves on the arrows, or one that claimed it", () => {
    vi.stubGlobal("Element", FakeElement);
    const s = store(0);
    for (const e of [press("ArrowRight", { target: new FakeElement(true) }), press("ArrowRight", { prevented: true })]) {
      expect(handleSceneArrows(e, card, s)).toBeNull();
      expect(e.preventDefault).not.toHaveBeenCalled();
    }
    expect(s.now()).toBe(0);
  });
});
