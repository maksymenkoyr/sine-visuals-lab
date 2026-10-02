/**
 * Sends a TV's browser that opens the plain site to the paired display page
 * (tv.html, served at /tv) instead of the full app, which wants a microphone
 * and a pointer that a TV doesn't have.
 *
 * Only "open the site" redirects: a link that means something else (a room,
 * a controller or TV QR, anything `planBoot` reads as other than `host-new`)
 * boots as it reads, so a spectator link opened on a TV still works. `?notv`
 * opts out for that load, for a TV-looking browser that really wants the app.
 * The hash is dropped: tv.html has no routes, and the query carries no room
 * by construction, so nothing else needs to travel.
 *
 * Detection is the user agent alone, matched only on tokens that TV browsers
 * send and phones, tablets and desktops don't (`TV_UA_RE`). A TV that sends a
 * desktop agent just gets the app, which is where it would have landed anyway.
 */

import { planBoot } from "./bootPlan.ts";

/** Samsung (Tizen "SMART-TV"), LG (webOS "Web0S"/"NetCast"), Sony, Philips,
 *  Hisense (VIDAA), Sharp, HbbTV sets, Android/Google TV, Fire TV (AFT*),
 *  Chromecast, Roku, and the generic "SmartTV"/"Smart-TV"/"TV Safari" tokens. */
const TV_UA_RE =
  /SMART-?TV|SmartTV|Web0S|webOS\.TV|NetCast|HbbTV|BRAVIA|Philips ?TV|NETTV|VIDAA|AQUOSBrowser|Android ?TV|GoogleTV|Google TV|\bAFT[A-Z]|CrKey|Roku|TV Safari|Large Screen/i;

export function isTvUserAgent(ua: string): boolean {
  return TV_UA_RE.test(ua);
}

/** Where this page load should go instead, or null to boot here. */
export function tvRedirectTarget(search: string, ua: string): string | null {
  if (!isTvUserAgent(ua)) return null;
  if (new URLSearchParams(search).has("notv")) return null;
  if (planBoot(search, null).kind !== "host-new") return null;
  return `/tv${search}`;
}
