import { createProgram, createFullscreenQuad, drawFullscreenQuad, type GLProgram } from "../gl.ts";
import type { SceneSetting } from "../sceneSettings.ts";
import { settingDefault } from "../sceneSettings.ts";
import { resolveSceneSetting } from "../autoTune.ts";
import type { Scene, SceneContext } from "../scene.ts";
import {
  COMMON_UNIFORMS_GLSL,
  ROOM_UV_GLSL,
  SAMPLE_BANDS_GLSL,
  settingUniformName,
  uploadCommonUniforms,
} from "../sceneCommon.ts";
import type { QualityPreset } from "../quality.ts";
import { NUM_BANDS } from "../../audio/types.ts";

// Gray-Scott reaction-diffusion, built from six reference videos the user
// found under that name (tools/.cache/refs/{2s28LbNqmOM,48H_Fre00AY,
// 9pAkn0bsCLU,P-UTmeA4qeI,VTcH08UgcAE,rBwFHMb8Lh0} in the main checkout,
// read-only). This second pass rebuilds Style and Look against a closer
// read of the two grayscale references (2s28LbNqmOM, 9pAkn0bsCLU —
// look.png/keyframes.png if useful): both are a light clay-gray ground
// (#a6a6a6) with the pattern rendered as a lit 3D relief — raised
// domes/tubes with a soft specular in 2s28LbNqmOM, carved dark grooves with
// white ridge highlights in 9pAkn0bsCLU. v1's Mono style was dark-ground,
// i.e. inverted — this file's Clay style corrects that. 9pAkn0bsCLU also
// (a) confines the colony to a dish (a disc or rounded rect with flat clay
// around it) in two of its four regimes — Dish below — (b) has one regime
// that's a perspective floor of glossy black beads receding to a horizon
// with a light sky, camera flying forward — Beads below — and (c) is a
// montage: five cuts in 19s between regimes (maze disc -> labyrinth front
// -> four drops -> radial dashes -> beads floor) — Regime cuts below. All
// six clips were silent or beatless, confirmed independently per bundle
// ("NO USABLE AUDIO... only the visual findings mean anything"), so every
// audio mapping here (including how a regime cut is triggered) is an
// authored choice, not a measurement — same disclaimer v1 made, still true.
//
// A real hard cut to a *different mature colony* isn't possible with one
// state pair — a cut here instead jumps Feed/Kill to another named point of
// the Pearson plane (REGIMES below) and stamps fresh seeds; the colony then
// re-organises over a second or two, which is the closest a continuously
// simulated field can get to 9pAkn0bsCLU's montage cuts.
//
// Style's five options: Clay and Beads both trace to the grayscale
// references' relief look (flat vs. flown-over-in-perspective); Spectrum
// and Ember reuse v1's two surviving colour looks (48H_Fre00AY's rainbow
// growth front, P-UTmeA4qeI's bone-and-copper maze); Neon — outline only,
// hue following the music — has no reference and is this file's own
// addition, the one style that reads as "signal" rather than "material".
// Feed and Kill still expose the actual Pearson (1993) parameter plane the
// references only sampled a few points of; Regime cuts below is what turns
// the manual "slide through it yourself" into the reference's own montage
// structure.
//
// The equations, independently derived rather than ported from any of the
// countless existing Gray-Scott shaders (CLAUDE.md's standing rule): two
// chemicals U (abundant "feed" reagent) and V (the reacting agent that
// draws the figure) on a toroidal grid,
//   dU/dt = Du*lap(U) - U*V*V + F*(1-U)
//   dV/dt = Dv*lap(V) + U*V*V - (F+K)*V
// stepped with a plain 5-point Laplacian and forward Euler at dt=1 with the
// 2:1 diffusion ratio (without it V always wins and the field flatlines to
// nothing) at the CFL-stable magnitudes SIM_FRAG's DU/DV comment explains.
// Growth speed is exposed as *iterations per
// rendered frame* rather than a variable dt, so the discretisation itself
// never changes shape, just how many times it's applied; Beat growth
// (throb) squeezes extra iterations into a beat frame the same way, so a
// jerkier per-beat pace never needs its own dt either.
//
// State packing: a ping-pong pair of RGBA8 textures, R=U, G=V (B/A unused,
// written as 0/1) — RGBA8 is the only renderable format this repo relies on
// (see powder.ts's header for why EXT_color_buffer_float stays unused). One
// step's du/dv is well within 8-bit resolution at dt=1 on this
// discretisation, the same reason countless WebGL Gray-Scott
// implementations get away with 8 bits. LINEAR filtering is safe even for
// the sim pass, because every neighbour sample lands exactly on a texel
// centre (the offset is exactly one texel) — the sim/seed passes always
// read mip level 0 this way (a 1:1 texel-to-pixel fullscreen draw), so
// Beads' display-only mipmap switch (see the JS below) never touches their
// output. REPEAT wrap makes the domain toroidal, so the Laplacian never
// needs edge handling and neither of the two *unbounded* motions — Drift's
// rotation (every style) nor its forward Beads travel — ever exposes a hard
// border, just, eventually, the tiling. Beat zoom (punch) and a regime
// cut's camera kick are both self-decaying rather than accumulating, for
// the same reason: an unbounded zoom would eventually make the tiling
// obvious over a long session, where an unbounded rotation or forward
// crawl doesn't.
//
// Band shaping (`shaping`) bends the sim's own kill rate by radius rather
// than touching the display: bass plays out near the field's centre,
// treble near its rim, so the *pattern itself* goes spotty in the middle on
// a kick and wormy at the edge on hats, before any camera or colour effect
// ever sees it.
//
// Reseed/wipe/regime-cut all share one seed pass (seedProg) and one shared
// budget of MAX_SEEDS signed slots per frame — positive stamps V (a
// nucleation site, the same mechanism that makes mitosis mitosis), negative
// clears V and refills U (a wipe: fresh reagent in the hole so it regrows
// from the rim, see Bass wipe below). A beat stamps a few soft bumps scaled
// by Reseed and the hit's strength; a regime cut claims most of the budget
// for a burst of fresh sites; a silent fallback timer (FALLBACK_RESEED_SEC)
// stamps one regardless of Reseed, silence, or regime state, so the field
// can never fully decay into a boring fixed point over a long session.
const ID = "petri";

