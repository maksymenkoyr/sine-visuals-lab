/**
 * What a page load of the app means, decided from its query string alone so
 * every link a QR or a bookmark can produce is a test case.
 *
 * The links (built by joinUrlFor in src/ui/joinScreen.ts):
 * - the laptop's controller QR: `?room=R&role=controller&k=<room key>`
 * - the TV's pairing QR:        `?adopt=T&n=<nonce>`
 * - the old spectator invite:   `?room=R` (plus `&k=` when the room is claimed)
 * - a phone hosting a TV's old room: `?room=R&role=host`
 * - nothing: the classic "open the site" flow, which hosts a new room.
 *
 * Precedence, first match wins: a valid `adopt` + `n`; then a controller
 * link; then `role=host`; then a plain room; else a new host. Room codes are
 * upper-cased before they are checked, so a link typed in lower case works.
 * Keys and nonces are case-sensitive and never touched.
 *
 * A controller link never falls through to hosting. `role=controller` with no
 * usable key, or with a room code that doesn't parse, is `need-pairing`: the
 * phone must say "scan the laptop again", not quietly turn itself into a second
 * host and start asking for the microphone. A controller link without a key is
 * fine when this phone already holds a saved session for the same room (the
 * page strips `k` from the address bar after reading it, so a reload arrives
 * exactly like that); `keyFromUrl` tells the page whether there is a fresh key
 * to save and strip.
 *
 * A TV link that doesn't parse never becomes a new host either. An `adopt` or
 * `n` that is present but not a valid pair (a damaged QR, a cropped paste) is
 * `bad-adopt-link`: the page says so, then boots as the link reads without
 * those two parameters. Where that reading is "open the site" it resumes the
 * phone's saved controller session if there is one and otherwise runs solo,
 * because nobody asked this phone to host a room.
 */

import { ROOM_CODE_RE, validKey } from "./pairing.ts";
import type { ControllerSession } from "./sessions.ts";

/** What a link means apart from a TV's QR, and so what a broken TV link can
 *  still fall back to. */
type LinkPlan =
  | { kind: "controller"; room: string; key: string; keyFromUrl: boolean }
  | { kind: "need-pairing" }
  | { kind: "renderer"; room: string; key?: string }
  | { kind: "host-join"; room: string };

export type BootPlan =
  | LinkPlan
  | { kind: "adopt"; slot: string; nonce: string }
  | { kind: "host-new" }
  /** `then` is what to boot as after telling the user the link isn't valid;
   *  `solo` is the page on its own, with no room. */
  | { kind: "bad-adopt-link"; then: LinkPlan | { kind: "solo" } };

function codeParam(params: URLSearchParams, name: string): string | null {
  const v = params.get(name);
  if (v === null) return null;
  const code = v.toUpperCase();
  return ROOM_CODE_RE.test(code) ? code : null;
}

/** The link read as if it carried no TV QR. */
function planLink(
  params: URLSearchParams,
  controllerSession: ControllerSession | null,
): LinkPlan | { kind: "host-new" } {
  const room = codeParam(params, "room");
  const role = params.get("role");
  const k = params.get("k");

  if (role === "controller") {
    if (room === null) return { kind: "need-pairing" };
    if (validKey(k)) return { kind: "controller", room, key: k, keyFromUrl: true };
    if (controllerSession && controllerSession.room === room) {
      return { kind: "controller", room, key: controllerSession.key, keyFromUrl: false };
    }
    return { kind: "need-pairing" };
  }

  if (room !== null) {
    if (role === "host") return { kind: "host-join", room };
    return validKey(k) ? { kind: "renderer", room, key: k } : { kind: "renderer", room };
  }

  return { kind: "host-new" };
}

export function planBoot(search: string, controllerSession: ControllerSession | null): BootPlan {
  const params = new URLSearchParams(search);

  const slot = codeParam(params, "adopt");
  const nonce = params.get("n");
  if (slot !== null && validKey(nonce)) return { kind: "adopt", slot, nonce };

  if (params.has("adopt") || params.has("n")) {
    params.delete("adopt");
    params.delete("n");
    const rest = planLink(params, controllerSession);
    if (rest.kind !== "host-new") return { kind: "bad-adopt-link", then: rest };
    if (!controllerSession) return { kind: "bad-adopt-link", then: { kind: "solo" } };
    const { room, key } = controllerSession;
    return { kind: "bad-adopt-link", then: { kind: "controller", room, key, keyFromUrl: false } };
  }

  return planLink(params, controllerSession);
}
