import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../../gl.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import { resolveSceneSetting } from "../../autoTune.ts";
import type { Scene, SceneContext } from "../../scene.ts";
import { COMMON_UNIFORMS_GLSL, ROOM_UV_GLSL, settingUniformName, uploadCommonUniforms } from "../../sceneCommon.ts";
import { NUM_BANDS } from "../../../audio/types.ts";
import { SHARP_BODY, TAIL_BODY, BLUR_FRAG, COMPOSITE_BODY } from "./glsl.ts";
import { advanceSilk, createSilkState, fillEchoFlows, ECHO_FLOW_STRIDE, ECHO_MAX, type SilkState } from "./driver.ts";

// Round 3 (user: "make it more complex, add some more colours") — see the
// silk-scene memory's Round 3 section and glsl.ts's header comments for
// what each addition is and why: fine trailing threads and a widened haze
// fill (the reference's "feathers/combs where echoes fan"), a finer
// strandField grown by another FIELD_OCTAVES tap, a faint geometric web
// reaching past the silk's own annulus into the corners, and a cyclic
// multi-hue ramp plus an optional per-strand app-palette tint, replacing
// Round 2's single cyan-with-a-gold-mix colouring.

// Silk: a mirror kaleidoscope of glowing silk/smoke ribbons, from the
// measured short vKJu9mfeDS8 (tools/.cache/refs/vKJu9mfeDS8/report.md) — a
// translucent D8 (D6 in some regimes) flower of teal filament ribbons on
// near-black, a dark centre hole that breathes, continuous slow morph and
// zoom (never a cut in 30s at 30fps), colour/brightness that ride the
// music continuously rather than flashing on hits. See driver.ts's header
// for how the picture is actually built (K analytic echoes of one noise
// field, not a resampled feedback buffer) and for every constant this
// file's render() feeds it.
//
// Sync hypotheses this implements, and what our runtime can/can't see —
// see tools/.cache/refs/vKJu9mfeDS8/report.md's Findings for the numbers:
//  1. Morph speed rides the mids continuously (activity ~ mid r+0.33) —
//     ours: yes, anim.mid is always live.
//  2. Saturation follows loudness continuously and fades with the song
//     (sat ~ low/mid r+0.72) — ours: yes, via frame.level (the one signal
//     that survives the auto-gain, so it actually fades — anim.low/mid
//     would not).
//  3. Brightness is a slow mid-envelope with NO onset flash (brightness
//     rise z -0.06 over 25 onsets) — ours: yes; this scene never adds a
//     hit flash to brightness.
//  4. A colour/shape push lands on bar/phrase beats, hardest at phrase
//     starts (colour-change z +0.94 on rank>=4, +1.21 at rank 16) —
//     PARTLY: our tempo sat at the reference's 123 bpm for ~10% of the
//     clip (median 148, 173-181 early on) and beatClock has no downbeat/
//     phrase concept at all, so "bar"/"phrase" here are *our own* counted
//     bars (driver.ts's UNLOCKED_BAR_BEATS fallback + every-4th-bar), not
//     synced to the reference's. A beatClock/tempo fix is a to-do outside
//     this scene, not faked here.
//  5. Big regime changes (fold 8<->6, hole size, zoom direction) land at
//     audio section boundaries, travelling over ~1s (burst 11.82 shows the
//     hole collapsing and the flower re-forming 13.45-14.2s) — ours: NO;
//     anim.dropOnset/sectionIntensity never rose near this clip's own
//     section boundaries (report: "ours: `section` shows no rise near any
//     of them"). The `hold` setting is this scene's own bar-counted timer,
//     not audio-derived — a sectionIntensity gap for this kind of track is
//     a to-do in src/audio/, not something to fake here.
//  6. Off-beat transitions with no onset underneath (5.53s, 9.00s, 13.60s)
//     are the generator's own clock, not audio-driven — nothing to sync.
//  7. The report's one "strobe" (12.07s) shows no flash in its every-frame
//     burst — not real; ignored.
const ID = "silk";

