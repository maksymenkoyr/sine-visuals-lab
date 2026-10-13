import { AUTO_SKY, FONT_MONO, SCENE_VIOLET, withAlpha } from "../controlsTheme.ts";
import { watchSize } from "../onScreen.ts";
import { registerWidget, type WidgetCtx } from "./registry.ts";
import type { PanelSection } from "../../render/scene.ts";
import type { SceneSetting } from "../../render/sceneSettings.ts";
import {
  EFFECT_BLOOM,
  EFFECT_FLARE,
  EFFECT_GRAIN,
  EFFECT_PRISM,
  EFFECT_RINGS,
  EFFECT_RUN,
  EFFECT_SHIMMER,
  EFFECT_TIGHTEN,
  SHAPE_BELL,
  SPARKLE_AMOUNT_KEY,
  SPARKLE_EFFECT_HINTS,
  SPARKLE_EFFECT_KEY,
  SPARKLE_EFFECT_ROWS,
  SPARKLE_EFFECTS,
  SPARKLE_SHAPE_HINTS,
  SPARKLE_SHAPE_KEY,
  SPARKLE_SHAPE_ROWS,
  SPARKLE_SHAPES,
  sparkleEnvelope,
  type SparkleShapeParams,
} from "../../render/scenes/causticsSparkle.ts";

/**
 * Caustics' Sparkle section (src/render/scenes/caustics.ts's PANEL): the
 * Sparkle effect and Sparkle shape picks as the device menu's own rows, a
 * preview, one line saying what the pair does, then Treble sparkle and only
 * the rows the picked effect and shape use (causticsSparkle.ts's
 * SPARKLE_EFFECT_ROWS / SPARKLE_SHAPE_ROWS) — swapped in place through
 * `ctx.mountRows` when a pick changes, so the preview keeps running.
 *
 * The preview plays one hit on loop: on the right, the shape's curve
 * (sparkleEnvelope, the same function the scene runs every hit through)
 * with a playhead; on the left, a small patch of water showing the picked
 * effect at that moment. The patch is its own little WebGL2 sketch of the
 * pool — a few octaves of warped ridges and each effect redone in
 * miniature, not the scene's shader — so it shows what an effect does,
 * not exactly how the pool will look. Without WebGL2 the patch is left out
 * and the curve stays. It reads the stored settings (`ctx.get`), not what
 * Auto or the Master card make of them.
 */

/** Seconds of stillness after each loop of the shape before it plays again. */
const LOOP_GAP_SEC = 0.35;
/** The patch's on-screen size, in CSS pixels. */
const PATCH_PX = 84;
/** Vertical grid line spacing on the curve, in seconds. */
const GRID_SEC = 0.25;
const CURVE_SAMPLES = 900;

function shapeParams(ctx: WidgetCtx, spec: (key: string) => SceneSetting | undefined): SparkleShapeParams {
  const get = (key: string, fallback: number): number => {
    const s = spec(key);
    return s ? ctx.get(s) : fallback;
  };
  return {
    shape: Math.round(get(SPARKLE_SHAPE_KEY, 0)),
    length: get("sparkleLength", 0.6),
    vibration: get("sparkleVibration", 0),
    speedHz: get("sparkleSpeed", 1),
    vibDecay: get("sparkleVibDecay", 0.5),
    bounces: get("sparkleBounces", 1),
  };
}

