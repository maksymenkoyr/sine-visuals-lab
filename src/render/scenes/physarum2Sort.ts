/**
 * Physarum 2's agent re-sort: every so often, put the agents back in screen
 * order in their textures, entirely on the GPU.
 *
 * Why. Each sim step walks every agent in storage order — the sim pass
 * fragment by fragment over the agent textures, the deposit point by point
 * over gl_VertexID. Agents are seeded in random order, so neighbouring
 * threads read the trail (three sensors each) and write their deposit at
 * far-apart texels, and the GPU's caches miss on nearly every access. With
 * agents stored so that storage neighbours are screen neighbours, the same
 * step costs a fraction (docs/scenes/physarum2.md, Measurements: the CPU
 * prototype of 2026-09-26, and this module's own numbers). Agents keep
 * moving, so the order decays and is rebuilt every SORT_EVERY_STEPS steps.
 *
 * How. No readback — a CPU sort needs the agents' positions on the CPU, and
 * that getBufferSubData is a synchronous wait behind the GPU's whole backlog
 * (physarum2.ts's createPixelReadback says why). Instead, three kinds of
 * fullscreen pass, all fragment shaders over integer (RG32UI) targets, which
 * WebGL2 renders to without any extension:
 *   1. KEY_FRAG: one texel per agent slot, (screen cell, slot index) — the
 *      cell is the agent's position on a SORT_GRID_BITS-per-axis grid, in
 *      Morton order so nearby cells get nearby keys. Slots past the agent
 *      texture (the sort needs a power-of-two count) get the largest key and
 *      sort to the end.
 *   2. BITONIC_FRAG: one compare-and-swap stage of a bitonic sort network per
 *      pass (bitonicPasses lists them), ping-ponging two key targets. Ties
 *      can't happen — the slot index breaks them — so every stage is a
 *      permutation. SORT_PASSES_PER_FRAME stages run per frame, so a sort is
 *      spread over a few frames instead of one long one.
 *   3. GATHER_FRAG: slot k takes the live position and direction of the
 *      agent the sorted list puts at k, into the other half of the agents'
 *      ping-pong (the sim pass's own two-target framebuffer). The keys were
 *      taken a few frames earlier, so the order is slightly stale by the
 *      time it lands, which costs nothing: it is still a permutation of the
 *      live agents, just a slightly less tidy one.
 *
 * The picture doesn't change. A permutation moves no agent: each keeps its
 * position, heading and strain, only its slot changes. What reads a slot
 * index is statistical — the per-texel hashes (switching, wander, reseed,
 * pipette) roll the same odds wherever an agent sits, and Rebalance's
 * index-mod-strains split stays an even split (now even within each patch
 * of screen too). Slots past agentCount are simulated but never deposit; a
 * sort moves different agents into those few slots, which nothing can see.
 *
 * Failure is not fatal: if a program fails to compile or a target isn't
 * renderable, the sorter warns once and switches itself off, and the scene
 * runs exactly as it did before this module existed. `bitonicPasses`,
 * `sortLayout`, `mortonCell` and `bitonicStageCpu` are the pure JS twins of
 * the shaders' arithmetic, tested in tests/physarum2Sort.test.ts.
 */
import { createProgram, drawFullscreenQuad, type GLProgram } from "../gl.ts";

/** Cells per axis of the sort's screen grid, as a power of two. Morton keys
 *  interleave two of these, so it must stay at or under 8 (spread() below
 *  handles 8 bits) and 2 × it under 32. */
export const SORT_GRID_BITS = 7;
/** Sim steps between re-sorts (the CPU prototype measured the gain holding
 *  across a range of intervals; see the record). */
export const SORT_EVERY_STEPS = 150;
/** Sort-network stages run per frame while a sort is in flight. */
export const SORT_PASSES_PER_FRAME = 12;

export interface SortLayout {
  /** Slots sorted: the next power of two at or above the agent texture's. */
  n: number;
  /** log2(n). */
  log2n: number;
  /** The key targets' width and height (w × h = n, both powers of two). */
  w: number;
  h: number;
}

