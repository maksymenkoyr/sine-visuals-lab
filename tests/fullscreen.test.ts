import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createImmersiveMode, isFullscreen } from "../src/ui/fullscreen.ts";

// ui/fullscreen.ts reads the page through `document` and `window`, which the
// node env lacks, so each test builds one from EventTargets: a body whose
// classes are a set, and a Fullscreen API that grants a request only inside a
// gesture, as browsers do (`tap` and `key` below are the gestures).
function fakePage(supported: boolean) {
  const classes = new Set<string>();
  let inGesture = false;
  let refuse = false;
  const root = { requestFullscreen: vi.fn() };
  const doc = Object.assign(new EventTarget(), {
    fullscreenEnabled: supported,
    fullscreenElement: null as unknown,
    documentElement: root,
    body: {
      classList: {
        add: (c: string) => void classes.add(c),
        remove: (c: string) => void classes.delete(c),
        contains: (c: string) => classes.has(c),
      },
    },
    exitFullscreen: vi.fn(async () => {}),
  });
  root.requestFullscreen.mockImplementation(async () => {
    if (!inGesture || refuse) throw new TypeError("Permissions check failed");
    doc.fullscreenElement = root;
    doc.dispatchEvent(new Event("fullscreenchange"));
  });
  const win = Object.assign(new EventTarget(), {
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: number) => clearTimeout(id),
  });
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);

  const gesture = (...types: string[]) => {
    inGesture = true;
    for (const t of types) win.dispatchEvent(new Event(t));
    inGesture = false;
  };
  const mode = createImmersiveMode({
    button: { textContent: "", setAttribute() {} } as unknown as HTMLElement,
    isMenuOpen: () => false,
  });
  return {
    mode,
    request: root.requestFullscreen,
    chromeHidden: () => classes.has("chrome-idle"),
    tap: () => gesture("pointerdown", "pointerup", "click"),
    key: () => gesture("keydown"),
    refuse(on: boolean) {
      refuse = on;
    },
    /** The user leaves fullscreen through the browser (Esc, the back gesture). */
    userExits() {
      doc.fullscreenElement = null;
      doc.dispatchEvent(new Event("fullscreenchange"));
    },
  };
}

describe("enterHidden", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("hides the chrome at once and asks for fullscreen on the first tap", () => {
    const page = fakePage(true);
    page.mode.enterHidden();
    expect(page.mode.active()).toBe(true);
    expect(page.chromeHidden()).toBe(true);
    expect(page.request).not.toHaveBeenCalled();

    page.tap();
    expect(page.request).toHaveBeenCalledTimes(1);
    expect(isFullscreen()).toBe(true);
    // The tap also shows the controls for a while, as in any immersed page.
    expect(page.chromeHidden()).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(page.chromeHidden()).toBe(true);
  });

  it("asks again on each tap until fullscreen is granted, then stops", () => {
    const page = fakePage(true);
    page.mode.enterHidden();
    page.refuse(true);
    page.tap();
    expect(isFullscreen()).toBe(false);
    expect(page.mode.active()).toBe(true);
    page.refuse(false);
    page.key();
    expect(page.request).toHaveBeenCalledTimes(2);
    expect(isFullscreen()).toBe(true);
    page.tap();
    expect(page.request).toHaveBeenCalledTimes(2);
  });

  it("leaves immersion, and stops asking, once the user leaves fullscreen", () => {
    const page = fakePage(true);
    page.mode.enterHidden();
    page.tap();
    page.userExits();
    expect(page.mode.active()).toBe(false);
    expect(page.chromeHidden()).toBe(false);
    page.tap();
    expect(page.request).toHaveBeenCalledTimes(1);
  });

  it("only hides the chrome where the page can't go fullscreen (iPhone Safari)", () => {
    const page = fakePage(false);
    page.mode.enterHidden();
    expect(page.chromeHidden()).toBe(true);
    page.tap();
    expect(page.request).not.toHaveBeenCalled();
    expect(page.mode.active()).toBe(true);
  });
});
