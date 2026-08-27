import { drawQrCode } from "./qr.ts";

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

export interface JoinScreen {
  setCode(code: string): void;
  show(): void;
  hide(): void;
}

/**
 * Fullscreen "scan to start" overlay: big code + QR. Used directly by the
 * TV entry (always shown until a host connects) and as an on-demand
 * expansion of the host's small room-code badge elsewhere.
 */
export function createJoinScreen(
  role: "host" | "renderer",
  container: HTMLElement = document.body,
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

  root.append(title, qrCanvas, codeEl, hint);
  container.appendChild(root);

  return {
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
}
