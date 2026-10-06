import { describe, expect, it } from "vitest";
import { controllerBadgeText, controllerPreview, silentSample } from "../src/net/controllerPreview.ts";
import type { VisualSample } from "../src/net/room.ts";

const STALE_MS = 3000;

function loud(): VisualSample {
  return {
    bands: new Float32Array([0.9, 0.8, 0.7, 0.6]),
    energy: 0.9,
    bpm: 128,
    beatPhase: 0.4,
    onsetFired: true,
    pulseFired: true,
    timeSec: 12.5,
    level: 0.8,
    wave: { min: -0.6, max: 0.7 },
  };
}

describe("silentSample", () => {
  it("takes the audio out and keeps the clock", () => {
    const s = silentSample(loud());
    expect(Array.from(s.bands)).toEqual([0, 0, 0, 0]);
    expect(s).toMatchObject({
      energy: 0,
      level: 0,
      bpm: 0,
      beatPhase: 0,
      onsetFired: false,
      pulseFired: false,
      timeSec: 12.5,
      wave: null,
    });
  });

  it("does not hand back the sample's own band array", () => {
    const src = loud();
    silentSample(src).bands[0] = 1;
    expect(src.bands[0]).toBeCloseTo(0.9);
  });
});

describe("controllerPreview", () => {
  it("passes a fresh sample through untouched", () => {
    const s = loud();
    expect(controllerPreview(s, 40, "open", STALE_MS)).toEqual({ sample: s, waiting: false });
  });

  it("goes silent, and waiting, once frames stop for the stale time", () => {
    const s = loud();
    expect(controllerPreview(s, STALE_MS - 1, "open", STALE_MS).sample).toBe(s);
    const p = controllerPreview(s, STALE_MS, "open", STALE_MS);
    expect(p.waiting).toBe(true);
    expect(p.sample).not.toBe(s);
    expect(p.sample?.energy).toBe(0);
    expect(p.sample?.level).toBe(0);
    expect(p.sample?.onsetFired).toBe(false);
    expect(p.sample?.timeSec).toBe(12.5);
  });

  it("is waiting before the first frame ever arrives, with nothing to draw", () => {
    expect(controllerPreview(null, Infinity, "open", STALE_MS)).toEqual({ sample: null, waiting: true });
  });

  it("still goes silent, but does not say waiting, while its own socket is down", () => {
    const p = controllerPreview(loud(), 10_000, "closed", STALE_MS);
    expect(p.sample?.energy).toBe(0);
    expect(p.waiting).toBe(false);
  });

  it("is live again the moment frames come back", () => {
    expect(controllerPreview(loud(), 20, "open", STALE_MS).waiting).toBe(false);
  });
});

describe("controllerBadgeText", () => {
  it("names the room when all is well", () => {
    expect(controllerBadgeText("ABCD", "open", false)).toBe("remote · ABCD");
  });

  it("says what is wrong, the socket first", () => {
    expect(controllerBadgeText("ABCD", "open", true)).toBe("remote · ABCD · waiting for laptop");
    expect(controllerBadgeText("ABCD", "closed", false)).toBe("remote · ABCD · reconnecting");
    expect(controllerBadgeText("ABCD", "connecting", true)).toBe("remote · ABCD · reconnecting");
  });
});
