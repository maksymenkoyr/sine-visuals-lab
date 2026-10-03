import { drawQrCode } from "./qr.ts";
import { isValidRoomCode, normalizeRoomCodeInput } from "../net/roomCode.ts";
import type { AdoptOutcome } from "../net/adopt.ts";

/**
 * Which pairing screen this is, and so which link its QR encodes (what each
 * link means when scanned is decided by src/net/bootPlan.ts):
 * - `host`: for a device (a phone) that should supply the mic for someone
 *   else's room.
 * - `renderer`: an existing host inviting spectators to join as mic-less
 *   renderers — scanning it must not create a second competing host in the
 *   same room. A claimed room needs its key in the link.
 * - `controller`: the laptop's QR; the phone that scans it controls the room.
 *   It carries the room key.
 * - `adopt`: a TV's QR; the phone that scans it hands the TV to its room. The
 *   "code" is the TV's own pairing slot and the link carries its one-shot nonce.
 */
export type JoinKind = "host" | "renderer" | "controller" | "adopt";

/** The secrets a link may carry: the room key (`renderer`, `controller`) or the
 *  TV's nonce (`adopt`). Left out, the link simply doesn't carry one. */
export interface JoinLinkInfo {
  key?: string;
  nonce?: string;
}

/** `origin` is read from `location` only when not passed, so tests in node can
 *  supply their own. The query always comes before any hash: src/app.ts reads
 *  `location.search`, and a query after the `#` silently lands on the gallery. */
export function joinUrlFor(code: string, kind: JoinKind, info: JoinLinkInfo = {}, origin: string = location.origin): string {
  let query: string;
  switch (kind) {
    case "host":
      query = `room=${code}&role=host`;
      break;
    case "renderer":
      query = `room=${code}${info.key ? `&k=${encodeURIComponent(info.key)}` : ""}`;
      break;
    case "controller":
      query = `room=${code}&role=controller${info.key ? `&k=${encodeURIComponent(info.key)}` : ""}`;
      break;
    case "adopt":
      query = `adopt=${code}${info.nonce ? `&n=${encodeURIComponent(info.nonce)}` : ""}`;
      break;
  }
  return `${origin}/?${query}`;
}

/** What typing a code into a keyed room's field did: the room's answer
 *  (net/adopt.ts), or `own-room` when the code is this room's own, which no
 *  screen can be waiting under. */
export type AddScreenOutcome = AdoptOutcome | "own-room";

export interface JoinScreenOptions {
  /** The paired display: it can only ever render someone else's room, so the
   *  field offers one plain Join. Every other device also picks whether it
   *  supplies the music or just watches. */
  tv?: boolean;
  /** An on-demand overlay (not the TV's always-on one): Escape, a tap on the
   *  backdrop, or the Close button hides it. Left out, the `controller` and
   *  `renderer` kinds are dismissible and the others are not. */
  dismissible?: boolean;
  /** Hands a screen waiting under a typed code to this device's room; see
   *  `RoomCodeEntryOptions.adoptTv`. */
  adoptTv?: (slot: string) => Promise<AddScreenOutcome>;
  /** A button under the field that starts over (the laptop's Reset room, a
   *  spectator's Leave). With `confirm`, the first click only swaps its label
   *  to that and a second click within RESET_CONFIRM_MS runs it. */
  reset?: { label: string; confirm?: string; run: () => void };
}

/** How long a Reset that asked for a second click waits for it. */
const RESET_CONFIRM_MS = 4000;

export interface JoinScreen {
  setCode(code: string, info?: JoinLinkInfo): void;
  show(): void;
  hide(): void;
}

const TITLES: Record<JoinKind, string> = {
  host: "Scan to start the music",
  renderer: "Scan to join the room",
  controller: "Scan to control from your phone",
  adopt: "Scan with your phone to add this screen",
};

/** The QR's side in px for the screen it is on: 280 where there is height to
 *  spare, down to a floor that still scans (cells stay whole pixels). */
function qrTargetPx(): number {
  return Math.max(150, Math.min(280, Math.floor(window.innerHeight * 0.42)));
}

/** What the line under the code shows. The link itself can hold a secret and the
 *  QR already carries it, so never print it: a screenshot of the screen would
 *  hand it over as text. The plain kinds are typeable, so they show their
 *  (secret-free) link; the others show only which site the QR opens. */
