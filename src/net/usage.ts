/**
 * Client half of the anonymous usage counts — server/usage.ts owns the why,
 * the wire format and what gets stored.
 *
 * One beacon when a scene first runs on live audio in this page load
 * (`start`), and one per different scene after that (`scene`). Loading the
 * page, browsing the gallery or a crawler rendering it sends nothing.
 *
 * Never sent from a dev build, localhost, or an automated browser
 * (`navigator.webdriver` — Playwright and the tools/ scripts). The owner's
 * own browsers are *marked*, not silenced: visiting with `?me=1` stores a
 * flag here, `?me=0` clears it, and events from a marked browser still go
 * out tagged `me`, so the owner can see the counter working and
 * tools/usage.mjs leaves them out of the visitor numbers.
 */
import type { UsageEvent, UsageSource } from "../../server/usage.ts";
import { isLocalHost } from "./config.ts";

const ME_KEY = "svl.usageMe";

const enabled = !import.meta.env.DEV && !isLocalHost(location.hostname) && !navigator.webdriver;

let isMe = false;
try {
  const flag = new URLSearchParams(location.search).get("me");
  if (flag === "1") localStorage.setItem(ME_KEY, "1");
  else if (flag === "0") localStorage.removeItem(ME_KEY);
  isMe = localStorage.getItem(ME_KEY) === "1";
} catch {
  // Storage blocked (private mode, sandboxed frame): counts as a visitor.
}

let lastSceneId: string | null = null;

/** A scene is on screen and live audio (or the phone's stream) is feeding it.
 *  Safe to call repeatedly — only a change of scene sends anything. */
export function reportSceneRunning(sceneId: string, src: UsageSource): void {
  if (!enabled || sceneId === lastSceneId) return;
  const event: UsageEvent = { e: lastSceneId === null ? "start" : "scene", s: sceneId, src, me: isMe ? 1 : 0 };
  lastSceneId = sceneId;
  try {
    navigator.sendBeacon("/api/usage", new Blob([JSON.stringify(event)], { type: "application/json" }));
  } catch {
    // A lost count is fine; never let it disturb the visuals.
  }
}
