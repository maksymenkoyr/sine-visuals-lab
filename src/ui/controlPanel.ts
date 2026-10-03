import type { RosterEntry } from "../net/room.ts";
import { createRoomCodeEntry, joinUrlFor, type AddScreenOutcome, type JoinKind, type JoinLinkInfo } from "./joinScreen.ts";
import { drawQrCode } from "./qr.ts";

export interface ControlPanelDeps {
  getRoster: () => RosterEntry[];
  onRosterChange: (cb: (r: RosterEntry[]) => void) => () => void;
  /** The typed-code field's way to hand a waiting TV to this room. */
  adoptTv?: (slot: string) => Promise<AddScreenOutcome>;
  /** True on the laptop, whose Cue and Play bar (ui/outputControls.ts) is what
   *  sends its look to the screens; a phone has no such bar and is told so. */
  hasCuePlay: boolean;
  /** What this device's own invite QR encodes (the same link the pairing
   *  overlay behind the room-code badge shows). Left out, or returning null,
   *  the card has no QR: a phone controller is a member of the room, not its
   *  door. */
  invite?: () => RoomInvite | null;
}

/** The room a card's QR opens: the link kind (joinScreen.ts `JoinKind`), the
 *  room code and, for a keyed room, the key the link carries. */
export interface RoomInvite {
  kind: JoinKind;
  code: string;
  info?: JoinLinkInfo;
}

export interface ControlPanel {
  toggle(): void;
}

const overlayStyle = `
  position: fixed; inset: 0; z-index: 30; display: none;
  background: #000c; color: #fff; font-family: system-ui, sans-serif;
  align-items: center; justify-content: center;
`;
const panelStyle = `
  background: #111; border: 1px solid #fff2; border-radius: 16px;
  padding: 20px; width: min(420px, 92vw); max-height: 85vh; overflow-y: auto;
`;
const rowStyle = `
  display: flex; align-items: center; gap: 8px; padding: 8px 0;
  border-bottom: 1px solid #fff1; font-size: 13px;
`;
const actionBtnStyle = `
  padding: 10px 18px; border-radius: 8px; border: 1px solid #fff2;
  background: #fff1; color: #fff; font: inherit; font-size: 13px; cursor: pointer;
`;

/** The Room panel's words for the screens the room lists: one row each. A
 *  screen is a `renderer`; the laptop itself and a phone controller are not
 *  screens. */
export function screenLabels(roster: RosterEntry[]): string[] {
  return roster.filter((d) => d.role === "renderer").map((d) => `Screen ${d.deviceId.slice(-4).toUpperCase()}`);
}

/**
 * Room panel: the screens in this room, how to send them a look, and the
 * typed-code field to add a TV that is showing a code (the same field as the
 * pairing overlay, joinScreen.ts `createRoomCodeEntry`). What the screens show
 * is not set from here: on the laptop that is the Cue and Play bar
 * (net/roomBridge.ts), which works like the pop-out's; a phone edits the look
 * directly (net/lookSync.ts).
 */
export function createControlPanel(deps: ControlPanelDeps): ControlPanel {
  const root = document.createElement("div");
  root.style.cssText = overlayStyle;

  const panel = document.createElement("div");
  panel.style.cssText = panelStyle;

  const title = document.createElement("div");
  title.textContent = "Screens";
  title.style.cssText = "font-weight: 700; font-size: 16px; margin-bottom: 12px;";

  // The invite: the QR a phone scans to join this room (as controller, for a
  // laptop's keyed room). Drawn each time the card opens, since the card is
  // display: none until then and the canvas measures nothing before that.
  const inviteBox = document.createElement("div");
  inviteBox.style.cssText =
    "display: none; flex-direction: column; align-items: center; gap: 8px; padding: 4px 0 14px; margin-bottom: 4px; border-bottom: 1px solid #fff1;";
  const inviteCanvas = document.createElement("canvas");
  inviteCanvas.style.cssText = "background: #fff; padding: 10px; border-radius: 8px;";
  const inviteCaption = document.createElement("div");
  inviteCaption.style.cssText = "font-size: 12px; opacity: 0.7;";
  inviteBox.append(inviteCanvas, inviteCaption);

  function renderInvite(): void {
    const invite = deps.invite?.() ?? null;
    if (!invite || !invite.code) {
      inviteBox.style.display = "none";
      return;
    }
    drawQrCode(inviteCanvas, joinUrlFor(invite.code, invite.kind, invite.info), 240);
    inviteCaption.textContent =
      invite.kind === "controller" ? "Scan with your phone to control this room" : "Scan with your phone to join this room";
    inviteBox.style.display = "flex";
  }

  const list = document.createElement("div");
  list.style.cssText = "font-size: 13px;";

  const hint = document.createElement("div");
  hint.style.cssText = "font-size: 12px; opacity: 0.6; line-height: 1.5; margin-top: 12px;";
  hint.textContent = deps.hasCuePlay
    ? "Hold CUE (Space) to preview your look on the screens. PLAY (Option) makes it theirs; hold Option to glide there."
    : "Whatever you change here, the screens show.";

  const joinEntry = createRoomCodeEntry({ compact: true, adoptTv: deps.adoptTv, onEscape: close });
  joinEntry.style.cssText += "margin-top: 16px; padding-top: 14px; border-top: 1px solid #fff1;";

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  closeBtn.style.cssText = actionBtnStyle + "margin-top: 12px;";
  closeBtn.addEventListener("click", close);

  panel.append(title, inviteBox, list, hint, joinEntry, closeBtn);
  root.appendChild(panel);
  root.addEventListener("click", (e) => {
    if (e.target === root) close();
  });
  document.body.appendChild(root);

  function renderList(): void {
    list.innerHTML = "";
    const labels = screenLabels(deps.getRoster());
    for (const text of labels) {
      const row = document.createElement("div");
      row.style.cssText = rowStyle;
      row.textContent = text;
      list.appendChild(row);
    }
    if (labels.length === 0) list.textContent = "No screen yet. Scan the QR, or type the code a TV shows.";
  }

  deps.onRosterChange(renderList);

  function close(): void {
    root.style.display = "none";
  }

  return {
    toggle() {
      if (root.style.display === "flex") {
        close();
      } else {
        renderInvite();
        renderList();
        root.style.display = "flex";
      }
    },
  };
}
