import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../gl.ts";
import type { SceneSetting } from "../sceneSettings.ts";
import { resolveSceneSetting } from "../autoTune.ts";
import type { Scene, SceneContext } from "../scene.ts";
import { COMMON_UNIFORMS_GLSL, ROOM_UV_GLSL, settingUniformName, uploadCommonUniforms } from "../sceneCommon.ts";
import type { QualityPreset } from "../quality.ts";
import { NUM_BANDS } from "../../audio/types.ts";

// Gray-Scott reaction-diffusion, built from six reference videos the user
// found under that name (see the scene's tuning/memory notes for the scan
// details, tools/.cache/refs/{2s28LbNqmOM,48H_Fre00AY,9pAkn0bsCLU,
// P-UTmeA4qeI,VTcH08UgcAE,rBwFHMb8Lh0}). Four were confirmed genuine
// Gray-Scott renders: a grayscale, embossed-relief montage cycling
// mitosis/coral/dendritic growth (2s28LbNqmOM); a rainbow-LUT growth front
// decaying into mitosis spots (48H_Fre00AY); a grayscale montage that
// includes one regime with a 5-fold kaleidoscope fold imposed on the sim
// (9pAkn0bsCLU); and a bone/copper worm-and-coral maze (P-UTmeA4qeI). Two
// were not Gray-Scott at all — a glowing wire/ember flythrough
// (VTcH08UgcAE) and a perfectly periodic tiled kaleidoscope lattice already
// covered by kaleido/ (rBwFHMb8Lh0) — and are excluded here.
//
// Every one of the six clips was silent or beatless, confirmed independently
// per bundle ("NO USABLE AUDIO... only the visual findings mean anything").
// So nothing about *how* this should react to music was measured, only the
// picture was — the reseed mechanism below is this scene's own invention,
// not a finding. Style's three options each trace to one of the three
// surviving looks (Mono/Spectrum/Ember); Feed and Kill expose the actual
// Pearson (1993) parameter plane the references only sampled a few points
// of — sliding through it is what turns spots into worms into mitosis into
// chaos, and hiding that behind named presets alone would have thrown away
// the "versatility" this scene was asked to reuse.
//
// The equations, independently derived rather than ported from any of the
// countless existing Gray-Scott shaders (CLAUDE.md's standing rule): two
// chemicals U (abundant "feed" reagent) and V (the reacting agent that
// draws the figure) on a toroidal grid,
//   dU/dt = Du*lap(U) - U*V*V + F*(1-U)
//   dV/dt = Dv*lap(V) + U*V*V - (F+K)*V
// stepped with a plain 5-point Laplacian and forward Euler at dt=1, Du=1,
// Dv=0.5 (the classic 2:1 ratio — without it V always wins and the field
// flatlines to nothing). Growth speed is exposed as *iterations per
// rendered frame* rather than a variable dt, so the discretisation itself
// never changes shape, just how many times it's applied.
//
// State packing: a ping-pong pair of RGBA8 textures, R=U, G=V (B/A unused,
// written as 0/1) — RGBA8 is the only renderable format this repo relies on
// (see powder.ts's header for why EXT_color_buffer_float stays unused). One
// step's du/dv is well within 8-bit resolution at dt=1 on this
// discretisation, the same reason countless WebGL Gray-Scott
// implementations get away with 8 bits. LINEAR filtering is safe even for
// the sim pass, because every neighbour sample lands exactly on a texel
// centre (the offset is exactly one texel) — LINEAR only ever matters for
// the *display* pass, where it makes rotation and zoom sample smoothly for
// free. REPEAT wrap makes the domain toroidal, so the Laplacian never needs
// edge handling and Drift's rotation never exposes a hard border — just,
// eventually, the tiling, which is why Drift only rotates: rotation was the
// one motion measured consistently across the references, while their zoom
// was inconsistent and near-zero in most, and an unbounded zoom would
// eventually make the tiling obvious over a long session.
//
// Reseed: a beat stamps a few soft V bumps into the field (nucleation
// sites — the same mechanism that makes mitosis mitosis), scaled by Reseed
// and the hit's strength; the stamp itself is a second ping-pong pass
// (seedProg) rather than point sprites, so every pass in this file is the
// same fullscreen-quad shape. A silent fallback timer stamps one regardless
// of Reseed or silence (FALLBACK_RESEED_SEC), so the field can never fully
// decay into a boring fixed point over a long session.
const ID = "petri";

