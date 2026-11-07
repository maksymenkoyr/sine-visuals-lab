import { addLook, releaseFreeLook, setMoveKey, type MoveKey } from "../render/freeLook.ts";

/**
 * The mouse and the keys for walking through a scene like in a game; the
 * camera's half is src/render/freeLook.ts. In a scene whose card says
 * `freeLook`, a click on the picture locks the pointer to it: the mouse then
 * looks round, the keys in MOVE_KEYS walk, climb and sink, and Esc, the
 * browser's own way out of a pointer lock, stops.
 *
 * While walking, the keys in MOVE_KEYS are the walk's: claimed in the capture
 * phase ahead of every other key handler (app.ts installs this before its Cue
 * keys), so a held effect, the panel, Cue or a scene's arrows never also hear
 * them. Every other key keeps its job, and a key with Cmd, Ctrl or Option
 * held is never the walk's, so shortcuts pass. Physical keys (`code`), so
 * another layout walks with the same fingers.
 *
 * Whether a browser also hands the page the Esc that ends a pointer lock
 * varies; one that did would have app.ts leave the scene, so an Esc while
 * walking or within ESC_GRACE_MS after goes no further.
 *
 * Nothing here hears the scene change while the mouse is still: the walk
 * stops on the first mouse move or key after a pad, the Set or the gallery
 * took the scene away.
 */

const MOVE_KEYS: Readonly<Record<string, MoveKey>> = {
  KeyW: "forward",
  ArrowUp: "forward",
  KeyS: "back",
  ArrowDown: "back",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  Space: "up",
  ShiftLeft: "down",
  ShiftRight: "down",
};

/** The mouse and MOVE_KEYS in words, a line each in the HUD (app.ts) and
 *  one sentence in the keys list (keyHints.ts). Short lines: the HUD sits
 *  left of the effect buttons. */
export const WALK_KEYS: readonly string[] = ["the mouse looks round", "W A S D or the arrows walk", "Space goes up, ⇧ down", "Esc stops"];

/** Radians of turn per pixel of mouse travel. */
const LOOK_PER_PX = 0.0022;
/** Some browsers report one huge jump in the first moves after a lock; a
 *  move longer than this, px, is that jump, not a hand. */
const SPIKE_PX = 300;
const ESC_GRACE_MS = 250;

export interface FreeLookOptions {
  /** The picture: a click on it starts the walk, and the pointer locks to it. */
  canvas: HTMLCanvasElement;
  /** Whether the scene on screen can be walked through now. */
  enabled(): boolean;
  onStart?(): void;
  /** The browser refused the lock: Chrome does for a moment after an Esc. */
  onRefused?(): void;
}

export function wireFreeLook(opts: FreeLookOptions): void {
  const { canvas } = opts;
  const codes = new Set<string>();
  let walking = false;
  let endedAt = -Infinity;

  function letGoKeys(): void {
    codes.clear();
    releaseFreeLook();
  }

  function stillWanted(): boolean {
    if (opts.enabled()) return true;
    document.exitPointerLock();
    return false;
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0 || walking || !opts.enabled()) return;
    // A promise in Chrome, nothing in Safari; a refusal also fires pointerlockerror.
    const asked: unknown = canvas.requestPointerLock();
    if (asked instanceof Promise) asked.catch(() => {});
  });
  document.addEventListener("pointerlockerror", () => opts.onRefused?.());
  document.addEventListener("pointerlockchange", () => {
    const now = document.pointerLockElement === canvas;
    if (now === walking) return;
    walking = now;
    letGoKeys();
    if (now) opts.onStart?.();
    else endedAt = performance.now();
  });

  window.addEventListener(
    "pointermove",
    (e) => {
      if (!walking) return;
      // Nothing else wants a locked pointer's moves: the chrome would wake on each.
      e.stopPropagation();
      if (!stillWanted()) return;
      if (Math.abs(e.movementX) > SPIKE_PX || Math.abs(e.movementY) > SPIKE_PX) return;
      addLook(e.movementX * LOOK_PER_PX, -e.movementY * LOOK_PER_PX);
    },
    true,
  );

  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") {
        if (!walking && performance.now() - endedAt > ESC_GRACE_MS) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (walking) document.exitPointerLock();
        return;
      }
      const move = MOVE_KEYS[e.code];
      if (!walking || !move || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!stillWanted()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      codes.add(e.code);
      setMoveKey(move, true);
    },
    true,
  );

  window.addEventListener(
    "keyup",
    (e) => {
      // macOS sends no key-up for a key let go while Command is down.
      if (e.key === "Meta") {
        letGoKeys();
        return;
      }
      if (!codes.delete(e.code)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const move = MOVE_KEYS[e.code];
      setMoveKey(move, [...codes].some((c) => MOVE_KEYS[c] === move));
    },
    true,
  );

  window.addEventListener("blur", letGoKeys);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) letGoKeys();
  });
}