/** The key targets' shape for `slots` agent texels. Pure. */
export function sortLayout(slots: number): SortLayout {
  const want = Math.max(2, Math.floor(Number.isFinite(slots) ? slots : 2));
  const log2n = Math.ceil(Math.log2(want));
  const wBits = Math.ceil(log2n / 2);
  return { n: 2 ** log2n, log2n, w: 2 ** wBits, h: 2 ** (log2n - wBits) };
}

/** Every stage of a bitonic sort over 2^log2n items, in run order: stage
 *  (k, j) compares item i with i XOR j, ascending where i AND k is 0. Pure. */
export function bitonicPasses(log2n: number): { k: number; j: number }[] {
  const out: { k: number; j: number }[] = [];
  const n = 2 ** log2n;
  for (let k = 2; k <= n; k *= 2) {
    for (let j = k / 2; j >= 1; j /= 2) out.push({ k, j });
  }
  return out;
}

/** KEY_FRAG's spread(): the low 8 bits of v, one zero bit between each. */
function spread(v: number): number {
  let x = v & 0xff;
  x = (x | (x << 4)) & 0x0f0f;
  x = (x | (x << 2)) & 0x3333;
  x = (x | (x << 1)) & 0x5555;
  return x;
}

/** KEY_FRAG's cell key for a position in [0, 1)², on a 2^bits grid. Pure. */
export function mortonCell(x: number, y: number, bits = SORT_GRID_BITS): number {
  const g = 2 ** bits;
  const cx = Math.min(g - 1, Math.max(0, Math.floor(x * g)));
  const cy = Math.min(g - 1, Math.max(0, Math.floor(y * g)));
  return (spread(cx) | (spread(cy) << 1)) >>> 0;
}

/** BITONIC_FRAG on the CPU: one stage over (key, index) pairs, writing into
 *  `outKey`/`outIdx`. Each output slot decides alone, as a fragment does. */
export function bitonicStageCpu(
  key: Uint32Array,
  idx: Uint32Array,
  outKey: Uint32Array,
  outIdx: Uint32Array,
  k: number,
  j: number,
): void {
  for (let i = 0; i < key.length; i++) {
    const p = i ^ j;
    const aFirst = key[i]! < key[p]! || (key[i] === key[p] && idx[i]! < idx[p]!);
    const keepMin = ((i & k) === 0) === i < p;
    const fromSelf = keepMin === aFirst;
    outKey[i] = fromSelf ? key[i]! : key[p]!;
    outIdx[i] = fromSelf ? idx[i]! : idx[p]!;
  }
}

const KEY_FRAG = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D uAgentPos;
uniform float uAgentSide;
uniform float uLayoutW;
layout(location = 0) out uvec2 outKey;

float unpackUnit(vec2 c) {
  vec2 b = floor(c * 255.0 + 0.5);
  return (b.x * 256.0 + b.y) / 65535.0;
}
uint spread(uint v) {
  v &= 0xFFu;
  v = (v | (v << 4u)) & 0x0F0Fu;
  v = (v | (v << 2u)) & 0x3333u;
  v = (v | (v << 1u)) & 0x5555u;
  return v;
}

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  int w = int(uLayoutW + 0.5);
  int side = int(uAgentSide + 0.5);
  int i = c.y * w + c.x;
  if (i >= side * side) {
    outKey = uvec2(0xFFFFFFFFu, uint(i));
    return;
  }
  vec4 p = texelFetch(uAgentPos, ivec2(i % side, i / side), 0);
  vec2 pos = vec2(unpackUnit(p.rg), unpackUnit(p.ba));
  float g = ${(2 ** SORT_GRID_BITS).toFixed(1)};
  uvec2 cell = uvec2(clamp(floor(pos * g), vec2(0.0), vec2(g - 1.0)));
  outKey = uvec2(spread(cell.x) | (spread(cell.y) << 1u), uint(i));
}
`;

const BITONIC_FRAG = `#version 300 es
precision highp float;
precision highp int;
uniform highp usampler2D uKeys;
uniform float uLayoutW;
uniform float uK;
uniform float uJ;
layout(location = 0) out uvec2 outKey;

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  int w = int(uLayoutW + 0.5);
  int i = c.y * w + c.x;
  int k = int(uK + 0.5);
  int p = i ^ int(uJ + 0.5);
  uvec2 a = texelFetch(uKeys, c, 0).rg;
  uvec2 b = texelFetch(uKeys, ivec2(p % w, p / w), 0).rg;
  bool aFirst = a.x < b.x || (a.x == b.x && a.y < b.y);
  bool keepMin = ((i & k) == 0) == (i < p);
  outKey = (keepMin == aFirst) ? a : b;
}
`;

const GATHER_FRAG = `#version 300 es
precision highp float;
precision highp int;
uniform highp usampler2D uSorted;
uniform highp sampler2D uAgentPos;
uniform highp sampler2D uAgentDir;
uniform float uAgentSide;
uniform float uLayoutW;
layout(location = 0) out vec4 outPos;
layout(location = 1) out vec4 outDir;