/** Sharp pass target as a fraction of the drawing buffer — each echo pays
 *  for a domain-warped field + a 2-tap numeric gradient, so full res at
 *  high K is the expensive case; the bloom chain downsamples it further
 *  anyway (crystal's MARCH_SCALE reasoning). */
const SHARP_SCALE = 0.85;
/** Tail (haze) target: coarse on purpose — it only ever holds a blurry
 *  feedback trail, never the crisp lines (those are the analytic echoes
 *  above). Capped on its long side like physarum's TRAIL_SIDE_CAP. */
const TAIL_SCALE = 0.35;
const TAIL_SIDE_CAP = 720;
const BLUR_STRIDE = 2.2;

/** Echoes actually drawn per quality preset — the loop in SHARP_BODY caps
 *  at ECHO_MAX regardless, so this only ever narrows it. */
const ECHO_COUNT_BY_PRESET: Record<string, number> = { high: ECHO_MAX, mid: 6, low: 4, floor: 3 };

const SETTINGS: SceneSetting[] = [
  {
    key: "strands",
    label: "Strands",
    description: "How many nested ribbon lines the field draws.",
    group: "Form",
    min: 1,
    max: 8,
    step: 1,
    default: 5,
  },
  {
    key: "density",
    label: "Density",
    description: "How much of the field actually lights — sparsity, not line count.",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.45,
    auto: { density: 0.3 },
  },
  {
    key: "hole",
    label: "Hole",
    description: "Base radius of the dark centre — regimes breathe it wider or tighter.",
    group: "Form",
    min: 0.05,
    max: 0.6,
    step: 0.01,
    default: 0.3,
  },
  {
    key: "fold",
    label: "Fold",
    description: "Mirror count: Auto lets the slow regime cycle choose (mostly 8, sometimes 6), or pin one.",
    group: "Form",
    min: 0,
    max: 2,
    step: 1,
    default: 0,
    type: "enum",
    options: ["Auto", "8", "6"],
  },
  {
    key: "threads",
    label: "Threads",
    description: "Fine parallel lines trailing each ribbon — the reference's feather/comb fan. 0 = a bare outline.",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
  },
  {
    key: "web",
    label: "Web",
    description: "Brightness of the faint geometric star/rosette line under the silk, reaching past its own ring into the corners.",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
  },
  {
    key: "flow",
    label: "Flow",
    description: "How fast the ribbon field morphs.",
    group: "Motion",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1.0,
    auto: { tempo: 0.2, dynamics: 0.15 },
  },
  {
    key: "zoom",
    label: "Zoom",
    description: "How fast the echoes travel in or out — never a spin, only a breathing zoom.",
    group: "Motion",
    min: 0,
    max: 1.2,
    step: 0.05,
    default: 0.41,
    auto: { tempo: 0.2, loudness: 0.15 },
  },
  {
    key: "hold",
    label: "Regime hold",
    description: "How many bars a fold/hole/zoom-direction regime lasts before the next one travels in.",
    group: "Motion",
    min: 4,
    max: 16,
    step: 1,
    default: 8,
    reads: ["anim.dropOnset"],
  },
  {
    key: "push",
    label: "Bar push",
    description: "Colour/shape swell on each bar, stronger every 4th bar.",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    auto: { pulse: 0.25, attack: 0.15 },
  },
  {
    key: "echo",
    label: "Echo",
    description: "How far the trailing echoes and the diffuse haze carry before they fade.",
    group: "Look",
    min: 0.7,
    max: 0.95,
    step: 0.01,
    default: 0.86,
  },
  {
    key: "width",
    label: "Width",
    description: "Stroke width of each ribbon line.",
    group: "Look",
    min: 0.5,
    max: 2,
    step: 0.05,
    default: 1.0,
  },
  {
    key: "haze",
    label: "Haze",
    description: "How much diffuse teal haze fills in behind the crisp lines.",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
  },
  {
    key: "accent",
    label: "Accent",
    description: "Amber tint on a bar's swell, brightest on phrase bars.",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
  },
  {
    key: "satReact",
    label: "Colour from loudness",
    description: "How much saturation rises and falls with the room's own loudness.",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.7,
    auto: { loudness: 0.2 },
  },
  {
    key: "colors",
    label: "Colours",
    description: "How far strands, echoes and threads spread across the hue ramp instead of sharing one hue.",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
  },
  {
    key: "tint",
    label: "App palette",
    description: "Share of ribbons that take the app's own colour palette (device menu) instead of the measured reference hues.",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
  },
  {
    key: "size",
    label: "Size",
    description: "Overall scale of the flower.",
    group: "Camera",
    min: 0.6,
    max: 1.6,
    step: 0.05,
    default: 1.0,
  },
  {
    key: "glow",
    label: "Glow",
    description: "Strength of the soft bloom halo.",
    group: "Post",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { brightness: 0.2 },
  },
  {
    key: "brightness",
    label: "Brightness",
    description: "Overall output gain.",
    group: "Post",
    min: 0.5,
    max: 1.5,
    step: 0.05,
    default: 1.0,
  },
];

