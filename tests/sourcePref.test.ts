import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getAudioSourceChoice,
  setAudioSourceChoice,
  hasStoredAudioSource,
  resolveSourceState,
  displayCaptureSupported,
  watchMicPermission,
  AUDIO_SOURCE_DEFAULT,
  type MicPermission,
} from "../src/audio/sourcePref.ts";

// Like powerMode/autoGain/bandSplit, audio-source choice has no per-scene
// keying — it's one global value — so every test must reset first to avoid
// leaking state from whichever test ran before it (vitest runs a file's
// tests in one module instance, sharing the module-level cache).
describe("audio source persistence", () => {
  beforeEach(() => {
    setAudioSourceChoice(AUDIO_SOURCE_DEFAULT);
  });

  // vitest runs under environment: "node" (vitest.config.ts), so there is no
  // localStorage global at all here — this also proves the module tolerates that.
  it("defaults to mic", () => {
    expect(AUDIO_SOURCE_DEFAULT).toBe("mic");
    expect(getAudioSourceChoice()).toBe("mic");
  });

  it("round-trips a set", () => {
    setAudioSourceChoice("display");
    expect(getAudioSourceChoice()).toBe("display");
    setAudioSourceChoice("mic");
    expect(getAudioSourceChoice()).toBe("mic");
  });
});

describe("audio source persistence with a stubbed localStorage", () => {
  const store = new Map<string, string>();
  const fakeLocalStorage: Pick<Storage, "getItem" | "setItem"> = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
  };

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", fakeLocalStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects a garbage stored value and falls back to the default, unchosen", async () => {
    // loadInitial() only runs once, at module init — so to exercise its
    // guard (isAudioSourceChoice) against a corrupted value, the module must
    // be re-imported fresh with the bad value already in place.
    store.set("vibe.audioSource", "bluetooth-headset");
    vi.resetModules();
    const fresh = await import("../src/audio/sourcePref.ts");
    expect(fresh.getAudioSourceChoice()).toBe("mic");
    // A garbage value must NOT read as a real pick — that's exactly what
    // hasStoredAudioSource() exists to distinguish from AUDIO_SOURCE_DEFAULT.
    expect(fresh.hasStoredAudioSource()).toBe(false);
  });

  it("persists a set through localStorage.setItem, and hasStoredAudioSource() agrees", () => {
    setAudioSourceChoice("display");
    expect(store.get("vibe.audioSource")).toBe("display");
    expect(hasStoredAudioSource()).toBe(true);
  });

  it("hasStoredAudioSource() flips true on a set, even if the write itself fails", async () => {
    // persist() swallows errors (see its own comment) — chosen must still
    // flip, or a browser that can't persist would look permanently unpicked.
    // A fresh module import (like the garbage-value test above) so this
    // starts from a genuine "nothing chosen yet" instead of riding whatever
    // an earlier test in this file already set on the shared module cache.
    const boom: Pick<Storage, "getItem" | "setItem"> = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };
    vi.stubGlobal("localStorage", boom);
    vi.resetModules();
    const fresh = await import("../src/audio/sourcePref.ts");
    expect(fresh.hasStoredAudioSource()).toBe(false);
    fresh.setAudioSourceChoice("display");
    expect(fresh.hasStoredAudioSource()).toBe(true);
  });
});

