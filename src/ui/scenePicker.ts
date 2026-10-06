import { BRAND_RED } from "./brandMark.ts";
import { FONT_LABEL, FONT_MONO, SCENE_VIOLET } from "./controlsTheme.ts";
import {
  TRANSITION_BARS,
  getSceneTransition,
  setSceneTransition,
  type SceneTransition,
  type TransitionStyle,
} from "../render/sceneTransition.ts";

/**
 * The scene list: the scene's name in the top-left row (`#sceneBtn` in
 * index.html) opens every scene in a drop-down, so a scene can be changed
 * without going back to the gallery. Same order as the gallery, the released
 * scenes first and the drafts under their own heading; one this device can't
 * run is shown but can't be picked, with the gallery's reason as its hint.
 * A filter box at the top takes the focus: typing narrows the list, the arrow
 * keys move through it, Enter picks and Escape closes (claimed in the capture
 * phase, so it doesn't also leave the scene — app.ts's Escape checks
 * defaultPrevented).
 *
 * The foot holds the transition (render/sceneTransition.ts): Cut or Fade, and
 * for a Fade its Length in bars. It applies to every scene change on this
 * screen and, through the synced stores, on the pop-out and a room's TV — not
 * only to picks from this list.
 *
 * app.ts owns what a pick does (the same applyScene a Set pad uses, so Cue and
 * Play see an ordinary scene change) and when the button shows. Like the
 * gallery this injects its own stylesheet: the rules need :hover and
 * :focus-visible.
 */

export interface ScenePickEntry {
  id: string;
  name: string;
  /** Listed under the Draft heading (scenes/index.ts's DRAFT_SCENE_IDS). */
  draft: boolean;
  /** Whether this device can run it; a disabled entry shows `reason`. */
  enabled: boolean;
  reason?: string;
}

export interface ScenePickerDeps {
  button: HTMLButtonElement;
  /** Every scene, in gallery order — read each time the list opens. */
  scenes: () => ScenePickEntry[];
  currentId: () => string;
  onPick: (id: string) => void;
}

export interface ScenePicker {
  /** Puts the current scene's name on the button. */
  setScene(name: string): void;
  isOpen(): boolean;
  close(): void;
}

/** The entries whose name contains every word of `query`, case-blind, in the
 *  order given. An empty query keeps them all. */
export function filterScenes<T extends { name: string }>(entries: readonly T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...entries];
  return entries.filter((e) => {
    const name = e.name.toLowerCase();
    return words.every((w) => name.includes(w));
  });
}

/** "½" for half a bar, the plain number otherwise. */
function barsLabel(bars: number): string {
  return bars === 0.5 ? "½" : String(bars);
}

