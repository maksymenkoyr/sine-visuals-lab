/**
 * The Room view: the room's one screen. A diagram of every device in the room
 * (a node each, with its ears and screen choice as chips, a green line from a
 * feed to the devices that listen through it, a violet line from MAIN to the
 * devices that show the room's look), an inspector for the selected device,
 * the invite QR (a keyed room's can be swapped for its watch-only link), the
 * typed-code field that adds a waiting TV, and Reset or Leave. It replaces the old Screens card; the open/close mechanics are the
 * same (a full-viewport overlay, shown and hidden by the caller) and so is the
 * rule that the QR is drawn on open, because a canvas inside a `display: none`
 * overlay measures nothing.
 *
 * What the choices mean, and who may make them, is server/roomDevices.ts: this
 * file only draws the roster (src/net/roomMessages.ts `RosterEntry`) and sends
 * a `deviceSet` for each click (`RoomViewDeps.setDevice`). It never decides
 * anything the room would refuse; a refusal comes back as a `deviceReject` and
 * is shown under the controls. The one thing it tells the page early is this
 * device's own ears choice (`RoomViewDeps.onSelfEars`, before the message is
 * sent), so the page can open its microphone inside the tap. The invite link
 * is never printed, because it carries the room key.
 *
 * Nodes are kept in a Map keyed by device id and updated in place on every
 * roster change (text and classes only; one is added or removed only when a
 * device joins or is forgotten), so a click, or a half-typed name, is never
 * destroyed by a roster that arrives under the pointer.
 *
 * The module top level touches no DOM, so the pure helpers (`layoutNodes`,
 * `chipsFor`, `feedChoices` and friends) run in the unit tests; the DOM is
 * built inside `createRoomView`.
 *
 * A TV also gets a Quality row: a TV page has no panel of its own, so this is
 * where its quality is chosen, with the Power card's choices
 * (render/qualityPref.ts `QUALITY_OPTIONS`).
 *
 * Styling is the controls panel's (src/ui/controlsTheme.ts): its glass, its
 * two fonts, and the accent each idea already has there (green for sound,
 * violet for the Main look, amber for a device's own screen, sky for "you",
 * teal for quality).
 */

import {
  AUTO_SKY,
  BANDS_AMBER,
  FONT_LABEL,
  FONT_MONO,
  GLASS_BG,
  GLASS_FILTER,
  HOT_RED,
  INPUT_GREEN,
  POWER_TEAL,
  SCENE_VIOLET,
  ensureControlsStyles,
  withAlpha,
} from "./controlsTheme.ts";
import { createRoomCodeEntry, joinUrlFor, type AddScreenOutcome, type JoinKind, type JoinLinkInfo } from "./joinScreen.ts";
import { drawQrCode } from "./qr.ts";
import { recordsFromRoster, type RosterEntry } from "../net/roomMessages.ts";
import { PRESET_LABEL, QUALITY_OPTIONS } from "../render/qualityPref.ts";
import {
  DEVICE_LIMITS,
  RENDER_DELAY_MS,
  cleanName,
  feedOf,
  followersOf,
  ownerId,
  parseQuality,
  pictureDelayMs,
  type DeviceKind,
  type DeviceSetPatch,
} from "../../server/roomDevices.ts";

/** The room a QR opens: the link kind (joinScreen.ts `JoinKind`), the room
 *  code and, for a keyed room, the key the link carries. */
export interface RoomInvite {
  kind: JoinKind;
  code: string;
  info?: JoinLinkInfo;
}

export interface RoomViewDeps {
  /** This device's id, to mark "you" and to start the inspector on it. */
  selfId: string;
  /** This device opened the room: it may remove other devices. */
  isOwner: boolean;
  roomCode(): string | null;
  getRoster(): RosterEntry[];
  onRosterChange(cb: (r: RosterEntry[]) => void): () => void;
  onDeviceReject(cb: (m: { targetId: string | null; reason: string }) => void): () => void;
  setDevice(targetId: string, patch: DeviceSetPatch): void;
  /** Called synchronously inside the click that sets THIS device's own ears,
   *  before `setDevice` sends it: the page acts on the choice in the same tap
   *  (an iPad opens its microphone only inside a gesture), without waiting for
   *  the room to echo it. */
  onSelfEars?: (patch: DeviceSetPatch) => void;
  /** Owner only; left out, the Remove button is never offered. */
  forgetDevice?: (targetId: string) => void;
  /** What this device's QR encodes; null (or no code) means no QR to show. */
  invite(): RoomInvite | null;
  /** The typed-code field's way to hand a waiting TV to this room. */
  adoptTv?: (code: string) => Promise<AddScreenOutcome>;
  /** The button at the foot: "Reset room" for the owner, "Leave room" for
   *  anyone else. With `confirm` the first click only arms it (the label turns
   *  into that text) and the second runs it. */
  finish?: { label: string; confirm?: string; run: () => void };
}

