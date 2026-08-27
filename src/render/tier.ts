import { createProgram, createFullscreenQuad, drawFullscreenQuad } from "./gl.ts";

export type Tier = "high" | "mid" | "low" | "floor";

export interface TierSettings {
  tier: Tier;
  renderScale: number;
  maxParticles: number;
  raymarchSteps: number;
  bloomPasses: number;
  /** 0..1 proxy uploaded as uQuality (density/bloom scaling in shaders).
   *  Was derived ad-hoc from `tier` at render time; now a first-class field
   *  so governor.ts can step it down/up alongside renderScale and
   *  raymarchSteps without needing to know about the tier label at all. */
  quality: number;
}

const TIER_TABLE: Record<Tier, Omit<TierSettings, "tier">> = {
  high: { renderScale: 1.0, maxParticles: 200_000, raymarchSteps: 96, bloomPasses: 3, quality: 1.0 },
  mid: { renderScale: 0.75, maxParticles: 50_000, raymarchSteps: 64, bloomPasses: 2, quality: 0.7 },
  low: { renderScale: 0.5, maxParticles: 12_000, raymarchSteps: 40, bloomPasses: 1, quality: 0.4 },
  floor: { renderScale: 0.5, maxParticles: 4_000, raymarchSteps: 28, bloomPasses: 0, quality: 0.25 },
};

export function tierSettings(tier: Tier): TierSettings {
  return { tier, ...TIER_TABLE[tier] };
}

const BENCH_SIZE = 256;
const BENCH_FRAMES = 12;
// A deliberately heavy raymarch-shaped loop, so the benchmark stresses the
// same kind of fragment-shader work the actual scenes will do.
const BENCH_FRAG = `#version 300 es
precision highp float;
out vec4 outColor;
uniform float uSeed;
void main() {
  vec2 p = gl_FragCoord.xy / float(${BENCH_SIZE}) - 0.5;
  float acc = 0.0;
  vec3 pos = vec3(p * 2.0, uSeed);
  for (int i = 0; i < 200; i++) {
    pos = abs(pos) / dot(pos, pos) - 0.9;
    acc += length(pos) * 0.001;
  }
  outColor = vec4(vec3(acc), 1.0);
}`;

/**
 * Classifies this device's GPU by actually rendering a heavy fullscreen
 * shader and timing it — more reliable than UA sniffing or
 * WEBGL_debug_renderer_info, and catches a slow phone as readily as a
 * slow TV.
 */
export async function detectTier(): Promise<Tier> {
  if (typeof document === "undefined") return "mid";

  const canvas = document.createElement("canvas");
  canvas.width = BENCH_SIZE;
  canvas.height = BENCH_SIZE;
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false }) as
    | WebGL2RenderingContext
    | null;
  if (!gl) return "floor";

  try {
    const prog = createProgram(gl, BENCH_FRAG);
    const vao = createFullscreenQuad(gl);
    gl.viewport(0, 0, BENCH_SIZE, BENCH_SIZE);
    prog.use();

    // Warm up (shader compile / first-draw cost shouldn't count).
    prog.setF("uSeed", 0);
    drawFullscreenQuad(gl, vao);
    gl.finish();

    const start = performance.now();
    for (let i = 0; i < BENCH_FRAMES; i++) {
      prog.setF("uSeed", i * 0.01);
      drawFullscreenQuad(gl, vao);
    }
    gl.finish();
    const elapsedMs = performance.now() - start;
    const msPerFrame = elapsedMs / BENCH_FRAMES;

    prog.dispose();
    // Deterministically release the context rather than waiting on GC — the
    // page is about to open two more (main + gallery preview) and browsers
    // cap live WebGL contexts fairly low (iOS Safari evicts aggressively).
    gl.getExtension("WEBGL_lose_context")?.loseContext();

    // Thresholds picked so a 2018+ TV SoC lands in "low", a mid phone in
    // "mid", and a discrete/desktop GPU in "high".
    if (msPerFrame < 1.5) return "high";
    if (msPerFrame < 4) return "mid";
    return "low";
  } catch {
    return "floor";
  }
}