const GRID_SIDE: Record<QualityPreset, number> = { high: 512, mid: 384, low: 256, floor: 192 };

const DRIFT_DEG_PER_SEC = 6; // at Drift = 1
const FALLBACK_RESEED_SEC = 6; // longest silence/no-reseed can go before a stamp anyway
const RESEED_COOLDOWN_SEC = 0.2; // an onset-triggered stamp can't refire faster than this
const MAX_SEEDS = 3;

const STYLE_NAMES = ["Mono", "Spectrum", "Ember"] as const;

const SETTINGS: SceneSetting[] = [
  {
    key: "style",
    label: "Style",
    description:
      "Mono: grayscale, lit like an embossed relief — the coral/dendritic/spot montages. Spectrum: a blue field growing green, mitosis spots at the edges. Ember: a bone-and-copper worm-and-coral maze. Every other setting remembers its own value per style",
    group: "Form",
    type: "enum",
    options: STYLE_NAMES,
    min: 0,
    max: STYLE_NAMES.length - 1,
    step: 1,
    default: 0,
    variant: true,
  },
  {
    key: "feed",
    label: "Feed",
    description: "How fast the reagent refills — low holds spots and worms, high pushes toward chaos",
    group: "Form",
    min: 0.02,
    max: 0.09,
    step: 0.001,
    default: 0.04,
    variantDefaults: { Spectrum: 0.032, Ember: 0.05 },
    auto: { density: 0.3, brightness: 0.15 },
  },
  {
    key: "kill",
    label: "Kill",
    description: "How fast the pattern is consumed — rising through this crosses spots into worms into waves",
    group: "Form",
    min: 0.03,
    max: 0.07,
    step: 0.0005,
    default: 0.06,
    variantDefaults: { Spectrum: 0.058, Ember: 0.063 },
    auto: { dynamics: 0.2, tempo: -0.15 },
  },
  {
    key: "scale",
    label: "Cell size",
    description: "Zooms the pattern — bigger cells at the low end, a finer weave at the high end",
    group: "Form",
    min: 0.5,
    max: 2.5,
    step: 0.05,
    default: 1.2,
  },
  {
    key: "speed",
    label: "Growth speed",
    description: "Simulation steps per rendered frame — how fast the pattern grows and spreads",
    group: "Motion",
    min: 1,
    max: 6,
    step: 1,
    default: 2,
    auto: { pulse: 0.25, attack: 0.15 },
  },
  {
    key: "reseed",
    label: "Reseed",
    description: "How hard a beat stamps fresh nucleation points into the field — 0 leaves it to grow on its own",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
    auto: { pulse: 0.2 },
    reads: ["feature.onset"],
  },
  {
    key: "glow",
    label: "Front glow",
    description: "Brightens the growth front where the pattern is changing fastest",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    auto: { brightness: 0.2 },
  },
  {
    key: "drift",
    label: "Drift",
    description: "A slow continuous spin over the pattern",
    group: "Camera",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
    auto: { dynamics: 0.2 },
  },
  {
    key: "symmetry",
    label: "Symmetry",
    description: "Folds the picture into this many mirrored wedges — 0 leaves the pattern's own asymmetric growth alone",
    group: "Post",
    min: 0,
    max: 8,
    step: 1,
    default: 0,
  },
];

function settingFor(key: string): SceneSetting {
  const s = SETTINGS.find((x) => x.key === key);
  if (!s) throw new Error(`petri: unknown setting ${key}`);
  return s;
}

const SETTINGS_UNIFORMS_GLSL = SETTINGS.map((s) => `uniform float ${settingUniformName(s.key)};`).join("\n");

const SIM_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
uniform sampler2D uPrev;
uniform float uTexel;

