import type { OutputBridge, OutputStatus } from "../net/outputBridge.ts";
import { createPlayKey, glideMsForHold, PLAY_TAP_MAX_MS } from "./outputKeys.ts";

/**
 * The on-screen half of the pop-out output (index.html's #outBtn in the
 * scene-nav row, and #outBar — CUE, PLAY and the state line — top centre,
 * round pads after a CDJ's, CUE orange and PLAY green; the keys are
 * src/ui/outputKeys.ts).
 *
 * POP OUT opens (or focuses) the output window. Once one is alive the bar
 * appears, and works like a DJ mixer's Cue and Play: the output window is the
 * master and keeps its look however the main window is tuned. HOLD CUE to put
 * the main window's look on the master — only while it's held; let go and the
 * master goes back to what it had. PLAY makes the main window's look the
 * master's for good (a longer hold glides there — see net/outputGlide.ts).
 * The state line says which it is (net/outputSync.ts's createCueController).
 * Hidden outside a scene, like the other chrome.
 *
 * The same bar serves the room's Main (net/roomBridge.ts): with no pop-out
 * open there is no Cue, so CUE is hidden (`status.canCue`) and the state line
 * reads MAIN = YOURS / MAIN ≠ YOURS instead of the pop-out's OUT wording. When
 * someone else played over unplayed edits it reads MAIN CHANGED BY <NAME> and
 * TAKE MAIN (#takeBtn, optional in the markup) drops the edits and shows Main.
 *
 * PLAY also answers a pointer, for a touch screen with no keyboard: a tap
 * sends at once, holding charges the fill and glides on release, exactly as a
 * held Play key does (outputKeys.ts's createPlayKey, glideMsForHold). Sliding
 * off the button cancels.
 *
 * Press feedback lives here too: a Play key or click flashes PLAY (`pressed`),
 * CUE stays lit while it's held, PLAY's ring blinks while the output differs
 * (`differs`), a held Play key draws an arc round PLAY while it charges
 * (`charging`, the `--charge` arc) and a glide in flight draws it round again
 * over its length.
 *
 * The key name under PLAY's pad is Option, Play's key everywhere (index.html);
 * on a Mac labelPlayKey switches it to the right Command key, the thumb key
 * next to Space (outputKeys.ts's header says why both play).
 */

export interface OutputControlElements {
  popBtn: HTMLButtonElement;
  cueBtn: HTMLButtonElement;
  goBtn: HTMLButtonElement;
  /** "TAKE MAIN", shown with the state line while Main changed under unplayed
   *  edits. Optional: the bar works without it. */
  takeBtn?: HTMLButtonElement | null;
  stateEl: HTMLElement;
  /** Holds cueBtn/goBtn/stateEl; marked `attn` while something needs eyes
   *  even when the rest of the chrome has faded. */
  barEl: HTMLElement;
}

/** What a Play did: `sent` = at once, `glide` = arriving over the asked time. */
export type PlayResult = "sent" | "glide" | null;

export interface OutputControls {
  /** Show the row only while a scene is on screen. */
  setVisible(visible: boolean): void;
  /** True when the keys mean something: a scene is up and an output is open. */
  active(): boolean;
  /** True when Cue means something: `active()` and a pop-out is open. */
  cueActive(): boolean;
  /** Keyboard paths — no-ops (null/false) unless an output window is open.
   *  `glideMs` > 0 asks for a smooth arrival; a scene change ignores it. */
  go(glideMs?: number): PlayResult;
  /** Cue down (true) or up (false): the preview is on the output only while
   *  it's down. Idempotent; false when no output is open (an up still lets go). */
  holdCue(on: boolean): boolean;
  /** While a Play key is held: how long, or null when it isn't (clears the charge). */
  charge(holdMs: number | null): void;
  /** Called after every Play that reached an output, whichever way it was
   *  pressed (key, button, or app.ts's Autopilot) — the Set card's "live"
   *  marker follows it. */
  onPlay(cb: () => void): void;
}

