/**
 * What the visualizer itself is costing this device, right now: the three
 * numbers the Power card's Readouts show next to FPS (ui/powerCard.ts).
 *
 *  - Main thread: how much of the wall clock the page's own per-frame JS
 *    (audio analysis, drives, the panel, the scene's draw calls) kept the
 *    main thread busy, as a fraction of one core. Measured around tick() in
 *    app.ts, summed over a window rather than averaged per tick, so the
 *    ticks the render-rate cap skips count as the cheap ticks they are.
 *    It is not the OS's CPU figure — other threads (the audio worklet, the
 *    browser's compositor) and other processes are not in it.
 *  - GPU: the time the scene's own draw took on the GPU, from
 *    EXT_disjoint_timer_query_webgl2 around scene.render (same query
 *    tools/gpu-bench.mjs uses). Only the scene — the browser's compositing
 *    of the page, the Panel blur (glassPref.ts) and any second window are
 *    not in it. Absent where the browser does not expose the extension
 *    (Safari, Firefox), and then the readout says so with "--".
 *  - JS heap: performance.memory.usedJSHeapSize, Chrome-only. GPU memory
 *    has no web API, so it is not here.
 *
 * Nothing runs unless the caller asks: the timer query is only begun while
 * `wanted` is true (the panel is open), and each part is a few arithmetic
 * ops. The numbers are readouts for a human; nothing in the renderer reads
 * them back, so they can never change what is drawn.
 */

/** How long the main-thread busy time is summed before it is published. */
const WINDOW_MS = 1000;
/** A published main-thread load older than this is reported as unknown —
 *  the tab went to the background and rAF stopped, so the number is stale. */
const STALE_MS = 3000;
/** GPU readings are smoothed, as the governor's frame time is: one slow
 *  frame should not make the readout jump. */
const GPU_EWMA_ALPHA = 0.15;
/** Queries in flight at once. Results arrive a frame or two late; more than
 *  this means the GPU is far behind and new queries would only pile up. */
const MAX_PENDING = 4;

export interface ResourceSnapshot {
  /** Main-thread busy time as a fraction of wall time, 0..1 (can briefly read
   *  a hair over 1 on a window that straddles a long task). Null until the
   *  first window completes or once it has gone stale. */
  cpuLoad: number | null;
  /** Smoothed GPU time of the scene's draw per rendered frame, in ms. Null
   *  where the extension is missing or no result has arrived yet. */
  gpuMs: number | null;
  /** Used JS heap in MB, or null outside Chrome. */
  heapMb: number | null;
}

/** The slice of EXT_disjoint_timer_query_webgl2 this file uses; TypeScript's
 *  DOM lib has no type for the extension. */
interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

export interface ResourceMeter {
  /** One pass of the main loop took `busyMs`, and ended at `nowMs`. */
  recordTick(busyMs: number, nowMs: number): void;
  /** Wrap the scene's draw: `begin` before it, `end` right after. Both are
   *  no-ops (and no query is created) while `wanted` is false. */
  beginGpu(wanted: boolean): void;
  endGpu(): void;
  snapshot(nowMs: number): ResourceSnapshot;
}

/** `gl` may be null (a test, or a context that never came up); GPU time then
 *  just stays unknown. */
export function createResourceMeter(gl: WebGL2RenderingContext | null): ResourceMeter {
  // ---- main thread ----
  let windowStart = -1;
  let windowBusy = 0;
  let load: number | null = null;
  let loadAt = 0;

  // ---- GPU ----
  const ext = gl ? (gl.getExtension("EXT_disjoint_timer_query_webgl2") as TimerExt | null) : null;
  const pending: WebGLQuery[] = [];
  let active: WebGLQuery | null = null;
  let gpuMs: number | null = null;

  function drainQueries(): void {
    if (!gl || !ext) return;
    if (gl.isContextLost()) {
      // The queries died with the context; the next begin starts fresh.
      pending.length = 0;
      active = null;
      return;
    }
    while (pending.length > 0) {
      const q = pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      pending.shift();
      // A disjoint event (a GPU reset, a power-state change) invalidates
      // every result issued around it; reading the flag also clears it.
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
      if (!disjoint) {
        const ms = (gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6;
        gpuMs = gpuMs === null ? ms : gpuMs + (ms - gpuMs) * GPU_EWMA_ALPHA;
      }
      gl.deleteQuery(q);
    }
  }

  return {
    recordTick(busyMs, nowMs) {
      if (windowStart < 0) windowStart = nowMs - busyMs;
      windowBusy += busyMs;
      const span = nowMs - windowStart;
      if (span >= WINDOW_MS) {
        load = Math.min(1.5, windowBusy / span);
        loadAt = nowMs;
        windowStart = nowMs;
        windowBusy = 0;
      }
    },

    beginGpu(wanted) {
      if (!gl || !ext) return;
      drainQueries();
      if (!wanted || active || pending.length >= MAX_PENDING || gl.isContextLost()) return;
      const q = gl.createQuery();
      if (!q) return;
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      active = q;
    },

    endGpu() {
      if (!gl || !ext || !active) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push(active);
      active = null;
    },

    snapshot(nowMs) {
      const mem = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory;
      return {
        cpuLoad: load !== null && nowMs - loadAt <= STALE_MS ? load : null,
        gpuMs,
        heapMb: mem?.usedJSHeapSize ? mem.usedJSHeapSize / (1024 * 1024) : null,
      };
    },
  };
}
