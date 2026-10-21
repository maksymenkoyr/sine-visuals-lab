/**
 * The desk: the main window's layout while a pop-out output is open (issue
 * #617, plans/controls-first.md). The scene canvas is the NEXT monitor at the
 * top left; the Cue/Play bar and the list of changes (playList.ts) sit in the
 * column beside it; the LIVE monitor (liveMonitor.ts) is at the top right; the
 * controls panel runs below that row (deskTheme.ts).
 *
 * app.ts loads this module the first time an output opens, so the first paint
 * pays nothing for it. It only moves the existing Cue/Play bar (#outBar) into
 * its column and back, and adds its own #desk element; everything else it
 * shows is either the canvas itself or one of the panel's cards.
 *
 * The view switch in the top bar picks what the page under the monitors shows:
 * MAIN is the scrolling page; PADS swaps it for the full pads view (pads.ts);
 * NODES keeps only the panel. ORCHESTRATE is still the main page, scrolled to
 * its section.
 */
import { clearDriveMutes } from "../../render/driveMute.ts";
import { getSceneTransition, setSceneTransition, type SceneTransition } from "../../render/sceneTransition.ts";
import { capturePadStill, padStillAt } from "./padStills.ts";
import { createLiveMonitor, type LiveMonitorDeps } from "./liveMonitor.ts";
import { createPadsRow, createPadsView, type PadsDeps } from "./pads.ts";
import { createPlayList, type PlayListDeps } from "./playList.ts";
import { createStrips, type StripsDeps } from "./strips.ts";
import { ensureDeskStyles } from "./deskTheme.ts";

/** Re-exported so app.ts can read the strip count from the desk module it loads lazily, without loading strips.ts first. */
export { DESK_STRIPS_MAX } from "./strips.ts";
/** Re-exported for the same reason as DESK_STRIPS_MAX: app.ts's digit keys read it. */
export { PADS_ROW_MAX } from "./pads.ts";

export interface DeskDeps {
  /** Opens the controls panel if it is shut (deviceMenu.toggle when !isOpen). */
  openPanel(): void;
  /** Whether the controls panel is open now. */
  panelOpen(): boolean;
  /** Closes the controls panel (the desk does so on leaving only if it opened it). */
  closePanel(): void;
  /** "128 BPM", or "-- BPM" with no tempo. */
  bpmText(): string;
  playList: Omit<PlayListDeps, "listEl" | "countEl">;
  live: Omit<LiveMonitorDeps, "slot">;
  strips: StripsDeps;
  /** load(id) puts a pad on NEXT (the ✎ button and the view's "edit" use it). */
  pads: Omit<PadsDeps, "openAll" | "edit"> & { load(padId: string): void };
}

type DeskView = "main" | "pads" | "orchestrate" | "nodes";

const VIEW_BUTTONS: readonly [DeskView, string][] = [
  ["main", "MAIN"],
  ["pads", "PADS ⤢"],
  ["orchestrate", "ORCHESTRATE ⤢"],
  ["nodes", "NODES ⤢"],
];

/** How old a pad's still may get while the pad sits on NEXT before the desk grabs a new one. */
const STILL_REFRESH_MS = 2000;