function hintFor(code: string, kind: JoinKind, origin: string): string {
  const url = kind === "host" || kind === "renderer" ? joinUrlFor(code, kind, {}, origin) : origin;
  return url.replace(/^https?:\/\//, "");
}

/**
 * Fullscreen pairing overlay: big code + QR, and below them a field to type a
 * room's code instead of scanning — on every device, since a TV can't scan and
 * a desktop has no camera. The TV entry shows the `adopt` kind until a phone
 * has paired it; the laptop (and a phone hosting or watching a room) expands
 * its small room-code badge into the `controller` / `renderer` kind on demand.
 *
 * `controller` and `renderer` overlays are dismissible by default (they sit over
 * a working visualizer): Escape, a tap on the empty backdrop, or the Close
 * button hides them, and nothing else does — they hold a text field, so they
 * stay up until asked. `adopt` and `host` stay up until the caller hides them
 * (`hide()`), since nothing is behind them yet. The `controller` overlay also
 * offers a "watch-only link" that swaps its QR for the spectator link and back,
 * so the old way to invite someone to just watch survives next to the one that
 * gives them the controls.
 *
 * A typed code on its own proves nothing, so joining a room by it only works for
 * a room that has no key (the old, unclaimed rooms — server/roomRules.ts
 * `decideJoin`); a laptop's keyed room still needs its QR. The other direction
 * works: a laptop or phone that holds a keyed room can type a TV's code, and
 * `adoptTv` hands that waiting screen to its room without the QR's nonce
 * (server/roomCore.ts `adopt` has when the room refuses that). On such a
 * device the field does only that — see `createRoomCodeEntry`.
 */
export function createJoinScreen(
  kind: JoinKind,
  container: HTMLElement = document.body,
  options: JoinScreenOptions = {},
): JoinScreen {
  const dismissible = options.dismissible ?? (kind === "controller" || kind === "renderer");

  // The column is taller than a 720p laptop or a 540p TV once the field is in
  // it, so the spacing and the big code shrink with the screen's height, and
  // what still doesn't fit scrolls: the auto margins on the first and last row
  // centre the stack when there is room and let it start at the top when there
  // isn't (`justify-content: center` would clip both ends out of reach).
  const root = document.createElement("div");
  root.style.cssText = `
    position: fixed; inset: 0; z-index: 20; box-sizing: border-box; overflow-y: auto;
    display: none; flex-direction: column; align-items: center;
    gap: 20px; gap: clamp(8px, 2vh, 20px); background: #000; color: #fff;
    font-family: system-ui, sans-serif; text-align: center; padding: 24px; padding: clamp(12px, 3vh, 24px);
  `;

  const title = document.createElement("div");
  // Fixed size first as a fallback for TV browsers without clamp() (pre-Chrome 79); clamp() wins where supported.
  title.style.cssText =
    "margin-top: auto; font-weight: 600; opacity: 0.85; font-size: 22px; font-size: clamp(16px, 2.6vw, 26px);";

  const qrCanvas = document.createElement("canvas");
  qrCanvas.style.cssText = "background: #fff; padding: 12px; border-radius: 8px; flex: none;";

  const codeEl = document.createElement("div");
  codeEl.style.cssText = `
    font-weight: 700; font-family: ui-monospace, monospace; letter-spacing: 0.12em;
    font-size: 64px; font-size: clamp(32px, min(9vw, 11vh), 110px);
    line-height: 1;
  `;

  const hint = document.createElement("div");
  hint.style.cssText =
    "font-family: ui-monospace, monospace; opacity: 0.5; font-size: 13px; font-size: clamp(11px, 1.4vw, 15px);";

  root.append(title, qrCanvas, codeEl, hint);

  let code = "";
  let info: JoinLinkInfo = {};
  // Which link the controller overlay is showing; always false for the other kinds.
  let watchOnly = false;
  let toggle: HTMLButtonElement | null = null;

  function render(): void {
    const shown: JoinKind = watchOnly ? "renderer" : kind;
    title.textContent = watchOnly ? "Scan to watch on your phone" : TITLES[kind];
    if (toggle) toggle.textContent = watchOnly ? "control link" : "watch-only link";
    codeEl.textContent = code;
    if (code) drawQrCode(qrCanvas, joinUrlFor(code, shown, info), qrTargetPx());
    hint.textContent = code ? hintFor(code, shown, location.origin) : "";
  }
  // The QR is as big as the screen's height allows (up to 280), so the field
  // under it stays on a short screen; a re-measure when the window changes.
  window.addEventListener("resize", () => {
    if (root.style.display !== "none") render();
  });

  if (kind === "controller") {
    toggle = document.createElement("button");
    toggle.type = "button";
    toggle.style.cssText = `
      background: none; border: 0; padding: 4px 8px; cursor: pointer;
      color: inherit; opacity: 0.6; text-decoration: underline;
      font-family: system-ui, sans-serif; font-size: 14px; font-size: clamp(12px, 1.5vw, 16px);
    `;
    // Swaps the QR in place. It is not a dismiss: only a tap on the bare
    // backdrop (below) closes the overlay.
    toggle.addEventListener("click", () => {
      watchOnly = !watchOnly;
      render();
    });
    root.appendChild(toggle);
  }

  // ---- The typed-code field ----
  // On every kind, below the QR: a TV can't scan and a desktop has no camera.
  const entry = createRoomCodeEntry({ tv: options.tv, adoptTv: options.adoptTv, onEscape: dismissible ? () => api.hide() : undefined });
  root.appendChild(entry);

  if (options.reset) {
    const { label, confirm, run } = options.reset;
    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.textContent = label;
    resetBtn.style.cssText = `
      font: 600 14px system-ui, sans-serif; font-size: clamp(13px, 1.5vw, 16px);
      padding: 8px 16px; border-radius: 999px; cursor: pointer; flex: none;
      color: ${PROBLEM_COLOR}; background: transparent; border: 1px solid ${PROBLEM_COLOR}66;
    `;
    let armedUntil = 0;
    let disarm = 0;
    resetBtn.addEventListener("click", () => {
      if (!confirm || performance.now() < armedUntil) {
        window.clearTimeout(disarm);
        run();
        return;
      }
      armedUntil = performance.now() + RESET_CONFIRM_MS;
      resetBtn.textContent = confirm;
      disarm = window.setTimeout(() => (resetBtn.textContent = label), RESET_CONFIRM_MS);
    });
    root.appendChild(resetBtn);
  }
  // The last row's auto margin centres the column (see `root`).
  (root.lastElementChild as HTMLElement).style.marginBottom = "auto";

  if (dismissible) {
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    // Pinned to the corner, out of the column: it stays reachable while a short screen scrolls.
    close.style.cssText =
      "position: fixed; top: 14px; right: 14px; font: 600 14px system-ui, sans-serif; padding: 6px 14px; border-radius: 999px; cursor: pointer; color: #fff; background: transparent; border: 1px solid #fff4;";
    close.addEventListener("click", () => api.hide());
    root.appendChild(close);
    // A tap on the empty backdrop (not on the QR, field or buttons) closes it.
    root.addEventListener("click", (e) => {
      if (e.target === root) api.hide();
    });
    // Capture phase, so this Escape closes the overlay and isn't also read by
    // the page's own Escape (which leaves the scene).
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Escape" || root.style.display === "none") return;
        e.stopImmediatePropagation();
        api.hide();
      },
      true,
    );
  }
  container.appendChild(root);
  render();

  const api: JoinScreen = {
    setCode(next: string, nextInfo: JoinLinkInfo = {}) {
      code = next;
      info = nextInfo;
      render();
    },
    show() {
      // Always open on the control link; the spectator link is the exception.
      if (watchOnly) {
        watchOnly = false;
        render();
      }
      root.style.display = "flex";
    },
    hide() {
      root.style.display = "none";
    },
  };
  return api;
}