const GRID_SIDE: Record<QualityPreset, number> = { high: 512, mid: 384, low: 256, floor: 192 };

const DRIFT_DEG_PER_SEC = 6; // at Drift = 1
const BEADS_TRAVEL_PER_SEC = 0.12; // sim uv per second at Drift = 1, Beads style
const FALLBACK_RESEED_SEC = 6; // longest silence/no-reseed can go before a stamp anyway
const RESEED_COOLDOWN_SEC = 0.2; // an onset-triggered stamp can't refire faster than this
const WIPE_COOLDOWN_SEC = 0.25; // an onset-triggered wipe can't refire faster than this
const REGIME_FALLBACK_SEC = 20; // with cuts on but no beat/drop to place one, cut anyway
const CUT_KICK_DECAY_PER_SEC = 4; // camera-kick decay rate after a regime cut
const THROB_STEPS = 4; // extra sim steps at beatPulse = 1, Beat growth = 1
const MAX_ITERATIONS = 8; // hard cap on sim steps/frame regardless of Growth speed + Beat growth
const MAX_SEEDS = 4; // seed-pass slots per frame, shared by reseed stamps, regime cuts and wipes
const SEED_RADIUS_TEXELS = 5; // a stamped nucleation site's radius, plus up to SEED_RADIUS_JITTER more —
const SEED_RADIUS_JITTER = 4; // a dot much smaller than this dissolves before it can grow in most regimes
// Extra sim steps run over the first frames after init, so the scene opens on
// a mature colony (the references are all mid-growth, never a few fresh dots)
// — spread over several frames rather than one so there's no start-up hitch.
const WARMUP_STEPS = 1200;
const WARMUP_STEPS_PER_FRAME = 100;
const V_FLOOR = 0.03; // display-side floor under V — see readV in DISPLAY_FRAG
const SHAPE_KILL_SWING = 0.005; // full-scale kill swing from Band shaping — kept under the ~0.003 a regime can take before dissolving

const STYLE_NAMES = ["Clay", "Beads", "Spectrum", "Ember", "Neon"] as const;

