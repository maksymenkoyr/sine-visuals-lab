/**
 * Pictures for the desk's pads (issue #623, plans/controls-first.md "#623
 * Pads"): one small canvas per pad, holding the last picture the desk grabbed
 * from NEXT while that pad was loaded there. desk.ts's afterDraw refreshes it
 * every couple of seconds while the pad stays on NEXT.
 *
 * The stills live only in this window's memory. They are not saved with the
 * look, so a reload shows the palette colour until the pad is on NEXT again;
 * that is the known gap the plan accepts for this build.
 */

const STILL_W = 160;
const STILL_H = 90;

interface Still {
  canvas: HTMLCanvasElement;
  /** The clock (performance.now) of the last grab. */
  at: number;
}

const stills = new Map<string, Still>();

/** Copies the scene canvas `source` into the pad's still, scaled to the still's size. */
export function capturePadStill(padId: string, source: HTMLCanvasElement, nowMs: number = performance.now()): void {
  let still = stills.get(padId);
  if (!still) {
    const canvas = document.createElement("canvas");
    canvas.width = STILL_W;
    canvas.height = STILL_H;
    still = { canvas, at: nowMs };
    stills.set(padId, still);
  }
  still.canvas.getContext("2d")?.drawImage(source, 0, 0, STILL_W, STILL_H);
  still.at = nowMs;
}

export function padStill(padId: string): HTMLCanvasElement | null {
  return stills.get(padId)?.canvas ?? null;
}

/** When the pad's still was last grabbed, on the performance.now clock; -Infinity with none. */
export function padStillAt(padId: string): number {
  return stills.get(padId)?.at ?? -Infinity;
}
