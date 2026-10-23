/**
 * The desk's Pads (issue #623, plans/controls-first.md "#623 Pads"): two faces
 * of one list of pads. createPadsRow is the row of the first PADS_ROW_MAX pads
 * on the main page; createPadsView is the full page with the launch line and
 * Autopilot beside a grid of every pad. Both read one launch queue
 * (render/launchQueue.ts, run by app.ts), so a tap shows the same in both and
 * on the Timeline, and both show Autopilot's next pick (render/setAutopilot.ts).
 *
 * Tiles are rebuilt only when the pads' ids or names change. Each tick (at
 * most TICK_MS apart) updates classes and labels in place, so a tile under the
 * pointer is never replaced mid-press. A tile's picture is the desk's still of
 * its pad (padStills.ts) once one exists, else the pad palette's accent.
 *
 * What a press does is decided by deps.tap (app.ts); this file only reports it.
 */
import { getPalette } from "../../render/palette.ts";
import {
  getLaunchOn,
  LAUNCH_ON,
  LAUNCH_ON_LABELS,
  setLaunchOn,
  type LaunchOn,
  type QueuedLaunch,
} from "../../render/launchQueue.ts";
import { METRONOME_BEATS_PER_BAR } from "../../../audio-subsystem/src/metronome.ts";
import { AUTOPILOT_EVERY_BARS, AUTOPILOT_ORDERS, type AutopilotConfig, type AutopilotOrder, type SetPad } from "../../render/sceneSet.ts";
import { padStill, padStillAt } from "./padStills.ts";

/** How many pads the row shows. Keys 1 to this many tap pads while the desk is up (app.ts). */
export const PADS_ROW_MAX = 8;

/** Refresh cadence for the tiles, the launch line and the Up next line. */
const TICK_MS = 100;

const ORDER_LABELS: Record<AutopilotOrder, string> = { inOrder: "In order", shuffle: "Shuffle" };

export interface PadsDeps {
  list(): readonly SetPad[];
  sceneName(sceneId: string): string;
  livePadId(): string | null;
  nextPadId(): string | null;
  queue(): readonly QueuedLaunch[];
  /** The beat count the queue runs on (app.ts's deskBeats). */
  nowBeats(): number;
  pick(): { padId: string; inBars: number } | null;
  tap(padId: string, shift: boolean): void;
  addPad(): string | null;
  autopilot(): AutopilotConfig;
  setAutopilot(change: Partial<AutopilotConfig>): void;
  skipPick(): void;
  /** ✎: load into NEXT and go back to the main page. */
  edit(padId: string): void;
  openAll(): void;
}

function elm<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(cls: string, text: string): HTMLButtonElement {
  const b = elm("button", cls, text);
  b.type = "button";
  return b;
}

function chip(label: string, onClick: () => void): HTMLButtonElement {
  const b = button("desk-chip", label);
  b.addEventListener("click", onClick);
  return b;
}

/** Bars until a launch on `atBeats`; zero or less means it is due now. */
function barsUntil(atBeats: number, nowBeats: number): number {
  return Math.ceil((atBeats - nowBeats) / METRONOME_BEATS_PER_BAR);
}

/** "now", "in 1 bar", "in 4 bars". */
function barsWord(n: number): string {
  if (n < 1) return "now";
  return `in ${n} ${n === 1 ? "bar" : "bars"}`;
}

interface PadMark {
  live: boolean;
  editing: boolean;
  /** Bars until this pad's earliest queued launch; null when none is queued. */
  queuedIn: number | null;
  /** Bars until Autopilot's pick lands on this pad; null when it is not the pick. */
  autoIn: number | null;
}

function statusText(m: PadMark): string {
  if (m.queuedIn !== null) return m.queuedIn < 1 ? "now" : `in ${m.queuedIn}`;
  if (m.autoIn !== null) return m.autoIn < 1 ? "AUTO now" : `AUTO in ${m.autoIn}`;
  return m.live ? "LIVE" : "";
}

interface Tile {
  padId: string;
  el: HTMLElement;
  pic: HTMLCanvasElement;
  status: HTMLElement;
  /** The still's grab time last copied into `pic`. */
  drawnAt: number;
}