export interface RoomView {
  show(): void;
  hide(): void;
  toggle(): void;
  isOpen(): boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers (no DOM)
// ---------------------------------------------------------------------------

/** A node's box in the diagram, px. The layout below guarantees two nodes
 *  never overlap at these sizes; the DOM nodes are drawn at exactly them. */
export const NODE_W = 140;
export const NODE_H = 150;
const NODE_GAP = 14;
/** The strip across the top of the diagram that holds the MAIN node. */
export const MAIN_BAND_H = 72;
/** The most columns of nodes per row: fewer when the overlay is narrow. */
const MAX_COLS_WIDE = 4;
const MAX_COLS_NARROW = 2;
/** The diagram is at least this tall, whatever the device count. */
const BASE_HEIGHT_WIDE = 360;
const BASE_HEIGHT_NARROW = 460;

function columnsFor(count: number, width: number, narrow: boolean): number {
  const fit = Math.floor((width - NODE_GAP) / (NODE_W + NODE_GAP));
  return Math.max(1, Math.min(count, fit, narrow ? MAX_COLS_NARROW : MAX_COLS_WIDE));
}

/** The height the diagram needs for `count` device nodes at `width` so that
 *  every row fits under the MAIN band. */
export function neededHeight(count: number, width: number, narrow: boolean): number {
  if (count <= 0) return MAIN_BAND_H;
  const rows = Math.ceil(count / columnsFor(count, width, narrow));
  return MAIN_BAND_H + rows * (NODE_H + NODE_GAP) + NODE_GAP;
}

/** The diagram's height: its base height, or taller when the nodes need it. */
export function diagramHeight(count: number, width: number, narrow: boolean): number {
  return Math.max(narrow ? BASE_HEIGHT_NARROW : BASE_HEIGHT_WIDE, neededHeight(count, width, narrow));
}

/** Where each of `count` device nodes sits in a `width` x `height` diagram:
 *  the node's centre, as a percentage of the box, one entry per node in order.
 *  Nodes fill rows left to right under the MAIN band; each row's nodes are
 *  spread across the whole width, so a short last row is centred rather than
 *  lopsided. Deterministic, so a node doesn't jump when another one appears
 *  unless the row count changes. Give it at least `neededHeight` to be sure
 *  nothing overlaps (`diagramHeight` does). */
export function layoutNodes(count: number, width: number, height: number, narrow: boolean): Array<{ x: number; y: number }> {
  if (count <= 0) return [];
  const cols = columnsFor(count, width, narrow);
  const rows = Math.ceil(count / cols);
  const pitch = Math.max(NODE_H + NODE_GAP, (height - MAIN_BAND_H) / rows);
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const inRow = Math.min(cols, count - row * cols);
    const col = i - row * cols;
    const cx = (width * (col + 0.5)) / inRow;
    const cy = MAIN_BAND_H + pitch * (row + 0.5);
    out.push({ x: (cx / width) * 100, y: (cy / height) * 100 });
  }
  return out;
}

export type ChipTone = "own" | "follow" | "none" | "main" | "own-screen" | "off" | "you" | "owner" | "offline";
export interface Chip {
  label: string;
  tone: ChipTone;
}
export interface NodeChips {
  ears: Chip;
  screen: Chip;
  /** YOU, OWNER and OFFLINE, those that apply. */
  tags: Chip[];
}

/** The chips a device's node shows: where its sound comes from, what its
 *  screen shows, and the tags. `selfId` is optional so the roster alone can
 *  answer everything but YOU. */
export function chipsFor(entry: RosterEntry, roster: RosterEntry[], selfId?: string): NodeChips {
  const { records, online } = recordsFromRoster(roster);
  let ears: Chip;
  if (entry.ears === "own") ears = { label: "OWN INPUT", tone: "own" };
  else {
    const feed = feedOf(records, entry.deviceId);
    const feedEntry = feed === null ? undefined : roster.find((d) => d.deviceId === feed);
    ears = feedEntry && online.has(feedEntry.deviceId) ? { label: `← ${feedEntry.name}`, tone: "follow" } : { label: "NO SOUND", tone: "none" };
  }
  const screen: Chip =
    entry.screen === "main"
      ? { label: "MAIN", tone: "main" }
      : entry.screen === "own"
        ? { label: "OWN", tone: "own-screen" }
        : { label: "OFF", tone: "off" };
  const tags: Chip[] = [];
  if (selfId !== undefined && entry.deviceId === selfId) tags.push({ label: "YOU", tone: "you" });
  if (entry.owner) tags.push({ label: "OWNER", tone: "owner" });
  if (!entry.online) tags.push({ label: "OFFLINE", tone: "offline" });
  return { ears, screen, tags };
}

const KIND_CAPS: Record<DeviceKind, string> = { laptop: "LAPTOP", tablet: "TABLET", phone: "PHONE", tv: "TV" };

/** The inspector's kind line: `LAPTOP · OWNER`, `TABLET · THIS DEVICE`... */
export function kindLine(entry: RosterEntry, selfId: string): string {
  const parts: string[] = [KIND_CAPS[entry.kind]];
  if (entry.owner) parts.push("OWNER");
  if (entry.deviceId === selfId) parts.push("THIS DEVICE");
  return parts.join(" · ");
}

/** The head row's count: how many devices, and how many of them are here now
 *  when that isn't all of them. */
export function deviceCountText(roster: RosterEntry[]): string {
  const total = roster.length;
  const online = roster.filter((d) => d.online).length;
  const noun = total === 1 ? "DEVICE" : "DEVICES";
  return online === total ? `${total} ${noun}` : `${online} ONLINE · ${total} ${noun}`;
}

/** The value of the "Listen through" select for the owner's own option. */
export const OWNER_FEED_VALUE = "";

/** The options of the "Listen through" select for `targetId`: every other
 *  device on its own input. The owner's option has `OWNER_FEED_VALUE`, which
 *  sends `follow: null` (the room's owner, whoever that is). */
export function feedChoices(roster: RosterEntry[], targetId: string): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [];
  for (const d of roster) {
    if (d.deviceId === targetId || d.ears !== "own") continue;
    out.push({ value: d.owner ? OWNER_FEED_VALUE : d.deviceId, label: d.name });
  }
  return out;
}

/** Which `feedChoices` value a following device currently has: null follows
 *  the owner, and so does naming the owner's id. */
export function currentFeedValue(entry: RosterEntry, roster: RosterEntry[]): string {
  if (entry.follow === null) return OWNER_FEED_VALUE;
  const { records } = recordsFromRoster(roster);
  return entry.follow === ownerId(records) ? OWNER_FEED_VALUE : entry.follow;
}

/** What pressing Follow sends for `entry`: only `ears` when the feed it
 *  already names (its `follow`, the owner for null) is another device on its
 *  own input; otherwise the first other device on its own input, as a
 *  `follow` (which implies following); null when there is none. The owner's
 *  `follow` is null, which names itself, so without this its Follow would
 *  always be refused. */
