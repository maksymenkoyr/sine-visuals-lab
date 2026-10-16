import { describe, expect, it } from "vitest";
import { setLiveText } from "../src/ui/liveText.ts";

// Just enough of a DOM element for setLiveText: its first/last child and a
// textContent setter that, like the real one, swaps in one new text node.
function fakeEl(children: { nodeType: number; data?: string }[]) {
  const el = {
    children,
    get firstChild() {
      return el.children[0] ?? null;
    },
    get lastChild() {
      return el.children[el.children.length - 1] ?? null;
    },
    set textContent(t: string) {
      el.children = t ? [{ nodeType: 3, data: t }] : [];
    },
  };
  return el;
}

describe("setLiveText", () => {
  it("rewrites the one text node in place, keeping the node", () => {
    const node = { nodeType: 3, data: "0.50" };
    const el = fakeEl([node]);
    setLiveText(el as unknown as Element, "0.75");
    expect(el.firstChild).toBe(node);
    expect(node.data).toBe("0.75");
  });

  it("falls back to textContent when the element holds more than one text node", () => {
    const el = fakeEl([{ nodeType: 1 }, { nodeType: 3, data: " 00:03" }]);
    setLiveText(el as unknown as Element, "RECORD");
    expect(el.children).toEqual([{ nodeType: 3, data: "RECORD" }]);
    const node = el.firstChild;
    setLiveText(el as unknown as Element, "STOP");
    expect(el.firstChild).toBe(node);
  });

  it("fills an empty element", () => {
    const el = fakeEl([]);
    setLiveText(el as unknown as Element, "40");
    expect(el.children).toEqual([{ nodeType: 3, data: "40" }]);
  });
});
