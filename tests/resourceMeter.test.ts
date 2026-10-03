import { describe, it, expect } from "vitest";
import { createResourceMeter } from "../src/render/resourceMeter.ts";

/** A GL stand-in with just the timer-query surface the meter touches. Each
 *  query's result is whatever `results` hands out, available once `ready`. */
function fakeGl(opts: { ext?: boolean; disjoint?: boolean } = {}) {
  const { ext = true, disjoint = false } = opts;
  let nextId = 1;
  const state = { active: 0, ready: true, nsNext: 4_000_000, deleted: 0, lost: false };
  const results = new Map<object, number>();
  const gl = {
    QUERY_RESULT_AVAILABLE: 1,
    QUERY_RESULT: 2,
    getExtension: (name: string) =>
      ext && name === "EXT_disjoint_timer_query_webgl2" ? { TIME_ELAPSED_EXT: 10, GPU_DISJOINT_EXT: 11 } : null,
    createQuery: () => ({ id: nextId++ }),
    beginQuery: () => {
      state.active++;
    },
    endQuery: () => {
      state.active--;
    },
    getQueryParameter: (q: object, pname: number) => {
      if (pname === 1) return state.ready;
      if (!results.has(q)) results.set(q, state.nsNext);
      return results.get(q);
    },
    getParameter: () => disjoint,
    deleteQuery: () => {
      state.deleted++;
    },
    isContextLost: () => state.lost,
  };
  return { gl: gl as unknown as WebGL2RenderingContext, state };
}

describe("createResourceMeter main thread", () => {
  it("reports unknown until a full window has passed", () => {
    const m = createResourceMeter(null);
    m.recordTick(4, 16);
    expect(m.snapshot(16).cpuLoad).toBeNull();
  });

  it("sums busy time over the window, so cheap skipped ticks count", () => {
    const m = createResourceMeter(null);
    // 60 ticks a second, each 5 ms busy: a third of the main thread.
    let t = 0;
    for (let i = 0; i < 61; i++) {
      t += 1000 / 60;
      m.recordTick(5, t);
    }
    const load = m.snapshot(t).cpuLoad!;
    expect(load).toBeGreaterThan(0.28);
    expect(load).toBeLessThan(0.35);
  });

  it("goes unknown when frames stop (a backgrounded tab)", () => {
    const m = createResourceMeter(null);
    let t = 0;
    for (let i = 0; i < 70; i++) {
      t += 16;
      m.recordTick(2, t);
    }
    expect(m.snapshot(t).cpuLoad).not.toBeNull();
    expect(m.snapshot(t + 10_000).cpuLoad).toBeNull();
  });
});

describe("createResourceMeter GPU", () => {
  it("stays unknown without the extension", () => {
    const { gl } = fakeGl({ ext: false });
    const m = createResourceMeter(gl);
    m.beginGpu(true);
    m.endGpu();
    m.beginGpu(true);
    expect(m.snapshot(0).gpuMs).toBeNull();
  });

  it("starts no query while nothing wants the number", () => {
    const { gl, state } = fakeGl();
    const m = createResourceMeter(gl);
    m.beginGpu(false);
    expect(state.active).toBe(0);
    m.endGpu();
    expect(m.snapshot(0).gpuMs).toBeNull();
  });

  it("reads a finished query as milliseconds on the next frame", () => {
    const { gl, state } = fakeGl();
    const m = createResourceMeter(gl);
    m.beginGpu(true);
    expect(state.active).toBe(1);
    m.endGpu();
    expect(state.active).toBe(0);
    expect(m.snapshot(0).gpuMs).toBeNull(); // result not read until the next begin
    m.beginGpu(true);
    expect(m.snapshot(0).gpuMs).toBeCloseTo(4, 5);
    expect(state.deleted).toBe(1);
  });

  it("waits for a query the GPU has not finished", () => {
    const { gl, state } = fakeGl();
    const m = createResourceMeter(gl);
    state.ready = false;
    m.beginGpu(true);
    m.endGpu();
    m.beginGpu(true);
    expect(m.snapshot(0).gpuMs).toBeNull();
    state.ready = true;
    m.endGpu();
    m.beginGpu(true);
    expect(m.snapshot(0).gpuMs).not.toBeNull();
  });

  it("drops results around a disjoint GPU event", () => {
    const { gl } = fakeGl({ disjoint: true });
    const m = createResourceMeter(gl);
    m.beginGpu(true);
    m.endGpu();
    m.beginGpu(true);
    expect(m.snapshot(0).gpuMs).toBeNull();
  });

  it("does not pile up queries when the GPU is far behind", () => {
    const { gl, state } = fakeGl();
    const m = createResourceMeter(gl);
    state.ready = false;
    let began = 0;
    for (let i = 0; i < 20; i++) {
      m.beginGpu(true);
      if (state.active) began++;
      m.endGpu();
    }
    expect(began).toBeLessThanOrEqual(4);
  });

  it("forgets its queries when the context is lost", () => {
    const { gl, state } = fakeGl();
    const m = createResourceMeter(gl);
    state.ready = false;
    m.beginGpu(true);
    m.endGpu();
    state.lost = true;
    m.beginGpu(true);
    expect(state.active).toBe(0);
    expect(m.snapshot(0).gpuMs).toBeNull();
  });
});
