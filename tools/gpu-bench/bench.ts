// The page half of tools/gpu-bench.mjs (see its header): renders real scene
// modules into a fixed-size canvas on a deterministic synthetic feed and
// publishes the result on window.__bench. Query: scenes=<id,id>, w, h,
// frames, and dump=<frame,frame> to return raw RGBA frames instead of times.
import { NUM_BANDS, type FeatureFrame } from "../../src/audio/types.ts";
import { createAnimClock } from "../../src/render/animClock.ts";
import { qualitySettings } from "../../src/render/quality.ts";
import { PALETTES } from "../../src/render/palette.ts";
import { FULL_VIEWPORT, type Scene } from "../../src/render/scene.ts";
import * as sceneModules from "../../src/render/scenes/index.ts";

const params = new URLSearchParams(location.search);
const ids = (params.get("scenes") ?? "caustics").split(",");
const w = Number(params.get("w") ?? 1920);
const h = Number(params.get("h") ?? 1080);
const frames = Number(params.get("frames") ?? 60);
const dumpAt = params.get("dump")?.split(",").map(Number) ?? null;

const canvas = document.createElement("canvas");
canvas.width = w;
canvas.height = h;
document.body.appendChild(canvas);
const gl = canvas.getContext("webgl2", { antialias: false, alpha: false })!;
const ctx = { gl, quality: qualitySettings("high") };
const px = new Uint8Array(4);
const timer = gl.getExtension("EXT_disjoint_timer_query_webgl2") as { TIME_ELAPSED_EXT: number } | null;

const scenes = Object.values(sceneModules).filter(
  (s): s is Scene => typeof s === "object" && s !== null && "id" in s && "render" in s,
);

// Ends the render pass. Without it a tile-based GPU (every Apple GPU) hidden-
// surface-removes a frame's opaque fragments under the next frame's full-
// screen draw, and a batch of N frames only pays for one.
const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);

async function bench(id: string) {
  const scene = scenes.find((s) => s.id === id);
  if (!scene) throw new Error(`no scene "${id}" — have ${scenes.map((s) => s.id).join(", ")}`);
  scene.init(ctx);
  const clock = createAnimClock();
  const bands = new Float32Array(NUM_BANDS);
  let t = 0;
  const dt = 1 / 60;
  // 120 bpm onsets over a gently moving spectrum — fixed steps, so the same
  // frame index renders the same picture on every run (what dump= relies on).
  const step = () => {
    t += dt;
    const beat = t % 0.5 < dt;
    for (let i = 0; i < NUM_BANDS; i++) bands[i] = 0.4 + 0.3 * Math.sin(t * 3 + i) + (beat ? 0.3 : 0);
    const frame: FeatureFrame = { time: t, bands, energy: 0.6, level: 0.6, onset: beat, pulseOnset: beat, bpm: 120, onsetPhase: 0 };
    const anim = clock.advance(dt, frame);
    gl.viewport(0, 0, w, h);
    scene.render(ctx, frame, FULL_VIEWPORT, PALETTES[0], anim);
  };

  if (dumpAt) {
    const full = new Uint8Array(w * h * 4);
    const shots: string[] = [];
    for (let i = 1; i <= Math.max(...dumpAt); i++) {
      step();
      if (!dumpAt.includes(i)) continue;
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, full);
      let bin = "";
      for (let j = 0; j < full.length; j += 0x8000) bin += String.fromCharCode(...full.subarray(j, j + 0x8000));
      shots.push(btoa(bin));
    }
    scene.dispose(ctx);
    return { id, shots };
  }

  for (let i = 0; i < 20; i++) { step(); sync(); } // compile + warm up
  const queries: WebGLQuery[] = [];
  const wall: number[] = [];
  for (let i = 0; i < frames; i++) {
    const t0 = performance.now();
    const q = gl.createQuery()!;
    if (timer) gl.beginQuery(timer.TIME_ELAPSED_EXT, q);
    step();
    if (timer) gl.endQuery(timer.TIME_ELAPSED_EXT);
    queries.push(q);
    sync();
    wall.push(performance.now() - t0);
  }
  const gpu: number[] = [];
  for (const q of queries) {
    for (let k = 0; k < 50 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++) await new Promise((r) => setTimeout(r, 20));
    if (timer) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
    gl.deleteQuery(q);
  }
  scene.dispose(ctx);
  const median = (a: number[]) => (a.length ? +a.sort((x, y) => x - y)[a.length >> 1].toFixed(2) : null);
  return { id, gpuMs: median(gpu), wallMs: median(wall), glError: gl.getError() };
}

(async () => {
  const results = [];
  for (const id of ids) results.push(await bench(id));
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
  (window as unknown as { __bench: unknown }).__bench = { renderer, timerQuery: !!timer, w, h, results };
})().catch((e) => ((window as unknown as { __bench: unknown }).__bench = { error: String(e?.stack ?? e) }));