function settingFor(key: string): SceneSetting {
  const s = SETTINGS.find((x) => x.key === key);
  if (!s) throw new Error(`silk: unknown setting ${key}`);
  return s;
}

const SETTINGS_UNIFORMS_GLSL = SETTINGS.map((s) => `uniform float ${settingUniformName(s.key)};`).join("\n");

/** Extra (non-setting) uniforms every driver-fed pass needs — named away
 *  from every u<SettingKey> above so a regime-modulated value (e.g.
 *  uHoleEff vs. the raw uHole slider) never silently collides with the
 *  setting it's derived from, the way an earlier scene once did (see the
 *  Ambience-scene memory's uniform/setting name-collision gotcha). */
const DRIVER_UNIFORM_DECLS = [
  "uniform float uZoomRate;",
  "uniform float uHoleEff;",
  "uniform float uFieldEff;",
  "uniform float uFoldMix;",
  "uniform float uHueBias;",
  "uniform float uSwell;",
  "uniform float uWebShape;",
  "uniform float uWebR;",
  "uniform float uWebTilt;",
  "uniform float uWebBreath;",
].join("\n");

function buildSharpFragSource(): string {
  return `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
${DRIVER_UNIFORM_DECLS}
uniform float uEchoCount;
${ROOM_UV_GLSL}
${SHARP_BODY}
`;
}

function buildTailFragSource(): string {
  return `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
${DRIVER_UNIFORM_DECLS}
${ROOM_UV_GLSL}
${TAIL_BODY}
`;
}

