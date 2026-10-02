import { drawQrCode } from "./qr.ts";
import { isValidRoomCode, normalizeRoomCodeInput } from "../net/roomCode.ts";

/**
 * The URL a phone lands on after scanning. `role: "host"` is for a device
 * (a TV) that needs someone else to supply the mic; `role: "renderer"` is
 * for an existing host inviting spectators to join as mic-less renderers —
 * scanning it must not create a second competing host in the same room.
 */
export function joinUrlFor(code: string, role: "host" | "renderer"): string {
  const query = role === "host" ? `room=${code}&role=host` : `room=${code}`;
  return `${location.origin}/?${query}`;
}

export interface JoinScreenOptions {
  /** The paired display: it can only ever render someone else's room, so the
   *  field offers one plain Join. Every other device also picks whether it
   *  supplies the music or just watches. */
  tv?: boolean;
  /** An on-demand overlay (not the TV's always-on one): Escape, a tap on the
   *  backdrop, or the Close button hides it. */
  dismissible?: boolean;
}

export interface JoinScreen {
  setCode(code: string): void;
  show(): void;
  hide(): void;
}

/**
 * Fullscreen "scan to start" overlay: big code + QR, and below them a field
 * to type a room's code instead of scanning — on every device, since a TV
 * can't scan and a desktop has no camera. Used directly by the TV entry
 * (always shown until a host connects) and as an on-demand expansion of the
 * room-code badge elsewhere.
 */
export function createJoinScreen(
  role: "host" | "renderer",
  container: HTMLElement = document.body,
  options: JoinScreenOptions = {},
): JoinScreen {
  const root = document.createElement("div");
  root.style.cssText = `
    position: fixed; inset: 0; z-index: 20;
    display: none; flex-direction: column; align-items: center; justify-content: center;
    gap: 20px; background: #000; color: #fff;
    font-family: system-ui, sans-serif; text-align: center; padding: 24px;
  `;

  const title = document.createElement("div");
  title.textContent = role === "host" ? "Scan to start the music" : "Scan to join the room";
  // Fixed size first as a fallback for TV browsers without clamp() (pre-Chrome 79); clamp() wins where supported.
  title.style.cssText = "font-weight: 600; opacity: 0.85; font-size: 22px; font-size: clamp(16px, 2.6vw, 26px);";

  const qrCanvas = document.createElement("canvas");
  qrCanvas.style.cssText = "background: #fff; padding: 12px; border-radius: 8px;";

  const codeEl = document.createElement("div");
  codeEl.style.cssText = `
    font-weight: 700; font-family: ui-monospace, monospace; letter-spacing: 0.12em;
    font-size: 64px; font-size: clamp(40px, 9vw, 110px);
    line-height: 1;
  `;

  const hint = document.createElement("div");
  hint.style.cssText =
    "font-family: ui-monospace, monospace; opacity: 0.5; font-size: 13px; font-size: clamp(11px, 1.4vw, 15px);";

  const entry = document.createElement("form");
  entry.style.cssText = "display: flex; flex-direction: column; align-items: center; gap: 10px;";
  entry.addEventListener("submit", (e) => e.preventDefault());

  const entryLabel = document.createElement("label");
  entryLabel.textContent = "Have a code? Type it to join";
  entryLabel.style.cssText = "opacity: 0.6; font-size: 14px; font-size: clamp(13px, 1.6vw, 18px);";

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
    font-size: 32px; font-size: clamp(26px, 4vw, 44px);
    color: #fff; background: #1a1a1a; border: 2px solid #fff4; border-radius: 10px;
    padding: 6px 10px; outline: none;
  `;
  field.addEventListener("focus", () => (field.style.borderColor = "#fffc"));
  field.addEventListener("blur", () => (field.style.borderColor = "#fff4"));
  // Typing here must never reach the page's single-key shortcuts (F = fullscreen, S = panel, Space = Cue).
  field.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      if (options.dismissible) api.hide();
      return;
    }
    if (e.key === "Enter") go(options.tv ? "renderer" : "host");
  });
  field.addEventListener("input", () => {
    field.value = normalizeRoomCodeInput(field.value);
    refresh();
  });

  const buttonRow = document.createElement("div");
  buttonRow.style.cssText = "display: flex; gap: 10px; flex-wrap: wrap; justify-content: center;";

  const makeButton = (label: string, as: "host" | "renderer", primary: boolean): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.style.cssText = `
      font: 600 16px system-ui, sans-serif; font-size: clamp(15px, 1.8vw, 20px);
      padding: 10px 18px; border-radius: 999px; cursor: pointer;
      border: 2px solid #fff6; color: ${primary ? "#000" : "#fff"}; background: ${primary ? "#fff" : "transparent"};
    `;
    b.addEventListener("click", () => go(as));
    return b;
  };
  const buttons = options.tv
    ? [makeButton("Join", "renderer", true)]
    : [makeButton("Play music here", "host", true), makeButton("Just watch", "renderer", false)];
  buttonRow.append(...buttons);

  const problem = document.createElement("div");
  problem.style.cssText = "min-height: 1.2em; font-size: 14px; color: #ff8a80;";

  function refresh(): void {
    const ok = isValidRoomCode(field.value);
    for (const b of buttons) b.style.opacity = ok ? "1" : "0.5";
    problem.textContent = "";
  }

  function go(as: "host" | "renderer"): void {
    const typed = normalizeRoomCodeInput(field.value);
    if (!isValidRoomCode(typed)) {
      problem.textContent = typed.length < 4 ? "Codes are 4 characters" : "That isn't a valid code (no 0, O, 1, I or L)";
      return;
    }
    // The TV page re-reads ?room= itself; the main app's entry is the site root.
    location.assign(options.tv ? `${location.pathname}?room=${typed}` : joinUrlFor(typed, as));
  }
  refresh();

  entry.append(entryLabel, field, buttonRow, problem);
  root.append(title, qrCanvas, codeEl, hint, entry);

  if (options.dismissible) {
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    close.style.cssText =
      "font: 600 14px system-ui, sans-serif; padding: 6px 14px; border-radius: 999px; cursor: pointer; color: #fff; background: transparent; border: 1px solid #fff4;";
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

  const api: JoinScreen = {
    setCode(code: string) {
      codeEl.textContent = code;
      const url = joinUrlFor(code, role);
      drawQrCode(qrCanvas, url, 280);
      hint.textContent = url.replace(/^https?:\/\//, "");
    },
    show() {
      root.style.display = "flex";
    },
    hide() {
      root.style.display = "none";
    },
  };
  return api;
}