const PROBLEM_COLOR = "#ff8a80";
const OK_COLOR = "#8be9a8";

export interface RoomCodeEntryOptions {
  /** The paired display: one plain Join, which reloads tv.html with `?room=`.
   *  Every other device picks whether it supplies the music or just watches. */
  tv?: boolean;
  /** The device holds a keyed room, so a code typed here is a TV's, waiting on
   *  its QR screen: this hands that screen to the room (`postAdopt` with no
   *  nonce, since a typed code has none). With it the field only adds screens —
   *  one "Add screen" button, and a code that finds no screen says so and how
   *  to get one, instead of leaving for that code as a room: every other room
   *  is keyed too, a code alone would be refused there, and the device would
   *  have walked out of its own room for nothing. Left out, the field only
   *  joins rooms. */
  adoptTv?: (slot: string) => Promise<AddScreenOutcome>;
  /** Escape pressed in the field; left out, Escape does nothing there. */
  onEscape?: () => void;
  /** Smaller type, for a panel rather than a fullscreen overlay. */
  compact?: boolean;
}

/**
 * The field to type a room's code instead of scanning its QR, with its Join
 * buttons. A pick leaves the page for the room the code names (`go`). One
 * builder for every place a device can join a room by code: the pairing
 * overlay below (TV, laptop, phone) and the Room view (src/ui/roomView.ts).
 */
