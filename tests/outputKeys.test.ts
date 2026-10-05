import { describe, it, expect } from "vitest";
import {
  createPlayKey,
  glideMsForHold,
  isMacAgent,
  isPlayKey,
  PLAY_TAP_MAX_MS,
  spaceIsCue,
  type KeyLike,
} from "../src/ui/outputKeys.ts";
import { GLIDE_MAX_MS, GLIDE_MIN_MS } from "../src/net/outputGlide.ts";

describe("glideMsForHold", () => {
  it("is a tap (null) under the threshold", () => {
    expect(glideMsForHold(0)).toBeNull();
    expect(glideMsForHold(PLAY_TAP_MAX_MS - 1)).toBeNull();
  });
  it("glides twice as long as the hold: 3 s held -> 6 s", () => {
    expect(glideMsForHold(3000)).toBe(6000);
  });
  it("clamps to the shortest and longest glide", () => {
    expect(glideMsForHold(PLAY_TAP_MAX_MS)).toBe(GLIDE_MIN_MS);
    expect(glideMsForHold(10 * GLIDE_MAX_MS)).toBe(GLIDE_MAX_MS);
  });
});

describe("createPlayKey", () => {
  it("returns the hold length on a clean press and release", () => {
    const k = createPlayKey();
    k.down(1000);
    expect(k.holdMs(1500)).toBe(500);
    expect(k.up(4000)).toBe(3000);
    expect(k.holdMs(4100)).toBeNull();
  });

  it("ignores a second down while held (auto-repeat, the other Option key)", () => {
    const k = createPlayKey();
    k.down(1000);
    k.down(2000);
    expect(k.up(3000)).toBe(2000);
  });

  it("is not a Play when another key or a click came in between", () => {
    const k = createPlayKey();
    k.down(0);
    k.cancel();
    expect(k.holdMs(100)).toBeNull();
    expect(k.up(200)).toBeNull();
    k.down(1000); // and the next press is clean again
    expect(k.up(1100)).toBe(100);
  });

  it("a cancel with nothing held does not poison the next press", () => {
    const k = createPlayKey();
    k.cancel();
    k.down(0);
    expect(k.up(50)).toBe(50);
  });

  it("an up that never saw a down is nothing", () => {
    expect(createPlayKey().up(10)).toBeNull();
  });

  it("reset (window lost focus) clears a held press so the next one starts clean", () => {
    const k = createPlayKey();
    k.down(0);
    k.reset();
    k.down(5000);
    expect(k.up(5300)).toBe(300);
  });
});

/** A key-down as the browser reports it; only what the predicates read. */
function ev(key: string, code: string, mods: Partial<Record<"altKey" | "ctrlKey" | "metaKey" | "shiftKey", boolean>> = {}): KeyLike {
  return { key, code, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...mods };
}
const OPTION = ev("Alt", "AltLeft", { altKey: true });
const RIGHT_COMMAND = ev("Meta", "MetaRight", { metaKey: true });
const LEFT_COMMAND = ev("Meta", "MetaLeft", { metaKey: true });

describe("isMacAgent", () => {
  it("is true for macOS Chrome and Safari and for iPadOS's desktop agent", () => {
    expect(isMacAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36")).toBe(true);
  });
  it("is false on Windows, Linux and an empty agent", () => {
    expect(isMacAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36")).toBe(false);
    expect(isMacAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36")).toBe(false);
    expect(isMacAgent("")).toBe(false);
  });
});

describe("isPlayKey", () => {
  it("Option plays everywhere", () => {
    expect(isPlayKey(OPTION, true)).toBe(true);
    expect(isPlayKey(OPTION, false)).toBe(true);
  });
  it("the right Command key plays on a Mac only (elsewhere it's the Windows / Super key)", () => {
    expect(isPlayKey(RIGHT_COMMAND, true)).toBe(true);
    expect(isPlayKey(RIGHT_COMMAND, false)).toBe(false);
  });
  it("the left Command key never plays: every shortcut starts there", () => {
    expect(isPlayKey(LEFT_COMMAND, true)).toBe(false);
  });
  it("a Play key with another modifier already held is a chord, not a Play", () => {
    expect(isPlayKey(ev("Alt", "AltLeft", { altKey: true, metaKey: true }), true)).toBe(false);
    expect(isPlayKey(ev("Alt", "AltLeft", { altKey: true, shiftKey: true }), true)).toBe(false);
    expect(isPlayKey(ev("Meta", "MetaRight", { metaKey: true, altKey: true }), true)).toBe(false);
    expect(isPlayKey(ev("Meta", "MetaRight", { metaKey: true, ctrlKey: true }), true)).toBe(false);
  });
  it("letters are not Play keys", () => {
    expect(isPlayKey(ev("g", "KeyG"), true)).toBe(false);
  });
});

describe("spaceIsCue", () => {
  const space = (mods = {}) => ev(" ", "Space", mods);
  it("a bare Space is Cue", () => {
    expect(spaceIsCue(space(), null)).toBe(true);
  });
  it("Space's auto-repeat under a held Option stays Cue", () => {
    expect(spaceIsCue(space({ altKey: true }), "AltLeft")).toBe(true);
  });
  it("Space's auto-repeat under the right Command key held as Play stays Cue", () => {
    expect(spaceIsCue(space({ metaKey: true }), "MetaRight")).toBe(true);
  });
  it("Space with Command held for anything else is not ours", () => {
    expect(spaceIsCue(space({ metaKey: true }), null)).toBe(false);
    expect(spaceIsCue(space({ metaKey: true }), "AltLeft")).toBe(false);
  });
  it("Ctrl or Shift makes it not ours", () => {
    expect(spaceIsCue(space({ ctrlKey: true }), null)).toBe(false);
    expect(spaceIsCue(space({ shiftKey: true }), null)).toBe(false);
  });
  it("only Space is Cue's", () => {
    expect(spaceIsCue(ev("k", "KeyK"), null)).toBe(false);
  });
});