// Named points of the Pearson plane under the Du/Dv pairing in SIM_FRAG
// below (the classic tables' points hold because scaling both diffusion
// rates only rescales space, not the Feed/Kill plane). Regime cuts pick
// among these; the first is where every style starts. Every entry was held
// for 8 s from a mature colony on this exact discretisation before it went
// in: an invented point (0.046/0.063) and the textbook mitosis point
// (0.0367/0.0649) both sit past the survival edge here and quietly dissolved
// the whole colony within seconds — Feed/Kill sliders can still be dragged
// there by hand, but a cut must never land there on its own.
const REGIMES: ReadonlyArray<{ name: string; feed: number; kill: number }> = [
  // The start point: grows from dots into the references' labyrinth. Maze
  // (below) is the purer labyrinth but only propagates from an established
  // colony — fresh dots dissolve there, so it's a cut target, never the start.
  { name: "coral", feed: 0.037, kill: 0.06 },
  { name: "maze", feed: 0.029, kill: 0.057 },
  { name: "solitons", feed: 0.03, kill: 0.062 },
  { name: "holes", feed: 0.039, kill: 0.058 },
  { name: "coral-fine", feed: 0.0545, kill: 0.062 },
];

const SETTINGS: SceneSetting[] = [
  // Form
  {
    key: "style",
    label: "Style",
    description:
      "Clay: light clay ground, the colony carved into it as a lit relief — the grayscale references. Beads: the same relief as a glossy floor flown over in perspective. Spectrum: a jet LUT, blue substrate through green to red cores. Ember: bone-and-copper on black with a hot rim. Neon: only the colony's outline, as glowing lines whose hue follows the music. Every other setting remembers its own value per style",
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
    default: 0.037,
    variantDefaults: { Beads: 0.03, Spectrum: 0.032, Ember: 0.0545, Neon: 0.039 },
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
    variantDefaults: { Beads: 0.062, Spectrum: 0.058, Ember: 0.062, Neon: 0.058 },
    auto: { dynamics: 0.2, tempo: -0.15 },
  },
  {
    key: "scale",
    label: "Cell size",
    description:
      "Zooms the pattern — bigger cells at the low end, a finer weave at the high end (Beads: how densely the floor is tiled)",
    group: "Form",
    min: 0.5,
    max: 2.5,
    step: 0.05,
    default: 1.2,
    variantDefaults: { Clay: 1.0, Spectrum: 0.8 },
  },
  {
    key: "dish",
    label: "Dish",
    description:
      "Confines the colony to a round dish of this size with bare ground around it — 0 lets it fill the whole (wrapping) field",
    group: "Form",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0,
    variantDefaults: { Clay: 0.9 },
  },
  // Motion
  {
    key: "speed",
    label: "Growth speed",
    description: "Simulation steps per rendered frame — how fast the pattern grows and spreads",
    group: "Motion",
    min: 1,
    max: 6,
    step: 1,
    default: 3,
    auto: { pulse: 0.25, attack: 0.15 },
  },
  {
    key: "throb",
    label: "Beat growth",
    description:
      "Extra growth steps squeezed in on each beat, so the colony grows in jerks with the music instead of at one steady pace",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { pulse: 0.2 },
    reads: ["feature.onset"],
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
    key: "wipe",
    label: "Bass wipe",
    description: "A kick clears a round hole in the colony, which then regrows from its rim — size follows the hit",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    auto: { dynamics: 0.2 },
    reads: ["anim.lowOnset"],
  },
  {
    key: "regime",
    label: "Regime cuts",
    description:
      "Jumps Feed/Kill to another named pattern regime and reseeds — the references are montages cutting between regimes. Drop: only on a section drop. Phrase: every four bars (and drops). Bar: every bar (and drops). Feed/Kill then shift the current regime rather than set it",
    group: "Motion",
    type: "enum",
    options: ["Off", "Drop", "Phrase", "Bar"],
    min: 0,
    max: 3,
    step: 1,
    default: 2,
    reads: ["anim.dropOnset"],
  },
  // Look
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
    reads: ["feature.onset"],
  },
  {
    key: "relief",
    label: "Relief",
    description:
      "How tall the colony stands off the ground in Clay and Beads (a kick makes it swell); a lighter shading in Spectrum and Ember; nothing in Neon",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.6,
    auto: { dynamics: 0.2 },
    reads: ["anim.lowOnset"],
  },
  {
    key: "shaping",
    label: "Band shaping",
    description:
      "Lets the spectrum reshape the colony by radius — each band's level bends the kill rate at its own distance from the centre, bass in the middle, treble at the rim, so kicks go spotty in the centre while hats send the edge wormy",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    auto: { density: 0.2 },
  },
  {
    key: "tint",
    label: "Hue follow",
    description:
      "How far the live spectral centroid pushes the palette hue in Spectrum, Ember and Neon — Clay and Beads stay gray",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    reads: ["anim.centroid"],
  },
  // Camera
  {
    key: "drift",
    label: "Drift",
    description: "A slow continuous spin over the pattern (Beads: flies forward over the floor instead)",
    group: "Camera",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
    auto: { dynamics: 0.2 },
  },
  {
    key: "punch",
    label: "Beat zoom",
    description: "Punches the view in on each beat; a regime cut kicks it harder",
    group: "Camera",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    auto: { pulse: 0.2 },
    reads: ["feature.onset"],
  },
  // Post
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
${SAMPLE_BANDS_GLSL}
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

  // Band shaping: the kill rate bends by radius with the spectrum — bass
  // plays out near the centre, treble near the rim, so a kick reshapes the
  // middle of the dish while hats fray the edge into worms.
  float rr = length(vUv - 0.5) * 2.0;
  float band = sampleBands(clamp(rr, 0.0, 1.0));
  float kill = uKill + uShaping * ${SHAPE_KILL_SWING.toFixed(4)} * (band - 0.35);

  float du = DU * lap.x - reaction + uFeed * (1.0 - U);
  float dv = DV * lap.y + reaction - (uFeed + kill) * V;
  U = clamp(U + du, 0.0, 1.0);
  V = clamp(V + dv, 0.0, 1.0);

  // Dish: outside it, bare ground (U=1, V=0), soft-edged so the rim doesn't
  // hard-clip the colony mid-growth.
  if (uDish > 0.0) {
    float m = smoothstep(0.5 * uDish, 0.5 * uDish - 0.015, length(vUv - 0.5));
    V *= m;
    U = mix(1.0, U, m);
  }

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
// xy = centre (uv), z = radius (uv), w = strength: w == 0 disables a slot,
// w > 0 stamps a seed (nucleation site), w < 0 is a wipe (clears V, refills
// U so the hole regrows from the rim with fresh reagent).
uniform vec4 uSeeds[${MAX_SEEDS}];