const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON_UNIFORMS_GLSL}
${SETTINGS_UNIFORMS_GLSL}
uniform float uLevelS;
uniform float uBrightS;
uniform sampler2D uSharpTex;
uniform sampler2D uGlowATex;
uniform sampler2D uGlowBTex;
uniform float uGA;
uniform float uGB;
${COMPOSITE_BODY}
`;

function createSilkSceneImpl(): Scene {
  let sharpProg: GLProgram | null = null;
  let tailProg: GLProgram | null = null;
  let blurProg: GLProgram | null = null;
  let compositeProg: GLProgram | null = null;
  let quadVao: WebGLVertexArrayObject | null = null;
  const samplerLocs = new Map<string, WebGLUniformLocation | null>();
  const bandsBuf = new Float32Array(NUM_BANDS);
  const echoFlowBuf = new Float32Array(ECHO_MAX * ECHO_FLOW_STRIDE);
  let state: SilkState | null = null;

  let dbW = 0;
  let dbH = 0;
  let sharpTex: WebGLTexture | null = null;
  let sharpFbo: WebGLFramebuffer | null = null;
  let sharpW = 0;
  let sharpH = 0;
  let tailTex: [WebGLTexture | null, WebGLTexture | null] = [null, null];
  let tailFbo: [WebGLFramebuffer | null, WebGLFramebuffer | null] = [null, null];
  let tailW = 0;
  let tailH = 0;
  let tailRead = 0;
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
      throw new Error(`silk: framebuffer incomplete (0x${status.toString(16)})`);
    }
    return f;
  }

  function freeTargets(gl: WebGL2RenderingContext): void {
    for (const fbo of [sharpFbo, ...tailFbo, l0AFbo, l0BFbo, l1AFbo, l1BFbo]) if (fbo) gl.deleteFramebuffer(fbo);
    for (const tex of [sharpTex, ...tailTex, l0ATex, l0BTex, l1ATex, l1BTex]) if (tex) gl.deleteTexture(tex);
    sharpFbo = l0AFbo = l0BFbo = l1AFbo = l1BFbo = null;
    sharpTex = l0ATex = l0BTex = l1ATex = l1BTex = null;
    tailFbo = [null, null];
    tailTex = [null, null];
    sharpW = sharpH = l0W = l0H = l1W = l1H = tailW = tailH = 0;
    dbW = 0;
    dbH = 0;
  }

  /** Rebuilds every target when the drawing buffer changes size (the
   *  quality governor moves renderScale at runtime — crystal's own
   *  reasoning). The tail is cleared to black on rebuild: a resize mid-
   *  session loses the haze for a moment rather than showing a stretched
   *  frame of it, which would read far worse than a brief fade-in. */
  function ensureTargets(gl: WebGL2RenderingContext): void {
    const w = Math.max(1, gl.drawingBufferWidth);
    const h = Math.max(1, gl.drawingBufferHeight);
    if (w === dbW && h === dbH && sharpFbo) return;
    freeTargets(gl);
    dbW = w;
    dbH = h;

    sharpW = Math.max(1, Math.round(w * SHARP_SCALE));
    sharpH = Math.max(1, Math.round(h * SHARP_SCALE));
    sharpTex = makeTexture(gl, sharpW, sharpH);
    sharpFbo = attachColour(gl, sharpTex);

    const tailScale = Math.min(TAIL_SCALE, TAIL_SIDE_CAP / Math.max(w, h));
    tailW = Math.max(1, Math.round(w * tailScale));
    tailH = Math.max(1, Math.round(h * tailScale));
    for (let i = 0; i < 2; i++) {
      tailTex[i] = makeTexture(gl, tailW, tailH);
      tailFbo[i] = attachColour(gl, tailTex[i]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, tailFbo[i]);
      gl.viewport(0, 0, tailW, tailH);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    tailRead = 0;

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

  function uploadDriverUniforms(
    prog: GLProgram,
    out: ReturnType<typeof advanceSilk>,
  ): void {
    prog.setF("uZoomRate", out.zoomRate);
    prog.setF("uHoleEff", out.hole);
    prog.setF("uFieldEff", out.fieldScale);
    prog.setF("uFoldMix", out.foldMix);
    prog.setF("uHueBias", out.hueBias);
    prog.setF("uSwell", out.swell);
    prog.setF("uWebShape", out.webShape);
    prog.setF("uWebR", out.webR);
    prog.setF("uWebTilt", out.webTilt);
    prog.setF("uWebBreath", out.webBreath);
  }

  return {
    id: ID,
    name: "Silk",
    minQuality: "low",
    settings: SETTINGS,

    init(ctx: SceneContext) {
      const { gl } = ctx;
      sharpProg = createProgram(gl, buildSharpFragSource());
      tailProg = createProgram(gl, buildTailFragSource());
      blurProg = createProgram(gl, BLUR_FRAG);
      compositeProg = createProgram(gl, COMPOSITE_FRAG);
      samplerLocs.clear();
      quadVao = createFullscreenQuad(gl);
      state = createSilkState();
      dbW = 0;
      dbH = 0;
    },

    render(ctx, frame, viewport, palette, anim) {
      if (!sharpProg || !tailProg || !blurProg || !compositeProg || !quadVao || !state) return;
      const { gl } = ctx;
      ensureTargets(gl);

      const out = advanceSilk(
        state,
        {
          dtSec: anim.dtSec,
          onset: anim.onset,
          dropOnset: anim.dropOnset,
          barPhase: anim.barPhase,
          tempoLock: anim.tempoLock,
          low: anim.low,
          mid: anim.mid,
          level: frame.level,
        },
        {
          strands: resolveSceneSetting(ID, settingFor("strands")),
          density: resolveSceneSetting(ID, settingFor("density")),
          hole: resolveSceneSetting(ID, settingFor("hole")),
          foldOpt: resolveSceneSetting(ID, settingFor("fold")),
          flow: resolveSceneSetting(ID, settingFor("flow")),
          zoom: resolveSceneSetting(ID, settingFor("zoom")),
          hold: resolveSceneSetting(ID, settingFor("hold")),
          push: resolveSceneSetting(ID, settingFor("push")),
          size: resolveSceneSetting(ID, settingFor("size")),
        },
      );

      const echoCount = ECHO_COUNT_BY_PRESET[ctx.quality.preset] ?? ECHO_MAX;
      fillEchoFlows(out.morph, out.morphStepPerEcho, echoCount, echoFlowBuf);

      const glowSetting = resolveSceneSetting(ID, settingFor("glow"));
      const useBloom = ctx.quality.bloomPasses > 0 && glowSetting > 0.01;
      const glowScale = useBloom ? 0.2 + 0.5 * glowSetting : 0;

      gl.disable(gl.BLEND);

      // 1. Sharp pass: K analytic echoes of the strand field, folded and
      // masked to the annulus — see glsl.ts's SHARP_BODY.
      gl.bindFramebuffer(gl.FRAMEBUFFER, sharpFbo);
      gl.viewport(0, 0, sharpW, sharpH);
      sharpProg.use();
      uploadCommonUniforms(sharpProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      uploadDriverUniforms(sharpProg, out);
      sharpProg.setF("uEchoCount", echoCount);
      sharpProg.setFv("uEchoFlow", echoFlowBuf);
      drawFullscreenQuad(gl, quadVao);

      // 2. Tail step: reads this same frame's sharp result (one-frame lag,
      // invisible on a slow haze) and this scene's own previous tail —
      // see glsl.ts's TAIL_BODY for the sqrt-encoded decay-with-floor.
      const tailWrite = 1 - tailRead;
      gl.bindFramebuffer(gl.FRAMEBUFFER, tailFbo[tailWrite]);
      gl.viewport(0, 0, tailW, tailH);
      tailProg.use();
      uploadCommonUniforms(tailProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      uploadDriverUniforms(tailProg, out);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tailTex[tailRead]);
      gl.uniform1i(samplerLoc(gl, tailProg, "tail.uPrevTail", "uPrevTail"), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, sharpTex);
      gl.uniform1i(samplerLoc(gl, tailProg, "tail.uSharpTex", "uSharpTex"), 1);
      drawFullscreenQuad(gl, quadVao);
      tailRead = tailWrite;

      // 3. Bloom: two levels, each a separable blur of the sharp target —
      // same shape as crystal's chain. Skipped at bloomPasses === 0 or
      // Glow ~ 0 (also true of every gallery preview tile).
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

      // 4. Composite to the default framebuffer at the host viewport.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      compositeProg.use();
      uploadCommonUniforms(compositeProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      compositeProg.setF("uLevelS", out.levelS);
      compositeProg.setF("uBrightS", out.brightS);
      compositeProg.setF("uGA", useBloom ? glowScale * 0.6 : 0);
      compositeProg.setF("uGB", useBloom ? glowScale * 0.35 : 0);
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

      // The gallery renders every scene into one shared context each tick
      // — must not leak blend state or a bound texture/unit onward.
      gl.disable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ZERO);
      for (let unit = 2; unit >= 0; unit--) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      sharpProg?.dispose();
      tailProg?.dispose();
      blurProg?.dispose();
      compositeProg?.dispose();
      if (quadVao) gl.deleteVertexArray(quadVao);
      freeTargets(gl);
      samplerLocs.clear();
      sharpProg = null;
      tailProg = null;
      blurProg = null;
      compositeProg = null;
      quadVao = null;
      state = null;
    },
  };
}

export const silkScene: Scene = createSilkSceneImpl();