const FLASH_MS = 220;
/** A hold this long fills PLAY completely (longer still keeps counting up). */
const CHARGE_FULL_MS = 15_000;

function fmtSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

/** On a Mac, PLAY names the right Command key instead of Option: the key name
 *  under its pad and its tooltip. */
export function labelPlayKey(goBtn: HTMLButtonElement, mac: boolean): void {
  if (!mac) return;
  const keyName = goBtn.querySelector("small");
  if (keyName) keyName.textContent = "RIGHT ⌘";
  goBtn.title =
    "Send this scene and its settings to the output — tap the right ⌘ to send at once, hold it to glide there (Option does the same)";
}

export function createOutputControls(bridge: OutputBridge, els: OutputControlElements): OutputControls {
  const { popBtn, cueBtn, goBtn, stateEl, barEl } = els;
  const takeBtn = els.takeBtn ?? null;
  let visible = false;
  let status: OutputStatus = bridge.status();
  let holdMs: number | null = null;
  let glideEnd = 0;
  let glideLen = 0;
  let glideRaf = 0;
  const playListeners: Array<() => void> = [];

  function flash(btn: HTMLElement): void {
    btn.classList.add("pressed");
    window.setTimeout(() => btn.classList.remove("pressed"), FLASH_MS);
  }

  function gliding(): boolean {
    return glideEnd > performance.now();
  }

  function stateText(s: OutputStatus): string {
    if (holdMs !== null) {
      const g = glideMsForHold(holdMs);
      return g === null ? "RELEASE TO SEND" : `RELEASE TO GLIDE ${fmtSeconds(g)}`;
    }
    if (gliding()) return `GLIDING — ${fmtSeconds(Math.max(0, glideEnd - performance.now()))} LEFT`;
    if (s.cue) return "CUE — PREVIEW ON OUTPUT";
    if (s.changedBy) return `MAIN CHANGED BY ${s.changedBy.toUpperCase()}`;
    // With a pop-out open it is the pop-out's program being compared; without
    // one, the room's Main.
    if (s.canCue) return s.differs ? "OUT ≠ PREVIEW — PLAY TO SEND" : "OUT = PREVIEW";
    return s.differs ? "MAIN ≠ YOURS — PLAY TO SEND" : "MAIN = YOURS";
  }

  function render(s: OutputStatus): void {
    status = s;
    popBtn.style.display = visible ? "block" : "none";
    // The pop-out's own state, not the bar's: `open` is also true while only
    // the room's other devices are there, and that is no window to bring up.
    // A pop-out that is open is the one output that can cue (`canCue`).
    const popOpen = s.canCue;
    popBtn.textContent = popOpen ? "OUTPUT ●" : "POP OUT";
    popBtn.setAttribute("aria-pressed", String(popOpen));
    popBtn.title = popOpen ? "Output window is open — click to bring it to the front" : "Open the scene in its own window for a second screen or projector";
    const show = visible && s.open;
    cueBtn.style.display = show && s.canCue ? "block" : "none";
    goBtn.style.display = show ? "block" : "none";
    if (takeBtn) takeBtn.style.display = show && s.changedBy ? "block" : "none";
    stateEl.style.display = show ? "block" : "none";
    cueBtn.setAttribute("aria-pressed", String(s.cue));
    goBtn.classList.toggle("differs", s.differs);
    goBtn.classList.toggle("charging", holdMs !== null);
    goBtn.classList.toggle("gliding", gliding());
    stateEl.classList.toggle("differs", s.differs);
    stateEl.classList.toggle("charging", holdMs !== null || gliding());
    barEl.classList.toggle("attn", show && (s.cue || s.differs || !!s.changedBy || holdMs !== null || gliding()));
    stateEl.textContent = stateText(s);
  }

  function tickGlide(): void {
    const now = performance.now();
    if (now >= glideEnd) {
      glideRaf = 0;
      goBtn.style.removeProperty("--charge");
      render(status);
      return;
    }
    goBtn.style.setProperty("--charge", String(1 - (glideEnd - now) / glideLen));
    render(status);
    glideRaf = requestAnimationFrame(tickGlide);
  }

  function startGlideIndicator(ms: number): void {
    glideLen = ms;
    glideEnd = performance.now() + ms;
    if (!glideRaf) glideRaf = requestAnimationFrame(tickGlide);
  }

  function active(): boolean {
    return visible && bridge.status().open;
  }

  function go(glideMs?: number): PlayResult {
    if (!active()) return null;
    flash(goBtn);
    const glided = bridge.go(glideMs);
    if (glided && glideMs) startGlideIndicator(glideMs);
    else glideEnd = 0;
    render(bridge.status());
    for (const cb of playListeners) cb();
    return glided ? "glide" : "sent";
  }

  function cueActive(): boolean {
    return active() && bridge.status().canCue;
  }

  function holdCue(on: boolean): boolean {
    if (!on) {
      if (bridge.status().cue) bridge.setCue(false);
      return false;
    }
    if (!cueActive()) return false;
    if (!bridge.status().cue) bridge.setCue(true);
    return true;
  }

  popBtn.addEventListener("click", () => bridge.open());
  // Held, not toggled: pointer capture keeps the release coming even if the
  // pointer slides off the button while it's down.
  cueBtn.addEventListener("pointerdown", (e) => {
    cueBtn.setPointerCapture(e.pointerId);
    holdCue(true);
  });
  cueBtn.addEventListener("pointerup", () => holdCue(false));
  cueBtn.addEventListener("pointercancel", () => holdCue(false));

  // PLAY under a pointer is a Play key held: down starts the charge, up decides
  // tap or glide. The click that follows a handled press is swallowed; a
  // keyboard activation (Enter on the focused button) has no press and still sends.
  const pointerKey = createPlayKey();
  let pointerRaf = 0;
  let pressHandled = false;

  function pointerCharge(): void {
    const ms = pointerKey.holdMs(performance.now());
    if (ms === null) {
      pointerRaf = 0;
      return;
    }
    // Inside the tap window nothing shows yet: a tap must not flicker a charge.
    controls.charge(ms >= PLAY_TAP_MAX_MS ? ms : null);
    pointerRaf = requestAnimationFrame(pointerCharge);
  }

  function endPointerHold(): number | null {
    const ms = pointerKey.up(performance.now());
    if (pointerRaf) cancelAnimationFrame(pointerRaf);
    pointerRaf = 0;
    controls.charge(null);
    return ms;
  }

  goBtn.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    pressHandled = false;
    pointerKey.down(performance.now());
    if (!pointerRaf) pointerRaf = requestAnimationFrame(pointerCharge);
  });
  goBtn.addEventListener("pointerup", () => {
    if (pointerKey.holdMs(performance.now()) === null) return;
    const ms = endPointerHold();
    pressHandled = true;
    window.setTimeout(() => (pressHandled = false), 400);
    if (ms !== null) go(glideMsForHold(ms) ?? undefined);
  });
  const cancelPointerHold = (): void => {
    if (pointerKey.holdMs(performance.now()) === null) return;
    endPointerHold();
  };
  goBtn.addEventListener("pointercancel", cancelPointerHold);
  goBtn.addEventListener("pointerleave", cancelPointerHold);
  goBtn.addEventListener("click", () => {
    if (pressHandled) {
      pressHandled = false;
      return;
    }
    go();
  });
  takeBtn?.addEventListener("click", () => bridge.take?.());
  bridge.onStatus(render);
  render(status);

  const controls: OutputControls = {
    setVisible(v) {
      visible = v;
      render(bridge.status());
    },
    active,
    cueActive,
    go,
    holdCue,
    onPlay: (cb) => void playListeners.push(cb),
    charge(ms) {
      holdMs = ms;
      // A glide in flight owns the fill; only a hold that's really charging takes it over.
      if (ms === null) {
        if (!gliding()) goBtn.style.removeProperty("--charge");
      } else goBtn.style.setProperty("--charge", String(Math.min(1, ms / CHARGE_FULL_MS)));
      render(bridge.status());
    },
  };
  return controls;
}