// The standard stable pairing at dt=1, dx=1 texel (forward Euler's CFL bound
// for the diffusion term alone is Du <= dx^2/(4*dt) = 0.25 here; Du=1,Dv=0.5
// — the textbook *ratio* — blows the scheme up into a checkerboard that
// aliases into straight-line moire under the display pass's rotate/zoom).
// This is also the convention the classic named Feed/Kill points (mitosis,
// coral, worms...) are defined under, so it doubles as keeping those points
// meaningful.
const float DU = 0.16;
const float DV = 0.08;

void main() {
  vec2 t = vec2(uTexel);
  vec4 c = texture(uPrev, vUv);
  vec4 n = texture(uPrev, vUv + vec2(0.0, t.y));
  vec4 s = texture(uPrev, vUv - vec2(0.0, t.y));
  vec4 e = texture(uPrev, vUv + vec2(t.x, 0.0));
  vec4 w = texture(uPrev, vUv - vec2(t.x, 0.0));
  vec2 lap = n.rg + s.rg + e.rg + w.rg - 4.0 * c.rg;

  float U = c.r;
  float V = c.g;
  float reaction = U * V * V;
  float du = DU * lap.x - reaction + uFeed * (1.0 - U);
  float dv = DV * lap.y + reaction - (uFeed + uKill) * V;
  U = clamp(U + du, 0.0, 1.0);
  V = clamp(V + dv, 0.0, 1.0);
  outColor = vec4(U, V, 0.0, 1.0);
}
`;

const SEED_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
uniform sampler2D uPrev;
uniform vec4 uSeeds[${MAX_SEEDS}]; // xy = centre (uv), z = radius (uv), w = strength; w <= 0 disables a slot

void main() {
  vec4 c = texture(uPrev, vUv);
  float bump = 0.0;
  for (int i = 0; i < ${MAX_SEEDS}; i++) {
    vec4 sd = uSeeds[i];
    if (sd.w <= 0.0) continue;
    // Shortest toroidal offset, so a seed near uv 0/1 still stamps a whole
    // round disc instead of one sliced off by the wrap.
    vec2 d = vUv - sd.xy;
    d -= round(d);
    float r = length(d);
    bump = max(bump, sd.w * smoothstep(sd.z, 0.0, r));
  }
  outColor = vec4(c.r, clamp(c.g + bump, 0.0, 1.0), 0.0, 1.0);
}
`;

const DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
${ROOM_UV_GLSL}
uniform sampler2D uPrev;
uniform float uTexel;
uniform float uDriftAngle;

vec2 foldAngle(vec2 p, float n) {
  float ang = atan(p.y, p.x);
  float r = length(p);
  float wedge = 6.28318530718 / n;
  ang = abs(mod(ang, wedge) - wedge * 0.5);
  return vec2(cos(ang), sin(ang)) * r;
}

