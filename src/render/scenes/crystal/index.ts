import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../../gl.ts";
import { PALETTE_GLSL } from "../../palette.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import { resolveSceneSetting } from "../../autoTune.ts";
import type { Scene, SceneContext } from "../../scene.ts";
import { COMMON_UNIFORMS_GLSL, ROOM_UV_GLSL, SAMPLE_BANDS_GLSL, settingUniformName, uploadCommonUniforms } from "../../sceneCommon.ts";
import { NUM_BANDS } from "../../../audio/types.ts";
import { MARCH_FRAG_BODY, BLUR_FRAG, COMPOSITE_BODY } from "./glsl.ts";
import { advanceCrystal, createCrystalState, type CrystalState } from "./driver.ts";

// Crystal Wall v4: a raymarched 3D scene seen through a p6m (three-mirror)
// kaleidoscope fold, built after v1–v3 (PR #95) were each told "not the
// same" against the LED-wall VJ loop _RsNDsibqgc — the measured full-size
// frames (tools/.cache/refs/vj-1027/frames/look_1.jpg, look_2.jpg) and the
// three every-frame ten-second bundles they came from show a *rendered 3D
// scene*: black angular panels with chamfered edges lit white, red neon
// strips along some of those edges, a soft grey lit region near the axis,
// depth fog to black, heavy bloom — mirrored six ways by a camera flying
// through it. v1–v3 drew that as flat 2D shapes (star, plate, chevron, web)
// under a fold, which reads as a line drawing no matter how the strokes are
// tuned; a fold that mirrors 2D coordinates can't produce shading, depth
// fog or a chamfer. (Also fixed on the way: an earlier build-vs-cut counter
// mistook this scene's own 3-frame envelope fades for one-frame cuts — see
// tools' refburst fix, kept from v3, not touched here.)
//
// The fix: a three-mirror kaleidoscope really does tile one wedge of a 3D
// object cell, so let the folded coordinate be a *ray* instead of a
// drawing position. `MARCH_FRAG_BODY` (glsl.ts) folds the screen into one
// wedge exactly as v3 did (hexLocal/polar, kept verbatim), then turns the
// wedge point `w` into `rd = normalize(vec3(w * WEDGE_FOV, 1.0))` — the
// camera sits at the wedge's mirror vertex looking down +z, so every wedge
// (and its mirrored copies) sees the same object cell from the same angle,
// which is exactly what keeps a kaleidoscope's tiling seamless. What the
// ray hits is an endless corridor, domain-repeated along z (Z_REP), of
// chamfered slab panels, a hex-prism core, hex-nut rings and a thin rod —
// SDF primitives written out fresh for this scene (see glsl.ts's header),
// each cell hash-rotated and hash-flagged for which of its edges glow red
// instead of white. Camera roll (`uRoll`) turns the whole folded picture;
// camera travel (`uTravel`) flies it forward — both new driver
// accumulators (below), both monotonic, both sharing the zoom wander's
// beat-surge velocity so a beat pushes the camera the same way it speeds up
// the zoom.
//
// Three passes, hand-rolled (createFullscreenScene can't run more than one
// program): (1) raymarch into `sharpFbo`, a LINEAR/CLAMP RGBA8 target at
// `MARCH_SCALE` of the drawing buffer; (2) a two-level separable-Gaussian
// bloom copied from powder.ts's chain (blur program, sampler-location
// cache, half-then-quarter-style ping-pong — see BLUR_FRAG/glsl.ts and
// render() below); (3) composite sharp + both glow levels with a
// per-channel Reinhard knee then an exponential shoulder, to the default
// framebuffer. All three targets rebuild on a drawing-buffer resize (the
// quality governor moves renderScale at runtime) and every pass restores
// GL state afterward — the gallery shares this context with every other
// scene's tile.
//
// The driver (driver.ts's advanceCrystal) is v3's, moved verbatim and kept
// exactly because it's already right and already tested: a wandering
// camera (log-zoom + pan), a morph clock, four light layers that fade up on
// bar wraps / drops / beats and down on their own, and a slow mood cycle
// deciding how much of a beat's red/edges split goes to which look — see
// driver.ts's own header for the full story, including the two v4 additions
// (`travel`/`roll`) and their continuity guarantee. Nothing here is
// discrete except those triggers; this stays one continuously evolving
// picture, never a cut.
const ID = "crystal";

