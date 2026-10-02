import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// keyHints.ts keeps its tip state (cache, click counts, cooldown) at module
// level, so each test imports a fresh copy. localStorage doesn't exist in
// the node env, which its persist() already tolerates.
async function load() {
  vi.resetModules();
  const mod = await import("../src/ui/keyHints.ts");
  const spy = vi.fn();
  mod.installKeyHints(spy);
  return { ...mod, spy };
}

describe("noteMouseUse tips", () => {
  beforeEach(() => {
    vi.stubGlobal("document", {
      addEventListener() {},
      hidden: false,
      body: { classList: { contains: () => false, add() {}, remove() {} } },
    });
    vi.stubGlobal("window", { addEventListener() {} });
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("tips on the second mouse use of a shortcut, once", async () => {
    const { SHORTCUTS, noteMouseUse, spy } = await load();
    const id = SHORTCUTS[0].id;
    noteMouseUse(id);
    expect(spy).not.toHaveBeenCalled();
    noteMouseUse(id);
    expect(spy).toHaveBeenCalledTimes(1);
    vi.setSystemTime(1_000_000 + 10 * 60_000);
    noteMouseUse(id);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("a tip swallowed by the cooldown is not marked as shown", async () => {
    const { SHORTCUTS, noteMouseUse, spy } = await load();
    const [first, second] = [SHORTCUTS[0].id, SHORTCUTS[1].id];
    noteMouseUse(first);
    noteMouseUse(first);
    expect(spy).toHaveBeenCalledTimes(1);

    // Inside the 60 s cooldown: the second id's tip is swallowed...
    noteMouseUse(second);
    noteMouseUse(second);
    expect(spy).toHaveBeenCalledTimes(1);

    // ...but it was never shown, so the next click after the cooldown earns it.
    vi.setSystemTime(1_000_000 + 61_000);
    noteMouseUse(second);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1][0]).toContain(SHORTCUTS[1].label);
  });

  it("an id whose key has been pressed never tips", async () => {
    const { SHORTCUTS, noteKeyUse, noteMouseUse, spy } = await load();
    const id = SHORTCUTS[0].id;
    noteKeyUse(id);
    noteMouseUse(id);
    noteMouseUse(id);
    expect(spy).not.toHaveBeenCalled();
  });
});