function buildTile(deps: PadsDeps, pad: SetPad, number: number, withEdit: boolean): Tile {
  const root = elm("div", "desk-pad");
  const main = button("desk-pad-main", "");
  main.title = "Tap: queue on the next launch line. Shift-tap: load into NEXT only.";
  main.addEventListener("click", (e) => deps.tap(pad.id, e.shiftKey));
  const picWrap = elm("div", "desk-pad-pic");
  picWrap.style.background = getPalette(pad.paletteId).roles.accent;
  const pic = elm("canvas");
  pic.hidden = true;
  const status = elm("span", "desk-pad-status");
  picWrap.append(pic, elm("span", "desk-pad-key", String(number)), status);
  main.append(picWrap, elm("div", "desk-pad-name", pad.name), elm("div", "desk-pad-scene", deps.sceneName(pad.look.sceneId)));
  root.appendChild(main);
  if (withEdit) {
    const edit = button("desk-pad-edit", "✎");
    edit.title = "Load into NEXT and show the main page";
    edit.addEventListener("click", () => deps.edit(pad.id));
    root.appendChild(edit);
  }
  return { padId: pad.id, el: root, pic, status, drawnAt: -Infinity };
}

function applyMark(t: Tile, m: PadMark): void {
  t.el.classList.toggle("queued", m.queuedIn !== null);
  t.el.classList.toggle("auto-next", m.autoIn !== null);
  t.el.classList.toggle("live", m.live);
  t.el.classList.toggle("editing", m.editing);
  const text = statusText(m);
  if (t.status.textContent !== text) t.status.textContent = text;
}

function paintPic(t: Tile): void {
  const still = padStill(t.padId);
  if (!still) return;
  const at = padStillAt(t.padId);
  if (at === t.drawnAt) return;
  t.drawnAt = at;
  t.pic.width = still.width;
  t.pic.height = still.height;
  t.pic.getContext("2d")?.drawImage(still, 0, 0);
  t.pic.hidden = false;
}

/** The tiles of the first `limit` pads, in one container; shared by the row and the grid. */
function createTileGroup(
  deps: PadsDeps,
  opts: { limit: number; withEdit: boolean; className: string },
): { el: HTMLElement; tick(nowMs: number): void } {
  const el = elm("div", opts.className);
  let tiles: Tile[] = [];
  let builtKey: string | null = null;
  let nextMs = 0;

  function rebuild(pads: readonly SetPad[]): void {
    tiles = pads.map((p, i) => buildTile(deps, p, i + 1, opts.withEdit));
    el.textContent = "";
    el.append(...tiles.map((t) => t.el));
  }

  function tick(nowMs: number): void {
    if (nowMs < nextMs) return;
    nextMs = nowMs + TICK_MS;
    const pads = deps.list().slice(0, opts.limit);
    const key = pads.map((p) => `${p.id}\n${p.name}`).join("\n");
    if (key !== builtKey) {
      builtKey = key;
      rebuild(pads);
    }
    const nowBeats = deps.nowBeats();
    el.classList.toggle("beat-on", Math.floor(nowBeats) % 2 === 0);
    // The queue is sorted by launch beat, so the first entry for a pad is its earliest.
    const queued = new Map<string, number>();
    for (const q of deps.queue()) if (!queued.has(q.padId)) queued.set(q.padId, q.atBeats);
    const pick = deps.pick();
    const live = deps.livePadId();
    const next = deps.nextPadId();
    for (const t of tiles) {
      const at = queued.get(t.padId);
      applyMark(t, {
        live: t.padId === live,
        editing: t.padId === next,
        queuedIn: at === undefined ? null : barsUntil(at, nowBeats),
        autoIn: pick !== null && pick.padId === t.padId ? pick.inBars : null,
      });
      paintPic(t);
    }
  }

  return { el, tick };
}