describe("resolveSourceState", () => {
  it("is idle when nothing is live and nothing was ever chosen", () => {
    expect(
      resolveSourceState({ liveChoice: null, preferredChoice: "mic", preferenceChosen: false, micPermission: "prompt" }),
    ).toEqual({
      choice: "mic",
      live: false,
      chosen: false,
      micReady: false,
    });
  });

  it("is ready when a preference was chosen but nothing is live", () => {
    expect(
      resolveSourceState({
        liveChoice: null,
        preferredChoice: "display",
        preferenceChosen: true,
        micPermission: "prompt",
      }),
    ).toEqual({
      choice: "display",
      live: false,
      chosen: true,
      micReady: false,
    });
  });

  it("live overrides a mismatched stored preference", () => {
    // Exactly the swapAudioSource ordering gap: a capture already running as
    // "display" while the persisted pref still says "mic" (attach happens
    // before persist) must report the LIVE kind, never the stale pref.
    const state = resolveSourceState({
      liveChoice: "display",
      preferredChoice: "mic",
      preferenceChosen: false,
      micPermission: "denied",
    });
    expect(state).toEqual({ choice: "display", live: true, chosen: true, micReady: false });
  });

  it("mic with a stored pick but permission only at \"prompt\" is NOT chosen — the reset bug", () => {
    // The exact regression this round fixes: a permission reset leaves
    // localStorage's stored pick in place, but the mic isn't actually ready
    // to listen until the browser says so.
    const state = resolveSourceState({
      liveChoice: null,
      preferredChoice: "mic",
      preferenceChosen: true,
      micPermission: "prompt",
    });
    expect(state.chosen).toBe(false);
  });

  it("mic never stored but already granted IS chosen", () => {
    const state = resolveSourceState({
      liveChoice: null,
      preferredChoice: "mic",
      preferenceChosen: false,
      micPermission: "granted",
    });
    expect(state.chosen).toBe(true);
  });

  it("mic denied is NOT chosen even with a stored pick", () => {
    const state = resolveSourceState({
      liveChoice: null,
      preferredChoice: "mic",
      preferenceChosen: true,
      micPermission: "denied",
    });
    expect(state.chosen).toBe(false);
  });

  it("mic with an unknown permission (Permissions API unavailable) falls back to the stored pick", () => {
    const state = resolveSourceState({
      liveChoice: null,
      preferredChoice: "mic",
      preferenceChosen: true,
      micPermission: "unknown",
    });
    expect(state.chosen).toBe(true);
  });

  it("display stays chosen off the stored pick even while permission (irrelevant to display) sits at prompt", () => {
    // getDisplayMedia has no standing permission to consult — it prompts on
    // every call — so the stored pick is the only signal for display.
    const state = resolveSourceState({
      liveChoice: null,
      preferredChoice: "display",
      preferenceChosen: true,
      micPermission: "prompt",
    });
    expect(state.chosen).toBe(true);
  });

  it("live beats a merely-\"prompt\" permission", () => {
    const state = resolveSourceState({
      liveChoice: "mic",
      preferredChoice: "mic",
      preferenceChosen: false,
      micPermission: "prompt",
    });
    expect(state).toEqual({ choice: "mic", live: true, chosen: true, micReady: false });
  });

  describe("micReady", () => {
    // The regression this field exists to fix: a granted mic permission is
    // real and worth showing regardless of which source happens to be
    // "preferred" right now — not just when mic is the resolved choice.
    it("is true when the mic permission is granted, even while display is preferred", () => {
      const state = resolveSourceState({
        liveChoice: null,
        preferredChoice: "display",
        preferenceChosen: true,
        micPermission: "granted",
      });
      expect(state.choice).toBe("display");
      expect(state.micReady).toBe(true);
    });

    it("is false for denied, prompt, and unknown permission", () => {
      for (const micPermission of ["denied", "prompt", "unknown"] as const) {
        const state = resolveSourceState({
          liveChoice: null,
          preferredChoice: "mic",
          preferenceChosen: true,
          micPermission,
        });
        expect(state.micReady).toBe(false);
      }
    });

    it("a live capture doesn't suppress it — granted permission still reads ready even while display is live", () => {
      const state = resolveSourceState({
        liveChoice: "display",
        preferredChoice: "mic",
        preferenceChosen: false,
        micPermission: "granted",
      });
      expect(state).toEqual({ choice: "display", live: true, chosen: true, micReady: true });
    });
  });
});

describe("watchMicPermission", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is unknown when navigator is absent (this suite's default node env)", async () => {
    expect(await watchMicPermission(() => {})).toBe("unknown");
  });

  it("is unknown when navigator.permissions.query rejects (e.g. older Firefox rejecting \"microphone\")", async () => {
    vi.stubGlobal("navigator", {
      permissions: { query: () => Promise.reject(new Error("not supported")) },
    });
    expect(await watchMicPermission(() => {})).toBe("unknown");
  });

  it("resolves the initial state and calls onChange on a dispatched change event", async () => {
    // A real EventTarget, not a mock object, so the status's own
    // addEventListener/dispatchEvent actually wire up under node — matching
    // what a real PermissionStatus is.
    class FakeStatus extends EventTarget {
      state: MicPermission;
      constructor(state: MicPermission) {
        super();
        this.state = state;
      }
    }
    const status = new FakeStatus("prompt");
    vi.stubGlobal("navigator", {
      permissions: { query: () => Promise.resolve(status) },
    });
    const changes: MicPermission[] = [];
    const initial = await watchMicPermission((p) => changes.push(p));
    expect(initial).toBe("prompt");

    status.state = "granted";
    status.dispatchEvent(new Event("change"));
    expect(changes).toEqual(["granted"]);
  });
});

describe("displayCaptureSupported", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is false when navigator is absent (this suite's default node env)", () => {
    expect(displayCaptureSupported()).toBe(false);
  });

  it("is false when mediaDevices exists but lacks getDisplayMedia", () => {
    vi.stubGlobal("navigator", { mediaDevices: {} });
    expect(displayCaptureSupported()).toBe(false);
  });

  it("is true when getDisplayMedia is present", () => {
    vi.stubGlobal("navigator", { mediaDevices: { getDisplayMedia: () => Promise.resolve() } });
    expect(displayCaptureSupported()).toBe(true);
  });
});