function buildCausticsSparkle(container: HTMLElement, _section: PanelSection, ctx: WidgetCtx): void {
  const spec = (key: string): SceneSetting | undefined => ctx.specs.find((s) => s.key === key);
  const effectSpec = spec(SPARKLE_EFFECT_KEY);
  const shapeSpec = spec(SPARKLE_SHAPE_KEY);
  if (!effectSpec || !shapeSpec) return;
  ctx.mountRows(container, [{ spec: effectSpec }, { spec: shapeSpec }]);

  const box = document.createElement("div");
  box.style.cssText = "display:flex;gap:8px;align-items:stretch;padding:2px 0 4px;";
  const patch = document.createElement("canvas");
  patch.style.cssText = `width:${PATCH_PX}px;height:${PATCH_PX}px;flex:none;display:block;border-radius:4px;background:#04161f;border:1px solid rgba(255,255,255,0.08);`;
  patch.title = "One hit of the picked effect, on loop, on a small patch of water";
  const side = document.createElement("div");
  side.style.cssText = "flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;";
  const curve = document.createElement("canvas");
  curve.style.cssText = `width:100%;height:${PATCH_PX - 16}px;display:block;border-radius:4px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);`;
  curve.title = "The shape: how strong the effect is after one hit, over time. Below the line it pushes the other way.";
  const caption = document.createElement("div");
  caption.style.cssText = `font:400 10px/1.2 ${FONT_MONO};color:rgba(255,255,255,0.5);`;
  side.append(curve, caption);
  box.append(patch, side);
  const hint = document.createElement("div");
  hint.style.cssText = "font-size:11px;line-height:1.35;color:rgba(255,255,255,0.6);padding:0 0 6px;";
  const rowsHost = document.createElement("div");
  container.append(box, hint, rowsHost);

  let mounted: { dispose(): void } | null = null;
  let mountedFor = "";
  const pick = (s: SceneSetting, count: number): number => Math.min(count - 1, Math.max(0, Math.round(ctx.get(s))));
  const mountPicked = (): void => {
    const fx = pick(effectSpec, SPARKLE_EFFECTS.length);
    const sh = pick(shapeSpec, SPARKLE_SHAPES.length);
    const id = `${fx}:${sh}`;
    if (id === mountedFor) return;
    mountedFor = id;
    mounted?.dispose();
    const keys = [...new Set([SPARKLE_AMOUNT_KEY, ...SPARKLE_EFFECT_ROWS[fx], ...SPARKLE_SHAPE_ROWS[sh]])];
    const rows = keys.map(spec).filter((s): s is SceneSetting => !!s);
    mounted = ctx.mountRows(rowsHost, rows.map((s) => ({ spec: s })));
    hint.textContent = `${SPARKLE_EFFECTS[fx]}: ${SPARKLE_EFFECT_HINTS[fx]} ${SPARKLE_SHAPES[sh]}: ${SPARKLE_SHAPE_HINTS[sh]}`;
  };
  mountPicked();

  const patchView = createPatchView(patch);
  if (!patchView) patch.style.display = "none";
  const curveSize = watchSize(curve);
  ctx.onDispose(() => {
    curveSize.disconnect();
    patchView?.dispose();
  });

  const start = performance.now();
  ctx.onTick(() => {
    mountPicked();
    const params = shapeParams(ctx, spec);
    const span = params.length + LOOP_GAP_SEC;
    const t = ((performance.now() - start) / 1000) % span;
    caption.textContent = `strength after one hit · ${params.length.toFixed(2)} s`;
    drawCurve(curve, curveSize, params, t, span);
    if (!patchView) return;
    const get = (key: string): number => {
      const s = spec(key);
      return s ? ctx.get(s) : 0;
    };
    patchView.draw({
      effect: pick(effectSpec, SPARKLE_EFFECTS.length),
      env: sparkleEnvelope(t, params),
      age: t,
      length: params.length,
      amount: get(SPARKLE_AMOUNT_KEY),
      density: get("sparkleDensity"),
      grain: get("sparkleGrain"),
      size: get("sparkleSize"),
      time: (performance.now() - start) / 1000,
    });
  });
}

