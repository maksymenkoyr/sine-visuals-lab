import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearOverlayLogo,
  getOverlay,
  getOverlayLogoScope,
  setOverlayLogo,
  setOverlayOpacity,
  setOverlayPosition,
  setOverlaySize,
  setOverlayText,
} from "../src/render/overlayStore.ts";
import { LOGO_ROOM_MAX_CHARS, OVERLAY_DEFAULTS, OVERLAY_SIZE_MAX } from "../src/render/overlayLayout.ts";
import { applyRoomStorage, applySyncedStorage, captureRoomStorage, captureSyncedStorage } from "../src/net/syncedStores.ts";

// Node has no localStorage: the store runs in memory here (it must tolerate
// that), and a stub is installed only for the tests that look at what it saves.

const PNG = "data:image/png;base64,";
const SMALL_LOGO = `${PNG}iVBORw0KGgo=`;

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    m,
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearOverlayLogo();
  setOverlayText("");
  setOverlayPosition(OVERLAY_DEFAULTS.position);
  setOverlaySize(OVERLAY_DEFAULTS.size);
  setOverlayOpacity(OVERLAY_DEFAULTS.opacity);
});

describe("overlay store", () => {
  it("starts empty and hands back the same object until something changes", () => {
    const a = getOverlay();
    expect(a).toEqual(OVERLAY_DEFAULTS);
    expect(getOverlay()).toBe(a);
    setOverlayText("");
    expect(getOverlay()).toBe(a);
    setOverlayText("Club Night");
    expect(getOverlay()).not.toBe(a);
    expect(getOverlay().text).toBe("Club Night");
  });

  it("clamps size and opacity and cleans text", () => {
    setOverlaySize(99);
    expect(getOverlay().size).toBe(OVERLAY_SIZE_MAX);
    setOverlayOpacity(0);
    expect(getOverlay().opacity).toBeGreaterThan(0);
    setOverlayText("a\nb");
    expect(getOverlay().text).toBe("a b");
  });

  it("keeps a logo in one place at a time and reports where", () => {
    expect(getOverlayLogoScope()).toBe("none");
    expect(setOverlayLogo(SMALL_LOGO, "room")).toBe(true);
    expect(getOverlayLogoScope()).toBe("room");
    expect(getOverlay().logo).toBe(SMALL_LOGO);
    expect(setOverlayLogo(SMALL_LOGO, "device")).toBe(true);
    expect(getOverlayLogoScope()).toBe("device");
    clearOverlayLogo();
    expect(getOverlayLogoScope()).toBe("none");
    expect(getOverlay().logo).toBe("");
  });

  it("refuses a logo that is not a PNG data URL, or too big for the room", () => {
    expect(setOverlayLogo("https://example.com/a.png", "room")).toBe(false);
    expect(setOverlayLogo(`${PNG}${"A".repeat(LOGO_ROOM_MAX_CHARS)}`, "room")).toBe(false);
    expect(getOverlayLogoScope()).toBe("none");
  });

  it("saves nothing while every setting is the default, and the settings key once one is not", () => {
    const store = fakeStorage();
    vi.stubGlobal("localStorage", store);
    setOverlayText("DJ Sine");
    expect(JSON.parse(store.m.get("vibe.overlay")!).text).toBe("DJ Sine");
    setOverlayText("");
    expect(store.m.has("vibe.overlay")).toBe(false);
  });

  it("puts a room-sized logo in the look and a device-only one outside it", () => {
    const store = fakeStorage();
    vi.stubGlobal("localStorage", store);
    setOverlayText("DJ Sine");
    setOverlayLogo(SMALL_LOGO, "room");
    expect(Object.keys(captureRoomStorage(store)).sort()).toEqual(["vibe.overlay", "vibe.overlayLogo"]);
    setOverlayLogo(SMALL_LOGO, "device");
    expect(store.m.has("vibe.overlayLogo")).toBe(false);
    expect(Object.keys(captureRoomStorage(store))).toEqual(["vibe.overlay"]);
    // The pop-out on the same machine still gets the whole thing.
    expect(Object.keys(captureSyncedStorage(store)).sort()).toEqual(["vibe.overlay", "vibe.overlayLogoLocal"]);
  });

  it("re-reads when a snapshot is applied (the pop-out window and a TV)", () => {
    const store = fakeStorage();
    vi.stubGlobal("localStorage", store);
    applySyncedStorage(
      {
        "vibe.overlay": JSON.stringify({ text: "From the laptop", position: "centre", size: 2, opacity: 0.5 }),
        "vibe.overlayLogo": SMALL_LOGO,
      },
      store,
    );
    expect(getOverlay()).toEqual({ text: "From the laptop", position: "centre", size: 2, opacity: 0.5, logo: SMALL_LOGO });
    // A room look without it empties it again.
    applyRoomStorage({}, store);
    expect(getOverlay()).toEqual(OVERLAY_DEFAULTS);
  });

  it("does not let a room's look delete this device's own device-only logo", () => {
    const store = fakeStorage();
    vi.stubGlobal("localStorage", store);
    setOverlayLogo(SMALL_LOGO, "device");
    applyRoomStorage({}, store);
    expect(getOverlayLogoScope()).toBe("device");
  });
});
