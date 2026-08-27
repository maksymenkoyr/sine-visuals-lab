/**
 * Frame-grab + tile: the shared primitive behind the mark hotkey
 * (frames: 1), multi-frame contact sheets, and the clip capture below.
 * Reads the live #gl canvas directly — no offscreen render — so what's
 * captured is exactly what's on screen, at whatever resolution it's
 * actually rendering.
 */

export interface CaptureOpts {
  /** Number of frames to grab. 1 = a plain screenshot ("mark"). */
  frames?: number;
  /** Gap between grabs. Ignored when frames is 1. */
  intervalMs?: number;
  /** Tile columns. Default: ceil(sqrt(frames)), i.e. as square as possible. */
  cols?: number;
}

function getCanvas(): HTMLCanvasElement {
  const el = document.getElementById("gl");
  if (!(el instanceof HTMLCanvasElement)) throw new Error("tuning/capture: no #gl canvas found");
  return el;
}

function snapshotCanvas(): HTMLCanvasElement {
  const src = getCanvas();
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  c.getContext("2d")!.drawImage(src, 0, 0);
  return c;
}

/** Grabs `frames` snapshots of the canvas at `intervalMs` apart and tiles
 *  them left-to-right, top-to-bottom onto one offscreen canvas. Returns a
 *  PNG data URL — small enough to pass through page.evaluate() or POST
 *  straight to the dev server's /__tuning/mark endpoint. */
export async function captureSheet(opts: CaptureOpts = {}): Promise<string> {
  const frames = Math.max(1, opts.frames ?? 1);
  const intervalMs = opts.intervalMs ?? 200;
  const cols = opts.cols ?? Math.ceil(Math.sqrt(frames));
  const rows = Math.ceil(frames / cols);

  const src = getCanvas();
  const tileW = src.width;
  const tileH = src.height;

  const out = document.createElement("canvas");
  out.width = tileW * cols;
  out.height = tileH * rows;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("tuning/capture: 2d context unavailable");

  for (let i = 0; i < frames; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, intervalMs));
    const col = i % cols;
    const row = Math.floor(i / cols);
    ctx.drawImage(src, col * tileW, row * tileH, tileW, tileH);
  }

  return out.toDataURL("image/png");
}

// --- Clip buffer: a small rolling window of recent frames, so a "clip"
// capture can include what led up to the button press, not just what came
// after it. Off by default — nothing here runs until startClipBuffer() is
// called (wired to the UI switch in ui.ts), so it costs nothing unless
// explicitly turned on.

interface RingSlot {
  canvas: HTMLCanvasElement;
  filled: boolean;
}

let ring: RingSlot[] = [];
let ringWriteIndex = 0;
let ringTimer: ReturnType<typeof setInterval> | null = null;

export function isClipBufferRunning(): boolean {
  return ringTimer !== null;
}

export function startClipBuffer(opts: { frames?: number; intervalMs?: number } = {}): void {
  if (ringTimer !== null) return;
  const frames = Math.max(1, opts.frames ?? 5);
  const intervalMs = opts.intervalMs ?? 200;

  const src = getCanvas();
  ring = Array.from({ length: frames }, () => {
    const c = document.createElement("canvas");
    c.width = src.width;
    c.height = src.height;
    return { canvas: c, filled: false };
  });
  ringWriteIndex = 0;

  ringTimer = setInterval(() => {
    const slot = ring[ringWriteIndex];
    slot.canvas.getContext("2d")!.drawImage(getCanvas(), 0, 0);
    slot.filled = true;
    ringWriteIndex = (ringWriteIndex + 1) % ring.length;
  }, intervalMs);
}

export function stopClipBuffer(): void {
  if (ringTimer !== null) clearInterval(ringTimer);
  ringTimer = null;
  ring = [];
}

/** Oldest-first snapshot of whatever's currently buffered. Empty if the
 *  buffer isn't running, or hasn't completed a lap yet. */
function orderedRingFrames(): HTMLCanvasElement[] {
  if (ring.length === 0) return [];
  const ordered = [...ring.slice(ringWriteIndex), ...ring.slice(0, ringWriteIndex)];
  return ordered.filter((s) => s.filled).map((s) => s.canvas);
}

export interface ClipCaptureOpts {
  /** Frames to grab *after* the trigger. Default 4. */
  afterFrames?: number;
  intervalMs?: number;
  cols?: number;
}

/** The "before and after" capture: tiles whatever's in the clip buffer
 *  (the run-up to this call) followed by `afterFrames` live grabs (the
 *  aftermath), in one grid, oldest to newest. "After" tiles get a colored
 *  border so the trigger point reads at a glance. If the buffer isn't
 *  running, this degrades to a forward-only capture — same shape as
 *  captureSheet, just with the border marking every tile. */
export async function captureClip(opts: ClipCaptureOpts = {}): Promise<string> {
  const afterFrames = Math.max(1, opts.afterFrames ?? 4);
  const intervalMs = opts.intervalMs ?? 200;

  const before = orderedRingFrames();

  const after: HTMLCanvasElement[] = [];
  for (let i = 0; i < afterFrames; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, intervalMs));
    after.push(snapshotCanvas());
  }

  const frames = [...before, ...after];
  const src = getCanvas();
  const tileW = src.width;
  const tileH = src.height;
  const cols = opts.cols ?? Math.ceil(Math.sqrt(frames.length));
  const rows = Math.ceil(frames.length / cols);
  const border = Math.max(3, Math.round(tileW * 0.01));

  const out = document.createElement("canvas");
  out.width = tileW * cols;
  out.height = tileH * rows;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("tuning/capture: 2d context unavailable");

  frames.forEach((frame, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * tileW;
    const y = row * tileH;
    ctx.drawImage(frame, x, y);
    if (i >= before.length) {
      ctx.strokeStyle = "#ff3366";
      ctx.lineWidth = border;
      ctx.strokeRect(x + border / 2, y + border / 2, tileW - border, tileH - border);
    }
  });

  return out.toDataURL("image/png");
}
