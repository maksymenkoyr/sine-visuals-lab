/**
 * The desk: the main window's layout while a pop-out output is open (issue
 * #617, plans/controls-first.md). The scene canvas is the NEXT monitor at the
 * top left; the Cue/Play bar sits in the column beside it; an empty LIVE slot
 * is at the top right; the controls panel runs below that row (deskTheme.ts).
 *
 * app.ts loads this module the first time an output opens, so the first paint
 * pays nothing for it. It only moves the existing Cue/Play bar (#outBar) into
 * its column and back, and adds its own #desk element; everything else it
 * shows is either the canvas itself or one of the panel's cards.
 */
import { getSceneTransition, setSceneTransition, type SceneTransition } from "../../render/sceneTransition.ts";
import { ensureDeskStyles } from "./deskTheme.ts";

export interface DeskDeps {
  /** Opens the controls panel if it is shut (deviceMenu.toggle when !isOpen). */
  openPanel(): void;
  /** "128 BPM", or "-- BPM" with no tempo. */
  bpmText(): string;
}

export interface Desk {
  setActive(on: boolean): void;
  active(): boolean;
  /** Once per render tick; cheap. */
  tick(nowMs: number): void;
  /** The Play column's list element, filled by a later part (playList.ts). */
  listEl: HTMLElement;
  /** The Play column's count badge. */
  countEl: HTMLElement;
  /** The LIVE slot, filled by a later part (liveMonitor.ts). */
  liveSlot: HTMLElement;
}

/** Refresh cadence for the BPM readout and the fade chips' lit state; the
 *  scene list can change the transition from outside the desk. */
const REFRESH_MS = 250;

interface FadeChip {
  label: string;
  patch: Partial<SceneTransition>;
  lit: (t: SceneTransition) => boolean;
  el?: HTMLButtonElement;
}

const FADE_CHIPS: FadeChip[] = [
  { label: "Cut", patch: { style: "cut" }, lit: (t) => t.style === "cut" },
  { label: "Fade 1 bar", patch: { style: "fade", bars: 1 }, lit: (t) => t.style === "fade" && t.bars === 1 },
  { label: "Fade 4 bars", patch: { style: "fade", bars: 4 }, lit: (t) => t.style === "fade" && t.bars === 4 },
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createDesk(deps: DeskDeps): Desk {
  ensureDeskStyles();

  const root = el("div");
  root.id = "desk";

  const bar = el("div", "desk-bar");
  const bpm = el("span", "desk-bpm");
  bar.appendChild(bpm);

  const nextTag = el("span", "desk-tag desk-tag-next", "NEXT");

  const top = el("div", "desk-top");

  const nextMon = el("div", "desk-mon next");
  nextMon.appendChild(el("div", "desk-slot"));
  nextMon.appendChild(el("div", "desk-pic"));

  const mid = el("div", "desk-mid");
  const head = el("div", "desk-mid-head");
  head.appendChild(el("span", undefined, "PLAY WILL CHANGE"));
  const countEl = el("span", "desk-count");
  head.appendChild(countEl);
  const listEl = el("ul", "desk-list");
  listEl.appendChild(el("li", "desk-empty", "LIVE shows NEXT. Move a fader below and it lands here."));
  const keys = el("div", "desk-keys");
  const fade = el("div", "desk-fade");
  fade.appendChild(el("span", undefined, "PLAY LANDS"));
  for (const chip of FADE_CHIPS) {
    const b = el("button", "desk-chip", chip.label);
    b.type = "button";
    b.addEventListener("click", () => {
      setSceneTransition(chip.patch);
      refreshChips();
    });
    chip.el = b;
    fade.appendChild(b);
  }
  mid.append(head, listEl, keys, fade);

  const liveMon = el("div", "desk-mon live");
  const liveSlot = el("div", "desk-slot live");
  liveSlot.appendChild(el("span", "desk-tag", "LIVE"));
  liveMon.append(liveSlot, el("div", "desk-pic"));

  top.append(nextMon, mid, liveMon);
  root.append(bar, nextTag, top);

  let active = false;
  let nextRefreshMs = 0;
  let outBarHome: { parent: Node; next: Node | null } | null = null;

  function refreshChips(): void {
    const t = getSceneTransition();
    for (const chip of FADE_CHIPS) chip.el?.classList.toggle("on", chip.lit(t));
  }

  function setActive(on: boolean): void {
    if (on === active) return;
    active = on;
    nextRefreshMs = 0;
    const outBar = document.getElementById("outBar");
    if (on) {
      if (outBar && outBar.parentNode) {
        outBarHome = { parent: outBar.parentNode, next: outBar.nextSibling };
        keys.appendChild(outBar);
      }
      document.body.classList.add("desk");
      document.documentElement.classList.add("vc-desk");
      deps.openPanel();
    } else {
      if (outBar && outBarHome) outBarHome.parent.insertBefore(outBar, outBarHome.next);
      outBarHome = null;
      document.body.classList.remove("desk");
      document.documentElement.classList.remove("vc-desk");
    }
  }

  function tick(nowMs: number): void {
    if (!active || nowMs < nextRefreshMs) return;
    nextRefreshMs = nowMs + REFRESH_MS;
    const text = deps.bpmText();
    if (bpm.textContent !== text) bpm.textContent = text;
    refreshChips();
  }

  document.body.appendChild(root);

  return {
    setActive,
    active: () => active,
    tick,
    listEl,
    countEl,
    liveSlot,
  };
}