function drawCurve(cv: HTMLCanvasElement, size: { w: number; h: number }, p: SparkleShapeParams, t: number, span: number): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(1, Math.round(size.w * dpr));
  const H = Math.max(1, Math.round(size.h * dpr));
  if (cv.width !== W || cv.height !== H) {
    cv.width = W;
    cv.height = H;
  }
  const g = cv.getContext("2d");
  if (!g) return;
  g.clearRect(0, 0, W, H);
  const pad = 4 * dpr;
  // Only Bell swings below 0; the others get the whole height above it.
  const lo = p.shape === SHAPE_BELL ? -0.6 : -0.08;
  const hi = 1.1;
  const x = (s: number): number => pad + ((W - 2 * pad) * s) / span;
  const y = (v: number): number => H - pad - ((H - 2 * pad) * (Math.max(lo, Math.min(v, hi)) - lo)) / (hi - lo);
  g.lineWidth = 1;
  g.strokeStyle = "rgba(255,255,255,0.06)";
  for (let s = GRID_SEC; s < span; s += GRID_SEC) {
    g.beginPath();
    g.moveTo(Math.round(x(s)) + 0.5, pad);
    g.lineTo(Math.round(x(s)) + 0.5, H - pad);
    g.stroke();
  }
  g.strokeStyle = "rgba(255,255,255,0.18)";
  g.beginPath();
  g.moveTo(pad, Math.round(y(0)) + 0.5);
  g.lineTo(W - pad, Math.round(y(0)) + 0.5);
  g.stroke();
  g.beginPath();
  g.moveTo(x(0), y(0));
  for (let i = 0; i <= CURVE_SAMPLES; i++) {
    const s = (span * i) / CURVE_SAMPLES;
    g.lineTo(x(s), y(sparkleEnvelope(s, p)));
  }
  g.lineTo(x(span), y(0));
  g.closePath();
  g.fillStyle = withAlpha(SCENE_VIOLET, 0.14);
  g.fill();
  g.beginPath();
  for (let i = 0; i <= CURVE_SAMPLES; i++) {
    const s = (span * i) / CURVE_SAMPLES;
    if (i === 0) g.moveTo(x(s), y(sparkleEnvelope(s, p)));
    else g.lineTo(x(s), y(sparkleEnvelope(s, p)));
  }
  g.strokeStyle = SCENE_VIOLET;
  g.lineWidth = 1.5 * dpr;
  g.stroke();
  g.strokeStyle = AUTO_SKY;
  g.lineWidth = dpr;
  g.beginPath();
  g.moveTo(x(t), pad);
  g.lineTo(x(t), H - pad);
  g.stroke();
  g.fillStyle = AUTO_SKY;
  g.beginPath();
  g.arc(x(t), y(sparkleEnvelope(t, p)), 2.5 * dpr, 0, Math.PI * 2);
  g.fill();
}

interface PatchFrame {
  effect: number;
  /** The shape's strength at this moment of the loop (signed). */
  env: number;
  /** Seconds into the loop — the hit's age, for Rings/Bloom's spread. */
  age: number;
  length: number;
  amount: number;
  density: number;
  grain: number;
  size: number;
  time: number;
}

const PATCH_VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

// The patch: a sketch of the pool (warped value-noise ridges) with each
// effect redone small. uE is the shape's strength times Treble sparkle.
const PATCH_FRAG = `#version 300 es
precision highp float;
precision highp int;
out vec4 outColor;
uniform vec2 uRes;
uniform float uTime, uE, uEnv, uAmount, uAge, uLength, uDensity, uGrain, uSize;
uniform int uEffect;

uint pcg(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v.x;
}
float h(ivec2 c) { return float(pcg(uvec3(uvec2(c + 65536), 0u))) / 4294967295.0; }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  ivec2 c = ivec2(i);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(c), h(c + ivec2(1, 0)), u.x), mix(h(c + ivec2(0, 1)), h(c + ivec2(1, 1)), u.x), u.y);
}
vec2 qOut;
float pool(vec2 p, float t, float sharp) {
  vec2 q = p * 3.2;
  q += (vec2(vnoise(q * 0.7 + vec2(t * 0.08, 0.0)), vnoise(q * 0.7 + vec2(5.2, -t * 0.07))) - 0.5) * 1.7;
  qOut = q;
  float acc = 0.0, amp = 1.0;
  for (int i = 0; i < 4; i++) {
    float dir = (i % 2 == 0) ? 1.0 : -1.0;
    float v = vnoise(q + vec2(t * 0.12 * dir, t * 0.05));
    acc += amp * pow(1.0 - abs(2.0 * v - 1.0), sharp);
    q = q * 2.03 + 7.1;
    amp *= 0.6;
  }
  return acc;
}
vec3 water(float acc) {
  vec3 c = mix(vec3(0.012, 0.07, 0.10), vec3(0.05, 0.45, 0.55), smoothstep(0.0, 0.7, acc));
  return mix(c, vec3(0.75, 0.97, 1.0), smoothstep(0.75, 1.6, acc));
}
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y * 0.42 + vec2(0.18, 0.06);
  float t = uTime;
  float sharp = 8.0;
  if (uEffect == ${EFFECT_TIGHTEN}) sharp = clamp(8.0 * exp(1.25 * uE), 3.0, 40.0);
  if (uEffect == ${EFFECT_SHIMMER}) {
    vec2 j = vec2(vnoise(p * 55.0 + vec2(t * 31.0, 0.0)), vnoise(p * 55.0 + vec2(17.0, -t * 29.0))) - 0.5;
    p += j * 0.016 * uE;
  }
  float acc = pool(p, t, sharp);
  vec2 q = qOut;
  if (uEffect == ${EFFECT_PRISM}) {
    vec2 off = vec2(0.8, 0.6) * 0.016 * uE;
    float aR = pool(p + off, t, sharp);
    float aB = pool(p - off, t, sharp);
    vec3 col = water(acc);
    col += vec3(1.0, 0.25, 0.45) * max(aR - acc, 0.0) * 2.0 + vec3(0.35, 0.45, 1.0) * max(aB - acc, 0.0) * 2.0;
    outColor = vec4(col, 1.0);
    return;
  }
  if (uEffect == ${EFFECT_FLARE}) acc += 0.7 * uE * pow(max(acc, 0.0), 1.8) * smoothstep(0.45, 1.0, acc);
  if (uEffect == ${EFFECT_RUN}) {
    float bands = pow(0.5 + 0.5 * sin(q.x * 5.0 + q.y * 3.3 - t * 2.0 - uAge * 9.0), 7.0);
    acc += acc * smoothstep(0.25, 0.8, acc) * bands * uAmount * (0.35 + 2.2 * abs(uEnv));
  }
  if (uEffect == ${EFFECT_GRAIN}) {
    float n = vnoise(p * mix(45.0, 8.0, uGrain) + vec2(t * 0.6, 0.0));
    acc += max(uE, 0.0) * smoothstep(0.3, 0.75, acc) * pow(n, mix(13.0, 3.0, uDensity)) * 4.0;
  }
  if (uEffect == ${EFFECT_RINGS} || uEffect == ${EFFECT_BLOOM}) {
    // One spot at the centre, struck at the start of the loop, enlarged so
    // it fills the patch the way a spot fills its own corner of the pool.
    float s = uSize * 0.9;
    float lit = smoothstep(0.25, 0.85, acc);
    vec2 bend = (vec2(vnoise(q * 1.3 + 3.0), vnoise(q * 1.3 + 9.0)) - 0.5) * s * 1.6;
    float dist = length(p - vec2(0.18, 0.06) + bend);
    float grow = 1.0 - exp(-uAge / (0.3 * uLength));
    float spot;
    if (uEffect == ${EFFECT_RINGS}) {
      float dr = (dist - s * grow) / (0.12 * s + 0.002);
      spot = abs(uEnv) * exp(-dr * dr) * (0.25 + 0.75 * lit) * 2.0;
    } else {
      float rad = s * (0.35 + 0.65 * grow);
      spot = uEnv * (1.0 - smoothstep(rad * 0.3, rad, dist)) * lit * 1.1;
    }
    acc += uAmount * spot * (0.4 + acc);
  }
  outColor = vec4(water(acc), 1.0);
}`;