/** Pass-1 raymarch target as a fraction of the drawing buffer — cheaper
 *  than full res because the fold means every screen pixel needs its own
 *  march, and the bloom chain downsamples it further anyway. Drop to 0.6
 *  (alongside MAX_MARCH_STEPS in glsl.ts) if tools/tune-probe.mjs reports
 *  under 50 fps at quality high. */
const MARCH_SCALE = 0.75;
/** Texel stride between blur taps, in the *source* texture's texels — see
 *  render()'s two-level chain. This scene's own tuning, not powder's
 *  BLUR_STRIDE (their blur runs at a different relative resolution). */
const BLUR_STRIDE = 2.4;

const SETTINGS: SceneSetting[] = [
  {
    key: "tiling",
    label: "Tiling",
    description: "Scale of the lattice: below 1 more, smaller cells; above 1 fewer, bigger.",
    group: "Form",
    min: 0.5,
    max: 2.0,
    step: 0.05,
    default: 1.0,
  },
  {
    key: "density",
    label: "Density",
    description: "How much crystal fills each cell of the corridor.",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    auto: { density: 0.3 },
  },
  {
    key: "zoom",
    label: "Travel",
    description: "How fast the camera wanders through the crystal — zooming and sliding, never cutting.",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    auto: { tempo: 0.25, loudness: 0.15 },
  },
  {
    key: "speed",
    label: "Speed",
    description: "How fast the camera flies and rolls through the crystal.",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
    auto: { tempo: 0.3, loudness: 0.2 },
  },
  {
    key: "pulse",
    label: "Beat pulse",
    description: "Brightness pop on each beat, and the push it gives the marks.",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    auto: { pulse: 0.3, attack: 0.2 },
    reads: ["feature.onset"],
  },
  {
    key: "flare",
    label: "Flare",
    description:
      "Strength of the light layers: the ice blobs fading in on every bar, the fan on drops, and the red / edge-lit looks a slow mood alternates between.",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.8,
    auto: { dynamics: 0.3, loudness: 0.2 },
    reads: ["anim.dropOnset"],
  },
  {
    key: "hold",
    label: "Light hold",
    description: "How long a lit layer stays before it decays, in seconds.",
    group: "Motion",
    min: 0.1,
    max: 2.0,
    step: 0.05,
    default: 0.35,
    auto: { tempo: -0.3 },
  },
  {
    key: "glow",
    label: "Glow",
    description: "Strength of the soft bloom halo around the lit edges and the ice blobs.",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { brightness: 0.25 },
  },
  {
    key: "neon",
    label: "Neon",
    description: "The red neon strips along some of the panel edges.",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.7,
    auto: { loudness: 0.2, brightness: -0.15 },
  },
  {
    key: "ground",
    label: "Fog",
    description: "How far the corridor stays visible before fading to black.",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    auto: { brightness: 0.2 },
  },
];

function settingFor(key: string): SceneSetting {
  const s = SETTINGS.find((x) => x.key === key);
  if (!s) throw new Error(`crystal: unknown setting ${key}`);
  return s;
}

const SETTINGS_UNIFORMS_GLSL = SETTINGS.map((s) => `uniform float ${settingUniformName(s.key)};`).join("\n");

/** Builds a full `#version 300 es` fragment source the same way
 *  fullscreenScene.ts's createFullscreenScene does for a single-pass scene
 *  (COMMON_UNIFORMS_GLSL + setting uniforms + extra uniforms + palette/room/
 *  band helpers + body) — copied here because a multi-pass scene can't run
 *  through that helper. Used for pass 1 only; the blur and composite
 *  programs below build their own, simpler sources (no palette/room/band
 *  helpers needed), the way powder.ts's BLUR_FRAG/COMPOSITE_FRAG do. */
function buildMarchFragSource(extraUniformDecls: string): string {
  return `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
${extraUniformDecls}
${PALETTE_GLSL}
${ROOM_UV_GLSL}
${SAMPLE_BANDS_GLSL}
${MARCH_FRAG_BODY}
`;
}

