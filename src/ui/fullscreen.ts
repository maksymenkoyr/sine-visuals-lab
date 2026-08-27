/** Cross-browser Fullscreen API + "immersed" chrome-hiding state machine.
 *
 *  Safari (desktop and — for `fullscreenEnabled`/`fullscreenElement` — iPad)
 *  still needs the `webkit`-prefixed names; iPhone Safari exposes none of
 *  this at all for non-video elements, so `fullscreenSupported()` is false
 *  there and callers fall back to a chrome-hiding-only "immersed" look.
 */

interface PrefixedFullscreenDoc extends Document {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}

interface PrefixedFullscreenEl extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

export function fullscreenSupported(): boolean {
  const d = document as PrefixedFullscreenDoc;
  return !!(d.fullscreenEnabled ?? d.webkitFullscreenEnabled);
}

export function isFullscreen(): boolean {
  const d = document as PrefixedFullscreenDoc;
  return !!(d.fullscreenElement ?? d.webkitFullscreenElement);
}

// Both requests can legitimately reject — most commonly a race with the
// browser's own native Escape handling (it may exit fullscreen on the same
// keypress that triggers our exit() call, so ours lands on an element that's
// already left fullscreen). Not fatal either way: `fullscreenchange` is what
// actually drives our state, not the resolution of these calls.
async function requestFullscreen(el: HTMLElement): Promise<void> {
  try {
    const e = el as PrefixedFullscreenEl;
    await (e.requestFullscreen ? e.requestFullscreen() : e.webkitRequestFullscreen?.());
  } catch {
    // ignored — see comment above
  }
}

async function exitFullscreen(): Promise<void> {
  try {
    const d = document as PrefixedFullscreenDoc;
    await (d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.());
  } catch {
    // ignored — see comment above
  }
}

export interface ImmersiveMode {
  toggle(): void;
  exit(): void;
  active(): boolean;
  /** Leaving the viz for the gallery: stop idle-hiding and show chrome again.
   *  Real browser fullscreen (if any) is left alone. */
  pause(): void;
  /** Back in a viz: resume idle-hiding if immersion is still active. */
  resume(): void;
}

const IDLE_MS = 3000;
const BTN_INACTIVE = { glyph: "⛶", label: "Enter fullscreen" }; // ⛶
const BTN_ACTIVE = { glyph: "⤡", label: "Exit fullscreen" }; // ⤡

export function createImmersiveMode(deps: {
  button: HTMLElement;
  isMenuOpen: () => boolean;
}): ImmersiveMode {
  const { button, isMenuOpen } = deps;

  /** Tracks our own concept of "immersed" — true in real fullscreen, and
   *  also true on the chrome-hiding-only fallback where the API is missing. */
  let immersed = false;
  let paused = false;
  let idleTimer: number | undefined;

  function setButtonState(): void {
    const state = immersed ? BTN_ACTIVE : BTN_INACTIVE;
    button.textContent = state.glyph;
    button.setAttribute("aria-label", state.label);
    button.setAttribute("aria-pressed", String(immersed));
  }

  function wake(): void {
    document.body.classList.remove("chrome-idle");
    scheduleIdle();
  }

  function scheduleIdle(): void {
    window.clearTimeout(idleTimer);
    if (!immersed || paused) return;
    idleTimer = window.setTimeout(() => {
      if (isMenuOpen()) {
        scheduleIdle(); // menu's up — don't hide the button out from under it
        return;
      }
      document.body.classList.add("chrome-idle");
    }, IDLE_MS);
  }

  function addIdleListeners(): void {
    window.addEventListener("pointermove", wake);
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);
  }

  function removeIdleListeners(): void {
    window.removeEventListener("pointermove", wake);
    window.removeEventListener("pointerdown", wake);
    window.removeEventListener("keydown", wake);
    window.clearTimeout(idleTimer);
    document.body.classList.remove("chrome-idle");
  }

  function enter(): void {
    immersed = true;
    setButtonState();
    addIdleListeners();
    scheduleIdle();
    if (fullscreenSupported()) void requestFullscreen(document.documentElement);
  }

  function leave(): void {
    immersed = false;
    setButtonState();
    removeIdleListeners();
    if (isFullscreen()) void exitFullscreen();
  }

  // The user can also leave fullscreen via Esc or browser chrome — keep our
  // state (and the button glyph) truthful when that happens.
  const onFullscreenChange = () => {
    if (!isFullscreen() && immersed && fullscreenSupported()) leave();
  };
  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("webkitfullscreenchange", onFullscreenChange);

  return {
    toggle() {
      if (immersed) leave();
      else enter();
    },
    exit() {
      if (immersed) leave();
    },
    active() {
      return immersed;
    },
    pause() {
      paused = true;
      window.clearTimeout(idleTimer);
      document.body.classList.remove("chrome-idle");
    },
    resume() {
      paused = false;
      if (immersed) scheduleIdle();
    },
  };
}
