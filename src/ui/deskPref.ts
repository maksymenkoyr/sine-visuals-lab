/**
 * Whether the main window turns into the control desk (ui/desk/desk.ts) while
 * a pop-out output is open, or keeps today's layout. Per device, flipped by
 * the desk's CLASSIC button and the Cue/Play bar's DESK button (app.ts
 * applyDesk). The desk stays tied to an open output either way: its LIVE
 * monitor and Play list compare against the output's program.
 *
 * Same in-memory-cache-over-localStorage pattern as glassPref.ts. It changes
 * only this window's layout, so it is never mirrored (net/syncedStores.ts
 * PRIVATE_KEYS): mirrored, the output would count a flip as a change Play
 * has yet to send.
 */

const STORAGE_KEY = "vibe.deskOn";

function loadInitial(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

let cache = loadInitial();

export function getDeskOn(): boolean {
  return cache;
}

export function setDeskOn(next: boolean): void {
  cache = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    // Not fatal — the choice just won't persist across reloads.
  }
}