export interface Desk {
  setActive(on: boolean): void;
  active(): boolean;
  /** Once per render tick; cheap. */
  tick(nowMs: number): void;
  /** Once per scene draw, right after the scene has drawn to #gl (liveMonitor.ts needs that frame). */
  afterDraw(nowMs: number): void;
  /** The Play column's list element (playList.ts). */
  listEl: HTMLElement;
  /** The Play column's count badge. */
  countEl: HTMLElement;
  /** The LIVE slot (liveMonitor.ts). */
  liveSlot: HTMLElement;
  /** The Pads section of the scrolling page; a later part fills it. */
  padsSlot: HTMLElement;
  /** The Orchestrate section of the scrolling page; a later part fills it. */
  orchSlot: HTMLElement;
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

/** A section of the scrolling page: a small heading, then whatever goes in it. */
function pageSection(title: string): HTMLElement {
  const section = el("section", "desk-page-section");
  section.appendChild(el("div", "desk-mid-head", title));
  return section;
}

export function createDesk(deps: DeskDeps): Desk {
  ensureDeskStyles();

  const root = el("div");
  root.id = "desk";

  const strips = createStrips(deps.strips);

  const bar = el("div", "desk-bar");
  const bpm = el("span", "desk-bpm");
  const viewBtns = VIEW_BUTTONS.map(([view, label]) => {
    const b = el("button", "desk-view-btn", label);
    b.type = "button";
    b.addEventListener("click", () => setView(view));
    return { view, el: b };
  });
  bar.append(...viewBtns.map((v) => v.el), bpm);

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

  // The scrolling page under the top row (#627): the jump bar, the mixer (#622), two placeholder sections, then today's panel.
  const lower = el("div");
  lower.id = "deskLower";
  const jump = el("nav", "desk-jump");
  const mixer = el("section", "desk-mixer");
  const fxSlot = el("div", "desk-fx");
  mixer.append(strips.el, fxSlot);
  const padsDeps: PadsDeps = {
    ...deps.pads,
    openAll: () => setView("pads"),
    edit: (id) => {
      deps.pads.load(id);
      setView("main");
    },
  };
  const padsSlot = pageSection("PADS");
  padsSlot.classList.add("desk-sec-pads");
  const padsRow = createPadsRow(padsDeps);
  padsSlot.appendChild(padsRow.el);
  const orchSlot = pageSection("ORCHESTRATE");
  orchSlot.classList.add("desk-sec-orch");
  const panelSlot = pageSection("PANEL");
  for (const [label, target] of [
    ["Mixer", mixer],
    ["Pads", padsSlot],
    ["Orchestrate", orchSlot],
    ["Panel", panelSlot],
  ] as const) {
    const b = el("button", "desk-jump-btn", label);
    b.type = "button";
    b.addEventListener("click", () => target.scrollIntoView({ block: "start", behavior: "smooth" }));
    jump.appendChild(b);
  }
  lower.append(jump, mixer, padsSlot, orchSlot, panelSlot);
  // The panel lays its cables out from its own scroll events (deviceMenu.ts), so the page's scroll is passed on to it.
  lower.addEventListener("scroll", () => document.querySelector(".vc-root")?.dispatchEvent(new Event("scroll")), { passive: true });
  // The PADS view (#623): the same box as the page, shown instead of it.
  const padsView = createPadsView(padsDeps);
  const viewPage = el("div");
  viewPage.id = "deskView";
  viewPage.appendChild(padsView.el);
  root.append(lower, viewPage);

  const playList = createPlayList({ ...deps.playList, listEl, countEl, onHover: (key) => strips.highlight(key) });
  const liveMonitor = createLiveMonitor({ ...deps.live, slot: liveSlot });

  let active = false;
  let nextRefreshMs = 0;
  let outBarHome: { parent: Node; next: Node | null } | null = null;
  let fxHome: { parent: Node; next: Node | null } | null = null;
  let panelHome: { parent: Node; next: Node | null } | null = null;
  let panelWasOpen = false;
  let view: DeskView = "main";

  function refreshChips(): void {
    const t = getSceneTransition();
    for (const chip of FADE_CHIPS) chip.el?.classList.toggle("on", chip.lit(t));
  }

  function setView(next: DeskView): void {
    view = next;
    root.classList.toggle("view-pads", next === "pads");
    lower.classList.toggle("desk-nodes", next === "nodes");
    for (const b of viewBtns) b.el.classList.toggle("on", b.view === next);
    if (next === "orchestrate") orchSlot.scrollIntoView({ block: "start" });
    if (next === "nodes") lower.scrollTop = 0;
  }

  function setActive(on: boolean): void {
    if (on === active) return;
    active = on;
    nextRefreshMs = 0;
    liveMonitor.setActive(on);
    const outBar = document.getElementById("outBar");
    if (on) {
      if (outBar && outBar.parentNode) {
        outBarHome = { parent: outBar.parentNode, next: outBar.nextSibling };
        keys.appendChild(outBar);
      }
      const fxBar = document.getElementById("fxBar");
      if (fxBar?.parentNode) {
        fxHome = { parent: fxBar.parentNode, next: fxBar.nextSibling };
        fxSlot.appendChild(fxBar);
      }
      const panelRoot = document.querySelector<HTMLElement>(".vc-root");
      if (panelRoot?.parentNode) {
        panelHome = { parent: panelRoot.parentNode, next: panelRoot.nextSibling };
        panelSlot.appendChild(panelRoot);
      }
      document.body.classList.add("desk");
      document.documentElement.classList.add("vc-desk");
      panelWasOpen = deps.panelOpen();
      deps.openPanel();
    } else {
      setView("main");
      // A mute only means "NEXT apart from LIVE"; with no output there is nothing to be apart from.
      clearDriveMutes();
      // Reverse of the order they were moved in, so each home's next sibling is back in place first.
      const panelRoot = document.querySelector<HTMLElement>(".vc-root");
      if (panelRoot && panelHome) panelHome.parent.insertBefore(panelRoot, panelHome.next);
      panelHome = null;
      const fxBar = document.getElementById("fxBar");
      if (fxBar && fxHome) fxHome.parent.insertBefore(fxBar, fxHome.next);
      fxHome = null;
      if (outBar && outBarHome) outBarHome.parent.insertBefore(outBar, outBarHome.next);
      outBarHome = null;
      document.body.classList.remove("desk");
      document.documentElement.classList.remove("vc-desk");
      if (!panelWasOpen) deps.closePanel();
    }
  }

  function tick(nowMs: number): void {
    if (!active) return;
    playList.tick(nowMs);
    strips.tick(nowMs);
    padsRow.tick(nowMs);
    if (view === "pads") padsView.tick(nowMs);
    if (nowMs < nextRefreshMs) return;
    nextRefreshMs = nowMs + REFRESH_MS;
    const text = deps.bpmText();
    if (bpm.textContent !== text) bpm.textContent = text;
    refreshChips();
  }

  setView("main");
  document.body.appendChild(root);

  return {
    setActive,
    active: () => active,
    tick,
    afterDraw(nowMs) {
      if (!active) return;
      liveMonitor.afterDraw(nowMs);
      const nextId = padsDeps.nextPadId();
      if (nextId !== null && nowMs - padStillAt(nextId) >= STILL_REFRESH_MS) capturePadStill(nextId, deps.live.source, nowMs);
    },
    listEl,
    countEl,
    liveSlot,
    padsSlot,
    orchSlot,
  };
}
