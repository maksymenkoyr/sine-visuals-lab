import type { RemoteState } from "../net/remoteLink.ts";

/**
 * The two small bits of Remote control chrome that aren't the panel itself
 * (what the feature is: net/remoteSync.ts's header):
 *  - `hostBadgeText` / `remoteBadgeText`: the text of the #roomCode chip — on
 *    the host, whether remote control is allowed and how many remotes are
 *    linked (clicking it opens the code/QR and allows it); on a remote, the
 *    link state.
 *  - `createJoinChip`: the gallery's "Join room" entry, where a laptop or
 *    phone types the host's code and becomes a remote.
 */

export function hostBadgeText(code: string, armed: boolean, linked: number): string {
  if (!armed) return "REMOTE CONTROL · OFF · click to allow";
  return `REMOTE CONTROL · ${code} · ${linked === 1 ? "1 remote" : `${linked} remotes`}`;
}

export function remoteBadgeText(code: string, state: RemoteState): string {
  switch (state) {
    case "linked":
      return `REMOTE · ${code} · linked`;
    case "denied":
      return `REMOTE · ${code} · waiting for the host to allow it`;
    case "offline":
      return `REMOTE · ${code} · reconnecting…`;
    default:
      return `REMOTE · ${code} · connecting…`;
  }
}

/** Room codes are 4 characters from server/worker.ts's alphabet; typing is forgiving about case and spaces. */
export function normalizeRoomCode(raw: string): string | null {
  const code = raw.replace(/\s+/g, "").toUpperCase();
  return /^[A-Z2-9]{4}$/.test(code) ? code : null;
}

export interface JoinChip {
  setVisible(visible: boolean): void;
}

export function createJoinChip(onJoin: (code: string) => void): JoinChip {
  const root = document.createElement("form");
  root.style.cssText = `
    position: fixed; left: 16px; bottom: 16px; z-index: 6; display: none; gap: 6px; align-items: center;
    font: 400 11px/1 "Share Tech Mono", ui-monospace, monospace; letter-spacing: 0.14em;
  `;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "JOIN ROOM";
  const input = document.createElement("input");
  input.placeholder = "CODE";
  input.maxLength = 8;
  input.autocomplete = "off";
  input.setAttribute("aria-label", "Room code of the host to control");
  const chip = `
    height: 34px; border-radius: 3px; border: 1px solid rgba(255,255,255,0.16);
    background: rgba(8,11,10,0.45); color: rgba(255,255,255,0.8); font: inherit; letter-spacing: inherit;
    backdrop-filter: blur(18px) saturate(0.6) brightness(0.5); -webkit-backdrop-filter: blur(18px) saturate(0.6) brightness(0.5);
  `;
  btn.style.cssText = `${chip} padding: 0 12px; cursor: pointer;`;
  input.style.cssText = `${chip} display: none; width: 88px; padding: 0 10px; text-transform: uppercase; outline: none;`;
  root.append(btn, input);
  document.body.appendChild(root);

  btn.addEventListener("click", () => {
    input.style.display = "block";
    btn.textContent = "GO";
    if (input.value === "") input.focus();
    else root.requestSubmit();
  });
  root.addEventListener("submit", (e) => {
    e.preventDefault();
    const code = normalizeRoomCode(input.value);
    if (!code) {
      input.style.borderColor = "#f9b96c";
      return;
    }
    onJoin(code);
  });
  // Typing letters here must not fire the app's single-key shortcuts.
  input.addEventListener("keydown", (e) => e.stopPropagation());

  return {
    setVisible(v) {
      root.style.display = v ? "flex" : "none";
    },
  };
}