const STYLE_ID = "scene-picker-styles";
const stylesheet = `
#sceneBtn .sp-btn-name {
  display: inline-block; max-width: 40vw; overflow: hidden; text-overflow: ellipsis; vertical-align: top;
}
#sceneBtn .sp-caret { margin-left: 6px; opacity: .6; vertical-align: top; }
#sceneBtn[aria-expanded="true"] { border-color: rgba(255,255,255,.55); color: #fff; }
.sp-pop {
  position: fixed; z-index: 35; display: none; flex-direction: column;
  width: min(280px, calc(100vw - 32px)); box-sizing: border-box;
  background: rgba(8,11,10,.78); border: 1px solid rgba(255,255,255,.18); border-radius: 3px;
  -webkit-backdrop-filter: blur(18px) saturate(.6) brightness(.5);
  backdrop-filter: blur(18px) saturate(.6) brightness(.5);
  box-shadow: 0 8px 28px rgba(0,0,0,.5);
  font: 400 13px/1.3 ${FONT_LABEL}; color: rgba(255,255,255,.86);
}
.sp-pop[data-open] { display: flex; }
.sp-filter {
  margin: 8px; padding: 7px 9px; border-radius: 2px; outline: none;
  background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.16);
  color: #fff; font: 400 12px/1.2 ${FONT_MONO}; letter-spacing: .06em;
}
.sp-filter:focus { border-color: rgba(255,255,255,.4); }
.sp-filter::placeholder { color: rgba(255,255,255,.35); }
.sp-list { list-style: none; margin: 0; padding: 0 0 6px; overflow-y: auto; min-height: 0; flex: 1 1 auto; }
.sp-head {
  margin: 8px 12px 4px; font: 400 10px/1 ${FONT_MONO}; letter-spacing: .18em; text-transform: uppercase;
  color: ${SCENE_VIOLET};
}
.sp-item {
  display: flex; align-items: center; gap: 8px; padding: 6px 12px; cursor: pointer;
  border-left: 2px solid transparent;
}
.sp-item[data-active] { background: rgba(255,255,255,.08); border-left-color: ${BRAND_RED}; color: #fff; }
.sp-item[aria-disabled="true"] { color: rgba(255,255,255,.32); cursor: default; }
.sp-item[aria-disabled="true"][data-active] { border-left-color: rgba(255,255,255,.2); }
.sp-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sp-dot { width: 6px; height: 6px; border-radius: 50%; background: ${BRAND_RED}; flex: none; }
.sp-why { font: 400 10px/1 ${FONT_MONO}; letter-spacing: .06em; color: rgba(255,255,255,.32); white-space: nowrap; }
.sp-empty { padding: 8px 12px; color: rgba(255,255,255,.4); font: 400 12px/1.3 ${FONT_MONO}; }
.sp-foot { border-top: 1px solid rgba(255,255,255,.1); padding: 8px 12px 10px; display: grid; gap: 6px; }
.sp-row { display: flex; align-items: center; gap: 8px; }
.sp-label {
  width: 78px; flex: none; font: 400 10px/1 ${FONT_MONO}; letter-spacing: .16em; text-transform: uppercase;
  color: rgba(255,255,255,.5);
}
.sp-seg { display: flex; gap: 3px; }
.sp-seg button {
  min-width: 34px; padding: 5px 8px; border-radius: 2px; cursor: pointer;
  background: none; border: 1px solid rgba(255,255,255,.16); color: rgba(255,255,255,.62);
  font: 400 11px/1 ${FONT_MONO}; letter-spacing: .1em;
}
.sp-seg button:hover:not(:disabled), .sp-seg button:focus-visible { border-color: rgba(255,255,255,.4); outline: none; }
.sp-seg button[aria-pressed="true"] { border-color: rgba(255,255,255,.6); background: rgba(255,255,255,.1); color: #fff; }
.sp-seg button:disabled { opacity: .35; cursor: default; }
.sp-unit { font: 400 10px/1 ${FONT_MONO}; letter-spacing: .1em; color: rgba(255,255,255,.4); }
.sp-note { font: 400 10px/1.3 ${FONT_MONO}; letter-spacing: .04em; color: rgba(255,255,255,.36); }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function createScenePicker(deps: ScenePickerDeps): ScenePicker {
  const { button } = deps;
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = stylesheet;
    document.head.appendChild(style);
  }

  const nameEl = el("span", "sp-btn-name");
  button.replaceChildren(nameEl, el("span", "sp-caret", "▾"));
  button.setAttribute("aria-haspopup", "listbox");
  button.setAttribute("aria-expanded", "false");

  const pop = el("div", "sp-pop");
  pop.id = "scenePicker";
  const filter = el("input", "sp-filter");
  filter.type = "text";
  filter.placeholder = "Filter scenes";
  filter.setAttribute("aria-label", "Filter scenes");
  filter.autocomplete = "off";
  filter.spellcheck = false;
  const list = el("ul", "sp-list");
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Scenes");

  // ---- The transition foot ----
  const styleBtns = new Map<TransitionStyle, HTMLButtonElement>();
  const styleSeg = el("div", "sp-seg");
  for (const [style, label] of [
    ["cut", "CUT"],
    ["fade", "FADE"],
  ] as const) {
    const b = el("button", "", label);
    b.type = "button";
    b.addEventListener("click", () => paintTransition(setSceneTransition({ style })));
    styleBtns.set(style, b);
    styleSeg.append(b);
  }
  const barBtns = new Map<number, HTMLButtonElement>();
  const barSeg = el("div", "sp-seg");
  for (const bars of TRANSITION_BARS) {
    const b = el("button", "", barsLabel(bars));
    b.type = "button";
    b.addEventListener("click", () => paintTransition(setSceneTransition({ bars })));
    barBtns.set(bars, b);
    barSeg.append(b);
  }
  const styleRow = el("div", "sp-row");
  styleRow.append(el("span", "sp-label", "Transition"), styleSeg);
  const lengthRow = el("div", "sp-row");
  lengthRow.append(el("span", "sp-label", "Length"), barSeg, el("span", "sp-unit", "bars"));
  const note = el("div", "sp-note", "Starts on the next beat.");
  const foot = el("div", "sp-foot");
  foot.append(styleRow, lengthRow, note);

  pop.append(filter, list, foot);
  document.body.appendChild(pop);

  function paintTransition(t: SceneTransition): void {
    for (const [style, b] of styleBtns) b.setAttribute("aria-pressed", String(t.style === style));
    for (const [bars, b] of barBtns) {
      b.setAttribute("aria-pressed", String(t.style === "fade" && t.bars === bars));
      b.disabled = t.style === "cut";
    }
  }

  // ---- The list ----
  let shown: ScenePickEntry[] = [];
  let items: HTMLLIElement[] = [];
  let active = -1;

  function setActive(i: number, scroll: boolean): void {
    if (items[active]) delete items[active].dataset.active;
    active = i;
    const item = items[i];
    if (!item) return;
    item.dataset.active = "";
    filter.setAttribute("aria-activedescendant", item.id);
    if (scroll) item.scrollIntoView({ block: "nearest" });
  }

  function pick(i: number): void {
    const entry = shown[i];
    if (!entry || !entry.enabled) return;
    close();
    if (entry.id !== deps.currentId()) deps.onPick(entry.id);
  }

  function renderList(): void {
    const all = deps.scenes();
    const matches = filterScenes(all, filter.value);
    // Released first, then the drafts, each in gallery order.
    shown = [...matches.filter((e) => !e.draft), ...matches.filter((e) => e.draft)];
    const current = deps.currentId();
    list.replaceChildren();
    items = [];
    active = -1;
    if (shown.length === 0) {
      list.append(el("li", "sp-empty", "No scene matches."));
      return;
    }
    let draftHeadDone = false;
    shown.forEach((entry, i) => {
      if (entry.draft && !draftHeadDone) {
        draftHeadDone = true;
        const head = el("li", "sp-head", "Draft");
        head.setAttribute("role", "presentation");
        list.append(head);
      }
      const li = el("li", "sp-item");
      li.id = `sp-item-${entry.id}`;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(entry.id === current));
      if (!entry.enabled) {
        li.setAttribute("aria-disabled", "true");
        if (entry.reason) li.title = entry.reason;
      }
      li.append(el("span", "sp-name", entry.name));
      if (entry.id === current) li.append(el("span", "sp-dot"));
      else if (!entry.enabled && entry.reason) li.append(el("span", "sp-why", entry.reason));
      li.addEventListener("pointermove", () => {
        if (active !== i) setActive(i, false);
      });
      li.addEventListener("click", () => pick(i));
      list.append(li);
      items.push(li);
    });
    // With no filter the current scene is where the arrow keys start;
    // with one, the first match, so Enter takes the best guess.
    const at = filter.value.trim() === "" ? shown.findIndex((e) => e.id === current) : 0;
    setActive(Math.max(0, at), true);
  }

  /** The next pickable entry from `from` in `dir`, or `from` at either end. */
  function step(from: number, dir: 1 | -1): number {
    for (let i = from + dir; i >= 0 && i < shown.length; i += dir) if (shown[i]!.enabled) return i;
    return from;
  }

  filter.addEventListener("input", renderList);
  filter.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive(step(active, e.key === "ArrowDown" ? 1 : -1), true);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(active);
    }
  });

  // Escape closes the list wherever the focus is, ahead of app.ts's own
  // Escape (which would leave the scene) and the panel's (which unpins a card).
  function onEscape(e: KeyboardEvent): void {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    const hadFocus = pop.contains(document.activeElement);
    close();
    if (hadFocus) button.focus();
  }

  function place(): void {
    const r = button.getBoundingClientRect();
    const width = pop.offsetWidth;
    const left = Math.max(16, Math.min(r.left, window.innerWidth - 16 - width));
    const top = r.bottom + 6;
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    pop.style.maxHeight = `${Math.max(160, window.innerHeight - top - 16)}px`;
  }

  // A press anywhere outside the list and its button closes it, like a menu.
  function onOutside(e: PointerEvent): void {
    const t = e.target as Node | null;
    if (t && (pop.contains(t) || button.contains(t))) return;
    close();
  }

  function open(): void {
    filter.value = "";
    paintTransition(getSceneTransition());
    pop.dataset.open = "";
    button.setAttribute("aria-expanded", "true");
    renderList();
    place();
    window.addEventListener("pointerdown", onOutside, true);
    window.addEventListener("keydown", onEscape, true);
    window.addEventListener("resize", place);
    // A phone's on-screen keyboard would cover most of the list: there the
    // filter waits for a tap.
    if (!matchMedia("(pointer: coarse)").matches) filter.focus({ preventScroll: true });
  }

  function close(): void {
    if (pop.dataset.open === undefined) return;
    delete pop.dataset.open;
    button.setAttribute("aria-expanded", "false");
    window.removeEventListener("pointerdown", onOutside, true);
    window.removeEventListener("keydown", onEscape, true);
    window.removeEventListener("resize", place);
    if (pop.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  }

  button.addEventListener("click", () => {
    if (pop.dataset.open !== undefined) close();
    else open();
  });

  return {
    setScene(name) {
      nameEl.textContent = name.toUpperCase();
      button.title = `${name}: change scene`;
    },
    isOpen: () => pop.dataset.open !== undefined,
    close,
  };
}
