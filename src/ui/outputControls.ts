import type { OutputBridge, OutputStatus } from "../net/outputBridge.ts";
import { glideMsForHold } from "./outputKeys.ts";

/**
 * The on-screen half of the pop-out output (index.html's #outBtn in the
 * scene-nav row, and #outBar — CUE, PLAY and the state line — top centre,
 * big, CUE orange and PLAY green; the keys are src/ui/outputKeys.ts).
 *
 * POP OUT opens (or focuses) the output window. Once one is alive the bar
 * appears: CUE holds the output while the main window keeps tuning, PLAY
 * sends the main window's look across (a longer hold glides there — see
 * net/outputGlide.ts), and the state line says whether the output matches the
 * preview. Leaving CUE never sends anything by itself: the output keeps what
 * it had until PLAY (net/outputSync.ts's createCueController), and the line
 * reads "HOLDING — PRESS PLAY" meanwhile. Hidden outside a scene, like the
 * other chrome.
 *
 * Press feedback lives here too: every key or click flashes its button
 * (`pressed`), a held Option fills PLAY while it charges (`charging`, the
 * `--charge` fill) and a glide in flight fills it back up over its length.
 */

export interface OutputControlElements {
  popBtn: HTMLButtonElement;
  cueBtn: HTMLButtonElement;
  goBtn: HTMLButtonElement;
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
  /** Keyboard paths — no-ops (null/false) unless an output window is open.
   *  `glideMs` > 0 asks for a smooth arrival; a scene change ignores it. */
  go(glideMs?: number): PlayResult;
  toggleCue(): boolean;
  /** While Option is held: how long, or null when it isn't (clears the charge). */
  charge(holdMs: number | null): void;
}

const FLASH_MS = 220;
/** A hold this long fills PLAY completely (longer still keeps counting up). */
const CHARGE_FULL_MS = 15_000;

function fmtSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

export function createOutputControls(bridge: OutputBridge, els: OutputControlElements): OutputControls {
  const { popBtn, cueBtn, goBtn, stateEl, barEl } = els;
  let visible = false;
  let status: OutputStatus = bridge.status();
  let holdMs: number | null = null;
  let glideEnd = 0;
  let glideLen = 0;
  let glideRaf = 0;

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
    if (s.cue) return s.differs ? "CUE — OUTPUT HELD" : "CUE — OUTPUT HELD, NO CHANGES";
    if (s.waiting) return "HOLDING — PRESS PLAY";
    return s.differs ? "OUT ≠ PREVIEW" : "OUT = PREVIEW";
  }

  function render(s: OutputStatus): void {
    status = s;
    popBtn.style.display = visible ? "block" : "none";
    popBtn.textContent = s.open ? "OUTPUT ●" : "POP OUT";
    popBtn.setAttribute("aria-pressed", String(s.open));
    popBtn.title = s.open ? "Output window is open — click to bring it to the front" : "Open the scene in its own window for a second screen or projector";
    const show = visible && s.open;
    cueBtn.style.display = show ? "block" : "none";
    goBtn.style.display = show ? "block" : "none";
    stateEl.style.display = show ? "block" : "none";
    cueBtn.setAttribute("aria-pressed", String(s.cue));
    goBtn.classList.toggle("differs", s.differs || s.waiting);
    goBtn.classList.toggle("charging", holdMs !== null);
    goBtn.classList.toggle("gliding", gliding());
    stateEl.classList.toggle("differs", s.differs || s.waiting);
    stateEl.classList.toggle("charging", holdMs !== null || gliding());
    barEl.classList.toggle("attn", show && (s.cue || s.waiting || s.differs || holdMs !== null || gliding()));
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
    return glided ? "glide" : "sent";
  }

  function toggleCue(): boolean {
    if (!active()) return false;
    flash(cueBtn);
    bridge.setCue(!bridge.status().cue);
    return true;
  }

  popBtn.addEventListener("click", () => bridge.open());
  cueBtn.addEventListener("click", () => toggleCue());
  goBtn.addEventListener("click", () => go());
  bridge.onStatus(render);
  render(status);

  return {
    setVisible(v) {
      visible = v;
      render(bridge.status());
    },
    active,
    go,
    toggleCue,
    charge(ms) {
      holdMs = ms;
      // A glide in flight owns the fill; only a hold that's really charging takes it over.
      if (ms === null) {
        if (!gliding()) goBtn.style.removeProperty("--charge");
      } else goBtn.style.setProperty("--charge", String(Math.min(1, ms / CHARGE_FULL_MS)));
      render(bridge.status());
    },
  };
}