void main() {
  vec2 uv = roomUv(vUv) - 0.5;
  uv.x *= uResolution.x / max(uResolution.y, 1.0);

  float ca = cos(uDriftAngle), sa = sin(uDriftAngle);
  uv = mat2(ca, sa, -sa, ca) * uv;

  if (uSymmetry >= 2.0) uv = foldAngle(uv, uSymmetry);

  vec2 simUv = uv / uScale + 0.5;

  vec4 c = texture(uPrev, simUv);
  vec2 t = vec2(uTexel);
  float vN = texture(uPrev, simUv + vec2(0.0, t.y)).g;
  float vS = texture(uPrev, simUv - vec2(0.0, t.y)).g;
  float vE = texture(uPrev, simUv + vec2(t.x, 0.0)).g;
  float vW = texture(uPrev, simUv - vec2(t.x, 0.0)).g;
  vec2 grad = vec2(vE - vW, vN - vS);
  float edge = length(grad);

  float V = c.g;
  vec3 color;
  if (uStyle < 0.5) {
    // Mono: an embossed relief, lit from one side — 2s28LbNqmOM/9pAkn0bsCLU's look.
    vec3 normal = normalize(vec3(-grad * 12.0, 0.5));
    vec3 light = normalize(vec3(0.4, 0.55, 0.7));
    float lit = 0.35 + 0.65 * max(dot(normal, light), 0.0);
    color = mix(vec3(0.07, 0.07, 0.08), vec3(0.82, 0.80, 0.78), V) * lit;
  } else if (uStyle < 1.5) {
    // Spectrum: blue substrate growing green — 48H_Fre00AY's growth front.
    color = mix(vec3(0.01, 0.30, 0.95), vec3(0.12, 0.80, 0.30), smoothstep(0.05, 0.6, V));
  } else {
    // Ember: bone-and-copper on near-black ground — P-UTmeA4qeI's maze.
    color = mix(vec3(0.08, 0.055, 0.045), vec3(0.55, 0.48, 0.34), smoothstep(0.05, 0.45, V));
    color = mix(color, vec3(0.86, 0.82, 0.68), smoothstep(0.45, 0.85, V));
  }
  color += edge * uGlow * 2.0;
  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

/** Initial state: U=1 everywhere (an untouched reagent bath) with a handful
 *  of small V bumps to nucleate — without these Gray-Scott just sits at its
 *  trivial fixed point forever, the same reason every reference's t=0 frame
 *  shows a seed blob rather than a blank field. */
function seedField(side: number): Uint8Array {
  const data = new Uint8Array(side * side * 4);
  for (let i = 0; i < side * side; i++) {
    data[i * 4] = 255; // U = 1
    data[i * 4 + 1] = 0; // V = 0
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 255;
  }
  const spots = 6 + Math.floor(Math.random() * 6);
  for (let k = 0; k < spots; k++) {
    const cx = Math.floor(Math.random() * side);
    const cy = Math.floor(Math.random() * side);
    const r = 2 + Math.floor(Math.random() * 3);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = (cx + dx + side) % side;
        const y = (cy + dy + side) % side;
        data[(y * side + x) * 4 + 1] = 255;
      }
    }
  }
  return data;
}

