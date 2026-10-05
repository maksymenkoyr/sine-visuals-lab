import {
  RECORD_ASPECTS,
  RECORD_ASPECT_LABELS,
  RECORD_ASPECT_DEFAULT,
  formatElapsed,
  nextRecordAspect,
  parseRecordAspect,
  type RecordAspect,
} from "./clipFormat.ts";
import type { ClipRecorder } from "./clipRecorder.ts";

/**
 * The on-screen half of the clip recorder (index.html's #recBtn and
 * #recAspectBtn, in the scene-nav row beside POP OUT, where a performer
 * already looks for the output): RECORD starts and stops a take, and while one
 * runs the button shows a red dot and the elapsed time. The button next to it
 * says what shape the clip has (Screen, 9:16, 1:1) and cycles on a click;
 * it is locked during a take. What is recorded and how it ends is
 * clipRecorder.ts. Recording has no keyboard shortcut on purpose.
 *
 * The shape is remembered on this device only: `vibe.recordAspect` is in
 * net/syncedStores.ts's PRIVATE_KEYS, so it never reaches the pop-out window
 * or a room's TV. Hidden outside a scene, like the other chrome.
 */

const STORAGE_KEY = "vibe.recordAspect";
/** How often the elapsed time is redrawn while recording. */
const TICK_MS = 250;

export function loadRecordAspect(): RecordAspect {
  try {
    return parseRecordAspect(localStorage.getItem(STORAGE_KEY));
  } catch {
    return RECORD_ASPECT_DEFAULT;
  }
}

function saveRecordAspect(a: RecordAspect): void {
  try {
    localStorage.setItem(STORAGE_KEY, a);
  } catch {
    // Not fatal — the choice just won't persist across reloads.
  }
}

export interface RecordControlElements {
  recBtn: HTMLButtonElement;
  aspectBtn: HTMLButtonElement;
}

export interface RecordControls {
  /** The shape the next take will have. */
  aspect(): RecordAspect;
  /** Show the buttons only while a scene is on screen; hiding ends a take. */
  setVisible(visible: boolean): void;
  /** The recorder changed state: redraw. */
  refresh(): void;
}

export function createRecordControls(recorder: () => ClipRecorder, els: RecordControlElements): RecordControls {
  const { recBtn, aspectBtn } = els;
  let aspect = loadRecordAspect();
  let visible = false;
  let tick = 0;

  function render(): void {
    const rec = recorder().recording();
    recBtn.style.display = visible ? "block" : "none";
    aspectBtn.style.display = visible ? "block" : "none";
    recBtn.classList.toggle("recording", rec);
    recBtn.setAttribute("aria-pressed", String(rec));
    recBtn.title = rec ? "Stop recording and save the clip" : "Record a clip of the visuals with the sound, saved when you stop";
    if (rec) {
      const dot = document.createElement("span");
      dot.className = "recDot";
      recBtn.replaceChildren(dot, ` ${formatElapsed(recorder().elapsedMs())}`);
    } else {
      recBtn.textContent = "RECORD";
    }
    aspectBtn.textContent = RECORD_ASPECT_LABELS[aspect].toUpperCase();
    aspectBtn.disabled = rec;
    aspectBtn.title = `Shape of the clip: ${RECORD_ASPECTS.map((a) => RECORD_ASPECT_LABELS[a]).join(", ")} — click to change (9:16 and 1:1 crop the middle)`;
    if (rec && !tick) tick = window.setInterval(render, TICK_MS);
    if (!rec && tick) {
      window.clearInterval(tick);
      tick = 0;
    }
  }

  recBtn.addEventListener("click", () => {
    recorder().toggle();
    render();
  });
  aspectBtn.addEventListener("click", () => {
    if (recorder().recording()) return;
    aspect = nextRecordAspect(aspect);
    saveRecordAspect(aspect);
    render();
  });
  render();

  return {
    aspect: () => aspect,
    setVisible(v) {
      visible = v;
      if (!v) recorder().stop();
      render();
    },
    refresh: render,
  };
}
