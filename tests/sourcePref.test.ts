import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getAudioSourceChoice,
  setAudioSourceChoice,
  displayCaptureSupported,
  AUDIO_SOURCE_DEFAULT,
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