function createPetriScene(): Scene {
  let simProg: GLProgram | null = null;
  let seedProg: GLProgram | null = null;
  let displayProg: GLProgram | null = null;
  let quadVao: WebGLVertexArrayObject | null = null;

  const stateTex: (WebGLTexture | null)[] = [null, null];
  const stateFbo: (WebGLFramebuffer | null)[] = [null, null];
  let simPrevLoc: WebGLUniformLocation | null = null;
  let seedPrevLoc: WebGLUniformLocation | null = null;
  let displayPrevLoc: WebGLUniformLocation | null = null;

  let read = 0;
  let gridSide = 1;
  let texel = 1;
  const bandsBuf = new Float32Array(NUM_BANDS);
  const seedsBuf = new Float32Array(MAX_SEEDS * 4);

  let driftAngle = 0;
  let timeSinceSeed = 0;
  let seedCooldown = 0;
  let lastFrameTime: number | null = null;

  return {
    id: ID,
    name: "Petri",
    settings: SETTINGS,

    init(ctx: SceneContext) {
      const { gl } = ctx;
      simProg = createProgram(gl, SIM_FRAG);
      seedProg = createProgram(gl, SEED_FRAG);
      displayProg = createProgram(gl, DISPLAY_FRAG);
      simPrevLoc = gl.getUniformLocation(simProg.program, "uPrev");
      seedPrevLoc = gl.getUniformLocation(seedProg.program, "uPrev");
      displayPrevLoc = gl.getUniformLocation(displayProg.program, "uPrev");
      quadVao = createFullscreenQuad(gl);

      gridSide = GRID_SIDE[ctx.quality.preset];
      texel = 1 / gridSide;
      const seed = seedField(gridSide);
      for (let i = 0; i < 2; i++) {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gridSide, gridSide, 0, gl.RGBA, gl.UNSIGNED_BYTE, i === 0 ? seed : null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        stateTex[i] = tex;
        stateFbo[i] = fbo;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);

      read = 0;
      driftAngle = 0;
      timeSinceSeed = 0;
      seedCooldown = 0;
      lastFrameTime = null;
    },

    render(ctx, frame, viewport, palette, anim) {
      if (!simProg || !seedProg || !displayProg || !quadVao) return;
      const { gl } = ctx;

      const dt = lastFrameTime === null ? 1 / 60 : Math.max(0, Math.min(0.1, frame.time - lastFrameTime));
      lastFrameTime = frame.time;

      const iterations = Math.max(1, Math.round(resolveSceneSetting(ID, settingFor("speed"))));
      const reseedAmount = resolveSceneSetting(ID, settingFor("reseed"));
      const driftAmount = resolveSceneSetting(ID, settingFor("drift"));

      gl.disable(gl.BLEND);
      gl.viewport(0, 0, gridSide, gridSide);

      for (let i = 0; i < iterations; i++) {
        const write = 1 - read;
        gl.bindFramebuffer(gl.FRAMEBUFFER, stateFbo[write]);
        simProg.use();
        uploadCommonUniforms(simProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
        simProg.setF("uTexel", texel);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, stateTex[read]);
        gl.uniform1i(simPrevLoc, 0);
        drawFullscreenQuad(gl, quadVao);
        read = write;
      }

      // Reseed: an onset stamps fresh nucleation points scaled by Reseed and
      // the hit's own strength; a silent fallback timer stamps regardless, so
      // a fully decayed field never just sits there for the rest of the set.
      timeSinceSeed += dt * iterations;
      seedCooldown = Math.max(0, seedCooldown - dt);
      let stamps = 0;
      if (anim.onset && reseedAmount > 0.02 && seedCooldown <= 0) {
        stamps = 1 + Math.floor(reseedAmount * (MAX_SEEDS - 1));
        seedCooldown = RESEED_COOLDOWN_SEC;
        timeSinceSeed = 0;
      } else if (timeSinceSeed > FALLBACK_RESEED_SEC) {
        stamps = 1;
        timeSinceSeed = 0;
      }
      if (stamps > 0) {
        seedsBuf.fill(0);
        const strength = 0.5 + 0.5 * anim.beatPulse * reseedAmount;
        for (let i = 0; i < stamps; i++) {
          seedsBuf[i * 4] = Math.random();
          seedsBuf[i * 4 + 1] = Math.random();
          seedsBuf[i * 4 + 2] = (2 + Math.random() * 2) * texel;
          seedsBuf[i * 4 + 3] = strength;
        }
        const write = 1 - read;
        gl.bindFramebuffer(gl.FRAMEBUFFER, stateFbo[write]);
        seedProg.use();
        uploadCommonUniforms(seedProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
        seedProg.setV4v("uSeeds", seedsBuf);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, stateTex[read]);
        gl.uniform1i(seedPrevLoc, 0);
        drawFullscreenQuad(gl, quadVao);
        read = write;
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

      driftAngle += dt * DRIFT_DEG_PER_SEC * driftAmount * (Math.PI / 180);

      displayProg.use();
      uploadCommonUniforms(displayProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      displayProg.setF("uTexel", texel);
      displayProg.setF("uDriftAngle", driftAngle);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, stateTex[read]);
      gl.uniform1i(displayPrevLoc, 0);
      drawFullscreenQuad(gl, quadVao);

      // The gallery renders every scene into one shared context each tick —
      // must not leak a bound texture onto the next tile.
      gl.bindTexture(gl.TEXTURE_2D, null);
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      simProg?.dispose();
      seedProg?.dispose();
      displayProg?.dispose();
      if (quadVao) gl.deleteVertexArray(quadVao);
      for (let i = 0; i < 2; i++) {
        if (stateFbo[i]) gl.deleteFramebuffer(stateFbo[i]);
        if (stateTex[i]) gl.deleteTexture(stateTex[i]);
        stateFbo[i] = null;
        stateTex[i] = null;
      }
      simProg = null;
      seedProg = null;
      displayProg = null;
      quadVao = null;
      simPrevLoc = null;
      seedPrevLoc = null;
      displayPrevLoc = null;
    },
  };
}

export const petriScene = createPetriScene();
