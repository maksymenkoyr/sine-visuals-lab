// createContextRecovery: rebuild in place when the loss was torn down cleanly,
// reload in every other case.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContextRecovery } from "../src/render/contextRecovery.ts";

function hooks(over: Partial<Record<"ready" | "teardown" | "rebuild", () => unknown>> = {}) {
  return {
    ready: vi.fn(() => true),
    teardown: vi.fn(),
    rebuild: vi.fn(),
    reload: vi.fn(),
    ...over,
  } as {
    ready: ReturnType<typeof vi.fn<() => boolean>>;
    teardown: ReturnType<typeof vi.fn<() => void>>;
    rebuild: ReturnType<typeof vi.fn<() => void>>;
    reload: ReturnType<typeof vi.fn<() => void>>;
  };
}

describe("createContextRecovery", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tears down on the loss and rebuilds on the restore without reloading", () => {
    const h = hooks();
    const r = createContextRecovery(h);
    r.lost();
    expect(h.teardown).toHaveBeenCalledTimes(1);
    expect(h.rebuild).not.toHaveBeenCalled();
    expect(r.restored()).toBe(true);
    expect(h.rebuild).toHaveBeenCalledTimes(1);
    expect(h.reload).not.toHaveBeenCalled();
  });

  it("reloads when the rebuild throws", () => {
    const h = hooks({
      rebuild: vi.fn(() => {
        throw new Error("boom");
      }),
    });
    const r = createContextRecovery(h);
    r.lost();
    expect(r.restored()).toBe(false);
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it("reloads without rebuilding when the teardown throws", () => {
    const h = hooks({
      teardown: vi.fn(() => {
        throw new Error("boom");
      }),
    });
    const r = createContextRecovery(h);
    r.lost();
    expect(r.restored()).toBe(false);
    expect(h.rebuild).not.toHaveBeenCalled();
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it("reloads when the page was not ready at the loss", () => {
    const h = hooks({ ready: vi.fn(() => false) });
    const r = createContextRecovery(h);
    r.lost();
    expect(h.teardown).not.toHaveBeenCalled();
    expect(r.restored()).toBe(false);
    expect(h.rebuild).not.toHaveBeenCalled();
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it("rebuilds in place on two cycles in a row", () => {
    const h = hooks();
    const r = createContextRecovery(h);
    r.lost();
    expect(r.restored()).toBe(true);
    r.lost();
    expect(r.restored()).toBe(true);
    expect(h.teardown).toHaveBeenCalledTimes(2);
    expect(h.rebuild).toHaveBeenCalledTimes(2);
    expect(h.reload).not.toHaveBeenCalled();
  });

  it("reloads on a restore with no loss before it", () => {
    const h = hooks();
    const r = createContextRecovery(h);
    expect(r.restored()).toBe(false);
    expect(h.reload).toHaveBeenCalledTimes(1);
  });
});