/** The main page's PADS section: a row of the first PADS_ROW_MAX pads, then + Add and ⤢ All pads. */
export function createPadsRow(deps: PadsDeps): { el: HTMLElement; tick(nowMs: number): void } {
  const root = elm("div", "desk-pads-row");
  const group = createTileGroup(deps, { limit: PADS_ROW_MAX, withEdit: false, className: "desk-pads-tiles desk-pads-tiles-row" });
  const tools = elm("div", "desk-pads-tools");
  const add = button("desk-pads-btn", "+ Add");
  const note = elm("div", "desk-pads-note");
  add.addEventListener("click", () => {
    note.textContent = deps.addPad() ?? "";
  });
  const all = button("desk-pads-btn", "⤢ All pads");
  all.addEventListener("click", () => deps.openAll());
  tools.append(add, note, all);
  root.append(group.el, tools);
  return { el: root, tick: group.tick };
}

/** The PADS view: launch line, every pad in a grid with ✎, and the side column with Up next and Autopilot. */
export function createPadsView(deps: PadsDeps): { el: HTMLElement; tick(nowMs: number): void } {
  const root = elm("div", "desk-pads-view");

  const launchChips = LAUNCH_ON.map((on: LaunchOn) => ({
    on,
    el: chip(LAUNCH_ON_LABELS[on], () => setLaunchOn(on)),
  }));
  const launchHead = elm("div", "desk-pads-head");
  launchHead.append(elm("span", "desk-pads-label", "LAUNCH ON"), ...launchChips.map((c) => c.el));

  const grid = createTileGroup(deps, { limit: Infinity, withEdit: true, className: "desk-pads-tiles desk-pads-tiles-grid" });

  const side = elm("aside", "desk-pads-side");
  const upText = elm("div", "desk-pads-upnext", "Nothing queued");
  const autoOn = chip("Off", () => deps.setAutopilot({ on: !deps.autopilot().on }));
  const everyChips = AUTOPILOT_EVERY_BARS.map((n) => ({
    everyBars: n,
    el: chip(`${n} bars`, () => deps.setAutopilot({ everyBars: n })),
  }));
  const orderChips = AUTOPILOT_ORDERS.map((o) => ({
    order: o,
    el: chip(ORDER_LABELS[o], () => deps.setAutopilot({ order: o })),
  }));
  const pickBtn = button("desk-pads-btn", "Pick another");
  pickBtn.addEventListener("click", () => deps.skipPick());
  const autoHead = elm("div", "desk-pads-head");
  autoHead.append(elm("span", "desk-pads-label", "AUTOPILOT"), autoOn);
  const everyRow = elm("div", "desk-pads-head");
  everyRow.append(elm("span", "desk-pads-label", "EVERY"), ...everyChips.map((c) => c.el));
  const orderRow = elm("div", "desk-pads-head");
  orderRow.append(elm("span", "desk-pads-label", "ORDER"), ...orderChips.map((c) => c.el));
  side.append(elm("div", "desk-pads-label", "UP NEXT"), upText, autoHead, everyRow, orderRow, pickBtn);

  const body = elm("div", "desk-pads-body");
  body.append(grid.el, side);
  root.append(launchHead, body);

  let nextMs = 0;

  function refreshSide(): void {
    const nowBeats = deps.nowBeats();
    const pads = deps.list();
    const names = new Map<string, string>();
    for (const p of pads) names.set(p.id, p.name);

    const upcoming = deps.queue().find((q) => names.has(q.padId));
    const pick = deps.pick();
    let line = "Nothing queued";
    if (upcoming) line = `${names.get(upcoming.padId)} ${barsWord(barsUntil(upcoming.atBeats, nowBeats))}`;
    else if (pick) line = `Autopilot: ${names.get(pick.padId) ?? ""} ${barsWord(pick.inBars)}`;
    if (upText.textContent !== line) upText.textContent = line;

    const launch = getLaunchOn();
    for (const c of launchChips) c.el.classList.toggle("on", c.on === launch);

    const cfg = deps.autopilot();
    autoOn.textContent = cfg.on ? "On" : "Off";
    autoOn.classList.toggle("on", cfg.on);
    for (const c of everyChips) c.el.classList.toggle("on", c.everyBars === cfg.everyBars);
    for (const c of orderChips) c.el.classList.toggle("on", c.order === cfg.order);
    pickBtn.disabled = !cfg.on;
  }

  function tick(nowMs: number): void {
    if (nowMs < nextMs) return;
    nextMs = nowMs + TICK_MS;
    grid.tick(nowMs);
    refreshSide();
  }

  return { el: root, tick };
}
