import { afterEach, describe, expect, it, vi } from "vitest";
import { shouldTickInBackground, startBackgroundTick } from "../src/net/backgroundTick.ts";

describe("shouldTickInBackground", () => {
  it("ticks only while hidden and something needs feeding", () => {
    expect(shouldTickInBackground(true, true)).toBe(true);
    expect(shouldTickInBackground(true, false)).toBe(false);
    // A visible page has requestAnimationFrame; ticking too would double every pass.
    expect(shouldTickInBackground(false, true)).toBe(false);
    expect(shouldTickInBackground(false, false)).toBe(false);
  });
});

describe("startBackgroundTick", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns null where workers are unavailable", () => {
    vi.stubGlobal("Worker", undefined);
    expect(startBackgroundTick(() => undefined)).toBeNull();
  });

  it("calls back on each worker message and frees the worker on stop", () => {
    let worker: { onmessage: (() => void) | null; terminate: () => void } | null = null;
    const terminate = vi.fn();
    const revoke = vi.fn();
    vi.stubGlobal(
      "Worker",
      class {
        onmessage: (() => void) | null = null;
        terminate = terminate;
        constructor() {
          // eslint-disable-next-line @typescript-eslint/no-this-alias
          worker = this;
        }
      },
    );
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: revoke });
    const onTick = vi.fn();
    const handle = startBackgroundTick(onTick);
    expect(handle).not.toBeNull();
    worker!.onmessage!();
    worker!.onmessage!();
    expect(onTick).toHaveBeenCalledTimes(2);
    handle!.stop();
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith("blob:x");
  });
});