export function followPatch(entry: RosterEntry, roster: RosterEntry[]): DeviceSetPatch | null {
  const { records } = recordsFromRoster(roster);
  const current = entry.follow ?? ownerId(records);
  if (current !== null && current !== entry.deviceId && records.get(current)?.ears === "own") return { ears: "follow" };
  const first = feedChoices(roster, entry.deviceId)[0];
  if (!first) return null;
  return { follow: first.value === OWNER_FEED_VALUE ? null : first.value };
}

/** One plain line under the Picture delay number saying why it is what it is,
 *  read from the same records `pictureDelayMs` uses: a follower waits for its
 *  feed's frames to cross the network (the feed named from the roster, the
 *  owner when it follows `null`); a device on its own input waits only to stay
 *  in step with the screens that follow, and otherwise draws at once. */
export function delayReason(entry: RosterEntry, roster: RosterEntry[]): string {
  const { records, online } = recordsFromRoster(roster);
  if (entry.ears === "follow") {
    const feedId = entry.follow ?? ownerId(records);
    const feed = feedId === null ? undefined : roster.find((d) => d.deviceId === feedId);
    return feed ? `Waits for ${feed.name}’s sound to arrive over the network.` : "Waits for the sound to arrive over the network.";
  }
  return pictureDelayMs(records, online, entry.deviceId) > 0
    ? "Waits as long as the screens that follow, so beats land together."
    : "Hears the music itself and draws at once.";
}

/** The line under a TV's Quality row: what it draws at, and what its own GPU
 *  test picks (the roster's `autoQuality`, known only while it is online). */
export function qualityLine(entry: RosterEntry): string {
  const auto = entry.autoQuality === null ? null : PRESET_LABEL[entry.autoQuality];
  if (entry.quality === "auto") {
    return auto === null ? "Picks a level from its own GPU test when it is online." : `Draws at ${auto}, what its own GPU test picks.`;
  }
  const at = `Draws at ${PRESET_LABEL[entry.quality]}.`;
  return auto === null ? at : `${at} Its own GPU test picks ${auto}.`;
}