export function createRoomCodeEntry(options: RoomCodeEntryOptions = {}): HTMLFormElement {
  const compact = options.compact ?? false;
  const addScreen = options.adoptTv !== undefined && !options.tv ? options.adoptTv : null;
  const entry = document.createElement("form");
  entry.style.cssText = "display: flex; flex-direction: column; align-items: center; gap: 10px;";
  entry.addEventListener("submit", (e) => e.preventDefault());

  const entryLabel = document.createElement("label");
  entryLabel.textContent = addScreen ? "TV showing a code? Type it to add that screen" : "Have a code? Type it to join";
  entryLabel.style.cssText = compact
    ? "opacity: 0.6; font-size: 12px;"
    : "opacity: 0.6; font-size: 14px; font-size: clamp(13px, 1.6vw, 18px);";

  const field = document.createElement("input");
  field.type = "text";
  field.inputMode = "text";
  field.maxLength = 8; // a little slack so a spaced paste ("K7 M2") survives until normalized
  field.autocomplete = "off";
  field.autocapitalize = "characters";
  field.spellcheck = false;
  field.placeholder = "CODE";
  field.setAttribute("aria-label", "Room code");
  field.style.cssText = `
    width: 5.2em; text-align: center; text-transform: uppercase;
    font-weight: 700; font-family: ui-monospace, monospace; letter-spacing: 0.12em;
    ${compact ? "font-size: 22px;" : "font-size: 32px; font-size: clamp(26px, 4vw, 44px);"}
    color: #fff; background: #1a1a1a; border: 2px solid #fff4; border-radius: 10px;
    padding: 6px 10px; outline: none;
  `;
  field.addEventListener("focus", () => (field.style.borderColor = "#fffc"));
  field.addEventListener("blur", () => (field.style.borderColor = "#fff4"));
  // Typing here must never reach the page's single-key shortcuts (F = fullscreen, S = panel, Space = Cue).
  field.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      options.onEscape?.();
      return;
    }
    if (e.key !== "Enter") return;
    if (addScreen) void add(addScreen);
    else go(options.tv ? "renderer" : "host");
  });
  field.addEventListener("input", () => {
    field.value = normalizeRoomCodeInput(field.value);
    refresh();
  });

  // The field and its buttons share a row where the screen is wide enough and
  // wrap under it where it isn't (a phone).
  const fieldRow = document.createElement("div");
  fieldRow.style.cssText = "display: flex; gap: 10px; flex-wrap: wrap; align-items: center; justify-content: center;";

  const makeButton = (label: string, onClick: () => void, primary: boolean): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.style.cssText = `
      font: 600 16px system-ui, sans-serif; ${compact ? "font-size: 14px; padding: 8px 14px;" : "font-size: clamp(15px, 1.8vw, 20px); padding: 10px 18px;"} border-radius: 999px; cursor: pointer;
      border: 2px solid #fff6; color: ${primary ? "#000" : "#fff"}; background: ${primary ? "#fff" : "transparent"};
    `;
    b.addEventListener("click", onClick);
    return b;
  };
  const buttons = addScreen
    ? [makeButton("Add screen", () => void add(addScreen), true)]
    : options.tv
      ? [makeButton("Join", () => go("renderer"), true)]
      : [makeButton("Play music here", () => go("host"), true), makeButton("Just watch", () => go("renderer"), false)];
  fieldRow.append(field, ...buttons);

  const problem = document.createElement("div");
  problem.style.cssText = `min-height: 1.2em; font-size: ${compact ? 12 : 14}px; color: ${PROBLEM_COLOR};`;

  function refresh(): void {
    const ok = isValidRoomCode(field.value);
    for (const b of buttons) b.style.opacity = ok ? "1" : "0.5";
    problem.textContent = "";
    problem.style.color = PROBLEM_COLOR;
  }

  /** The typed code, or null after saying what is wrong with it. */
  function typedCode(): string | null {
    const typed = normalizeRoomCodeInput(field.value);
    if (isValidRoomCode(typed)) return typed;
    problem.style.color = PROBLEM_COLOR;
    problem.textContent = typed.length < 4 ? "Codes are 4 characters" : "That isn't a valid code (no 0, O, 1, I or L)";
    return null;
  }

  function go(as: "host" | "renderer"): void {
    const typed = typedCode();
    if (!typed) return;
    // The TV page re-reads ?room= itself; the main app's entry is the site root.
    location.assign(options.tv ? `${location.pathname}?room=${typed}` : joinUrlFor(typed, as));
  }

  async function add(adoptTv: (slot: string) => Promise<AddScreenOutcome>): Promise<void> {
    const typed = typedCode();
    if (!typed) return;
    const outcome = await adoptTv(typed);
    problem.style.color = outcome === "ok" ? OK_COLOR : PROBLEM_COLOR;
    problem.textContent = addScreenText(outcome, typed);
  }
  refresh();

  entry.append(entryLabel, fieldRow, problem);
  return entry;
}

/** The line under the field after an Add screen. A code that finds no screen
 *  is most often the one in a paired TV's corner (its room's), so the answer
 *  is how to get the code that works. */
export function addScreenText(outcome: AddScreenOutcome, code: string): string {
  switch (outcome) {
    case "ok":
      return "Sent to the screen";
    case "own-room":
      return `${code} is this room's own code, so a screen showing it is already here`;
    case "no-screen":
      return `No screen is waiting on ${code}. On the TV, press Reset to show its pairing code`;
    case "throttled":
      return "Too many tries, wait a minute";
    case "ambiguous":
      return "More than one screen answers to that code. Scan its QR instead";
    case "error":
      return "Couldn't reach the room";
  }
}
