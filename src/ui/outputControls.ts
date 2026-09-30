import type { OutputBridge, OutputStatus } from "../net/outputBridge.ts";

/**
 * The scene-nav buttons for the pop-out output window (index.html's
 * #outBtn/#cueBtn/#goBtn/#outState, in the same row as GALLERY/STOP MIC —
 * styled by that row's own rules, so they fade with the rest of the chrome).
 *
 * POP OUT opens (or focuses) the output window. Once one is alive the row
 * grows CUE, GO and a state chip: CUE holds the output while the main window
 * keeps tuning, GO sends the main window's look across, and the chip says
 * whether the output currently matches the preview. What Cue/Go mean and how
 * the state is compared lives in net/outputSync.ts; the window itself in
 * src/output.ts. Hidden outside a scene, like the other buttons in the row.
 */

export interface OutputControlElements {
  popBtn: HTMLButtonElement;
  cueBtn: HTMLButtonElement;
  goBtn: HTMLButtonElement;
  stateEl: HTMLElement;
}

export interface OutputControls {
  /** Show the row only while a scene is on screen. */
  setVisible(visible: boolean): void;
  /** Keyboard paths — no-ops unless an output window is open. */
  go(): boolean;
  toggleCue(): boolean;
}

export function createOutputControls(bridge: OutputBridge, els: OutputControlElements): OutputControls {
  const { popBtn, cueBtn, goBtn, stateEl } = els;
  let visible = false;

  function render(s: OutputStatus): void {
    popBtn.style.display = visible ? "block" : "none";
    popBtn.textContent = s.open ? "OUTPUT ●" : "POP OUT";
    popBtn.setAttribute("aria-pressed", String(s.open));
    popBtn.title = s.open ? "Output window is open — click to bring it to the front" : "Open the scene in its own window for a second screen or projector";
    const show = visible && s.open;
    cueBtn.style.display = show ? "block" : "none";
    goBtn.style.display = show ? "block" : "none";
    stateEl.style.display = show ? "inline" : "none";
    cueBtn.setAttribute("aria-pressed", String(s.cue));
    goBtn.classList.toggle("differs", s.differs);
    stateEl.classList.toggle("differs", s.differs);
    stateEl.textContent = s.differs ? "OUT ≠ PREVIEW" : "OUT = PREVIEW";
  }

  popBtn.addEventListener("click", () => bridge.open());
  cueBtn.addEventListener("click", () => bridge.setCue(!bridge.status().cue));
  goBtn.addEventListener("click", () => bridge.go());
  bridge.onStatus(render);
  render(bridge.status());

  return {
    setVisible(v) {
      visible = v;
      render(bridge.status());
    },
    go() {
      if (!visible || !bridge.status().open) return false;
      bridge.go();
      return true;
    },
    toggleCue() {
      if (!visible || !bridge.status().open) return false;
      bridge.setCue(!bridge.status().cue);
      return true;
    },
  };
}