void main() {
  vec4 c = texture(uPrev, vUv);
  float delta = 0.0;
  for (int i = 0; i < ${MAX_SEEDS}; i++) {
    vec4 sd = uSeeds[i];
    if (sd.w == 0.0) continue;
    // Shortest toroidal offset, so a seed near uv 0/1 still stamps a whole
    // round disc instead of one sliced off by the wrap.
    vec2 d = vUv - sd.xy;
    d -= round(d);
    delta += sd.w * smoothstep(sd.z, 0.0, length(d));
  }
  float V = clamp(c.g + delta, 0.0, 1.0);
  float U = clamp(c.r + max(-delta, 0.0), 0.0, 1.0);
  outColor = vec4(U, V, 0.0, 1.0);
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
uniform float uTravel;  // Beads' forward offset into the sim field, uv units
uniform float uCutKick; // 0..1, decaying since the last regime cut — see the header

vec2 foldAngle(vec2 p, float n) {
  float ang = atan(p.y, p.x);
  float r = length(p);
  float wedge = 6.28318530718 / n;
  ang = abs(mod(ang, wedge) - wedge * 0.5);
  return vec2(cos(ang), sin(ang)) * r;
}

// Hue rotation about the YIQ chroma plane — cheap, and it holds luminance,
// so Hue follow walking a style's palette round the wheel never changes how
// bright the picture reads.
vec3 hueRotate(vec3 c, float turns) {
  float a = turns * 6.28318530718;
  float u = cos(a), w = sin(a);
  mat3 toYiq = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
  mat3 toRgb = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
  vec3 yiq = toYiq * c;
  yiq.yz = vec2(yiq.y * u - yiq.z * w, yiq.y * w + yiq.z * u);
  return max(toRgb * yiq, vec3(0.0));
}

// Standard HSV->RGB (branchless). Neon's outline hue comes from here rather
// than the jet LUT below, since it wants a full wheel, not a fixed ramp.
// Inigo Quilez's branchless hsv2rgb (MIT) — see THIRD-PARTY-NOTICES.md
vec3 hsv2rgb(vec3 hsv) {
  vec3 rgb = clamp(abs(mod(hsv.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return hsv.z * mix(vec3(1.0), rgb, hsv.y);
}

// A 5-stop LUT for Spectrum: deep blue substrate, through cyan/green
// growth, to yellow/red mitosis cores.
vec3 jet(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.02, 0.05, 0.35);
  vec3 c1 = vec3(0.05, 0.35, 0.95);
  vec3 c2 = vec3(0.10, 0.85, 0.35);
  vec3 c3 = vec3(0.95, 0.90, 0.15);
  vec3 c4 = vec3(0.90, 0.15, 0.10);
  if (t < 0.25) return mix(c0, c1, t * 4.0);
  if (t < 0.5) return mix(c1, c2, (t - 0.25) * 4.0);
  if (t < 0.75) return mix(c2, c3, (t - 0.5) * 4.0);
  return mix(c3, c4, (t - 0.75) * 4.0);
}

// V's gradient at a sim uv; stepMul (in texels) lets Beads widen the
// sample spacing with distance, so far (heavily minified) rows shade
// smoothly instead of aliasing into noise.
// Reads V with its lowest few 8-bit steps floored off: on bare ground the
// state's near-zero V sits in quantised plateaus whose straight edges the
// relief lighting would otherwise pick out as faint ghost polygons.
float readV(vec2 p) {
  return max(texture(uPrev, p).g - ${V_FLOOR.toFixed(3)}, 0.0);
}

vec2 gradV(vec2 p, float stepMul) {
  vec2 d = vec2(uTexel * stepMul);
  float vN = readV(p + vec2(0.0, d.y));
  float vS = readV(p - vec2(0.0, d.y));
  float vE = readV(p + vec2(d.x, 0.0));
  float vW = readV(p - vec2(d.x, 0.0));
  return vec2(vE - vW, vN - vS);
}

// A heightfield lit from one side, height proportional to V — shared by
// every style that reads as a physical relief (Clay/Beads fully, Spectrum/
// Ember at a reduced strength, as a subtler shading cue).
vec2 shadeRelief(vec2 grad, float relief, float gloss) {
  vec3 n = normalize(vec3(-grad * (18.0 * relief), 1.0));
  vec3 L = normalize(vec3(-0.45, 0.6, 0.65));
  float diff = max(dot(n, L), 0.0);
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, H), 0.0), gloss);
  return vec2(diff, spec);
}