interface PatchView {
  draw(f: PatchFrame): void;
  dispose(): void;
}

function createPatchView(canvas: HTMLCanvasElement): PatchView | null {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(PATCH_PX * dpr);
  canvas.height = Math.round(PATCH_PX * dpr);
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, preserveDrawingBuffer: false });
  if (!gl) return null;
  const compile = (type: number, src: string): WebGLShader | null => {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
  };
  const vs = compile(gl.VERTEX_SHADER, PATCH_VERT);
  const fs = compile(gl.FRAGMENT_SHADER, PATCH_FRAG);
  const prog = gl.createProgram();
  if (!vs || !fs || !prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  const vao = gl.createVertexArray();
  const buf = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(prog, name);
  const uni = {
    res: u("uRes"),
    time: u("uTime"),
    e: u("uE"),
    env: u("uEnv"),
    amount: u("uAmount"),
    age: u("uAge"),
    length: u("uLength"),
    density: u("uDensity"),
    grain: u("uGrain"),
    size: u("uSize"),
    effect: u("uEffect"),
  };
  return {
    draw(f: PatchFrame): void {
      if (gl.isContextLost()) return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.uniform2f(uni.res, canvas.width, canvas.height);
      gl.uniform1f(uni.time, f.time);
      gl.uniform1f(uni.e, f.env * f.amount);
      gl.uniform1f(uni.env, f.env);
      gl.uniform1f(uni.amount, f.amount);
      gl.uniform1f(uni.age, f.age);
      gl.uniform1f(uni.length, f.length);
      gl.uniform1f(uni.density, f.density);
      gl.uniform1f(uni.grain, f.grain);
      gl.uniform1f(uni.size, f.size);
      gl.uniform1i(uni.effect, f.effect);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose(): void {
      gl.deleteBuffer(buf);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      // Hand the context back now rather than when the canvas is collected,
      // so rebuilding the card never piles up live contexts.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

registerWidget("causticsSparkle", buildCausticsSparkle);