void main() {
  ivec2 t = ivec2(gl_FragCoord.xy);
  int side = int(uAgentSide + 0.5);
  int w = int(uLayoutW + 0.5);
  int k = t.y * side + t.x;
  int src = int(texelFetch(uSorted, ivec2(k % w, k / w), 0).g);
  ivec2 s = ivec2(src % side, src / side);
  outPos = texelFetch(uAgentPos, s, 0);
  outDir = texelFetch(uAgentDir, s, 0);
}
`;

/** What one frame's advance needs from the scene. */
export interface SortTarget {
  /** The agents' live textures (the half of the ping-pong the next step reads). */
  posTex: WebGLTexture;
  dirTex: WebGLTexture;
  /** The other half's two-target framebuffer — where the gather writes. */
  dstFbo: WebGLFramebuffer;
  /** The agent textures' side. */
  side: number;
}

export interface AgentSorter {
  /** A sort is in flight (its keys taken, its gather not yet run). */
  readonly busy: boolean;
  /** Runs this frame's share of the sort, before the frame's sim steps.
   *  `stepsRun` is how many steps the previous frame ran (the cadence counts
   *  steps, not frames). True when the agents were just permuted into
   *  `dstFbo` — the caller flips which half it reads. */
  advance(gl: WebGL2RenderingContext, target: SortTarget, quad: WebGLVertexArrayObject, stepsRun: number): boolean;
  /** Forget any sort in flight and start due — a fresh dish is in random
   *  order, so the first sort should come right away. */
  reset(): void;
  dispose(gl: WebGL2RenderingContext): void;
}

export function createAgentSorter(): AgentSorter {
  let keyProg: GLProgram | null = null;
  let bitonicProg: GLProgram | null = null;
  let gatherProg: GLProgram | null = null;
  const keyTex: (WebGLTexture | null)[] = [null, null];
  const keyFbo: (WebGLFramebuffer | null)[] = [null, null];
  let layout: SortLayout | null = null;
  let layoutSide = 0;
  let passes: { k: number; j: number }[] = [];
  let failed = false;
  // -1: idle; otherwise the next bitonic stage to run (0 = right after the key pass).
  let stage = -1;
  let cur = 0;
  let stepsSince = SORT_EVERY_STEPS;
  const locs = new Map<string, WebGLUniformLocation | null>();

  function sampler(gl: WebGL2RenderingContext, prog: GLProgram, name: string, unit: number): void {
    const key = `${name}@${unit}`;
    let l = locs.get(key);
    if (l === undefined) {
      l = gl.getUniformLocation(prog.program, name);
      locs.set(key, l);
    }
    gl.uniform1i(l, unit);
  }

  function freeTargets(gl: WebGL2RenderingContext): void {
    for (let i = 0; i < 2; i++) {
      if (keyFbo[i]) gl.deleteFramebuffer(keyFbo[i]);
      if (keyTex[i]) gl.deleteTexture(keyTex[i]);
      keyFbo[i] = null;
      keyTex[i] = null;
    }
    layout = null;
    layoutSide = 0;
  }

  /** Programs once, targets per agent-texture size. False when the sorter
   *  can't run here (and has switched itself off). */
  function ensure(gl: WebGL2RenderingContext, side: number): boolean {
    if (failed) return false;
    try {
      keyProg ??= createProgram(gl, KEY_FRAG);
      bitonicProg ??= createProgram(gl, BITONIC_FRAG);
      gatherProg ??= createProgram(gl, GATHER_FRAG);
      if (layout && layoutSide === side) return true;
      freeTargets(gl);
      const l = sortLayout(side * side);
      for (let i = 0; i < 2; i++) {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG32UI, l.w, l.h);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const f = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, f);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        keyTex[i] = t;
        keyFbo[i] = f;
        if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`sort target incomplete (0x${status.toString(16)})`);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      layout = l;
      layoutSide = side;
      passes = bitonicPasses(l.log2n);
      return true;
    } catch (err) {
      console.warn("physarum2: agent re-sort disabled —", err);
      failed = true;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      return false;
    }
  }

  return {
    get busy() {
      return stage >= 0;
    },

    advance(gl, target, quad, stepsRun) {
      if (failed) return false;
      if (stage < 0) {
        stepsSince += Math.max(0, stepsRun);
        if (stepsSince < SORT_EVERY_STEPS) return false;
        if (!ensure(gl, target.side) || !layout) return false;
        // 1. Keys from the agents as they stand now.
        gl.bindFramebuffer(gl.FRAMEBUFFER, keyFbo[0]);
        gl.viewport(0, 0, layout.w, layout.h);
        keyProg!.use();
        keyProg!.setF("uAgentSide", target.side);
        keyProg!.setF("uLayoutW", layout.w);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, target.posTex);
        sampler(gl, keyProg!, "uAgentPos", 0);
        drawFullscreenQuad(gl, quad);
        cur = 0;
        stage = 0;
        stepsSince = 0;
      }
      if (!layout || layoutSide !== target.side) {
        // The agent textures were rebuilt mid-sort: start over next time.
        stage = -1;
        stepsSince = SORT_EVERY_STEPS;
        return false;
      }
      // 2. This frame's share of the network.
      const end = Math.min(passes.length, stage + SORT_PASSES_PER_FRAME);
      if (stage < end) {
        gl.viewport(0, 0, layout.w, layout.h);
        bitonicProg!.use();
        bitonicProg!.setF("uLayoutW", layout.w);
        gl.activeTexture(gl.TEXTURE0);
        sampler(gl, bitonicProg!, "uKeys", 0);
        for (; stage < end; stage++) {
          const { k, j } = passes[stage]!;
          gl.bindFramebuffer(gl.FRAMEBUFFER, keyFbo[1 - cur]);
          gl.bindTexture(gl.TEXTURE_2D, keyTex[cur]);
          bitonicProg!.setF("uK", k);
          bitonicProg!.setF("uJ", j);
          drawFullscreenQuad(gl, quad);
          cur = 1 - cur;
        }
      }
      if (stage < passes.length) {
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return false;
      }
      // 3. Sorted: move the live agents into their new slots.
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.dstFbo);
      gl.viewport(0, 0, target.side, target.side);
      gatherProg!.use();
      gatherProg!.setF("uAgentSide", target.side);
      gatherProg!.setF("uLayoutW", layout.w);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, keyTex[cur]);
      sampler(gl, gatherProg!, "uSorted", 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, target.posTex);
      sampler(gl, gatherProg!, "uAgentPos", 1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, target.dirTex);
      sampler(gl, gatherProg!, "uAgentDir", 2);
      drawFullscreenQuad(gl, quad);
      for (const unit of [gl.TEXTURE2, gl.TEXTURE1, gl.TEXTURE0]) {
        gl.activeTexture(unit);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      stage = -1;
      return true;
    },

    reset() {
      stage = -1;
      stepsSince = SORT_EVERY_STEPS;
    },

    dispose(gl) {
      freeTargets(gl);
      keyProg?.dispose();
      bitonicProg?.dispose();
      gatherProg?.dispose();
      keyProg = null;
      bitonicProg = null;
      gatherProg = null;
      locs.clear();
      stage = -1;
      stepsSince = SORT_EVERY_STEPS;
      failed = false;
    },
  };
}