const MARCH_FRAG = buildMarchFragSource(
  [
    "uniform float uLogZoom;",
    "uniform float uPanX;",
    "uniform float uPanY;",
    "uniform float uMorphPos;",
    "uniform float uTravel;",
    "uniform float uRoll;",
    "uniform float uBlobs;",
    "uniform float uFan;",
    "uniform float uRed;",
    "uniform float uEdges;",
    "uniform float uBeatSwell;",
    "uniform float uFlowPos;",
  ].join("\n"),
);

const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
uniform sampler2D uSharpTex;
uniform sampler2D uGlowATex;
uniform sampler2D uGlowBTex;
uniform float uGA;
uniform float uGB;
uniform float uSharpW;
${COMPOSITE_BODY}
`;

function createCrystalSceneImpl(): Scene {
  let marchProg: GLProgram | null = null;
  let blurProg: GLProgram | null = null;
  let compositeProg: GLProgram | null = null;
  let quadVao: WebGLVertexArrayObject | null = null;
  const samplerLocs = new Map<string, WebGLUniformLocation | null>();
  const bandsBuf = new Float32Array(NUM_BANDS);
  let state: CrystalState | null = null;

  // Pass-1 target (march-scale) and the two bloom levels (quarter- and
  // eighth-of-drawing-buffer), each a ping-pong A/B pair for the separable
  // blur — see the file header and render()'s pass 2.
  let dbW = 0;
  let dbH = 0;
  let sharpTex: WebGLTexture | null = null;
  let sharpFbo: WebGLFramebuffer | null = null;
  let sharpW = 0;
  let sharpH = 0;
  let l0ATex: WebGLTexture | null = null;
  let l0BTex: WebGLTexture | null = null;
  let l0AFbo: WebGLFramebuffer | null = null;
  let l0BFbo: WebGLFramebuffer | null = null;
  let l0W = 0;
  let l0H = 0;
  let l1ATex: WebGLTexture | null = null;
  let l1BTex: WebGLTexture | null = null;
  let l1AFbo: WebGLFramebuffer | null = null;
  let l1BFbo: WebGLFramebuffer | null = null;
  let l1W = 0;
  let l1H = 0;

  /** Cached sampler locations — GLProgram has no integer setter (samplers
   *  are the one uniform kind that needs one), same pattern as powder.ts /
   *  shards/index.ts. */
  function samplerLoc(gl: WebGL2RenderingContext, prog: GLProgram, key: string, name: string): WebGLUniformLocation | null {
    let l = samplerLocs.get(key);
    if (l === undefined) {
      l = gl.getUniformLocation(prog.program, name);
      samplerLocs.set(key, l);
    }
    return l;
  }

  function makeTexture(gl: WebGL2RenderingContext, w: number, h: number): WebGLTexture | null {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  function attachColour(gl: WebGL2RenderingContext, tex: WebGLTexture | null): WebGLFramebuffer | null {
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`crystal: framebuffer incomplete (0x${status.toString(16)})`);
    }
    return f;
  }

  function freeTargets(gl: WebGL2RenderingContext): void {
    for (const fbo of [sharpFbo, l0AFbo, l0BFbo, l1AFbo, l1BFbo]) if (fbo) gl.deleteFramebuffer(fbo);
    for (const tex of [sharpTex, l0ATex, l0BTex, l1ATex, l1BTex]) if (tex) gl.deleteTexture(tex);
    sharpFbo = l0AFbo = l0BFbo = l1AFbo = l1BFbo = null;
    sharpTex = l0ATex = l0BTex = l1ATex = l1BTex = null;
    sharpW = sharpH = l0W = l0H = l1W = l1H = 0;
    dbW = 0;
    dbH = 0;
  }

  /** Rebuilds every target when the drawing buffer changes size — the
   *  quality governor moves renderScale at runtime, so the stored size is
   *  compared every frame rather than trusted from init. */
  function ensureTargets(gl: WebGL2RenderingContext): void {
    const w = Math.max(1, gl.drawingBufferWidth);
    const h = Math.max(1, gl.drawingBufferHeight);
    if (w === dbW && h === dbH && sharpFbo) return;
    freeTargets(gl);
    dbW = w;
    dbH = h;
    sharpW = Math.max(1, Math.round(w * MARCH_SCALE));
    sharpH = Math.max(1, Math.round(h * MARCH_SCALE));
    sharpTex = makeTexture(gl, sharpW, sharpH);
    sharpFbo = attachColour(gl, sharpTex);
    l0W = Math.max(1, w >> 2);
    l0H = Math.max(1, h >> 2);
    l0ATex = makeTexture(gl, l0W, l0H);
    l0BTex = makeTexture(gl, l0W, l0H);
    l0AFbo = attachColour(gl, l0ATex);
    l0BFbo = attachColour(gl, l0BTex);
    l1W = Math.max(1, w >> 3);
    l1H = Math.max(1, h >> 3);
    l1ATex = makeTexture(gl, l1W, l1H);
    l1BTex = makeTexture(gl, l1W, l1H);
    l1AFbo = attachColour(gl, l1ATex);
    l1BFbo = attachColour(gl, l1BTex);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  return {
    id: ID,
    name: "Crystal Wall",
    minQuality: "low",
    settings: SETTINGS,

    init(ctx: SceneContext) {
      const { gl } = ctx;
      marchProg = createProgram(gl, MARCH_FRAG);
      blurProg = createProgram(gl, BLUR_FRAG);
      compositeProg = createProgram(gl, COMPOSITE_FRAG);
      samplerLocs.clear();
      quadVao = createFullscreenQuad(gl);
      state = createCrystalState();
      dbW = 0;
      dbH = 0;
    },

    render(ctx, frame, viewport, palette, anim) {
      if (!marchProg || !blurProg || !compositeProg || !quadVao || !state) return;
      const { gl } = ctx;
      ensureTargets(gl);

      // anim.onset / anim.dropOnset, not frame.*: the render cap can skip
      // the tick a feature fired on (see renderLatch.ts).
      const out = advanceCrystal(
        state,
        {
          dtSec: anim.dtSec,
          onset: anim.onset,
          dropOnset: anim.dropOnset,
          barPhase: anim.barPhase,
          tempoLock: anim.tempoLock,
          low: anim.low,
          sectionIntensity: anim.sectionIntensity,
        },
        {
          zoom: resolveSceneSetting(ID, settingFor("zoom")),
          pulse: resolveSceneSetting(ID, settingFor("pulse")),
          flareAmt: resolveSceneSetting(ID, settingFor("flare")),
          hold: resolveSceneSetting(ID, settingFor("hold")),
          speed: resolveSceneSetting(ID, settingFor("speed")),
        },
      );

      const glowSetting = resolveSceneSetting(ID, settingFor("glow"));
      const useBloom = ctx.quality.bloomPasses > 0 && glowSetting > 0.01;
      // Kept modest: the sharp pass is already the picture (dark panels,
      // white/red edges, a lit core) — bloom is a soft halo on top of that,
      // not the thing that makes the frame readable.
      const glowScale = useBloom ? (0.18 + 0.32 * glowSetting) * (1 + 0.5 * out.blobs) : 0;

      gl.disable(gl.BLEND);

      // 1. Raymarch into the march-scale sharp target.
      gl.bindFramebuffer(gl.FRAMEBUFFER, sharpFbo);
      gl.viewport(0, 0, sharpW, sharpH);
      marchProg.use();
      uploadCommonUniforms(marchProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      marchProg.setF("uLogZoom", out.logZoom);
      marchProg.setF("uPanX", out.pan[0]);
      marchProg.setF("uPanY", out.pan[1]);
      marchProg.setF("uMorphPos", out.morphPos);
      marchProg.setF("uTravel", out.travel);
      marchProg.setF("uRoll", out.roll);
      marchProg.setF("uBlobs", out.blobs);
      marchProg.setF("uFan", out.fan);
      marchProg.setF("uRed", out.red);
      marchProg.setF("uEdges", out.edges);
      marchProg.setF("uBeatSwell", out.swell);
      marchProg.setF("uFlowPos", out.flowPos);
      drawFullscreenQuad(gl, quadVao);

      // 2. Bloom: two levels, each a separable blur — level 0 blurs the
      // sharp target down to quarter-of-drawing-buffer resolution, level 1
      // blurs level 0's finished (B) result down to an eighth. Skipped
      // entirely at quality.bloomPasses === 0 (the floor tier) or Glow ~ 0.
      if (useBloom) {
        blurProg.use();
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(samplerLoc(gl, blurProg, "blur.uTex", "uTex"), 0);

        gl.bindFramebuffer(gl.FRAMEBUFFER, l0AFbo);
        gl.viewport(0, 0, l0W, l0H);
        gl.bindTexture(gl.TEXTURE_2D, sharpTex);
        blurProg.setV2("uBlurStep", BLUR_STRIDE / sharpW, 0);
        drawFullscreenQuad(gl, quadVao);
        gl.bindFramebuffer(gl.FRAMEBUFFER, l0BFbo);
        gl.bindTexture(gl.TEXTURE_2D, l0ATex);
        blurProg.setV2("uBlurStep", 0, BLUR_STRIDE / l0H);
        drawFullscreenQuad(gl, quadVao);

        gl.bindFramebuffer(gl.FRAMEBUFFER, l1AFbo);
        gl.viewport(0, 0, l1W, l1H);
        gl.bindTexture(gl.TEXTURE_2D, l0BTex);
        blurProg.setV2("uBlurStep", BLUR_STRIDE / l0W, 0);
        drawFullscreenQuad(gl, quadVao);
        gl.bindFramebuffer(gl.FRAMEBUFFER, l1BFbo);
        gl.bindTexture(gl.TEXTURE_2D, l1ATex);
        blurProg.setV2("uBlurStep", 0, BLUR_STRIDE / l1H);
        drawFullscreenQuad(gl, quadVao);
      }

      // 3. Composite to the default framebuffer at the host viewport. gA/gB
      // are computed above (not read from uGlow/uBlobs in-shader) so that
      // !useBloom can force them to exactly 0 rather than sampling glow
      // targets this frame never rendered into.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      compositeProg.use();
      uploadCommonUniforms(compositeProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      // Under the ice light the picture defocuses: the sharp layer gives way
      // to the blurred ones (the reference's bright look has no hard line).
      const soft = useBloom ? Math.min(1, Math.max(0, out.blobs)) : 0;
      compositeProg.setF("uGA", (0.45 + 0.75 * soft) * glowScale);
      compositeProg.setF("uGB", (0.22 + 0.45 * soft) * glowScale);
      compositeProg.setF("uSharpW", 1 - 0.65 * soft);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sharpTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, l0BTex);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, l1BTex);
      gl.uniform1i(samplerLoc(gl, compositeProg, "comp.uSharpTex", "uSharpTex"), 0);
      gl.uniform1i(samplerLoc(gl, compositeProg, "comp.uGlowATex", "uGlowATex"), 1);
      gl.uniform1i(samplerLoc(gl, compositeProg, "comp.uGlowBTex", "uGlowBTex"), 2);
      drawFullscreenQuad(gl, quadVao);

      // 4. The gallery renders every scene into one shared context each
      // tick — must not leak blend state or a bound texture/unit onward.
      gl.disable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ZERO);
      for (let unit = 2; unit >= 0; unit--) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      marchProg?.dispose();
      blurProg?.dispose();
      compositeProg?.dispose();
      if (quadVao) gl.deleteVertexArray(quadVao);
      freeTargets(gl);
      samplerLocs.clear();
      marchProg = null;
      blurProg = null;
      compositeProg = null;
      quadVao = null;
      state = null;
    },
  };
}

export const crystalScene: Scene = createCrystalSceneImpl();

// Re-exports so tests/crystal.test.ts and tests/autoTune.test.ts (which
// import both the scene and the pure driver from this one module) don't
// need to reach into ./driver.ts directly.
export {
  advanceCrystal,
  createCrystalState,
  layerEnvelope,
  hash01,
  ZOOM_MID,
  ZOOM_AMP,
  type CrystalState,
  type CrystalInputs,
  type CrystalOpts,
  type CrystalOut,
} from "./driver.ts";
