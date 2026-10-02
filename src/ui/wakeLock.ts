/** Asks the browser to keep the screen on. Every full-screen entry point
 *  (app.ts, tv.ts, output.ts) calls this on load and again whenever the tab
 *  becomes visible, because the browser drops the lock while hidden. */
export async function requestWakeLock(): Promise<void> {
  try {
    await navigator.wakeLock?.request("screen");
  } catch {
    // Not fatal — some browsers/contexts deny it; the screen may just dim.
  }
}
