import { describe, expect, it, vi } from "vitest";
import { flashTo } from "../src/ui/flashAnim.ts";

// The node env has no DOM, so the element and the Animation are stand-ins:
// flashTo only calls animate() on the element and cancel() on the animation.
type Flashable = Pick<HTMLElement, "animate">;

const LIT = { backgroundColor: "#fff" };
const REST = { backgroundColor: "rgba(255,0,0,0.55)" };

describe("flashTo", () => {
  it("animates from the lit keyframe to the rest keyframe over the given duration", () => {
    const anim = { cancel: vi.fn() } as unknown as Animation;
    const animate = vi.fn(() => anim);
    const el = { animate } as unknown as Flashable;

    const out = flashTo(el, null, LIT, REST, 420);

    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenCalledWith([LIT, REST], { duration: 420, easing: "ease-out" });
    expect(out).toBe(anim);
  });

  it("cancels the previous flash before starting the next", () => {
    const cancel = vi.fn();
    const prev = { cancel } as unknown as Animation;
    const animate = vi.fn(() => ({ cancel: vi.fn() }) as unknown as Animation);
    const el = { animate } as unknown as Flashable;

    flashTo(el, prev, LIT, REST, 550);

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(animate.mock.invocationCallOrder[0]);
  });

  it("skips the flash without throwing where Element.animate is missing, still cancelling the previous one", () => {
    const cancel = vi.fn();
    const prev = { cancel } as unknown as Animation;
    const el = {} as unknown as Flashable;

    const out = flashTo(el, prev, LIT, REST, 550);

    expect(out).toBeNull();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