void main() {
  vec2 uv = roomUv(vUv) - 0.5;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  uv.x *= aspect;

  float glowEff = uGlow * (1.0 + 0.6 * uBeatPulse);
  float reliefEff = uRelief * (1.0 + 0.8 * uLowPulse);
  float hueShift = (uCentroid - 0.5) * uTint * 0.5;
  float zoom = 1.0 + uPunch * 0.10 * uBeatPulse + 0.12 * uCutKick;

  vec3 color = vec3(0.0);

  if (uStyle < 0.5 || uStyle >= 1.5) {
    // Every style but Beads shares one camera path back into sim space:
    // punch-zoom, the continuous drift spin, then an optional kaleidoscope
    // fold.
    vec2 pUv = uv / zoom;
    float ca = cos(uDriftAngle), sa = sin(uDriftAngle);
    pUv = mat2(ca, sa, -sa, ca) * pUv;
    if (uSymmetry >= 2.0) pUv = foldAngle(pUv, uSymmetry);
    vec2 simUv = pUv / uScale + 0.5;

    float V = readV(simUv);
    vec2 grad = gradV(simUv, 1.0);
    // With Dish on, the field is one dish, not a lattice of them: anything
    // the camera sees beyond the field's own tile is bare ground (the
    // toroidal wrap only exists so the sim never needs edge handling).
    if (uDish > 0.0 && (simUv.x < 0.0 || simUv.x > 1.0 || simUv.y < 0.0 || simUv.y > 1.0)) {
      V = 0.0;
      grad = vec2(0.0);
    }
    float edge = length(grad);

    if (uStyle < 0.5) {
      // Clay: light clay ground, the colony carved into it as a lit relief
      // — 2s28LbNqmOM/9pAkn0bsCLU's grayscale look.
      float body = smoothstep(0.12, 0.45, V);
      vec3 albedo = mix(vec3(0.70), vec3(0.11), body); // ground lands near the measured #a6a6a6
      vec2 sh = shadeRelief(grad, reliefEff, 32.0);
      color = albedo * (0.62 + 0.38 * sh.x) + sh.y * 0.35 * (0.4 + 0.6 * body);
      color += edge * glowEff;
    } else if (uStyle < 2.5) {
      // Spectrum: jet LUT, hue-shiftable by Hue follow.
      float tt = smoothstep(0.02, 0.65, V);
      color = hueRotate(jet(tt), hueShift);
      vec2 sh = shadeRelief(grad, reliefEff * 0.5, 24.0);
      color *= 0.75 + 0.25 * sh.x;
      color += edge * glowEff;
    } else if (uStyle < 3.5) {
      // Ember: bone-and-copper on near-black, with a hot rim at the growth
      // front.
      color = mix(vec3(0.02, 0.015, 0.01), vec3(0.72, 0.36, 0.12), smoothstep(0.05, 0.4, V));
      color = mix(color, vec3(0.95, 0.88, 0.70), smoothstep(0.4, 0.85, V));
      vec2 sh = shadeRelief(grad, reliefEff * 0.5, 24.0);
      color *= 0.7 + 0.3 * sh.x;
      // A warm rim, kept under the body's own brightness so Ember reads as
      // lit material, not as outlines (that's Neon's job).
      color += edge * glowEff * 1.2 * vec3(1.0, 0.5, 0.15);
      color = hueRotate(color, hueShift * 0.3);
    } else {
      // Neon: only the outline survives, as glowing lines on black.
      vec2 gradWide = gradV(simUv, 3.0);
      float core = smoothstep(0.02, 0.12, edge);
      float edgeWide = length(gradWide);
      float halo = smoothstep(0.0, 0.15, edgeWide) * 0.5;
      float hue = fract(0.55 + hueShift + V * 0.15);
      vec3 col = hsv2rgb(vec3(hue, 0.9, 1.0));
      color = col * (core + halo * (0.6 + glowEff)) * (0.8 + 0.6 * uBeatPulse);
    }
  } else {
    // Beads: the same relief as a glossy floor flown over in perspective —
    // no rotation, fold or uv zoom; Beat zoom instead nudges the camera's
    // depth scale (0.18 below), which reads as the same punch-in without
    // breaking the horizon line.
    float horizon = 0.30;
    float yy = horizon - uv.y;
    if (yy <= 0.003) {
      color = mix(vec3(0.80), vec3(0.70), clamp((uv.y - horizon) * 3.0, 0.0, 1.0));
    } else {
      float depth = (0.18 * zoom) / yy;
      vec2 plane = vec2(uv.x * depth, depth);
      vec2 simUv = plane * (0.35 / uScale) + vec2(0.5, uTravel);
      float V = readV(simUv);
      vec2 grad = gradV(simUv, max(1.0, depth * 0.6));
      float body = smoothstep(0.12, 0.5, V);
      vec3 albedo = mix(vec3(0.72), vec3(0.04), body);
      vec2 sh = shadeRelief(grad, reliefEff, 64.0);
      color = albedo * (0.5 + 0.5 * sh.x) + sh.y * 0.9 * (0.3 + 0.7 * body);
      float fog = smoothstep(0.0, 1.0, depth * 0.09);
      color = mix(color, vec3(0.74), fog);
    }
  }

  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

/** Initial state: U=1 everywhere (an untouched reagent bath) with a handful
 *  of small V bumps to nucleate — without these Gray-Scott just sits at its
 *  trivial fixed point forever, the same reason every reference's t=0 frame
 *  shows a seed blob rather than a blank field. */
function seedField(side: number, dishAmount: number): Uint8Array {
  const data = new Uint8Array(side * side * 4);
  for (let i = 0; i < side * side; i++) {
    data[i * 4] = 255; // U = 1
    data[i * 4 + 1] = 0; // V = 0
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 255;
  }
  const spots = 14 + Math.floor(Math.random() * 8);
  for (let k = 0; k < spots; k++) {
    const [px, py] = randomSeedPos(dishAmount);
    const cx = Math.floor(px * side);
    const cy = Math.floor(py * side);
    const r = SEED_RADIUS_TEXELS + Math.floor(Math.random() * SEED_RADIUS_JITTER);
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

/** Picks a REGIMES index different from `current` — the "cut to a different
 *  regime" half of a regime cut. */
function pickRegimeIndex(current: number): number {
  if (REGIMES.length <= 1) return current;
  let idx = Math.floor(Math.random() * (REGIMES.length - 1));
  if (idx >= current) idx++;
  return idx;
}

/** A random seed/wipe centre: uniform inside a disc of radius 0.45*dish
 *  around the field's centre when Dish is on (so nothing lands outside it
 *  and gets discarded next sim step), else uniform anywhere in the
 *  (wrapping) field. */
function randomSeedPos(dishAmount: number): [number, number] {
  if (dishAmount > 0) {
    const r = 0.45 * dishAmount * Math.sqrt(Math.random());
    const theta = Math.random() * Math.PI * 2;
    return [0.5 + r * Math.cos(theta), 0.5 + r * Math.sin(theta)];
  }
  return [Math.random(), Math.random()];
}

function clampRange(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
  let travel = 0;
  let timeSinceSeed = 0;
  let seedCooldown = 0;
  let wipeCooldown = 0;
  let cutKick = 0;
  let regimeIndex = 0;
  let timeSinceCut = 0;
  let bars = 0;
  let prevBarPhase = 0;
  let warmupLeft = 0;
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
      const seed = seedField(gridSide, resolveSceneSetting(ID, settingFor("dish")));
      for (let i = 0; i < 2; i++) {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gridSide, gridSide, 0, gl.RGBA, gl.UNSIGNED_BYTE, i === 0 ? seed : null);
        // Starts LINEAR (no mips) on every texture — a mipmap min filter
        // with no mip levels is an incomplete texture that samples black;
        // Beads switches this on per-frame, see render() below.
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
      travel = 0;
      timeSinceSeed = 0;
      seedCooldown = 0;
      wipeCooldown = 0;
      cutKick = 0;
      regimeIndex = 0;
      timeSinceCut = 0;
      bars = 0;
      prevBarPhase = 0;
      warmupLeft = WARMUP_STEPS;
      lastFrameTime = null;
    },

    render(ctx, frame, viewport, palette, anim) {
      if (!simProg || !seedProg || !displayProg || !quadVao) return;
      const { gl } = ctx;

      const dt = lastFrameTime === null ? 1 / 60 : Math.max(0, Math.min(0.1, frame.time - lastFrameTime));
      lastFrameTime = frame.time;

      const styleIndex = Math.round(resolveSceneSetting(ID, settingFor("style")));
      const speedAmount = resolveSceneSetting(ID, settingFor("speed"));
      const throbAmount = resolveSceneSetting(ID, settingFor("throb"));
      const reseedAmount = resolveSceneSetting(ID, settingFor("reseed"));
      const wipeAmount = resolveSceneSetting(ID, settingFor("wipe"));
      const regimeSetting = resolveSceneSetting(ID, settingFor("regime"));
      const driftAmount = resolveSceneSetting(ID, settingFor("drift"));
      const dishAmount = resolveSceneSetting(ID, settingFor("dish"));
      const feedAmount = resolveSceneSetting(ID, settingFor("feed"));
      const killAmount = resolveSceneSetting(ID, settingFor("kill"));

      const baseIterations = Math.max(1, Math.round(speedAmount));
      let iterations = Math.min(
        MAX_ITERATIONS,
        baseIterations + Math.round(throbAmount * THROB_STEPS * anim.beatPulse),
      );
      if (warmupLeft > 0) {
        const burst = Math.min(warmupLeft, WARMUP_STEPS_PER_FRAME);
        warmupLeft -= burst;
        iterations += burst;
      }

      // Bars: a bar boundary is whenever the phase wraps backwards.
      const barWrapped = anim.barPhase < prevBarPhase - 0.5;
      if (barWrapped) bars++;
      prevBarPhase = anim.barPhase;

      // Regime cuts: jump Feed/Kill to another named point of the Pearson
      // plane and reseed — standing in for the "hard cut to a different
      // mature colony" a montage would show, which one state pair can't
      // produce on its own (see the header).
      const regimeMode = Math.round(regimeSetting); // 0 Off, 1 Drop, 2 Phrase, 3 Bar
      timeSinceCut += dt;
      const wantCut =
        regimeMode > 0 &&
        (anim.dropOnset ||
          (regimeMode >= 2 && barWrapped && (regimeMode === 3 || bars % 4 === 0)) ||
          timeSinceCut > REGIME_FALLBACK_SEC);

      cutKick *= Math.exp(-dt * CUT_KICK_DECAY_PER_SEC);

      seedCooldown = Math.max(0, seedCooldown - dt);
      wipeCooldown = Math.max(0, wipeCooldown - dt);
      timeSinceSeed += dt * iterations;

      // One seed pass covers everything this frame wants to stamp — cut
      // seeds take priority, then an onset/fallback reseed, then a wipe
      // fills whatever's left; MAX_SEEDS is a shared budget across all
      // four sources.
      seedsBuf.fill(0);
      let slotsUsed = 0;
      let anySeedThisFrame = false;

      const seedRadius = () => (SEED_RADIUS_TEXELS + Math.random() * SEED_RADIUS_JITTER) * texel;
      const stampSeed = (strength: number, radiusUv: number) => {
        const [cx, cy] = randomSeedPos(dishAmount);
        seedsBuf[slotsUsed * 4] = cx;
        seedsBuf[slotsUsed * 4 + 1] = cy;
        seedsBuf[slotsUsed * 4 + 2] = radiusUv;
        seedsBuf[slotsUsed * 4 + 3] = strength;
        slotsUsed++;
      };

      if (wantCut) {
        regimeIndex = pickRegimeIndex(regimeIndex);
        cutKick = 1;
        const sign = Math.random() < 0.5 ? -1 : 1;
        driftAngle += sign * (Math.PI / 6 + Math.random() * (Math.PI / 6));
        timeSinceCut = 0;
        timeSinceSeed = 0;
        const cutSeedCount = MAX_SEEDS - 1;
        for (let i = 0; i < cutSeedCount; i++) stampSeed(1, seedRadius());
        anySeedThisFrame = true;
      } else if (anim.onset && reseedAmount > 0.02 && seedCooldown <= 0) {
        const stamps = 1 + Math.floor(reseedAmount * (MAX_SEEDS - 1));
        const strength = 0.5 + 0.5 * anim.beatPulse * reseedAmount;
        for (let i = 0; i < stamps; i++) stampSeed(strength, seedRadius());
        seedCooldown = RESEED_COOLDOWN_SEC;
        timeSinceSeed = 0;
        anySeedThisFrame = true;
      } else if (timeSinceSeed > FALLBACK_RESEED_SEC) {
        stampSeed(1, seedRadius());
        timeSinceSeed = 0;
        anySeedThisFrame = true;
      }

      if (anim.lowOnset && wipeAmount > 0.02 && wipeCooldown <= 0 && slotsUsed < MAX_SEEDS) {
        const radius = (0.015 + 0.05 * wipeAmount) * (0.6 + 0.4 * anim.lowPulse);
        stampSeed(-1, radius);
        wipeCooldown = WIPE_COOLDOWN_SEC;
        anySeedThisFrame = true;
      }

      // Effective Feed/Kill: Off uses the sliders directly; any other mode
      // re-centres them on the current regime's named point, so under auto
      // the sliders wobble *around* the regime instead of overriding it.
      const feedSpec = settingFor("feed");
      const killSpec = settingFor("kill");
      let effFeed = feedAmount;
      let effKill = killAmount;
      if (regimeMode > 0) {
        const regime = REGIMES[regimeIndex];
        const feedBase = settingDefault(ID, feedSpec);
        const killBase = settingDefault(ID, killSpec);
        effFeed = clampRange(regime.feed + (feedAmount - feedBase), feedSpec.min, feedSpec.max);
        effKill = clampRange(regime.kill + (killAmount - killBase), killSpec.min, killSpec.max);
      }

      gl.disable(gl.BLEND);
      gl.viewport(0, 0, gridSide, gridSide);

      for (let i = 0; i < iterations; i++) {
        const write = 1 - read;
        gl.bindFramebuffer(gl.FRAMEBUFFER, stateFbo[write]);
        simProg.use();
        uploadCommonUniforms(simProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
        simProg.setF("uTexel", texel);
        // Regime-effective values override the plain slider readings
        // uploadCommonUniforms just set — same uniform names (uFeed/uKill),
        // so the sim shader stays oblivious to regimes existing at all.
        simProg.setF("uFeed", effFeed);
        simProg.setF("uKill", effKill);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, stateTex[read]);
        gl.uniform1i(simPrevLoc, 0);
        drawFullscreenQuad(gl, quadVao);
        read = write;
      }

      if (anySeedThisFrame) {
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
      travel += dt * BEADS_TRAVEL_PER_SEC * driftAmount; // used only by Beads

      displayProg.use();
      uploadCommonUniforms(displayProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf);
      displayProg.setF("uTexel", texel);
      displayProg.setF("uDriftAngle", driftAngle);
      displayProg.setF("uTravel", travel);
      displayProg.setF("uCutKick", cutKick);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, stateTex[read]);
      // Beads samples the floor at a steep, receding angle — far rows are
      // heavily minified, so without mips they shimmer under drift/zoom;
      // every other style keeps a plain LINEAR sample. The sim/seed passes
      // always read mip level 0 regardless (see the header), so this swap
      // never touches their output, only how the display pass filters what
      // it reads.
      if (styleIndex === 1) {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      } else {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      }
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
