/**
 * What kind of device this page is running on, and a first guess at its name,
 * so a room can list it ("iPad", "Android phone", "TV") the moment it joins.
 * The join URL carries both (src/net/room.ts `ConnOptions.device`) and the room
 * stores them as the device's record (server/roomDevices.ts).
 *
 * Everything is guessed from the user agent, plus touch points and screen size
 * where the agent lies or says nothing:
 * - a TV is whatever `isTvUserAgent` (tvRedirect.ts) calls one;
 * - an iPad is a tablet, including the iPadOS Safari that sends a desktop
 *   "Macintosh" agent and gives itself away only by having more than one touch
 *   point (no Mac has a touch screen);
 * - an Android agent without "Mobile" is a tablet, with it a phone (Chrome's
 *   own rule); iPhones, iPods and other agents that say "Mobile" are phones,
 *   unless the screen is as wide as a tablet's;
 * - everything else is a laptop (a desktop counts: it is the kind that opens
 *   a room).
 *
 * The name is only a first guess. Several iPads would all be "iPad", and a
 * Mac says nothing about whose it is, so the Room view lets anyone rename a
 * device and the room keeps the new name; the guess is used only the first time
 * a device joins.
 *
 * Every function but `thisDevice` is pure and takes what it reads, so tests
 * drive it with real agent strings in node. `thisDevice` is the one place that
 * touches `navigator` and `screen`.
 */

import { isTvUserAgent } from "./tvRedirect.ts";
import { defaultName, type DeviceKind } from "../../server/roomDevices.ts";

export interface DeviceEnv {
  userAgent: string;
  maxTouchPoints: number;
  /** Screen size in CSS pixels, either orientation. */
  screenW: number;
  screenH: number;
}

/** The short side, in CSS pixels, from which a "Mobile" agent is taken for a
 *  tablet: a phone's short side stays below it in every orientation. */
const TABLET_MIN_SIDE = 600;

function isIpad(env: DeviceEnv): boolean {
  if (/iPad/.test(env.userAgent)) return true;
  // iPadOS 13+ Safari asks for the desktop site by default and says Macintosh.
  return /Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1;
}

export function detectDeviceKind(env: DeviceEnv): DeviceKind {
  const ua = env.userAgent;
  if (isTvUserAgent(ua)) return "tv";
  if (isIpad(env)) return "tablet";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "phone" : "tablet";
  if (/iPhone|iPod/.test(ua)) return "phone";
  if (/Mobile|Windows Phone|IEMobile|BlackBerry|Opera Mini/.test(ua)) {
    return Math.min(env.screenW, env.screenH) >= TABLET_MIN_SIDE ? "tablet" : "phone";
  }
  return "laptop";
}

/** A name for a device of this kind that says what it is as plainly as the
 *  agent allows; the generic name of the kind when it says nothing. */
export function guessDeviceName(env: DeviceEnv, kind: DeviceKind): string {
  const ua = env.userAgent;
  switch (kind) {
    case "tv":
      return "TV";
    case "tablet":
      if (isIpad(env)) return "iPad";
      if (/Android/.test(ua)) return "Android tablet";
      break;
    case "phone":
      if (/iPhone|iPod/.test(ua)) return "iPhone";
      if (/Android/.test(ua)) return "Android phone";
      break;
    case "laptop":
      if (/CrOS/.test(ua)) return "Chromebook";
      if (/Windows/.test(ua)) return "Windows PC";
      if (/Macintosh/.test(ua)) return "Mac";
      if (/Linux|X11/.test(ua)) return "Linux PC";
      break;
  }
  return defaultName(kind);
}

/** This page's kind, whether it can open a microphone at all, and the guessed
 *  name: the `device` every room connection announces. */
export function thisDevice(): { kind: DeviceKind; hasMic: boolean; name: string } {
  const env: DeviceEnv = {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints || 0,
    screenW: screen.width,
    screenH: screen.height,
  };
  const kind = detectDeviceKind(env);
  return {
    kind,
    hasMic: kind !== "tv" && !!navigator.mediaDevices?.getUserMedia,
    name: guessDeviceName(env, kind),
  };
}