/** What to say under the controls when the room refuses a change. */
export function rejectText(reason: string): string {
  switch (reason) {
    case "no-mic":
      return "This device has no microphone.";
    case "tv-off":
      return "A TV is always a screen.";
    case "bad-follow":
      return "That device isn't on its own input.";
    case "rate":
      return "Too many changes — wait a moment.";
    default:
      return "The room refused that change.";
  }
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

const GREY = "#9a9aa4";
/** Overlay stacking: above the controls panel (30) and its cables (31). */
const OVERLAY_Z = 33;
/** The overlay is stacked (diagram over inspector) below this panel width. */
const NARROW_PX = 720;
const ARM_MS = 4000;
const REJECT_MS = 4000;

const SVG_NS = "http://www.w3.org/2000/svg";

/** The select's placeholder value (an id never contains a NUL). */
const NO_CHOICE = "\u0000none";

/** Removes every child (`replaceChildren` is newer than the browsers a phone
 *  or an old iPad may still run). */
function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function toneColor(tone: ChipTone): string {
  switch (tone) {
    case "own":
    case "follow":
      return INPUT_GREEN;
    case "none":
      return HOT_RED;
    case "main":
      return SCENE_VIOLET;
    case "own-screen":
      return BANDS_AMBER;
    case "you":
      return AUTO_SKY;
    case "owner":
      return "#ffffff";
    case "off":
    case "offline":
      return GREY;
  }
}

function chipStyle(tone: ChipTone): string {
  const c = toneColor(tone);
  return (
    `display: inline-block; padding: 1px 5px; border-radius: 2px; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis;` +
    `font: 400 10px/1.4 ${FONT_MONO}; letter-spacing: 0.08em; color: ${c}; background: ${withAlpha(c, 0.1)};` +
    `border: 1px ${tone === "follow" ? "dashed" : "solid"} ${withAlpha(c, 0.55)};`
  );
}

const monoCaps = `font: 400 11px/1.4 ${FONT_MONO}; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(255,255,255,0.55);`;
const dimLine = `font: 400 12px/1.4 ${FONT_LABEL}; color: rgba(255,255,255,0.5); margin: 4px 0 0;`;

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function paintChip(el: HTMLElement, chip: Chip | null): void {
  if (!chip) {
    if (el.style.display !== "none") el.style.display = "none";
    el.dataset.k = "";
    return;
  }
  const key = `${chip.tone}|${chip.label}`;
  if (el.dataset.k === key) return;
  el.dataset.k = key;
  el.textContent = chip.label;
  el.style.cssText = chipStyle(chip.tone);
}

function box(css: string): HTMLDivElement {
  const d = document.createElement("div");
  d.style.cssText = css;
  return d;
}

/** A small CSS drawing of a device kind; `pane` is the part that tints with
 *  the device's screen choice. */
function drawDevice(kind: DeviceKind): { el: HTMLElement; pane: HTMLElement } {
  const line = "rgba(255,255,255,0.65)";
  const wrap = box("height: 48px; display: flex; flex-direction: column; align-items: center; justify-content: center;");
  const pane = box("");
  if (kind === "laptop") {
    pane.style.cssText = `width: 56px; height: 35px; box-sizing: border-box; border: 2px solid ${line}; border-radius: 3px 3px 0 0;`;
    const base = box(`width: 70px; height: 4px; background: ${line}; border-radius: 0 0 4px 4px;`);
    wrap.append(pane, base);
  } else if (kind === "tablet") {
    pane.style.cssText = `width: 48px; height: 36px; box-sizing: border-box; border: 2px solid ${line}; border-radius: 6px;`;
    wrap.append(pane);
  } else if (kind === "phone") {
    pane.style.cssText = `width: 22px; height: 40px; box-sizing: border-box; border: 2px solid ${line}; border-radius: 5px;`;
    wrap.append(pane);
  } else {
    pane.style.cssText = `width: 64px; height: 36px; box-sizing: border-box; border: 2px solid ${line}; border-radius: 2px;`;
    const stand = box(`width: 20px; height: 4px; background: ${line}; margin-top: 2px; border-radius: 1px;`);
    wrap.append(pane, stand);
  }
  return { el: wrap, pane };
}

function paneTint(use: RosterEntry["screen"]): string {
  return use === "main" ? withAlpha(SCENE_VIOLET, 0.3) : use === "own" ? withAlpha(BANDS_AMBER, 0.3) : "transparent";
}

interface NodeEls {
  root: HTMLElement;
  shapeHolder: HTMLElement;
  shape: { el: HTMLElement; pane: HTMLElement };
  kind: DeviceKind;
  name: HTMLElement;
  ears: HTMLElement;
  screen: HTMLElement;
  tagEls: { you: HTMLElement; owner: HTMLElement; offline: HTMLElement };
}

interface Segmented {
  el: HTMLElement;
  set(value: string, disabled: Record<string, string>, accent: (value: string) => string): void;
}

function segmented(items: Array<{ value: string; label: string }>, pick: (value: string) => void): Segmented {
  const el = box("display: inline-flex; border: 1px solid rgba(255,255,255,0.2); border-radius: 3px; overflow: hidden;");
  el.setAttribute("role", "group");
  const buttons = new Map<string, HTMLButtonElement>();
  for (const it of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = it.label;
    b.addEventListener("click", () => {
      if (b.disabled || b.getAttribute("aria-pressed") === "true") return;
      pick(it.value);
    });
    buttons.set(it.value, b);
    el.appendChild(b);
  }
  return {
    el,
    set(value, disabled, accent) {
      for (const [v, b] of buttons) {
        const on = v === value;
        const off = disabled[v] !== undefined;
        const c = on ? accent(v) : "#fff";
        b.disabled = off;
        b.title = off ? disabled[v] : "";
        b.setAttribute("aria-pressed", on ? "true" : "false");
        b.style.cssText =
          `padding: 6px 12px; border: 0; border-right: 1px solid rgba(255,255,255,0.12); cursor: ${off ? "not-allowed" : "pointer"};` +
          `font: 400 12px/1.2 ${FONT_LABEL}; letter-spacing: 0.04em; color: ${on ? c : "rgba(255,255,255,0.7)"};` +
          `background: ${on ? withAlpha(c, 0.18) : "transparent"}; opacity: ${off ? 0.35 : 1};`;
      }
    },
  };
}

/** Builds the Room view and appends its (hidden) overlay to the page. */
export function createRoomView(deps: RoomViewDeps): RoomView {
  let open = false;
  let roster: RosterEntry[] = deps.getRoster();
  let selected: string = deps.selfId;

  // ---- overlay shell ------------------------------------------------------
  const root = box(
    `position: fixed; inset: 0; z-index: ${OVERLAY_Z}; display: none; align-items: center; justify-content: center;` +
      `background: rgba(0,0,0,0.55); color: #fff; font-family: ${FONT_LABEL};`,
  );
  // 90dvh, not just 90vh: Safari's vh is the toolbar-hidden height, so a
  // vh-sized dialog centred here could push its close button off the top.
  // Browsers without dvh drop that declaration and keep the vh one.
  const panel = box(
    `position: relative; box-sizing: border-box; width: min(980px, 96vw); max-height: 90vh; max-height: 90dvh; overflow-y: auto; padding: 16px 18px 18px;` +
      `background: ${GLASS_BG}; -webkit-backdrop-filter: ${GLASS_FILTER}; backdrop-filter: ${GLASS_FILTER};` +
      `border: 1px solid rgba(255,255,255,0.13); border-top-color: rgba(255,255,255,0.22); border-radius: 3px;`,
  );
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Room");

  // ---- head ---------------------------------------------------------------
  const head = box("display: flex; align-items: center; gap: 14px; margin-bottom: 12px;");
  const headTitle = box(`${monoCaps} color: #fff; font-size: 13px;`);
  const headCount = box(`${monoCaps} flex: 1;`);
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "×";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.style.cssText = `border: 0; background: transparent; color: #fff; font: 400 24px/1 ${FONT_LABEL}; cursor: pointer; padding: 0 4px;`;
  closeBtn.addEventListener("click", hide);
  head.append(headTitle, headCount, closeBtn);

  // ---- body: diagram + inspector -----------------------------------------
  const body = box("display: flex; gap: 18px; align-items: flex-start;");
  const diagramWrap = box("flex: 1 1 auto; min-width: 0;");
  const diagram = box(
    `position: relative; width: 100%; box-sizing: border-box; border: 1px solid rgba(255,255,255,0.1); border-radius: 3px; background: rgba(0,0,0,0.25); overflow: hidden;`,
  );
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.style.cssText = "position: absolute; left: 0; top: 0; pointer-events: none; z-index: 0;";
  const mainNode = box(
    `position: absolute; left: 50%; top: 10px; transform: translateX(-50%); z-index: 1; box-sizing: border-box; width: 180px; padding: 6px 10px; text-align: center;` +
      `border: 1px solid ${SCENE_VIOLET}; border-radius: 3px; background: ${withAlpha("#0b0b10", 0.85)};`,
  );
  const mainTitle = box(`font: 400 13px/1.2 ${FONT_MONO}; letter-spacing: 0.18em; color: ${SCENE_VIOLET};`);
  mainTitle.textContent = "MAIN";
  const mainSub = box(`font: 400 11px/1.3 ${FONT_LABEL}; color: rgba(255,255,255,0.6);`);
  mainSub.textContent = "the room’s look";
  mainNode.append(mainTitle, mainSub);
  const emptyNote = box(`position: absolute; left: 0; right: 0; top: ${MAIN_BAND_H + 20}px; text-align: center; ${dimLine}`);
  emptyNote.textContent = "No devices yet.";
  diagram.append(svg, mainNode, emptyNote);
  diagramWrap.appendChild(diagram);

  const inspector = box("flex: 0 0 300px; min-width: 0; box-sizing: border-box;");
  body.append(diagramWrap, inspector);

  // ---- inspector ----------------------------------------------------------
  const nameLabel = box(monoCaps);
  nameLabel.textContent = "Name";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.maxLength = DEVICE_LIMITS.maxNameChars;
  nameInput.autocomplete = "off";
  nameInput.spellcheck = false;
  nameInput.setAttribute("aria-label", "Device name");
  nameInput.style.cssText =
    `width: 100%; box-sizing: border-box; margin-top: 4px; padding: 7px 9px; color: #fff; background: rgba(0,0,0,0.35);` +
    `border: 1px solid rgba(255,255,255,0.2); border-radius: 3px; font: 400 15px/1.2 ${FONT_LABEL}; outline: none;`;
  let nameShownFor: string | null = null;
  /** Puts the shown device's stored name back in the field, so closing the view
   *  mid-edit doesn't save the half-typed one when the field blurs. */
  function revertName(): void {
    const d = roster.find((r) => r.deviceId === selected);
    if (d) nameInput.value = d.name;
  }
  nameInput.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") nameInput.blur();
    else if (e.key === "Escape") {
      revertName();
      hide();
    }
  });
  nameInput.addEventListener("change", () => {
    const d = roster.find((r) => r.deviceId === selected);
    const cleaned = cleanName(nameInput.value);
    if (!d) return;
    if (cleaned === undefined) {
      nameInput.value = d.name;
      return;
    }
    if (cleaned !== d.name) deps.setDevice(d.deviceId, { name: cleaned });
  });

  const kindEl = box(`${monoCaps} margin-top: 8px;`);

  const earsLabel = box(`${monoCaps} margin-top: 16px; margin-bottom: 4px; color: ${INPUT_GREEN};`);
  earsLabel.textContent = "Ears";
  const earsSeg = segmented(
    [
      { value: "own", label: "Own input" },
      { value: "follow", label: "Follow" },
    ],
    (v) => {
      const d = roster.find((r) => r.deviceId === selected);
      if (!d) return;
      const patch: DeviceSetPatch | null = v === "own" ? { ears: "own" } : followPatch(d, roster);
      if (!patch) {
        showMessage("No other device has its own input yet.");
        paintAll(); // put the segmented control back on what the room says
        return;
      }
      showMessage("");
      if (d.deviceId === deps.selfId) deps.onSelfEars?.(patch);
      deps.setDevice(d.deviceId, patch);
    },
  );
  const feedRow = box("margin-top: 8px;");
  const feedLabel = box(`font: 400 12px/1.4 ${FONT_LABEL}; color: rgba(255,255,255,0.7); margin-bottom: 3px;`);
  feedLabel.textContent = "Listen through";
  const feedSelect = document.createElement("select");
  feedSelect.setAttribute("aria-label", "Listen through");
  feedSelect.style.cssText =
    `width: 100%; box-sizing: border-box; padding: 6px 8px; color: #fff; background: #15151b; border: 1px solid rgba(255,255,255,0.2);` +
    `border-radius: 3px; font: 400 13px/1.2 ${FONT_LABEL};`;
  const feedNone = box(dimLine);
  feedNone.textContent = "No device has its own input yet.";
  feedRow.append(feedLabel, feedSelect, feedNone);
  const earsNote = box(dimLine);
  feedSelect.addEventListener("change", () => {
    const d = roster.find((r) => r.deviceId === selected);
    if (!d || feedSelect.value === NO_CHOICE) return;
    deps.setDevice(d.deviceId, { follow: feedSelect.value === OWNER_FEED_VALUE ? null : feedSelect.value });
  });
  let feedKey = "";

  const screenLabel = box(`${monoCaps} margin-top: 16px; margin-bottom: 4px; color: ${SCENE_VIOLET};`);
  screenLabel.textContent = "Screen";
  const screenSeg = segmented(
    [
      { value: "main", label: "Main" },
      { value: "own", label: "Own" },
      { value: "off", label: "Off" },
    ],
    (v) => {
      const d = roster.find((r) => r.deviceId === selected);
      if (d && (v === "main" || v === "own" || v === "off")) deps.setDevice(d.deviceId, { screen: v });
    },
  );
  const screenNote = box(dimLine);

  // Only a TV's: every other device sets its own Quality in its panel.
  const qualityRow = box("");
  const qualityLabel = box(`${monoCaps} margin-top: 16px; margin-bottom: 4px; color: ${POWER_TEAL};`);
  qualityLabel.textContent = "Quality";
  const qualitySeg = segmented(
    QUALITY_OPTIONS.map((o) => ({ value: o.choice, label: o.text })),
    (v) => {
      const d = roster.find((r) => r.deviceId === selected);
      const quality = parseQuality(v);
      if (d && quality) deps.setDevice(d.deviceId, { quality });
    },
  );
  const qualityNote = box(dimLine);
  qualityRow.append(qualityLabel, qualitySeg.el, qualityNote);

  const timingRow = box(`display: flex; justify-content: space-between; margin-top: 16px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.1);`);
  const timingLabel = box(monoCaps);
  timingLabel.textContent = "Picture delay";
  const timingValue = box(`font: 400 13px/1.4 ${FONT_MONO}; color: #fff;`);
  timingRow.append(timingLabel, timingValue);
  const timingNote = box(dimLine);

  const messageEl = box(`min-height: 1.4em; margin-top: 10px; font: 400 12px/1.4 ${FONT_LABEL}; color: ${HOT_RED};`);

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.style.cssText = "display: none;";
  let removeArmedFor: string | null = null;
  let removeTimer = 0;
  function disarmRemove(): void {
    removeArmedFor = null;
    window.clearTimeout(removeTimer);
  }
  removeBtn.addEventListener("click", () => {
    const d = roster.find((r) => r.deviceId === selected);
    if (!d || !deps.forgetDevice) return;
    if (removeArmedFor === d.deviceId) {
      disarmRemove();
      deps.forgetDevice(d.deviceId);
      paintRemove();
      return;
    }
    removeArmedFor = d.deviceId;
    window.clearTimeout(removeTimer);
    removeTimer = window.setTimeout(() => {
      removeArmedFor = null;
      paintRemove();
    }, ARM_MS);
    paintRemove();
  });
  function paintRemove(): void {
    const d = roster.find((r) => r.deviceId === selected);
    const can = !!deps.forgetDevice && deps.isOwner && !!d && d.deviceId !== deps.selfId;
    if (!can || !d) {
      removeBtn.style.cssText = "display: none;";
      return;
    }
    const armed = removeArmedFor === d.deviceId;
    setText(removeBtn, armed ? `Click again to remove ${d.name}` : "Remove from room");
    removeBtn.style.cssText =
      `display: block; margin-top: 14px; padding: 7px 12px; border-radius: 3px; cursor: pointer; font: 400 12px/1.2 ${FONT_LABEL};` +
      `color: ${armed ? "#fff" : HOT_RED}; background: ${armed ? withAlpha(HOT_RED, 0.55) : "transparent"}; border: 1px solid ${withAlpha(HOT_RED, 0.7)};`;
  }

  inspector.append(
    nameLabel,
    nameInput,
    kindEl,
    earsLabel,
    earsSeg.el,
    feedRow,
    earsNote,
    screenLabel,
    screenSeg.el,
    screenNote,
    qualityRow,
    timingRow,
    timingNote,
    messageEl,
    removeBtn,
  );

  // ---- footer: QR, typed code, finish -------------------------------------
  const footer = box("display: flex; gap: 22px; flex-wrap: wrap; align-items: flex-start; margin-top: 16px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,0.1);");
  const qrBox = box("display: none; flex-direction: column; align-items: center; gap: 6px;");
  const qrCanvas = document.createElement("canvas");
  qrCanvas.style.cssText = "background: #fff; padding: 8px; border-radius: 4px; display: block;";
  const qrCaption = box(monoCaps);
  qrCaption.textContent = "Scan to join";
  // The controller QR can be swapped for the keyed watch-only link (a
  // spectator: sees the room, sends nothing), as the old pairing overlay did.
  let watchOnly = false;
  const watchBtn = document.createElement("button");
  watchBtn.type = "button";
  watchBtn.style.cssText = `background: none; border: 0; padding: 2px 4px; cursor: pointer; color: inherit; opacity: 0.6; text-decoration: underline; font: 400 12px/1.2 ${FONT_LABEL};`;
  watchBtn.addEventListener("click", () => {
    watchOnly = !watchOnly;
    drawInvite();
  });
  qrBox.append(qrCanvas, qrCaption, watchBtn);

  const footRight = box("flex: 1 1 260px; min-width: 0; display: flex; flex-direction: column; gap: 14px;");
  if (deps.adoptTv) {
    const addBox = box("display: flex; flex-direction: column; gap: 6px; align-items: flex-start;");
    const addLabel = box(monoCaps);
    addLabel.textContent = "Add a TV by its code";
    const entry = createRoomCodeEntry({ compact: true, adoptTv: deps.adoptTv, onEscape: hide });
    // The field says the same thing as the label above it.
    const inner = entry.querySelector("label");
    if (inner) inner.style.display = "none";
    entry.style.alignItems = "flex-start";
    addBox.append(addLabel, entry);
    footRight.appendChild(addBox);
  }
  let paintFinish: (() => void) | null = null;
  let finishArmed = false;
  let finishTimer = 0;
  if (deps.finish) {
    const fin = deps.finish;
    const b = document.createElement("button");
    b.type = "button";
    const paint = (): void => {
      b.textContent = finishArmed && fin.confirm ? fin.confirm : fin.label;
      b.style.cssText =
        `align-self: flex-start; padding: 8px 14px; border-radius: 3px; cursor: pointer; font: 400 12px/1.2 ${FONT_LABEL}; letter-spacing: 0.04em;` +
        `color: ${finishArmed ? "#fff" : HOT_RED}; background: ${finishArmed ? withAlpha(HOT_RED, 0.55) : "transparent"}; border: 1px solid ${withAlpha(HOT_RED, 0.7)};`;
    };
    paint();
    paintFinish = paint;
    b.addEventListener("click", () => {
      if (fin.confirm && !finishArmed) {
        finishArmed = true;
        paint();
        window.clearTimeout(finishTimer);
        finishTimer = window.setTimeout(() => {
          finishArmed = false;
          paint();
        }, ARM_MS);
        return;
      }
      window.clearTimeout(finishTimer);
      finishArmed = false;
      paint();
      fin.run();
    });
    footRight.appendChild(b);
  }
  footer.append(qrBox, footRight);

  panel.append(head, body, footer);
  root.appendChild(panel);
  root.addEventListener("click", (e) => {
    if (e.target === root) hide();
  });
  document.body.appendChild(root);

  // ---- nodes --------------------------------------------------------------
  const nodes = new Map<string, NodeEls>();

  function select(id: string): void {
    if (selected === id) return;
    selected = id;
    disarmRemove();
    messageEl.textContent = "";
    paintAll();
  }

  function makeNode(entry: RosterEntry): NodeEls {
    const el = document.createElement("div");
    el.setAttribute("role", "button");
    el.tabIndex = 0;
    el.style.cssText =
      `position: absolute; z-index: 1; box-sizing: border-box; width: ${NODE_W}px; height: ${NODE_H}px; transform: translate(-50%, -50%);` +
      `padding: 8px 6px; display: flex; flex-direction: column; align-items: center; gap: 5px; cursor: pointer; border-radius: 3px;` +
      `background: ${withAlpha("#0b0b10", 0.88)}; overflow: hidden;`;
    el.addEventListener("click", () => select(entry.deviceId));
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        select(entry.deviceId);
      }
    });
    const shapeHolder = box("");
    const shape = drawDevice(entry.kind);
    shapeHolder.appendChild(shape.el);
    const name = box(`font: 400 14px/1.2 ${FONT_LABEL}; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`);
    const chipRow = box("display: flex; flex-wrap: wrap; justify-content: center; gap: 3px; max-width: 100%;");
    const ears = document.createElement("span");
    const screen = document.createElement("span");
    const you = document.createElement("span");
    const owner = document.createElement("span");
    const offline = document.createElement("span");
    chipRow.append(ears, screen, you, owner, offline);
    el.append(shapeHolder, name, chipRow);
    diagram.appendChild(el);
    return { root: el, shapeHolder, shape, kind: entry.kind, name, ears, screen, tagEls: { you, owner, offline } };
  }

  function paintNode(n: NodeEls, entry: RosterEntry): void {
    if (n.kind !== entry.kind) {
      n.shape = drawDevice(entry.kind);
      clear(n.shapeHolder);
      n.shapeHolder.appendChild(n.shape.el);
      n.kind = entry.kind;
    }
    const tint = paneTint(entry.screen);
    if (n.shape.pane.style.backgroundColor !== tint) n.shape.pane.style.backgroundColor = tint;
    setText(n.name, entry.name);
    const chips = chipsFor(entry, roster, deps.selfId);
    paintChip(n.ears, chips.ears);
    paintChip(n.screen, chips.screen);
    paintChip(n.tagEls.you, chips.tags.find((t) => t.tone === "you") ?? null);
    paintChip(n.tagEls.owner, chips.tags.find((t) => t.tone === "owner") ?? null);
    paintChip(n.tagEls.offline, chips.tags.find((t) => t.tone === "offline") ?? null);
    const sel = entry.deviceId === selected;
    n.root.style.border = sel ? `1px dashed ${AUTO_SKY}` : "1px solid rgba(255,255,255,0.14)";
    n.root.style.opacity = entry.online ? "1" : "0.5";
    n.root.setAttribute("aria-label", `${entry.name}${sel ? ", selected" : ""}`);
    n.root.setAttribute("aria-pressed", sel ? "true" : "false");
  }

  /** Owner first, then the room's order. */
  function orderedRoster(): RosterEntry[] {
    const owners = roster.filter((d) => d.owner);
    const rest = roster.filter((d) => !d.owner);
    return owners.concat(rest);
  }

  let boxW = 0;
  let boxH = 0;
  let positions = new Map<string, { x: number; y: number }>();

  function layout(): void {
    const ordered = orderedRoster();
    const narrow = panel.clientWidth > 0 && panel.clientWidth < NARROW_PX;
    body.style.flexDirection = narrow ? "column" : "row";
    body.style.alignItems = narrow ? "stretch" : "flex-start";
    inspector.style.flex = narrow ? "0 0 auto" : "0 0 300px";
    const w = diagram.clientWidth || 600;
    const h = diagramHeight(ordered.length, w, narrow);
    diagram.style.height = `${h}px`;
    boxW = w;
    boxH = h;
    const pts = layoutNodes(ordered.length, w, h, narrow);
    positions = new Map();
    ordered.forEach((d, i) => {
      positions.set(d.deviceId, pts[i]);
      const n = nodes.get(d.deviceId);
      if (!n) return;
      n.root.style.left = `${pts[i].x}%`;
      n.root.style.top = `${pts[i].y}%`;
    });
    drawLines();
  }

  function addLine(x1: number, y1: number, x2: number, y2: number, color: string, dashed: boolean): void {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(x1));
    line.setAttribute("y1", String(y1));
    line.setAttribute("x2", String(x2));
    line.setAttribute("y2", String(y2));
    line.setAttribute("stroke", color);
    line.setAttribute("stroke-width", "1.5");
    line.setAttribute("stroke-opacity", "0.7");
    if (dashed) line.setAttribute("stroke-dasharray", "5 4");
    svg.appendChild(line);
  }

  function drawLines(): void {
    clear(svg);
    svg.setAttribute("width", String(boxW));
    svg.setAttribute("height", String(boxH));
    const { records } = recordsFromRoster(roster);
    const centre = (id: string): { x: number; y: number } | null => {
      const p = positions.get(id);
      // The drawn device sits in the upper part of its node.
      return p ? { x: (p.x / 100) * boxW, y: (p.y / 100) * boxH - NODE_H / 2 + 32 } : null;
    };
    const mainFrom = { x: boxW / 2, y: 10 + 44 };
    for (const d of roster) {
      const to = centre(d.deviceId);
      if (!to) continue;
      if (d.screen === "main") addLine(mainFrom.x, mainFrom.y, to.x, to.y, SCENE_VIOLET, false);
    }
    for (const d of roster) {
      if (d.ears !== "own") continue;
      const from = centre(d.deviceId);
      if (!from) continue;
      for (const fid of followersOf(records, d.deviceId)) {
        const to = centre(fid);
        if (to) addLine(from.x, from.y, to.x, to.y, INPUT_GREEN, true);
      }
    }
  }

  // ---- paint everything from the roster -----------------------------------
  function paintAll(): void {
    // Hidden: nothing to draw; show() paints from the latest roster.
    if (!open) return;
    // Keep the selection valid: a forgotten device falls back to this one.
    if (!roster.some((d) => d.deviceId === selected)) {
      selected = roster.some((d) => d.deviceId === deps.selfId) ? deps.selfId : roster.length > 0 ? roster[0].deviceId : deps.selfId;
    }
    setText(headTitle, `ROOM · ${deps.roomCode() ?? "—"}`);
    setText(headCount, deviceCountText(roster));

    const seen = new Set<string>();
    for (const d of orderedRoster()) {
      seen.add(d.deviceId);
      let n = nodes.get(d.deviceId);
      if (!n) {
        n = makeNode(d);
        nodes.set(d.deviceId, n);
      }
      paintNode(n, d);
    }
    for (const [id, n] of nodes) {
      if (seen.has(id)) continue;
      n.root.remove();
      nodes.delete(id);
    }
    emptyNote.style.display = roster.length === 0 ? "block" : "none";
    layout();
    paintInspector();
  }

  function paintInspector(): void {
    const d = roster.find((r) => r.deviceId === selected);
    inspector.style.opacity = d ? "1" : "0.4";
    inspector.style.pointerEvents = d ? "auto" : "none";
    if (!d) return;
    // A selection change always shows the new name; otherwise leave the field
    // alone while it is being typed in.
    if (nameShownFor !== d.deviceId || document.activeElement !== nameInput) {
      if (nameInput.value !== d.name) nameInput.value = d.name;
      nameShownFor = d.deviceId;
    }
    setText(kindEl, kindLine(d, deps.selfId));

    earsSeg.set(d.ears, d.hasMic ? {} : { own: "This device has no microphone" }, () => INPUT_GREEN);
    const following = d.ears === "follow";
    feedRow.style.display = following ? "block" : "none";
    if (following) {
      const choices = feedChoices(roster, d.deviceId);
      const key = choices.map((c) => `${c.value}\u0000${c.label}`).join("\u0001");
      if (key !== feedKey) {
        feedKey = key;
        clear(feedSelect);
        const none = document.createElement("option");
        none.value = NO_CHOICE;
        none.textContent = "— choose —";
        none.disabled = true;
        feedSelect.appendChild(none);
        for (const c of choices) {
          const o = document.createElement("option");
          o.value = c.value;
          o.textContent = c.label;
          feedSelect.appendChild(o);
        }
      }
      const want = currentFeedValue(d, roster);
      const has = choices.some((c) => c.value === want);
      if (document.activeElement !== feedSelect) feedSelect.value = has ? want : NO_CHOICE;
      feedSelect.style.display = choices.length > 0 ? "block" : "none";
      feedLabel.style.display = choices.length > 0 ? "block" : "none";
      feedNone.style.display = choices.length > 0 ? "none" : "block";
    }
    setText(
      earsNote,
      following ? `Uses that device’s analysis over the room, ${RENDER_DELAY_MS} ms behind it.` : "Hears the music itself. No network delay and the full analysis.",
    );

    screenSeg.set(d.screen, d.kind === "tv" ? { off: "A TV is always a screen" } : {}, (v) =>
      v === "main" ? SCENE_VIOLET : v === "own" ? BANDS_AMBER : GREY,
    );
    setText(
      screenNote,
      d.screen === "main"
        ? "Shows the room’s Main look. Changes arrive when someone presses Play."
        : d.screen === "own"
          ? "Keeps this device’s own look. Play skips it."
          : "No picture. The device is a remote.",
    );

    qualityRow.style.display = d.kind === "tv" ? "block" : "none";
    if (d.kind === "tv") {
      qualitySeg.set(d.quality, {}, () => POWER_TEAL);
      setText(qualityNote, qualityLine(d));
    }

    const { records, online } = recordsFromRoster(roster);
    setText(timingValue, `${pictureDelayMs(records, online, d.deviceId)} ms`);
    setText(timingNote, delayReason(d, roster));
    paintRemove();
  }

  // ---- rejects ------------------------------------------------------------
  let messageTimer = 0;
  /** One line under the controls in HOT_RED for REJECT_MS; "" clears it. */
  function showMessage(text: string): void {
    window.clearTimeout(messageTimer);
    setText(messageEl, text);
    if (text !== "") messageTimer = window.setTimeout(() => setText(messageEl, ""), REJECT_MS);
  }

  // The subscriptions live as long as the page; nothing tears the view down.
  deps.onDeviceReject((m) => {
    if (!open) return;
    if (m.targetId !== null && m.targetId !== selected) return;
    showMessage(rejectText(m.reason));
  });

  /** The selected device's settings as one string, to tell when a change to
   *  it has landed: a refusal said about an earlier try is stale by then. */
  function selectedKey(): string {
    const d = roster.find((r) => r.deviceId === selected);
    return d ? `${d.name}|${d.ears}|${d.follow ?? ""}|${d.screen}|${d.quality}` : "";
  }

  deps.onRosterChange((r) => {
    const before = selectedKey();
    roster = r;
    if (selectedKey() !== before) showMessage("");
    paintAll();
  });

  // ---- open / close -------------------------------------------------------
  function drawInvite(): void {
    const invite = deps.invite();
    if (!invite || !invite.code) {
      qrBox.style.display = "none";
      return;
    }
    // Only a keyed controller link has a watch-only twin.
    const canWatch = invite.kind === "controller" && !!invite.info?.key;
    const watching = canWatch && watchOnly;
    drawQrCode(qrCanvas, joinUrlFor(invite.code, watching ? "renderer" : invite.kind, invite.info), 168);
    qrCaption.textContent = watching ? "Scan to watch" : "Scan to join";
    watchBtn.textContent = watching ? "control link" : "watch-only link";
    watchBtn.style.display = canWatch ? "block" : "none";
    qrBox.style.display = "flex";
  }

  /** Escape closes the view and nothing else: this listener is on the window
   *  in the capture phase and stops the event there, so it never reaches the
   *  page's own Escape (back to the gallery, leave fullscreen, unpin a card). */
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.target === nameInput) revertName();
    hide();
  };
  const onResize = (): void => {
    if (open) layout();
  };
  let ro: ResizeObserver | null = null;

  function show(): void {
    if (open) return;
    ensureControlsStyles();
    open = true;
    roster = deps.getRoster();
    root.style.display = "flex";
    drawInvite();
    paintAll();
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onResize);
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(onResize);
      ro.observe(panel);
    }
  }

  function hide(): void {
    if (!open) return;
    open = false;
    root.style.display = "none";
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", onResize);
    ro?.disconnect();
    ro = null;
    disarmRemove();
    finishArmed = false;
    window.clearTimeout(finishTimer);
    if (paintFinish) paintFinish();
  }

  return {
    show,
    hide,
    toggle() {
      if (open) hide();
      else show();
    },
    isOpen: () => open,
  };
}
