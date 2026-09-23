import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getAudioSourceChoice,
  setAudioSourceChoice,
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

  it("rejects a garbage stored value and falls back to the default", async () => {
    // loadInitial() only runs once, at module init — so to exercise its
    // guard (isAudioSourceChoice) against a corrupted value, the module must
    // be re-imported fresh with the bad value already in place.
    store.set("vibe.audioSource", "bluetooth-headset");
    vi.resetModules();
    const fresh = await import("../src/audio/sourcePref.ts");
    expect(fresh.getAudioSourceChoice()).toBe("mic");
  });

  it("persists a set through localStorage.setItem", () => {
    setAudioSourceChoice("display");
    expect(store.get("vibe.audioSource")).toBe("display");
  });

  it("keeps a set for the session even if the write itself fails", async () => {
    const boom: Pick<Storage, "getItem" | "setItem"> = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };
    vi.stubGlobal("localStorage", boom);
    vi.resetModules();
    const fresh = await import("../src/audio/sourcePref.ts");
    fresh.setAudioSourceChoice("display");
    expect(fresh.getAudioSourceChoice()).toBe("display");
  });
});

describe("resolveSourceState", () => {
  it("is idle when nothing is live", () => {
    expect(resolveSourceState({ liveChoice: null, preferredChoice: "mic" })).toEqual({
      choice: "mic",
      live: false,
    });
  });

  it("reports the preferred choice, not live, when nothing is capturing", () => {
    expect(resolveSourceState({ liveChoice: null, preferredChoice: "display" })).toEqual({
      choice: "display",
      live: false,
    });
  });

  it("live wins over a mismatched stored preference", () => {
    // Exactly the swapAudioSource ordering gap: a capture already running as
    // "display" while the persisted pref still says "mic" (attach happens
    // before persist) must report the LIVE kind, never the stale pref.
    const state = resolveSourceState({ liveChoice: "display", preferredChoice: "mic" });
    expect(state).toEqual({ choice: "display", live: true });
  });
});

describe("watchMicPermission", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is unknown when navigator is absent (this suite's default node env)", async () => {
    expect(await watchMicPermission(() => {})).toBe("unknown");
  });

  it("is unknown when the query rejects (Safari, older Firefox)", async () => {
    vi.stubGlobal("navigator", {
      permissions: { query: () => Promise.reject(new Error("not supported")) },
    });
    expect(await watchMicPermission(() => {})).toBe("unknown");
  });

  it("resolves the initial state and reports later changes", async () => {
    // A real EventTarget, so addEventListener/dispatchEvent actually wire up
    // under node the way a real PermissionStatus does.
    class FakeStatus extends EventTarget {
      state: MicPermission;
      constructor(state: MicPermission) {
        super();
        this.state = state;
      }
    }
    const status = new FakeStatus("granted");
    vi.stubGlobal("navigator", { permissions: { query: () => Promise.resolve(status) } });
    const changes: MicPermission[] = [];
    expect(await watchMicPermission((p) => changes.push(p))).toBe("granted");
    // A permission reset while the page is open.
    status.state = "prompt";
    status.dispatchEvent(new Event("change"));
    expect(changes).toEqual(["prompt"]);
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
